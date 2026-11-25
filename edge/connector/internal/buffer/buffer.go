// Package buffer provides a durable, crash-safe local event queue for the edge connector.
package buffer

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Entry is one buffered outbound payload.
type Entry struct {
	ID        string          `json:"id"`
	CreatedAt time.Time       `json:"created_at"`
	Attempts  int             `json:"attempts"`
	Payload   json.RawMessage `json:"payload"`
}

// Store is a file-backed FIFO of ingest envelopes under dir.
type Store struct {
	dir string
	mu  sync.Mutex
}

func New(dir string) (*Store, error) {
	if dir == "" {
		return nil, fmt.Errorf("buffer dir required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

func (s *Store) Enqueue(payload []byte) (*Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := fmt.Sprintf("%d-%d.json", time.Now().UnixNano(), os.Getpid())
	e := Entry{
		ID:        id,
		CreatedAt: time.Now().UTC(),
		Attempts:  0,
		Payload:   append(json.RawMessage(nil), payload...),
	}
	b, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(s.dir, id)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}
	return &e, nil
}

func (s *Store) List() ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listLocked()
}

func (s *Store) listLocked() ([]Entry, error) {
	ents, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(ents))
	for _, e := range ents {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)
	out := make([]Entry, 0, len(names))
	for _, name := range names {
		b, err := os.ReadFile(filepath.Join(s.dir, name))
		if err != nil {
			continue
		}
		var e Entry
		if err := json.Unmarshal(b, &e); err != nil {
			continue
		}
		if e.ID == "" {
			e.ID = name
		}
		out = append(out, e)
	}
	return out, nil
}

func (s *Store) MarkAttempt(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.dir, id)
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var e Entry
	if err := json.Unmarshal(b, &e); err != nil {
		return err
	}
	e.Attempts++
	nb, err := json.Marshal(e)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, nb, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) Ack(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.Remove(filepath.Join(s.dir, id))
}

func (s *Store) Len() (int, error) {
	ents, err := s.List()
	if err != nil {
		return 0, err
	}
	return len(ents), nil
}
