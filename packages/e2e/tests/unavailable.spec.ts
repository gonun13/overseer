import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * Windows whose surface exists but whose backing is not built must say so.
 * An empty frame reads as a working-but-idle surface — "queue empty" is a
 * claim about a queue that does not exist — so each of them carries the
 * `WUnavailable` note (`packages/web/src/components/windows/bits.tsx`).
 *
 * Only the command-reachable ones are covered here: `context` opens from a
 * session's control row and `diff` from a tool turn's inspect, neither of
 * which exists without a signed-in provider and a live turn. Approvals used to
 * be covered too — they are live now, inline in the session, so there is no
 * unavailable surface left to assert on.
 *
 * The capabilities window is now partly live — its subagents tab reads real
 * files — so the two tabs that are not carry the note instead of the window,
 * and `tab` says which one to open first. When one of those goes live, this
 * expectation is what should fail.
 */
for (const { command, window, tab, detail, label } of [
  {
    command: "/capabilities",
    window: "capabilities",
    tab: "mcp",
    detail: /mcp servers are not read from the provider yet/i,
  },
  {
    command: "/capabilities",
    window: "capabilities",
    tab: "skills",
    label: "capabilities · skills",
    detail: /skills are not read from the provider yet/i,
  },
]) {
  test(`${label ?? window} declares itself unavailable`, async ({ page }) => {
    await page.goto("/");
    await passWizardOpening(page);
    await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type(command);
    await page.keyboard.press("Enter");

    // Windows carry no role — the close control's label is the only thing
    // that names one, so it is what identifies the frame.
    const frame = page
      .locator(".window")
      .filter({ has: page.getByRole("button", { name: `close ${window}` }) });
    await expect(frame).toBeVisible();
    // A tabbed window carries the note per tab: the window as a whole is not
    // unavailable, only these two parts of it.
    if (tab !== undefined) {
      await frame.getByRole("button", { name: tab, exact: true }).click();
    }
    await expect(frame.getByText(/not available yet/i)).toBeVisible();
    await expect(frame.getByText(detail)).toBeVisible();
  });
}
