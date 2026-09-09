import { test, expect } from "@playwright/test";
import { passWizardOpening, runTag, SETTLED, uniquePrompt } from "./shell";

/**
 * The split: the prompt terminal at the bottom of the field runs slash
 * commands and forwards everything else into a project session. Every model
 * conversation is its own window with its own transcript, session controls and
 * composer.
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

  // Open or closed, either chevron is the signal that the panel is present at
  // all — it defaults open, so "expand" alone would misread a signed-in
  // operator as the no-provider branch.
  const expand = page.getByRole("button", { name: /expand session list/i });
  const collapse = page.getByRole("button", { name: /collapse session list/i });
  if ((await expand.count()) === 0 && (await collapse.count()) === 0) {
    // Nothing can start a session without a provider, so the panel is not
    // furniture that belongs on the field at all.
    await expect(page.getByText("+ new session")).toHaveCount(0);
    return;
  }

  // Session controls live in the chat window, not on the field.
  await expect(page.getByRole("button", { name: /context/i })).toHaveCount(0);

  if ((await expand.count()) > 0) await expand.click();
  await page.getByRole("button", { name: "+ new session" }).click();

  // The window is titled from server session metadata — "new session" until
  // Claude resolves the session's own title, which then replaces it. Locate
  // the window by what it is rather than by what it is currently called.
  const chat = page.locator(".window-session");
  await expect(chat).toHaveCount(1);
  await expect(chat.locator(".tab-close")).toBeVisible();
  await expect(chat.locator(".window-resize")).toBeVisible();

  // Heads print the selected value, so the row's name lives only on the
  // accessible label — four rows, in the order the digit shortcuts assume.
  await expect(chat.locator(".session-ctl-head")).toHaveCount(4);
  await expect(chat.getByRole("button", { name: /^agent\b/ })).toHaveCount(1);

  const composer = page.getByPlaceholder(
    "Ask, or describe the change you want.",
  );
  const question = uniquePrompt("what is in this repo?");
  await composer.fill(question);
  await composer.press("Enter");
  // Scoped to the window's own transcript: the live session's row in the panel
  // is titled from this same prompt, so a page-wide text match would be
  // ambiguous even on a completely clean stack.
  await expect(chat.locator(".turn-operator")).toContainText(question);

  // The prompt terminal is a different input and did not take the turn: it is
  // still on its own line, offering slash commands and session prompts.
  await expect(
    page.getByText("type / for a command, or message the session"),
  ).toBeVisible();

  // Re-selecting the session raises the window it already has rather than
  // opening a second one.
  // The active session's own row — the project may already carry sessions
  // from earlier runs, and picking another one correctly opens its window.
  await page.locator(".session-row.current").click();
  await expect(chat).toHaveCount(1);

  await chat.locator(".tab-close").click();
  await expect(page.locator(".window-session")).toHaveCount(0);
});

/*
 * Removed: "session controls read the value in force".
 *
 * It opened the mode row on whatever provider happened to be attached and then
 * asserted claude-code's list — six options, `bypassPermissions` styled danger,
 * `acceptEdits` selectable. Cursor declares three (`default`, `plan`, `ask`), so
 * the test failed for a correct build whenever cursor was the attached provider.
 * An acceptance test may not assume one provider's surface: it checks what every
 * provider has, or it gates on the provider it needs. The mode list is neither.
 *
 * The parsing this was wiring-checking is covered in the adapters' own unit
 * tests (each adapter's own test/ directory). A provider-independent
 * version would assert the row is non-empty and that picking an option closes
 * the section and puts the value on the head, naming no mode at all.
 */

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
  await expect(
    page.getByLabel("type / for a command, or message the session"),
  ).toBeFocused();
  await expect(bar).toHaveClass(/open/);
  await expect(
    page.getByPlaceholder("Run a command, or ask the overseer."),
  ).toHaveCount(0);

  await expect(page.getByLabel("collapse prompt")).toHaveCount(0);
  await expect(page.getByText(/shift\+enter for a newline/i)).toHaveCount(0);
});

/**
 * `/` is the command prefix. Names autocomplete; Enter runs the highlighted
 * command. Anything else is a session prompt — and starts a session when the
 * project does not have one.
 */
