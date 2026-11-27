import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAllowedImageFile, detectImageMimeFromBytes } from "./imageMagic";

describe("detectImageMimeFromBytes", () => {
  it("detects JPEG / PNG / WEBP / AVIF headers", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    const avif = Uint8Array.from([
      0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ]);
    assert.equal(detectImageMimeFromBytes(jpeg), "image/jpeg");
    assert.equal(detectImageMimeFromBytes(png), "image/png");
    assert.equal(detectImageMimeFromBytes(webp), "image/webp");
    assert.equal(detectImageMimeFromBytes(avif), "image/avif");
  });

  it("rejects non-image bytes", () => {
    const html = new TextEncoder().encode("<!doctype html>....");
    assert.equal(detectImageMimeFromBytes(html), null);
  });
});

describe("assertAllowedImageFile", () => {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

  it("accepts matching PNG bytes and type", async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new File([bytes], "logo.png", { type: "image/png" });
    assert.equal(await assertAllowedImageFile(file, allowed), "image/png");
  });

  it("rejects MIME spoofing when declared type is allowed but bytes disagree", async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new File([bytes], "logo.jpg", { type: "image/jpeg" });
    await assert.rejects(() => assertAllowedImageFile(file, allowed), /do not match/);
  });

  it("rejects non-image content even with an allowed declared type", async () => {
    const file = new File(["<!doctype html>"], "logo.png", { type: "image/png" });
    await assert.rejects(() => assertAllowedImageFile(file, allowed), /JPEG, PNG, WebP or AVIF/);
  });
});
