import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConsoleInfo } from "@overseer/protocol";
import type { Project } from "../src/domain.ts";
import { projectsWithConsoleActivity } from "../src/state/project-activity.ts";

function consoleIn(projectPath: string, extra: Partial<ConsoleInfo>): ConsoleInfo {
  return {
    id: `${projectPath}-${extra.activity ?? "idle"}`,
    kind: "agent",
    projectPath,
    title: "claude",
    startedAt: "2026-10-02T00:00:00Z",
    status: "running",
    activity: "idle",
    hooked: true,
    ...extra,
  };
}

describe("projectsWithConsoleActivity", () => {
  const projects: Project[] = [
    { id: "/workspace/a", name: "a", path: "/workspace/a", branch: "main", activity: "idle" },
    { id: "/workspace/b", name: "b", path: "/workspace/b", branch: "main", activity: "idle" },
  ];

  it("marks a project working when a console in it is working", () => {
    const next = projectsWithConsoleActivity(projects, [
      consoleIn("/workspace/a", { activity: "working" }),
    ]);
    assert.equal(next[0]?.activity, "working");
    assert.equal(next[1]?.activity, "idle");
  });

  it("prefers a waiting CLI over a working one in the same project", () => {
    const next = projectsWithConsoleActivity(projects, [
      consoleIn("/workspace/a", { activity: "working" }),
      consoleIn("/workspace/a", { activity: "waiting" }),
    ]);
    assert.equal(next[0]?.activity, "approval");
  });

  it("leaves idle and cleanly exited consoles off the light", () => {
    const next = projectsWithConsoleActivity(projects, [
      consoleIn("/workspace/a", { activity: "idle" }),
      consoleIn("/workspace/b", { status: "exited", exitCode: 0 }),
    ]);
    assert.equal(next[0], projects[0]);
    assert.equal(next[1], projects[1]);
  });
});
