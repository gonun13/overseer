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
import type {
  AdapterStatus,
  DiscoveredProject,
  DiscoveredProvider,
  OverseerTheme,
  AdapterPlan,
  PlanStatus,
  PlanStatusOverride,
} from "@overseer/protocol";

/**
 * Internal memory — the overseer's own record of itself.
 *
 * Lives at `/app/.overseer`, backed by a named Docker volume that is declared
 * in both compose files and bind-mounted in neither, exactly like `agent-home`.
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

function plansFile(): string {
  return path.join(root(), "plans.json");
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
  providers: DiscoveredProvider[];
  /** Last project the operator (or discovery default) made active. */
  last_active_project?: string;
  /** Provider id the operator connected — never auto-picked. */
  attached_provider?: string;
  /** Last theme the operator chose. Absent means samaritan (the default). */
  theme?: OverseerTheme;
  /**
   * Who the app's own commits are authored as. Absent means the operator has
   * not said, and `vcs` falls back to its own identity rather than failing.
   *
   * Kept here rather than in a git config file because the compose files pass
   * `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` through from the host and default
   * them to empty strings, and git reads those env vars ahead of every config
   * file — so a config-file identity would be silently overridden. See
   * `vcs/env.ts`.
   */
  git_identity?: { name: string; email: string };
}

/** Theme chosen before the first discovery snapshot exists — stamped in when
 * discovery writes `state.json`, the same way a mid-pass project pick would
 * otherwise be lost. Cleared by `themeForSnapshot`. */
let pendingTheme: OverseerTheme | undefined;

/** The same holding pen for a git identity set before the first snapshot
 * exists. Cleared by `gitIdentityForSnapshot`. */
let pendingGitIdentity: { name: string; email: string } | undefined;

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
 * What this instance knows about a plan beyond what its transcript says.
 *
 * Two things live here, and only two, because everything else is re-read from
 * the provider's transcripts on every list:
 *
 * - the operator's own verdict, which no amount of reading can recover; and
 * - a copy of the plan itself, so that deleting the session does not delete
 *   the plan. Without it a plan and its session are the same object — the row
 *   would vanish with the transcript, and "implement a plan whose session is
 *   gone" could never happen.
 *
 * Keyed by the plan's tool-use id, which the provider mints and does not
 * reuse.
 */
export interface PlanEntry {
  plan: AdapterPlan;
  /** Absent while the plan is still what the transcript says it is. */
  override?: Exclude<PlanStatus, "proposed" | "in-progress" | "superseded">;
  at: string;
}

export type PlanStore = Record<string, PlanEntry>;

