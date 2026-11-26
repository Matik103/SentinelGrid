import { useEffect, useState, type FormEvent } from "react";
import { authModeLabel, authToken, restoreSession, signInWithPassword, signOut } from "./auth";

type Props = { onAuthChange?: () => void };

export function AuthPanel({ onAuthChange }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      setStatus(authModeLabel());
      setPassword("");
      onAuthChange?.();
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
      onAuthChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-panel" aria-label="Authentication">
      <div className="auth-brand">
        <img className="auth-wordmark" src="/assets/sentinelgrid-logo-wordmark.png" alt="SentinelGrid" width={160} height={51} />
      </div>
      <div className="auth-status">
        <strong>{signedIn ? "Account connected" : status}</strong>
        <span className="mono">{signedIn ? "Workspace access is managed above" : "Sign in to access your organisations"}</span>
      </div>
      {error && <div className="inline-notice warning" role="alert">{error}</div>}
      {signedIn ? (
        <div className="auth-actions">
          <button type="button" onClick={() => void onSignOut()} disabled={busy}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void onSignIn(event)} className="auth-form">
          <label>Email
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
          </label>
          <label>Password
            <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {import.meta.env.DEV && <p className="auth-dev-hint">Local development may use VITE_DEV_ACCESS_TOKEN. Workspace access is still resolved from your memberships.</p>}
        </form>
      )}
    </div>
  );
}
