import type { AgentAdapter } from "@overseer/protocol";
import { claudeCodeAdapter } from "@overseer/adapter-claude-code";
import { stubAdapters } from "./stub-adapters.js";

/**
 * The adapter registry. Adapters are imported statically — there is no
 * fixture/mock adapter. A fresh instance only ever sees real adapters, so
 * discovery, furniture (prompt unlock), and signals match production in
 * development as well as in the runtime image.
 *
 * Stub adapters appear in the provider catalog so the operator can see what
 * is installed; only adapters with real login/console/session wiring are
 * usable beyond attach.
 */
const registry = new Map<string, AgentAdapter>();

const register = (adapter: AgentAdapter) => registry.set(adapter.id, adapter);

register(claudeCodeAdapter);
for (const adapter of stubAdapters) register(adapter);

export function getAdapter(id: string): AgentAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): AgentAdapter[] {
  return [...registry.values()];
}
