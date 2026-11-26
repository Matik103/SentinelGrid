import { useEffect, useState, type FormEvent } from "react";
import { authModeLabel, authToken, getSupabase, restoreSession, signInWithPassword, signOut } from "./auth";

type Props = { onAuthChange?: () => void };
type MfaChallenge = {
  mode: "enroll" | "challenge";
  factorId: string;
  challengeId: string;
  qrCode?: string;
  secret?: string;
};
type MfaFactor = { id: string; friendlyName: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function AuthPanel({ onAuthChange }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(authModeLabel());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [verifiedFactors, setVerifiedFactors] = useState<MfaFactor[]>([]);
  const signedIn = Boolean(authToken()) && !mfaPending;

  async function beginChallenge(factorId: string, mode: "enroll" | "challenge") {
    const { data, error: challengeError } = await getSupabase().auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    setMfa({ mode, factorId, challengeId: data.id });
    setMfaCode("");
  }

  async function beginEnrollment() {
    const { data, error: enrollError } = await getSupabase().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "SentinelGrid authenticator",
      issuer: "SentinelGrid",
    });
    if (enrollError) throw enrollError;
    await beginChallenge(data.id, "enroll");
    setMfa((current) => current ? {
      ...current,
      mode: "enroll",
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    } : current);
  }

  async function prepareMfa(): Promise<boolean> {
    setMfaPending(true);
    const supabase = getSupabase();
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.currentLevel === "aal2") {
      setMfa(null);
      setMfaPending(false);
      return true;
    }

    const { data: factorData, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const factors = (factorData.totp ?? [])
      .filter((factor) => factor.status === "verified")
      .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name || "Authenticator app" }));
    setVerifiedFactors(factors);

    if (factors.length) {
      await beginChallenge(factors[0].id, "challenge");
    } else {
      await beginEnrollment();
    }
    return false;
  }

  useEffect(() => {
    let active = true;
    void restoreSession().then(async (session) => {
      if (!active) return;
      setStatus(authModeLabel());
      if (!session) return;
      try {
        const complete = await prepareMfa();
        if (active && complete) onAuthChange?.();
      } catch (err) {
        if (active) setError(errorMessage(err));
      }
    }).catch((err) => {
      if (active) setError(errorMessage(err));
    });
    return () => { active = false; };
  }, []);

  const onSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email.trim(), password);
      setStatus(authModeLabel());
      setPassword("");
      const complete = await prepareMfa();
      if (complete) onAuthChange?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onVerifyMfa = async (event: FormEvent) => {
    event.preventDefault();
    const code = mfaCode.trim();
    if (!/^\\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your authenticator app.");
      return;
    }
    if (!mfa) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await getSupabase().auth.mfa.verify({
        factorId: mfa.factorId,
        challengeId: mfa.challengeId,
        code,
      });
      if (verifyError) throw verifyError;
      const { data: assurance, error: assuranceError } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== "aal2") {
        throw new Error("The authenticator code was accepted, but the session did not reach the required security level. Try again.");
      }
      await restoreSession();
      setMfa(null);
      setMfaPending(false);
      setMfaCode("");
      setStatus(authModeLabel());
      onAuthChange?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onChooseFactor = async (factorId: string) => {
    setBusy(true);
    setError(null);
    try {
      await beginChallenge(factorId, "challenge");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onAddBackupAuthenticator = async () => {
    setBusy(true);
    setError(null);
    try {
      await beginEnrollment();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      setMfa(null);
      setMfaPending(false);
      setVerifiedFactors([]);
      setMfaCode("");
      setStatus(authModeLabel());
      onAuthChange?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-panel" aria-label="Authentication">
      <div className="auth-status">
        <strong>{mfa ? (mfa.mode === "enroll" ? "Set up multi-factor authentication" : "Verify your identity") : mfaPending ? "Multi-factor authentication required" : signedIn ? "Account connected" : status}</strong>
        <span className="mono">{mfa ? "SentinelGrid requires a verified authenticator before workspace access." : mfaPending ? "Complete authenticator verification to continue." : signedIn ? "Workspace access is protected by MFA" : "Sign in to access your workspaces"}</span>
      </div>
      {error && <div className="inline-notice warning" role="alert">{error}</div>}

      {mfa ? (
        <div className="auth-mfa">
          {mfa.mode === "enroll" && (
            <div className="auth-mfa-setup">
              <p>Scan this QR code with Google Authenticator, Microsoft Authenticator, 2FAS, or another TOTP app.</p>
              {mfa.qrCode && <img className="auth-mfa-qr" src={mfa.qrCode} alt="SentinelGrid authenticator setup QR code" />}
              {mfa.secret && <p className="auth-mfa-secret">Can't scan it? Enter this setup key manually: <code>{mfa.secret}</code></p>}
            </div>
          )}
          {mfa.mode === "challenge" && verifiedFactors.length > 1 && (
            <label className="auth-mfa-label">Authenticator
              <select value={mfa.factorId} disabled={busy} onChange={(event) => void onChooseFactor(event.target.value)}>
                {verifiedFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendlyName}</option>)}
              </select>
            </label>
          )}
          <form className="auth-form" onSubmit={(event) => void onVerifyMfa(event)}>
            <label>Six-digit authenticator code
              <input type="text" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\\D/g, "").slice(0, 6))} />
            </label>
            <button type="submit" disabled={busy || mfaCode.length !== 6}>{busy ? "Verifying…" : mfa.mode === "enroll" ? "Verify and enable MFA" : "Verify and continue"}</button>
          </form>
          <button type="button" className="btn secondary" onClick={() => void onSignOut()} disabled={busy}>Sign out</button>
        </div>
      ) : mfaPending ? (
        <div className="auth-actions">
          <button type="button" onClick={() => { setBusy(true); setError(null); void prepareMfa().catch((err) => setError(errorMessage(err))).finally(() => setBusy(false)); }} disabled={busy}>{busy ? "Preparing…" : "Continue MFA setup"}</button>
          <button type="button" className="btn secondary" onClick={() => void onSignOut()} disabled={busy}>Sign out</button>
        </div>
      ) : signedIn ? (
        <div className="auth-actions">
          <button type="button" className="btn secondary" onClick={() => void onAddBackupAuthenticator()} disabled={busy}>{busy ? "Preparing…" : "Add backup authenticator"}</button>
          <button type="button" onClick={() => void onSignOut()} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
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
          {import.meta.env.DEV && <p className="auth-dev-hint">Local development may use VITE_DEV_ACCESS_TOKEN. Production access always requires a verified Supabase MFA session.</p>}
        </form>
      )}
    </div>
  );
}
