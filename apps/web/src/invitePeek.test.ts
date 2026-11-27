import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readInviteFromLocation } from "./invitePeek";

describe("readInviteFromLocation", () => {
  it("reads invite token and emailed address hint", () => {
    const result = readInviteFromLocation(
      "?invite=0a5d9496584f6a9fa9fa7c5de1ba800ababfebad86c0b35c1227c51933a53f10&email=HaitiLE509%40gmail.com",
    );
    assert.equal(result.token, "0a5d9496584f6a9fa9fa7c5de1ba800ababfebad86c0b35c1227c51933a53f10");
    assert.equal(result.emailHint, "haitile509@gmail.com");
  });

  it("rejects short tokens", () => {
    assert.equal(readInviteFromLocation("?invite=short").token, null);
  });
});
