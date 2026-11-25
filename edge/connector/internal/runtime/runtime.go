package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/Matik103/SentinelGrid/edge/connector/internal/config"
)

// Runtime is the Phase 0 edge connector scaffold.
// It does not fabricate live OT readings; file protocol can emit declared sample envelopes for wiring tests.
type Runtime struct {
	cfg    *config.Config
	log    *slog.Logger
	client *http.Client
}

func New(cfg *config.Config, log *slog.Logger) *Runtime {
	return &Runtime{
		cfg: cfg,
		log: log,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (r *Runtime) Run(ctx context.Context) error {
	r.log.Info("ot access locked", "access", r.cfg.OT.Access)
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// One startup tick for connectivity self-check (no invented process values).
	if err := r.tick(ctx); err != nil {
		r.log.Warn("startup tick", "err", err)
	}

	for {
		select {
		case <-ctx.Done():
			return context.Canceled
		case <-ticker.C:
			if err := r.tick(ctx); err != nil {
				r.log.Warn("poll tick", "err", err)
			}
		}
	}
}

func (r *Runtime) tick(ctx context.Context) error {
	for _, src := range r.cfg.Sources {
		switch src.Protocol {
		case "file":
			if err := r.emitFileHeartbeat(ctx, src); err != nil {
				return err
			}
		case "opcua", "modbus", "mqtt":
			r.log.Info("protocol scaffold only — no live OT session opened",
				"protocol", src.Protocol,
				"endpoint", src.Endpoint,
				"ot_access", r.cfg.OT.Access,
			)
		default:
			r.log.Warn("unknown protocol", "protocol", src.Protocol)
		}
	}
	return nil
}

func (r *Runtime) emitFileHeartbeat(ctx context.Context, src config.Source) error {
	// Explicit scaffold heartbeat — classification synthetic so it is never mistaken for live OT.
	body := map[string]any{
		"organisation_id": r.cfg.OrganisationID,
		"connector_id":    nullIfEmpty(r.cfg.ConnectorID),
		"event_type":      "connector.heartbeat",
		"occurred_at":     time.Now().UTC().Format(time.RFC3339Nano),
		"source":          src.Name,
		"source_event_id": fmt.Sprintf("heartbeat-%d", time.Now().Unix()),
		"schema_version":  "0.1.0",
		"normalised": map[string]any{
			"protocol": src.Protocol,
			"note":     "scaffold heartbeat; not live OT telemetry",
		},
		"classification": "synthetic",
		"data_quality":   "unknown",
		"clock_quality":  "unknown",
	}
	return r.postIngest(ctx, body)
}

func (r *Runtime) postIngest(ctx context.Context, body map[string]any) error {
	if r.cfg.API.BaseURL == "" {
		r.log.Info("api.base_url empty; dry-run ingest", "event_type", body["event_type"])
		return nil
	}
	token := os.Getenv(r.cfg.API.AuthTokenEnv)
	if token == "" {
		return fmt.Errorf("missing auth token env %s", r.cfg.API.AuthTokenEnv)
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	url := r.cfg.API.BaseURL + r.cfg.API.IngestPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ingest status %d", resp.StatusCode)
	}
	r.log.Info("ingest ok", "status", resp.StatusCode)
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
