import { test, expect, type Page } from "@playwright/test";

// Boot is asynchronous: discovery runs against the real adapters and paces
// its reveal at roughly one line a second before the footer mounts with
// "releasing the prompt" (packages/web/src/App.tsx `furniture.footer`).

/** First turn walks intro → name → tone → greet. Later boots skip beats
 * already settled in memory — advance only what is actually on screen. */
async function passWizardOpening(page: Page) {
  const nameInput = page.getByRole("textbox", { name: /your name/i });
  try {
    // Intro types and holds before the name ask; give that room.
    await nameInput.waitFor({ state: "visible", timeout: 20_000 });
    await nameInput.fill("Ada");
    await nameInput.press("Enter");
  } catch {
    // Returning instance with a name already on file.
  }

  const toneNeutral = page.getByRole("button", { name: /neutral/i });
  try {
    await toneNeutral.waitFor({ state: "visible", timeout: 8_000 });
    await toneNeutral.click();
  } catch {
    // Returning instance — no tone pick.
  }
}

test("boots to a settled state", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Overseer");
  await passWizardOpening(page);

  // Footer mounts with "releasing the prompt" — settled discovery, whether or
  // not an adapter is signed in (console only appears when one is).
  await expect(page.getByText(/overseer v/i)).toBeVisible({ timeout: 30_000 });
});

test("opens the adapters picker from the widget", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);

  const widget = page.getByRole("button", { name: /choose adapter/i });
  await expect(widget).toBeVisible({ timeout: 30_000 });
  await widget.click();
  await expect(page.getByLabel("close adapters")).toBeVisible();
  await expect(page.getByRole("button", { name: /connect/i })).toBeVisible();
});

test("opens the console window when an adapter is signed in", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);

  const consoleBtn = page.getByRole("button", { name: /open console/i });
  try {
    await consoleBtn.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    test.skip(true, "no authenticated adapter — console stays hidden");
    return;
  }

  await consoleBtn.click();
  await expect(page.getByLabel("close console")).toBeVisible();
});
