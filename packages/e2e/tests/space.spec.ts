import { test, expect } from "@playwright/test";
import { passWizardOpening, SETTLED } from "./shell";

/**
 * The overseer space: one API behind the message, the signals and the status
 * window.
 *
 * The bug these guard is a row outliving the fact behind it. Discovery writes
 * "checking provider auth" and "releasing the prompt" at boot; when provider
 * auth later changes, those two rows have to correct themselves rather than
 * having a contradicting line appended underneath.
 */

test("the status window carries the provider rows, one each", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const window = page.locator(".w-steps");
  await expect(window.getByText(/checking provider auth/i)).toHaveCount(1);
  await expect(window.getByText(/releasing the prompt/i)).toHaveCount(1);
});

test("the provider rows agree with each other", async ({ page }) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const rows = page.locator(".w-steps");
  const auth = rows
    .locator(".w-step")
    .filter({ hasText: /checking provider auth/i });
  const prompt = rows
    .locator(".w-step")
    .filter({ hasText: /releasing the prompt/i });

  // Both rows come from one predicate now, so they cannot disagree about
  // whether the prompt is held. They used to be two separate pieces of code —
  // frozen server prose and a live client gate — and only one of them could
  // ever be wrong.
  const authed = !/not authenticated/i.test((await auth.textContent()) ?? "");
  await expect(prompt).toContainText(authed ? /prompt ready/i : /held/i);

  // Deliberately observe-only. Driving a real sign-out here would sign the
  // operator out of their own dev stack, and the supersession itself is
  // covered without side effects in the unit tests
  // (packages/server/test/overseer-space.test.ts).
});

test("the message surface is one uppercase line of text", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

  const message = page.locator(".os-message").first();
  await expect(message).toBeVisible();
  // The shout is the field's register, not decoration on the old one-word
  // form — losing it would make the overseer read as speech, not machine.
  await expect(message).toHaveCSS("text-transform", "uppercase");
  // No light here. The rule beneath reads motion and the top signal carries
  // the state, so an instrument on this line would be the third one.
  await expect(message.locator(".light")).toHaveCount(0);
});
