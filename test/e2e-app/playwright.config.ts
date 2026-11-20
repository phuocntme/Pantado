import { defineConfig } from "@playwright/test";

/** App e2e on a local Anvil stack (stack.ts). Web on :3100, API on :3101. */
export default defineConfig({
  testDir: "specs",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "pnpm stack:anvil",
    url: "http://127.0.0.1:3100/marketplace",
    timeout: 600_000,
    reuseExistingServer: true,
    stdout: "pipe",
  },
});
