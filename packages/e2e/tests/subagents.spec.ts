import { test, expect } from "@playwright/test";
import { passWizardOpening, runTag, SETTLED } from "./shell";

/**
 * The capabilities window's subagents tab: the operator's own
 * `.claude/agents/*.md` files, created and removed from the browser.
 *
 * Gated on an attached provider with an active project — without both, the
 * server refuses the list and the tab says so. Both outcomes are real states
 * of a correct build, so read which one the shell is in and assert that
 * branch rather than skipping (the `chat.spec.ts` contract).
 *
 * The agent is named with a per-run tag. The dev stack's volumes survive
 * between runs, so a fixed name would be written once and then collide with
 * itself forever after — the write path refuses a name that is already taken.
 */
test("creates, edits and removes a subagent", async ({ page }) => {
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
    await expect(frame.getByText(/cannot manage subagents|no active project|no provider attached/i)).toBeVisible();
    return;
  }

  const name = `e2e-agent-${runTag().toLowerCase()}`;
  await add.click();

  const form = page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: /close new subagent/i }) });
  await expect(form).toBeVisible();

  await form.getByLabel("name").fill(name);
  await form.getByLabel("description").fill("An end-to-end test agent");
  await form.getByLabel("instructions").fill("You are a test fixture.");
  await form.getByRole("button", { name: "save" }).click();

  // The form closes on its own acknowledgement, and the row arrives on the
  // list the server broadcasts after the write.
  await expect(form).toHaveCount(0);
  const row = frame.locator(".w-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText("An end-to-end test agent");
  await expect(row).toContainText("project");

  // Editing loads the file off disk rather than a blank draft.
  await row.getByRole("button", { name: "edit" }).click();
  const editor = page
    .locator(".window")
    .filter({ has: page.getByRole("button", { name: `close ${name}` }) });
  await expect(editor.getByLabel("instructions")).toHaveValue(
    "You are a test fixture.",
  );
  await editor.getByLabel("description").fill("Edited by the test");
  await editor.getByRole("button", { name: "save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(frame.locator(".w-row").filter({ hasText: name })).toContainText(
    "Edited by the test",
  );

  // Removal asks once in place, then the row goes.
  const remove = frame
    .locator(".w-row")
    .filter({ hasText: name })
    .getByRole("button", { name: "remove" });
  await remove.click();
  await frame
    .locator(".w-row")
    .filter({ hasText: name })
    .getByRole("button", { name: "confirm" })
    .click();
  await expect(frame.locator(".w-row").filter({ hasText: name })).toHaveCount(0);
});
