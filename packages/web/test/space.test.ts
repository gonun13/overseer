import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpaceStatusEntry } from "@overseer/protocol";
import {
  EMPTY_SPACE,
  applyDiscoveryStep,
  applySpaceFrame,
  spaceRows,
} from "../src/state/space.ts";

function row(
  over: Partial<SpaceStatusEntry> & Pick<SpaceStatusEntry, "key">,
): SpaceStatusEntry {
  return {
    service: "providers",
    mode: "state",
    label: "checking provider auth",
    outcome: "blocked",
    at: new Date().toISOString(),
    ...over,
  };
}

describe("space status rows", () => {
  it("supersedes a state row in place rather than stacking a second one", () => {
    // The reported bug: after signing in, the window still read
    // "checking provider auth... [BLOCKED] attached claude-code · not
    // authenticated" while the signal list had already corrected itself.
    let space = applySpaceFrame(EMPTY_SPACE, {
      type: "space.status",
      entry: row({ key: "auth", detail: "attached claude-code · not authenticated" }),
    });
    space = applySpaceFrame(space, {
      type: "space.status",
      entry: row({ key: "auth", outcome: "ok", detail: "attached claude-code" }),
    });

    const rows = spaceRows(space);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.outcome, "ok");
    assert.equal(rows[0]?.detail, "attached claude-code");
  });

  it("does not re-summon the window when a state row only revises itself", () => {
    // A row correcting itself is the window doing its job, not new work — and
    // re-opening a window the operator closed would break the "does not
    // re-summon itself" rule (docs/overseer-behavior.md §3).
    const first = applySpaceFrame(EMPTY_SPACE, {
      type: "space.status",
      entry: row({ key: "auth" }),
    });
    const revised = applySpaceFrame(first, {
      type: "space.status",
      entry: row({ key: "auth", outcome: "ok" }),
    });

    assert.equal(first.tick, 1);
    assert.equal(revised.tick, 1);
  });

  it("appends event rows instead of replacing them", () => {
    let space = EMPTY_SPACE;
    for (const label of ["committing a", "committing b"]) {
      space = applySpaceFrame(space, {
        type: "space.status",
        entry: row({ service: "git", key: "git:commit", mode: "event", label, outcome: "ok" }),
      });
    }

    const rows = spaceRows(space);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((entry) => entry.label),
      ["committing a", "committing b"],
    );
    // Each one is a happening, so each one is worth raising the window for.
    assert.equal(space.tick, 2);
  });

  it("clears a service's state rows without touching its event history", () => {
    let space = applySpaceFrame(EMPTY_SPACE, {
      type: "space.status",
      entry: row({ service: "workspace", key: "probe:/w/a", label: "git slow in a" }),
    });
    space = applySpaceFrame(space, {
      type: "space.status",
      entry: row({
        service: "workspace",
        key: "probe-recovered",
        mode: "event",
        label: "git reading a again",
        outcome: "ok",
      }),
    });
    space = applySpaceFrame(space, {
      type: "space.status.clear",
      service: "workspace",
      key: "probe:/w/a",
    });

    const rows = spaceRows(space);
    assert.deepEqual(
      rows.map((entry) => entry.label),
      ["git reading a again"],
    );
  });

  it("reads conditions before happenings", () => {
    let space = applySpaceFrame(EMPTY_SPACE, {
      type: "space.status",
      entry: row({ service: "git", key: "git:commit", mode: "event", label: "committing a", outcome: "ok" }),
    });
    space = applySpaceFrame(space, {
      type: "space.status",
      entry: row({ key: "auth" }),
    });

    assert.deepEqual(
      spaceRows(space).map((entry) => entry.label),
      ["checking provider auth", "committing a"],
    );
  });

  it("catches a joining tab up without springing the window open", () => {
    const space = applySpaceFrame(EMPTY_SPACE, {
      type: "space.replay",
      entries: [row({ key: "auth" }), row({ key: "prompt", label: "releasing the prompt" })],
    });

    assert.equal(spaceRows(space).length, 2);
    assert.equal(space.tick, 0);
  });
});

describe("discovery steps in the space", () => {
  it("lets a later report revise the row discovery wrote", () => {
    // Discovery's provider steps claim the canonical `providers` keys, which
    // is what makes them addressable by the login that follows.
    let space = applyDiscoveryStep(EMPTY_SPACE, {
      type: "discovery.step.start",
      runId: "r",
      id: "providers",
      label: "checking provider auth",
      service: "providers",
      spaceKey: "auth",
    });
    assert.equal(spaceRows(space)[0]?.outcome, "running");

    space = applyDiscoveryStep(space, {
      type: "discovery.step.done",
      runId: "r",
      id: "providers",
      outcome: "blocked",
      detail: "attached claude-code · not authenticated",
      service: "providers",
      spaceKey: "auth",
    });

    // Now the login reports the same key through the ordinary space API.
    space = applySpaceFrame(space, {
      type: "space.status",
      entry: row({ key: "auth", outcome: "ok", detail: "attached claude-code" }),
    });

    const rows = spaceRows(space);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.outcome, "ok");
  });

  it("keeps the label from the start frame when done carries none", () => {
    let space = applyDiscoveryStep(EMPTY_SPACE, {
      type: "discovery.step.start",
      runId: "r",
      id: "clock",
      label: "checking the time",
    });
    space = applyDiscoveryStep(space, {
      type: "discovery.step.done",
      runId: "r",
      id: "clock",
      outcome: "ok",
    });

    assert.equal(spaceRows(space)[0]?.label, "checking the time");
  });
});
