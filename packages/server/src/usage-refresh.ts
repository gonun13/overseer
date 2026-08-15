import type { AdapterStatus, ServerMessage } from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { readSnapshot, setProviderStatus } from "./memory/internal.js";

type Broadcast = (message: ServerMessage) => void;

/**
 * How often to re-ask `/usage` for a signed-in provider — ready or not.
 * Misses still clear "retrieving…" via the adapter's own wall-clock kill;
 * this interval is the cadence, not the hang guard.
 */
const RECHECK_MS = 5 * 60_000;

/**
 * Hard ceiling above the adapter's `/usage` timeout. If refreshUsage ever
 * fails to settle (regression), we still flip to unavailable and free the
 * in-flight slot so the widget cannot stick on "retrieving usage…".
 */
const HARD_TIMEOUT_MS = 30_000;

let broadcast: Broadcast | undefined;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
/** Bumped on cancel/sign-out so a late result cannot overwrite. */
const generation = new Map<string, number>();

export function startUsageRefresh(bcast: Broadcast): void {
  broadcast = bcast;
}

function clearTimer(providerId: string): void {
  const timer = timers.get(providerId);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(providerId);
  }
}

/** Drop a scheduled recheck and invalidate any in-flight ask (sign-out). */
export function cancelUsageRefresh(providerId: string): void {
  clearTimer(providerId);
  generation.set(providerId, (generation.get(providerId) ?? 0) + 1);
}

/**
 * Ask (or re-ask) subscription windows for one provider. `delayMs` lets the
 * caller defer a recheck without blocking the event that noticed the miss.
 */
export function scheduleUsageRefresh(
  providerId: string,
  delayMs = 0,
): void {
  clearTimer(providerId);
  if (delayMs <= 0) {
    void runRefresh(providerId);
    return;
  }
  const timer = setTimeout(() => {
    timers.delete(providerId);
    void runRefresh(providerId);
  }, delayMs);
  timers.set(providerId, timer);
}

/**
 * After discovery (or any world rebuild), refresh every signed-in provider.
 * Pending/unavailable ask immediately; ready readings keep their gauges and
 * join the 5-minute cadence.
 */
export function refreshPendingUsage(): void {
  void refreshPendingUsageLoop(0);
}

async function refreshPendingUsageLoop(attempt: number): Promise<void> {
  const snapshot = await readSnapshot();
  if (snapshot === undefined) {
    // Discovery writes the snapshot at the end of the pass, but this ask can
    // land in the same tick — retry briefly rather than leaving pending forever.
    if (attempt < 10) {
      await delay(100);
      return refreshPendingUsageLoop(attempt + 1);
    }
    return;
  }
  for (const provider of snapshot.providers) {
    if (!provider.status.authenticated) {
      cancelUsageRefresh(provider.id);
      continue;
    }
    if (provider.status.usageState === "ready") {
      scheduleUsageRefresh(provider.id, RECHECK_MS);
    } else {
      scheduleUsageRefresh(provider.id);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asUnavailable(prior: AdapterStatus | undefined): AdapterStatus {
  return {
    authenticated: true,
    ...(prior?.version !== undefined ? { version: prior.version } : {}),
    ...(prior?.detail !== undefined ? { detail: prior.detail } : {}),
    usageState: "unavailable",
  };
}

async function runRefresh(providerId: string): Promise<void> {
  if (inFlight.has(providerId)) return;
  const adapter = getAdapter(providerId);
  const snapshot = await readSnapshot();
  const prior = snapshot?.providers.find((p) => p.id === providerId)?.status;

  if (adapter?.refreshUsage === undefined) {
    // No usage probe — never leave the widget on "retrieving…".
    if (prior?.authenticated && prior.usageState === "pending") {
      const status = asUnavailable(prior);
      await setProviderStatus(providerId, status);
      broadcast?.({ type: "provider.status", id: providerId, status });
    }
    return;
  }

  const gen = (generation.get(providerId) ?? 0) + 1;
  generation.set(providerId, gen);

  inFlight.add(providerId);
  try {
    let status: AdapterStatus;
    try {
      status = await Promise.race([
        adapter.refreshUsage(),
        delay(HARD_TIMEOUT_MS).then(() => {
          // A recheck that times out should not blank gauges we already have.
          if (prior?.usageState === "ready" && (prior.usage?.length ?? 0) > 0) {
            return prior;
          }
          return asUnavailable(prior);
        }),
      ]);
    } catch (error) {
      console.error("overseer: usage refresh failed", error);
      status =
        prior?.usageState === "ready" && (prior.usage?.length ?? 0) > 0
          ? prior
          : asUnavailable(prior);
    }

    if (generation.get(providerId) !== gen) return;

    // refreshUsage only probes windows — keep version/detail from the last
    // known status so a miss does not blank the widget's other facts.
    status = {
      authenticated: status.authenticated,
      version: status.version ?? prior?.version,
      detail: status.detail ?? prior?.detail,
      usageState: status.usageState,
      ...(status.usage !== undefined && status.usage.length > 0
        ? { usage: status.usage }
        : {}),
    };

    if (!status.authenticated) {
      cancelUsageRefresh(providerId);
      await setProviderStatus(providerId, status);
      broadcast?.({ type: "provider.status", id: providerId, status });
      return;
    }

    await setProviderStatus(providerId, status);
    broadcast?.({ type: "provider.status", id: providerId, status });
    scheduleUsageRefresh(providerId, RECHECK_MS);
  } finally {
    inFlight.delete(providerId);
  }
}
