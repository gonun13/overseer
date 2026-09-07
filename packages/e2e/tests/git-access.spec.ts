import { test, expect } from "@playwright/test";
import { passWizardOpening } from "./shell";

/**
 * Git access, split as two surfaces: a status summary in the settings panel,
 * and the actual configuration (ssh key, identity) in its own window opened
 * from there. That split is what §6.1 of the design draws between "the
 * machine" (a panel) and "the work" (a window) — setting up git access is a
 * task with enough surface of its own to earn a window.
 *
 * Deliberately does not generate a key: the stack keeps `agent-home` between
 * runs, so a spec that generated one would either leave it behind for every
 * later run or have to delete a key the operator may have added on purpose.
 */
async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/");
  await passWizardOpening(page);
  // Exact: "close settings" inside the panel matches a loose /settings/.
  await page.getByRole("button", { name: "settings", exact: true }).click();
}

const gitConfigWindow = (page: import("@playwright/test").Page) =>
  page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: "close git config" }) });

test("settings shows a git access summary, not the controls themselves", async ({
  page,
}) => {
  await openSettings(page);

  const panel = page.getByRole("complementary");
  await expect(panel.getByText("git access")).toBeVisible();
  await expect(panel.getByText("ssh key")).toBeVisible();
  await expect(panel.getByText("identity")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "configure git" }),
  ).toBeVisible();

  // The setup controls live in the window this button opens, not here.
  await expect(
    panel.getByRole("button", { name: /generate key|remove key/i }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("textbox", { name: "git author name" }),
  ).toHaveCount(0);
});

test("configure git opens the ssh key and identity controls", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole("button", { name: "configure git" }).click();

  const win = gitConfigWindow(page);
  await expect(win).toBeVisible();

  // Either state is legitimate depending on what earlier runs left behind.
  const generate = win.getByRole("button", { name: /generate key/i });
  const remove = win.getByRole("button", { name: /remove key/i });
  await expect(generate.or(remove).first()).toBeVisible();

  // The identity fields are always offered, key or no key.
  await expect(win.getByRole("textbox", { name: "git author name" })).toBeVisible();
  await expect(win.getByRole("textbox", { name: "git author email" })).toBeVisible();
});

test("the git identity fields do not answer to the wizard's name ask", async ({
  page,
}) => {
  // Regression: these fields shipped with placeholder "your name" and no
  // label, so `getByRole("textbox", { name: /your name/i })` — the locator
  // every spec uses to answer the wizard's first turn — matched them instead.
  // The whole suite then typed its operator name into a git identity field
  // and waited out the tone beat that never came.
  await openSettings(page);
  await page.getByRole("button", { name: "configure git" }).click();
  await expect(gitConfigWindow(page)).toBeVisible();

  await expect(
    page.getByRole("textbox", { name: /your name/i }),
  ).toHaveCount(0);
});
