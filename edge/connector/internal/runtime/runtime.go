package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/Matik103/SentinelGrid/edge/connector/internal/adapter"
	"github.com/Matik103/SentinelGrid/edge/connector/internal/buffer"
	"github.com/Matik103/SentinelGrid/edge/connector/internal/config"
	"github.com/Matik103/SentinelGrid/edge/connector/internal/credentials"
	"github.com/Matik103/SentinelGrid/edge/connector/internal/outbound"
)

// Runtime is the Phase 0 edge connector: durable buffer, retry/backoff, credential hooks,
// read-only OT, and protocol adapters (stubs for opcua/modbus/mqtt).
type Runtime struct {
	cfg     *config.Config
	log     *slog.Logger
	creds   *credentials.Manager
	buf     *buffer.Store
	out     *outbound.Client
	adapters *adapter.Registry
}

func New(cfg *config.Config, log *slog.Logger) (*Runtime, error) {
	creds := credentials.NewWithOptions(credentials.Options{
		EnvVar:      cfg.API.AuthTokenEnv,
		StoreDir:    cfg.Credentials.StoreDir,
		SealKeyEnv:  cfg.Credentials.SealKeyEnv,
		RequireSeal: cfg.Credentials.RequireSeal,
	})
	buf, err := buffer.New(cfg.Buffer.Dir)
	if err != nil {
		return nil, err
	}
	out := outbound.New(outbound.Config{
		BaseURL:     cfg.API.BaseURL,
		IngestPath:  cfg.API.IngestPath,
		MaxAttempts: cfg.Retry.MaxAttempts,
		BaseDelay:   cfg.Retry.BaseDelay,
		MaxDelay:    cfg.Retry.MaxDelay,
	}, creds, buf, log)
	return &Runtime{
		cfg:      cfg,
		log:      log,
		creds:    creds,
		buf:      buf,
		out:      out,
		adapters: adapter.DefaultRegistry(),
	}, nil
}

func (r *Runtime) Credentials() *credentials.Manager { return r.creds }

func (r *Runtime) Run(ctx context.Context) error {
	r.log.Info("ot access locked", "access", r.cfg.OT.Access)
	r.log.Info("durable buffer ready", "dir", r.cfg.Buffer.Dir)

	// Drain any leftover buffered envelopes from prior runs.
	if err := r.out.Flush(ctx); err != nil {
		r.log.Warn("startup flush", "err", err)
	}

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	if err := r.tick(ctx); err != nil {
		r.log.Warn("startup tick", "err", err)
	}

	for {
		select {
		case <-ctx.Done():
			_ = r.out.Flush(context.Background())
			return context.Canceled
		case <-ticker.C:
			if err := r.creds.RefreshFromDisk(); err != nil {
				r.log.Warn("credential lifecycle", "err", err)
			}
			if err := r.tick(ctx); err != nil {
				r.log.Warn("poll tick", "err", err)
			}
			if err := r.out.Flush(ctx); err != nil {
				r.log.Warn("flush", "err", err)
			}
		}
	}
}

func (r *Runtime) tick(ctx context.Context) error {
	for _, src := range r.cfg.Sources {
		a, err := r.adapters.Get(src.Protocol)
		if err != nil {
			r.log.Warn("unknown protocol", "protocol", src.Protocol)
			continue
		}
		samples, err := a.Collect(ctx, adapter.Source{
			Name: src.Name, Protocol: src.Protocol, Endpoint: src.Endpoint,
		})
		if err != nil {
			return err
		}
		for _, s := range samples {
			if !s.Scaffold {
				return fmt.Errorf("adapter %s returned non-scaffold sample; refusing", src.Protocol)
			}
			if err := r.emitScaffold(ctx, s); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Runtime) emitScaffold(ctx context.Context, s adapter.Sample) error {
	body := map[string]any{
		"connector_id":    nullIfEmpty(r.cfg.ConnectorID),
		"event_type":      "connector.heartbeat",
		"occurred_at":     s.ObservedAt.UTC().Format(time.RFC3339Nano),
		"source":          s.Source,
		"source_event_id": fmt.Sprintf("heartbeat-%s-%d", s.Protocol, s.ObservedAt.UnixNano()),
		"schema_version":  "0.1.0",
		"normalised": map[string]any{
			"protocol":  s.Protocol,
			"note":      s.Note,
			"scaffold":  true,
			"status":    s.Status,
			"reachable": s.Reachable,
			"ot_access": "read_only",
		},
		"classification": "synthetic",
		"data_quality":   "unknown",
		"clock_quality":  "unknown",
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return r.out.EnqueueOrSend(ctx, payload)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
