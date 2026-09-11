import {
  SKILL_NAME_PATTERN,
  type AgentAdapter,
  type Skill,
  type SkillScope,
  type SkillSkipped,
  type SkillSource,
} from "@overseer/protocol";
import { fetchSkillSource } from "./skill-fetch.js";
import {
  resolveProviderContext,
  type ProviderContextDeps,
} from "./provider-context.js";

/**
 * The operator's own skill folders: list, import, delete.
 *
 * Shares two deliberate choices with `subagents.ts` next door, for the same
 * reasons stated there at length: **no authentication gate** (installing a
 * folder touches no CLI and no credential, and an operator whose token expired
 * must still be able to prepare what their next sign-in will run), and **no
 * path composed here** (the server hands the adapter a scope and a staging
 * directory; the adapter joins them onto its own layout).
 *
 * One thing is new. A subagent write is a string the operator typed into a
 * form. An import reaches the network, clones a repository, and writes a tree
 * — so unlike `subagents.ts` this carries a cooldown as well as a single-flight
 * lock, the same pairing `project-create.ts` uses for the same reason.
 */

/** A hard ceiling on what this endpoint alone can add to one folder,
 * independent of request rate — the guard that survives a restart or a client
 * reconnecting. Same role `MAX_SUBAGENTS` plays. */
const MAX_SKILLS = 200;

/** An import spawns git and reaches the network. The cooldown is what keeps a
 * held-down button from opening a queue of clones. */
const IMPORT_COOLDOWN_MS = 2_000;

export type SkillListResult =
  | { ok: true; providerId: string; projectDir: string; skills: Skill[] }
  | { ok: false; reason: string };

export type SkillImportResult =
  | {
      ok: true;
      skills: Skill[];
      skipped: SkillSkipped[];
      providerId: string;
      projectDir: string;
    }
  | { ok: false; reason: string; benign: boolean };

export type SkillDeleteResult =
  | { ok: true; providerId: string; projectDir: string }
  | { ok: false; reason: string; benign: boolean };

export interface SkillsDeps extends ProviderContextDeps {
  fetchSource?: typeof fetchSkillSource;
  now?: () => number;
}

export function createSkills(deps: SkillsDeps = {}) {
  const fetchSource = deps.fetchSource ?? fetchSkillSource;
  const now = deps.now ?? Date.now;

  // One import at a time, process-wide: two clones racing into the same name
  // must not interleave a copy with another copy's rename.
  let inFlight = false;
  let lastImport = 0;

  /**
   * A catalog stub reports that it cannot, rather than reporting an empty
   * inventory — "you have no skills" and "this provider has no skills" are
   * different answers, and only one of them invites an import.
   */
  function needs(
    method: "listSkills" | "importSkills" | "deleteSkill",
  ): (adapter: AgentAdapter) => string | undefined {
    return (adapter) =>
      adapter[method] === undefined ? `${adapter.id} cannot manage skills` : undefined;
  }

  function context(requires: (adapter: AgentAdapter) => string | undefined) {
    return resolveProviderContext(requires, { authenticated: false, deps });
  }

  async function list(): Promise<SkillListResult> {
    const ctx = await context(needs("listSkills"));
    if (!ctx.ok) return ctx;
    const { projectDir } = ctx;
    return {
      ok: true,
      providerId: ctx.adapter.id,
      projectDir,
      // `listSkills` never throws, per the interface.
      skills: await ctx.adapter.listSkills!({ projectDir }),
    };
  }

  async function importSkill(input: {
    source: SkillSource;
    scope: SkillScope;
    name?: string;
  }): Promise<SkillImportResult> {
    const ctx = await context(needs("importSkills"));
    if (!ctx.ok) return { ...ctx, benign: true };

    if (inFlight) {
      return { ok: false, benign: true, reason: "a skill is already importing" };
    }
    const since = now() - lastImport;
    if (since < IMPORT_COOLDOWN_MS) {
      return { ok: false, benign: true, reason: "wait a moment before importing again" };
    }

    const name = input.name?.trim();
    if (name !== undefined && name !== "" && !SKILL_NAME_PATTERN.test(name)) {
      return {
        ok: false,
        benign: true,
        reason: "skill names are lowercase letters, numbers and single hyphens",
      };
    }

    inFlight = true;
    try {
      const { projectDir } = ctx;

      const existing = await ctx.adapter.listSkills!({ projectDir });
      const inScope = existing.filter(
        (skill) => skill.scope === input.scope && skill.foreign === undefined,
      );
      if (inScope.length >= MAX_SKILLS) {
        return {
          ok: false,
          benign: true,
          reason: `that folder already holds ${MAX_SKILLS} skills`,
        };
      }

      const fetched = await fetchSource(input.source);
      if (!fetched.ok) return { ok: false, benign: true, reason: fetched.reason };

      try {
        const outcome = await ctx.adapter.importSkills!({
          projectDir,
          stagingDir: fetched.dir,
          scope: input.scope,
          ...(name !== undefined && name !== "" ? { name } : {}),
        });
        lastImport = now();

        // Nothing landed. The adapter did not fail — it looked at every
        // candidate and installed none — so the refusal has to carry *its*
        // reasons rather than a generic one. A folder whose skills are all
        // already present is the common case, and saying so is the answer.
        if (outcome.imported.length === 0) {
          return {
            ok: false,
            benign: true,
            reason: describeSkipped(outcome.skipped),
          };
        }

        return {
          ok: true,
          skills: outcome.imported,
          skipped: outcome.skipped,
          providerId: ctx.adapter.id,
          projectDir,
        };
      } catch (error) {
        const reason = describe(error, "could not import the skill");
        // A source that is not a skill, or one holding several when a name was
        // given, is the operator's to resolve rather than a fault of ours.
        return {
          ok: false,
          benign:
            /already exists|no skill found|holds \d+ skills|no description/.test(
              reason,
            ),
          reason,
        };
      } finally {
        // The staging directory never outlives the copy out of it.
        await fetched.cleanup();
      }
    } finally {
      inFlight = false;
    }
  }

  async function remove(input: {
    name: string;
    scope: SkillScope;
  }): Promise<SkillDeleteResult> {
    const ctx = await context(needs("deleteSkill"));
    if (!ctx.ok) return { ...ctx, benign: true };

    const { projectDir } = ctx;
    try {
      await ctx.adapter.deleteSkill!({
        projectDir,
        name: input.name,
        scope: input.scope,
      });
    } catch (error) {
      const reason = describe(error, "could not delete the skill");
      // Already gone is the outcome the operator asked for, reported late.
      return { ok: false, benign: /^no /.test(reason), reason };
    }
    return { ok: true, providerId: ctx.adapter.id, projectDir };
  }

  return { list, importSkill, remove };
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Why an import that installed nothing installed nothing.
 *
 * One skill gets its own reason verbatim. Several get grouped by reason, since
 * a folder re-imported wholesale produces the same sentence a dozen times and
 * "12 already installed" is the readable form of that.
 */
function describeSkipped(skipped: SkillSkipped[]): string {
  if (skipped.length === 0) return "nothing in that source was a skill";
  if (skipped.length === 1) {
    const only = skipped[0] as SkillSkipped;
    return `${only.name}: ${only.reason}`;
  }

  const byReason = new Map<string, number>();
  for (const entry of skipped) {
    byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
  }
  return [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${reason}`)
    .join(" · ");
}

export type SkillsService = ReturnType<typeof createSkills>;

/** The instance `ws.ts` uses. */
export const skills = createSkills();
