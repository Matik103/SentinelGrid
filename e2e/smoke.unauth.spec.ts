import { expect, test } from "@playwright/test";

test.describe("Phase 0 signed-out smoke (E2E-01*)", () => {
  test("E2E-01 landing shows brand and sign-in", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole("img", { name: /SentinelGrid/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i }).or(page.getByRole("link", { name: /Sign in/i })).first()).toBeVisible();
  });

  test("E2E-01b sign-in form has no raw Nest JSON banner", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText('"statusCode":403');
    await expect(page.locator("body")).not.toContainText("Missing permission:");
  });

  test("E2E-01c protected routes show auth wall", async ({ page }) => {
    for (const path of ["/organisation", "/users", "/facilities"]) {
      await page.goto(path);
      await expect(page.locator('input[type="email"], input[name="email"], button:has-text("Sign in")').first()).toBeVisible();
      await expect(page.locator("body")).not.toHaveText(/^\s*$/);
    }
  });

  test("E2E-01d invalid invite shows soft failure without leaking token in title", async ({ page }) => {
    const token = "e2e-placeholder-token-not-real-0001";
    await page.goto(`/?invite=${token}`);
    await expect(page).not.toHaveTitle(new RegExp(token));
    await expect(page.locator("body")).not.toContainText(token);
    await expect(page.getByText(/could not verify this invitation|invitation/i).first()).toBeVisible();
  });
});
