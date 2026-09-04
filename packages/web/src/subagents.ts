import type { Subagent } from "@overseer/protocol";

/**
 * How one subagent reads as a row.
 *
 * A plain module rather than logic inside the window, so the wording of a
 * shadowed or unusable agent is something a test can hold still — the window
 * itself is only ever exercised end to end.
 */

/** Which folder it came from, in one word. */
export function scopeLabel(subagent: Subagent): string {
  return subagent.scope === "project" ? "project" : "user";
}

/**
 * The line under the name: what the agent is for, plus whatever the operator
 * needs to know about the file before they try to edit it.
 */
export function subagentSummary(subagent: Subagent): string {
  const parts: string[] = [];
  parts.push(subagent.description !== "" ? subagent.description : "no description");
  if (subagent.shadowed === true) {
    // The reason an edit here would appear to do nothing.
    parts.push("hidden by the project subagent of the same name");
  }
  if (subagent.readOnly === true) {
    parts.push(
      "the name is not lowercase-and-hyphens, so this file can only be deleted",
    );
  } else if (subagent.renamedOnSave === true) {
    parts.push("saving will rename the file to match the name");
  }
  return parts.join(" · ");
}

/**
 * The dedupe key a window is opened under. Scope-qualified because the same
 * name can exist in both folders, and two windows editing two different files
 * must not collapse into one.
 */
export function subagentKey(subagent: Subagent): string {
  return `${subagent.scope}:${subagent.name}`;
}

/** The subagent a window payload names, if it is still in the list. */
export function findSubagent(
  subagents: Subagent[],
  key: string,
): Subagent | undefined {
  return subagents.find((subagent) => subagentKey(subagent) === key);
}
