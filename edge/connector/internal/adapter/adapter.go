// Package adapter defines read-only OT protocol interfaces and implementations.
// Implementations may probe connectivity; they must never invent live process values.
package adapter

import (
	"context"
	"fmt"
	"time"
)

// Sample is a collection outcome. Scaffold=true means no live process telemetry.
type Sample struct {
	Source     string
	Protocol   string
	Note       string
	ObservedAt time.Time
	Scaffold   bool // true when no authenticated live readings were taken
	Reachable  *bool
	Status     string // ok | unreachable | hardware_unavailable | misconfigured | stubbed
}

// Source describes a configured collection endpoint.
type Source struct {
	Name     string
	Protocol string
	Endpoint string
}

// ProtocolAdapter is the contract for OT collectors (read-only).
type ProtocolAdapter interface {
	Protocol() string
	// Collect returns status/probe samples. Must not fabricate process values.
	Collect(ctx context.Context, src Source) ([]Sample, error)
}

// Registry maps protocol name → adapter.
type Registry struct {
	byName map[string]ProtocolAdapter
}

func NewRegistry(adapters ...ProtocolAdapter) *Registry {
	r := &Registry{byName: make(map[string]ProtocolAdapter)}
	for _, a := range adapters {
		r.byName[a.Protocol()] = a
	}
	return r
}

func (r *Registry) Get(protocol string) (ProtocolAdapter, error) {
	a, ok := r.byName[protocol]
	if !ok {
		return nil, fmt.Errorf("no adapter for protocol %q", protocol)
	}
	return a, nil
}

func boolPtr(v bool) *bool { return &v }
