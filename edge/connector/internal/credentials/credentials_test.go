package credentials

import (
	"os"
	"testing"
)

func TestLifecycle(t *testing.T) {
	env := "SG_TEST_CONNECTOR_TOKEN"
	t.Setenv(env, "tok-1")
	m := New(env)
	if m.State() != StateActive {
		t.Fatalf("state=%s", m.State())
	}
	tok, err := m.Token()
	if err != nil || tok != "tok-1" {
		t.Fatalf("token=%q err=%v", tok, err)
	}

	os.Setenv(env, "tok-2")
	if err := m.Rotate(); err != nil {
		t.Fatal(err)
	}
	tok, err = m.Token()
	if err != nil || tok != "tok-2" {
		t.Fatalf("after rotate token=%q err=%v", tok, err)
	}

	m.Revoke()
	if _, err := m.Token(); err == nil {
		t.Fatal("expected revoke error")
	}
	if err := m.Load(); err == nil {
		t.Fatal("load while revoked should fail")
	}
	m.ClearRevoke()
	if err := m.Load(); err != nil {
		t.Fatal(err)
	}
	if m.State() != StateActive {
		t.Fatalf("state=%s", m.State())
	}
}

func TestMissing(t *testing.T) {
	env := "SG_TEST_MISSING_TOKEN"
	os.Unsetenv(env)
	m := New(env)
	if m.State() != StateMissing {
		t.Fatalf("state=%s", m.State())
	}
	if _, err := m.Token(); err == nil {
		t.Fatal("expected missing")
	}
}
