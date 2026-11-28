import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatApiErrorMessage } from "./apiErrors.ts";

describe("formatApiErrorMessage", () => {
  it("extracts Nest JSON message bodies", () => {
    assert.equal(
      formatApiErrorMessage('{"message":"Missing permission: user.manage","error":"Forbidden","statusCode":403}'),
      "Missing permission: user.manage",
    );
  });

  it("keeps plain text and falls back when empty", () => {
    assert.equal(formatApiErrorMessage("Sign in required"), "Sign in required");
    assert.equal(formatApiErrorMessage(""), "Request failed");
    assert.equal(formatApiErrorMessage(null), "Request failed");
  });
});
