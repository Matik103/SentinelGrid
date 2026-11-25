package adapter

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"
)

// dialEndpoint performs a read-only TCP connectivity probe. No protocol payload is invented.
func dialEndpoint(ctx context.Context, endpoint string, defaultPort string) (reachable bool, detail string, err error) {
	host, port, err := parseHostPort(endpoint, defaultPort)
	if err != nil {
		return false, "", err
	}
	d := net.Dialer{Timeout: 3 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return false, fmt.Sprintf("tcp dial %s:%s failed: %v", host, port, err), nil
	}
	_ = conn.Close()
	return true, fmt.Sprintf("tcp reachable %s:%s (read-only probe; no process values read)", host, port), nil
}

func parseHostPort(endpoint, defaultPort string) (host, port string, err error) {
	ep := strings.TrimSpace(endpoint)
	if ep == "" {
		return "", "", fmt.Errorf("empty endpoint")
	}
	// Support opc.tcp://host:4840, tcp://host:502, mqtts://host:8883, host:port, host
	if strings.Contains(ep, "://") {
		u, perr := url.Parse(ep)
		if perr != nil {
			return "", "", perr
		}
		host = u.Hostname()
		port = u.Port()
		if host == "" {
			return "", "", fmt.Errorf("endpoint missing host: %s", ep)
		}
		if port == "" {
			port = defaultPort
		}
		return host, port, nil
	}
	if strings.Contains(ep, ":") {
		h, p, perr := net.SplitHostPort(ep)
		if perr != nil {
			return "", "", perr
		}
		return h, p, nil
	}
	return ep, defaultPort, nil
}
