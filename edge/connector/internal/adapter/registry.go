package adapter

import "os"

// DefaultRegistry returns production adapters for opcua/modbus/mqtt/file.
// Live TCP probes require SG_CONNECTOR_LIVE_PROBES=1 (or AllowLiveProbe on unit tests).
func DefaultRegistry() *Registry {
	live := os.Getenv("SG_CONNECTOR_LIVE_PROBES") == "1"
	return NewRegistry(
		OPCUAAdapter{AllowLiveProbe: live},
		ModbusAdapter{AllowLiveProbe: live},
		MQTTAdapter{AllowLiveProbe: live},
		FileAdapter{},
	)
}
