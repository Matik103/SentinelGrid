# SentinelGrid multi-factor authentication

## Design

SentinelGrid uses Supabase Auth's built-in TOTP authenticator factors. This does not require a paid SMS provider or Supabase Advanced MFA. Users can use an authenticator app such as Google Authenticator, Microsoft Authenticator, or 2FAS.

- Password sign-in is followed by TOTP enrollment for users without a verified factor, or a TOTP challenge for users who already enrolled.
- The browser only reports successful MFA after Supabase confirms the session has reached assurance level `aal2`.
- `SupabaseAuthGuard` validates the access token with Supabase Auth, checks that the signed token subject matches the validated user, and rejects sessions below `aal2`.
- A forward-only migration adds restrictive AAL2 policies to every existing RLS-enabled table in the `public` schema. Existing tenant and role policies remain in place and are still required.
- Service-role requests bypass PostgreSQL RLS. They are protected by the API guard only when they enter through guarded API routes; never expose the service-role key to a client.

## Local development

The local Supabase configuration enables TOTP enrollment and verification under `[auth.mfa.totp]`. Restart the local Supabase stack after changing Auth configuration.

## Recovery

Supabase's application MFA API does not issue recovery codes. Enroll a second authenticator on a separately stored device using **Add backup authenticator** before relying on MFA for day-to-day access.

If every enrolled authenticator is lost, do not bypass the API guard or disable RLS. Account recovery requires an administrator to verify the account holder through an out-of-band identity process, record the recovery action in the organisation's security/audit process, and then remove the lost factor through the trusted Supabase Auth administration path so the user can enroll again. Do not perform an MFA reset solely on the basis of an email request.

## Rollout and verification

This code change is not, by itself, proof that the hosted project is configured or that production users have enrolled. Before enforcing it in a live environment:

1. Confirm TOTP enrollment and verification are enabled in the hosted Supabase Auth settings.
2. Apply the new migration through the normal reviewed migration process.
3. Test a new account, an existing account with TOTP, an AAL1 direct API request, and an AAL1 direct RLS request.
4. Test two enrolled authenticators and the documented lost-device recovery procedure.
5. Confirm the GitHub quality gate and Vercel preview deployment before any production release.

Do not mark MFA rollout complete until hosted configuration, migration application, recovery operations, and live verification have evidence.
