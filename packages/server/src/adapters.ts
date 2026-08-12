import type { AgentAdapter } from "@overseer/protocol";
import { claudeCodeAdapter } from "@overseer/adapter-claude-code";

/**
 * The adapter registry. Adapters are imported statically — there is no
 * fixture/mock adapter. A fresh instance only ever sees real adapters, so
 * discovery, furniture (prompt unlock), and signals match production in
 * development as well as in the runtime image.
 */
const registry = new Map<string, AgentAdapter>();

const register = (adapter: AgentAdapter) => registry.set(adapter.id, adapter);

register(claudeCodeAdapter);

export function getAdapter(id: string): AgentAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): AgentAdapter[] {
  return [...registry.values()];
}
