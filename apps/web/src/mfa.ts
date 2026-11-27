import { getSupabase, syncAccessToken } from "./auth";

export type MfaChallenge = {
  mode: "enroll" | "challenge";
  factorId: string;
  challengeId: string;
  qrCode?: string;
  secret?: string;
};

export type MfaFactor = { id: string; friendlyName: string };

const DEFAULT_FRIENDLY_NAME = "SentinelGrid authenticator";

export async function currentAssuranceLevel(): Promise<"aal1" | "aal2" | string> {
  const { data, error } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data.currentLevel ?? "aal1";
}

export async function listVerifiedTotpFactors(): Promise<MfaFactor[]> {
  const { data, error } = await getSupabase().auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp ?? [])
    .filter((factor) => factor.status === "verified")
    .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name || "Authenticator app" }));
}

/** Unverified TOTP rows left behind by interrupted enrollments (stuck VERIFYING, refresh, etc.). */
async function listUnverifiedTotpFactors(): Promise<Array<{ id: string; friendlyName: string }>> {
  const { data, error } = await getSupabase().auth.mfa.listFactors();
  if (error) throw error;
  const all = data.all ?? [];
  return all
    .filter((factor) => factor.factor_type === "totp" && factor.status === "unverified")
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name || DEFAULT_FRIENDLY_NAME,
    }));
}

async function removeUnverifiedTotpFactors(): Promise<number> {
  const stale = await listUnverifiedTotpFactors();
  let removed = 0;
  for (const factor of stale) {
    const { error } = await getSupabase().auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      console.warn("Failed to remove unverified MFA factor", factor.id, error.message);
      continue;
    }
    removed += 1;
  }
  return removed;
}

export async function beginTotpChallenge(factorId: string, mode: "enroll" | "challenge"): Promise<MfaChallenge> {
  const { data, error } = await getSupabase().auth.mfa.challenge({ factorId });
  if (error) throw error;
  return { mode, factorId, challengeId: data.id };
}

export async function beginTotpEnrollment(): Promise<MfaChallenge> {
  // Prior incomplete setups leave an unverified factor with the same friendly name.
  // Supabase then rejects a second enroll — clear those first, then enroll cleanly.
  await removeUnverifiedTotpFactors();

  let friendlyName = DEFAULT_FRIENDLY_NAME;
  let enrolled = await getSupabase().auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
    issuer: "SentinelGrid",
  });

  if (enrolled.error && /friendly name|already exists/i.test(enrolled.error.message)) {
    // One more cleanup pass, then a unique name so enrollment can always proceed.
    await removeUnverifiedTotpFactors();
    friendlyName = `SentinelGrid authenticator ${Date.now()}`;
    enrolled = await getSupabase().auth.mfa.enroll({
      factorType: "totp",
      friendlyName,
      issuer: "SentinelGrid",
    });
  }
  if (enrolled.error) throw enrolled.error;

  const challenge = await beginTotpChallenge(enrolled.data.id, "enroll");
  return {
    ...challenge,
    qrCode: enrolled.data.totp.qr_code,
    secret: enrolled.data.totp.secret,
  };
}

/** Returns true when the session is already AAL2; otherwise starts enroll/challenge. */
export async function prepareMfaSession(): Promise<{ complete: boolean; challenge: MfaChallenge | null; factors: MfaFactor[] }> {
  const level = await currentAssuranceLevel();
  if (level === "aal2") return { complete: true, challenge: null, factors: await listVerifiedTotpFactors() };
  const factors = await listVerifiedTotpFactors();
  if (factors.length) {
    return { complete: false, challenge: await beginTotpChallenge(factors[0].id, "challenge"), factors };
  }
  return { complete: false, challenge: await beginTotpEnrollment(), factors: [] };
}

export async function verifyTotpChallenge(challenge: MfaChallenge, code: string): Promise<void> {
  const { error } = await getSupabase().auth.mfa.verify({
    factorId: challenge.factorId,
    challengeId: challenge.challengeId,
    code,
  });
  if (error) throw error;

  // MFA verify rotates the session to AAL2 — persist the fresh access token immediately
  // so Nest calls after this do not still send the old AAL1 JWT from localStorage.
  const { data, error: sessionError } = await getSupabase().auth.getSession();
  if (sessionError) throw sessionError;
  syncAccessToken(data.session);

  const level = await currentAssuranceLevel();
  if (level !== "aal2") {
    throw new Error("The authenticator code was accepted, but the session did not reach the required security level. Try again.");
  }
}
