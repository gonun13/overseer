import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveredAdapter, DiscoveredProject, OverseerTheme } from "@overseer/protocol";

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
 *
 * Resolved per call so tests can point `OVERSEER_INTERNAL_DIR` at a temp dir
 * without racing a module-load constant.
 */
function root(): string {
  return (
    process.env.OVERSEER_INTERNAL_DIR ??
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../..",
      ".overseer",
    )
  );
}

function logsDir(): string {
  return path.join(root(), "logs");
}

function actionsFile(): string {
  return path.join(root(), "actions.jsonl");
}

function stateFile(): string {
  return path.join(root(), "state.json");
}

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
  /** Last theme the operator chose. Absent means samaritan (the default). */
  theme?: OverseerTheme;
}

/** Theme chosen before the first discovery snapshot exists — stamped in when
 * discovery writes `state.json`, the same way a mid-pass project pick would
 * otherwise be lost. Cleared by `themeForSnapshot`. */
let pendingTheme: OverseerTheme | undefined;

let ensured: Promise<void> | undefined;
/** Directory the memoised `ensureDirs` last prepared — invalidate when the
 * env-configured root moves (tests). */
let ensuredRoot: string | undefined;

/** Idempotent, and memoised so a burst of appends does not stat the tree once
 * per call. The memo is dropped on failure: a `mkdir` that lost to a volume
 * not yet mounted at boot is transient, and caching that rejection would
 * disable the action register and the run log for the life of the process. */
function ensureDirs(): Promise<void> {
  const current = root();
  if (ensured && ensuredRoot === current) return ensured;
  ensuredRoot = current;
  ensured = mkdir(logsDir(), { recursive: true }).then(
    () => undefined,
    (error: unknown) => {
      ensured = undefined;
      ensuredRoot = undefined;
      throw error;
    },
  );
  return ensured;
}

export function internalMemoryRoot(): string {
  return root();
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
    await appendFile(actionsFile(), `${JSON.stringify(record)}\n`, "utf8");
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
    raw = await readFile(actionsFile(), "utf8");
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
      path.join(logsDir(), `${path.basename(runId)}.jsonl`),
      `${body}\n`,
      "utf8",
    );
  } catch (error) {
    console.error("overseer: could not write the run log", error);
  }
}

export async function readSnapshot(): Promise<WorldSnapshot | undefined> {
  try {
    return JSON.parse(await readFile(stateFile(), "utf8")) as WorldSnapshot;
  } catch {
    return undefined;
  }
}

/**
 * Serialises every access to the snapshot file.
 *
 * Temp-file-plus-rename buys crash safety, not concurrency safety, and there
 * are five writers here: discovery, the workspace monitor's poll,
 * `setActiveProjectPath`, `setAttachedAdapter` and `setTheme`. Each is a read, an await,
 * then a write, so two that interleave lose one of the two updates — the
 * monitor reads, the operator attaches an adapter, the monitor writes back its
 * stale `attached_adapter` and the connection silently reverts. Chaining on a
 * single tail means each mutation sees the previous one's result.
 *
 * `then(fn, fn)` runs the next link whether or not the previous one settled:
 * a failed write must not wedge the chain for the life of the process.
 */
let tail: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  // The tail only sequences; the rejection still belongs to `next`'s caller.
  tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Write via a temp file + rename so a crash mid-write leaves the previous
 * snapshot intact rather than a half-written one that fails to parse. The temp
 * name is unique per write: a fixed one lets a `rename` from a second writer
 * publish a file the first is still filling, which is the torn snapshot this
 * pattern is supposed to rule out. */
