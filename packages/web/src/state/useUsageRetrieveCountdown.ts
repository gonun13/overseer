import { useEffect, useState } from "react";

/** Matches the server's hard `/usage` ceiling (usage-refresh.ts). */
export const USAGE_RETRIEVE_TIMEOUT_MS = 30_000;

/**
 * Seconds left while usage is `pending`. When the server misses the deadline the
 * widget still reads "retrieving…" forever — this gives the operator a clock
 * and a local fallback to "not available".
 */
export function useUsageRetrieveCountdown(pending: boolean): {
  secondsLeft: number | null;
  timedOut: boolean;
} {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!pending) {
      setSecondsLeft(null);
      return;
    }
    const deadline = Date.now() + USAGE_RETRIEVE_TIMEOUT_MS;
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pending]);

  return {
    secondsLeft,
    timedOut: pending && secondsLeft === 0,
  };
}
