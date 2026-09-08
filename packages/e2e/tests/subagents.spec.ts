import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * The capabilities window's subagents tab: the operator's own agent files, as
 * the browser presents them.
 *
 * **This spec never writes an agent, by design.** A subagent lives in its
 * project (`<project>/.cursor/agents`, `<project>/.claude/agents`), and an
 * active project is forced under `/workspace` by `isInsideWorkspace` — which
 * holds the operator's real git repositories. A CRUD run here would therefore
 * have to create files inside one of those repos, and the delete path
 * deliberately leaves the folder behind, so even a tidy run leaves litter in
 * someone's checkout. The container's own agents belong at the overseer root,
 * and if none are there for a run, the honest assertion is the empty tab.
 *
 * The write path is covered where it can be exercised against a temporary
 * directory instead: `packages/adapters/*\/test/subagent-files.test.ts`.
 *
 * Gated on an attached provider with an active project — without both, the
 * server refuses the list and the tab says so. Both outcomes are real states
 * of a correct build, so read which one the shell is in and assert that
 * branch rather than skipping (the `chat.spec.ts` contract).
 */
test("shows the subagents tab for the attached provider", async ({ page }) => {
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

  // The subagents tab opens first — it is the only one that does anything.
  const add = frame.getByRole("button", { name: "+ subagent" });
  await expect(add).toBeVisible();

  if (await add.isDisabled()) {
    // No provider that can manage subagents. The tab must say why rather than
    // show an empty list, which would read as "you have none".
    await expect(
      frame.getByText(
        /cannot manage subagents|no active project|no provider attached/i,
      ),
    ).toBeVisible();
    return;
  }

  // This provider can manage them, so the tab is a working list rather than a
  // refusal — every row it draws is a real file, and the control that would
  // add one is live. Asserting the surface is as far as this goes: clicking
  // through would write into the attached workspace project. See the header.
  await expect(
    frame.getByText(/cannot manage subagents|no provider attached/i),
  ).toHaveCount(0);

  for (const row of await frame.locator(".w-row").all()) {
    await expect(row.getByRole("button", { name: "edit" })).toBeVisible();
  }
});
