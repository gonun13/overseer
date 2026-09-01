import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The dev loop's session leases, read from its own file store.
 *
 * The loop records one lease per workspace at `loop/db/<slug>/running.json`,
 * carrying the id of the provider session that run opened (`loop/run` mints it
 * and `running_claim` writes it). Reading it is what lets the app tell a loop's
 * session apart from one a human started in the same project.
 *
 * Read straight from the file rather than through `loop/bin/list --json`, which
 * is the loop's stated read interface: that command resolves git branches and
 * PR state per open request, and the sessions list is rebuilt often enough that
 * paying for a bash+jq process each time is the wrong trade. The cost is this
 * module duplicating two rules from `loop/bin/lib/db.sh` — where the file lives
 * (`running_path`) and that a lease whose holder is gone is not a lease
 * (`_running_pid_alive`). Both are checked by the tests here.
 *
 * Reaping stale leases is deliberately NOT done: the file is the loop's to
 * write, and `running_claim` already clears a dead one before claiming.
 */

/** Where the loop's file store lives. The image owns the path; `/app/loop/db`
 * is where the Dockerfile puts it and where `bin/loop` execs against. */
const LOOP_DB_DIR = process.env.OVERSEER_LOOP_DB ?? "/app/loop/db";

export interface LoopLease {
  /** Workspace slug — the directory name under `loop/db/`. */
  slug: string;
  pid: number;
  startedAt: string;
  /** Absent when the provider bundle could not be told which id to use, and on
   * a lease written before the loop started recording it. */
  sessionId?: string;
}

export interface LoopSessionDeps {
  loopDbDir?: string;
  /** Whether a lease holder is still running. Seam for tests. */
  isAlive?: (pid: number) => boolean;
}

function defaultIsAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without delivering anything — the same
    // check `_running_pid_alive` makes with `kill -0`.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLease(slug: string, raw: string): LoopLease | undefined {
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof record !== "object" || record === null) return undefined;
  const { pid, started_at: startedAt, session_id: sessionId } = record as {
    pid?: unknown;
    started_at?: unknown;
    session_id?: unknown;
  };
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  return {
    slug,
    pid,
    startedAt: typeof startedAt === "string" ? startedAt : "",
    // `session_id` is written as an explicit null when the bundle had no id to
    // give, so absent and null must read the same way.
    ...(typeof sessionId === "string" && sessionId !== ""
      ? { sessionId }
      : {}),
  };
}

/** Every live loop lease. A workspace with no run, a dead holder, or an
 * unreadable file simply contributes nothing. */
export async function readLoopLeases(
  deps: LoopSessionDeps = {},
): Promise<LoopLease[]> {
  const dir = deps.loopDbDir ?? LOOP_DB_DIR;
  const isAlive = deps.isAlive ?? defaultIsAlive;

  let slugs: string[];
  try {
    slugs = await readdir(dir);
  } catch {
    // No loop store at all — the loop has never run here.
    return [];
  }

  const leases: LoopLease[] = [];
  for (const slug of slugs) {
    let raw: string;
    try {
      raw = await readFile(path.join(dir, slug, "running.json"), "utf8");
    } catch {
      continue;
    }
    const lease = parseLease(slug, raw);
    if (lease === undefined) continue;
    if (!isAlive(lease.pid)) continue;
    leases.push(lease);
  }
  return leases;
}

/**
 * Live loop sessions by session id. Leases with no recorded id contribute
 * nothing — the run is live, but no session can be attributed to it, and
 * guessing would mark an unrelated session as the loop's.
 */
export async function loopSessionIndex(
  deps: LoopSessionDeps = {},
): Promise<Map<string, LoopLease>> {
  const index = new Map<string, LoopLease>();
  for (const lease of await readLoopLeases(deps)) {
    if (lease.sessionId === undefined) continue;
    index.set(lease.sessionId, lease);
  }
  return index;
}

export interface LoopSessionRecord {
  id: string;
  /** Directory the run worked in — what deleting its transcript needs. */
  dir: string;
  slug: string;
}

/**
 * Every provider session the loop has opened for a workspace, live or not,
 * from `loop/db/<slug>/sessions.jsonl`.
 *
 * A loop conversation is disposable — it is re-created from `overseer.md` on
 * every run, and the work that matters is recorded in the loop's own db — so
 * this exists only to know which transcripts are ours to delete once the run
 * that made them is gone.
 */
