import type { AgentAdapter, ProviderOptions } from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { readSnapshot, type WorldSnapshot } from "./memory/internal.js";
import { isInsideWorkspace } from "./workspace.js";

/**
 * What the attached provider offers a session.
 *
 * Single-flight, but deliberately **not cached**. Part of the answer is the
 * operator's own subagent files, which they can add or edit at any moment
 * without telling us — a cached list would go on offering yesterday's agents
 * until they happened to switch projects. The client asks on human timescales
 * (attaching a provider, changing project, opening a control row), and the ask
 * costs one free subprocess, so re-asking is cheaper than being wrong.
 *
 * Single-flight still matters for the same reason discovery's does: two tabs
 * opening the model row on the same tick must not spawn two children.
 */

export type OptionsResult =
  | { ok: true; providerId: string; projectDir: string; options: ProviderOptions }
  | { ok: false; reason: string };

export interface ProviderOptionsDeps {
  readSnapshot?: () => Promise<WorldSnapshot | undefined>;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  isInsideWorkspace?: (path: string) => Promise<boolean>;
}

export function createProviderOptions(deps: ProviderOptionsDeps = {}) {
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const isInsideWorkspaceFn = deps.isInsideWorkspace ?? isInsideWorkspace;

  /** Keyed `<providerId>\0<projectDir>` — a different provider is a different answer. */
  const inFlight = new Map<string, Promise<OptionsResult>>();

  function keyFor(providerId: string, projectDir: string): string {
    return `${providerId}\0${projectDir}`;
  }

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
    if (adapter.listOptions === undefined) {
      // A catalog stub. Refuse rather than answer with plausible defaults —
      // menus the provider cannot honour are worse than menus that stay shut.
      return {
        ok: false,
        reason: `${adapter.id} cannot report session options`,
      };
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
    async read(): Promise<OptionsResult> {
      const ctx = await context();
      if (!ctx.ok) return ctx;

      const providerId = ctx.adapter.id;
      const { projectDir } = ctx;
      const key = keyFor(providerId, projectDir);

      const existing = inFlight.get(key);
      if (existing !== undefined) return existing;

      const promise = (async (): Promise<OptionsResult> => {
        let options: ProviderOptions;
        try {
          options = await ctx.adapter.listOptions!({ projectDir });
        } catch (error) {
          return {
            ok: false,
            reason:
              error instanceof Error
                ? error.message
                : "could not read session options",
          };
        }
        return { ok: true, providerId, projectDir, options };
      })();

      inFlight.set(key, promise);
      try {
        return await promise;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

export type ProviderOptionsService = ReturnType<typeof createProviderOptions>;
