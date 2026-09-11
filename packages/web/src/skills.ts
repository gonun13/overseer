import type { Skill } from "@overseer/protocol";

/**
 * How one skill reads as a row.
 *
 * A plain module rather than logic inside the window, for the same reason
 * `subagents.ts` is one: the wording of a shadowed, foreign or unusable skill
 * is something a test can hold still, while the window itself is only ever
 * exercised end to end.
 */

/** Which folder it came from, in one word. */
export function skillScopeLabel(skill: Skill): string {
  return skill.scope === "project" ? "project" : "user";
}

/**
 * The line under the name: what the skill is for, plus whatever the operator
 * needs to know about the folder before they act on it.
 */
export function skillSummary(skill: Skill): string {
  const parts: string[] = [];
  parts.push(skill.description !== "" ? skill.description : "no description");

  // A skill is a directory, so the file count is what makes it legible as one.
  // Silent at zero: "SKILL.md and nothing else" is the ordinary skill, and
  // saying "0 files" about it would read as an error.
  if (skill.files.length === 1) {
    parts.push("1 extra file");
  } else if (skill.files.length > 1) {
    parts.push(`${skill.files.length} extra files`);
  }

  if (skill.foreign !== undefined) {
    // The reason this row exists at all: the CLI reads another provider's
    // folder, so the skill is live even though this provider never wrote it.
    parts.push(`from ${skill.foreign} — read here, managed elsewhere`);
  }
  if (skill.shadowed === true) {
    parts.push("hidden by another skill of the same name");
  }
  if (skill.readOnly === true) {
    parts.push(
      "the name is not lowercase-and-hyphens, so this folder can only be deleted",
    );
  }
  return parts.join(" · ");
}

/**
 * The dedupe key a row is identified by. Qualified by scope *and* directory:
 * the same name can exist in both scopes, and — unlike a subagent — twice
 * within one scope, once in this provider's folder and once in another's.
 */
export function skillKey(skill: Skill): string {
  return `${skill.scope}:${skill.foreign ?? ""}:${skill.name}`;
}

/** The skill a payload names, if it is still in the list. */
export function findSkill(skills: Skill[], key: string): Skill | undefined {
  return skills.find((skill) => skillKey(skill) === key);
}
