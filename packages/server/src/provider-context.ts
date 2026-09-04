import type { AgentAdapter } from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { readSnapshot, type WorldSnapshot } from "./memory/internal.js";
import { isInsideWorkspace } from "./workspace.js";

/**
 * "Which adapter, in which project" — the question every provider-scoped
 * request has to answer before it can do anything.
 *
 * Its own module because the containment step in the middle
 * (`isInsideWorkspace` on the remembered project) is the one thing in this
 * server that must have exactly one copy. A second, drifting version of that
 * argument is how a path check quietly stops covering a caller.
 */

export interface ProviderContextDeps {
  readSnapshot?: () => Promise<WorldSnapshot | undefined>;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  isInsideWorkspace?: (path: string) => Promise<boolean>;
}

export type ProviderContext =
  | { ok: true; adapter: AgentAdapter; projectDir: string }
  | { ok: false; reason: string };

/**
 * `requires` names what the caller needs of the adapter, returning the
 * operator-facing refusal when it is missing — a catalog stub is refused
 * rather than answered with plausible defaults.
 *
 * `authenticated` is opt-in rather than assumed. Asking the CLI something
 * needs a signed-in provider; reading and writing the operator's own config
 * files does not, and gating those on auth would lock an operator out of
 * fixing the very thing their next sign-in will run.
 */
export async function resolveProviderContext(
  requires: (adapter: AgentAdapter) => string | undefined,
  opts: { authenticated?: boolean; deps?: ProviderContextDeps } = {},
): Promise<ProviderContext> {
  const deps = opts.deps ?? {};
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const isInsideWorkspaceFn = deps.isInsideWorkspace ?? isInsideWorkspace;

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
    return { ok: false, reason: "active project is not inside the workspace" };
  }
  const adapter = getAdapterFn(providerId);
  if (adapter === undefined) {
    return { ok: false, reason: `unknown provider: ${providerId}` };
  }
  const missing = requires(adapter);
  if (missing !== undefined) return { ok: false, reason: missing };

  if (opts.authenticated === true) {
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
  }

  return { ok: true, adapter, projectDir };
}
