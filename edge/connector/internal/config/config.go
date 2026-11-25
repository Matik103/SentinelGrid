package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	OrganisationID string           `yaml:"organisation_id"`
	ConnectorID    string           `yaml:"connector_id"`
	Mode           string           `yaml:"mode"` // poll | push
	API            APIConfig        `yaml:"api"`
	OT             OTConfig         `yaml:"ot"`
	Buffer         BufferConfig     `yaml:"buffer"`
	Retry          RetryConfig      `yaml:"retry"`
	Credentials    CredentialsConfig `yaml:"credentials"`
	Sources        []Source         `yaml:"sources"`
}

type APIConfig struct {
	BaseURL      string `yaml:"base_url"`
	IngestPath   string `yaml:"ingest_path"`
	AuthTokenEnv string `yaml:"auth_token_env"`
}

type CredentialsConfig struct {
	StoreDir   string `yaml:"store_dir"`
	SealKeyEnv string `yaml:"seal_key_env"`
	RequireSeal bool  `yaml:"require_seal"`
}

type OTConfig struct {
	// Phase 0 default: read_only. Write/control paths must be explicit and gated later.
	Access string `yaml:"access"`
}

type BufferConfig struct {
	Dir string `yaml:"dir"`
}

type RetryConfig struct {
	MaxAttempts int           `yaml:"max_attempts"`
	BaseDelayMS int           `yaml:"base_delay_ms"`
	MaxDelayMS  int           `yaml:"max_delay_ms"`
	BaseDelay   time.Duration `yaml:"-"`
	MaxDelay    time.Duration `yaml:"-"`
}

type Source struct {
	Name     string `yaml:"name"`
	Protocol string `yaml:"protocol"` // opcua | modbus | mqtt | file
	Endpoint string `yaml:"endpoint"`
}

func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return nil, err
	}
	if cfg.Mode == "" {
		cfg.Mode = "poll"
	}
	if cfg.OT.Access == "" {
		cfg.OT.Access = "read_only"
	}
	if cfg.OT.Access != "read_only" {
		return nil, fmt.Errorf("phase0 OT access must be read_only (got %q)", cfg.OT.Access)
	}
	if cfg.API.IngestPath == "" {
		cfg.API.IngestPath = "/v1/events/ingest"
	}
	if cfg.API.AuthTokenEnv == "" {
		cfg.API.AuthTokenEnv = "SENTINELGRID_CONNECTOR_TOKEN"
	}
	if cfg.OrganisationID == "" {
		return nil, fmt.Errorf("organisation_id is required")
	}
	if cfg.Buffer.Dir == "" {
		cfg.Buffer.Dir = "./.connector-buffer"
	}
	if cfg.Credentials.StoreDir == "" {
		cfg.Credentials.StoreDir = "./.connector-credentials"
	}
	if cfg.Credentials.SealKeyEnv == "" {
		cfg.Credentials.SealKeyEnv = "SENTINELGRID_CONNECTOR_SEAL_KEY"
	}
	if os.Getenv("SG_CONNECTOR_ENV") == "production" {
		cfg.Credentials.RequireSeal = true
	}
	if cfg.Retry.MaxAttempts <= 0 {
		cfg.Retry.MaxAttempts = 8
	}
	if cfg.Retry.BaseDelayMS <= 0 {
		cfg.Retry.BaseDelayMS = 500
	}
	if cfg.Retry.MaxDelayMS <= 0 {
		cfg.Retry.MaxDelayMS = 30000
	}
	cfg.Retry.BaseDelay = time.Duration(cfg.Retry.BaseDelayMS) * time.Millisecond
	cfg.Retry.MaxDelay = time.Duration(cfg.Retry.MaxDelayMS) * time.Millisecond
	return &cfg, nil
}
