package adapter

import (
	"context"
	"fmt"
	"os"
	"time"
)

// OPCUAAdapter is a Phase 0 stub — does not open OPC UA sessions or invent tag values.
type OPCUAAdapter struct{}

func (OPCUAAdapter) Protocol() string { return "opcua" }

func (OPCUAAdapter) Collect(_ context.Context, src Source) ([]Sample, error) {
	return []Sample{{
		Source:     src.Name,
		Protocol:   "opcua",
		Note:       fmt.Sprintf("opcua adapter stub; no session to %s", src.Endpoint),
		ObservedAt: time.Now().UTC(),
		Scaffold:   true,
	}}, nil
}

// ModbusAdapter is a Phase 0 stub — no TCP/RTU reads of process registers.
type ModbusAdapter struct{}

func (ModbusAdapter) Protocol() string { return "modbus" }

func (ModbusAdapter) Collect(_ context.Context, src Source) ([]Sample, error) {
	return []Sample{{
		Source:     src.Name,
		Protocol:   "modbus",
		Note:       fmt.Sprintf("modbus adapter stub; no register poll of %s", src.Endpoint),
		ObservedAt: time.Now().UTC(),
		Scaffold:   true,
	}}, nil
}

// MQTTAdapter is a Phase 0 stub — no broker subscribe of live topics.
type MQTTAdapter struct{}

func (MQTTAdapter) Protocol() string { return "mqtt" }

func (MQTTAdapter) Collect(_ context.Context, src Source) ([]Sample, error) {
	return []Sample{{
		Source:     src.Name,
		Protocol:   "mqtt",
		Note:       fmt.Sprintf("mqtt adapter stub; no subscribe to %s", src.Endpoint),
		ObservedAt: time.Now().UTC(),
		Scaffold:   true,
	}}, nil
}

// FileAdapter emits a synthetic heartbeat when the endpoint path exists (wiring tests only).
type FileAdapter struct{}

func (FileAdapter) Protocol() string { return "file" }

func (FileAdapter) Collect(_ context.Context, src Source) ([]Sample, error) {
	note := "scaffold file heartbeat; not live OT telemetry"
	if src.Endpoint != "" {
		if _, err := os.Stat(src.Endpoint); err != nil {
			note = fmt.Sprintf("%s (endpoint missing: %v)", note, err)
		}
	}
	return []Sample{{
		Source:     src.Name,
		Protocol:   "file",
		Note:       note,
		ObservedAt: time.Now().UTC(),
		Scaffold:   true,
	}}, nil
}

// DefaultRegistry returns opcua/modbus/mqtt stubs plus file.
func DefaultRegistry() *Registry {
	return NewRegistry(
		OPCUAAdapter{},
		ModbusAdapter{},
		MQTTAdapter{},
		FileAdapter{},
	)
}
