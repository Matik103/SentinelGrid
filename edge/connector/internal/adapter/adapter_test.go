package adapter

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestAdaptersNeverInventLiveValues(t *testing.T) {
	reg := DefaultRegistry()
	for _, proto := range []string{"opcua", "modbus", "mqtt", "file"} {
		a, err := reg.Get(proto)
		if err != nil {
			t.Fatal(err)
		}
		samples, err := a.Collect(context.Background(), Source{
			Name: "t", Protocol: proto, Endpoint: "example.invalid:9",
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
		if samples[0].Status == "" {
			t.Fatalf("%s: missing status", proto)
		}
	}
}

func TestUnknownProtocol(t *testing.T) {
	reg := DefaultRegistry()
	if _, err := reg.Get("bacnet"); err == nil {
		t.Fatal("expected error")
	}
}

func TestLiveProbeUnreachable(t *testing.T) {
	a := OPCUAAdapter{AllowLiveProbe: true}
	samples, err := a.Collect(context.Background(), Source{
		Name: "plc", Protocol: "opcua", Endpoint: "opc.tcp://127.0.0.1:1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if samples[0].Status != "hardware_unavailable" {
		t.Fatalf("status=%s note=%s", samples[0].Status, samples[0].Note)
	}
	if samples[0].Reachable == nil || *samples[0].Reachable {
		t.Fatal("expected unreachable")
	}
	if !samples[0].Scaffold {
		t.Fatal("must remain scaffold — no invented tags")
	}
}

func TestLiveProbeReachable(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, _ := ln.Accept()
		if c != nil {
			_ = c.Close()
		}
	}()
	addr := ln.Addr().String()
	a := ModbusAdapter{AllowLiveProbe: true}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	samples, err := a.Collect(ctx, Source{Name: "m", Protocol: "modbus", Endpoint: "tcp://" + addr})
	if err != nil {
		t.Fatal(err)
	}
	if samples[0].Status != "ok" || samples[0].Reachable == nil || !*samples[0].Reachable {
		t.Fatalf("status=%s note=%s", samples[0].Status, samples[0].Note)
	}
	if !samples[0].Scaffold {
		t.Fatal("connectivity probe must not claim live process telemetry")
	}
}

func TestParseHostPort(t *testing.T) {
	h, p, err := parseHostPort("opc.tcp://plc.example:4840", "4840")
	if err != nil || h != "plc.example" || p != "4840" {
		t.Fatalf("%s %s %v", h, p, err)
	}
}
