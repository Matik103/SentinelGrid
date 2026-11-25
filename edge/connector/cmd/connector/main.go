package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/Matik103/SentinelGrid/edge/connector/internal/config"
	"github.com/Matik103/SentinelGrid/edge/connector/internal/runtime"
)

func main() {
	cfgPath := flag.String("config", "config.example.yaml", "path to connector config")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		slog.Error("load config", "err", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	rt := runtime.New(cfg, logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("sentinelgrid edge connector starting",
		"mode", cfg.Mode,
		"ot_access", cfg.OT.Access,
		"org_id", cfg.OrganisationID,
	)

	if err := rt.Run(ctx); err != nil && err != context.Canceled {
		slog.Error("runtime exited", "err", err)
		os.Exit(1)
	}
	fmt.Println("connector stopped cleanly")
}
