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

/**
 * Seconds spent so far on a manual `provider.checkUsage`.
 *
 * Counts *up*, unlike the automatic path above: that one races a deadline the
 * server guarantees, this one is a real CLI turn whose honest answer to "how
 * long?" is "about a minute, and it is still going". A countdown here would
 * expire while the ask was still perfectly healthy.
 */
export function useUsageCheckElapsed(checking: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!checking) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [checking]);

  return elapsed;
}
