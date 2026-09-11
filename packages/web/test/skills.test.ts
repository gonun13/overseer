import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Skill } from "@overseer/protocol";
import { findSkill, skillKey, skillScopeLabel, skillSummary } from "../src/skills.ts";

function skill(over: Partial<Skill> = {}): Skill {
  return {
    name: "pdf-forms",
    description: "Fills in PDF forms",
    scope: "project",
    dir: "/w/p/.claude/skills/pdf-forms",
    file: "/w/p/.claude/skills/pdf-forms/SKILL.md",
    files: [],
    ...over,
  };
}

describe("skillScopeLabel", () => {
  it("names the folder in one word", () => {
    assert.equal(skillScopeLabel(skill()), "project");
    assert.equal(skillScopeLabel(skill({ scope: "user" })), "user");
  });
});

describe("skillSummary", () => {
  it("leads with the description", () => {
    assert.equal(skillSummary(skill()), "Fills in PDF forms");
  });

  it("says so rather than showing a blank line", () => {
    assert.equal(skillSummary(skill({ description: "" })), "no description");
  });

  it("counts supporting files, since a skill is a directory", () => {
    assert.match(skillSummary(skill({ files: ["a.md"] })), /1 extra file$/);
    assert.match(skillSummary(skill({ files: ["a.md", "b.md"] })), /2 extra files$/);
  });

  it("stays silent at zero — SKILL.md alone is the ordinary skill", () => {
    assert.doesNotMatch(skillSummary(skill({ files: [] })), /extra file/);
  });

  it("explains a foreign skill as read here but managed elsewhere", () => {
    assert.match(
      skillSummary(skill({ foreign: ".claude/skills" })),
      /from \.claude\/skills — read here, managed elsewhere/,
    );
  });

  it("explains why a shadowed skill is not the one running", () => {
    assert.match(skillSummary(skill({ shadowed: true })), /hidden by another skill/);
  });

  it("explains why an odd name can only be deleted", () => {
    assert.match(skillSummary(skill({ readOnly: true })), /can only be deleted/);
  });
});

describe("skillKey", () => {
  it("separates the same name in two scopes", () => {
    assert.notEqual(skillKey(skill()), skillKey(skill({ scope: "user" })));
  });

  it("separates the same name in two config directories in one scope", () => {
    // Unlike a subagent, a skill can appear twice within one scope: once in
    // this provider's folder and once in another's.
    assert.notEqual(
      skillKey(skill()),
      skillKey(skill({ foreign: ".claude/skills" })),
    );
  });
});

describe("findSkill", () => {
  it("finds a row by its key, and reports nothing for one that is gone", () => {
    const rows = [skill(), skill({ scope: "user" })];
    assert.equal(findSkill(rows, skillKey(rows[1] as Skill))?.scope, "user");
    assert.equal(findSkill(rows, "project::absent"), undefined);
  });
});
