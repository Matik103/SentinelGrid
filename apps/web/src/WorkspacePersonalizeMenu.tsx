import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { canManageWorkspaceBranding, getWorkspaceBranding, uploadWorkspaceLogo } from "./api";
import { getSupabase, restoreSession, signOut } from "./auth";
import { peekCachedWorkspaceLogo } from "./workspaceLogoCache";

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
  const [logoUrl, setLogoUrl] = useState<string | null>(() =>
    organisationId ? (peekCachedWorkspaceLogo(organisationId) ?? null) : null,
  );
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
    const cached = peekCachedWorkspaceLogo(organisationId);
    setLogoUrl(cached ?? null);
    void getWorkspaceBranding(organisationId)
      .then((branding) => { if (active) setLogoUrl(branding.logoUrl); })
      .catch(() => { if (active && cached === undefined) setLogoUrl(null); });
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
      setMessage("Logo updated.");
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
        <div className="account-menu" role="dialog" aria-label="Account and workspace">
          <header className="account-menu-header">
            <p className="account-menu-name">{identityLabel}</p>
            {identity.displayName && identity.email ? (
              <p className="account-menu-meta">{identity.email}</p>
            ) : null}
            <p className="account-menu-mfa" aria-label="Account security">
              <i aria-hidden="true" />
              MFA active
            </p>
          </header>

          <div className="account-menu-workspace">
            <span className="account-menu-mark" aria-hidden="true">
              {logoUrl ? <img src={logoUrl} alt="" /> : initials(organisationName)}
            </span>
            <div className="account-menu-workspace-copy">
              <span className="account-menu-label">Workspace</span>
              <strong>{organisationName}</strong>
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
                  className="account-menu-text-action"
                  disabled={busy || signingOut || !organisationId}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? "Uploading…" : logoUrl ? "Replace" : "Upload logo"}
                </button>
              </>
            ) : null}
          </div>
          {!canManage && organisationId ? (
            <p className="account-menu-hint">Admin access required to change the logo.</p>
          ) : null}
          {!organisationId ? (
            <p className="account-menu-hint">Select a workspace first.</p>
          ) : null}

          <nav className="account-menu-links" aria-label="Account destinations">
            <NavLink to="/organisation" onClick={() => setOpen(false)}>Workspace settings</NavLink>
            <NavLink to="/users" onClick={() => setOpen(false)}>People &amp; access</NavLink>
          </nav>

          <button
            type="button"
            className="account-menu-signout"
            disabled={busy || signingOut}
            onClick={() => void handleSignOut()}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          {message ? <p className="account-menu-message" role="status">{message}</p> : null}
        </div>
      )}
    </div>
  );
}
