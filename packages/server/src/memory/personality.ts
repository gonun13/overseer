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
  logging: "logging is internal — the overseer's record is not editable",
  logLevel: "logging is internal — the overseer's record is not editable",
  disableLogging: "logging is internal — the overseer's record is not editable",
  actions: "the action register is an audit trail and cannot be filtered",
  actionRegister: "the action register is an audit trail and cannot be filtered",
  hideActions: "the action register is an audit trail and cannot be filtered",
  permissions: "permissions belong to the permission system, not to a config file",
  allowedTools: "permissions belong to the permission system, not to a config file",
  auth: "authentication is not configurable from the workspace",
  workspaceRoot: "paths and mounts are deployment facts, not preferences",
  internalDir: "paths and mounts are deployment facts, not preferences",
  paths: "paths and mounts are deployment facts, not preferences",
  signals: "signals are derived from real state — editable signals are fiction",
  signalRanking: "signals are derived from real state — editable signals are fiction",
  headlines: "the state vocabulary is fixed; tone is customizable, meaning is not",
};

/**
 * Read and validate. Never throws: a broken personality file is a state to
 * report, not a reason to fail discovery. The overseer runs fine with no
 * personality at all — that is the default it ships with.
 */
export async function readPersonality(
  root = WORKSPACE_ROOT,
): Promise<PersonalityResult> {
  const scaffolded = await ensureScaffold(root);
  const applied: AppliedPersonality = {};
  const rejected: RejectedCustomization[] = [];

  let raw: string;
  try {
    raw = await readFile(path.join(personalityDir(root), "personality.json"), "utf8");
  } catch {
    return { applied, rejected, scaffolded };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    rejected.push({
      field: "personality.json",
      reason: `not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    });
    return { applied, rejected, scaffolded };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    rejected.push({
      field: "personality.json",
      reason: "expected a JSON object at the top level",
    });
    return { applied, rejected, scaffolded };
  }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
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
            reason: `expected a non-empty string of at most ${MAX_GREETING} characters — it is a headline, not a paragraph`,
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
          reason: "not a customizable field — see docs/overseer.md §6.4",
        });
    }
  }

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
  "// customizable": "tone, name, greeting, typingChance — and nothing else.",
  "// rejected fields": "are reported back to you as a signal, never dropped silently.",
  "tone": "neutral"
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
