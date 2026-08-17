import { useCallback, useMemo, useState } from "react";
import type { Project, Session, Turn } from "../domain";
import {
  BLANK_SESSION_SETTINGS,
  type SessionOptionKey,
  type SessionSettings,
} from "../session";

/** One conversation: the metadata every session list renders, the transcript
 * its own window renders, and what it is armed with. */
export interface Chat {
  session: Session;
  turns: Turn[];
  /** Which model, permission mode and subagent the *next* turn of this
   * conversation runs as — the session window's controls write here. Per
   * session, not per app: arming one conversation must not arm the others. */
  settings: SessionSettings;
}

let seq = 0;

/**
 * Owns every chat conversation the operator has open — one transcript per
 * session, never a shared one. This is the half of the old single prompt that
 * talks to models; the prompt terminal keeps the other half (commands, and the
 * overseer itself) and no state crosses between them.
 *
 * Sessions are started by the operator and live here rather than coming down
 * from the server: this build has no session supervisor, and inventing a list
 * the machine never reported would be canned data (domain.ts).
 */
export function useChatSessions() {
  const [chats, setChats] = useState<Chat[]>([]);
  /** The one the sessions list reads out when collapsed — last started or
   * last summoned, which is the one the operator is working in. */
  const [activeId, setActiveId] = useState<string>();

  const sessions = useMemo(() => chats.map((chat) => chat.session), [chats]);

  /** Starts a conversation against a project and hands back the session, so the
   * caller can summon its window under the right name in the same beat. */
  const start = useCallback((project?: Project): Session => {
    const session: Session = {
      id: `session-${++seq}`,
      activity: "idle",
      name: `session ${seq}`,
      projectId: project?.id ?? "",
      // Empty is "not been told yet", never a stand-in: branch is unknown when
      // git could not be read, and model, cost and doing are the supervisor's
      // to report once one exists.
      branch: project?.branch ?? "",
      model: "",
      cost: "",
      doing: "",
    };
    setChats((current) => [
      ...current,
      { session, turns: [], settings: BLANK_SESSION_SETTINGS },
    ]);
    setActiveId(session.id);
    return session;
  }, []);

  const focus = useCallback((id: string) => setActiveId(id), []);

  /** Arms one option on one conversation. The model is also written back onto
   * the session so the row in a list and the controls can never disagree about
   * what this conversation is running as. */
  const setSessionSetting = useCallback(
    (id: string, key: SessionOptionKey, value: string) => {
      setChats((current) =>
        current.map((chat) =>
          chat.session.id === id
            ? {
                ...chat,
                session:
                  key === "model"
                    ? { ...chat.session, model: value }
                    : chat.session,
                settings: { ...chat.settings, [key]: value },
              }
            : chat,
        ),
      );
    },
    [],
  );

  const chatFor = useCallback(
    (id: string) => chats.find((chat) => chat.session.id === id),
    [chats],
  );

  const send = useCallback((id: string, input: string) => {
    setChats((current) =>
      current.map((chat) => {
        if (chat.session.id !== id) return chat;
        const turn: Turn = {
          id: `${id}-u${chat.turns.length}`,
          kind: "user",
          text: input,
        };
        return {
          ...chat,
          session: { ...chat.session, activity: "working" },
          turns: [...chat.turns, turn],
        };
      }),
    );
    // Placeholder for the real stream; replaced when the WS event pipe lands.
    setTimeout(() => {
      setChats((current) =>
        current.map((chat) =>
          chat.session.id === id
            ? { ...chat, session: { ...chat.session, activity: "idle" } }
            : chat,
        ),
      );
    }, 1200);
  }, []);

  return {
    sessions,
    activeId,
    start,
    focus,
    setSessionSetting,
    chatFor,
    send,
  };
}
