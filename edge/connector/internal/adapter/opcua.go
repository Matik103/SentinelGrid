package adapter

import (
	"context"
	"fmt"
	"os"
	"time"
)

// OPCUAAdapter implements read-only OPC UA collection via TCP reachability probe.
// Full OPC UA session/subscription is deferred until a certified stack is approved.
// When hardware is unavailable, Collect clearly reports hardware_unavailable — never invents tags.
type OPCUAAdapter struct {
	// AllowLiveProbe enables TCP dials. When false (tests), returns stubbed without dialing.
	AllowLiveProbe bool
}

func (OPCUAAdapter) Protocol() string { return "opcua" }

func (a OPCUAAdapter) Collect(ctx context.Context, src Source) ([]Sample, error) {
	now := time.Now().UTC()
	if !a.AllowLiveProbe && os.Getenv("SG_CONNECTOR_LIVE_PROBES") != "1" {
		return []Sample{{
			Source: src.Name, Protocol: "opcua", ObservedAt: now, Scaffold: true,
			Status: "stubbed",
			Note:   fmt.Sprintf("opcua adapter ready; live probe disabled (set SG_CONNECTOR_LIVE_PROBES=1). endpoint=%s; no fabricated tags", src.Endpoint),
		}}, nil
	}
	ok, detail, err := dialEndpoint(ctx, src.Endpoint, "4840")
	if err != nil {
		return []Sample{{
			Source: src.Name, Protocol: "opcua", ObservedAt: now, Scaffold: true,
			Status: "misconfigured", Reachable: boolPtr(false),
			Note:   fmt.Sprintf("opcua endpoint misconfigured: %v", err),
		}}, nil
	}
	status := "ok"
	if !ok {
		status = "hardware_unavailable"
	}
	return []Sample{{
		Source: src.Name, Protocol: "opcua", ObservedAt: now, Scaffold: true,
		Status: status, Reachable: boolPtr(ok),
		Note:   fmt.Sprintf("opcua read-only probe: %s; no OPC UA session opened; no tag values invented", detail),
	}}, nil
}
