// Package credentials manages connector auth token lifecycle for production.
// Tokens are loaded from env and optionally sealed to disk (AES-GCM).
// A SHA-256 fingerprint is always kept for auth-guard checks without exposing
// the sealed secret. Revoke/rotate are first-class hooks; revoked credentials
// block outbound delivery.
package credentials

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// State tracks whether credentials are usable for outbound API calls.
type State string

const (
	StateActive  State = "active"
	StateRotated State = "rotated"
	StateRevoked State = "revoked"
	StateMissing State = "missing"
)

// Event is an append-only lifecycle record (not a secret).
type Event struct {
	At     time.Time `json:"at"`
	Action string    `json:"action"`
	Detail string    `json:"detail,omitempty"`
}

// Options configures production credential storage.
type Options struct {
	EnvVar      string
	StoreDir    string // sealed token + revoke marker live here
	SealKeyEnv  string // 32-byte key material via env (hashed to AES key); required in production when StoreDir set
	RequireSeal bool   // fail closed if seal key missing when StoreDir is set
}

// Manager loads a bearer token and exposes lifecycle hooks.
type Manager struct {
	opts      Options
	mu        sync.RWMutex
	token     string
	tokenHash string // hex-encoded SHA-256 of token; safe to persist / compare
	state     State
	revokedAt *time.Time
	rotatedAt *time.Time
	events    []Event
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func New(envVar string) *Manager {
	return NewWithOptions(Options{EnvVar: envVar})
}

func NewWithOptions(opts Options) *Manager {
	if opts.EnvVar == "" {
		opts.EnvVar = "SENTINELGRID_CONNECTOR_TOKEN"
	}
	if opts.SealKeyEnv == "" {
		opts.SealKeyEnv = "SENTINELGRID_CONNECTOR_SEAL_KEY"
	}
	m := &Manager{opts: opts, state: StateMissing}
	_ = m.Load()
	return m
}

func (m *Manager) record(action, detail string) {
	m.events = append(m.events, Event{At: time.Now().UTC(), Action: action, Detail: detail})
	if len(m.events) > 64 {
		m.events = m.events[len(m.events)-64:]
	}
}

func (m *Manager) Events() []Event {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Event, len(m.events))
	copy(out, m.events)
	return out
}

func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.opts.StoreDir != "" && m.isRevokeMarkerLocked() {
		m.token = ""
		m.tokenHash = ""
		m.state = StateRevoked
		now := time.Now().UTC()
		m.revokedAt = &now
		m.record("load_blocked", "revoke marker present")
		return fmt.Errorf("credentials revoked (marker present)")
	}
	tok := os.Getenv(m.opts.EnvVar)
	if tok == "" && m.opts.StoreDir != "" {
		if sealed, err := m.readSealedLocked(); err == nil {
			tok = sealed
		}
	}
	if tok == "" {
		m.token = ""
		m.tokenHash = ""
		m.state = StateMissing
		m.record("load_missing", m.opts.EnvVar)
		return fmt.Errorf("missing credential env %s", m.opts.EnvVar)
	}
	if m.state == StateRevoked {
		m.record("load_refused", "still revoked")
		return fmt.Errorf("credentials revoked; load refused until ClearRevoke")
	}
	m.token = tok
	m.tokenHash = hashToken(tok)
	m.state = StateActive
	if m.opts.StoreDir != "" {
		if err := m.writeHashLocked(m.tokenHash); err != nil {
			m.record("hash_persist_failed", err.Error())
			return fmt.Errorf("credential hash persist failed: %w", err)
		}
		if err := m.writeSealedLocked(tok); err != nil {
			m.record("seal_failed", err.Error())
			if m.opts.RequireSeal || os.Getenv("NODE_ENV") == "production" || os.Getenv("SG_CONNECTOR_ENV") == "production" {
				m.token = ""
				m.tokenHash = ""
				m.state = StateMissing
				return fmt.Errorf("production credential seal failed: %w", err)
			}
		} else {
			m.record("sealed", "ok")
		}
	}
	m.record("load", "active")
	return nil
}

// Token returns the current bearer token or error if missing/revoked.
func (m *Manager) Token() (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if err := m.authGuardLocked(); err != nil {
		return "", err
	}
	return m.token, nil
}

// TokenHash returns the hex SHA-256 fingerprint of the active token (empty if none).
func (m *Manager) TokenHash() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tokenHash
}

// Authorize reports whether presented matches the active credential via constant-time hash compare.
// Revoked / missing credentials never authorize.
func (m *Manager) Authorize(presented string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if err := m.authGuardLocked(); err != nil {
		return false
	}
	if presented == "" || m.tokenHash == "" {
		return false
	}
	want, err := hex.DecodeString(m.tokenHash)
	if err != nil {
		return false
	}
	gotSum := sha256.Sum256([]byte(presented))
	return subtle.ConstantTimeCompare(want, gotSum[:]) == 1
}

// AuthGuard fails closed unless credentials are active and non-empty.
// Outbound delivery must call this (via Token) before attaching Authorization.
func (m *Manager) AuthGuard() error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.authGuardLocked()
}

func (m *Manager) authGuardLocked() error {
	if m.opts.StoreDir != "" && m.isRevokeMarkerLocked() {
		return fmt.Errorf("credentials revoked")
	}
	if m.state == StateRevoked {
		return fmt.Errorf("credentials revoked")
	}
	if m.state != StateActive || m.token == "" || m.tokenHash == "" {
		return fmt.Errorf("credentials missing")
	}
	// Integrity: in-memory token must still match persisted/recorded hash.
	if hashToken(m.token) != m.tokenHash {
		return fmt.Errorf("credential hash mismatch")
	}
	return nil
}

