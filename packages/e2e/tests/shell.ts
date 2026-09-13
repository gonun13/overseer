import { expect, type Locator, type Page } from "@playwright/test";
import rootPkg from "../../../package.json" with { type: "json" };

// Boot is asynchronous: discovery runs against the real providers and paces
// its reveal at roughly one line a second before the footer mounts with
// "releasing the prompt" (packages/web/src/App.tsx `furniture.footer`).
//
// Shared by every spec rather than copied into each: the opening is a property
// of the app, and two specs disagreeing about how a boot ends is a bug in the
// tests that reads as a bug in the shell.

/** Footer copy — mounts only once discovery has settled. Also the anchor for
 * "the wizard had nothing left to ask", so it is worth naming once. */
export const SETTLED = new RegExp(
  `overseer v${rootPkg.version.replaceAll(".", "\\.")}`,
  "i",
);

/**
 * Advance past whatever the wizard is actually showing, and report which
 * opening it was.
 *
 * The stack keeps state between runs (`overseer-memory` holds the world
 * snapshot, `/workspace` holds `overseer-personality`), so a run legitimately
 * opens either on the first-turn ask or on a returning greet. Which one it is
 * gets read, not guessed and not caught: wait until one of the three possible
 * openings is on screen, then assert the branch that appeared. The try/catch
 * this replaces made "the name ask never rendered" and "this is a returning
 * instance" the same outcome, so a regression that broke the first turn passed
 * as a returning boot.
 */
export async function passWizardOpening(
  page: Page,
): Promise<"asked" | "returning"> {
  const nameInput = page.getByRole("textbox", { name: /your name/i });
  const tonePick = page.getByRole("group", { name: "tone" });
  const settled = page.getByText(SETTLED);

  // One of these three is where every boot lands. Nothing is visible for the
  // first BOOT_MS, so this wait is the boot beat itself.
  await expect(nameInput.or(tonePick).or(settled).first()).toBeVisible({
    timeout: 45_000,
  });

  if (await nameInput.isVisible()) {
    await nameInput.fill("Ada");
    await nameInput.press("Enter");
    // The reducer moves straight from the name to the tone beat, so this is
    // not a maybe: a first turn that skips it is a broken first turn.
    await pickNeutralTone(tonePick);
    return "asked";
  }

  // A returning instance can still owe a tone — name on file from an earlier
  // run, tone never picked. Left unanswered it self-submits after 15s, which
  // would turn every such run into a 15s wait rather than a failure.
  if (await tonePick.isVisible()) {
    await pickNeutralTone(tonePick);
  }
  return "returning";
}

async function pickNeutralTone(tonePick: Locator) {
  await expect(tonePick).toBeVisible();
  // Substring, not exact: the currently-selected tone carries a `▪` mark
  // inside the button, so its accessible name is not the bare word. Scoped to
  // the group, which is what keeps `/neutral/` unambiguous.
  await tonePick.getByRole("button", { name: /neutral/i }).click();
}

/**
 * A prompt no earlier run can collide with.
 *
 * The stack is stateful: sessions survive between runs in the `agent-home`
 * volume, and a session's title is derived from its first user message. A spec
 * that sends a fixed prompt therefore leaves a row carrying that exact text on
 * the field for every later run, and `getByText(prompt)` starts matching the
 * accumulated rows as well as the turn under test — a strict-mode violation
 * whose count climbs by one per run, failing a build that broke nothing.
 *
 * Tagging the prompt keeps each run's text its own. Assertions should still be
 * scoped to the transcript rather than the page: within a single run the live
 * session's own row is titled from the prompt too.
 */
export function uniquePrompt(text: string): string {
  return `${text} [${runTag()}]`;
}

/** Short, readable, and unique per call — one tag per prompt, not per file, so
 * two specs in the same worker cannot collide with each other either. */
