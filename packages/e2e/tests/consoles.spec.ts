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
  // Focus xterm's own input rather than clicking: another window may be
  // lying over this one.
  await win.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function cleanUp(page: Page) {
  // Other windows can lie over a console's tab.
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
  // One at a time from the top: a kill takes its row away, so positions taken
  // up front go stale.
  while ((await page.locator(".sessions .session-row-stop").count()) > 0) {
    await page.locator(".sessions .session-row-stop").first().click();
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
  const row = page
    .locator(".sessions .session-row", {
      has: page.locator(".session-row-name", { hasText: /^shell$/ }),
    })
    .first();
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

  // They tile on their own, inside the stage — never over a rail.
  const stage = (await page.locator(".stage").boundingBox())!;
  for (const w of await page.locator(".window-console").all()) {
    const box = (await w.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(stage.x);
    expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  }

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

test("an agent console carries a callsign the prompt can address", async ({ page }) => {
  await settle(page);
  // An agent console needs a signed-in provider; without one there is no
  // prompt and nothing to name, and that is a correct build too.
  const newSession = page.locator(".sessions-actions").getByRole("button", {
    name: "+ new session",
  });
  if ((await newSession.count()) === 0) return;

  await newSession.click();
  const win = page.locator(".window-console").last();
  await expect(win.locator(".xterm")).toBeVisible({ timeout: 15_000 });

  // The rail row is named by the callsign alone (spec/behaviour/relay.md §6).
  const row = page.locator(".sessions .session-row-name").first();
  await expect(row).toHaveText(/^[A-Z][a-z]+\d*$/);
  const callsign = (await row.textContent()) ?? "";

  // Detached, `@callsign` alone brings it back — no prompt is typed into the
  // CLI, so no model turn is spent.
  await win.getByRole("button", { name: /^detach / }).click();
  await expect(page.locator(".window-console")).toHaveCount(0);
  await page.locator(".prompt-bar").click();
  await page.keyboard.type(`@${callsign}`);
  await expect(page.getByRole("option", { name: new RegExp(`^@${callsign}`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".window-console")).toHaveCount(1);

  // A name nobody holds is refused out loud, in the status list.
  await page.locator(".prompt-bar").click();
  await page.keyboard.type("@nobody hello");
  await page.keyboard.press("Enter");
  await expect(page.locator(".w-steps").getByText(/no agent called nobody/i).first()).toBeVisible();

  await cleanUp(page);
});
