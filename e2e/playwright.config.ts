import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "https://www.sentinelgrid.tech";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
});
