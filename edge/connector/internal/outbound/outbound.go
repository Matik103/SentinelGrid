// Package outbound delivers buffered ingest envelopes with exponential backoff.
package outbound

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"time"

	"github.com/Matik103/SentinelGrid/edge/connector/internal/buffer"
	"github.com/Matik103/SentinelGrid/edge/connector/internal/credentials"
)

type Config struct {
	BaseURL    string
	IngestPath string
	MaxAttempts int
	BaseDelay  time.Duration
	MaxDelay   time.Duration
}

type Client struct {
	cfg    Config
	creds  *credentials.Manager
	buf    *buffer.Store
	log    *slog.Logger
	http   *http.Client
	dryRun bool
}

func New(cfg Config, creds *credentials.Manager, buf *buffer.Store, log *slog.Logger) *Client {
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 8
	}
	if cfg.BaseDelay <= 0 {
		cfg.BaseDelay = 500 * time.Millisecond
	}
	if cfg.MaxDelay <= 0 {
		cfg.MaxDelay = 30 * time.Second
	}
	return &Client{
		cfg:    cfg,
		creds:  creds,
		buf:    buf,
		log:    log,
		http:   &http.Client{Timeout: 15 * time.Second},
		dryRun: cfg.BaseURL == "",
	}
}

// EnqueueOrSend buffers the payload, then attempts immediate delivery.
func (c *Client) EnqueueOrSend(ctx context.Context, payload []byte) error {
	e, err := c.buf.Enqueue(payload)
	if err != nil {
		return err
	}
	return c.deliverOne(ctx, *e)
}

// Flush drains the durable buffer with retry/backoff.
func (c *Client) Flush(ctx context.Context) error {
	ents, err := c.buf.List()
	if err != nil {
		return err
	}
	var first error
	for _, e := range ents {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := c.deliverOne(ctx, e); err != nil {
			if first == nil {
				first = err
			}
			c.log.Warn("flush entry failed", "id", e.ID, "err", err)
		}
	}
	return first
}

func (c *Client) deliverOne(ctx context.Context, e buffer.Entry) error {
	if c.dryRun {
		// A missing API endpoint is a configuration error, never a successful delivery.
		// Keep the durable entry so it can be delivered after configuration is corrected.
		c.log.Warn("api.base_url empty; delivery disabled and event retained", "id", e.ID)
		return fmt.Errorf("event delivery disabled: api.base_url is not configured")
	}
	// Auth guard: refuse delivery when credentials are missing/revoked/mismatched.
	if err := c.creds.AuthGuard(); err != nil {
		return fmt.Errorf("outbound auth guard: %w", err)
	}
	token, err := c.creds.Token()
	if err != nil {
		return err
	}

	attemptsLeft := c.cfg.MaxAttempts - e.Attempts
	if attemptsLeft <= 0 {
		return fmt.Errorf("entry %s exceeded max attempts", e.ID)
	}

	var lastErr error
	for i := 0; i < attemptsLeft; i++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		_ = c.buf.MarkAttempt(e.ID)
		status, err := c.post(ctx, token, e.Payload)
		if err == nil && status < 300 {
			return c.buf.Ack(e.ID)
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("ingest status %d", status)
			// Do not retry hard client auth errors indefinitely beyond backoff budget.
			if status == 401 || status == 403 {
				return lastErr
			}
		}
		delay := backoff(c.cfg.BaseDelay, c.cfg.MaxDelay, e.Attempts+i)
		c.log.Warn("ingest retry", "id", e.ID, "delay", delay.String(), "err", lastErr)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return lastErr
}

func (c *Client) post(ctx context.Context, token string, payload []byte) (int, error) {
	url := c.cfg.BaseURL + c.cfg.IngestPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

func backoff(base, max time.Duration, attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	exp := float64(base) * math.Pow(2, float64(attempt))
	if exp > float64(max) {
		exp = float64(max)
	}
	// Full jitter
	j := time.Duration(rand.Int63n(int64(exp) + 1))
	if j < base/2 {
		j = base / 2
	}
	return j
}
