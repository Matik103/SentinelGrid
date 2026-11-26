// Package normalize defines the versioned energy measurement envelope for OT adapters.
// Adapters must not invent process values; only verified hardware readings may be classified real.
package normalize

import (
	"fmt"
	"time"
)

const SchemaVersion = "1.0.0"

// Canonical metric keys match public.energy_measurements.metric_key CHECK.
var CanonicalUnits = map[string]string{
	"active_power_kw":      "kW",
	"apparent_power_kva":   "kVA",
	"reactive_power_kvar":  "kvar",
	"energy_kwh":           "kWh",
	"voltage_v":            "V",
	"current_a":            "A",
	"frequency_hz":         "Hz",
	"power_factor":         "1",
	"temperature_c":        "°C",
	"humidity_pct":         "%",
	"fuel_consumption_lph": "L/h",
	"fuel_level_pct":       "%",
	"battery_soc_pct":      "%",
	"battery_power_kw":     "kW",
	"cooling_capacity_kw":  "kW",
	"flow_rate_m3_h":       "m³/h",
	"pressure_kpa":         "kPa",
	"pue":                  "ratio",
}

// Envelope is the connector → API normalised measurement shape.
type Envelope struct {
	SchemaVersion string                 `json:"schema_version"`
	MetricKey     string                 `json:"metric_key"`
	Value         float64                `json:"value"`
	Unit          string                 `json:"unit"`
	MeasuredAt    time.Time              `json:"measured_at"`
	Quality       string                 `json:"quality"`
	Source        string                 `json:"source"`
	SourceEventID string                 `json:"source_event_id"`
	Classification string                `json:"classification"`
	FacilityID    string                 `json:"facility_id"`
	AssetID       string                 `json:"asset_id,omitempty"`
	DeviceID      string                 `json:"device_id,omitempty"`
	SensorID      string                 `json:"sensor_id,omitempty"`
	Metadata      map[string]any         `json:"metadata,omitempty"`
}

// Validate rejects unknown metrics, unit mismatches, and empty identity fields.
// It never converts incompatible units.
func Validate(e Envelope) error {
	if e.SchemaVersion != "" && e.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported schema_version %q", e.SchemaVersion)
	}
	unit, ok := CanonicalUnits[e.MetricKey]
	if !ok {
		return fmt.Errorf("unknown metric_key %q", e.MetricKey)
	}
	if e.Unit != unit {
		return fmt.Errorf("unit for %s must be %s; refusing silent conversion", e.MetricKey, unit)
	}
	if e.Source == "" || e.SourceEventID == "" {
		return fmt.Errorf("source and source_event_id are required")
	}
	if e.FacilityID == "" {
		return fmt.Errorf("facility_id is required")
	}
	switch e.Classification {
	case "real", "simulated", "replayed", "synthetic":
	default:
		return fmt.Errorf("invalid classification %q", e.Classification)
	}
	switch e.Quality {
	case "good", "uncertain", "poor", "unknown", "":
	default:
		return fmt.Errorf("invalid quality %q", e.Quality)
	}
	if e.MeasuredAt.IsZero() {
		return fmt.Errorf("measured_at is required")
	}
	return nil
}
