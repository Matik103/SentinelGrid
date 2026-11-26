import { useEffect, useState, type FormEvent } from "react";
import {
  authModeLabel,
  authToken,
  organisationId,
  restoreSession,
  setOrganisationId,
  signInWithPassword,
  signOut,
} from "./auth";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [org, setOrg] = useState(organisationId() ?? "");
  const [status, setStatus] = useState(authModeLabel());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(authToken());

  useEffect(() => {
    void restoreSession().then(() => setStatus(authModeLabel()));
  }, []);

  const onSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email.trim(), password);
      if (org.trim()) setOrganisationId(org.trim());
      setStatus(authModeLabel());
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      setStatus(authModeLabel());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSaveOrg = (event: FormEvent) => {
    event.preventDefault();
    setOrganisationId(org.trim() || null);
    setStatus(authModeLabel());
  };

  return (
    <div className="auth-panel" aria-label="Authentication">
      <div className="auth-brand">
        <img
          className="auth-wordmark"
          src="/assets/sentinelgrid-logo-wordmark.png"
          alt="SentinelGrid"
          width={160}
          height={51}
        />
      </div>
      <div className="auth-status">
        <strong>{status}</strong>
        <span className="mono">{organisationId() ? `org ${organisationId()}` : "no organisation selected"}</span>
      </div>
      {error && <div className="empty">{error}</div>}
      {signedIn ? (
        <div className="auth-actions">
          <form onSubmit={onSaveOrg} className="auth-form">
            <label>
              Organisation ID
              <input
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                placeholder="UUID"
                autoComplete="off"
              />
            </label>
            <button type="submit" disabled={busy}>Save organisation</button>
          </form>
          <button type="button" onClick={() => void onSignOut()} disabled={busy}>
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void onSignIn(e)} className="auth-form">
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            Organisation ID
            <input
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="UUID"
              autoComplete="off"
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {import.meta.env.DEV && (
            <p className="auth-dev-hint">
              Local only: `VITE_DEV_ACCESS_TOKEN` / `VITE_DEV_ORGANISATION_ID` still work. Production builds require Supabase Auth.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
