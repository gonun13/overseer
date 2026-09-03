import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiscoveredProject } from "@overseer/protocol";

const execFileAsync = promisify(execFile);

/**
 * The one place branch/dirtiness is read for the project list.
 *
 * Three things this owns that the old inline probes did not:
 *
 * 1. **A last-good cache.** A probe that fails returns the previous answer
 *    instead of nothing. Erasing a known branch is worse than reporting a
 *    slightly stale one — the panel used to flash "branch unknown" every time
 *    the bind mount stalled under a host-side `git status`.
 * 2. **Gating.** The branch only changes when `.git/HEAD` (or `packed-refs`)
 *    does, so an unchanged stat pair skips the spawn entirely; dirtiness has
 *    no such marker and instead gets a floor between probes, lifted by
 *    `force` when a watcher actually saw something move. An idle workspace
 *    costs stats, not processes.
 * 3. **A budget the mount can actually meet.** 15s, not 5s — and a kill is
 *    reported as a stall rather than logged as if git had failed.
 *
 * On-demand operator reads (`project-git.ts`) deliberately do not come
 * through here: a person who just pressed a button gets a fresh answer.
 */

/** Long enough for a stalled Docker Desktop bind mount to answer. The old 5s
 * was under the stall time of a `git status` walking ~25k files. */
export const PROBE_TIMEOUT_MS = 15_000;
/** A probe slower than this is worth the operator's attention even though it
 * answered. */
export const SLOW_PROBE_MS = 1_000;
/** Floor between dirtiness probes on an untouched project. */
export const DIRTY_MIN_MS = 15_000;
/** Directories probed at once — a workspace of thirty projects must not turn
 * one tick into sixty simultaneous `git` processes. */
const CONCURRENCY = 4;

export interface GitMeta {
  gitBranch?: string;
  dirty?: boolean;
}

/** What went wrong (or came right) on a probe, for the operations window. */
export type ProbeEventKind = "slow" | "timeout" | "failed" | "recovered";

export interface ProbeEvent {
  dir: string;
  kind: ProbeEventKind;
  /** The git invocation this is about, as the operator would type it. */
  command: string;
  ms: number;
  detail?: string;
}

interface ProbeEntry {
  gitBranch?: string;
  dirty?: boolean;
  /** `.git/HEAD` + `.git/packed-refs` identity at the last good branch read. */
  headKey?: string;
  /** When the dirtiness probe last succeeded. */
  dirtyAt?: number;
  /** The trouble already reported for this directory — repeats stay quiet. */
  reported?: Exclude<ProbeEventKind, "recovered">;
}

export interface GitProbeDeps {
  /** One `git` invocation in `dir` under a timeout. Swappable in tests for
   * canned stdout, and for errors shaped like `execFile`'s (`killed`/`signal`
   * on a timeout kill). */
  run?: (
    dir: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<{ stdout: string }>;
  stat?: typeof stat;
  now?: () => number;
  timeoutMs?: number;
  slowMs?: number;
  dirtyMinMs?: number;
}

async function defaultRun(
  dir: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string }> {
  return execFileAsync("git", args, { cwd: dir, timeout: timeoutMs });
}

/** A timeout kill, as opposed to git itself refusing. `execFile` reports the
 * kill on the error rather than in stderr — which is why these used to log as
 * a bare "Command failed" with nothing after it. */
function killedByTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { killed?: boolean; signal?: unknown };
  return e.killed === true || (e.signal !== undefined && e.signal !== null);
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) {
      return stderr.trim().split("\n")[0] ?? stderr.trim();
    }
  }
  return error instanceof Error ? error.message : "git probe failed";
}

/** Bounded-concurrency `Promise.all`. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** Worse trouble wins when both probes complain in the same read. */
const TROUBLE_RANK: Record<Exclude<ProbeEventKind, "recovered">, number> = {
  slow: 1,
  failed: 2,
  timeout: 3,
};

