package adapter

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

// MQTTAdapter implements read-only MQTT broker reachability probe.
// No subscribe/publish of fabricated telemetry topics.
type MQTTAdapter struct {
	AllowLiveProbe bool
}

func (MQTTAdapter) Protocol() string { return "mqtt" }

func (a MQTTAdapter) Collect(ctx context.Context, src Source) ([]Sample, error) {
	now := time.Now().UTC()
	if !a.AllowLiveProbe && os.Getenv("SG_CONNECTOR_LIVE_PROBES") != "1" {
		return []Sample{{
			Source: src.Name, Protocol: "mqtt", ObservedAt: now, Scaffold: true,
			Status: "stubbed",
			Note:   fmt.Sprintf("mqtt adapter ready; live probe disabled (set SG_CONNECTOR_LIVE_PROBES=1). endpoint=%s; no fabricated topics", src.Endpoint),
		}}, nil
	}
	defaultPort := "1883"
	ep := strings.ToLower(src.Endpoint)
	if strings.HasPrefix(ep, "mqtts://") || strings.HasPrefix(ep, "ssl://") || strings.HasPrefix(ep, "tls://") {
		defaultPort = "8883"
	}
	ok, detail, err := dialEndpoint(ctx, src.Endpoint, defaultPort)
	if err != nil {
		return []Sample{{
			Source: src.Name, Protocol: "mqtt", ObservedAt: now, Scaffold: true,
			Status: "misconfigured", Reachable: boolPtr(false),
			Note:   fmt.Sprintf("mqtt endpoint misconfigured: %v", err),
		}}, nil
	}
	status := "ok"
	if !ok {
		status = "hardware_unavailable"
	}
	return []Sample{{
		Source: src.Name, Protocol: "mqtt", ObservedAt: now, Scaffold: true,
		Status: status, Reachable: boolPtr(ok),
		Note:   fmt.Sprintf("mqtt read-only probe: %s; no broker subscribe; no payload invented", detail),
	}}, nil
}
