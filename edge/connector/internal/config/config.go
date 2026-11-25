package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	OrganisationID string   `yaml:"organisation_id"`
	ConnectorID    string   `yaml:"connector_id"`
	Mode           string   `yaml:"mode"` // poll | push
	API            APIConfig `yaml:"api"`
	OT             OTConfig  `yaml:"ot"`
	Sources        []Source  `yaml:"sources"`
}

type APIConfig struct {
	BaseURL     string `yaml:"base_url"`
	IngestPath  string `yaml:"ingest_path"`
	AuthTokenEnv string `yaml:"auth_token_env"`
}

type OTConfig struct {
	// Phase 0 default: read_only. Write/control paths must be explicit and gated later.
	Access string `yaml:"access"`
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
	return &cfg, nil
}