export function createGitProbe(deps: GitProbeDeps = {}) {
  const run = deps.run ?? defaultRun;
  const statFn = deps.stat ?? stat;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const slowMs = deps.slowMs ?? SLOW_PROBE_MS;
  const dirtyMinMs = deps.dirtyMinMs ?? DIRTY_MIN_MS;

  const cache = new Map<string, ProbeEntry>();
  let events: ProbeEvent[] = [];

  /**
   * Identity of the refs that decide the current branch name, or undefined
   * when it cannot be established — a `.git` file (worktree or submodule) or
   * an unreadable stat both mean "gate is open, probe every time" rather than
   * "nothing changed".
   */
  async function readHeadKey(dir: string): Promise<string | undefined> {
    const gitPath = path.join(dir, ".git");
    try {
      if (!(await statFn(gitPath)).isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    const parts: string[] = [];
    for (const name of ["HEAD", "packed-refs"]) {
      try {
        const entry = await statFn(path.join(gitPath, name));
        parts.push(`${entry.mtimeMs}:${entry.size}`);
      } catch {
        // `packed-refs` is absent in plenty of healthy repositories; only
        // both being unreadable means we learned nothing.
        parts.push("-");
      }
    }
    return parts.every((part) => part === "-") ? undefined : parts.join("|");
  }

  interface ProbeOutcome<T> {
    value?: T;
    trouble?: { kind: Exclude<ProbeEventKind, "recovered">; event: ProbeEvent };
  }

  async function probe<T>(
    dir: string,
    args: string[],
    parse: (stdout: string) => T,
  ): Promise<ProbeOutcome<T>> {
    const started = now();
    const command = `git ${args.join(" ")}`;
    try {
      const { stdout } = await run(dir, args, timeoutMs);
      const ms = now() - started;
      if (ms >= slowMs) {
        return {
          value: parse(stdout),
          trouble: {
            kind: "slow",
            event: { dir, kind: "slow", command, ms },
          },
        };
      }
      return { value: parse(stdout) };
    } catch (error) {
      const ms = now() - started;
      const timedOut = killedByTimeout(error);
      return {
        trouble: {
          kind: timedOut ? "timeout" : "failed",
          event: {
            dir,
            kind: timedOut ? "timeout" : "failed",
            command,
            ms,
            detail: timedOut ? `killed after ${(ms / 1000).toFixed(1)}s` : describe(error),
          },
        },
      };
    }
  }

  /**
   * Branch and dirtiness for one project. Never throws, never clears a known
   * answer: what comes back is the freshest value this process has.
   */
  async function read(
    dir: string,
    opts: { force?: boolean } = {},
  ): Promise<GitMeta> {
    const entry = cache.get(dir) ?? {};
    cache.set(dir, entry);

    const headKey = await readHeadKey(dir);
    const needBranch =
      entry.gitBranch === undefined ||
      headKey === undefined ||
      headKey !== entry.headKey;
    const needDirty =
      entry.dirty === undefined ||
      opts.force === true ||
      entry.dirtyAt === undefined ||
      now() - entry.dirtyAt >= dirtyMinMs;

    const [branchOutcome, dirtyOutcome] = await Promise.all([
      needBranch
        ? probe(dir, ["branch", "--show-current"], (stdout) => {
            const name = stdout.trim();
            // Empty stdout with a zero exit is detached HEAD, not a missing
            // answer.
            return name.length > 0 ? name : "detached";
          })
        : undefined,
      needDirty
        ? probe(
            dir,
            ["status", "--porcelain"],
            (stdout) => stdout.trim().length > 0,
          )
        : undefined,
    ]);

    if (branchOutcome?.value !== undefined) {
      entry.gitBranch = branchOutcome.value;
      entry.headKey = headKey;
    }
    if (dirtyOutcome?.value !== undefined) {
      entry.dirty = dirtyOutcome.value;
      entry.dirtyAt = now();
    }

    reportTrouble(dir, entry, [branchOutcome, dirtyOutcome]);

    return {
      ...(entry.gitBranch !== undefined ? { gitBranch: entry.gitBranch } : {}),
      ...(entry.dirty !== undefined ? { dirty: entry.dirty } : {}),
    };
  }

  /**
   * Queue an operations line only when the directory's state actually
   * changed. A mount stalled for ten minutes is one line, not one hundred and
   * twenty, and coming back is worth exactly one more.
   */
  function reportTrouble(
    dir: string,
    entry: ProbeEntry,
    outcomes: (ProbeOutcome<unknown> | undefined)[],
  ): void {
    const attempted = outcomes.filter(
      (outcome): outcome is ProbeOutcome<unknown> => outcome !== undefined,
    );
    // Everything gated: nothing was learned either way, so say nothing.
    if (attempted.length === 0) return;

    const troubles = attempted
      .map((outcome) => outcome.trouble)
      .filter((trouble): trouble is NonNullable<typeof trouble> => trouble !== undefined)
      .sort((a, b) => TROUBLE_RANK[b.kind] - TROUBLE_RANK[a.kind]);
    const worst = troubles[0];

    if (worst !== undefined) {
      if (entry.reported === worst.kind) return;
      entry.reported = worst.kind;
      events.push(worst.event);
      console.error(
        `overseer: ${worst.event.command} ${worst.kind} in ${dir}`,
        worst.event.detail ?? `${Math.round(worst.event.ms)}ms`,
      );
      return;
    }

    if (entry.reported !== undefined) {
      entry.reported = undefined;
      events.push({ dir, kind: "recovered", command: "git", ms: 0 });
    }
  }

  /** Branch/dirtiness for a whole listing, without another readdir. */
  async function readMany(
    projects: DiscoveredProject[],
    opts: { force?: boolean } = {},
  ): Promise<DiscoveredProject[]> {
    return mapLimit(projects, CONCURRENCY, async (project) => ({
      name: project.name,
      path: project.path,
      ...(await read(project.path, opts)),
    }));
  }

  /** Drop a directory that is no longer a project. */
  function forget(dir: string): void {
    cache.delete(dir);
  }

  /** Take the queued events; the caller owns turning them into steps. */
  function takeEvents(): ProbeEvent[] {
    const taken = events;
    events = [];
    return taken;
  }

  return { read, readMany, forget, takeEvents };
}

/** The instance the workspace monitor and discovery share. */
export const gitProbe = createGitProbe();
