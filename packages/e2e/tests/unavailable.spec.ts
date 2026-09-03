import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * Windows whose surface exists but whose backing is not built must say so.
 * An empty frame reads as a working-but-idle surface — "queue empty" is a
 * claim about a queue that does not exist — so each of them carries the
 * `WUnavailable` note (`packages/web/src/components/windows/bits.tsx`).
 *
 * Only the two command-reachable ones are covered here: `context` opens from a
 * session's control row and `diff` from a tool turn's inspect, neither of
 * which exists without a signed-in provider and a live turn.
 *
 * When one of these goes live, this expectation is what should fail.
 */
for (const { command, window, detail } of [
  {
    command: "/approvals",
    window: "approvals",
    detail: /permission requests are auto-denied/i,
  },
  {
    command: "/capabilities",
    window: "capabilities",
    detail: /not read from the provider yet/i,
  },
]) {
  test(`${window} declares itself unavailable`, async ({ page }) => {
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
    await expect(frame.getByText(/not available yet/i)).toBeVisible();
    await expect(frame.getByText(detail)).toBeVisible();
  });
}
