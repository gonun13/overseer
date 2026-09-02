import { useCallback, useEffect, useState } from "react";
import type {
  AdapterUsageWindow,
  ClientMessage,
  ServerMessage,
} from "@overseer/protocol";

export interface UsageCheckState {
  checking: boolean;
  /** Gauges read out of the last report. Empty until one has been read. */
  windows: AdapterUsageWindow[];
  /** Cycle spend in the provider's own words, when the report named one. */
  spend: string | undefined;
  /** True once a check has come back. Distinguishes "not asked yet" from
   * "asked, and its report yielded no gauges" — which look the same on the
   * instrument otherwise. */
  checked: boolean;
  error: string | undefined;
  check: () => void;
}

const NO_WINDOWS: AdapterUsageWindow[] = [];

/**
 * `provider.checkUsage` — the on-demand counterpart to the widget's
 * automatic gauges (`usage-refresh.ts` server-side). Never asked on a timer:
 * an adapter that offers this (see `AdapterCapabilities.usageCheck`) has no
 * free deterministic report, only a real CLI turn, so the operator has to
 * press the button.
 *
 * A failed re-check keeps the gauges the last good one produced — the same
 * call `usage-refresh.ts` makes for the automatic path, and for the same
 * reason: a miss is not evidence the last reading was wrong.
 */
export function useUsageCheck(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
): UsageCheckState {
  const [checking, setChecking] = useState(false);
  const [windows, setWindows] = useState<AdapterUsageWindow[]>(NO_WINDOWS);
  const [spend, setSpend] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    return subscribe((message) => {
      if (message.type === "provider.usageCheck") {
        setChecking(false);
        setError(undefined);
        setChecked(true);
        setWindows(message.windows);
        setSpend(message.spend);
        return;
      }
      if (
        message.type === "error" &&
        message.about === "provider.checkUsage"
      ) {
        setChecking(false);
        setError(message.message);
      }
    });
  }, [subscribe]);

  const check = useCallback(() => {
    setChecking(true);
    setError(undefined);
    send({ type: "provider.checkUsage" });
  }, [send]);

  return { checking, windows, spend, checked, error, check };
}