func (m *Manager) State() State {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.opts.StoreDir != "" && m.isRevokeMarkerLocked() {
		return StateRevoked
	}
	return m.state
}

// Rotate reloads from env (ops updates the secret then signals rotate) and reseals.
func (m *Manager) Rotate() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.isRevokeMarkerLocked() {
		return fmt.Errorf("cannot rotate while revoke marker present")
	}
	tok := os.Getenv(m.opts.EnvVar)
	if tok == "" {
		return fmt.Errorf("rotate failed: empty %s", m.opts.EnvVar)
	}
	now := time.Now().UTC()
	prevHash := m.tokenHash
	m.token = tok
	m.tokenHash = hashToken(tok)
	m.state = StateActive
	m.rotatedAt = &now
	m.revokedAt = nil
	if m.opts.StoreDir != "" {
		if err := m.writeHashLocked(m.tokenHash); err != nil {
			m.record("rotate_hash_failed", err.Error())
			return err
		}
		if err := m.writeSealedLocked(tok); err != nil {
			m.record("rotate_seal_failed", err.Error())
			return err
		}
	}
	detail := "active"
	if prevHash != "" && prevHash != m.tokenHash {
		detail = "rotated_hash"
	}
	m.record("rotate", detail)
	return nil
}

// Revoke immediately blocks outbound auth and writes a durable revoke marker.
func (m *Manager) Revoke() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	m.token = ""
	m.tokenHash = ""
	m.state = StateRevoked
	m.revokedAt = &now
	if m.opts.StoreDir != "" {
		_ = os.MkdirAll(m.opts.StoreDir, 0o700)
		_ = os.WriteFile(m.revokePathLocked(), []byte(now.Format(time.RFC3339Nano)+"\n"), 0o600)
		_ = os.Remove(m.sealedPathLocked())
		_ = os.Remove(m.hashPathLocked())
	}
	m.record("revoke", "durable")
}

// ClearRevoke allows a subsequent Load after intentional revoke (ops recovery).
func (m *Manager) ClearRevoke() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.opts.StoreDir != "" {
		_ = os.Remove(m.revokePathLocked())
	}
	if m.state == StateRevoked {
		m.state = StateMissing
		m.revokedAt = nil
	}
	m.record("clear_revoke", "")
}

// RefreshFromDisk re-reads revoke marker / sealed material (for periodic lifecycle ticks).
func (m *Manager) RefreshFromDisk() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.opts.StoreDir == "" {
		return nil
	}
	if m.isRevokeMarkerLocked() {
		m.token = ""
		m.tokenHash = ""
		m.state = StateRevoked
		now := time.Now().UTC()
		m.revokedAt = &now
		m.record("refresh_revoked", "marker")
		return fmt.Errorf("credentials revoked")
	}
	if b, err := os.ReadFile(m.hashPathLocked()); err == nil {
		persisted := string(b)
		for len(persisted) > 0 && (persisted[len(persisted)-1] == '\n' || persisted[len(persisted)-1] == '\r') {
			persisted = persisted[:len(persisted)-1]
		}
		if m.tokenHash != "" && persisted != "" && persisted != m.tokenHash {
			m.record("refresh_hash_mismatch", "blocking")
			m.token = ""
			m.tokenHash = ""
			m.state = StateMissing
			return fmt.Errorf("persisted credential hash mismatch")
		}
		if m.tokenHash == "" && persisted != "" {
			m.tokenHash = persisted
		}
	}
	return nil
}

func (m *Manager) revokePathLocked() string {
	return filepath.Join(m.opts.StoreDir, "REVOKED")
}

func (m *Manager) sealedPathLocked() string {
	return filepath.Join(m.opts.StoreDir, "token.sealed")
}

func (m *Manager) hashPathLocked() string {
	return filepath.Join(m.opts.StoreDir, "token.sha256")
}

func (m *Manager) writeHashLocked(hexHash string) error {
	if m.opts.StoreDir == "" {
		return nil
	}
	if err := os.MkdirAll(m.opts.StoreDir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(m.hashPathLocked(), []byte(hexHash+"\n"), 0o600)
}

func (m *Manager) isRevokeMarkerLocked() bool {
	if m.opts.StoreDir == "" {
		return false
	}
	_, err := os.Stat(m.revokePathLocked())
	return err == nil
}

func (m *Manager) sealKeyLocked() ([]byte, error) {
	raw := os.Getenv(m.opts.SealKeyEnv)
	if raw == "" {
		return nil, fmt.Errorf("missing seal key env %s", m.opts.SealKeyEnv)
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}

func (m *Manager) writeSealedLocked(tok string) error {
	if m.opts.StoreDir == "" {
		return nil
	}
	key, err := m.sealKeyLocked()
	if err != nil {
		if m.opts.RequireSeal {
			return err
		}
		// Non-production: skip seal when key absent.
		if os.Getenv("SG_CONNECTOR_ENV") == "production" {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(m.opts.StoreDir, 0o700); err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	ct := gcm.Seal(nonce, nonce, []byte(tok), nil)
	return os.WriteFile(m.sealedPathLocked(), []byte(hex.EncodeToString(ct)), 0o600)
}

func (m *Manager) readSealedLocked() (string, error) {
	key, err := m.sealKeyLocked()
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(m.sealedPathLocked())
	if err != nil {
		return "", err
	}
	raw, err := hex.DecodeString(string(b))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("sealed token truncated")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
