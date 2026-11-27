import { useEffect, useState, type FormEvent } from "react";
import {
  authToken, clearPasswordRecoveryPending, isPasswordRecoveryPending,
  requestPasswordReset, resendSignupConfirmation, restoreSession,
  signInWithPassword, signOut, signUpWithPassword, updatePassword,
} from "./auth";
import {
  beginTotpChallenge, prepareMfaSession, verifyTotpChallenge,
  type MfaChallenge, type MfaFactor,
} from "./mfa";

type Props = {
  onAuthChange?: () => void;
  /** page = full signup/MFA journey; sidebar = compact account controls only */
  surface?: "page" | "sidebar";
};
type View = "signin" | "signup" | "forgot" | "reset" | "verify";

function friendlyAuthError(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password combination doesn't match. Try again or reset your password.";
  if (/email not confirmed/i.test(message)) return "Verify your email address before signing in. You can request a fresh confirmation email here.";
  if (/user already registered/i.test(message)) return "An account already exists for this email. Sign in instead, or reset your password.";
  if (/password should be at least/i.test(message)) return "Choose a longer password and try again.";
  if (/rate limit/i.test(message)) return "Too many attempts in a short time. Wait a moment before trying again.";
  if (/invalid.*totp|totp.*invalid|invalid.*(mfa|authenticator|verification)?\s*code|code.*(invalid|incorrect|wrong)/i.test(message)) {
    return "Wrong code. Try again.";
  }
  if (/friendly name|already exists/i.test(message)) {
    return "A previous authenticator setup was left unfinished. Tap Continue MFA setup to clear it and generate a fresh QR code.";
  }
  return message;
}

