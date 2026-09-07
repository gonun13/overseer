import { randomUUID } from "node:crypto";
import type {
  DiscoveredProject,
  DiscoveredProvider,
  DiscoveryEvent,
  DiscoveryOutcome,
  DiscoveryStepUpdate,
  UntrackedFolder,
} from "@overseer/protocol";
import {
  PERSONALITY_PROJECT,
  personalityConfigExists,
  personalityDir,
  readPersonality,
  scaffoldPersonality,
  type PersonalityResult,
} from "./memory/personality/api.js";
import { isCatalogOnly, listAdapters } from "./adapters.js";
import {
  WORKSPACE_ROOT,
  describeProject,
  scanWorkspace,
} from "./workspace.js";
import {
  readSnapshot,
  recordAction,
  gitIdentityForSnapshot,
  themeForSnapshot,
  writeRunLog,
  writeSnapshot,
} from "./memory/internal.js";

/**
 * The discovery pass: what the overseer learns about the world before any
 * session exists. Steps are emitted as they happen rather than collected and
 * flushed at the end — the operations window renders a growing list, and a
 * batch arriving at completion would defeat the point of showing it at all.
 *
 * Furniture unlocks ride on each step's `done` frame (docs/overseer.md §4):
 * clock → personality project list → workspace scan → active project →
 * provider → prompt/footer.
 *
 * Every run is written to internal memory (docs/overseer.md §6.2): one log per
 * run, one action-register entry per step, and a world snapshot at the end.
 */

type Emit = (event: DiscoveryEvent) => void;

/**
 * Which provider counts as attached: the operator's own previous pick, if it
 * is still registered — restored, never re-guessed. Only when nothing was
 * ever picked (or that pick is gone — the adapter was uninstalled, or memory
 * was reset) does this look further, and even then only for a provider that
 * is *already signed in*: auto-attaching an unauthenticated one would
 * surprise the operator with a login flow they did not ask for, which is
 * exactly what "never auto-attach" was guarding against before this existed.
 * A container whose CLI is already logged in should not sit with an empty
 * widget waiting for a click that would only confirm what is already true.
 *
 * One function so the mid-pass status line and the final snapshot/event
 * cannot independently reach different answers.
 */
export function pickAttachedProvider(
  previousId: string | undefined,
  results: DiscoveredProvider[],
): DiscoveredProvider | undefined {
  if (previousId !== undefined) {
    const remembered = results.find((p) => p.id === previousId);
    if (remembered !== undefined) return remembered;
  }
  return results.find((p) => p.status.authenticated);
}

type StepResult<T> = {
  value: T;
  outcome: DiscoveryOutcome;
  detail?: string;
} & DiscoveryStepUpdate;

/** Returns every event the pass emitted, in order, so a client that asked
 * while this one was already running can be sent the same pass rather than a
 * refusal (see `ws.ts`). */
