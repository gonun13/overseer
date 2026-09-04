import type { AgentAdapter, ProviderOptions } from "@overseer/protocol";
import type { WorldSnapshot } from "./memory/internal.js";
import { resolveProviderContext } from "./provider-context.js";

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
  /** Keyed `<providerId>\0<projectDir>` — a different provider is a different answer. */
  const inFlight = new Map<string, Promise<OptionsResult>>();

  function keyFor(providerId: string, projectDir: string): string {
    return `${providerId}\0${projectDir}`;
  }

  function context() {
    return resolveProviderContext(
      // A catalog stub. Refuse rather than answer with plausible defaults —
      // menus the provider cannot honour are worse than menus that stay shut.
      (adapter) =>
        adapter.listOptions === undefined
          ? `${adapter.id} cannot report session options`
          : undefined,
      // Signed in, because answering means spawning the CLI.
      { authenticated: true, deps },
    );
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
