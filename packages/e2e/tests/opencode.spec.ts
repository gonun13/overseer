import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { ServerMessage } from "@overseer/protocol";
import {
  openProviders,
  passWizardOpening,
  providersFrame,
  SETTLED,
} from "./shell";

/** Browser-only wire fixture: opencode attached and ready on its free models.
 * Nothing here changes the shared server's attached provider or auth. */
async function opencodeWire(page: Page, theme: "samaritan" | "machine") {
  let route!: WebSocketRoute;
  const send = (frame: ServerMessage) => route.send(JSON.stringify(frame));
  await page.routeWebSocket("**/ws", (ws) => {
    route = ws;
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type !== "discovery.run") return;
      send({ type: "discovery.start", runId: "opencode-browser" });
      send({
        type: "discovery.complete",
        runId: "opencode-browser",
        returning: true,
        workspaceRoot: "/workspace",
        projects: [{ name: "fixture", path: "/workspace/fixture" }],
        activeProjectPath: "/workspace/fixture",
        attachedProviderId: "opencode",
        providers: [
          {
            id: "opencode",
            login: false,
            usageCheck: false,
            usageRefresh: false,
            status: {
              authenticated: true,
              version: "1.19.4",
              detail: "ready · free models",
              usageState: "unavailable",
            },
          },
        ],
        personality: { name: "Ada", tone: "neutral", typingChance: 0 },
      });
    });
    send({
      type: "connected",
      serverTime: new Date().toISOString(),
      returning: true,
      theme,
      personality: { name: "Ada", tone: "neutral", typingChance: 0 },
    });
  });
}

for (const theme of ["samaritan", "machine"] as const) {
  test(`opencode reads ready with no sign-in or usage controls · ${theme}`, async ({
    page,
  }) => {
    await opencodeWire(page, theme);
    await page.goto("/");
    await passWizardOpening(page);
    await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });

    const widget = page.getByRole("button", { name: "choose provider" });
    await expect(widget).toContainText("opencode");
    await expect(widget).toContainText("ready · free models");
    await expect(widget).not.toContainText("usage currently not available");
    await expect(
      page.getByRole("button", { name: /check usage/i }),
    ).toHaveCount(0);

    await widget.click();
    const frame = providersFrame(page);
    await expect(
      frame.locator(".w-row", { hasText: "opencode" }),
    ).toContainText("ready · free models · attached");
    await expect(
      frame.getByRole("button", { name: "sign out", exact: true }),
    ).toHaveCount(0);
    await expect(
      frame.getByRole("button", { name: "start login" }),
    ).toHaveCount(0);
  });
}

test("opencode is a loop provider whose delegation is not yet confirmed", async ({
  page,
}) => {
  await page.goto("/");
  await passWizardOpening(page);
  await openProviders(page);
  await page.getByRole("button", { name: "loop", exact: true }).click();

  const row = page.locator(".w-row", { hasText: "opencode" });
  await expect(row).toContainText("delegation not yet confirmed");

  // Read-only: opening the model window lists what the CLI can run now,
  // without selecting anything.
  await row.getByRole("button", { name: "models" }).click();
  await expect(page.getByText("opencode · step models")).toBeVisible();
});
