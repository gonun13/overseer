import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { AdapterStatus, ServerMessage } from "@overseer/protocol";
import { passWizardOpening, providersFrame, SETTLED } from "./shell";

/** Browser-only wire fixture: no test signs in, launches inference or changes
 * the shared server's attached provider. The real broker is covered separately. */
async function codexWire(
  page: Page,
  theme: "samaritan" | "machine",
  initial: AdapterStatus,
) {
  let route!: WebSocketRoute;
  let status = initial;
  let attached = "opencode";
  let device = false;
  let checks = 0;
  const providers = () => [
    {
      id: "opencode",
      login: false,
      usageCheck: false,
      catalogOnly: true as const,
      status: { authenticated: false },
    },
    { id: "codex", login: true, usageCheck: true, usageRefresh: true, status },
  ];
  const send = (frame: ServerMessage) => route.send(JSON.stringify(frame));
  await page.routeWebSocket("**/ws", (ws) => {
    route = ws;
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "discovery.run") {
        send({ type: "discovery.start", runId: "codex-browser" });
        send({
          type: "discovery.complete",
          runId: "codex-browser",
          returning: true,
          workspaceRoot: "/workspace",
          projects: [{ name: "fixture", path: "/workspace/fixture" }],
          activeProjectPath: "/workspace/fixture",
          attachedProviderId: attached,
          providers: providers(),
          personality: { name: "Ada", tone: "neutral", typingChance: 0 },
        });
      }
      if (frame.type === "provider.connect") {
        attached = frame.id;
        send({ type: "provider.connected", id: attached });
      }
      if (frame.type === "auth.start") {
        device = true;
        send({
          type: "auth.state",
          providerId: "codex",
          phase: "awaiting-browser",
          verificationUrl: "https://auth.openai.com/codex/device",
          userCode: "TEST-5678",
        });
      }
      if (frame.type === "auth.cancel") {
        device = false;
        send({
          type: "auth.state",
          providerId: "codex",
          phase: "failed",
          detail: "login cancelled",
          status: { authenticated: false },
        });
      }
      if (frame.type === "provider.checkUsage") {
        checks++;
        status = {
          authenticated: true,
          usageState: "ready",
          usage: [
            {
              id: "codex:primary",
              label: "5 hours",
              used: 0.42,
              resets: "2026-10-08 12:00:00 UTC",
            },
          ],
        };
        send({ type: "provider.status", id: "codex", status });
        send({
          type: "provider.usageCheck",
          id: "codex",
          windows: status.usage!,
          report: "5 hours: 42% used",
        });
      }
    });
    send({
      type: "connected",
      serverTime: new Date().toISOString(),
      returning: true,
      theme,
      personality: { name: "Ada", tone: "neutral", typingChance: 0 },
    });
    if (device)
      send({
        type: "auth.state",
        providerId: "codex",
        phase: "awaiting-browser",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "TEST-5678",
      });
  });
  return { send, checks: () => checks };
}

async function attach(page: Page) {
  await page.goto("/");
  await passWizardOpening(page);
  await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "choose provider" }).click();
  const frame = providersFrame(page);
  await frame.locator(".w-row", { hasText: "codex" }).click();
  await frame.getByRole("button", { name: "connect", exact: true }).click();
  return frame;
}

for (const theme of ["samaritan", "machine"] as const) {
  test(`Codex browser device login and reconnect · ${theme} · reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await codexWire(page, theme, { authenticated: false });
    let frame = await attach(page);
    await expect(frame.getByText("sign in · codex")).toBeVisible();
    await frame.getByRole("button", { name: "start login" }).click();
    await expect(frame.getByText("TEST-5678")).toBeVisible();
    await expect(
      frame.getByRole("link", { name: "open verification link" }),
    ).toHaveAttribute("href", "https://auth.openai.com/codex/device");
    await expect(
      frame.getByRole("textbox", { name: "verification code" }),
    ).toHaveCount(0);
    await page.reload();
    await passWizardOpening(page);
    await expect(page.getByText(SETTLED)).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: "choose provider" }).click();
    frame = providersFrame(page);
    await expect(frame.getByText("TEST-5678")).toBeVisible();
    await expect(
      frame.getByRole("textbox", { name: "verification code" }),
    ).toHaveCount(0);
    await frame.getByRole("button", { name: "cancel", exact: true }).click();
    await expect(
      frame.getByRole("button", { name: "try again" }),
    ).toBeVisible();
    await expect(frame.getByText("TEST-5678")).toHaveCount(0);
  });

  test(`Codex background usage, unavailable and manual reading · ${theme}`, async ({
    page,
  }) => {
    const wire = await codexWire(page, theme, {
      authenticated: true,
      usageState: "pending",
    });
    await attach(page);
    await page.getByLabel("close providers").click();
    const widget = page.locator(".widget");
    await expect(widget).toContainText("retrieving usage");
    await expect(
      widget.getByRole("button", { name: "check usage" }),
    ).toBeVisible();
    wire.send({
      type: "provider.status",
      id: "codex",
      status: { authenticated: true, usageState: "unavailable" },
    });
    await expect(widget).toContainText("usage currently not available");
    await expect(widget).toContainText("signed in");
    await widget.getByRole("button", { name: "check usage" }).click();
    await expect(widget).toContainText("42%");
    await expect(widget).toContainText("5 hours");
    await expect(widget).toContainText("2026-10-08");
    expect(wire.checks()).toBe(1);
    wire.send({
      type: "provider.status",
      id: "codex",
      status: {
        authenticated: true,
        usageState: "ready",
        usage: [{ id: "codex:primary", label: "15 minutes", used: 0.6 }],
      },
    });
    await expect(widget).toContainText("60%");
    await expect(widget).toContainText("15 minutes");
    await expect(widget).not.toContainText("42%");
  });
}
