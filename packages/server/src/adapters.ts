import type { AgentAdapter } from "@overseer/protocol";
import { claudeCodeAdapter } from "@overseer/adapter-claude-code";
import { cursorAdapter } from "@overseer/adapter-cursor";
import { readProviderManifests } from "./provider-registry.js";
import { stubAdapter } from "./stub-adapters.js";

/**
 * The adapter registry. Which providers exist comes from the shared
 * `providers/` registry (provider-registry.ts); which of them this server can
 * actually drive comes from `implemented` below, whose adapters are imported
 * statically — there is no fixture/mock adapter. A fresh instance only ever
 * sees real adapters, so discovery, furniture (prompt unlock), and signals
 * match production in development as well as in the runtime image.
 *
 * A manifest's `app` role decides the shape:
 *
 * - `adapter` — register the real implementation.
 * - `stub`    — appears in the provider catalog so the operator can see what is
 *               installed, but is usable no further than attach.
 * - `none`    — not listed at all.
 */
const registry = new Map<string, AgentAdapter>();
/** Ids registered as catalog stubs — listed, but driven by nothing. */
const catalogOnly = new Set<string>();

const register = (adapter: AgentAdapter) => registry.set(adapter.id, adapter);

/** Adapters this build has real wiring for, keyed by the id they claim. */
const implemented = new Map<string, AgentAdapter>([
  [claudeCodeAdapter.id, claudeCodeAdapter],
  [cursorAdapter.id, cursorAdapter],
]);

for (const manifest of readProviderManifests()) {
  if (manifest.app === "none") continue;

  const real = implemented.get(manifest.id);
  if (manifest.app === "adapter" && real !== undefined) {
    register(real);
    continue;
  }
  if (manifest.app === "adapter") {
    // The registry claims wiring this build does not carry. A stub is the
    // honest answer — it reports "not implemented", which is exactly true —
    // but the mismatch is a bug in one of the two, so say so.
    console.error(
      `adapters: providers/${manifest.id} is app:"adapter" but no adapter is compiled in — listing it as a stub`,
    );
  }
  catalogOnly.add(manifest.id);
  register(stubAdapter(manifest.id));
}

// An adapter with no manifest would silently vanish from the catalog and take
// the app with it. Register it anyway and name the missing entry.
for (const [id, adapter] of implemented) {
  if (registry.has(id)) continue;
  console.error(`adapters: ${id} has no entry in the provider registry — registering it regardless`);
  register(adapter);
}

export function getAdapter(id: string): AgentAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): AgentAdapter[] {
  return [...registry.values()];
}

/**
 * True when the id is in the catalog but has no wiring behind it — the CLI is
 * installed, sessions/auth/console are not. Discovery passes this to the UI so
 * a stub reads as "not available yet" rather than "not signed in": both are
 * unauthenticated, only one of them is the operator's to fix.
 */
export function isCatalogOnly(id: string): boolean {
  return catalogOnly.has(id);
}
