import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConsoleInfo } from "@overseer/protocol";
import type { Session } from "../src/domain.ts";
import { railRows } from "../src/state/session-rail.ts";
import { consoleToSession } from "../src/state/useSessions.ts";

function consoleOf(id: string, extra: Partial<ConsoleInfo> = {}): ConsoleInfo {
  return {
    id,
    kind: "agent",
    projectPath: "/workspace/a",
    providerId: "claude",
    title: "claude · a",
    startedAt: "2026-10-03T10:00:00Z",
    status: "running",
    activity: "idle",
    hooked: true,
    ...extra,
  };
}

function session(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    activity: "idle",
    name: id,
    projectId: "/workspace/a",
    providerId: "claude",
    branch: "",
    lastActiveAt: "2026-10-01T00:00:00Z",
    ...extra,
  };
}

describe("railRows", () => {
  it("lists shells in the one list with the agents, in console order", () => {
    const rows = railRows(
      [consoleOf("c1"), consoleOf("s1", { kind: "shell", title: "shell · a" })],
      [],
      "/workspace/a",
    );
    assert.deepEqual(
      rows.map((r) => r.kind === "console" && [r.console.id, r.name]),
      [
        ["c1", "claude"],
        ["s1", "shell"],
      ],
    );
  });

  it("lists a session a console holds once, as that console, under its callsign", () => {
    const rows = railRows(
      [consoleOf("c1", { sessionId: "x", callsign: "Linda" })],
      [session("x", { name: "refactor", consoleId: "c1" }), session("y")],
      "/workspace/a",
    );
    assert.equal(rows.length, 2);
    const [first, second] = rows;
    assert.ok(first?.kind === "console" && first.name === "Linda");
    assert.ok(second?.kind === "session" && second.session.id === "y");
  });

  it("names a console without a callsign by what it is, never its session's title", () => {
    const rows = railRows(
      [consoleOf("c1", { sessionId: "x" })],
      [session("x", { name: "refactor", consoleId: "c1" })],
      "/workspace/a",
    );
    const [first] = rows;
    assert.ok(first?.kind === "console" && first.name === "claude");
  });

  it("keeps consoles from every project but dormant sessions from the active one", () => {
    const rows = railRows(
      [consoleOf("c1", { projectPath: "/workspace/b" })],
      [session("y", { projectId: "/workspace/b" })],
      "/workspace/a",
    );
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["console"],
    );
  });
});

describe("consoleToSession", () => {
  it("makes a session of a console whose transcript has not reached disk", () => {
    const s = consoleToSession(consoleOf("c1", { sessionId: "x" }));
    assert.equal(s.id, "x");
    assert.equal(s.projectId, "/workspace/a");
    assert.equal(s.consoleId, "c1");
    assert.equal(s.origin, undefined);
  });
});
