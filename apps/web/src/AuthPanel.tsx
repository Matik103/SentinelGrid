import { useEffect, useState, type FormEvent } from "react";
import {
  authToken, requestPasswordReset, resendSignupConfirmation,
  signInWithPassword, signOut, signUpWithPassword, updatePassword,
} from "./auth";

type Props = { onAuthChange?: () => void };
type View = "signin" | "signup" | "forgot" | "reset" | "verify";

function friendlyAuthError(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password combination doesn't match. Try again or reset your password.";
  if (/email not confirmed/i.test(message)) return "Verify your email address before signing in. You can request a fresh confirmation email here.";
  if (/user already registered/i.test(message)) return "An account already exists for this email. Sign in instead, or reset your password.";
  if (/password should be at least/i.test(message)) return "Choose a longer password and try again.";
  if (/rate limit/i.test(message)) return "Too many attempts in a short time. Wait a moment before trying again.";
  return message;
}

export function AuthPanel({ onAuthChange }: Props) {
  const [view, setView] = useState<View>(() => window.location.hash.includes("type=recovery") ? "reset" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setView("reset");
  }, []);

  const run = async (event: FormEvent, action: () => Promise<void>) => {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (view === "signin" && /email not confirmed/i.test(message)) setView("verify");
      setError(friendlyAuthError(message));
    } finally { setBusy(false); }
  };

  if (authToken() && view !== "reset") return (
    <section className="auth-panel auth-panel-compact" aria-label="Account">
      <div className="auth-status"><strong>Account secured</strong><span className="mono">Identity session active</span></div>
      <button type="button" onClick={() => void signOut().then(() => onAuthChange?.()).catch((err) => setError(String(err)))} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && <p className="auth-inline-error" role="alert">{error}</p>}
    </section>
  );

  const invitePending = Boolean(new URLSearchParams(window.location.search).get("invite"));
  const title = view === "signin" ? "Welcome back" : view === "signup" ? "Create your account" : view === "forgot" ? "Reset your password" : view === "reset" ? "Choose a new password" : "Check your inbox";
  const description = view === "signin" ? "Sign in to continue to your secure operations environment." :
    view === "signup" ? "Create your identity first. Your workspace and access permissions come next." :
    view === "forgot" ? "We'll send a secure password reset link to your email address." :
    view === "reset" ? "Choose a new password to secure your SentinelGrid account." :
    "Your account is almost ready. Verify your email address to continue.";

  return (
    <main className="auth-experience">
      <section className="auth-story">
        <div className="auth-story-brand"><img src="/assets/sentinelgrid-logo-wordmark.png" alt="SentinelGrid" width="230" height="74" /></div>
        <div className="auth-story-copy">
          <span className="eyebrow"><i /> TRUSTED ACCESS / OPERATIONAL INTELLIGENCE</span>
          <h1>Know your<br /><span>system.</span><br />Secure every<br />decision.</h1>
          <p>One trusted identity. Workspace-scoped access. A clearer operational picture across the infrastructure that matters.</p>
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
            await signInWithPassword(email.trim(), password); setPassword(""); onAuthChange?.();
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
            if (result.session) onAuthChange?.();
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
            await updatePassword(password); setPassword(""); setConfirmPassword(""); setNotice("Your password has been updated. You can now continue."); window.history.replaceState({}, "", window.location.pathname); onAuthChange?.(); setView("signin");
          })}>
            <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus /></label>
            <label>Confirm new password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Updating password…" : "Update password"}<span>↗</span></button>
          </form>}

          {view === "verify" && <div className="auth-verify">
            <div className="auth-verify-icon">✉</div><strong>Verify your email</strong>
            <p>We sent a confirmation link to <b>{email}</b>. Open it on this device to activate your account. Your workspace setup will follow verification.</p>
            <button type="button" className="auth-submit" disabled={busy} onClick={() => void run({ preventDefault() {} } as FormEvent, async () => { await resendSignupConfirmation(email.trim()); setNotice("A fresh confirmation email has been sent."); })}>{busy ? "Sending…" : "Resend confirmation email"}</button>
          </div>}

          <div className="auth-form-bottom">
            {view === "signin" && <span>New to SentinelGrid? <button type="button" onClick={() => { setView("signup"); setError(null); setNotice(null); }}>Create an account</button></span>}
            {view === "signup" && <span>Already have an account? <button type="button" onClick={() => { setView("signin"); setError(null); }}>Sign in</button></span>}
            {(view === "forgot" || view === "reset" || view === "verify") && <span><button type="button" onClick={() => { setView("signin"); setError(null); setNotice(null); }}>Back to sign in</button></span>}
          </div>
          <p className="auth-privacy-note">Your account is separate from your organisation. Workspace membership determines what you can access.</p>
        </div>
      </section>
    </main>
  );
}
