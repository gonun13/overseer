import { useCallback, useEffect, useState } from "react";
import type {
  ClientMessage,
  LoopProviderInfo,
  ProviderOption,
  ServerMessage,
} from "@overseer/protocol";

/**
 * The loop's own provider/model configuration — independent of the app's
 * single attached provider (`useProviderOptions`). Hoisted once (App.tsx,
 * mirroring `useProviderOptions`'s own placement) rather than per-window: the
 * server broadcasts `loop.config` to every subscriber, so one ask at mount
 * keeps the providers window's loop tab and the model setup window in sync
 * with each other without either re-asking on its own.
 */
export interface LoopConfigState {
  current: string;
  providers: LoopProviderInfo[];
  steps: string[];
}

export interface LoopModelsEntry {
  models: ProviderOption[];
  defaultModel?: string;
}

const EMPTY: LoopConfigState = { current: "", providers: [], steps: [] };

export function useLoopConfig(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  /** `send` silently drops a frame sent before the socket is open, and has
   * no queue — so the ask-once-at-mount effect below has to wait on this
   * rather than firing unconditionally at mount, which raced the socket
   * handshake and lost the very first request every time. */
  connected: boolean,
) {
  const [config, setConfig] = useState<LoopConfigState>(EMPTY);
  const [error, setError] = useState<string>();
  // Keyed by provider id — `loop/bin/models list-models <id>` asks that
  // provider's own CLI directly, independent of which one (if any) the app
  // has attached, so a loop provider that differs from the attached one
  // still gets a real model list rather than nothing.
  const [modelsByProvider, setModelsByProvider] = useState<
    Record<string, LoopModelsEntry>
  >({});

  useEffect(() => {
    return subscribe((message) => {
      if (message.type === "loop.config") {
        setConfig({
          current: message.current,
          providers: message.providers,
          steps: message.steps,
        });
        setError(undefined);
        return;
      }
      if (message.type === "loop.models") {
        setModelsByProvider((current) => ({
          ...current,
          [message.providerId]: {
            models: message.models,
            ...(message.defaultModel !== undefined
              ? { defaultModel: message.defaultModel }
              : {}),
          },
        }));
        return;
      }
      if (message.type === "error" && message.about?.startsWith("loop.")) {
        setError(message.message);
      }
    });
  }, [subscribe]);

  // Once per connect — cheap (loop/bin/models --json is bash+jq, no CLI
  // subprocess), but still explicit rather than pushed at mount: `send` has
  // no queue, so this waits for `connected` the same way discovery.run does,
  // and re-asks on a reconnect the same way discovery.run does too.
  useEffect(() => {
    if (!connected) return;
    send({ type: "loop.config.read" });
  }, [connected, send]);

  const setProvider = useCallback(
    (id: string) => {
      send({ type: "loop.provider.set", id });
    },
    [send],
  );

  const setModel = useCallback(
    (providerId: string, slot: string, model: string) => {
      send({ type: "loop.model.set", providerId, slot, model });
    },
    [send],
  );

  /** Ask for one provider's model list. Costs a CLI round-trip on the
   * server (a control request for claude-code, a plain command for cursor),
   * so this is explicit and on-demand — called by the model setup window
   * when it opens for a given provider, not fetched for every provider up
   * front. */
  const readModels = useCallback(
    (providerId: string) => {
      send({ type: "loop.models.read", providerId });
    },
    [send],
  );

  return { config, error, setProvider, setModel, modelsByProvider, readModels };
}
