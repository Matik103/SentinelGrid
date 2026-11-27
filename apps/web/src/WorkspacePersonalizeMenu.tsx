import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { canManageWorkspaceBranding, getWorkspaceBranding, uploadWorkspaceLogo } from "./api";
import { getSupabase, restoreSession, signOut } from "./auth";

type Props = {
  organisationId: string | null;
  organisationName: string;
  onBrandingChange?: () => void;
  onSignOut?: () => void;
};

type AccountIdentity = {
  email: string | null;
  displayName: string | null;
};

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "SG";
}

async function loadAccountIdentity(): Promise<AccountIdentity> {
  const session = await restoreSession();
  const user = session?.user ?? (await getSupabase().auth.getUser()).data.user;
  if (!user) return { email: null, displayName: null };
  const displayName = typeof user.user_metadata?.display_name === "string"
    ? user.user_metadata.display_name.trim()
    : "";
  return {
    email: user.email ?? null,
    displayName: displayName || null,
  };
}

export function WorkspacePersonalizeMenu({ organisationId, organisationName, onBrandingChange, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [identity, setIdentity] = useState<AccountIdentity>({ email: null, displayName: null });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    setMessage(null);
    void loadAccountIdentity()
      .then((value) => { if (active) setIdentity(value); })
      .catch(() => { if (active) setIdentity({ email: null, displayName: null }); });
    if (!organisationId) {
      setLogoUrl(null);
      setCanManage(false);
      return () => { active = false; };
    }
    void getWorkspaceBranding(organisationId)
      .then((branding) => { if (active) setLogoUrl(branding.logoUrl); })
      .catch(() => { if (active) setLogoUrl(null); });
    void canManageWorkspaceBranding(organisationId)
      .then((allowed) => { if (active) setCanManage(allowed); })
      .catch(() => { if (active) setCanManage(false); });
    return () => { active = false; };
  }, [organisationId]);

  useEffect(() => {
    if (!open) return;
    void loadAccountIdentity().then(setIdentity).catch(() => undefined);
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function onLogoSelected(file: File | undefined) {
    if (!file || !organisationId) return;
    setBusy(true);
    setMessage(null);
    try {
      const branding = await uploadWorkspaceLogo(organisationId, file);
      setLogoUrl(branding.logoUrl);
      setMessage("Logo saved. It now appears in the workspace switcher.");
      onBrandingChange?.();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not upload the workspace logo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setMessage(null);
    try {
      await signOut();
      setOpen(false);
      onSignOut?.();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not sign out.");
      setSigningOut(false);
    }
  }

  const identityLabel = identity.displayName || identity.email || "Signed in";

  return (
    <div className="workspace-personalize" ref={rootRef}>
      <button
        type="button"
        className="user-orb user-orb-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Account and workspace"
        onClick={() => setOpen((value) => !value)}
      >
        {logoUrl
          ? <img src={logoUrl} alt="" />
          : initials(organisationName)}
      </button>
      {open && (
        <div className="workspace-personalize-panel" role="dialog" aria-label="Account and workspace">
          <div className="workspace-personalize-header">
            <span className="eyebrow">ACCOUNT</span>
            <strong>{identityLabel}</strong>
            {identity.displayName && identity.email && (
              <span className="workspace-personalize-email">{identity.email}</span>
            )}
            <div className="workspace-personalize-security" aria-label="Account security">
              <strong>Account secured</strong>
              <span className="mono">MFA session active (AAL2)</span>
            </div>
          </div>

          <div className="workspace-personalize-section">
            <span className="eyebrow">ACTIVE WORKSPACE</span>
            <div className="workspace-personalize-workspace">
              <div className="workspace-personalize-preview">
                {logoUrl
                  ? <img src={logoUrl} alt="Current workspace logo" />
                  : <span aria-hidden="true">{initials(organisationName)}</span>}
              </div>
              <div className="workspace-personalize-workspace-copy">
                <strong>{organisationName}</strong>
                <p>Personalise the logo shown in the workspace switcher.</p>
              </div>
            </div>
            {canManage ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  hidden
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void onLogoSelected(file);
                  }}
                />
                <button
                  type="button"
                  className="btn workspace-personalize-upload"
                  disabled={busy || signingOut || !organisationId}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
                </button>
              </>
            ) : (
              <p className="workspace-personalize-hint">
                {organisationId
                  ? "Workspace administrator access is required to change the logo."
                  : "Select a workspace first."}
              </p>
            )}
          </div>

          <nav className="workspace-personalize-links" aria-label="Account destinations">
            <NavLink to="/organisation" onClick={() => setOpen(false)}>Workspace settings</NavLink>
            <NavLink to="/users" onClick={() => setOpen(false)}>People &amp; access</NavLink>
          </nav>

          <button
            type="button"
            className="btn secondary workspace-personalize-signout"
            disabled={busy || signingOut}
            onClick={() => void handleSignOut()}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          {message && <p className="workspace-personalize-message" role="status">{message}</p>}
        </div>
      )}
    </div>
  );
}
