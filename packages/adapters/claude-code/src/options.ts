import { spawn } from "node:child_process";
import type {
  PermissionMode,
  ProviderOption,
  ProviderOptions,
} from "@overseer/protocol";
import { readCustomAgents } from "./custom-agents.js";

/**
 * What this CLI offers a session: models, permission modes, subagents.
 *
 * Two sources, because the CLI only answers half of it. Models and the current
 * permission mode come from the `initialize` control request. The operator's
 * subagents come off disk (`custom-agents.ts`) — `initialize` lists them mixed
 * in with the CLI's own built-in routing agents, with nothing to tell the two
 * apart, and the built-ins are not a choice the operator made.
 *
 * The `initialize` control request is the whole answer for models.
 * It is not a published interface — the request shape and the response keys
 * were captured from the pinned 2.1.226 build (same as `login.ts` and
 * `usage.ts`). A version bump can change any of them, and when it does this
 * module reports empty lists rather than inventing menu entries the operator
 * would pick from and then watch fail at spawn.
 *
 * Asking is free: 0 tokens, no assistant turn, no session on disk, ~1.2s
 * measured. We write one line, read the first matching `control_response`, and
 * kill the child — the process would otherwise sit waiting for a prompt.
 *
 * Subagents are project-scoped (`<project>/.claude/agents/` merges with
 * `$CLAUDE_CONFIG_DIR/agents/` and anything passed via `--agents`), so this runs
 * with `cwd` set to the project being asked about, not a temp dir.
 */

const CLI = "claude";

/** Default wall clock for one ask. Generous against a measured ~1.2s. */
export const OPTIONS_TIMEOUT_MS = 10_000;

/** How long SIGTERM gets before SIGKILL — same rationale as usage.ts. */
const KILL_GRACE_MS = 2_000;

const REQUEST_ID = "overseer_initialize";

/**
 * The CLI's own six choices, as it prints them when handed a bogus value:
 *
 *   error: option '--permission-mode <mode>' argument 'x' is invalid.
 *   Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.
 *
 * Not discovered at runtime: the only machine-readable enumeration is that
 * error string, and a parse miss there would blank the mode row entirely —
 * worse than a list pinned to a build we also pin everywhere else. `detail` is
 * Overseer's own gloss, because the CLI ships no descriptions for these.
 */
const PERMISSION_MODES: ProviderOption[] = [
  { value: "auto", label: "auto", detail: "classifier decides, per command" },
  { value: "manual", label: "manual", detail: "ask before every tool" },
  { value: "acceptEdits", label: "acceptEdits", detail: "edits go through, commands still ask" },
  { value: "plan", label: "plan", detail: "read and plan only, no changes" },
  { value: "dontAsk", label: "dontAsk", detail: "never prompt; refuse instead" },
  {
    value: "bypassPermissions",
    label: "bypassPermissions",
    detail: "no checks at all",
    danger: true,
  },
];

const PERMISSION_MODE_VALUES = new Set<string>(
  PERMISSION_MODES.map((mode) => mode.value),
);

/** Nothing the CLI could tell us. The shape callers get on every failure path. */
function noProbeAnswer(): InitializeAnswer {
  return { models: [] };
}

/** What the `initialize` probe alone can answer. Agents are not in it — they
 * come off disk, because the CLI does not separate the operator's subagents
 * from its own built-ins (see `custom-agents.ts`). */
export interface InitializeAnswer {
  models: ProviderOption[];
  defaultPermissionMode?: PermissionMode;
  defaultModel?: string;
}

/**
 * `manual` is the CLI's display name and `default` its wire value: pass
 * `manual` and `initialize` reports `default` back. Fold that here so the UI
 * never has to offer two words for one mode.
 */
export function normalizePermissionMode(
  value: unknown,
): PermissionMode | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "default") return "manual";
  return PERMISSION_MODE_VALUES.has(value)
    ? (value as PermissionMode)
    : undefined;
}

/**
 * The CLI's own `description` leads with the display name repeated alongside
 * its version — `"Sonnet 5 · Efficient for routine tasks"` for a row already
 * labelled "Sonnet". Move that version onto the label (`"Sonnet"` →
 * `"Sonnet 5"`) and leave only the blurb behind it in `detail`, so the
 * version reads as part of the model's name rather than buried mid-sentence.
 *
 * Left untouched when the description does not open on the display name's
 * own first word — "Default (recommended)" describes whichever model the
 * account resolves to, not itself, and gets no version stitched onto it.
 */
function withVersionInLabel(
  displayName: string,
  description: string,
): { label: string; detail?: string } {
  const trimmed = description.trim();
  const match = /^(\S+)\s+([\d.]+)(?:\s*·\s*(.*))?$/.exec(trimmed);
  const leadWord = displayName.trim().split(/\s+/)[0]?.toLowerCase();
  if (!match || match[1]!.toLowerCase() !== leadWord) {
    return trimmed === "" ? { label: displayName } : { label: displayName, detail: trimmed };
  }
  const [, , version, rest] = match;
  return {
    label: `${displayName} ${version}`,
    ...(rest !== undefined && rest.trim() !== "" ? { detail: rest.trim() } : {}),
  };
}

