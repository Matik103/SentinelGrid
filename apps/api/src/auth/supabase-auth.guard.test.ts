import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { SupabaseAuthGuard } from "./supabase-auth.guard.js";
import type { SupabaseAdminService } from "../common/supabase-admin.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function jwt(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

function makeContext(authorization?: string) {
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: authorization ? { authorization } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeGuard(result: { data: { user: { id: string; email?: string } | null }; error: unknown }) {
  const admin = {
    client: { auth: { getUser: async () => result } },
  } as unknown as SupabaseAdminService;
  return new SupabaseAuthGuard(admin);
}

test("rejects requests without a bearer token", async () => {
  const { context } = makeContext();
  const guard = makeGuard({ data: { user: null }, error: null });
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
});

test("rejects tokens Supabase Auth cannot validate", async () => {
  const { context } = makeContext(`Bearer ${jwt({ sub: USER_ID, aal: "aal2" })}`);
  const guard = makeGuard({ data: { user: null }, error: new Error("invalid") });
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
});

test("rejects a valid AAL1 session with an explicit MFA_REQUIRED response", async () => {
  const token = jwt({ sub: USER_ID, aal: "aal1" });
  const { context } = makeContext(`Bearer ${token}`);
  const guard = makeGuard({ data: { user: { id: USER_ID } }, error: null });
  await assert.rejects(
    guard.canActivate(context),
    (error: unknown) => error instanceof ForbiddenException
      && (error.getResponse() as { code?: string }).code === "MFA_REQUIRED",
  );
});

test("accepts a Supabase-validated AAL2 session and attaches its user", async () => {
  const token = jwt({ sub: USER_ID, aal: "aal2" });
  const { context, request } = makeContext(`Bearer ${token}`);
  const guard = makeGuard({ data: { user: { id: USER_ID, email: "operator@example.test" } }, error: null });
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(request.user, {
    id: USER_ID,
    email: "operator@example.test",
    accessToken: token,
  });
});

test("rejects a token whose subject does not match the validated Supabase user", async () => {
  const token = jwt({ sub: "22222222-2222-4222-8222-222222222222", aal: "aal2" });
  const { context } = makeContext(`Bearer ${token}`);
  const guard = makeGuard({ data: { user: { id: USER_ID } }, error: null });
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
});
