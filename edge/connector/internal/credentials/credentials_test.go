package credentials

import (
	"os"
	"path/filepath"
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

func TestSealedStoreAndDurableRevoke(t *testing.T) {
	dir := t.TempDir()
	env := "SG_TEST_SEAL_TOKEN"
	keyEnv := "SG_TEST_SEAL_KEY"
	t.Setenv(env, "super-secret-token")
	t.Setenv(keyEnv, "unit-test-seal-key-material")
	m := NewWithOptions(Options{
		EnvVar: env, StoreDir: dir, SealKeyEnv: keyEnv, RequireSeal: true,
	})
	if m.State() != StateActive {
		t.Fatalf("state=%s", m.State())
	}
	if _, err := os.Stat(filepath.Join(dir, "token.sealed")); err != nil {
		t.Fatalf("expected sealed file: %v", err)
	}

	m.Revoke()
	if _, err := os.Stat(filepath.Join(dir, "REVOKED")); err != nil {
		t.Fatal("expected revoke marker")
	}
	if _, err := m.Token(); err == nil {
		t.Fatal("token after revoke")
	}

	// New manager should see durable revoke without ClearRevoke.
	m2 := NewWithOptions(Options{EnvVar: env, StoreDir: dir, SealKeyEnv: keyEnv, RequireSeal: true})
	if m2.State() != StateRevoked {
		t.Fatalf("expected durable revoked, got %s", m2.State())
	}
	m2.ClearRevoke()
	if err := m2.Load(); err != nil {
		t.Fatal(err)
	}
	tok, err := m2.Token()
	if err != nil || tok != "super-secret-token" {
		t.Fatalf("tok=%q err=%v", tok, err)
	}
	ev := m2.Events()
	if len(ev) == 0 {
		t.Fatal("expected lifecycle events")
	}
}

func TestProductionSealRequired(t *testing.T) {
	dir := t.TempDir()
	env := "SG_TEST_PROD_TOKEN"
	t.Setenv(env, "tok")
	t.Setenv("SG_CONNECTOR_ENV", "production")
	os.Unsetenv("SG_TEST_PROD_SEAL")
	m := NewWithOptions(Options{
		EnvVar: env, StoreDir: dir, SealKeyEnv: "SG_TEST_PROD_SEAL", RequireSeal: true,
	})
	// Load should fail closed without seal key in production/require mode.
	if err := m.Load(); err == nil {
		// Constructor already called Load; force again after clearing
		t.Fatal("expected seal failure")
	}
}

func TestHashedAuthGuardAndAuthorize(t *testing.T) {
	dir := t.TempDir()
	env := "SG_TEST_HASH_TOKEN"
	keyEnv := "SG_TEST_HASH_SEAL"
	t.Setenv(env, "alpha-token")
	t.Setenv(keyEnv, "hash-seal-key")
	m := NewWithOptions(Options{
		EnvVar: env, StoreDir: dir, SealKeyEnv: keyEnv, RequireSeal: true,
	})
	if err := m.AuthGuard(); err != nil {
		t.Fatalf("auth guard: %v", err)
	}
	if m.TokenHash() == "" {
		t.Fatal("expected token hash")
	}
	if _, err := os.Stat(filepath.Join(dir, "token.sha256")); err != nil {
		t.Fatalf("expected hash file: %v", err)
	}
	if !m.Authorize("alpha-token") {
		t.Fatal("Authorize should accept matching token")
	}
	if m.Authorize("wrong-token") {
		t.Fatal("Authorize must reject wrong token")
	}

	os.Setenv(env, "beta-token")
	if err := m.Rotate(); err != nil {
		t.Fatal(err)
	}
	if m.Authorize("alpha-token") {
		t.Fatal("old token must not authorize after rotate")
	}
	if !m.Authorize("beta-token") {
		t.Fatal("new token must authorize after rotate")
	}

	m.Revoke()
	if err := m.AuthGuard(); err == nil {
		t.Fatal("auth guard must fail after revoke")
	}
	if m.Authorize("beta-token") {
		t.Fatal("Authorize must fail after revoke")
	}
	if _, err := os.Stat(filepath.Join(dir, "token.sha256")); !os.IsNotExist(err) {
		t.Fatalf("hash file should be removed on revoke, err=%v", err)
	}
}
