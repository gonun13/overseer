import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveredAdapter, DiscoveredProject } from "@overseer/protocol";

/**
 * Internal memory — the overseer's own record of itself.
 *
 * Lives at `/app/.overseer`, backed by a named Docker volume that is declared
 * in both compose files and bind-mounted in neither, exactly like `claude-home`.
 * That is the load-bearing property, not an implementation detail: nothing here
 * is reachable from the host or from any workspace project, which is the only
 * reason "internal memory takes precedence over `overseer-personality`"
 * (docs/overseer.md §6.1) is a rule and not a suggestion. Anything host-writable
 * is user-writable, and a rule the user can edit is not a rule.
 *
 * Deliberately plain files. This is an append-mostly audit trail read a few
 * times per boot, and the SQLite store the design doc describes lives on the
 * other side of the trust boundary in `/workspace/_overseer/` for a different job.
 */

/**
 * `OVERSEER_INTERNAL_DIR` is set in both Dockerfile stages, the same way
 * `CLAUDE_CONFIG_DIR` is — the store's location is a deployment fact and the
 * image should state it rather than leave it inferred.
 *
 * The fallback is computed from this module's own path, never from `cwd`: dev
 * runs the server with `cwd` at `packages/server` and production runs it at
 * `/app`, so a cwd-relative default would quietly put the store in two
 * different places. Both `src/memory/` and `dist/memory/` sit four levels under
 * the app root.
 */
const ROOT =
  process.env.OVERSEER_INTERNAL_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", ".overseer");

const LOGS_DIR = path.join(ROOT, "logs");
const ACTIONS_FILE = path.join(ROOT, "actions.jsonl");
const STATE_FILE = path.join(ROOT, "state.json");

/** Every action the overseer takes, before it is reported. Append-only, and
 * nothing in `overseer-personality` can filter it (docs/overseer.md §6.4). */
export interface ActionRecord {
  at: string;
  /** Who initiated it. `overseer` is the component acting on its own. */
  actor: "overseer" | "operator";
  action: string;
  outcome: "ok" | "blocked" | "failed" | "skipped";
  detail?: string;
}

/** Last-known world snapshot. Its existence is what tells a restart it is not
 * a stranger's first boot — the wizard's "welcome back" branch reads this. */
export interface WorldSnapshot {
  at: string;
  runCount: number;
  workspaceRoot: string;
  projects: DiscoveredProject[];
  adapters: DiscoveredAdapter[];
  /** Last project the operator (or discovery default) made active. */
  last_active_project?: string;
  /** Adapter id the operator connected — never auto-picked. */
  attached_adapter?: string;
}

let ensured: Promise<void> | undefined;

/** Idempotent, and memoised so a burst of appends does not stat the tree once
 * per call. */
function ensureDirs(): Promise<void> {
  ensured ??= (async () => {
    await mkdir(LOGS_DIR, { recursive: true });
  })();
  return ensured;
}

export function internalMemoryRoot(): string {
  return ROOT;
}

/**
 * Append to the action register. Never throws: a failure to record must not
 * take down the operation being recorded, but it must be loud in the server
 * log rather than swallowed — a silently broken audit trail is worse than none.
 */
export async function recordAction(
  entry: Omit<ActionRecord, "at"> & { at?: string },
): Promise<void> {
  const record: ActionRecord = { at: new Date().toISOString(), ...entry };
  try {
    await ensureDirs();
    await appendFile(ACTIONS_FILE, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.error("overseer: could not write to the action register", error);
  }
}

/**
 * Read the action register back. `limit` takes the most recent N, since the
 * only current readers want "what happened lately", not the whole history.
 * A malformed line is skipped rather than failing the read — this file is
 * append-only, so a torn last line is the realistic corruption and it should
 * not cost the operator the rest of the register.
 */
export async function readActions(limit?: number): Promise<ActionRecord[]> {
  let raw: string;
  try {
    raw = await readFile(ACTIONS_FILE, "utf8");
  } catch {
    return [];
  }

  const records: ActionRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as ActionRecord);
    } catch {
      // Torn or partial line; the rest of the register is still good.
    }
  }
  return limit === undefined ? records : records.slice(-limit);
}

