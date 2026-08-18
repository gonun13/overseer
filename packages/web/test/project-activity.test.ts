import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Project, Session } from "../src/domain.ts";
import { projectsWithSessionActivity } from "../src/state/project-activity.ts";

describe("projectsWithSessionActivity", () => {
  const projects: Project[] = [
    {
      id: "/workspace/a",
      name: "a",
      path: "/workspace/a",
      branch: "main",
      activity: "idle",
    },
    {
      id: "/workspace/b",
      name: "b",
      path: "/workspace/b",
      branch: "main",
      activity: "idle",
    },
  ];

  it("marks a project working when a session in it is working", () => {
    const sessions: Session[] = [
      {
        id: "s1",
        activity: "working",
        name: "fix bug",
        projectId: "/workspace/a",
        branch: "main",
        model: "",
        cost: "",
        doing: "",
      },
    ];
    const next = projectsWithSessionActivity(projects, sessions);
    assert.equal(next[0]?.activity, "working");
    assert.equal(next[1]?.activity, "idle");
  });

  it("prefers attention over working on the same project", () => {
    const sessions: Session[] = [
      {
        id: "s1",
        activity: "working",
        name: "a",
        projectId: "/workspace/a",
        branch: "main",
        model: "",
        cost: "",
        doing: "",
      },
      {
        id: "s2",
        activity: "attention",
        name: "b",
        projectId: "/workspace/a",
        branch: "main",
        model: "",
        cost: "",
        doing: "",
      },
    ];
    const next = projectsWithSessionActivity(projects, sessions);
    assert.equal(next[0]?.activity, "attention");
  });
});
