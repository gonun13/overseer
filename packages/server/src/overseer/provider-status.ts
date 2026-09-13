import type { DiscoveredProvider } from "@overseer/protocol";
import { readSnapshot } from "../memory/internal.js";
import type { OverseerSpace } from "./space.js";

/**
 * The two provider rows the status window carries, computed in exactly one
 * place.
 *
 * These were the rows that stayed stale after a login, and the reason was not
 * only that they were append-only — it was that the prose describing the hold
 * and the gate enforcing it were two separate pieces of code. Discovery
 * rendered `held · connect an authenticated provider` into a frozen string
 * once, at boot; the client kept its own live copy of the same predicate and
 * quietly unlocked the composer. Only one of the two could ever be wrong, and
 * it was always the one the operator was reading.
 *
 * So the predicate lives here now, the rows are `state` rows, and every path
 * that changes provider auth calls `reportProviderStatus` — which means a
 * login rewrites both rows in place instead of stacking a contradiction under
 * them.
 */

/** Whether the prompt may be released: an attached provider, signed in. The
 * one copy of this rule. */
export function promptReady(
  providers: DiscoveredProvider[],
  attachedProviderId: string | undefined,
): boolean {
  if (attachedProviderId === undefined) return false;
  return providers.some(
    (provider) => provider.id === attachedProviderId && provider.status.authenticated,
  );
}

/** The auth row's words, matching the `no-provider` / `no-auth` signals so the
 * window and the signal list never describe the same world differently. */
export function authDetail(
  providers: DiscoveredProvider[],
  attachedProviderId: string | undefined,
): string {
  if (providers.length === 0) return "no providers registered";
  const attached = providers.find((p) => p.id === attachedProviderId);
  if (attached === undefined) {
    return `${providers.length} registered · none attached`;
  }
  return attached.status.authenticated
    ? `attached ${attached.id}`
    : `attached ${attached.id} · not authenticated`;
}

/**
 * Re-report both provider rows from the current world.
 *
 * Idempotent by construction — `space.status` drops a `state` row that has not
 * changed — so callers may fire this whenever they touch provider auth without
 * worrying about stuttering the window.
 */
export function reportProviderStatus(
  space: OverseerSpace,
  providers: DiscoveredProvider[],
  attachedProviderId: string | undefined,
  options: { action?: string; actor?: "overseer" | "operator" } = {},
): void {
  const ready = promptReady(providers, attachedProviderId);
  const attached = providers.find((p) => p.id === attachedProviderId);

  space.status({
    service: "providers",
    key: "auth",
    mode: "state",
    label: "checking provider auth",
    // Registered alone is not success — the operator still has to connect and
    // sign in, and `blocked` is what makes the row agree with the signal.
    outcome: attached?.status.authenticated === true ? "ok" : "blocked",
    detail: authDetail(providers, attachedProviderId),
    ...(options.action !== undefined ? { action: options.action } : {}),
    ...(options.actor !== undefined ? { actor: options.actor } : {}),
  });

  space.status({
    service: "providers",
    key: "prompt",
    mode: "state",
    label: "releasing the prompt",
    outcome: ready ? "ok" : "blocked",
    detail: ready ? "prompt ready" : "held · connect an authenticated provider",
  });
}

/**
 * Re-report the provider rows from whatever the world snapshot now says.
 *
 * This is the hook every auth-change path hangs on. The snapshot is already
 * the one place `setProviderAuthenticated` and `setProviderStatus` write to,
 * so reading it back here means a login, a sign-out, an expiry noticed by the
 * console, and a usage refresh all correct the same two rows without each
 * knowing how the rows are worded.
 *
 * Silent before the first snapshot exists — discovery has not run, so there
 * are no rows to correct yet.
 */
export async function refreshProviderRows(
  space: OverseerSpace,
  options: { action?: string; actor?: "overseer" | "operator" } = {},
): Promise<void> {
  const snapshot = await readSnapshot();
  if (!snapshot) return;
  reportProviderStatus(
    space,
    snapshot.providers,
    snapshot.attached_provider,
    options,
  );
}
