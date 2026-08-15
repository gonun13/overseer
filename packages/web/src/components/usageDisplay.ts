import type { ProviderInfo } from "../domain";
import type { Activity } from "../status";

/** Resolve usage presentation for a signed-in attached provider. */
export function providerUsageDisplay(provider: ProviderInfo): {
  state: "ready" | "pending" | "unavailable" | undefined;
  windows: ProviderInfo["usage"];
} {
  const attached = provider.name !== "";
  if (!attached || !provider.authenticated) {
    return { state: undefined, windows: [] };
  }

  const state =
    provider.usageState ??
    (provider.usage.length > 0 ? "ready" : "pending");

  const windows =
    state === "ready" && provider.usage.length > 0 ? provider.usage : [];

  return { state, windows };
}

/** Widget/settings copy while a refresh is in flight. */
export function usageRetrieveLabel(secondsLeft: number | null): string {
  if (secondsLeft === null) return "retrieving usage...";
  return `retrieving usage... ${secondsLeft}s`;
}

/**
 * Provider light: green when signed in, red when the runtime is down, amber
 * when it answered but is not signed in.
 */
export function providerAuthActivity(provider: {
  authenticated: boolean;
  reachable?: boolean;
}): Activity {
  if (provider.authenticated) return "done";
  if (provider.reachable === false) return "attention";
  return "waiting";
}

/** Short auth row under the provider name. */
export function providerAuthLabel(provider: {
  authenticated: boolean;
  reachable?: boolean;
  detail?: string;
}): string {
  if (provider.authenticated) return "signed in";
  if (provider.reachable === false) {
    return provider.detail?.trim() || "unreachable";
  }
  return "not signed in";
}
