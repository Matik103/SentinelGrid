import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "./bootstrap";

export type InvitePeek =
  | {
      found: true;
      email: string;
      status: "pending";
      expires_at?: string;
      organisation_name?: string | null;
    }
  | {
      found: false;
      reason?: string;
      status?: string;
      email?: string;
    };

/** Read invite token / optional emailed address from the current URL. */
export function readInviteFromLocation(search = window.location.search): {
  token: string | null;
  emailHint: string | null;
} {
  const params = new URLSearchParams(search);
  const token = params.get("invite")?.trim() || params.get("token")?.trim() || null;
  const emailHint = params.get("email")?.trim().toLowerCase() || null;
  return { token: token && token.length >= 16 ? token : null, emailHint };
}

/** Best-effort public peek of a pending invitation (anon-capable RPC). */
export async function peekOrganisationInvitation(token: string): Promise<InvitePeek> {
  const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/peek_organisation_invitation`, {
    method: "POST",
    headers: {
      apikey: PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${PUBLIC_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ p_token: token }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error((await response.text()).slice(0, 200) || "Could not look up this invitation.");
  }
  const payload = (await response.json()) as InvitePeek;
  if (!payload || typeof payload !== "object" || typeof payload.found !== "boolean") {
    return { found: false, reason: "invalid_response" };
  }
  return payload;
}
