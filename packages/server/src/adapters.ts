import type { AgentAdapter } from "@overseer/protocol";
import { mockAdapter } from "@overseer/adapter-mock";
import { claudeCodeAdapter } from "@overseer/adapter-claude-code";

const registry = new Map<string, AgentAdapter>(
  [mockAdapter, claudeCodeAdapter].map((adapter) => [adapter.id, adapter]),
);

export function getAdapter(id: string): AgentAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): AgentAdapter[] {
  return [...registry.values()];
}