async function publishSnapshot(
  snapshot: Omit<WorldSnapshot, "at">,
): Promise<void> {
  const file = stateFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await ensureDirs();
    const body = JSON.stringify(
      { at: new Date().toISOString(), ...snapshot },
      null,
      2,
    );
    await writeFile(tmp, body, "utf8");
    await rename(tmp, file);
  } catch (error) {
    console.error("overseer: could not write the world snapshot", error);
    // A temp file left by a failed write is never picked up by anything, so it
    // would just accumulate in the volume one boot at a time.
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Replace the snapshot wholesale. Discovery's ending write — it owns the
 * whole world it just observed, rather than patching a field. */
export function writeSnapshot(
  snapshot: Omit<WorldSnapshot, "at">,
): Promise<void> {
  return serialized(() => publishSnapshot(snapshot));
}

/**
 * Read-modify-write one field of the snapshot under the lock. `mutate` must
 * stay synchronous: the whole point is that nothing else runs between the read
 * and the write, and an await inside it would reopen the window this closes.
 */
function updateSnapshot(
  mutate: (previous: WorldSnapshot) => Omit<WorldSnapshot, "at"> | undefined,
): Promise<boolean> {
  return serialized(async () => {
    const previous = await readSnapshot();
    if (!previous) return false;
    const next = mutate(previous);
    if (!next) return false;
    await publishSnapshot(next);
    return true;
  });
}

/** True when this instance has completed a discovery pass before. */
export async function hasRunBefore(): Promise<boolean> {
  return (await readSnapshot()) !== undefined;
}

export type MemoryWrite =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Record the active project without rewriting the rest of the snapshot.
 *
 * The path has to name a project discovery actually found. This is the second
 * of two gates — `ws.ts` checks containment before the frame gets this far —
 * and it is here rather than only there because this is where the value is
 * persisted: `last_active_project` is replayed on every later boot and becomes
 * a session cwd once the supervisor lands, so the store should not be able to
 * hold a path nothing ever discovered.
 */
export async function setActiveProjectPath(
  projectPath: string,
): Promise<MemoryWrite> {
  let reason = "";
  const written = await updateSnapshot((previous) => {
    if (!previous.projects.some((project) => project.path === projectPath)) {
      reason = "not a discovered project";
      return undefined;
    }
    return {
      runCount: previous.runCount,
      workspaceRoot: previous.workspaceRoot,
      projects: previous.projects,
      adapters: previous.adapters,
      last_active_project: projectPath,
      attached_adapter: previous.attached_adapter,
      theme: previous.theme,
    };
  });

  if (!written) {
    reason ||= "no world snapshot yet · discovery has not run";
    await recordAction({
      actor: "operator",
      action: "project:select",
      outcome: "blocked",
      detail: `${projectPath} · ${reason}`,
    });
    return { ok: false, reason };
  }

  await recordAction({
    actor: "operator",
    action: "project:select",
    outcome: "ok",
    detail: projectPath,
  });
  return { ok: true };
}

/**
 * Record the operator's theme without rewriting the rest of the snapshot.
 *
 * Before the first discovery pass there is no `state.json` yet — remember the
 * choice in-process and let discovery stamp it when it writes the first
 * snapshot, so a settings toggle mid-pass is not lost.
 */
export async function setTheme(theme: OverseerTheme): Promise<MemoryWrite> {
  const written = await updateSnapshot((previous) => ({
    runCount: previous.runCount,
    workspaceRoot: previous.workspaceRoot,
    projects: previous.projects,
    adapters: previous.adapters,
    last_active_project: previous.last_active_project,
    attached_adapter: previous.attached_adapter,
    theme,
  }));

  if (!written) {
    pendingTheme = theme;
    await recordAction({
      actor: "operator",
      action: "theme:select",
      outcome: "ok",
      detail: `${theme} · pending discovery`,
    });
    return { ok: true };
  }

  await recordAction({
    actor: "operator",
    action: "theme:select",
    outcome: "ok",
    detail: theme,
  });
  return { ok: true };
}

/** Theme to include when discovery (re)writes the world snapshot. */
export function themeForSnapshot(
  previous: WorldSnapshot | undefined,
): OverseerTheme | undefined {
  const pending = pendingTheme;
  pendingTheme = undefined;
  return pending ?? previous?.theme;
}

/** Record which adapter the operator connected. Discovery must have run first. */
export async function setAttachedAdapter(id: string): Promise<boolean> {
  const written = await updateSnapshot((previous) => ({
    runCount: previous.runCount,
    workspaceRoot: previous.workspaceRoot,
    projects: previous.projects,
    adapters: previous.adapters,
    last_active_project: previous.last_active_project,
    attached_adapter: id,
    theme: previous.theme,
  }));
  if (!written) {
    console.error("overseer: cannot attach an adapter before the first discovery pass");
    return false;
  }
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
  return updateSnapshot((previous) => ({
    runCount: previous.runCount,
    workspaceRoot: previous.workspaceRoot,
    projects,
    adapters: previous.adapters,
    last_active_project:
      active !== undefined ? active.path : previous.last_active_project,
    attached_adapter: previous.attached_adapter,
    theme: previous.theme,
  }));
}
