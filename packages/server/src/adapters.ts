import type { AgentAdapter } from "@overseer/protocol";
import { claudeCodeAdapter } from "@overseer/adapter-claude-code";

/**
 * The adapter registry. Real adapters are imported statically; the mock adapter
 * is not, and must not be.
 *
 * The mock reports `authenticated: true` unconditionally — correctly, since it
 * replays fixtures and has no account to sign into. In production that turns
 * into a lie the rest of the system believes: discovery finds a "connected"
 * adapter, the prompt mounts, and the real "no adapter attached" signal never
 * fires. So it is loaded behind a dynamic import that only runs outside
 * production, and the production image does not ship the package at all (see
 * the runtime stage in the Dockerfile). The guard and the missing package are
 * deliberately redundant: either one alone would keep it out.
 *
 * Top-level await, not lazy init, because `listAdapters`/`getAdapter` are
 * consumed synchronously (the /api/adapters route, discovery's adapter step).
 * ESM blocks importers until this settles, so both stay synchronous.
 */
const registry = new Map<string, AgentAdapter>();

const register = (adapter: AgentAdapter) => registry.set(adapter.id, adapter);

register(claudeCodeAdapter);

if (process.env.NODE_ENV !== "production") {
  const { mockAdapter } = await import("@overseer/adapter-mock");
  register(mockAdapter);
}

export function getAdapter(id: string): AgentAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): AgentAdapter[] {
  return [...registry.values()];
}
