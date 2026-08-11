import { test, expect } from "@playwright/test";

// Boot is asynchronous: discovery runs against the mock adapter (registered
// whenever NODE_ENV !== production, see packages/server/src/adapters.ts) and
// paces its reveal at roughly one line a second before the footer mounts
// (packages/web/src/App.tsx `furniture.footer`). Assertions below give that
// room rather than asserting on the first paint.

test("boots to a settled state", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Overseer");

  // The footer's console link is furniture that only mounts once discovery
  // has resolved — its presence is the signal that boot actually finished,
  // not just that the page loaded.
  await expect(page.getByRole("button", { name: /open console/i })).toBeVisible(
    { timeout: 30_000 },
  );
});

test("opens the console window", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("button", { name: /open console/i })
    .click({ timeout: 30_000 });

  await expect(page.getByLabel("close console")).toBeVisible();
});
