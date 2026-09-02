import type { AdapterUsageWindow, AgentAdapter } from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { readSnapshot, type WorldSnapshot } from "./memory/internal.js";
import { isInsideWorkspace } from "./workspace.js";

/**
 * On-demand usage report for the attached provider (`AgentAdapter
 * .checkUsage`) — distinct from `usage-refresh.ts`'s gauges: this is never
 * scheduled, only asked, because for an adapter like cursor's the ask is a
 * real, possibly slow, possibly costly CLI turn rather than a free
 * deterministic command.
 *
 * Single-flight for the same reason `provider-options.ts` is: two tabs
 * asking on the same tick must not spawn two of these.
 */

export type UsageCheckResult =
  | {
      ok: true;
      providerId: string;
      report: string;
      windows: AdapterUsageWindow[];
      spend?: string;
    }
  | { ok: false; reason: string };

export interface UsageCheckDeps {
  readSnapshot?: () => Promise<WorldSnapshot | undefined>;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  isInsideWorkspace?: (path: string) => Promise<boolean>;
}

export function createUsageCheck(deps: UsageCheckDeps = {}) {
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const isInsideWorkspaceFn = deps.isInsideWorkspace ?? isInsideWorkspace;

  let inFlight: Promise<UsageCheckResult> | undefined;

  async function context(): Promise<
    | { ok: true; adapter: AgentAdapter; projectDir: string }
    | { ok: false; reason: string }
  > {
    const snapshot = await readSnapshotFn();
    const providerId = snapshot?.attached_provider;
    if (providerId === undefined) {
      return { ok: false, reason: "no provider attached" };
    }
    const projectDir = snapshot?.last_active_project;
    if (projectDir === undefined) {
      return { ok: false, reason: "no active project" };
    }
    if (!(await isInsideWorkspaceFn(projectDir))) {
      return {
        ok: false,
        reason: "active project is not inside the workspace",
      };
    }
    const adapter = getAdapterFn(providerId);
    if (adapter === undefined) {
      return { ok: false, reason: `unknown provider: ${providerId}` };
    }
    if (adapter.checkUsage === undefined) {
      return { ok: false, reason: `${adapter.id} has no usage report` };
    }
    let status;
    try {
      status = await adapter.getStatus();
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : "could not read provider status",
      };
    }
    if (!status.authenticated) {
      return { ok: false, reason: "provider is not signed in" };
    }
    return { ok: true, adapter, projectDir };
  }

  return {
    async check(): Promise<UsageCheckResult> {
      if (inFlight !== undefined) return inFlight;

      const promise = (async (): Promise<UsageCheckResult> => {
        const ctx = await context();
        if (!ctx.ok) return ctx;

        const providerId = ctx.adapter.id;
        let result;
        try {
          result = await ctx.adapter.checkUsage!({ projectDir: ctx.projectDir });
        } catch (error) {
          return {
            ok: false,
            reason:
              error instanceof Error
                ? error.message
                : "could not read usage report",
          };
        }
        if (!result.ok) return { ok: false, reason: result.reason };
        return {
          ok: true,
          providerId,
          report: result.report,
          windows: result.windows,
          ...(result.spend !== undefined ? { spend: result.spend } : {}),
        };
      })();

      inFlight = promise;
      try {
        return await promise;
      } finally {
        inFlight = undefined;
      }
    },
  };
}

export type UsageCheckService = ReturnType<typeof createUsageCheck>;
