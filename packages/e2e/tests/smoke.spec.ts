import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

test("boots to a settled state", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Overseer");
  await passWizardOpening(page);

  // Footer mounts with "releasing the prompt" — settled discovery, whether or
  // not a provider is signed in (console only appears when one is).
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
  // Discovery ran and reported a world: the operations window is summoned by
  // the machine and carries the steps of the pass that just happened.
  await expect(page.getByText(/scanning workspace/i)).toBeVisible();
});

test("shows the active project without its workspace path", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const active = page.getByRole("button", { name: /active project/i });
  await expect(active).toBeVisible();
  // Meta is branch · dirty only — the workspace root is implied, and an
  // absolute path here would mean the readout started leaking mount facts.
  await expect(active).not.toContainText("/workspace");
  await expect(
    active.getByText(/· (clean|uncommitted changes|status unknown)/),
  ).toBeVisible();
});

test("opens the providers picker from the widget", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);

  const widget = page.getByRole("button", { name: /choose provider/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });
  await widget.click();
  await expect(page.getByLabel("close providers")).toBeVisible();
  await expect(page.getByRole("button", { name: /connect/i })).toBeVisible();
});

test("offers the console only when a provider is signed in", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);

  // Both outcomes are real states of a correct build — the container has agent
  // credentials or it does not — so read which one the widget reports and
  // assert that branch, rather than skipping the test on the absence of a
  // button. A test that skips itself when the app is broken is not a test.
  const widget = page.getByRole("button", { name: /choose provider/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });

  const consoleBtn = page.getByRole("button", { name: /open console/i });
  if (await widget.getByText("signed in", { exact: true }).isVisible()) {
    await expect(consoleBtn).toBeVisible();
    await consoleBtn.click();
    await expect(page.getByLabel("close console")).toBeVisible();
    // Live PTY surface — xterm mounts as an application region. Do not type a
    // model prompt here; only assert the terminal is present and dismissible.
    await expect(page.getByLabel("provider console")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel("close console").click();
    await expect(page.getByLabel("close console")).toHaveCount(0);
    return;
  }

  // Not signed in (or nothing attached): the console has nothing to show, and
  // offering it would be a control that cannot do anything.
  await expect(consoleBtn).toHaveCount(0);
});
