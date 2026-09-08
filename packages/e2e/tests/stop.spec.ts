import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED, uniquePrompt } from "./shell";

/**
 * Stopping a turn. The button only exists while there is something to stop —
 * the supervisor refuses an `interrupt` for a session with nothing running —
 * so the whole feature is a claim about two states, and both are asserted
 * here: it appears once a turn is in flight, and it is gone again once the
 * turn is over, whether the operator ended it or the model did.
 *
 * Gated on a signed-in provider like the chat spec: without one nothing can
 * start a session, so there is no turn to stop. That is a real state of a
 * correct build, so it is read and asserted rather than skipped.
 */
test("stops a turn in flight, from the composer and from the session row", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const expand = page.getByRole("button", { name: /expand session list/i });
  const collapse = page.getByRole("button", { name: /collapse session list/i });
  if ((await expand.count()) === 0 && (await collapse.count()) === 0) {
    await expect(page.getByText("+ new session")).toHaveCount(0);
    return;
  }
  if ((await expand.count()) > 0) await expand.click();

  await page.getByRole("button", { name: "+ new session" }).click();
  const chat = page.locator(".window-session");
  await expect(chat).toHaveCount(1);

  // Nothing is running yet, so neither surface offers a stop.
  await expect(chat.locator(".composer-stop")).toHaveCount(0);
  await expect(page.locator(".session-row-stop")).toHaveCount(0);

  // Long enough that the turn is still in flight when the assertions land —
  // and worded so an obedient model keeps talking rather than answering in a
  // sentence.
  const composer = page.getByPlaceholder(
    "Ask, or describe the change you want.",
  );
  await composer.fill(
    uniquePrompt("count slowly from 1 to 300, one number per line"),
  );
  await composer.press("Enter");

  // Both surfaces light up off the same activity the status light reads.
  const stop = chat.locator(".composer-stop");
  await expect(stop).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".session-row-stop")).toHaveCount(1);

  await stop.click();

  // The turn ends: the button withdraws on the CLI's own `turn.end`, which is
  // the only thing that could have retired it.
  await expect(stop).toHaveCount(0, { timeout: 45_000 });
  await expect(page.locator(".session-row-stop")).toHaveCount(0);

  // The session survived the stop — it is interrupted, not closed, so it
  // still takes the next thing said to it.
  await expect(composer).toBeEnabled();
  const after = uniquePrompt("say ok");
  await composer.fill(after);
  await composer.press("Enter");
  // The transcript still holds the interrupted turn ahead of this one, so the
  // assertion names the newest operator turn rather than "the" one.
  await expect(chat.locator(".turn-operator").last()).toContainText(after);
});

/**
 * The settings sweep. It stops every session with a turn running, which is a
 * claim about a set — so it is worth seeing it act on one it was never handed
 * directly, and worth seeing it stay disabled when the set is empty.
 */
test("stops every running session from settings, after a confirm", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const expand = page.getByRole("button", { name: /expand session list/i });
  const collapse = page.getByRole("button", { name: /collapse session list/i });
  if ((await expand.count()) === 0 && (await collapse.count()) === 0) {
    await expect(page.getByText("+ new session")).toHaveCount(0);
    return;
  }
  if ((await expand.count()) > 0) await expand.click();

  // Exact: the panel's own close carries "close settings", which a substring
  // match would take for the gear.
  const settings = page.getByRole("button", { name: "settings", exact: true });
  const stopAll = page.getByRole("button", { name: /^stop all sessions/ });

  // With nothing running the row still shows the button, but it refuses —
  // it never promises a sweep with no target.
  await settings.click();
  await expect(stopAll).toBeDisabled();
  await page.getByRole("button", { name: "close settings" }).click();

  await page.getByRole("button", { name: "+ new session" }).click();
  const composer = page.getByPlaceholder(
    "Ask, or describe the change you want.",
  );
  await composer.fill(
    uniquePrompt("count slowly from 1 to 300, one number per line"),
  );
  await composer.press("Enter");
  await expect(page.locator(".session-row-stop")).toHaveCount(1, {
    timeout: 45_000,
  });

  // Now it counts what it would reach, and asks once before doing it.
  await settings.click();
  await expect(stopAll).toContainText("(1)");
  await stopAll.click();
  await expect(
    page.getByRole("button", { name: /stop them all/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /stop them all/ }).click();

  await expect(page.locator(".session-row-stop")).toHaveCount(0, {
    timeout: 45_000,
  });
  await expect(stopAll).toBeDisabled();
});