export function runTag(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Whether the prompt is on screen.
 *
 * The prompt mounts only once the **attached** provider is signed in
 * (`furnitureFor` in `packages/web/src/state/wizard.ts`), and the command
 * palette lives inside it. So "can I type `/plans`?" is not a property of the
 * build — it is a property of whether the container currently holds a working
 * credential, and both answers are a correct build.
 *
 * Specs that assumed the prompt was always there turned a signed-out stack
 * into eight failures that looked like regressions and were not.
 */
export async function promptAvailable(page: Page): Promise<boolean> {
  // By CSS rather than by role: the composer's textarea carries only a
  // placeholder, and the placeholder is copy that changes.
  const composer = page.locator(".composer textarea");
  // Short: by the time a caller asks, discovery has settled and the prompt is
  // either mounted or gated. Waiting the default timeout here would add ten
  // seconds to every signed-out run.
  return composer
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}

/**
 * Run a slash command, or report that there is no prompt to run it in.
 *
 * Returns false when the shell is holding the prompt, so the caller can assert
 * the held branch instead of waiting out a window that was never going to
 * open. Never skips: a skipped test and a broken one look identical in a run.
 */
export async function runCommand(
  page: Page,
  command: string,
): Promise<boolean> {
  if (!(await promptAvailable(page))) return false;
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  return true;
}

/**
 * Assert the shell is legitimately holding the prompt rather than having lost
 * it. The status window's own row and the signal have to agree about why —
 * that agreement is the thing worth checking in this branch.
 */
export async function expectPromptHeld(page: Page): Promise<void> {
  await expect(
    page.locator(".w-steps .w-step").filter({ hasText: /releasing the prompt/i }),
  ).toContainText(/held/i);
  await expect(
    page.locator(".os-signal").filter({ hasText: /not authenticated|no provider/i }),
  ).toBeVisible();
}

/** The frame a window's close control names — windows carry no role. */
export function windowFrame(page: Page, name: string): Locator {
  return page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: `close ${name}` }) });
}

/**
 * Open the capabilities window by whichever route this shell offers —
 * `/capabilities` when the prompt is up, the settings panel's own button when
 * it is not. Both are real routes an operator uses, so covering the second one
 * is better than only testing the first.
 */
export async function openCapabilities(page: Page): Promise<void> {
  if (await runCommand(page, "/capabilities")) return;
  // `exact` matters: "close settings" also contains "settings", and the panel
  // carries both once it is open.
  // The panel is always in the DOM — it slides in and out and is `inert` when
  // shut — so "is it open" is the class, not visibility.
  const panel = page.locator(".panel");
  if ((await page.locator(".panel.open").count()) === 0) {
    await page.getByRole("button", { name: "settings", exact: true }).click();
    await expect(page.locator(".panel.open")).toBeVisible();
  }
  await panel.getByRole("button", { name: /open capabilities/i }).click();
}

/** Same idea for the changelog: the footer version is a control, not a label. */
export async function openChangelog(page: Page): Promise<void> {
  if (await runCommand(page, "/changelog")) return;
  await page.getByRole("button", { name: SETTLED }).click();
}

/** The providers window's own frame, for scoping away the settings panel and
 * the signal list — both of which carry a "start login" of their own. */
export function providersFrame(page: Page): Locator {
  return page
    .locator(".window")
    .filter({ has: page.getByLabel("close providers") });
}

/**
 * Open the providers window and report which view its first tab landed on.
 *
 * The providers tab is not one view: an attached provider that can log in and
 * is not signed in gets the login step instead of the picker list
 * (`ProvidersTab` in `ProvidersWindow.tsx`), because signing in is the only
 * thing worth offering at that point. Both are correct, so a spec reads which
 * one it got rather than assuming the signed-in one.
 */
export async function openProviders(
  page: Page,
): Promise<"picker" | "login"> {
  const widget = page.getByRole("button", { name: /choose provider/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });
  await widget.click();
  await expect(page.getByLabel("close providers")).toBeVisible();

  const frame = providersFrame(page);
  const picker = frame.getByText("available providers");
  const login = frame.getByRole("button", { name: /start login|sign in/i });
  await expect(picker.or(login).first()).toBeVisible();
  return (await picker.isVisible()) ? "picker" : "login";
}
