package adapter

import (
	"context"
	"testing"
)

func TestStubAdaptersAreScaffoldOnly(t *testing.T) {
	reg := DefaultRegistry()
	for _, proto := range []string{"opcua", "modbus", "mqtt", "file"} {
		a, err := reg.Get(proto)
		if err != nil {
			t.Fatal(err)
		}
		samples, err := a.Collect(context.Background(), Source{
			Name: "t", Protocol: proto, Endpoint: "example.invalid",
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(samples) != 1 || !samples[0].Scaffold {
			t.Fatalf("%s: expected scaffold sample", proto)
		}
		if samples[0].Protocol != proto {
			t.Fatalf("protocol mismatch")
		}
	}
}

func TestUnknownProtocol(t *testing.T) {
	reg := DefaultRegistry()
	if _, err := reg.Get("bacnet"); err == nil {
		t.Fatal("expected error")
	}
}
