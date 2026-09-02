import { test, expect } from "@playwright/test";
import { passWizardOpening } from "./shell";

test("switches to the loop tab and opens a provider's model window", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);

  const widget = page.getByRole("button", { name: /choose provider/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });
  await widget.click();
  await expect(page.getByLabel("close providers")).toBeVisible();

  // The providers tab is the default view.
  await expect(page.getByText("available providers")).toBeVisible();

  await page.getByRole("button", { name: "loop", exact: true }).click();
  await expect(page.getByText("loop provider")).toBeVisible();

  // claude-code is always loop-runnable — the loop's own fallback default —
  // so its row is a stable anchor regardless of which providers this
  // instance has installed or signed into.
  const claudeRow = page.locator(".w-row", { hasText: "claude-code" });
  await expect(claudeRow).toBeVisible();

  await claudeRow.getByRole("button", { name: "models" }).click();
  await expect(page.getByText("claude-code · step models")).toBeVisible();

  // The overseer slot plus every loop step should be listed.
  await expect(page.locator(".loop-slot-name", { hasText: "overseer" })).toBeVisible();
  await expect(page.locator(".loop-slot-name", { hasText: "request" })).toBeVisible();
  await expect(page.locator(".loop-slot-name", { hasText: "review" })).toBeVisible();
});

test("shows a non-active provider's real models, not just a free-text field", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);

  const widget = page.getByRole("button", { name: /choose provider/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });
  await widget.click();
  await page.getByRole("button", { name: "loop", exact: true }).click();

  const cursorRow = page.locator(".w-row", { hasText: "cursor" });
  if ((await cursorRow.count()) === 0) test.skip();

  // Make cursor the loop's active provider, so opening claude-code's model
  // window below is deliberately the non-active case — the bug this covers
  // was the model list only ever working for whichever provider happened to
  // be selected.
  await cursorRow.click();
  await expect(cursorRow).toContainText("▪");

  const claudeRow = page.locator(".w-row", { hasText: "claude-code" });
  await claudeRow.getByRole("button", { name: "models" }).click();
  await expect(page.getByText("claude-code · step models")).toBeVisible();

  await page.locator(".loop-slot-head", { hasText: "overseer" }).click();
  // A real model list — not the free-text fallback, which has no listbox.
  const values = page.locator(".loop-slot-values").first();
  await expect(values).toBeVisible({ timeout: 15_000 });
  await expect(values.getByRole("option", { name: /sonnet|opus|haiku|default/i }).first()).toBeVisible();
});

test("cursor's loop row notes that delegation is not yet confirmed", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);

  const widget = page.getByRole("button", { name: /choose provider/i });
  await expect(widget).toBeVisible({ timeout: 45_000 });
  await widget.click();
  await page.getByRole("button", { name: "loop", exact: true }).click();

  const cursorRow = page.locator(".w-row", { hasText: "cursor" });
  // Present only when this image installs cursor (providers/cursor's
  // manifest, `loop: "bundle"`) — skip rather than fail on a build that
  // dropped the bundle for an unrelated reason.
  if ((await cursorRow.count()) === 0) test.skip();

  await expect(cursorRow).toContainText("delegation not yet confirmed");
});