export async function runDiscovery(emit: Emit): Promise<DiscoveryEvent[]> {
  const runId = randomUUID();
  const log: DiscoveryEvent[] = [];

  /** Emits to the client and records to the run log in one move, so the two
   * cannot drift — a step the operator saw that the log does not have would
   * make the log worthless. */
  const send = (event: DiscoveryEvent) => {
    log.push(event);
    emit(event);
  };

  send({ type: "discovery.start", runId });

  const step = async <T>(
    id: string,
    label: string,
    work: () => Promise<StepResult<T>>,
  ): Promise<T> => {
    send({ type: "discovery.step.start", runId, id, label });
    let result: StepResult<T>;
    try {
      result = await work();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      send({ type: "discovery.step.done", runId, id, outcome: "failed", detail });
      await recordAction({
        actor: "overseer",
        action: `discovery:${id}`,
        outcome: "failed",
        detail,
      });
      throw error;
    }
    const { value, outcome, detail, ...update } = result;
    send({
      type: "discovery.step.done",
      runId,
      id,
      outcome,
      detail,
      ...update,
    });
    await recordAction({
      actor: "overseer",
      action: `discovery:${id}`,
      outcome,
      detail,
    });
    return value;
  };

  // Read before the pass writes anything, since this pass is what makes the
  // next boot a returning one.
  const previous = await readSnapshot();
  const returning = previous !== undefined;

  // 1. Wall clock — a runtime fact; unlocks clock + settings gear.
  // Detail is left as ISO; the client reformats it in the browser locale.
  await step("clock", "checking the time", async () => {
    const iso = new Date().toISOString();
    return {
      value: iso,
      outcome: "ok",
      detail: iso,
      serverTime: iso,
      reveal: ["clock"],
    };
  });

  // 2. Personality project: scaffold if `personality.json` is absent, always
  // read. Unlock the project panel with at least overseer-personality once it
  // exists. A returning instance that finds the config gone is a deletion, not
  // a first boot — complain and restore defaults rather than pretending this
  // is ordinary.
  const existed = await personalityConfigExists();
  let personalityRescued = false;
  if (!existed) {
    const restoring = returning;
    const label = restoring
      ? "restoring overseer-personality"
      : "creating overseer-personality";
    await step("scaffold", label, async () => {
      const created = await scaffoldPersonality();
      if (restoring && created) personalityRescued = true;
      return {
        value: created,
        outcome: !created ? "failed" : restoring ? "blocked" : "ok",
        detail: !created
          ? "could not scaffold overseer-personality"
          : restoring
            ? "was deleted · recreated with defaults"
            : personalityDir(),
        ...(restoring && created ? { personalityRescued: true as const } : {}),
      };
    });
  }

  const personality = await step<PersonalityResult>(
    "personality",
    "reading personality",
    async () => {
      const result = await readPersonality(WORKSPACE_ROOT, { scaffold: false });
      const project = await describeProject(personalityDir());
      const projects = project ? [project] : [];
      if (result.rejected.length > 0) {
        return {
          value: result,
          outcome: "blocked",
          detail: `${result.rejected.length} customization${
            result.rejected.length === 1 ? "" : "s"
          } refused`,
          projects,
          personality: result.applied,
          rejected: result.rejected,
          reveal: ["projectPanel"],
          workspaceRoot: WORKSPACE_ROOT,
        };
      }
      return {
        value: result,
        outcome: "ok",
        detail:
          Object.keys(result.applied).length > 0
            ? `${Object.keys(result.applied).length} customization(s) applied`
            : "no customizations set",
        projects,
        personality: result.applied,
        reveal: ["projectPanel"],
        workspaceRoot: WORKSPACE_ROOT,
      };
    },
  );

  // 3. Full workspace scan — grow the project list; signal non-git folders.
  const { projects, untrackedFolders } = await step<{
    projects: DiscoveredProject[];
    untrackedFolders: UntrackedFolder[];
  }>(
    "workspace",
    "scanning workspace",
    async () => {
      const found = await scanWorkspace();
      const untracked = found.untracked;
      const projectsFound = found.projects;
      const detailParts: string[] = [];
      if (projectsFound.length > 0) {
        detailParts.push(
          `${projectsFound.length} project${projectsFound.length === 1 ? "" : "s"}`,
        );
      } else {
        detailParts.push("no git projects");
      }
      if (untracked.length > 0) {
        detailParts.push(
          `${untracked.length} folder${untracked.length === 1 ? "" : "s"} without git`,
        );
      }
      return {
        value: { projects: projectsFound, untrackedFolders: untracked },
        outcome:
          projectsFound.length === 0 || untracked.length > 0 ? "blocked" : "ok",
        detail: `${detailParts.join(" · ")} in ${WORKSPACE_ROOT}`,
        projects: projectsFound,
        untrackedFolders: untracked,
      };
    },
  );

  // 4. Active project from internal memory, else overseer-personality.
  const personalityPath = personalityDir();
  const activeProjectPath = await step<string>(
    "active",
    "selecting project",
    async () => {
      const remembered = previous?.last_active_project;
      const stillThere =
        remembered !== undefined &&
        projects.some((project) => project.path === remembered);
      const chosen = stillThere
        ? remembered
        : projects.find((project) => project.path === personalityPath)?.path ??
          personalityPath;
      return {
        value: chosen,
        outcome: "ok",
        detail: stillThere
          ? chosen
          : `${PERSONALITY_PROJECT} (default)`,
        activeProjectPath: chosen,
        reveal: ["activeProject"],
      };
    },
  );

  // 5. Providers — list what is registered and their auth status. Restores a
  // previously connected id if it is still here; failing that, auto-attaches
  // the first one already signed in (pickAttachedProvider) rather than
  // leaving the widget empty for a provider that needs no operator action at
  // all to be usable.
  const providers = await step<DiscoveredProvider[]>(
    "providers",
    "checking provider auth",
    async () => {
      const registered = listAdapters();
      const results = await Promise.all(
        registered.map(async (adapter): Promise<DiscoveredProvider> => {
          let status;
          try {
            status = await adapter.getStatus();
          } catch (error) {
            status = {
              authenticated: false,
              reachable: false,
              detail:
                error instanceof Error ? error.message : "status check failed",
            };
          }
          // A provider this instance was signed into and now is not has had a
          // credential stop working — carried forward until a login or a
          // sign-out clears it, so a restart does not forget that it happened.
          const before = previous?.providers.find((p) => p.id === adapter.id);
          const expired =
            !status.authenticated &&
            (before?.authExpired === true ||
              before?.status.authenticated === true);
          return {
            id: adapter.id,
            status,
            login: adapter.capabilities.login,
            usageCheck: adapter.capabilities.usageCheck,
            ...(isCatalogOnly(adapter.id) ? { catalogOnly: true as const } : {}),
            ...(expired ? { authExpired: true as const } : {}),
          };
        }),
      );

      const attached = pickAttachedProvider(previous?.attached_provider, results);

      // Registered alone is not success — the operator still needs to connect
      // (and sign in). Maps to [BLOCKED] so the operations line matches the
      // "no provider is attached" signal. `attached` is only ever
      // unauthenticated here when it is the *remembered* one and its
      // credential has since stopped working — pickAttachedProvider's
      // auto-attach branch never returns anything but a signed-in provider.
      const outcome =
        attached?.status.authenticated === true ? "ok" : "blocked";
      const detail =
        results.length === 0
          ? "no providers registered"
          : attached === undefined
            ? `${results.length} registered · none attached`
            : attached.status.authenticated
              ? `attached ${attached.id}`
              : `attached ${attached.id} · not authenticated`;

      return {
        value: results,
        outcome,
        detail,
        providers: results,
        ...(attached !== undefined ? { attachedProviderId: attached.id } : {}),
        reveal: ["providerWidget"],
      };
    },
  );

  const attachedProviderId = pickAttachedProvider(
    previous?.attached_provider,
    providers,
  )?.id;

  // 6. Prompt + footer — last beat. Footer always; prompt slot released so it
  // can mount once an attached provider is signed in (furniture still gates).
  const promptReady =
    attachedProviderId !== undefined &&
    providers.some(
      (p) => p.id === attachedProviderId && p.status.authenticated,
    );
  await step("prompt", "releasing the prompt", async () => ({
    value: promptReady,
    outcome: promptReady ? "ok" : "blocked",
    detail: promptReady
      ? "prompt ready"
      : "held · connect an authenticated provider",
    reveal: ["footer", "prompt"],
  }));

  send({
    type: "discovery.complete",
    runId,
    projects,
    untrackedFolders,
    providers,
    workspaceRoot: WORKSPACE_ROOT,
    returning,
    activeProjectPath,
    ...(attachedProviderId !== undefined ? { attachedProviderId } : {}),
    personality: personality.applied,
    ...(personality.rejected.length > 0
      ? { rejected: personality.rejected }
      : {}),
    ...(personalityRescued ? { personalityRescued: true as const } : {}),
  });

  const theme = themeForSnapshot(previous);
  const gitIdentity = gitIdentityForSnapshot(previous);
  await Promise.all([
    writeRunLog(runId, log),
    writeSnapshot({
      runCount: (previous?.runCount ?? 0) + 1,
      workspaceRoot: WORKSPACE_ROOT,
      projects,
      providers,
      last_active_project: activeProjectPath,
      attached_provider: attachedProviderId,
      ...(theme !== undefined ? { theme } : {}),
      ...(gitIdentity !== undefined ? { git_identity: gitIdentity } : {}),
    }),
  ]);

  return log;
}
