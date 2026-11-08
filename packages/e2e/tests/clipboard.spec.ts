import { test, expect, type Locator, type Page } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * Copy and paste in a console terminal (spec/ui-ux.md §5.3), on a plain shell
 * so no provider is needed. This browser is not a Mac, so the chords are
 * Ctrl+Shift+C / Ctrl+Shift+V.
 *
 * Touches only the shell it opens — no sweep of the server's consoles, which
 * on a dev stack are the operator's own — and leaves with a clean `exit`,
 * which closes the window and dismisses the console.
 */

// The clipboard API exists only in a secure context. An operator's
// 127.0.0.1 is one; this suite's compose hostname is not, so vouch for it.
// Only full Chromium honours the flag — the default headless shell ignores it.
test.use({
  channel: "chromium",
  launchOptions: {
    args: [
      `--unsafely-treat-insecure-origin-as-secure=${process.env.E2E_BASE_URL ?? "http://web:5173"}`,
    ],
  },
});

function marker(): string {
  return `overseer-clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A terminal row holding exactly `text` — output, not the command echoing it. */
function rowOf(win: Locator, text: string): Locator {
  return win
    .locator(".xterm-rows > div")
    .filter({ hasText: new RegExp(`^${text}\\s*$`) });
}

async function typeInto(page: Page, win: Locator, text: string) {
  await win.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test("a console copies and pastes through the operator's clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // String expressions: this package type-checks without the DOM lib.
  const clipboard = () =>
    page.evaluate<string>("navigator.clipboard.readText()");

  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
  const before = await page.locator(".window-console").count();
  await page.getByRole("button", { name: "+ shell" }).click();
  await expect(page.locator(".window-console")).toHaveCount(before + 1);
  const win = page.locator(".window-console").last();
  await expect(win.locator(".xterm")).toBeVisible({ timeout: 15_000 });

  // A mouse selection, copied with Ctrl+Shift+C.
  const copied = marker();
  await typeInto(page, win, `echo ${copied}`);
  const box = await rowOf(win, copied).boundingBox();
  if (!box) throw new Error("echoed line has no box");
  await page.mouse.dblclick(box.x + 4, box.y + box.height / 2);
  await page.keyboard.press("Control+Shift+C");
  await expect.poll(clipboard).toBe(copied);

  // Ctrl+Shift+V types the clipboard in.
  const pasted = marker();
  await page.evaluate(
    `navigator.clipboard.writeText(${JSON.stringify(`echo ${pasted}`)})`,
  );
  await win.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Enter");
  await expect(rowOf(win, pasted)).toHaveCount(1);

  // A program's own copy (OSC 52), as Codex makes after a drag, lands too…
  const program = marker();
  await typeInto(
    page,
    win,
    `printf '\\033]52;c;%s\\a' "$(printf %s ${program} | base64)"`,
  );
  await expect.poll(clipboard).toBe(program);

  // …but a program asking to read the clipboard back gets no answer.
  const asked = marker();
  await typeInto(page, win, `printf '\\033]52;c;?\\a'; echo ${asked}`);
  await expect(rowOf(win, asked)).toHaveCount(1);
  await expect.poll(clipboard).toBe(program);

  await typeInto(page, win, "exit");
  await expect(page.locator(".window-console")).toHaveCount(before);
});