export async function readPlanStore(): Promise<PlanStore> {
  try {
    const parsed = JSON.parse(await readFile(plansFile(), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as PlanStore;
  } catch {
    // No file yet, or one that no longer parses. Either way the honest answer
    // is "nothing is remembered", not a failed list.
    return {};
  }
}

/**
 * Keep a copy of every plan just read out of a transcript.
 *
 * Writes only when something actually changed: this runs on every list, and
 * the list runs on every transcript-monitor tick, so an unconditional publish
 * would rewrite the file every second and a half for the life of the process.
 */
export async function rememberPlans(plans: AdapterPlan[]): Promise<void> {
  if (plans.length === 0) return;
  await serialized(async () => {
    const store = await readPlanStore();
    let changed = false;
    for (const plan of plans) {
      const existing = store[plan.id];
      if (
        existing !== undefined &&
        JSON.stringify(existing.plan) === JSON.stringify(plan)
      ) {
        continue;
      }
      store[plan.id] = {
        ...(existing ?? {}),
        plan,
        at: new Date().toISOString(),
      };
      changed = true;
    }
    if (changed) await publishJson(plansFile(), store);
  });
}

/**
 * Record — or clear, with `"open"` — what the operator says about one plan.
 * Serialised and published the same way the snapshot is: two tabs retiring
 * different plans at once must not lose one of the two.
 */
export async function setPlanOverride(
  planId: string,
  status: PlanStatusOverride,
): Promise<void> {
  await serialized(async () => {
    const store = await readPlanStore();
    const entry = store[planId];
    if (entry === undefined) return;
    if (status === "open") {
      if (entry.override === undefined) return;
      delete entry.override;
    } else {
      entry.override = status;
    }
    entry.at = new Date().toISOString();
    await publishJson(plansFile(), store);
  });
}

/**
 * Serialises every access to the files in this store.
 *
 * Temp-file-plus-rename buys crash safety, not concurrency safety, and there
 * are five writers here: discovery, the workspace monitor's poll,
 * `setActiveProjectPath`, `setAttachedProvider` and `setTheme`. Each is a read, an await,
 * then a write, so two that interleave lose one of the two updates — the
 * monitor reads, the operator attaches a provider, the monitor writes back its
 * stale `attached_provider` and the connection silently reverts. Chaining on a
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
  await publishJson(stateFile(), {
    at: new Date().toISOString(),
    ...snapshot,
  });
}

/** The temp-then-rename publish itself, for the two files in this store that
 * both need it. */
async function publishJson(file: string, body: unknown): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await ensureDirs();
    await writeFile(tmp, JSON.stringify(body, null, 2), "utf8");
    await rename(tmp, file);
  } catch (error) {
    console.error(`overseer: could not write ${path.basename(file)}`, error);
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
 * Read-modify-write part of the snapshot under the lock. `mutate` must stay
 * synchronous: the whole point is that nothing else runs between the read and
 * the write, and an await inside it would reopen the window this closes.
 * Returning `undefined` abandons the write.
 *
 * `mutate` returns only the fields it changes; everything else is carried over
 * from `previous`. It used to return a whole snapshot, which meant six call
 * sites each re-listing every field by hand — and a field added to
 * `WorldSnapshot` was silently dropped by whichever of them was not updated to
 * carry it. Patching makes that class of bug unrepresentable.
 */
function updateSnapshot(
  mutate: (
    previous: WorldSnapshot,
  ) => Partial<Omit<WorldSnapshot, "at">> | undefined,
): Promise<boolean> {
  return serialized(async () => {
    const previous = await readSnapshot();
    if (!previous) return false;
    const patch = mutate(previous);
    if (!patch) return false;
    // `at` is stamped by publishSnapshot, so it must not be carried forward.
    const { at: _stamped, ...carried } = previous;
    await publishSnapshot({ ...carried, ...patch });
    return true;
  });
}

/** True when this instance has completed a discovery pass before. */
export async function hasRunBefore(): Promise<boolean> {
  return (await readSnapshot()) !== undefined;
}

/**
 * The wipe, in the three pieces the operator watches it happen in.
 *
 * Each goes through `serialized` for the same reason every other write does:
 * the workspace monitor and a discovery pass can both be mid-update when the
 * operator answers the decision, and a delete that lands between another
 * writer's read and its write would be published straight back.
 *
 * `ensureDirs` is memoised on a tree that no longer exists after this, so the
 * memo is dropped — otherwise the first `recordAction` of the new run appends
 * into a directory nothing recreated.
 */
export function clearSnapshot(): Promise<void> {
  return serialized(async () => {
    pendingTheme = undefined;
    pendingGitIdentity = undefined;
    await rm(stateFile(), { force: true });
  });
}

export function clearPlanStore(): Promise<void> {
  return serialized(() => rm(plansFile(), { force: true }));
}

export function clearActionRegister(): Promise<void> {
  return serialized(() => rm(actionsFile(), { force: true }));
}

export function clearRunLogs(): Promise<void> {
  return serialized(async () => {
    await rm(logsDir(), { recursive: true, force: true });
    ensured = undefined;
    ensuredRoot = undefined;
    await ensureDirs();
  });
}

/** Everything internal memory holds, in one call. The socket erases the three
 * pieces separately so it can report each one; this is for callers that only
 * want the outcome. The register goes last for the same reason it does there:
 * the deletes record themselves. */
export async function clearInternalMemory(): Promise<void> {
  await clearSnapshot();
  await clearPlanStore();
  await clearRunLogs();
  await clearActionRegister();
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
    return { last_active_project: projectPath };
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
  const written = await updateSnapshot(() => ({ theme }));

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

/**
 * Record the identity the app's own commits are authored under.
 *
 * Same pre-discovery handling as `setTheme`: settings can be opened before the
 * first snapshot exists, and an identity typed then must not be lost.
 */
export async function setGitIdentity(
  name: string,
  email: string,
): Promise<MemoryWrite> {
  const identity = { name, email };
  const written = await updateSnapshot(() => ({ git_identity: identity }));

  if (!written) pendingGitIdentity = identity;
  await recordAction({
    actor: "operator",
    action: "git:identity",
    outcome: "ok",
    // The address is the operator's own and goes in the commits themselves;
    // recording it here is no wider a disclosure than the log it authors.
    detail: written ? `${name} <${email}>` : `${name} <${email}> · pending discovery`,
  });
  return { ok: true };
}

/** The identity `vcs` should author with, or undefined when unset. Reads the
 * pending value too, so an identity set before discovery is honoured by the
 * very next commit rather than only after the first snapshot lands. */
export async function readGitIdentity(): Promise<
  { name: string; email: string } | undefined
> {
  if (pendingGitIdentity) return pendingGitIdentity;
  return (await readSnapshot())?.git_identity;
}

/** Git identity to include when discovery (re)writes the world snapshot. */
export function gitIdentityForSnapshot(
  previous: WorldSnapshot | undefined,
): { name: string; email: string } | undefined {
  const pending = pendingGitIdentity;
  pendingGitIdentity = undefined;
  return pending ?? previous?.git_identity;
}

/** Theme to include when discovery (re)writes the world snapshot. */
export function themeForSnapshot(
  previous: WorldSnapshot | undefined,
): OverseerTheme | undefined {
  const pending = pendingTheme;
  pendingTheme = undefined;
  return pending ?? previous?.theme;
}

/** Record which provider the operator connected. Discovery must have run first. */
export async function setAttachedProvider(id: string): Promise<boolean> {
  const written = await updateSnapshot(() => ({ attached_provider: id }));
  if (!written) {
    console.error("overseer: cannot attach a provider before the first discovery pass");
    return false;
  }
  await recordAction({
    actor: "operator",
    action: "provider:connect",
    outcome: "ok",
    detail: id,
  });
  return true;
}

/**
 * Record a provider's auth status in the world snapshot after a login or a
 * sign-out, without waiting for the next discovery pass to observe it.
 *
 * This is the *only* thing a login persists. The CLI owns the credential and is
 * the source of truth for "am I signed in" — but the snapshot already carries
 * every provider's last-known status, and one fact does need to survive a
 * restart: whether this instance was ever signed in. Without it, a provider
 * reading `authenticated: false` cannot be told apart from one that never
 * signed in at all, and the two want different words on the screen (an expired
 * token is more urgent than an unstarted login).
 *
 * A deliberate sign-out writes `false` here too, so it does not come back as an
 * expiry on the next boot.
 *
 * No-ops before the first snapshot exists — there is nowhere to write yet, and
 * discovery will observe the real status on its way past.
 */
export async function setProviderAuthenticated(
  id: string,
  authenticated: boolean,
): Promise<boolean> {
  return updateSnapshot((previous) => {
    if (!previous.providers.some((provider) => provider.id === id)) return undefined;
    return {
      providers: previous.providers.map((provider) => {
        if (provider.id !== id) return provider;
        // `authExpired` is dropped on both paths: a fresh login is not expired,
        // and a sign-out is a choice rather than an expiry.
        const { authExpired: _dropped, ...rest } = provider;
        return { ...rest, status: { ...provider.status, authenticated } };
      }),
    };
  });
}

/**
 * Replace a provider's full status in the world snapshot (usage refresh, etc.).
 * No-ops before the first snapshot exists.
 */
export async function setProviderStatus(
  id: string,
  status: AdapterStatus,
): Promise<boolean> {
  return updateSnapshot((previous) => {
    if (!previous.providers.some((provider) => provider.id === id)) {
      return undefined;
    }
    return {
      providers: previous.providers.map((provider) =>
        provider.id === id ? { ...provider, status } : provider,
      ),
    };
  });
}

/** Refresh the project list in the world snapshot after a live workspace scan.
 * No-ops until discovery has written the first snapshot. Pass `active` when the
 * monitor changed (or cleared) the active project; omit it to leave the field. */
export async function syncSnapshotProjects(
  projects: DiscoveredProject[],
  active?: { path: string | undefined },
): Promise<boolean> {
  return updateSnapshot((previous) => ({
    projects,
    last_active_project:
      active !== undefined ? active.path : previous.last_active_project,
  }));
}
