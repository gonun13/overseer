import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ServerMessage,
  Skill,
  SkillScope,
  SkillSource,
} from "@overseer/protocol";

/**
 * The operator's own skill folders, for the capabilities window.
 *
 * Shaped after `useSubagents` deliberately — the list is server-derived and
 * re-broadcast after every write, so nothing here patches a local copy: an
 * import that landed under a different name than the form guessed shows up as
 * the name on disk.
 */
export interface SkillsState {
  skills: Skill[];
  /** False until the first list lands — "none yet" and "not asked yet" are
   * different things to draw. */
  loaded: boolean;
  /** Whether this provider can manage skills at all, in its own words. */
  unavailable: string | undefined;
  /** Last import or delete. The form scopes this to its own request. */
  status: "idle" | "working" | "done" | "error";
  /** Last refusal, in the server's words. */
  error: string | undefined;
  /** The scopes this provider actually has a folder for. */
  scopes: SkillScope[];
  refresh: () => void;
  importSkill: (input: {
    source: SkillSource;
    scope: SkillScope;
    name?: string;
  }) => void;
  remove: (name: string, scope: SkillScope) => void;
}

export function useSkills(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  providerId: string | undefined,
  projectPath: string | undefined,
): SkillsState {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState<string>();
  const [status, setStatus] = useState<SkillsState["status"]>("idle");
  const [error, setError] = useState<string>();

  useEffect(() => {
    return subscribe((message) => {
      if (message.type === "skill.list") {
        setSkills(message.skills);
        setLoaded(true);
        setUnavailable(undefined);
        return;
      }
      if (message.type === "skill.imported" || message.type === "skill.deleted") {
        setStatus("done");
        setError(undefined);
        return;
      }
      if (message.type !== "error") return;
      if (message.about === "skill.list") {
        // A refused list is the window's empty state, not a failed import.
        setUnavailable(message.message);
        setSkills([]);
        setLoaded(true);
        return;
      }
      if (message.about?.startsWith("skill.") === true) {
        setStatus("error");
        setError(message.message);
      }
    });
  }, [subscribe]);

  // Ask once per (provider, project), the same shape `useSubagents` uses.
  const asked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (providerId === undefined || projectPath === undefined) return;
    const key = `${providerId} ${projectPath}`;
    if (asked.current === key) return;
    asked.current = key;
    // The list belongs to the previous project until the reply lands.
    setSkills([]);
    setLoaded(false);
    setUnavailable(undefined);
    send({ type: "skill.list" });
  }, [providerId, projectPath, send]);

  const refresh = useCallback(() => {
    send({ type: "skill.list" });
  }, [send]);

  const importSkill = useCallback(
    (input: { source: SkillSource; scope: SkillScope; name?: string }) => {
      setStatus("working");
      setError(undefined);
      send({
        type: "skill.import",
        source: input.source,
        scope: input.scope,
        ...(input.name !== undefined && input.name !== ""
          ? { name: input.name }
          : {}),
      });
    },
    [send],
  );

  const remove = useCallback(
    (name: string, scope: SkillScope) => {
      setStatus("working");
      setError(undefined);
      send({ type: "skill.delete", name, scope });
    },
    [send],
  );

  return {
    skills,
    loaded,
    unavailable,
    status,
    error,
    scopes: scopesFor(providerId),
    refresh,
    importSkill,
    remove,
  };
}

/**
 * Where a provider keeps skills.
 *
 * Deliberately *not* shared with `scopesFor` in `useSubagents`, which returns
 * project-only for cursor. The two answer different questions and the answers
 * genuinely differ: cursor's CLI resolves agents only under the workspace, but
 * resolves skills under both the workspace and the operator's home (verified in
 * the shipped bundle's config-dir table, `agent 2026.09.10-fd3934a`). Sharing
 * one function would have made that divergence impossible to express.
 *
 * As there, this is read off the provider id rather than a capability flag: the
 * adapter refuses a scope it has no folder for regardless, and this only keeps
 * the form from offering a choice that cannot land.
 */
function scopesFor(providerId: string | undefined): SkillScope[] {
  return providerId === undefined ? [] : ["project", "user"];
}