test("slash commands autocomplete; other text goes to a session", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const bar = page.locator(".prompt-bar");
  if ((await bar.count()) === 0) return; // no provider: the prompt is not released

  await bar.click();
  const prompt = page.getByLabel(
    "type / for a command, or message the session",
  );
  await prompt.fill("/he");
  const helpOption = page.getByRole("option", { name: /\/help/i });
  await expect(helpOption).toBeVisible();
  await expect(page.getByRole("option", { name: /\/console/i })).toHaveCount(0);
  await prompt.press("Enter");
  await expect(page.getByLabel("close help")).toBeVisible();
  await page.getByLabel("close help").click();

  await bar.click();
  const question = uniquePrompt("what is in this repo?");
  await prompt.fill(question);
  await prompt.press("Enter");
  const started = page.locator(".window-session");
  await expect(started).toHaveCount(1);
  await expect(started.locator(".turn-operator")).toContainText(question);
});

/**
 * A session outlives the process behind it. Reopening one from the list
 * resumes it from its JSONL transcript and it must go on answering — the path
 * that breaks when the adapter cannot work out which project a dormant
 * session belongs to, leaving the operator with a red light and no reply.
 */
test("resumes a session from the list and answers a new question", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  // The list defaults open, so only a genuinely absent panel (no provider)
  // means "nothing to resume" — checking "expand" alone would misread the
  // ordinary open-by-default state as that same case and skip the test.
  const expand = page.getByRole("button", { name: /expand session list/i });
  const collapse = page.getByRole("button", { name: /collapse session list/i });
  if ((await expand.count()) === 0 && (await collapse.count()) === 0) return;
  if ((await expand.count()) > 0) await expand.click();

  const existing = page.locator(".session-row:not(.session-new)");
  if ((await existing.count()) === 0) return; // no transcript to resume yet
  await existing.first().click();

  const chat = page.locator(".window-session");
  await expect(chat).toHaveCount(1);

  const composer = page.getByPlaceholder(
    "Ask, or describe the change you want.",
  );
  // The word is tagged as well as the prompt: this session already holds
  // earlier turns, so a bare "RESUMED" could be matched off a previous run's
  // reply rather than the one this test just asked for.
  const word = `RESUMED${runTag()}`;
  await composer.fill(`Reply with the single word: ${word}`);
  await composer.press("Enter");

  await expect(chat.locator(".turn-agent").last()).toContainText(
    new RegExp(word, "i"),
    { timeout: 120_000 },
  );
});

/**
 * Deleting is not the same as closing: it stops whatever the session is doing
 * and removes it for good, so it must not come back on the next session.list
 * (nor from JSONL backfill after a reconnect — packages/server/src/session-supervisor.ts `delete`).
 */
test("deletes a session from the sessions list, stopping and removing it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const expand = page.getByRole("button", { name: /expand session list/i });
  const collapse = page.getByRole("button", { name: /collapse session list/i });
  if ((await expand.count()) === 0 && (await collapse.count()) === 0) return;
  if ((await expand.count()) > 0) await expand.click();

  await page.getByRole("button", { name: "+ new session" }).click();
  await expect(page.locator(".window-session")).toHaveCount(1);

  const composer = page.getByPlaceholder(
    "Ask, or describe the change you want.",
  );
  await composer.fill(
    uniquePrompt("Write a 400 word essay about the history of bicycles."),
  );
  await composer.press("Enter");
  await expect(page.locator(".turn-agent")).toHaveCount(1, { timeout: 30_000 });

  const before = await page.locator(".session-row:not(.session-new)").count();

  await page
    .locator(".session-row.current")
    .getByLabel(/delete/i)
    .click();

  // Stopped: the turn in flight does not go on to finish and the window
  // showing it is gone, not just quietly orphaned.
  await expect(page.locator(".window-session")).toHaveCount(0);
  await expect(page.locator(".session-row:not(.session-new)")).toHaveCount(
    before - 1,
  );

  // Removed for good: a fresh list request must not bring it back.
  await page.reload();
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
  const collapseAfterReload = page.getByRole("button", {
    name: /collapse session list/i,
  });
  if ((await collapseAfterReload.count()) === 0) {
    await page
      .getByRole("button", { name: /expand session list/i })
      .click();
  }
  await expect(page.locator(".session-row:not(.session-new)")).toHaveCount(
    before - 1,
  );
});

/**
 * The cross-project sessions window (`/sessions`) carries the same delete
 * affordance as the per-project list.
 */
test("deletes a session from the sessions window", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const bar = page.locator(".prompt-bar");
  if ((await bar.count()) === 0) return; // no provider: nothing to delete

  await bar.click();
  const prompt = page.getByLabel(
    "type / for a command, or message the session",
  );
  await prompt.fill("/sessions");
  await prompt.press("Enter");

  const sessionsWindow = page.locator(".w-row");
  const before = await sessionsWindow.count();
  if (before === 0) return; // nothing to delete yet

  await sessionsWindow.first().getByLabel(/delete/i).click();
  await expect(page.locator(".w-row")).toHaveCount(before - 1);
});
