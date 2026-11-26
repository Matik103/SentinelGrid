import { useState, type FormEvent } from "react";
import { apiPost } from "./api";

type Props = { initialError?: string | null; onComplete: () => void; onRetry: () => void };
function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55).replace(/-$/g, "");
}

export function WorkspaceOnboarding({ initialError, onComplete, onRetry }: Props) {
  const invitationFromUrl = new URLSearchParams(window.location.search).get("invite") ?? new URLSearchParams(window.location.search).get("token") ?? "";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [inviteToken, setInviteToken] = useState(invitationFromUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [success, setSuccess] = useState<string | null>(null);

  async function createWorkspace(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const cleanSlug = slugify(slug);
    const result = await apiPost<{ organisation_id: string; name: string; slug: string }>("/v1/orgs/bootstrap", { name: name.trim(), slug: cleanSlug });
    setBusy(false);
    if (result.error || !result.data?.organisation_id) {
      const message = result.error?.message ?? "Workspace creation failed.";
      setError(/duplicate key|unique constraint|already exists/i.test(message) ? "That workspace address is already in use. Choose another." : message);
      return;
    }
    onComplete();
  }

  async function acceptInvitation(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const result = await apiPost<unknown>("/v1/orgs/invites/accept", { token: inviteToken.trim() });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    window.history.replaceState({}, "", window.location.pathname);
    setSuccess("Invitation accepted. Loading your workspace access…");
    onComplete();
  }

  return (
    <main className="workspace-onboarding">
      <header className="onboarding-header"><img src="/assets/sentinelgrid-logo-wordmark.png" alt="SentinelGrid" width="205" height="66" /><span>IDENTITY VERIFIED <i /></span></header>
      <section className="onboarding-intro"><span className="eyebrow">WORKSPACE REGISTRATION / STEP 02</span><h1>Bring your<br /><em>operations</em> together.</h1><p>Your account is ready. Create the workspace for the organisation whose infrastructure you manage, or accept an invitation from an existing team.</p></section>
      {(error || initialError) && <div className="auth-feedback error" role="alert">{error ?? initialError}</div>}
      {success && <div className="auth-feedback success" role="status">{success}</div>}
      <div className="onboarding-grid">
        <section className="onboarding-card onboarding-primary">
          <div className="onboarding-step">01 / NEW ENVIRONMENT</div><h2>Create a workspace</h2><p>Register your organisation's operational environment. You'll become its first workspace administrator.</p>
          <form className="auth-form auth-form-modern" onSubmit={(event) => void createWorkspace(event)}>
            <label>Organisation / workspace name<input value={name} onChange={(event) => { const value = event.target.value; setName(value); if (!slugEdited) setSlug(slugify(value)); }} placeholder="e.g. Acme Infrastructure" maxLength={200} required /></label>
            <label>Workspace slug<div className="onboarding-slug"><span>SLUG /</span><input value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); }} placeholder="acme-infrastructure" maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></div></label>
            <div className="onboarding-admin-note"><span>◆</span><span><b>Workspace administrator</b>Your account receives the administrator role for this workspace. You can invite your operations, engineering and security teams next.</span></div>
            <button className="auth-submit" type="submit" disabled={busy || !name.trim() || slugify(slug).length < 2}>{busy ? "Registering workspace…" : "Create workspace"}<span>↗</span></button>
          </form>
        </section>
        <section className="onboarding-card">
          <div className="onboarding-step">02 / TEAM ACCESS</div><h2>Join an existing workspace</h2><p>Already invited by an administrator? Use the secure invitation token from your email.</p>
          <form className="auth-form auth-form-modern" onSubmit={(event) => void acceptInvitation(event)}>
            <label>Invitation token<textarea value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="Paste your invitation token" rows={3} required /></label>
            <button className="auth-submit secondary" type="submit" disabled={busy || inviteToken.trim().length < 16}>{busy ? "Verifying invitation…" : "Accept invitation"}<span>↗</span></button>
          </form>
          {invitationFromUrl && <span className="onboarding-invite-detected">Invitation detected from your link</span>}
        </section>
      </div>
      {initialError && <button className="auth-text-button onboarding-retry" type="button" onClick={onRetry}>Retry workspace verification</button>}
      <footer className="onboarding-footer">TENANT-ISOLATED BY DESIGN <span>·</span> ACCESS CONTROLLED BY MEMBERSHIP AND ROLE</footer>
    </main>
  );
}
