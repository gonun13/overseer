import { test, expect } from "@playwright/test";
import {
  expectPromptHeld,
  openProviders,
  passWizardOpening,
  promptAvailable,
  providersFrame,
  SETTLED,
} from "./shell";

test("boots to a settled state", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Overseer");
  await passWizardOpening(page);

  // Footer mounts with "releasing the prompt" — settled discovery, whether or
  // not a provider is signed in (console only appears when one is).
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
  // Discovery ran and reported a world: the status rows under the signals
  // carry the steps of the pass that just happened.
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

test("the active project readout opens the project it names", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  await page.getByRole("button", { name: /active project/i }).click();

  // The whole readout is the hit target: it offers the panel to switch with
  // and the window for the project it is currently naming.
  await expect(page.locator(".projects")).toBeVisible();
  await expect(
    page
      .locator(".window")
      .filter({ has: page.getByRole("button", { name: "close project" }) }),
  ).toBeVisible();
});

test("opens the providers picker from the widget", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);

  // Which view the tab opens on depends on whether the attached provider is
  // signed in — the picker offers other providers, the login step offers the
  // only thing worth doing when the attached one is signed out.
  const view = await openProviders(page);
  // Scoped to the window: the signal list and the settings panel each carry a
  // login control of their own, and an unscoped match hits all three.
  const frame = providersFrame(page);
  await expect(
    view === "picker"
      ? frame.getByRole("button", { name: /connect/i })
      : frame.getByRole("button", { name: /start login|sign in/i }).first(),
  ).toBeVisible();
});

test("offers a new session only when a provider is signed in", async ({
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

  // The left rail's action, not the widget's: every session is a console, so
  // the widget no longer offers one of its own.
  const newSession = page.locator(".sessions-actions").getByRole("button", {
    name: "+ new session",
  });
  if (await widget.getByText("signed in", { exact: true }).isVisible()) {
    await expect(newSession).toBeVisible();
    await newSession.click();
    // The provider's own TUI in a console window. Do not type a model prompt
    // here; only assert the terminal is up, then end it.
    const term = page.locator(".window-console .console-term").last();
    await expect(term).toBeVisible({ timeout: 15_000 });
    // Kill takes the window with it — there is nothing left to close
    // (spec/behaviour/consoles.md §3).
    const consoles = await page.locator(".window-console").count();
    const win = page.locator(".window-console").last();
    await win.getByRole("button", { name: /^kill / }).click();
    await expect(page.locator(".window-console")).toHaveCount(consoles - 1);
    return;
  }

  // Not signed in (or nothing attached): there is no CLI to start, and
  // offering it would be a control that cannot do anything.
  await expect(newSession).toHaveCount(0);
});

test("the prompt grows to show the whole draft", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
  if (!(await promptAvailable(page))) {
    await expectPromptHeld(page);
    return;
  }

  const bar = page.locator(".prompt-bar");
  const rest = (await bar.boundingBox())!.height;
  await bar.click();
  // Never pressed alone: Enter would start a session and spend a model turn.
  await page.keyboard.type("first line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second line");
  await expect(page.locator(".prompt-bar textarea")).toHaveValue(
    "first line\nsecond line",
  );
  await expect(page.locator(".prompt-mirror")).toContainText("second line");
  expect((await bar.boundingBox())!.height).toBeGreaterThan(rest);

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
});
