import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServerMessage } from "@overseer/protocol";
import { createOverseerSpace } from "../src/overseer/space.js";
import {
  authDetail,
  promptReady,
  reportProviderStatus,
} from "../src/overseer/provider-status.js";

function collector() {
  const sent: ServerMessage[] = [];
  return { sent, broadcast: (message: ServerMessage) => sent.push(message) };
}

const signedOut = [
  { id: "claude-code", status: { authenticated: false }, login: true, usageCheck: true },
];
const signedIn = [
  { id: "claude-code", status: { authenticated: true }, login: true, usageCheck: true },
];

describe("overseer space", () => {
  it("drops a state row that has not changed", () => {
    // Auth is re-reported from several paths; without this, a periodic
    // re-check would stutter the status window open over and over.
    const { sent, broadcast } = collector();
    const space = createOverseerSpace(broadcast);
    const entry = {
      service: "providers" as const,
      key: "auth",
      mode: "state" as const,
      label: "checking provider auth",
      outcome: "blocked" as const,
      detail: "attached claude-code · not authenticated",
    };

    space.status(entry);
    space.status(entry);

    assert.equal(sent.length, 1);
  });

  it("broadcasts a state row that did change", () => {
    const { sent, broadcast } = collector();
    const space = createOverseerSpace(broadcast);
    space.status({
      service: "providers",
      key: "auth",
      mode: "state",
      label: "checking provider auth",
      outcome: "blocked",
    });
    space.status({
      service: "providers",
      key: "auth",
      mode: "state",
      label: "checking provider auth",
      outcome: "ok",
    });

    assert.equal(sent.length, 2);
  });

  it("replays state rows but not event history", () => {
    const { broadcast } = collector();
    const space = createOverseerSpace(broadcast);
    space.status({
      service: "providers",
      key: "auth",
      mode: "state",
      label: "checking provider auth",
      outcome: "ok",
    });
    space.status({
      service: "git",
      key: "git:commit",
      mode: "event",
      label: "committing thing",
      outcome: "ok",
    });

    const replay = space.replay();
    assert.deepEqual(
      replay.entries.map((entry) => entry.key),
      ["auth"],
    );
  });

  it("clears a service's rows and says so once", () => {
    const { sent, broadcast } = collector();
    const space = createOverseerSpace(broadcast);
    space.status({
      service: "personality",
      key: "missing",
      mode: "state",
      label: "personality deleted",
      outcome: "blocked",
    });
    space.clear("personality", "missing");
    // Nothing left to clear — a second call must not put a frame on the wire.
    space.clear("personality", "missing");

    assert.equal(space.replay().entries.length, 0);
    assert.equal(
      sent.filter((message) => message.type === "space.status.clear").length,
      1,
    );
  });

  it("carries the last message into a replay", () => {
    const { broadcast } = collector();
    const space = createOverseerSpace(broadcast);
    space.say({ key: "authRestored", activity: "done", vars: { provider: "claude-code" } });
    assert.equal(space.replay().message?.key, "authRestored");
  });
});

describe("provider rows", () => {
  it("rewrites both rows in place when a login lands", () => {
    // The reported bug, at the level the server owns it: discovery writes the
    // signed-out rows at boot, and the login has to correct those same two
    // rather than append a contradiction under them.
    const { sent, broadcast } = collector();
    const space = createOverseerSpace(broadcast);

    reportProviderStatus(space, signedOut, "claude-code");
    reportProviderStatus(space, signedIn, "claude-code");

    const rows = space.replay().entries;
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => [row.key, row.outcome]),
      [
        ["auth", "ok"],
        ["prompt", "ok"],
      ],
    );
    assert.equal(
      rows.find((row) => row.key === "prompt")?.detail,
      "prompt ready",
    );
    assert.equal(sent.length, 4);
  });

  it("holds the prompt until the attached provider is the signed-in one", () => {
    assert.equal(promptReady(signedIn, "claude-code"), true);
    assert.equal(promptReady(signedOut, "claude-code"), false);
    // Signed in, but not the provider that is attached.
    assert.equal(promptReady(signedIn, "cursor"), false);
    assert.equal(promptReady(signedIn, undefined), false);
  });

  it("words the auth row the same way the signals do", () => {
    assert.equal(authDetail([], undefined), "no providers registered");
    assert.equal(authDetail(signedOut, undefined), "1 registered · none attached");
    assert.equal(
      authDetail(signedOut, "claude-code"),
      "attached claude-code · not authenticated",
    );
    assert.equal(authDetail(signedIn, "claude-code"), "attached claude-code");
  });
});
