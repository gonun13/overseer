import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * The plans window is summoned by `/plans` and belongs to the project panel it
 * sits under — plans are read out of the active project's own transcripts, so
 * the placement is part of what the window says.
 *
 * The list itself is whatever the container's transcripts hold: a stack whose
 * sessions have never run in plan mode legitimately shows none, so the empty
 * state is asserted as one of two real outcomes rather than skipped.
 */
test("opens the plans window under the project panel", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("/plans");
  await page.keyboard.press("Enter");

  const frame = page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: "close plans" }) });
  await expect(frame).toBeVisible();

  // Under the furniture it belongs to, and left-aligned with it.
  const panel = page.locator(".projects");
  const panelBox = await panel.boundingBox();
  const frameBox = await frame.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(frameBox!.y).toBeGreaterThan(panelBox!.y);
  expect(Math.abs(frameBox!.x - panelBox!.x)).toBeLessThan(8);

  // Either the container has plans on disk or it does not; both are correct,
  // and an empty frame that says nothing would not be.
  const empty = frame.getByText("no open plans");
  const rows = frame.locator(".w-row");
  await expect(empty.or(rows.first())).toBeVisible();
});
