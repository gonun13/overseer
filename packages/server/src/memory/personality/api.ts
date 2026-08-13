import { readFile, rm, writeFile } from "node:fs/promises";
import type {
  AppliedPersonality,
  RejectedCustomization,
} from "@overseer/protocol";
import { WORKSPACE_ROOT } from "../../workspace.js";
import { recordAction } from "../internal.js";
import {
  PERSONALITY_PROJECT,
  SCAFFOLD_CONFIG,
  ensureScaffold,
  personalityConfigExists,
  personalityConfigPath,
  personalityDir,
  personalityExists,
  scaffoldPersonality,
} from "./scaffold.js";
import {
  parseOperatorName,
  parseOperatorTone,
  validatePersonalityObject,
  type PersonalityTone,
} from "./validate.js";

/**
 * External memory — `overseer-personality`, an ordinary git project under the
 * workspace mount that the operator can edit like any other.
 *
 * It is **advisory input, not configuration with authority** (docs/overseer.md
 * §6.1). Internal memory always wins. This facade is the boundary that makes
 * that true: it reads the project's config, admits the fields on an allowlist,
 * and refuses everything else — including anything it does not recognise. An
 * allowlist that accepts the unrecognised is not an allowlist.
 *
 * A refusal is never silent. Every rejected field comes back as a
 * `RejectedCustomization` and becomes a signal in the overseer space, because
 * quietly dropping something the operator deliberately wrote leaves them
 * believing it took effect.
 */

export {
  PERSONALITY_PROJECT,
  personalityConfigExists,
  personalityConfigPath,
  personalityDir,
  personalityExists,
  scaffoldPersonality,
};
export type { PersonalityTone };

export interface PersonalityResult {
  applied: AppliedPersonality;
  rejected: RejectedCustomization[];
  /** True when this pass created the project. */
  scaffolded: boolean;
}

/**
 * Identity needed before discovery: the welcome beat has to know the operator's
 * name (and whether this is a return visit's greeting) without running the full
 * pass. Never scaffolds — absent personality is a first-run fact, not an error.
 */
export async function peekPersonality(
  root = WORKSPACE_ROOT,
): Promise<AppliedPersonality> {
  let raw: string;
  try {
    raw = await readFile(personalityConfigPath(root), "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const { applied } = validatePersonalityObject(
    parsed as Record<string, unknown>,
  );
  // Peek ignores rejections: the welcome beat only needs accepted fields, and
  // discovery will surface refusals properly when it runs.
  return applied;
}

/**
 * Write the operator's name from the wizard's first-run ask. Scaffolds the
 * personality project if needed so the name is not stranded waiting for
 * discovery, then merges into the existing file rather than clobbering it.
 */
export async function setOperatorName(
  rawName: string,
  root = WORKSPACE_ROOT,
): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const parsed = parseOperatorName(rawName);
  if (!parsed.ok) return parsed;
  const result = await patchPersonality({ name: parsed.name }, root);
  if (!result.ok) return result;
  return { ok: true, name: parsed.name };
}

/**
 * Write the tone chosen on the first-run intro. Same scaffold-and-merge path
 * as the name ask — discovery must not be a prerequisite for remembering it.
 */
export async function setOperatorTone(
  tone: string,
  root = WORKSPACE_ROOT,
): Promise<{ ok: true; tone: PersonalityTone } | { ok: false; reason: string }> {
  const parsed = parseOperatorTone(tone);
  if (!parsed.ok) return parsed;
  const result = await patchPersonality({ tone: parsed.tone }, root);
  if (!result.ok) return result;
  return { ok: true, tone: parsed.tone };
}

/**
 * Delete `personality.json` because the operator asked for it.
 *
 * Only the file: the project around it is an ordinary git project with the
 * operator's own history in it, and a reset is meant to clear what the overseer
 * remembers, not to remove a repository nobody asked it to touch. Discovery
 * scaffolds the defaults back on the next boot.
 *
 * The action is recorded here even though the register is about to be erased
 * too — the order in `ws.ts` is deliberate, and a wipe that skipped its own
 * audit line would be a wipe the trail never knew about if the delete failed.
 */
export async function deletePersonalityConfig(
  root = WORKSPACE_ROOT,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const file = personalityConfigPath(root);
  try {
    await rm(file, { force: true });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "could not delete personality";
    await recordAction({
      actor: "operator",
      action: "personality:delete",
      outcome: "failed",
      detail: `${file} · ${reason}`,
    });
    return { ok: false, reason };
  }

  await recordAction({
    actor: "operator",
    action: "personality:delete",
    outcome: "ok",
    detail: file,
  });
  return { ok: true };
}

async function patchPersonality(
  patch: { name?: string; tone?: PersonalityTone },
  root: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureScaffold(root);

  const file = personalityConfigPath(root);
  let body: Record<string, unknown>;
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      body = JSON.parse(SCAFFOLD_CONFIG) as Record<string, unknown>;
    } else {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = JSON.parse(SCAFFOLD_CONFIG) as Record<string, unknown>;
  }

  if (patch.name !== undefined) body.name = patch.name;
  if (patch.tone !== undefined) body.tone = patch.tone;

  try {
    await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "could not write personality",
    };
  }

  if (patch.name !== undefined) {
    await recordAction({
      actor: "operator",
      action: "personality:name",
      outcome: "ok",
      detail: patch.name,
    });
  }
  if (patch.tone !== undefined) {
    await recordAction({
      actor: "operator",
      action: "personality:tone",
      outcome: "ok",
      detail: patch.tone,
    });
  }
  return { ok: true };
}

/**
 * Read and validate. Never throws: a broken personality file is a state to
 * report, not a reason to fail discovery. The overseer runs fine with no
 * personality at all — that is the default it ships with.
 *
 * `scaffold` defaults to true for callers that still want the old combined
 * behaviour; discovery passes `false` after running scaffold as its own step.
 */
export async function readPersonality(
  root = WORKSPACE_ROOT,
  opts: { scaffold?: boolean } = {},
): Promise<PersonalityResult> {
  const scaffolded = opts.scaffold === false ? false : await ensureScaffold(root);

  let raw: string;
  try {
    raw = await readFile(personalityConfigPath(root), "utf8");
  } catch {
    return { applied: {}, rejected: [], scaffolded };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      applied: {},
      rejected: [
        {
          field: "personality",
          reason: `not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
        },
      ],
      scaffolded,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      applied: {},
      rejected: [
        {
          field: "personality",
          reason: "expected a JSON object at the top level",
        },
      ],
      scaffolded,
    };
  }

  const { applied, rejected } = validatePersonalityObject(
    parsed as Record<string, unknown>,
  );

  for (const entry of rejected) {
    await recordAction({
      actor: "overseer",
      action: `personality:reject:${entry.field}`,
      outcome: "blocked",
      detail: entry.reason,
    });
  }

  return { applied, rejected, scaffolded };
}
