import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AppliedPersonality,
  RejectedCustomization,
} from "@overseer/protocol";
import { WORKSPACE_ROOT } from "../workspace.js";
import { recordAction } from "./internal.js";

const run = promisify(execFile);

/**
 * External memory — `overseer-personality`, an ordinary git project under the
 * workspace mount that the operator can edit like any other.
 *
 * It is **advisory input, not configuration with authority** (docs/overseer.md
 * §6.1). Internal memory always wins. This module is the boundary that makes
 * that true: it reads the project's config, admits the fields on an allowlist,
 * and refuses everything else — including anything it does not recognise. An
 * allowlist that accepts the unrecognised is not an allowlist.
 *
 * A refusal is never silent. Every rejected field comes back as a
 * `RejectedCustomization` and becomes a signal in the overseer space, because
 * quietly dropping something the operator deliberately wrote leaves them
 * believing it took effect.
 */

export const PERSONALITY_PROJECT = "overseer-personality";

export function personalityDir(root = WORKSPACE_ROOT): string {
  return path.join(root, PERSONALITY_PROJECT);
}

/** Whether the personality project directory exists (scaffold may still be needed). */
export async function personalityExists(root = WORKSPACE_ROOT): Promise<boolean> {
  try {
    await access(personalityDir(root));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the personality project if absent. Returns true when this call
 * created it. Exported so discovery can show scaffold as its own step.
 */
export async function scaffoldPersonality(
  root = WORKSPACE_ROOT,
): Promise<boolean> {
  return ensureScaffold(root);
}

export interface PersonalityResult {
  applied: AppliedPersonality;
  rejected: RejectedCustomization[];
  /** True when this pass created the project. */
  scaffolded: boolean;
}

/** Fields the operator may set, and how each is validated. Anything not named
 * here is refused by default — see `readPersonality`. */
const TONES = new Set(["neutral", "dry", "warm"]);
/** A headline, not a paragraph. Long enough to be personal, short enough to
 * stay one line at 34px (design-system.md §4). */
const MAX_GREETING = 48;
const MAX_NAME = 24;
/** Cap, not a free dial: past this the "rare tell" stops being rare and starts
 * being a scheduled effect (design-system.md §9). */
const MAX_TYPING_CHANCE = 0.5;

/**
 * Why each refused field is refused, in the operator's terms. Keyed by the
 * field name a user is most likely to reach for; the catch-all in
 * `readPersonality` covers the rest.
 */
const FORBIDDEN: Record<string, string> = {
  logging: "logging is internal · the overseer's record is not editable",
  logLevel: "logging is internal · the overseer's record is not editable",
  disableLogging: "logging is internal · the overseer's record is not editable",
  actions: "the action register is an audit trail and cannot be filtered",
  actionRegister: "the action register is an audit trail and cannot be filtered",
  hideActions: "the action register is an audit trail and cannot be filtered",
  permissions: "permissions belong to the permission system, not to a config file",
  allowedTools: "permissions belong to the permission system, not to a config file",
  auth: "authentication is not configurable from the workspace",
  workspaceRoot: "paths and mounts are deployment facts, not preferences",
  internalDir: "paths and mounts are deployment facts, not preferences",
  paths: "paths and mounts are deployment facts, not preferences",
  signals: "signals are derived from real state · editable signals are fiction",
  signalRanking: "signals are derived from real state · editable signals are fiction",
  headlines: "the state vocabulary is fixed; tone is customizable, meaning is not",
};

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
    raw = await readFile(path.join(personalityDir(root), "personality.json"), "utf8");
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
  const name = rawName.trim();
  if (!name || name.length > MAX_NAME) {
    return {
      ok: false,
      reason: `expected a non-empty string of at most ${MAX_NAME} characters`,
    };
  }
  const result = await patchPersonality({ name }, root);
  if (!result.ok) return result;
  return { ok: true, name };
}

export type PersonalityTone = NonNullable<AppliedPersonality["tone"]>;

/**
 * Write the tone chosen on the first-run intro. Same scaffold-and-merge path
 * as the name ask — discovery must not be a prerequisite for remembering it.
 */
export async function setOperatorTone(
  tone: string,
  root = WORKSPACE_ROOT,
): Promise<{ ok: true; tone: PersonalityTone } | { ok: false; reason: string }> {
  if (!TONES.has(tone)) {
    return {
      ok: false,
      reason: `expected one of ${[...TONES].join(", ")}`,
    };
  }
  const chosen = tone as PersonalityTone;
  const result = await patchPersonality({ tone: chosen }, root);
  if (!result.ok) return result;
  return { ok: true, tone: chosen };
}

async function patchPersonality(
  patch: { name?: string; tone?: PersonalityTone },
  root: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureScaffold(root);

  const file = path.join(personalityDir(root), "personality.json");
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
    raw = await readFile(path.join(personalityDir(root), "personality.json"), "utf8");
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
          field: "personality.json",
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
          field: "personality.json",
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

/** Shared allowlist walk used by both the discovery read and the connect peek. */
function validatePersonalityObject(parsed: Record<string, unknown>): {
  applied: AppliedPersonality;
  rejected: RejectedCustomization[];
} {
  const applied: AppliedPersonality = {};
  const rejected: RejectedCustomization[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    // Comment keys are a convention in hand-edited JSON; ignoring them silently
    // is right because the operator did not intend them as customization.
    if (key.startsWith("//") || key === "$schema") continue;

    const forbidden = FORBIDDEN[key];
    if (forbidden) {
      rejected.push({ field: key, reason: forbidden });
      continue;
    }

    switch (key) {
      case "tone": {
        if (typeof value === "string" && TONES.has(value)) {
          applied.tone = value as AppliedPersonality["tone"];
        } else {
          rejected.push({
            field: "tone",
            reason: `expected one of ${[...TONES].join(", ")}`,
          });
        }
        break;
      }
      case "name": {
        if (typeof value === "string" && value.trim() && value.length <= MAX_NAME) {
          applied.name = value.trim();
        } else {
          rejected.push({
            field: "name",
            reason: `expected a non-empty string of at most ${MAX_NAME} characters`,
          });
        }
        break;
      }
      case "greeting": {
        if (
          typeof value === "string" &&
          value.trim() &&
          value.length <= MAX_GREETING
        ) {
          applied.greeting = value.trim();
        } else {
          rejected.push({
            field: "greeting",
            reason: `expected a non-empty string of at most ${MAX_GREETING} characters · it is a headline, not a paragraph`,
          });
        }
        break;
      }
      case "typingChance": {
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= MAX_TYPING_CHANCE
        ) {
          applied.typingChance = value;
        } else {
          rejected.push({
            field: "typingChance",
            reason: `expected a number between 0 and ${MAX_TYPING_CHANCE}`,
          });
        }
        break;
      }
      default:
        rejected.push({
          field: key,
          reason: "not a customizable field · see docs/overseer.md §6.4",
        });
    }
  }

  return { applied, rejected };
}

/**
 * Create the project if it is absent. Idempotent by construction: the presence
 * of the directory is the whole test, so an existing one — however the operator
 * has since changed it — is never touched, let alone clobbered.
 */
async function ensureScaffold(root: string): Promise<boolean> {
  const dir = personalityDir(root);
  try {
    await access(dir);
    return false;
  } catch {
    // Absent; fall through and create it.
  }

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "personality.json"), SCAFFOLD_CONFIG, "utf8");
    await writeFile(path.join(dir, "README.md"), SCAFFOLD_README, "utf8");

    // A real git project, so it is discovered by the ordinary scanner and shows
    // up in the project panel with no special-casing anywhere in the UI.
    // -b main: don't inherit whatever init.defaultBranch happens to be, and
    // don't emit git's "using master" advice into the scaffold path.
    await run("git", ["init", "-q", "-b", "main"], { cwd: dir, timeout: 10_000 });
    await run("git", ["add", "-A"], { cwd: dir, timeout: 10_000 });
    await run(
      "git",
      [
        "-c",
        "user.email=overseer@localhost",
        "-c",
        "user.name=overseer",
        "commit",
        "-q",
        "-m",
        "scaffold overseer-personality",
      ],
      { cwd: dir, timeout: 10_000 },
    );

    await recordAction({
      actor: "overseer",
      action: "personality:scaffold",
      outcome: "ok",
      detail: dir,
    });
    return true;
  } catch (error) {
    await recordAction({
      actor: "overseer",
      action: "personality:scaffold",
      outcome: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

const SCAFFOLD_CONFIG = `{
  "// what this is": "Advisory input to the overseer. Internal memory always wins.",
  "// customizable": "tone, name, greeting, typingChance · and nothing else.",
  "// rejected fields": "are reported back to you as a signal, never dropped silently."
}
`;

const SCAFFOLD_README = `# overseer-personality

This is the overseer's **external memory** — the part of it you can shape.

It is an ordinary git project under the workspace mount, so you can edit it three
ways: directly on the host, through a session opened against it, or via the
async side-task editing flow used for skills and subagents.

## What you can change

Edit \`personality.json\`:

| Field          | Values                                       |
| -------------- | -------------------------------------------- |
| \`tone\`         | \`neutral\` · \`dry\` · \`warm\`                    |
| \`name\`         | what the overseer calls you (≤ 24 chars)      |
| \`greeting\`     | replaces the welcome headline (≤ 48 chars)    |
| \`typingChance\` | 0–0.5, how often the headline types out       |

## What you cannot change, and why

This project is **advisory**. Internal memory — the overseer's own logs, action
register and state, which live inside the container and are not reachable from
here — always takes precedence.

Anything that would disable logging, filter the action register, grant
permissions, change paths or mounts, or override how signals are ranked is
refused. So is any field not in the table above; unknown fields are rejected by
default rather than ignored.

Nothing is dropped quietly. A refused field shows up in the overseer space as a
signal naming the field and the reason, so you always know what did and did not
take effect.

See \`docs/overseer.md\` §6 in the overseer repo for the full model.
`;
