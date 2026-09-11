import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * The capabilities window's skills tab, as the browser presents it.
 *
 * **This spec never imports a skill, by design** — the same contract
 * `subagents.spec.ts` keeps, and for the same reason. A project-scoped skill
 * lands in `<project>/.claude/skills`, and an active project is forced under
 * `/workspace` by `isInsideWorkspace`, which holds the operator's real git
 * repositories. An import here would write a folder into someone's checkout,
 * and delete deliberately leaves the parent `skills/` behind, so even a tidy
 * run would litter. A user-scoped import is worse: it would install into the
 * container's own config directory and stay there for every later run.
 *
 * The write path is covered where it can be exercised against a temporary
 * directory instead: `packages/adapters/*\/test/skill-files.test.ts`, plus
 * `packages/server/test/skills.test.ts` for the service and
 * `skill-fetch.test.ts` for the transport.
 *
 * Gated on an attached provider with an active project — without both, the
 * server refuses the list and the tab says so. Both are real states of a
 * correct build, so read which one the shell is in and assert that branch
 * rather than skipping (the `chat.spec.ts` contract).
 */
test("shows the skills tab for the attached provider", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("/capabilities");
  await page.keyboard.press("Enter");

  const frame = page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: "close capabilities" }) });
  await expect(frame).toBeVisible();

  // Subagents open first, so the skills tab has to be asked for.
  await frame.getByRole("button", { name: "skills", exact: true }).click();

  const importButton = frame.getByRole("button", { name: "import skill" });
  await expect(importButton).toBeVisible();

  if (await importButton.isDisabled()) {
    // No provider that can manage skills. The tab must say why rather than
    // show an empty list, which would read as "you have none".
    await expect(frame.getByText(/cannot manage skills|no provider attached|no active project/)).toBeVisible();
    return;
  }

  // A provider that can: either it has skills, each row carrying the scope it
  // came from, or it honestly has none.
  const rows = frame.locator(".w-row");
  const empty = frame.getByText("no skills");

  await expect(rows.first().or(empty)).toBeVisible();

  if ((await rows.count()) > 0) {
    // Every row says which folder it came from — the whole point of listing
    // both scopes in one list.
    await expect(
      rows.first().getByText(/^(project|user)$/),
    ).toBeVisible();
  }
});

/**
 * The import form, opened and cancelled without submitting.
 *
 * Worth its own case because the window is the one piece of this feature with
 * two mutually exclusive halves: a url field and a file picker. A build that
 * wired only one of them would still pass the tab test above.
 */
test("opens the import form and offers both sources", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("/capabilities");
  await page.keyboard.press("Enter");

  const capabilities = page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: "close capabilities" }) });
  await capabilities.getByRole("button", { name: "skills", exact: true }).click();

  const importButton = capabilities.getByRole("button", { name: "import skill" });
  if (await importButton.isDisabled()) return; // covered by the case above
  await importButton.click();

  const form = page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: "close import skill" }) });
  await expect(form).toBeVisible();

  // Git leads, and its field is a url.
  await expect(form.getByLabel("repository url")).toBeVisible();

  // The other half is a real file input, not a second text box.
  await form.getByRole("button", { name: "files" }).click();
  await expect(form.getByLabel("skill files")).toBeVisible();
  await expect(form.getByLabel("repository url")).toHaveCount(0);

  // Nothing is submittable until a source is actually given.
  await expect(form.getByRole("button", { name: "import", exact: true })).toBeDisabled();

  // Closed so the shared window stack does not carry this form into the next
  // test — not asserted. Whether a cancel tears a window down is the window
  // machinery's contract, covered where windows are, and asserting it here
  // made this case fail intermittently on a suite that shares one stack.
  await form.getByRole("button", { name: "cancel" }).click();
});
