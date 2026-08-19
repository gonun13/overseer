import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderOptions, SessionMeta } from "@overseer/protocol";
import {
  BLANK_SESSION_SETTINGS,
  headLabel,
  labelForValue,
  SESSION_CONTROL_KEYS,
  sessionOptionsFrom,
} from "../src/session.ts";
import { settingsFromMeta } from "../src/state/session-events.ts";

const REPORTED: ProviderOptions = {
  models: [
    { value: "default", label: "Default (recommended)", detail: "Sonnet 5" },
    { value: "opus", label: "Opus", detail: "Opus 5" },
  ],
  permissionModes: [
    { value: "auto", label: "auto" },
    { value: "bypassPermissions", label: "bypassPermissions", danger: true },
  ],
  agents: [
    { value: "", label: "none" },
    { value: "Explore", label: "Explore" },
  ],
  defaultPermissionMode: "auto",
};

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    adapterId: "claude-code",
    projectDir: "/workspace/demo",
    model: "",
    status: "live",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-01T00:00:00.000Z",
    totalCostUsd: 0,
    ...overrides,
  };
}

describe("sessionOptionsFrom", () => {
  it("leaves every row empty before the provider has reported", () => {
    const options = sessionOptionsFrom(undefined);
    assert.deepEqual(
      options.map((o) => o.key),
      SESSION_CONTROL_KEYS,
    );
    for (const option of options) assert.deepEqual(option.values, []);
  });

  it("routes each reported list to its own row", () => {
    const options = sessionOptionsFrom(REPORTED);
    const byKey = new Map(options.map((o) => [o.key, o.values]));
    assert.deepEqual(byKey.get("model"), REPORTED.models);
    assert.deepEqual(byKey.get("mode"), REPORTED.permissionModes);
    assert.deepEqual(byKey.get("agent"), REPORTED.agents);
  });

  it("keeps the row order the digit shortcuts depend on", () => {
    assert.deepEqual(
      sessionOptionsFrom(REPORTED).map((o) => o.label),
      ["model", "mode", "agent"],
    );
  });
});

describe("labelForValue", () => {
  const [model, mode, agent] = sessionOptionsFrom(REPORTED);

  it("prints the provider's display name, not the raw value", () => {
    assert.equal(labelForValue(model!, "opus"), "Opus");
    assert.equal(labelForValue(model!, "default"), "Default (recommended)");
  });

  it("says nothing for a row the operator has not set", () => {
    assert.equal(labelForValue(model!, ""), undefined);
    assert.equal(labelForValue(mode!, ""), undefined);
  });

  it("says 'none' for the agent row, matching what the menu marks", () => {
    // The "none" entry's value *is* "", so an unset agent row and a chosen
    // "none" are one state — and the head must not read "—" while the list
    // marks NONE as current.
    assert.equal(labelForValue(agent!, ""), "none");
    assert.equal(labelForValue(agent!, "Explore"), "Explore");
  });

  it("falls back to the raw value a live session is actually running", () => {
    // A session started on a model the menu no longer lists must still read
    // truthfully rather than blank.
    assert.equal(labelForValue(model!, "claude-sonnet-4"), "claude-sonnet-4");
  });
});

describe("headLabel", () => {
  const [model, , agent] = sessionOptionsFrom(REPORTED);

  it("drops a trailing parenthetical the head has no room for", () => {
    // The menu still shows "Default (recommended)" in full.
    assert.equal(labelForValue(model!, "default"), "Default (recommended)");
    assert.equal(headLabel(model!, "default"), "Default");
  });

  it("leaves an ordinary label alone", () => {
    assert.equal(headLabel(model!, "opus"), "Opus");
    assert.equal(headLabel(agent!, ""), "none");
  });

  it("keeps a label that is nothing but a parenthetical", () => {
    const option = {
      key: "model" as const,
      label: "model",
      values: [{ value: "x", label: "(unnamed)" }],
    };
    assert.equal(headLabel(option, "x"), "(unnamed)");
  });

  it("says nothing when there is nothing to say", () => {
    assert.equal(headLabel(model!, ""), undefined);
  });
});

describe("settingsFromMeta", () => {
  it("hydrates model and mode from what the server reported", () => {
    assert.deepEqual(
      settingsFromMeta(meta({ model: "claude-opus-5", permissionMode: "plan" })),
      { model: "claude-opus-5", mode: "plan" },
    );
  });

  it("reports nothing for fields the provider has not told us", () => {
    // Merged over BLANK, this leaves the rows reading "—" rather than a guess.
    assert.deepEqual(settingsFromMeta(meta()), {});
    assert.deepEqual(
      { ...BLANK_SESSION_SETTINGS, ...settingsFromMeta(meta()) },
      { model: "", mode: "", agent: "" },
    );
  });

  it("never invents an agent — the provider does not report one per session", () => {
    assert.equal(
      "agent" in settingsFromMeta(meta({ model: "x", permissionMode: "auto" })),
      false,
    );
  });
});