/** Turn the `initialize` response body into menus. Total on anything odd. */
export function parseInitializeResponse(body: unknown): InitializeAnswer {
  if (typeof body !== "object" || body === null) return noProbeAnswer();
  const obj = body as Record<string, unknown>;

  const models: ProviderOption[] = [];
  if (Array.isArray(obj.models)) {
    for (const entry of obj.models) {
      if (typeof entry !== "object" || entry === null) continue;
      const model = entry as Record<string, unknown>;
      if (typeof model.value !== "string" || model.value === "") continue;
      const displayName =
        typeof model.displayName === "string" && model.displayName !== ""
          ? model.displayName
          : model.value;
      const description =
        typeof model.description === "string" ? model.description : "";
      const { label, detail } = withVersionInLabel(displayName, description);
      models.push({
        value: model.value,
        label,
        ...(detail !== undefined ? { detail } : {}),
        ...(typeof model.resolvedModel === "string" &&
        model.resolvedModel !== ""
          ? { resolvedModel: model.resolvedModel }
          : {}),
      });
    }
  }

  // `obj.agents` is deliberately ignored: it mixes the CLI's built-in routing
  // agents in with the operator's own, with nothing to tell them apart.

  const defaultMode = normalizePermissionMode(obj.current_permission_mode);

  // `initialize` names no current model, but it does offer one whose whole
  // meaning is "whatever is configured" — the CLI labels it "Default
  // (recommended)". Reporting that is not a guess about which model runs; it is
  // the selection the CLI is actually sitting on. Absent it, name nothing.
  const defaultModel = models.find((model) => model.value === "default")?.value;

  return {
    models,
    ...(defaultMode !== undefined
      ? { defaultPermissionMode: defaultMode }
      : {}),
    ...(defaultModel !== undefined ? { defaultModel } : {}),
  };
}

/** Pull our own `control_response` out of the child's NDJSON stdout. */
export function findInitializeBody(stdout: string): unknown {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof record !== "object" || record === null) continue;
    const obj = record as Record<string, unknown>;
    if (obj.type !== "control_response") continue;
    const response = obj.response as Record<string, unknown> | undefined;
    if (response === undefined) continue;
    if (response.request_id !== REQUEST_ID) continue;
    if (response.subtype !== "success") return undefined;
    return response.response;
  }
  return undefined;
}

export async function readProviderOptions(
  opts: { projectDir: string },
  options?: { timeoutMs?: number; killGraceMs?: number },
): Promise<ProviderOptions> {
  const timeoutMs = options?.timeoutMs ?? OPTIONS_TIMEOUT_MS;
  const killGraceMs = options?.killGraceMs ?? KILL_GRACE_MS;

  // Two independent questions, asked at once: the CLI knows its models, and
  // only the filesystem knows which subagents the operator wrote.
  const [probe, agents] = await Promise.all([
    (async (): Promise<InitializeAnswer> => {
      const stdout = await runInitialize(
        opts.projectDir,
        timeoutMs,
        killGraceMs,
      );
      const body = findInitializeBody(stdout);
      return body === undefined ? noProbeAnswer() : parseInitializeResponse(body);
    })(),
    readCustomAgents({ projectDir: opts.projectDir, configDir: configDir() }),
  ]);

  return {
    models: probe.models,
    permissionModes: PERMISSION_MODES,
    agents,
    ...(probe.defaultPermissionMode !== undefined
      ? { defaultPermissionMode: probe.defaultPermissionMode }
      : {}),
    ...(probe.defaultModel !== undefined
      ? { defaultModel: probe.defaultModel }
      : {}),
  };
}

function configDir(): string {
  return (
    process.env.CLAUDE_CONFIG_DIR ??
    `${process.env.HOME ?? "/home/node"}/.claude`
  );
}

/**
 * Spawn the CLI, ask once, and always settle within timeout+grace. The child is
 * killed as soon as the answer arrives: in stream-json input mode it stays open
 * waiting for a user turn that is never coming.
 */
function runInitialize(
  projectDir: string,
  timeoutMs: number,
  killGraceMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR ??
      `${process.env.HOME ?? "/home/node"}/.claude`;

    // Detached so the CLI and any children share a process group we can reap.
    const child = spawn(
      CLI,
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let settled = false;
    let reaping = false;

    const signalTree = (signal: NodeJS.Signals) => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        // Negative pid = whole process group (detached spawn).
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    /**
     * Tear the child down. Deliberately independent of `finish`: we kill on the
     * *success* path too — the CLI sits waiting for a user turn that is never
     * coming — and the SIGKILL must still land after a resolved promise, or a
     * child that ignores SIGTERM outlives the ask it was made for.
     */
    const reap = () => {
      if (reaping) return;
      reaping = true;
      signalTree("SIGTERM");
      const kill = setTimeout(() => signalTree("SIGKILL"), killGraceMs);
      // Never hold the event loop open for a grace period nobody is waiting on.
      kill.unref?.();
      child.once("close", () => clearTimeout(kill));
    };

    const finish = (out: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(absolute);
      resolve(out);
    };

    const deadline = setTimeout(() => {
      reap();
      // Do not wait on close — a wedged tree must not pin the menus.
      finish(stdout);
    }, timeoutMs);
    // Absolute ceiling if even the deadline / close handling misbehaves.
    const absolute = setTimeout(
      () => finish(stdout),
      timeoutMs + killGraceMs + 500,
    );

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      // The answer is the first control_response; nothing after it is wanted,
      // and the child would otherwise sit waiting for a user turn.
      if (stdout.includes(`"${REQUEST_ID}"`) && stdout.includes("\n")) {
        const out = stdout;
        reap();
        finish(out);
      }
    });
    // Drain stderr so a full pipe cannot stall the child.
    child.stderr?.on("data", () => {});
    child.on("error", () => finish(""));
    child.on("close", () => finish(stdout));

    try {
      child.stdin.write(
        `${JSON.stringify({
          type: "control_request",
          request_id: REQUEST_ID,
          request: { subtype: "initialize" },
        })}\n`,
      );
    } catch {
      finish("");
    }
  });
}
