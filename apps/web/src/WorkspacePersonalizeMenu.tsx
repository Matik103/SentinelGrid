import { useEffect, useRef, useState } from "react";
import { canManageWorkspaceBranding, getWorkspaceBranding, uploadWorkspaceLogo } from "./api";

type Props = {
  organisationId: string | null;
  organisationName: string;
  onBrandingChange?: () => void;
};

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "SG";
}

export function WorkspacePersonalizeMenu({ organisationId, organisationName, onBrandingChange }: Props) {
  const [open, setOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    setMessage(null);
    if (!organisationId) {
      setLogoUrl(null);
      setCanManage(false);
      return;
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

  return (
    <div className="workspace-personalize" ref={rootRef}>
      <button
        type="button"
        className="user-orb user-orb-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Personalise workspace"
        onClick={() => setOpen((value) => !value)}
      >
        {logoUrl
          ? <img src={logoUrl} alt="" />
          : initials(organisationName)}
      </button>
      {open && (
        <div className="workspace-personalize-panel" role="dialog" aria-label="Personalise workspace">
          <div className="workspace-personalize-header">
            <span className="eyebrow">PERSONALISE</span>
            <strong>{organisationName}</strong>
            <p>Add a logo for this workspace. It shows in the left switcher when you change workspaces.</p>
          </div>
          <div className="workspace-personalize-preview">
            {logoUrl
              ? <img src={logoUrl} alt="Current workspace logo" />
              : <span aria-hidden="true">{initials(organisationName)}</span>}
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
                disabled={busy || !organisationId}
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
          {message && <p className="workspace-personalize-message" role="status">{message}</p>}
        </div>
      )}
    </div>
  );
}
