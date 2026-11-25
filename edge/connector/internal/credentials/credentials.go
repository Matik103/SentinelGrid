// Package credentials manages connector auth token lifecycle hooks.
// Phase 0: tokens come from env; rotate/revoke are hooks for ops without inventing vault crypto.
package credentials

import (
	"fmt"
	"os"
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

// Manager loads a bearer token from an env var and exposes lifecycle hooks.
type Manager struct {
	envVar string
	mu     sync.RWMutex
	token  string
	state  State
	revokedAt *time.Time
	rotatedAt *time.Time
}

func New(envVar string) *Manager {
	m := &Manager{envVar: envVar, state: StateMissing}
	_ = m.Load()
	return m
}

func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	tok := os.Getenv(m.envVar)
	if tok == "" {
		m.token = ""
		m.state = StateMissing
		return fmt.Errorf("missing credential env %s", m.envVar)
	}
	m.token = tok
	if m.state == StateRevoked {
		return fmt.Errorf("credentials revoked; load refused until clear revoke")
	}
	m.state = StateActive
	return nil
}

// Token returns the current bearer token or error if missing/revoked.
func (m *Manager) Token() (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.state == StateRevoked {
		return "", fmt.Errorf("credentials revoked")
	}
	if m.token == "" {
		return "", fmt.Errorf("credentials missing")
	}
	return m.token, nil
}

func (m *Manager) State() State {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

// Rotate reloads from env (ops updates the secret then signals rotate).
func (m *Manager) Rotate() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	tok := os.Getenv(m.envVar)
	if tok == "" {
		return fmt.Errorf("rotate failed: empty %s", m.envVar)
	}
	now := time.Now().UTC()
	m.token = tok
	m.state = StateRotated
	m.rotatedAt = &now
	m.revokedAt = nil
	// After successful rotate, treat as active for delivery.
	m.state = StateActive
	return nil
}

// Revoke immediately blocks outbound auth until a later Load/Rotate after ops clears revoke intent.
func (m *Manager) Revoke() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	m.token = ""
	m.state = StateRevoked
	m.revokedAt = &now
}

// ClearRevoke allows a subsequent Load after intentional revoke (ops recovery).
func (m *Manager) ClearRevoke() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == StateRevoked {
		m.state = StateMissing
		m.revokedAt = nil
	}
}
