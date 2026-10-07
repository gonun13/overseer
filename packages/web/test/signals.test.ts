import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConsoleInfo } from "@overseer/protocol";
import { deriveSignals, messageFor } from "../src/state/signals.ts";

function consoleInfo(extra: Partial<ConsoleInfo>): ConsoleInfo {
  return {
    id: "c1",
    kind: "agent",
    projectPath: "/workspace/demo",
    providerId: "claude",
    title: "claude · demo",
    startedAt: "2026-10-02T00:00:00Z",
    status: "running",
    activity: "idle",
    hooked: true,
    ...extra,
  };
}

const baseWorld = {
  projects: [],
  consoles: [] as ConsoleInfo[],
  provider: {
    name: "claude",
    authenticated: true,
    usage: [] as { id: string; label: string; used: number }[],
  },
};

describe("deriveSignals usage", () => {
  it("warns at high usage — attention, not blocked", () => {
    const signals = deriveSignals({
      ...baseWorld,
      provider: {
        ...baseWorld.provider,
        usage: [{ id: "week", label: "week", used: 0.83 }],
      },
    });
    const usage = signals.find((signal) => signal.id === "usage");
    assert.ok(usage);
    assert.equal(usage.activity, "attention");
    assert.equal(usage.message, undefined);
    assert.match(usage.text, /^claude · 83% of the week window is spent\.$/);
    assert.equal(messageFor(signals).key, "attention");
  });

  it("blocks only when a window is at its limit", () => {
    const signals = deriveSignals({
      ...baseWorld,
      provider: {
        ...baseWorld.provider,
        usage: [{ id: "week", label: "week", used: 1 }],
      },
    });
    const usage = signals.find((signal) => signal.id === "usage");
    assert.ok(usage);
    assert.equal(usage.activity, "waiting");
    assert.equal(usage.message, undefined);
    assert.match(
      usage.text,
      /^claude · week limit reached · sessions cannot start until it resets\.$/,
    );
    assert.equal(messageFor(signals).key, "blocked");
  });

  it("omits usage signals below the warning threshold", () => {
    const signals = deriveSignals({
      ...baseWorld,
      provider: {
        ...baseWorld.provider,
        usage: [{ id: "week", label: "week", used: 0.79 }],
      },
    });
    assert.equal(
      signals.find((signal) => signal.id === "usage"),
      undefined,
    );
  });
});

describe("deriveSignals consoles", () => {
  it("points at a console whose CLI is waiting on the operator", () => {
    const signals = deriveSignals({
      ...baseWorld,
      consoles: [consoleInfo({ activity: "waiting" })],
    });
    const waiting = signals.find((signal) => signal.id === "waiting-c1");
    assert.ok(waiting);
    assert.equal(waiting.activity, "approval");
    assert.deepEqual(waiting.target, { kind: "console", id: "c1" });
    assert.equal(signals[0], waiting);
  });

  it("says nothing about a console that is merely working", () => {
    const signals = deriveSignals({
      ...baseWorld,
      consoles: [consoleInfo({ activity: "working" })],
    });
    assert.equal(
      signals.some((signal) => signal.id.endsWith("c1")),
      false,
    );
  });

  it("reports a console that died with an error, not one that was ended", () => {
    const failed = deriveSignals({
      ...baseWorld,
      consoles: [consoleInfo({ status: "exited", exitCode: 1 })],
    });
    assert.ok(failed.find((signal) => signal.id === "exited-c1"));
    const killed = deriveSignals({
      ...baseWorld,
      consoles: [consoleInfo({ status: "exited", exitCode: 0, signal: 15 })],
    });
    assert.equal(
      killed.find((signal) => signal.id === "exited-c1"),
      undefined,
    );
  });

  it("reads 128 + signal exit codes as ended, not failed", () => {
    for (const exitCode of [129, 130, 137, 143]) {
      const ended = deriveSignals({
        ...baseWorld,
        consoles: [consoleInfo({ status: "exited", exitCode })],
      });
      assert.equal(
        ended.find((signal) => signal.id === "exited-c1"),
        undefined,
        `${exitCode}`,
      );
    }
  });
});

describe("deriveSignals relays", () => {
  it("asks the operator about a held agent relay, releasing it when followed", () => {
    const signals = deriveSignals({
      ...baseWorld,
      heldRelays: [
        { id: "h1", from: "Bob", to: "Linda", text: "rebuild it", at: "" },
      ],
    });
    const held = signals.find((s) => s.id === "relay-h1")!;
    assert.equal(held.activity, "approval");
    assert.deepEqual(held.target, { kind: "relay", id: "h1" });
    assert.match(held.text, /^Bob wants to relay to Linda: "rebuild it"/);
  });

  it("names a waiting console by its callsign first", () => {
    const signals = deriveSignals({
      ...baseWorld,
      consoles: [consoleInfo({ activity: "waiting", callsign: "Linda" })],
    });
    assert.equal(
      signals.find((s) => s.id === "waiting-c1")!.text,
      "Linda (claude · demo) is waiting for you.",
    );
  });
});
