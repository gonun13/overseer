import { test, expect, type Page } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * Fullscreen (spec/ui-ux.md §1.1): the rails stand down, the windows tile the
 * whole viewport under a floating clock, and the choice survives a reload.
 *
 * Touches only the shell it opens and leaves with a clean `exit`. The setting
 * lives in this test's own browser storage, so the operator's field is not
 * changed by it.
 */

async function setLayout(page: Page, layout: "rails" | "fullscreen") {
  await page.getByRole("button", { name: "settings", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`${layout}$`) }).click();
  await page.getByRole("button", { name: "close settings" }).click();
}

test("fullscreen tiles the windows over the whole viewport, leaving the clock", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const before = await page.locator(".window-console").count();
  await page.getByRole("button", { name: "+ shell" }).click();
  await expect(page.locator(".window-console")).toHaveCount(before + 1);
  const win = page.locator(".window-console").last();
  await expect(win.locator(".xterm")).toBeVisible({ timeout: 15_000 });

  await setLayout(page, "fullscreen");

  // Only the clock and the gear are left on the field.
  await expect(page.locator(".rail-left")).toBeHidden();
  await expect(page.locator(".overseer-layer")).toBeHidden();
  await expect(page.getByText(SETTLED)).toBeHidden();
  await expect(page.locator(".clock-time")).toBeVisible();
  const gear = page.getByRole("button", { name: "settings", exact: true });
  await expect(gear).toBeVisible();

  // The stage is the whole viewport, and the windows on it reach every edge.
  const viewport = page.viewportSize()!;
  const stage = (await page.locator(".stage").boundingBox())!;
  expect(stage.x).toBe(0);
  expect(stage.y).toBe(0);
  expect(stage.width).toBeCloseTo(viewport.width, 0);
  expect(stage.height).toBeCloseTo(viewport.height, 0);
  const boxes = await Promise.all(
    (await page.locator(".window").all()).map((w) => w.boundingBox()),
  );
  expect(Math.min(...boxes.map((b) => b!.x))).toBeLessThan(10);
  expect(Math.min(...boxes.map((b) => b!.y))).toBeLessThan(10);
  expect(Math.max(...boxes.map((b) => b!.x + b!.width))).toBeGreaterThan(
    viewport.width - 10,
  );

  // The clock floats over the top-right corner without covering any
  // window's close.
  const clock = (await page.locator(".rail-right").boundingBox())!;
  expect(clock.x + clock.width).toBeGreaterThan(viewport.width - 10);
  expect(clock.y).toBeLessThan(10);
  for (const close of await page.locator(".tab-close").all()) {
    const box = (await close.boundingBox())!;
    const covered =
      box.x < clock.x + clock.width &&
      clock.x < box.x + box.width &&
      box.y < clock.y + clock.height &&
      clock.y < box.y + box.height;
    expect(covered).toBe(false);
  }
  await expect(gear).toBeVisible();

  // A reload comes back in fullscreen.
  await page.reload();
  await expect(page.locator(".clock-time")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".field.fullscreen")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".rail-left")).toBeHidden();

  // And back: the rails return around a stage that is narrower again.
  await setLayout(page, "rails");
  await expect(page.locator(".rail-left")).toBeVisible();
  await expect(page.getByText(SETTLED)).toBeVisible();
  const railed = (await page.locator(".stage").boundingBox())!;
  expect(railed.x).toBeGreaterThan(0);
  const back = page.locator(".window-console").last();
  expect((await back.boundingBox())!.x).toBeGreaterThanOrEqual(railed.x);

  await back.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await expect(page.locator(".window-console")).toHaveCount(before);
});
