import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Subagent } from "@overseer/protocol";
import {
  findSubagent,
  scopeLabel,
  subagentKey,
  subagentSummary,
} from "../src/subagents.ts";

function agent(over: Partial<Subagent> = {}): Subagent {
  return {
    name: "reviewer",
    description: "Reviews code",
    prompt: "You are the reviewer.",
    model: "",
    tools: "",
    scope: "project",
    file: "/workspace/p/.claude/agents/reviewer.md",
    ...over,
  };
}

describe("scopeLabel", () => {
  it("names the folder in one word", () => {
    assert.equal(scopeLabel(agent()), "project");
    assert.equal(scopeLabel(agent({ scope: "user" })), "user");
  });
});

describe("subagentSummary", () => {
  it("is the description when there is nothing else to say", () => {
    assert.equal(subagentSummary(agent()), "Reviews code");
  });

  it("says so rather than showing a blank line", () => {
    assert.equal(subagentSummary(agent({ description: "" })), "no description");
  });

  it("explains why a shadowed agent's edits appear to do nothing", () => {
    assert.match(
      subagentSummary(agent({ scope: "user", shadowed: true })),
      /hidden by the project subagent/,
    );
  });

  it("warns that saving will move the file", () => {
    assert.match(
      subagentSummary(agent({ renamedOnSave: true })),
      /rename the file/,
    );
  });

  it("says an unusable name can only be deleted", () => {
    assert.match(
      subagentSummary(agent({ name: "code reviewer", readOnly: true })),
      /can only be deleted/,
    );
  });

  it("prefers the read-only explanation over the rename one", () => {
    // Both are true of the same file, but only one of them is actionable —
    // there is no save to warn about.
    const summary = subagentSummary(
      agent({ name: "code reviewer", readOnly: true, renamedOnSave: true }),
    );
    assert.match(summary, /can only be deleted/);
    assert.doesNotMatch(summary, /rename the file/);
  });
});

describe("subagentKey / findSubagent", () => {
  it("keeps the same name in two scopes apart", () => {
    // Two files, two windows: a key of just the name would collapse them.
    const project = agent();
    const user = agent({ scope: "user" });
    assert.notEqual(subagentKey(project), subagentKey(user));

    const list = [project, user];
    assert.equal(findSubagent(list, subagentKey(user))?.scope, "user");
    assert.equal(findSubagent(list, subagentKey(project))?.scope, "project");
  });

  it("finds nothing for the create form's empty payload", () => {
    assert.equal(findSubagent([agent()], ""), undefined);
  });

  it("finds nothing once the agent it named is gone", () => {
    assert.equal(findSubagent([], "project:reviewer"), undefined);
  });
});
