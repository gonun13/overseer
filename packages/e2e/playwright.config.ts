import { defineConfig, devices } from "@playwright/test";

// This suite only ever runs inside the dev stack's `e2e` service — see
// bin/test-e2e and the `e2e` service in docker-compose.dev.yml. "web" and
// "server" resolve over the compose network; there is no host-side path
// (same rule as the rest of the project, README "Run it").
const baseURL = process.env.E2E_BASE_URL ?? "http://web:5173";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  // Serial, deliberately. These tests do not have a world each: they share one
  // server, one `/workspace/overseer-personality` and one `.overseer/state.json`,
  // and the wizard's opening depends on what the previous run left there. Run
  // in parallel they race each other into a different opening than the one they
  // asserted, and a failure then says more about the scheduler than the app.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  // A boot is a paced sequence, not a page load: minimum beat, intro hold,
  // greet hold, then discovery revealing a line a second. 30s left no room
  // between "slow" and "broken".
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
