import type { AdapterCapabilities, AgentAdapter } from "@overseer/protocol";

const stubCapabilities: AdapterCapabilities = {
  login: false,
  usageCheck: false,
};

/**
 * Catalog-only adapter: CLI is in the image; sessions/auth/console are not
 * wired yet. Which ids get one is not decided here — it is whatever the shared
 * registry marks `app: "stub"` (provider-registry.ts), so a provider that
 * exists for the loop alone still shows up as installed.
 */
export function stubAdapter(id: string): AgentAdapter {
  return {
    id,
    capabilities: stubCapabilities,
    async getStatus() {
      return { authenticated: false, detail: "not implemented" };
    },
  };
}
