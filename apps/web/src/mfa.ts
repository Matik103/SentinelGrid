import { getSupabase } from "./auth";

export type MfaChallenge = {
  mode: "enroll" | "challenge";
  factorId: string;
  challengeId: string;
  qrCode?: string;
  secret?: string;
};

export type MfaFactor = { id: string; friendlyName: string };

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

export async function beginTotpChallenge(factorId: string, mode: "enroll" | "challenge"): Promise<MfaChallenge> {
  const { data, error } = await getSupabase().auth.mfa.challenge({ factorId });
  if (error) throw error;
  return { mode, factorId, challengeId: data.id };
}

export async function beginTotpEnrollment(): Promise<MfaChallenge> {
  const { data, error } = await getSupabase().auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "SentinelGrid authenticator",
    issuer: "SentinelGrid",
  });
  if (error) throw error;
  const challenge = await beginTotpChallenge(data.id, "enroll");
  return {
    ...challenge,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Returns true when the session is already AAL2; otherwise starts enroll/challenge. */
export async function prepareMfaSession(): Promise<{ complete: boolean; challenge: MfaChallenge | null; factors: MfaFactor[] }> {
  const level = await currentAssuranceLevel();
  if (level === "aal2") return { complete: true, challenge: null, factors: [] };
  const factors = await listVerifiedTotpFactors();
  if (factors.length) {
    return { complete: false, challenge: await beginTotpChallenge(factors[0].id, "challenge"), factors };
  }
  return { complete: false, challenge: await beginTotpEnrollment(), factors };
}

export async function verifyTotpChallenge(challenge: MfaChallenge, code: string): Promise<void> {
  const { error } = await getSupabase().auth.mfa.verify({
    factorId: challenge.factorId,
    challengeId: challenge.challengeId,
    code,
  });
  if (error) throw error;
  const level = await currentAssuranceLevel();
  if (level !== "aal2") {
    throw new Error("The authenticator code was accepted, but the session did not reach the required security level. Try again.");
  }
}
