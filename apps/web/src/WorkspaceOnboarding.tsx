import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiGet, apiPost } from "./api";

type PendingInvite = {
  id: string;
  organisation_id: string;
  organisation_name?: string;
  organisation_slug?: string;
  role_key?: string;
  role_name?: string;
  expires_at?: string;
};

type Props = { initialError?: string | null; onComplete: () => void; onRetry: () => void };
function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55).replace(/-$/g, "");
}

function isMfaBanner(message: string | null | undefined) {
  // Only suppress leftover MFA-setup copy — keep API timeout / latency errors visible.
  return Boolean(message && /set up or verify your authenticator|continue mfa|continue with authenticator|authenticator session expired|could not confirm your authenticator/i.test(message));
}

/** Accept pasted full invite URLs or the raw invite= token value. */
function extractInviteToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("invite")?.trim()
      || url.searchParams.get("token")?.trim()
      || trimmed;
  } catch {
    if (trimmed.includes("invite=") || trimmed.includes("token=")) {
      const query = trimmed.includes("?") ? trimmed.slice(trimmed.indexOf("?") + 1) : trimmed;
      const params = new URLSearchParams(query);
      return params.get("invite")?.trim() || params.get("token")?.trim() || trimmed;
    }
    return trimmed;
  }
}

export function WorkspaceOnboarding({ initialError, onComplete, onRetry }: Props) {
  const invitationFromUrl = new URLSearchParams(window.location.search).get("invite") ?? new URLSearchParams(window.location.search).get("token") ?? "";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [inviteToken, setInviteToken] = useState(invitationFromUrl);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [showAdvancedToken, setShowAdvancedToken] = useState(Boolean(invitationFromUrl));
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(isMfaBanner(initialError) ? null : (initialError ?? null));
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    // Ignore leftover MFA copy — this screen only appears after AAL2.
    setError(isMfaBanner(initialError) ? null : (initialError ?? null));
  }, [initialError]);

  useEffect(() => {
    let active = true;
    setPendingLoading(true);
    void apiGet<PendingInvite[]>("/v1/orgs/invites/pending-for-me")
      .then((result) => {
        if (!active) return;
        if (result.data?.length) {
          setPendingInvites(result.data);
          setShowCreate(false);
        } else {
          setPendingInvites([]);
          // No pending invite for this email — allow create as the primary path.
          setShowCreate(true);
        }
      })
      .finally(() => {
        if (active) setPendingLoading(false);
      });
    return () => { active = false; };
  }, []);

  const autoAcceptAttempted = useRef(false);
  useEffect(() => {
    // Prefer email-matched accept; also honor an invite link still in the URL.
    if (autoAcceptAttempted.current) return;
    autoAcceptAttempted.current = true;
    let active = true;
    setBusy(true);
    void (async () => {
      if (invitationFromUrl) {
        const byToken = await apiPost<unknown>("/v1/orgs/invites/accept", { token: invitationFromUrl.trim() });
        if (!active) return;
        if (!byToken.error) {
          window.history.replaceState({}, "", window.location.pathname);
          setSuccess("Invitation accepted. Opening Command…");
          onComplete();
          return;
        }
      }
      const byEmail = await apiPost<{ accepted_count?: number }>("/v1/orgs/invites/accept-mine", {});
      if (!active) return;
      if (!byEmail.error && (byEmail.data?.accepted_count ?? 0) > 0) {
        setSuccess("Invitation accepted. Opening Command…");
        onComplete();
        return;
      }
      if (invitationFromUrl && byEmail.error) {
        setError(byEmail.error.message);
      }
      setBusy(false);
    })().catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    });
    return () => { active = false; };
  }, [invitationFromUrl, onComplete]);

  async function createWorkspace(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const cleanSlug = slugify(slug);
    const result = await apiPost<{ organisation_id: string; name: string; slug: string }>("/v1/orgs/bootstrap", { name: name.trim(), slug: cleanSlug });
    setBusy(false);
    if (result.error || !result.data?.organisation_id) {
      const message = result.error?.message ?? "Workspace creation failed.";
      if (/MFA_REQUIRED|multi-factor|aal2/i.test(message) || result.error?.status === 403) {
        setError("Your authenticator session expired. Sign out, sign in again, and complete MFA before creating a workspace.");
        return;
      }
      setError(/duplicate key|unique constraint|already exists/i.test(message) ? "That workspace address is already in use. Choose another." : message);
      return;
    }
    setSuccess("Workspace created. Opening Command…");
    onComplete();
  }

  async function joinPendingInvites() {
    setBusy(true); setError(null); setSuccess(null);
    const result = await apiPost<{ accepted_count?: number }>("/v1/orgs/invites/accept-mine", {});
    setBusy(false);
    if (result.error) {
      const message = result.error.message;
      if (/MFA_REQUIRED|multi-factor|aal2/i.test(message) || result.error.status === 403) {
        setError("Your authenticator session expired. Sign out, sign in again, and complete MFA before accepting an invitation.");
        return;
      }
      setError(message);
      return;
    }
    if ((result.data?.accepted_count ?? 0) < 1) {
      setError("No pending invitation was found for your signed-in email. Open the invite link from your email, or ask your administrator to resend it.");
      return;
    }
    setSuccess("Invitation accepted. Opening Command…");
    onComplete();
  }

  async function acceptInvitation(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const token = extractInviteToken(inviteToken);
    if (token.length < 16) {
      setBusy(false);
      setError("Paste the full invite link from your email, or the invite token value.");
      return;
    }
    const result = await apiPost<unknown>("/v1/orgs/invites/accept", { token });
    setBusy(false);
    if (result.error) {
      const message = result.error.message;
      if (/MFA_REQUIRED|multi-factor|aal2/i.test(message) || result.error.status === 403) {
        setError("Your authenticator session expired. Sign out, sign in again, and complete MFA before accepting an invitation.");
        return;
      }
      setError(message);
      return;
    }
    window.history.replaceState({}, "", window.location.pathname);
    setSuccess("Invitation accepted. Opening Command…");
    onComplete();
  }

  const invitedPrimary = pendingInvites[0];
  const invitedNames = pendingInvites
    .map((row) => row.organisation_name)
    .filter((value): value is string => Boolean(value));

  return (
    <main className="workspace-onboarding">
      <header className="onboarding-header"><img src="/assets/sentinelgrid-logo-wordmark.png" alt="SentinelGrid" width="205" height="66" /><span>MFA VERIFIED <i /></span></header>
      <section className="onboarding-intro">
        <span className="eyebrow">STEP 03 / WORKSPACE</span>
        <h1>Bring your<br /><em>operations</em> together.</h1>
        <p>
          {pendingLoading
            ? "Authenticator setup is complete. Checking for invitations to your email…"
            : invitedPrimary
              ? `Authenticator setup is complete. You have a pending invitation${invitedNames.length ? ` to ${invitedNames.join(", ")}` : ""}. Join to enter Command — you do not need to create a new workspace.`
              : invitationFromUrl
                ? "Authenticator setup is complete. Accept your invitation below to enter the workspace."
                : "Authenticator setup is complete. Enter a workspace name below to open Command, or join a team with an invitation from your email."}
        </p>
      </section>
      {error && <div className="auth-feedback error" role="alert">{error}</div>}
      {success && <div className="auth-feedback success" role="status">{success}</div>}
      <div className="onboarding-grid">
        {(invitedPrimary || invitationFromUrl || !showCreate) && (
          <section className="onboarding-card onboarding-primary">
            <div className="onboarding-step">03A / TEAM ACCESS</div>
            <h2>{invitedPrimary ? `Join ${invitedPrimary.organisation_name ?? "your workspace"}` : "Join an existing workspace"}</h2>
            <p>
              {invitedPrimary
                ? `Your signed-in email was invited as ${invitedPrimary.role_name ?? "a member"}. Join now — SentinelGrid emails a secure invite link, so you should not need a raw token.`
                : "Open the invite link from your email on this device. If the link was lost after signup, we can still match a pending invite to your signed-in email."}
            </p>
            <button
              className="auth-submit"
              type="button"
              disabled={busy || pendingLoading}
              onClick={() => { void joinPendingInvites(); }}
            >
              {busy ? "Joining workspace…" : invitedPrimary ? `Join ${invitedPrimary.organisation_name ?? "workspace"}` : "Accept invitation for my email"}
              <span>↗</span>
            </button>
            {!invitedPrimary && (
              <button className="auth-text-button" type="button" onClick={() => setShowAdvancedToken((value) => !value)}>
                {showAdvancedToken ? "Hide invite link / token" : "Have an invite link or token?"}
              </button>
            )}
            {(showAdvancedToken || invitationFromUrl) && (
              <form className="auth-form auth-form-modern" onSubmit={(event) => void acceptInvitation(event)}>
                <label>Invitation link or token
                  <textarea
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    placeholder="Paste the invite link from your email, or the invite= value"
                    rows={3}
                    required
                  />
                </label>
                <button className="auth-submit secondary" type="submit" disabled={busy || inviteToken.trim().length < 16}>
                  {busy ? "Verifying invitation…" : "Accept invitation"}
                  <span>↗</span>
                </button>
              </form>
            )}
            {invitationFromUrl && <span className="onboarding-invite-detected">Invitation detected from your link</span>}
            {invitedPrimary && (
              <button className="auth-text-button" type="button" onClick={() => setShowCreate((value) => !value)}>
                {showCreate ? "Hide create workspace" : "Need to create a different workspace instead?"}
              </button>
            )}
          </section>
        )}

        {showCreate && (
          <section className={`onboarding-card ${invitedPrimary ? "" : "onboarding-primary"}`}>
            <div className="onboarding-step">{invitedPrimary ? "03B / NEW ENVIRONMENT" : "03A / NEW ENVIRONMENT"}</div>
            <h2>Create a workspace</h2>
            <p>Only use this if you are starting a new organisation — not if you were invited to an existing one.</p>
            <form className="auth-form auth-form-modern" onSubmit={(event) => void createWorkspace(event)}>
              <label>Organisation / workspace name<input value={name} onChange={(event) => { const value = event.target.value; setName(value); if (!slugEdited) setSlug(slugify(value)); }} placeholder="e.g. Acme Infrastructure" maxLength={200} required autoFocus={!invitedPrimary} /></label>
              <label>Workspace slug<div className="onboarding-slug"><span>SLUG /</span><input value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); }} placeholder="acme-infrastructure" maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></div></label>
              <div className="onboarding-admin-note"><span>◆</span><span><b>Workspace administrator</b>Your account receives the administrator role for this workspace. You can invite your operations, engineering and security teams next.</span></div>
              <button className="auth-submit" type="submit" disabled={busy || !name.trim() || slugify(slug).length < 2}>{busy ? "Registering workspace…" : "Create workspace and enter Command"}<span>↗</span></button>
            </form>
          </section>
        )}
      </div>
      {error && <button className="auth-text-button onboarding-retry" type="button" onClick={onRetry}>Retry workspace verification</button>}
      <footer className="onboarding-footer">TENANT-ISOLATED BY DESIGN <span>·</span> ACCESS CONTROLLED BY MEMBERSHIP AND ROLE</footer>
    </main>
  );
}
