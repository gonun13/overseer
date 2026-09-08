import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ServerMessage,
  Subagent,
  SubagentDraft,
  SubagentScope,
} from "@overseer/protocol";

/**
 * The operator's own subagent files, for the capabilities window.
 *
 * The list is server-derived and re-broadcast after every write, so nothing
 * here patches a local copy: a save that renamed a file shows up as the
 * rename, not as what the form submitted.
 */
export interface SubagentsState {
  subagents: Subagent[];
  /** False until the first list lands — "none yet" and "not asked yet" are
   * different things to draw. */
  loaded: boolean;
  /** Whether this provider can manage subagents at all, in its own words.
   * A catalog stub refuses, and that refusal is the honest empty state. */
  unavailable: string | undefined;
  /** Last write or delete. The form scopes this to its own request. */
  status: "idle" | "working" | "done" | "error";
  /** Last refusal, in the server's words. */
  error: string | undefined;
  /** The scopes this provider actually has a folder for. Cursor resolves
   * subagents only under the workspace, so offering "every project" would put
   * a control on the form whose every use the adapter refuses. */
  scopes: SubagentScope[];
  refresh: () => void;
  write: (
    draft: SubagentDraft,
    previous?: { name: string; scope: SubagentScope },
  ) => void;
  remove: (name: string, scope: SubagentScope) => void;
}

export function useSubagents(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  providerId: string | undefined,
  projectPath: string | undefined,
  /**
   * Called after a write lands, so the session control row picks the new agent
   * up without waiting for a project switch. Injected rather than imported so
   * this hook and `useProviderOptions` stay independent of each other.
   */
  onChanged?: () => void,
): SubagentsState {
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState<string>();
  const [status, setStatus] = useState<SubagentsState["status"]>("idle");
  const [error, setError] = useState<string>();

  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    return subscribe((message) => {
      if (message.type === "subagent.list") {
        setSubagents(message.subagents);
        setLoaded(true);
        setUnavailable(undefined);
        return;
      }
      if (message.type === "subagent.written" || message.type === "subagent.deleted") {
        setStatus("done");
        setError(undefined);
        changed.current?.();
        return;
      }
      if (message.type !== "error") return;
      if (message.about === "subagent.list") {
        // A refused list is the window's empty state, not a failed save.
        setUnavailable(message.message);
        setSubagents([]);
        setLoaded(true);
        return;
      }
      if (message.about?.startsWith("subagent.") === true) {
        setStatus("error");
        setError(message.message);
      }
    });
  }, [subscribe]);

  // Ask once per (provider, project), the same shape `useProviderOptions`
  // uses. Retrying a benign refusal on a timer would only repeat it.
  const asked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (providerId === undefined || projectPath === undefined) return;
    const key = `${providerId} ${projectPath}`;
    if (asked.current === key) return;
    asked.current = key;
    // The list belongs to the previous project until the reply lands.
    setSubagents([]);
    setLoaded(false);
    setUnavailable(undefined);
    send({ type: "subagent.list" });
  }, [providerId, projectPath, send]);

  const refresh = useCallback(() => {
    send({ type: "subagent.list" });
  }, [send]);

  const write = useCallback(
    (draft: SubagentDraft, previous?: { name: string; scope: SubagentScope }) => {
      setStatus("working");
      setError(undefined);
      send({
        type: "subagent.write",
        name: draft.name,
        description: draft.description,
        prompt: draft.prompt,
        model: draft.model,
        tools: draft.tools,
        scope: draft.scope,
        ...(previous !== undefined
          ? { previousName: previous.name, previousScope: previous.scope }
          : {}),
      });
    },
    [send],
  );

  const remove = useCallback(
    (name: string, scope: SubagentScope) => {
      setStatus("working");
      setError(undefined);
      send({ type: "subagent.delete", name, scope });
    },
    [send],
  );

  return {
    subagents,
    loaded,
    unavailable,
    status,
    error,
    scopes: scopesFor(providerId),
    refresh,
    write,
    remove,
  };
}

/**
 * Where a provider keeps subagents.
 *
 * Read off the provider id rather than a capability flag: `AdapterCapabilities`
 * answers whether subagents can be managed at all, and splitting that into a
 * per-scope flag would be a wire change for one provider's folder layout. The
 * adapter refuses a scope it has no folder for regardless — this only keeps the
 * form from offering the operator a choice that cannot land.
 */
function scopesFor(providerId: string | undefined): SubagentScope[] {
  // Verified against the CLI's own `computeAgentsDirs()`: cursor resolves
  // `<workspace>/.cursor/agents` and nothing under the operator's home.
  return providerId === "cursor" ? ["project"] : ["project", "user"];
}