/** A structured log for one multi-step run, one file per run. */
export async function writeRunLog(
  runId: string,
  entries: unknown[],
): Promise<void> {
  try {
    await ensureDirs();
    const body = entries.map((e) => JSON.stringify(e)).join("\n");
    // runId is server-minted (randomUUID), never operator input — but join it
    // through basename anyway so this can't become a path-traversal write if
    // that ever stops being true.
    await writeFile(
      path.join(LOGS_DIR, `${path.basename(runId)}.jsonl`),
      `${body}\n`,
      "utf8",
    );
  } catch (error) {
    console.error("overseer: could not write the run log", error);
  }
}

export async function readSnapshot(): Promise<WorldSnapshot | undefined> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as WorldSnapshot;
  } catch {
    return undefined;
  }
}

/** Write via a temp file + rename so a crash mid-write leaves the previous
 * snapshot intact rather than a half-written one that fails to parse. */
export async function writeSnapshot(
  snapshot: Omit<WorldSnapshot, "at">,
): Promise<void> {
  try {
    await ensureDirs();
    const body = JSON.stringify(
      { at: new Date().toISOString(), ...snapshot },
      null,
      2,
    );
    const tmp = `${STATE_FILE}.tmp`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, STATE_FILE);
  } catch (error) {
    console.error("overseer: could not write the world snapshot", error);
  }
}

/** True when this instance has completed a discovery pass before. */
export async function hasRunBefore(): Promise<boolean> {
  return (await readSnapshot()) !== undefined;
}

/** Record the active project without rewriting the rest of the snapshot.
 * No-ops (with a log) if there is no snapshot yet — discovery owns the first
 * write. */
export async function setActiveProjectPath(path: string): Promise<boolean> {
  const previous = await readSnapshot();
  if (!previous) {
    console.error("overseer: cannot set active project before the first discovery pass");
    return false;
  }
  await writeSnapshot({
    runCount: previous.runCount,
    workspaceRoot: previous.workspaceRoot,
    projects: previous.projects,
    adapters: previous.adapters,
    last_active_project: path,
    attached_adapter: previous.attached_adapter,
  });
  await recordAction({
    actor: "operator",
    action: "project:select",
    outcome: "ok",
    detail: path,
  });
  return true;
}

/** Record which adapter the operator connected. Discovery must have run first. */
export async function setAttachedAdapter(id: string): Promise<boolean> {
  const previous = await readSnapshot();
  if (!previous) {
    console.error("overseer: cannot attach an adapter before the first discovery pass");
    return false;
  }
  await writeSnapshot({
    runCount: previous.runCount,
    workspaceRoot: previous.workspaceRoot,
    projects: previous.projects,
    adapters: previous.adapters,
    last_active_project: previous.last_active_project,
    attached_adapter: id,
  });
  await recordAction({
    actor: "operator",
    action: "adapter:connect",
    outcome: "ok",
    detail: id,
  });
  return true;
}

/** Refresh the project list in the world snapshot after a live workspace scan.
 * No-ops until discovery has written the first snapshot. Pass `active` when the
 * monitor changed (or cleared) the active project; omit it to leave the field. */
export async function syncSnapshotProjects(
  projects: DiscoveredProject[],
  active?: { path: string | undefined },
): Promise<boolean> {
  const previous = await readSnapshot();
  if (!previous) return false;
  await writeSnapshot({
    runCount: previous.runCount,
    workspaceRoot: previous.workspaceRoot,
    projects,
    adapters: previous.adapters,
    last_active_project:
      active !== undefined ? active.path : previous.last_active_project,
    attached_adapter: previous.attached_adapter,
  });
  return true;
}