export function AuthPanel({ onAuthChange, surface = "page" }: Props) {
  const [view, setView] = useState<View>(() => isPasswordRecoveryPending() ? "reset" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [verifiedFactors, setVerifiedFactors] = useState<MfaFactor[]>([]);
  const signedIn = Boolean(authToken()) && !mfaPending && !mfa && !isPasswordRecoveryPending();

  useEffect(() => {
    if (isPasswordRecoveryPending()) setView("reset");
  }, []);

  useEffect(() => {
    let active = true;
    void restoreSession().then(async (session) => {
      if (!active) return;
      // Recovery: keep the choose-new-password form; do not jump into MFA.
      if (isPasswordRecoveryPending()) {
        if (!session) {
          clearPasswordRecoveryPending();
          setError("This password reset link is invalid or has expired. Request a new one.");
          setView("forgot");
        }
        return;
      }
      if (!session) return;

      // Sidebar: never auto-start MFA or call onAuthChange — the workspace gate already did that.
      if (surface === "sidebar") return;

      try {
        setMfaPending(true);
        setError(null);
        const result = await prepareMfaSession();
        if (!active) return;
        setVerifiedFactors(result.factors);
        if (result.complete) {
          setMfa(null);
          setMfaPending(false);
          onAuthChange?.();
        } else {
          setMfa(result.challenge);
        }
      } catch (err) {
        if (!active) return;
        setError(friendlyAuthError(err instanceof Error ? err.message : String(err)));
        setMfaPending(true);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [surface]);

  const run = async (event: FormEvent, action: () => Promise<void>) => {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (view === "signin" && /email not confirmed/i.test(message)) setView("verify");
      setError(friendlyAuthError(message));
    } finally { setBusy(false); }
  };

  const completePasswordAuth = async () => {
    setMfaPending(true);
    setError(null);
    const result = await prepareMfaSession();
    setVerifiedFactors(result.factors);
    if (result.complete) {
      setMfa(null);
      setMfaPending(false);
      onAuthChange?.();
    } else {
      setMfa(result.challenge);
    }
  };

  const startMfaSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await prepareMfaSession();
      setVerifiedFactors(result.factors);
      if (result.complete) {
        setMfaPending(false);
        setMfa(null);
        onAuthChange?.();
      } else {
        setMfaPending(true);
        setMfa(result.challenge);
      }
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : String(err)));
      setMfaPending(true);
    } finally {
      setBusy(false);
    }
  };

  const onVerifyMfa = async (event: FormEvent) => {
    event.preventDefault();
    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your authenticator app.");
      return;
    }
    if (!mfa) return;
    setBusy(true); setError(null);
    try {
      await verifyTotpChallenge(mfa, code);
      await restoreSession();
      setMfa(null);
      setMfaPending(false);
      setMfaCode("");
      onAuthChange?.();
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : String(err)));
    } finally { setBusy(false); }
  };

  if (mfa || mfaPending) {
    const enrollCopy = mfa?.mode === "enroll" || (!mfa && mfaPending);
    return (
      <main className="auth-experience">
        <section className="auth-story">
          <div className="auth-story-brand"><img src="/assets/sentinelgrid-logo-wordmark.png" alt="SentinelGrid" width="230" height="74" /></div>
          <div className="auth-story-copy">
            <span className="eyebrow"><i /> STEP 02 / AUTHENTICATOR</span>
            <h1>{enrollCopy ? <>Set up your<br /><span>authenticator.</span></> : <>Verify your<br /><span>identity.</span></>}</h1>
            <p>{enrollCopy
              ? "Install any TOTP app, scan the QR code, then enter the six-digit code when you are ready. There is no time pressure — your sign-in stays active until you finish or sign out."
              : "Enter the current six-digit code from your authenticator app. You can sign out and return later if you need a moment."}</p>
          </div>
        </section>
        <section className="auth-form-side">
          <div className="auth-form-card">
            <div className="auth-form-topline"><span>SECURE ACCESS</span><span>02 / MFA</span></div>
            <div className="auth-form-heading">
              <h2>{mfa?.mode === "enroll" ? "Set up authenticator" : mfa ? "Enter authenticator code" : "Preparing authenticator setup"}</h2>
              <p>{mfa?.mode === "enroll"
                ? "Take your time. Scan the code, add SentinelGrid to your app, then enter the 6-digit code below."
                : mfa
                  ? "Open your authenticator app and enter the current code."
                  : "Preparing a secure authenticator challenge. This usually takes a second."}</p>
            </div>
            {error && <div className="auth-feedback error" role="alert">{error}</div>}
            {mfa ? (
              <div className="auth-mfa">
                {mfa.mode === "enroll" && (
                  <div className="auth-mfa-setup">
                    <p>Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password, 2FAS, or another TOTP app.</p>
                    {mfa.qrCode && <img className="auth-mfa-qr" src={mfa.qrCode} alt="SentinelGrid authenticator setup QR code" />}
                    {mfa.secret && <p className="auth-mfa-secret">Can't scan it? Enter this setup key manually: <code>{mfa.secret}</code></p>}
                    <p className="auth-mfa-pace">No countdown. Finish when the code in your app is ready.</p>
                  </div>
                )}
                {mfa.mode === "challenge" && verifiedFactors.length > 1 && (
                  <label className="auth-mfa-label">Authenticator
                    <select value={mfa.factorId} disabled={busy} onChange={(event) => {
                      setBusy(true); setError(null);
                      void beginTotpChallenge(event.target.value, "challenge")
                        .then(setMfa)
                        .catch((err) => setError(friendlyAuthError(err instanceof Error ? err.message : String(err))))
                        .finally(() => setBusy(false));
                    }}>
                      {verifiedFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendlyName}</option>)}
                    </select>
                  </label>
                )}
                <form className="auth-form auth-form-modern" onSubmit={(event) => void onVerifyMfa(event)}>
                  <label>Six-digit authenticator code
                    <input type="text" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus />
                  </label>
                  <button className="auth-submit" type="submit" disabled={busy || mfaCode.length !== 6}>{busy ? "Verifying…" : mfa.mode === "enroll" ? "Verify and enable MFA" : "Verify and continue"}<span>↗</span></button>
                </form>
              </div>
            ) : (
              <div className="auth-mfa">
                <p className="auth-mfa-pace">Stay on this screen while setup prepares. If nothing appears, tap continue or sign out and retry.</p>
                <button type="button" className="auth-submit" disabled={busy} onClick={() => void startMfaSetup()}>
                  {busy ? "Preparing…" : "Continue MFA setup"}<span>↗</span>
                </button>
              </div>
            )}
            <div className="auth-form-bottom">
              <button type="button" onClick={() => void signOut().then(() => { setMfa(null); setMfaPending(false); setVerifiedFactors([]); setMfaCode(""); onAuthChange?.(); })}>Sign out</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // Sidebar account chrome lives in the top-right avatar menu.
  if (signedIn && view !== "reset") {
    if (surface === "sidebar") return null;
    return (
      <section className="auth-panel auth-panel-compact" aria-label="Account">
        {error && <p className="auth-inline-error" role="alert">{error}</p>}
      </section>
    );
  }

  const invitePending = Boolean(new URLSearchParams(window.location.search).get("invite"));
  const title = view === "signin" ? "Welcome back" : view === "signup" ? "Create your account" : view === "forgot" ? "Reset your password" : view === "reset" ? "Choose a new password" : "Check your inbox";
  const description = view === "signin" ? "Sign in to continue to your secure operations environment." :
    view === "signup" ? "Step 1 of 3: create your identity. Next you will set up an authenticator, then create or join a workspace." :
    view === "forgot" ? "We'll send a secure password reset link to your email address." :
    view === "reset" ? "Choose a new password to secure your SentinelGrid account." :
    "Your account is almost ready. Verify your email address to continue. Authenticator setup follows.";

  return (
    <main className="auth-experience">
      <section className="auth-story">
        <div className="auth-story-brand"><img src="/assets/sentinelgrid-logo-wordmark.png" alt="SentinelGrid" width="230" height="74" /></div>
        <div className="auth-story-copy">
          <span className="eyebrow"><i /> STEP 01 / IDENTITY</span>
          <h1>Know your<br /><span>system.</span><br />Secure every<br />decision.</h1>
          <p>One trusted identity. MFA-protected workspace access. A clearer operational picture across the infrastructure that matters.</p>
        </div>
        <div className="auth-story-orbit" aria-hidden="true"><span className="auth-orbit auth-orbit-a" /><span className="auth-orbit auth-orbit-b" /><span className="auth-orbit-core">SG</span><span className="auth-orbit-label auth-label-a">IDENTITY</span><span className="auth-orbit-label auth-label-b">WORKSPACE</span><span className="auth-orbit-label auth-label-c">EVIDENCE</span></div>
        <div className="auth-story-footer"><span>SECURE BY DESIGN</span><span>INFRASTRUCTURE / INTELLIGENCE / CONTROL</span></div>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-form-topline"><span>SECURE ACCESS</span><span>01 / IDENTITY</span></div>
          <div className="auth-form-heading"><h2>{title}</h2><p>{description}</p></div>
          {invitePending && <div className="auth-invite-note">You've arrived through a workspace invitation. Create or sign in to your account to continue.</div>}
          {error && <div className="auth-feedback error" role="alert">{error}</div>}
          {notice && <div className="auth-feedback success" role="status">{notice}</div>}

          {view === "signin" && <form className="auth-form auth-form-modern" onSubmit={(event) => void run(event, async () => {
            await signInWithPassword(email.trim(), password); setPassword(""); await completePasswordAuth();
          })}>
            <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" required autoFocus /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Your password" required /></label>
            <div className="auth-form-meta"><span>Protected by SentinelGrid identity</span><button type="button" className="auth-text-button" onClick={() => { setView("forgot"); setError(null); setNotice(null); }}>Forgot password?</button></div>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Authenticating…" : "Sign in securely"}<span>↗</span></button>
          </form>}

          {view === "signup" && <form className="auth-form auth-form-modern" onSubmit={(event) => void run(event, async () => {
            if (password.length < 8) throw new Error("Password should be at least 8 characters.");
            if (password !== confirmPassword) throw new Error("Your passwords do not match.");
            const result = await signUpWithPassword(email.trim(), password, name);
            setPassword(""); setConfirmPassword("");
            if (result.session) await completePasswordAuth();
            else { setView("verify"); setNotice(null); }
          })}>
            <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Full name" required maxLength={120} /></label>
            <label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" required /></label>
            <label>Create password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" minLength={8} required /></label>
            <label>Confirm password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="Repeat your password" minLength={8} required /></label>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create secure account"}<span>↗</span></button>
          </form>}

          {view === "forgot" && <form className="auth-form auth-form-modern" onSubmit={(event) => void run(event, async () => {
            await requestPasswordReset(email.trim()); setNotice("If an account exists for this address, a password reset email is on its way.");
          })}>
            <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" required autoFocus /></label>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Sending link…" : "Send reset link"}<span>↗</span></button>
          </form>}

          {view === "reset" && <form className="auth-form auth-form-modern" onSubmit={(event) => void run(event, async () => {
            if (password.length < 8) throw new Error("Password should be at least 8 characters.");
            if (password !== confirmPassword) throw new Error("Your passwords do not match.");
            await updatePassword(password);
            clearPasswordRecoveryPending();
            // End the recovery session so the user signs in fresh with the new password + MFA.
            await signOut();
            setPassword("");
            setConfirmPassword("");
            setNotice("Your password has been updated. Sign in with the new password, then complete MFA.");
            window.history.replaceState({}, "", window.location.pathname);
            setView("signin");
            onAuthChange?.();
          })}>
            <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus /></label>
            <label>Confirm new password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Updating password…" : "Update password"}<span>↗</span></button>
          </form>}

          {view === "verify" && <div className="auth-verify">
            <div className="auth-verify-icon">✉</div><strong>Verify your email</strong>
            <p>We sent a confirmation link to <b>{email}</b>. Open it on this device to activate your account. Authenticator enrollment follows verification.</p>
            <button type="button" className="auth-submit" disabled={busy} onClick={() => void run({ preventDefault() {} } as FormEvent, async () => { await resendSignupConfirmation(email.trim()); setNotice("A fresh confirmation email has been sent."); })}>{busy ? "Sending…" : "Resend confirmation email"}</button>
          </div>}

          <div className="auth-form-bottom">
            {view === "signin" && <span>New to SentinelGrid? <button type="button" onClick={() => { setView("signup"); setError(null); setNotice(null); }}>Create an account</button></span>}
            {view === "signup" && <span>Already have an account? <button type="button" onClick={() => { setView("signin"); setError(null); }}>Sign in</button></span>}
            {(view === "forgot" || view === "reset" || view === "verify") && <span><button type="button" onClick={() => { setView("signin"); setError(null); setNotice(null); }}>Back to sign in</button></span>}
          </div>
          <p className="auth-privacy-note">Journey: 1) Identity → 2) Authenticator (MFA) → 3) Workspace. Password alone is never enough for Command access.</p>
        </div>
      </section>
    </main>
  );
}
