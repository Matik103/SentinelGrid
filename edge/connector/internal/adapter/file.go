package adapter

import (
	"context"
	"fmt"
	"os"
	"time"
)

// FileAdapter emits a synthetic wiring heartbeat when the endpoint path exists.
type FileAdapter struct{}

func (FileAdapter) Protocol() string { return "file" }

func (FileAdapter) Collect(_ context.Context, src Source) ([]Sample, error) {
	note := "scaffold file heartbeat; not live OT telemetry"
	status := "ok"
	reachable := true
	if src.Endpoint != "" {
		if _, err := os.Stat(src.Endpoint); err != nil {
			note = fmt.Sprintf("%s (endpoint missing: %v)", note, err)
			status = "hardware_unavailable"
			reachable = false
		}
	}
	return []Sample{{
		Source:     src.Name,
		Protocol:   "file",
		Note:       note,
		ObservedAt: time.Now().UTC(),
		Scaffold:   true,
		Status:     status,
		Reachable:  boolPtr(reachable),
	}}, nil
}
