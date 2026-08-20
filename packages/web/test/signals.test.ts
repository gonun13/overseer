import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSignals, headlineFor } from "../src/state/signals.ts";

const baseWorld = {
  projects: [],
  sessions: [],
  approvals: [],
  capabilities: [],
  provider: {
    name: "claude-code",
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
    assert.equal(usage.headline, undefined);
    assert.match(usage.text, /^claude-code · 83% of the week window is spent\.$/);
    assert.equal(headlineFor(signals).text, "attention");
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
    assert.equal(usage.headline, undefined);
    assert.match(
      usage.text,
      /^claude-code · week limit reached · sessions cannot start until it resets\.$/,
    );
    assert.equal(headlineFor(signals).text, "blocked");
  });

  it("omits usage signals below the warning threshold", () => {
    const signals = deriveSignals({
      ...baseWorld,
      provider: {
        ...baseWorld.provider,
        usage: [{ id: "week", label: "week", used: 0.79 }],
      },
    });
    assert.equal(signals.find((signal) => signal.id === "usage"), undefined);
  });
});

describe("deriveSignals session attention", () => {
  it("names what went wrong, not only the session", () => {
    const signals = deriveSignals({
      ...baseWorld,
      sessions: [
        {
          id: "s1",
          activity: "attention",
          name: "new session",
          projectId: "/workspace/demo",
          branch: "",
          model: "",
          cost: "",
          doing: "You've hit your weekly limit · resets 3am (UTC)",
        },
      ],
    });
    const session = signals.find((signal) => signal.id === "session-s1");
    assert.ok(session);
    assert.match(
      session.text,
      /^new session · You've hit your weekly limit · resets 3am \(UTC\)\.$/,
    );
  });

  it("falls back when attention has no detail yet", () => {
    const signals = deriveSignals({
      ...baseWorld,
      sessions: [
        {
          id: "s1",
          activity: "attention",
          name: "new session",
          projectId: "/workspace/demo",
          branch: "",
          model: "",
          cost: "",
          doing: "",
        },
      ],
    });
    const session = signals.find((signal) => signal.id === "session-s1");
    assert.ok(session);
    assert.equal(session.text, "new session needs attention.");
  });
});