export async function readLoopSessionRecords(
  deps: LoopSessionDeps = {},
): Promise<LoopSessionRecord[]> {
  const dir = deps.loopDbDir ?? LOOP_DB_DIR;
  let slugs: string[];
  try {
    slugs = await readdir(dir);
  } catch {
    return [];
  }

  const records: LoopSessionRecord[] = [];
  for (const slug of slugs) {
    let raw: string;
    try {
      raw = await readFile(path.join(dir, slug, "sessions.jsonl"), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      let record: { id?: unknown; dir?: unknown };
      try {
        record = JSON.parse(line) as { id?: unknown; dir?: unknown };
      } catch {
        continue;
      }
      if (typeof record.id !== "string" || record.id === "") continue;
      if (typeof record.dir !== "string" || record.dir === "") continue;
      records.push({ id: record.id, dir: record.dir, slug });
    }
  }
  return records;
}

/** Rewrite one workspace's record, keeping only `keep`. */
async function writeLoopSessionRecords(
  loopDbDir: string,
  slug: string,
  keep: LoopSessionRecord[],
): Promise<void> {
  const file = path.join(loopDbDir, slug, "sessions.jsonl");
  const body = keep
    .map((r) => `${JSON.stringify({ id: r.id, dir: r.dir })}\n`)
    .join("");
  if (body === "") {
    await rm(file, { force: true });
    return;
  }
  await writeFile(file, body);
}

/**
 * Delete the transcripts of loop runs that have ended, and forget them.
 *
 * There is one loop per workspace and its conversation does not outlive it:
 * the next run starts from `overseer.md` again, and nothing reads a finished
 * one. Leaving them behind filled the sessions list with dead rows that were
 * indistinguishable from real conversations and could still be resumed.
 *
 * Only the run holding the lease is spared. A record whose transcript is
 * already gone is dropped just the same, so this converges rather than
 * retrying a delete forever.
 */
export async function sweepDeadLoopSessions(
  deleteTranscript: (projectDir: string, sessionId: string) => Promise<void>,
  deps: LoopSessionDeps = {},
): Promise<string[]> {
  const loopDbDir = deps.loopDbDir ?? LOOP_DB_DIR;
  const records = await readLoopSessionRecords(deps);
  if (records.length === 0) return [];

  const liveIds = new Set(
    (await readLoopLeases(deps))
      .map((lease) => lease.sessionId)
      .filter((id): id is string => id !== undefined),
  );

  const swept: string[] = [];
  const keepBySlug = new Map<string, LoopSessionRecord[]>();
  for (const record of records) {
    const keep = keepBySlug.get(record.slug) ?? [];
    if (liveIds.has(record.id)) {
      keep.push(record);
      keepBySlug.set(record.slug, keep);
      continue;
    }
    try {
      await deleteTranscript(record.dir, record.id);
      swept.push(record.id);
    } catch (error) {
      // Keep the record so the next sweep tries again — but never let one
      // stubborn file stop the rest.
      console.error("overseer: could not delete loop transcript", error);
      keep.push(record);
    }
    keepBySlug.set(record.slug, keep);
  }

  for (const [slug, keep] of keepBySlug) {
    try {
      await writeLoopSessionRecords(loopDbDir, slug, keep);
    } catch (error) {
      console.error("overseer: could not prune loop session record", error);
    }
  }
  return swept;
}

/** Workspace name to the directory name the loop files it under. Mirrors
 * `slugify` in `loop/bin/lib/common.sh`. */
export function loopSlug(workspaceName: string): string {
  return workspaceName.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * What a loop run is called wherever it is listed.
 *
 * The same shape the console window's tab uses, so a run reads identically in
 * the sessions list and in the window it opens. Kept here, next to the lease
 * this name is derived from, rather than at either call site — the web builds
 * the tab from the session's own `name` whenever it has one, so this is the
 * single spelling of it in practice.
 */
export function loopSessionName(workspaceSlug: string): string {
  return `loop · ${workspaceSlug}`;
}

/** How long a terminated run gets to exit before it is killed outright —
 * the same grace the console PTYs give. */
const TAKEOVER_GRACE_MS = 5_000;
const TAKEOVER_POLL_MS = 100;

export interface TakeoverDeps extends LoopSessionDeps {
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** The holder's argv, for confirming it is really a loop run. */
  readCmdline?: (pid: number) => Promise<string | undefined>;
  graceMs?: number;
  pollMs?: number;
}

async function defaultReadCmdline(pid: number): Promise<string | undefined> {
  try {
    // NUL-separated on Linux; only used for a substring test.
    return await readFile(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * End the loop run holding `workspaceName`'s lease, so a new one can claim it.
 *
 * This is destructive by design — the operator asked to take a run over — but
 * it refuses to signal a process it cannot confirm is a loop run. A lease
 * naming a pid the kernel has since recycled would otherwise have this killing
 * an unrelated process, and the lease is a plain file that outlives a crash.
 *
 * The lease itself is not removed: `running_claim` reaps a dead holder's lease
 * before claiming, so leaving it is both correct and the loop's own business.
 */
export async function takeoverLoop(
  workspaceName: string,
  deps: TakeoverDeps = {},
): Promise<{ ok: true; killed: boolean } | { ok: false; reason: string }> {
  const isAlive = deps.isAlive ?? defaultIsAlive;
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const readCmdline = deps.readCmdline ?? defaultReadCmdline;
  const graceMs = deps.graceMs ?? TAKEOVER_GRACE_MS;
  const pollMs = deps.pollMs ?? TAKEOVER_POLL_MS;

  const slug = loopSlug(workspaceName);
  const lease = (await readLoopLeases(deps)).find((l) => l.slug === slug);
  // Nothing live to take over — the caller can just start a run.
  if (lease === undefined) return { ok: true, killed: false };

  const cmdline = await readCmdline(lease.pid);
  if (cmdline === undefined) {
    // It answered `kill -0` a moment ago; if its argv is already unreadable it
    // is on its way out, and the lease will reap itself.
    return { ok: true, killed: false };
  }
  if (!cmdline.includes("loop/run")) {
    return {
      ok: false,
      reason: `lease for '${slug}' names pid ${lease.pid}, which is not a loop run`,
    };
  }

  try {
    kill(lease.pid, "SIGTERM");
  } catch {
    return { ok: true, killed: false };
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(lease.pid)) return { ok: true, killed: true };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  try {
    kill(lease.pid, "SIGKILL");
  } catch {
    // Gone between the last check and here.
  }
  return { ok: true, killed: true };
}
