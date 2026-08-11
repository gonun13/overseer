import { randomUUID } from "node:crypto";
import type {
  DiscoveredAdapter,
  DiscoveredProject,
  DiscoveryEvent,
  DiscoveryOutcome,
} from "@overseer/protocol";
import { readPersonality, type PersonalityResult } from "./memory/personality.js";
import { listAdapters } from "./adapters.js";
import { WORKSPACE_ROOT, scanWorkspace } from "./workspace.js";
import {
  readSnapshot,
  recordAction,
  writeRunLog,
  writeSnapshot,
} from "./memory/internal.js";

/**
 * The discovery pass: what the overseer learns about the world before any
 * session exists. Steps are emitted as they happen rather than collected and
 * flushed at the end — the operations window renders a growing list, and a
 * batch arriving at completion would defeat the point of showing it at all.
 *
 * Every run is written to internal memory (docs/overseer.md §6.2): one log per
 * run, one action-register entry per step, and a world snapshot at the end.
 */

type Emit = (event: DiscoveryEvent) => void;

export async function runDiscovery(emit: Emit): Promise<void> {
  const runId = randomUUID();
  const log: unknown[] = [];

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
    work: () => Promise<{ value: T; outcome: DiscoveryOutcome; detail?: string }>,
  ): Promise<T> => {
    send({ type: "discovery.step.start", runId, id, label });
    let result: { value: T; outcome: DiscoveryOutcome; detail?: string };
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
    send({
      type: "discovery.step.done",
      runId,
      id,
      outcome: result.outcome,
      detail: result.detail,
    });
    await recordAction({
      actor: "overseer",
      action: `discovery:${id}`,
      outcome: result.outcome,
      detail: result.detail,
    });
    return result.value;
  };

  // Read before the pass writes anything, since this pass is what makes the
  // next boot a returning one.
  const previous = await readSnapshot();
  const returning = previous !== undefined;

  // Runs before the scan, deliberately: scaffolding the project first is what
  // lets the ordinary scanner find it, so it reaches the project panel with no
  // special-casing in the UI (docs/overseer.md §6.3).
  const personality = await step<PersonalityResult>(
    "personality",
    "reading personality",
    async () => {
      const result = await readPersonality();
      if (result.rejected.length > 0) {
        return {
          value: result,
          // Rejections need the operator: they wrote something that did not
          // take effect. Blocked, not failed — the read itself worked.
          outcome: "blocked",
          detail: `${result.rejected.length} customization${
            result.rejected.length === 1 ? "" : "s"
          } refused`,
        };
      }
      return {
        value: result,
        outcome: "ok",
        detail: result.scaffolded
          ? "scaffolded overseer-personality"
          : Object.keys(result.applied).length > 0
            ? `${Object.keys(result.applied).length} customization(s) applied`
            : "no customizations set",
      };
    },
  );

  const projects = await step<DiscoveredProject[]>(
    "workspace",
    "scanning workspace",
    async () => {
      const found = await scanWorkspace();
      return {
        value: found,
        // An empty workspace is not a failure — it is the state the wizard
        // exists to talk the operator through.
        outcome: found.length > 0 ? "ok" : "blocked",
        detail:
          found.length > 0
            ? `${found.length} project${found.length === 1 ? "" : "s"} in ${WORKSPACE_ROOT}`
            : `no git projects under ${WORKSPACE_ROOT}`,
      };
    },
  );

  const adapters = await step<DiscoveredAdapter[]>(
    "adapters",
    "checking adapter auth",
    async () => {
      const registered = listAdapters();
      const results = await Promise.all(
        registered.map(async (adapter): Promise<DiscoveredAdapter> => {
          try {
            return { id: adapter.id, status: await adapter.getStatus() };
          } catch (error) {
            // An adapter that throws from its own status check is reporting a
            // status, not breaking the pass.
            return {
              id: adapter.id,
              status: {
                authenticated: false,
                detail:
                  error instanceof Error
                    ? error.message
                    : "status check failed",
              },
            };
          }
        }),
      );

      const authed = results.filter((a) => a.status.authenticated);
      return {
        value: results,
        outcome: authed.length > 0 ? "ok" : "blocked",
        detail:
          results.length === 0
            ? "no adapters registered"
            : `${authed.length}/${results.length} authenticated`,
      };
    },
  );

  send({
    type: "discovery.complete",
    runId,
    projects,
    adapters,
    workspaceRoot: WORKSPACE_ROOT,
    returning,
    personality: personality.applied,
    // Omitted rather than sent empty: "nothing was refused" is the absence of
    // the field, not an empty list the client has to special-case.
    ...(personality.rejected.length > 0
      ? { rejected: personality.rejected }
      : {}),
  });

  await Promise.all([
    writeRunLog(runId, log),
    writeSnapshot({
      runCount: (previous?.runCount ?? 0) + 1,
      workspaceRoot: WORKSPACE_ROOT,
      projects,
      adapters,
    }),
  ]);
}
