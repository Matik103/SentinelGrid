// Package adapter defines read-only OT protocol interfaces.
// Phase 0: OPC UA / Modbus / MQTT are stubs behind these interfaces — no fake live telemetry.
package adapter

import (
	"context"
	"fmt"
	"time"
)

// Sample is an explicit scaffold reading — never labeled as live process data by adapters.
type Sample struct {
	Source    string
	Protocol  string
	Note      string
	ObservedAt time.Time
	Scaffold  bool // always true for stub adapters
}

// Source describes a configured collection endpoint.
type Source struct {
	Name     string
	Protocol string
	Endpoint string
}

// ProtocolAdapter is the contract for OT collectors. Implementations must not invent live values.
type ProtocolAdapter interface {
	Protocol() string
	// Collect returns scaffold/status samples only in Phase 0 stubs.
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
