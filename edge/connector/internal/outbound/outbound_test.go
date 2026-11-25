package outbound

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Matik103/SentinelGrid/edge/connector/internal/buffer"
	"github.com/Matik103/SentinelGrid/edge/connector/internal/credentials"
)

func TestDryRunAcks(t *testing.T) {
	dir := t.TempDir()
	buf, err := buffer.New(filepath.Join(dir, "q"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("SG_OUT_TOK", "x")
	creds := credentials.New("SG_OUT_TOK")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	c := New(Config{BaseURL: "", IngestPath: "/v1/events/ingest"}, creds, buf, log)
	if err := c.EnqueueOrSend(context.Background(), []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	n, _ := buf.Len()
	if n != 0 {
		t.Fatalf("expected dry-run ack, len=%d", n)
	}
}

func TestRetryThenSuccess(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := hits.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	dir := t.TempDir()
	buf, err := buffer.New(filepath.Join(dir, "q"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("SG_OUT_TOK2", "secret")
	creds := credentials.New("SG_OUT_TOK2")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	c := New(Config{
		BaseURL:     srv.URL,
		IngestPath:  "/ingest",
		MaxAttempts: 5,
		BaseDelay:   5 * time.Millisecond,
		MaxDelay:    20 * time.Millisecond,
	}, creds, buf, log)

	if err := c.EnqueueOrSend(context.Background(), []byte(`{"event":1}`)); err != nil {
		t.Fatal(err)
	}
	if hits.Load() < 3 {
		t.Fatalf("hits=%d", hits.Load())
	}
	n, _ := buf.Len()
	if n != 0 {
		t.Fatalf("expected ack after success, len=%d", n)
	}
}

func TestRevokedBlocksDelivery(t *testing.T) {
	dir := t.TempDir()
	buf, _ := buffer.New(filepath.Join(dir, "q"))
	t.Setenv("SG_OUT_TOK3", "secret")
	creds := credentials.New("SG_OUT_TOK3")
	creds.Revoke()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	c := New(Config{BaseURL: "http://127.0.0.1:9", IngestPath: "/x"}, creds, buf, log)
	if err := c.EnqueueOrSend(context.Background(), []byte(`{}`)); err == nil {
		t.Fatal("expected revoke error")
	}
	n, _ := buf.Len()
	if n != 1 {
		t.Fatalf("payload should remain buffered, len=%d", n)
	}
}
