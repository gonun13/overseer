import { test, expect, type Locator, type Page } from "@playwright/test";
import rootPkg from "../../../package.json" with { type: "json" };

// Boot is asynchronous: discovery runs against the real adapters and paces
// its reveal at roughly one line a second before the footer mounts with
// "releasing the prompt" (packages/web/src/App.tsx `furniture.footer`).

/** Footer copy — mounts only once discovery has settled. Also the anchor for
 * "the wizard had nothing left to ask", so it is worth naming once. */
const SETTLED = new RegExp(
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
async function passWizardOpening(page: Page): Promise<"asked" | "returning"> {
  const nameInput = page.getByRole("textbox", { name: /your name/i });
  const tonePick = page.getByRole("group", { name: "tone" });
  const settled = page.getByText(SETTLED);

  // One of these three is where every boot lands. Nothing is visible for the
  // first BOOT_MS + the intro hold, so this wait is the boot beat itself.
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

test("boots to a settled state", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Overseer");
  await passWizardOpening(page);

  // Footer mounts with "releasing the prompt" — settled discovery, whether or
  // not an adapter is signed in (console only appears when one is).
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

test("opens the adapters picker from the widget", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);

  const widget = page.getByRole("button", { name: /choose adapter/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });
  await widget.click();
  await expect(page.getByLabel("close adapters")).toBeVisible();
  await expect(page.getByRole("button", { name: /connect/i })).toBeVisible();
});

test("offers the console only when an adapter is signed in", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);

  // Both outcomes are real states of a correct build — the container has agent
  // credentials or it does not — so read which one the widget reports and
  // assert that branch, rather than skipping the test on the absence of a
  // button. A test that skips itself when the app is broken is not a test.
  const widget = page.getByRole("button", { name: /choose adapter/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });

  const consoleBtn = page.getByRole("button", { name: /open console/i });
  if (await widget.getByText("signed in", { exact: true }).isVisible()) {
    await expect(consoleBtn).toBeVisible();
    await consoleBtn.click();
    await expect(page.getByLabel("close console")).toBeVisible();
    return;
  }

  // Not signed in (or nothing attached): the console has nothing to show, and
  // offering it would be a control that cannot do anything.
  await expect(consoleBtn).toHaveCount(0);
});
