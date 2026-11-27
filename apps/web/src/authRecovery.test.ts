import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accessTokenHasRecoveryAmr,
  amrIncludesRecovery,
  urlIndicatesPasswordRecovery,
} from "./authRecovery";

function jwtWithAmr(amr: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ amr, sub: "user" })).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("authRecovery helpers", () => {
  it("detects recovery AMR entries", () => {
    assert.equal(amrIncludesRecovery([{ method: "recovery", timestamp: 1 }]), true);
    assert.equal(amrIncludesRecovery(["recovery"]), true);
    assert.equal(amrIncludesRecovery([{ method: "password" }, { method: "totp" }]), false);
    assert.equal(amrIncludesRecovery(null), false);
  });

  it("reads recovery AMR from an access token payload", () => {
    assert.equal(accessTokenHasRecoveryAmr(jwtWithAmr([{ method: "recovery" }])), true);
    assert.equal(accessTokenHasRecoveryAmr(jwtWithAmr([{ method: "password" }])), false);
    assert.equal(accessTokenHasRecoveryAmr("not-a-jwt"), false);
  });

  it("detects recovery intent from hash and query variants", () => {
    assert.equal(urlIndicatesPasswordRecovery("#access_token=x&type=recovery", ""), true);
    assert.equal(urlIndicatesPasswordRecovery("", "?reset=1"), true);
    assert.equal(urlIndicatesPasswordRecovery("", "?type=recovery&code=abc"), true);
    assert.equal(urlIndicatesPasswordRecovery("#type=signup", "?invite=1"), false);
  });
});
