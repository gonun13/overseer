import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * The split: the prompt terminal at the bottom of the field runs commands and
 * talks to the overseer, and every model conversation is its own window with
 * its own transcript, session controls and composer.
 *
 * The sessions panel and the windows it opens are gated on an attached,
 * signed-in provider — the same gate as the prompt (wizard.ts `furnitureFor`).
 * Both outcomes are real states of a correct build, so read which one the shell
 * is in and assert that branch rather than skipping the test.
 */
test("opens a chat window per session, separate from the prompt", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const expand = page.getByRole("button", { name: /expand session list/i });
  if ((await expand.count()) === 0) {
    // Nothing can start a session without a provider, so the panel is not
    // furniture that belongs on the field at all.
    await expect(page.getByText("+ new session")).toHaveCount(0);
    return;
  }

  // Session controls live in the chat window, not on the field.
  await expect(page.getByRole("button", { name: /context/i })).toHaveCount(0);

  await expand.click();
  await page.getByRole("button", { name: "+ new session" }).click();

  const close = page.getByLabel("close session 1");
  await expect(close).toBeVisible();
  await expect(page.getByLabel("resize session 1")).toBeVisible();

  const context = page.getByRole("button", { name: /context/i });
  await expect(context).toHaveCount(1);
  await expect(page.getByRole("button", { name: /model/i })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /mode/i })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /agent/i })).toHaveCount(1);

  const composer = page.getByPlaceholder(
    "Ask, or describe the change you want.",
  );
  await composer.fill("what is in this repo?");
  await composer.press("Enter");
  await expect(page.getByText("what is in this repo?")).toBeVisible();

  // The prompt terminal is a different input and did not take the turn: it is
  // still on its own line, offering commands and the overseer.
  await expect(
    page.getByText("run a command, or message the overseer"),
  ).toBeVisible();

  // Re-selecting the session raises the window it already has rather than
  // opening a second one.
  await page
    .getByRole("button", { name: /session 1/i })
    .first()
    .click();
  await expect(close).toHaveCount(1);

  await close.click();
  await expect(page.getByLabel("close session 1")).toHaveCount(0);
});

/**
 * The terminal is permanent furniture: one line, no tab, no close control.
 * Focus keeps the same bar — the caret stays, the block cursor sits after it.
 */
test("the prompt terminal is a bare field, not a window", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const bar = page.locator(".prompt-bar");
  if ((await bar.count()) === 0) return; // no provider: the prompt is not released

  await bar.click();
  await expect(page.getByLabel("run a command, or message the overseer")).toBeFocused();
  await expect(bar).toHaveClass(/open/);
  await expect(page.getByPlaceholder("Run a command, or ask the overseer.")).toHaveCount(
    0,
  );

  await expect(page.getByLabel("collapse prompt")).toHaveCount(0);
  await expect(page.getByText(/shift\+enter for a newline/i)).toHaveCount(0);
});
