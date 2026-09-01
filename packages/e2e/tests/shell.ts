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
 * snapshot, `./workspace` holds `overseer-personality`), so a run legitimately
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
