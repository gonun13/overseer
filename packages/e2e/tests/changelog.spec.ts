import { test, expect } from "@playwright/test";
import rootPkg from "../../../package.json" with { type: "json" };
import { passWizardOpening, SETTLED } from "./shell";

/**
 * The changelog window renders the root `CHANGELOG.md`, so these assertions
 * are about the file reaching the screen at all — not about any one entry's
 * wording, which changes every release.
 *
 * The running version has to be a heading in it: a bump that ships without a
 * section is exactly the omission docs/architecture-design.md §8.3 step 3
 * exists to prevent, and this is where it should fail.
 */
const changelog = (page: import("@playwright/test").Page) =>
  page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: "close changelog" }) });

test("the /changelog command opens the release notes", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("/changelog");
  await page.keyboard.press("Enter");

  const window = changelog(page);
  await expect(window).toBeVisible();
  // The version this build reports, marked as the one being run.
  await expect(
    window.getByText(new RegExp(`${rootPkg.version.replaceAll(".", "\\.")}.*current`)),
  ).toBeVisible();
});

test("clicking the footer version opens the changelog", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);

  // The version is the handle: an operator who notices the number is the one
  // asking what changed in it.
  await page.getByRole("button", { name: SETTLED }).click({ timeout: 45_000 });
  await expect(changelog(page)).toBeVisible();
});
