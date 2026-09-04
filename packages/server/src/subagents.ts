import {
  SUBAGENT_NAME_PATTERN,
  type AgentAdapter,
  type Subagent,
  type SubagentDraft,
  type SubagentScope,
} from "@overseer/protocol";
import {
  resolveProviderContext,
  type ProviderContextDeps,
} from "./provider-context.js";

/**
 * The operator's own subagent files: list, write, delete.
 *
 * Two things here diverge from `provider-options.ts` next door, both on
 * purpose:
 *
 * **No authentication gate.** Reading and writing an agent file touches no
 * CLI and no credential — `provider.options` is gated because it *spawns a
 * subprocess*. An operator whose token has expired must still be able to fix
 * the agent that will run when they sign back in, so gating this on auth would
 * lock them out of the repair, not the risk.
 *
 * **No path is composed here.** The server hands the adapter a `scope` (a
 * two-value union already checked on the wire) and a `name` matching
 * `SUBAGENT_NAME_PATTERN` — no separators, no `.`/`..` — and the adapter joins
 * them onto its own folder. `isInsideWorkspace` cannot stand in: the file does
 * not exist yet at validation time, and a user-scope agent lives in
 * `$CLAUDE_CONFIG_DIR`, outside the workspace by design. Delete goes further
 * and resolves through the adapter's own listing, so a name the write path
 * would refuse never reaches a `path.join` at all.
 */

/** A hard ceiling on what this endpoint alone can add to one folder,
 * independent of request rate — the guard that survives a process restart or a
 * client reconnecting. Same role `MAX_PROJECTS` plays for the workspace. */
const MAX_SUBAGENTS = 200;

export type SubagentListResult =
  | {
      ok: true;
      providerId: string;
      projectDir: string;
      subagents: Subagent[];
    }
  | { ok: false; reason: string };

export type SubagentWriteResult =
  | { ok: true; subagent: Subagent; providerId: string; projectDir: string }
  | { ok: false; reason: string; benign: boolean };

export type SubagentDeleteResult =
  | { ok: true; providerId: string; projectDir: string }
  | { ok: false; reason: string; benign: boolean };

export interface SubagentsDeps extends ProviderContextDeps {}

export function createSubagents(deps: SubagentsDeps = {}) {
  // One write at a time, process-wide. Single-operator, multi-tab: two forms
  // saving the same agent on the same tick must not interleave a write with
  // another write's unlink.
  //
  // No cooldown, unlike `project-create`: this makes no directories and runs
  // no git, and an operator fixing a typo in a prompt should not be told to
  // wait two seconds.
  let inFlight = false;

  /**
   * A catalog stub reports that it cannot, rather than reporting an empty
   * inventory — "you have no subagents" and "this provider has no subagents"
   * are different answers, and only one of them invites the operator to write
   * one (the `listProjectPlans` precedent).
   */
  function needs(
    method: "listSubagents" | "writeSubagent" | "deleteSubagent",
  ): (adapter: AgentAdapter) => string | undefined {
    return (adapter) =>
      adapter[method] === undefined
        ? `${adapter.id} cannot manage subagents`
        : undefined;
  }

  function context(requires: (adapter: AgentAdapter) => string | undefined) {
    return resolveProviderContext(requires, { authenticated: false, deps });
  }

  async function list(): Promise<SubagentListResult> {
    const ctx = await context(needs("listSubagents"));
    if (!ctx.ok) return ctx;
    const { projectDir } = ctx;
    return {
      ok: true,
      providerId: ctx.adapter.id,
      projectDir,
      // `listSubagents` never throws, per the interface.
      subagents: await ctx.adapter.listSubagents!({ projectDir }),
    };
  }

  async function write(input: {
    draft: SubagentDraft;
    previous?: { name: string; scope: SubagentScope };
  }): Promise<SubagentWriteResult> {
    const ctx = await context(needs("writeSubagent"));
    if (!ctx.ok) return { ...ctx, benign: true };

    if (inFlight) {
      return { ok: false, benign: true, reason: "a subagent is already saving" };
    }
    inFlight = true;
    try {
      const name = input.draft.name.trim();
      if (name === "") {
        return { ok: false, benign: true, reason: "a subagent needs a name" };
      }
      if (!SUBAGENT_NAME_PATTERN.test(name)) {
        return {
          ok: false,
          benign: true,
          reason:
            "subagent names are lowercase letters, numbers and single hyphens",
        };
      }
      const description = input.draft.description.trim();
      if (description === "") {
        // Not cosmetic: the description is what the CLI matches a task
        // against, so an agent without one is invisible to its own routing.
        return {
          ok: false,
          benign: true,
          reason:
            "a description is what a task gets matched against — it cannot be blank",
        };
      }
      const prompt = input.draft.prompt.trim();
      if (prompt === "") {
        return {
          ok: false,
          benign: true,
          reason: "a subagent with no instructions is not a subagent",
        };
      }

      const { projectDir } = ctx;
      if (input.previous === undefined) {
        const existing = await ctx.adapter.listSubagents!({ projectDir });
        const inScope = existing.filter(
          (agent) => agent.scope === input.draft.scope,
        );
        if (inScope.length >= MAX_SUBAGENTS) {
          return {
            ok: false,
            benign: true,
            reason: `that folder already holds ${MAX_SUBAGENTS} subagents`,
          };
        }
      }

      const draft: SubagentDraft = {
        name,
        description,
        prompt,
        model: input.draft.model.trim(),
        tools: input.draft.tools.trim(),
        scope: input.draft.scope,
      };

      let subagent: Subagent;
      try {
        subagent = await ctx.adapter.writeSubagent!({
          projectDir,
          draft,
          ...(input.previous !== undefined ? { previous: input.previous } : {}),
        });
      } catch (error) {
        const reason = describe(error, "could not save the subagent");
        // A name already taken is the operator's to resolve, not a fault.
        return { ok: false, benign: /already exists/.test(reason), reason };
      }
      return { ok: true, subagent, providerId: ctx.adapter.id, projectDir };
    } finally {
      inFlight = false;
    }
  }

  async function remove(input: {
    name: string;
    scope: SubagentScope;
  }): Promise<SubagentDeleteResult> {
    const ctx = await context(needs("deleteSubagent"));
    if (!ctx.ok) return { ...ctx, benign: true };

    const { projectDir } = ctx;
    try {
      await ctx.adapter.deleteSubagent!({
        projectDir,
        name: input.name,
        scope: input.scope,
      });
    } catch (error) {
      const reason = describe(error, "could not delete the subagent");
      // Already gone is the outcome the operator asked for, reported late.
      return { ok: false, benign: /^no /.test(reason), reason };
    }
    return { ok: true, providerId: ctx.adapter.id, projectDir };
  }

  return { list, write, remove };
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export type SubagentsService = ReturnType<typeof createSubagents>;

/** The instance `ws.ts` uses. */
export const subagents = createSubagents();
