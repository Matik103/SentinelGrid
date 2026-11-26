package adapter

import (
	"context"
	"fmt"
	"os"
	"time"
)

// ModbusAdapter implements read-only Modbus TCP via connectivity probe.
// Register maps and normalize.Envelope emission require documented hardware maps;
// until then Collect returns Scaffold status only — never invented process values.
type ModbusAdapter struct {
	AllowLiveProbe bool
}

func (ModbusAdapter) Protocol() string { return "modbus" }

func (a ModbusAdapter) Collect(ctx context.Context, src Source) ([]Sample, error) {
	now := time.Now().UTC()
	if !a.AllowLiveProbe && os.Getenv("SG_CONNECTOR_LIVE_PROBES") != "1" {
		return []Sample{{
			Source: src.Name, Protocol: "modbus", ObservedAt: now, Scaffold: true,
			Status: "stubbed",
			Note:   fmt.Sprintf("modbus adapter ready; live probe disabled (set SG_CONNECTOR_LIVE_PROBES=1). endpoint=%s; no fabricated registers", src.Endpoint),
		}}, nil
	}
	ok, detail, err := dialEndpoint(ctx, src.Endpoint, "502")
	if err != nil {
		return []Sample{{
			Source: src.Name, Protocol: "modbus", ObservedAt: now, Scaffold: true,
			Status: "misconfigured", Reachable: boolPtr(false),
			Note:   fmt.Sprintf("modbus endpoint misconfigured: %v", err),
		}}, nil
	}
	status := "ok"
	if !ok {
		status = "hardware_unavailable"
	}
	return []Sample{{
		Source: src.Name, Protocol: "modbus", ObservedAt: now, Scaffold: true,
		Status: status, Reachable: boolPtr(ok),
		Note:   fmt.Sprintf("modbus read-only probe: %s; no register poll; no values invented", detail),
	}}, nil
}
