import { test, expect, type Page } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * Consoles belong to the server, not the tab. These run on plain shells — no
 * provider credentials needed, so every branch here is deterministic — and
 * assert the three promises the console model makes: a closed window only
 * detaches, a reload puts the desk back with its scrollback, and kill ends
 * the process while leaving it listed until dismissed.
 *
 * The server outlives each test, so every test ends by killing and
 * dismissing what it started.
 */

async function settle(page: Page) {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
  const expand = page.getByRole("button", { name: /expand session list/i });
  if ((await expand.count()) > 0) await expand.click();
  // Start from an empty desk: an earlier test (or run) that failed half way
  // leaves its consoles running on the server.
  await cleanUp(page);
}

/** A unique marker the shell echoes, so assertions never match an older run. */
function marker(): string {
  return `overseer-e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function openShell(page: Page) {
  const before = await page.locator(".window-console").count();
  await page.getByRole("button", { name: "+ shell" }).click();
  await expect(page.locator(".window-console")).toHaveCount(before + 1);
  const win = page.locator(".window-console").last();
  await expect(win.locator(".xterm")).toBeVisible({ timeout: 15_000 });
  return win;
}

async function typeInto(page: Page, win: ReturnType<Page["locator"]>, text: string) {
  // Focus xterm's own input rather than clicking: another window (the
  // overseer's status window, after a reload) may be lying over this one.
  await win.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function cleanUp(page: Page) {
  // Other windows (the overseer's status window lands top-right after a
  // reload) can lie over a console's tab.
  while ((await page.locator(".window:not(.window-console) .tab-close").count()) > 0) {
    await page.locator(".window:not(.window-console) .tab-close").first().click();
  }
  // Windows sit above the panel — tiled ones can cover it — so detach them
  // all first, then kill everything still running and dismiss every row.
  while ((await page.locator(".window-console [aria-label^='detach '], .window-console [aria-label^='close ']").count()) > 0) {
    await page
      .locator(".window-console [aria-label^='detach '], .window-console [aria-label^='close ']")
      .first()
      .click();
  }
  for (const kill of await page.locator(".sessions .session-row-stop").all()) {
    await kill.click();
  }
  await expect(page.locator(".sessions .session-row-stop")).toHaveCount(0, {
    timeout: 15_000,
  });
  while ((await page.locator(".sessions [aria-label^='dismiss ']").count()) > 0) {
    await page.locator(".sessions [aria-label^='dismiss ']").first().click();
  }
}

test("a shell console keeps running when its window closes, and comes back", async ({
  page,
}) => {
  await settle(page);
  const win = await openShell(page);
  const mark = marker();
  await typeInto(page, win, `echo ${mark}`);
  await expect(win.locator(".xterm-rows")).toContainText(mark);

  // Close is detach: the window goes, the console stays listed as running.
  await win.getByRole("button", { name: /^detach / }).click();
  await expect(page.locator(".window-console")).toHaveCount(0);
  const row = page.locator(".sessions .session-row", { hasText: /shell ·/ }).first();
  await expect(row).toBeVisible();

  // Picking it from the list reattaches — with what it printed meanwhile.
  await row.click();
  const again = page.locator(".window-console").last();
  await expect(again.locator(".xterm-rows")).toContainText(mark, { timeout: 15_000 });

  await cleanUp(page);
});

test("a reload restores console windows with their scrollback", async ({ page }) => {
  await settle(page);
  const win = await openShell(page);
  const mark = marker();
  await typeInto(page, win, `echo ${mark}`);
  await expect(win.locator(".xterm-rows")).toContainText(mark);

  await page.reload();
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const restored = page.locator(".window-console").last();
  await expect(restored.locator(".xterm-rows")).toContainText(mark, { timeout: 15_000 });

  // Still the same live shell, not a replay of a dead one.
  const after = marker();
  await typeInto(page, restored, `echo ${after}`);
  await expect(restored.locator(".xterm-rows")).toContainText(after);

  const expand = page.getByRole("button", { name: /expand session list/i });
  if ((await expand.count()) > 0) await expand.click();
  await cleanUp(page);
});

test("several consoles run side by side and tile", async ({ page }) => {
  await settle(page);
  await openShell(page);
  await openShell(page);
  await expect(page.locator(".window-console")).toHaveCount(2);

  await page.getByRole("button", { name: "tile" }).click();
  const boxes = await Promise.all(
    (await page.locator(".window-console").all()).map((w) => w.boundingBox()),
  );
  // Tiled windows do not overlap.
  const [a, b] = boxes;
  expect(a && b).toBeTruthy();
  const overlap =
    a!.x < b!.x + b!.width &&
    b!.x < a!.x + a!.width &&
    a!.y < b!.y + b!.height &&
    b!.y < a!.y + a!.height;
  expect(overlap).toBe(false);

  await cleanUp(page);
});

test("kill all consoles from settings, after a confirm", async ({ page }) => {
  await settle(page);
  const settings = page.getByRole("button", { name: "settings", exact: true });
  const killAll = page.getByRole("button", { name: /^kill all consoles/ });

  await settings.click();
  await expect(killAll).toBeDisabled();
  await page.getByRole("button", { name: "close settings" }).click();

  await openShell(page);
  await openShell(page);

  await settings.click();
  await expect(killAll).toContainText("(2)");
  await killAll.click();
  await page.getByRole("button", { name: /kill them all/ }).click();
  await expect(killAll).toBeDisabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "close settings" }).click();

  await cleanUp(page);
});
