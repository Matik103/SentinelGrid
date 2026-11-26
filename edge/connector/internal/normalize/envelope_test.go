package normalize

import (
	"testing"
	"time"
)

func TestValidateCanonicalUnit(t *testing.T) {
	err := Validate(Envelope{
		SchemaVersion:  SchemaVersion,
		MetricKey:      "active_power_kw",
		Value:          1.2,
		Unit:           "W",
		MeasuredAt:     time.Now().UTC(),
		Quality:        "good",
		Source:         "modbus-1",
		SourceEventID:  "seq-1",
		Classification: "real",
		FacilityID:     "11111111-1111-1111-1111-111111111111",
	})
	if err == nil {
		t.Fatal("expected unit mismatch rejection")
	}
}

func TestValidateAcceptsGoodEnvelope(t *testing.T) {
	err := Validate(Envelope{
		SchemaVersion:  SchemaVersion,
		MetricKey:      "active_power_kw",
		Value:          18.42,
		Unit:           "kW",
		MeasuredAt:     time.Now().UTC(),
		Quality:        "good",
		Source:         "modbus-meter-01",
		SourceEventID:  "meter-01:1",
		Classification: "real",
		FacilityID:     "11111111-1111-1111-1111-111111111111",
	})
	if err != nil {
		t.Fatal(err)
	}
}
