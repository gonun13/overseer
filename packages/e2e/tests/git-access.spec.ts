import { test, expect } from "@playwright/test";
import { passWizardOpening } from "./shell";

/**
 * The settings panel's `git access` section.
 *
 * Deliberately does not generate a key: the stack keeps `agent-home` between
 * runs, so a spec that generated one would either leave it behind for every
 * later run or have to delete a key the operator may have added on purpose.
 * What is worth asserting is that the section renders and reports one of its
 * two real states — and, below, that its inputs do not answer to the wizard's
 * locators, which is a mistake that has already been made once.
 */
async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/");
  await passWizardOpening(page);
  // Exact: "close settings" inside the panel matches a loose /settings/.
  await page.getByRole("button", { name: "settings", exact: true }).click();
}

test("settings reports the container's git access", async ({ page }) => {
  await openSettings(page);

  const panel = page.getByRole("complementary");
  await expect(panel.getByText("git access")).toBeVisible();

  // Either state is legitimate depending on what earlier runs left behind.
  const generate = panel.getByRole("button", { name: /generate key/i });
  const remove = panel.getByRole("button", { name: /remove key/i });
  await expect(generate.or(remove).first()).toBeVisible();

  // The identity fields are always offered, key or no key.
  await expect(panel.getByRole("textbox", { name: "git author name" })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "git author email" })).toBeVisible();
});

test("the git identity fields do not answer to the wizard's name ask", async ({
  page,
}) => {
  // Regression: these fields shipped with placeholder "your name" and no
  // label, so `getByRole("textbox", { name: /your name/i })` — the locator
  // every spec uses to answer the wizard's first turn — matched the settings
  // panel instead. The whole suite then typed its operator name into a git
  // identity field and waited out the tone beat that never came.
  await openSettings(page);

  await expect(
    page.getByRole("textbox", { name: /your name/i }),
  ).toHaveCount(0);
});
