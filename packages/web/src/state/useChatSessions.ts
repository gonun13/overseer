import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionMeta } from "@overseer/protocol";
import type { Project, Session } from "../domain";
import {
  BLANK_SESSION_SETTINGS,
  type SessionOptionKey,
  type SessionSettings,
} from "../session";
import {
  appendUserTurn,
  applySessionEvent,
  metaToSession,
  turnWireToTurn,
} from "./session-events";

/** One conversation: the metadata every session list renders, the transcript
 * its own window renders, and what it is armed with. */
export interface Chat {
  session: Session;
  turns: Turn[];
  settings: SessionSettings;
}

type Turn = import("../domain").Turn;

/**
 * Server-backed chat sessions — list, create, open, send over `/ws`.
 */
export function useChatSessions(
  send: (message: ClientMessage) => void,
  subscribeSession: (listener: (message: ServerMessage) => void) => () => void,
  onSessionStarted?: (session: Session) => void,
) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const onStartedRef = useRef(onSessionStarted);
  onStartedRef.current = onSessionStarted;
  const pendingCreate = useRef(false);
  const pendingSend = useRef<{ text: string } | undefined>(undefined);
  const pendingSendSession = useRef<string | undefined>(undefined);

  const resetSessionActivity = useCallback((sessionId: string) => {
    setChats((current) =>
      current.map((chat) =>
        chat.session.id === sessionId && chat.session.activity === "working"
          ? {
              ...chat,
              session: { ...chat.session, activity: "attention" },
            }
          : chat,
      ),
    );
  }, []);

  const sessions = useMemo(() => chats.map((chat) => chat.session), [chats]);

  const upsertMeta = useCallback((meta: SessionMeta) => {
    setChats((current) => {
      const existing = current.find((c) => c.session.id === meta.id);
      const activity = existing?.session.activity ?? "idle";
      const session = metaToSession(meta, activity);
      if (existing) {
        return current.map((chat) =>
          chat.session.id === meta.id
            ? { ...chat, session: { ...session, activity: chat.session.activity } }
            : chat,
        );
      }
      const chat: Chat = {
        session,
        turns: [],
        settings: BLANK_SESSION_SETTINGS,
      };
      let nextChat = chat;
      if (pendingCreate.current) {
        pendingCreate.current = false;
        setActiveId(meta.id);
        queueMicrotask(() => onStartedRef.current?.(session));
        const queued = pendingSend.current;
        pendingSend.current = undefined;
        if (queued !== undefined) {
          pendingSendSession.current = meta.id;
          send({ type: "session.send", sessionId: meta.id, text: queued.text });
          nextChat = { ...appendUserTurn(chat, queued.text), settings: chat.settings };
        }
      }
      return [...current, nextChat];
    });
  }, [send]);

  useEffect(() => {
    return subscribeSession((message) => {
      if (message.type === "session.list") {
        setChats((current) => {
          const byId = new Map(current.map((c) => [c.session.id, c]));
          for (const meta of message.sessions) {
            const existing = byId.get(meta.id);
            const session = metaToSession(
              meta,
              existing?.session.activity ?? "idle",
            );
            if (existing) {
              byId.set(meta.id, {
                ...existing,
                session: { ...session, activity: existing.session.activity },
              });
            } else {
              byId.set(meta.id, {
                session,
                turns: [],
                settings: BLANK_SESSION_SETTINGS,
              });
            }
          }
          const ids = new Set(message.sessions.map((s) => s.id));
          return [...byId.values()].filter((c) => ids.has(c.session.id));
        });
        return;
      }
      if (message.type === "session.meta") {
        upsertMeta(message.session);
        return;
      }
      if (message.type === "session.history") {
        setChats((current) =>
          current.map((chat) =>
            chat.session.id === message.sessionId
              ? chat.turns.length > 0
                ? chat
                : {
                    ...chat,
                    turns: message.turns.map(turnWireToTurn),
                  }
              : chat,
          ),
        );
        return;
      }
      if (message.type === "session.event") {
        if (
          message.event.type === "turn.end" &&
          message.event.sessionId === pendingSendSession.current
        ) {
          pendingSendSession.current = undefined;
        }
        setChats((current) =>
          current.map((chat) =>
            chat.session.id === message.event.sessionId
              ? { ...chat, ...applySessionEvent(chat, message.event) }
              : chat,
          ),
        );
        return;
      }
      if (
        message.type === "error" &&
        message.about?.startsWith("session.") &&
        pendingSendSession.current !== undefined
      ) {
        resetSessionActivity(pendingSendSession.current);
        pendingSendSession.current = undefined;
      }
    });
  }, [subscribeSession, upsertMeta, resetSessionActivity]);

  const start = useCallback(
    (_project?: Project): Session => {
      pendingCreate.current = true;
      send({ type: "session.create" });
      // Placeholder until session.meta arrives — callers should prefer
      // onSessionStarted for opening the window.
      return {
        id: "pending",
        activity: "working",
        name: "starting…",
        projectId: _project?.id ?? "",
        branch: _project?.branch ?? "",
        model: "",
        cost: "",
        doing: "",
      };
    },
    [send],
  );

  const focus = useCallback((id: string) => {
    setActiveId(id);
    send({ type: "session.open", sessionId: id });
  }, [send]);

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

  const sendChat = useCallback(
    (id: string, input: string) => {
      if (id === "pending") {
        pendingSend.current = { text: input };
        return;
      }
      pendingSendSession.current = id;
      send({ type: "session.send", sessionId: id, text: input });
      setChats((current) =>
        current.map((chat) =>
          chat.session.id === id
            ? { ...appendUserTurn(chat, input), settings: chat.settings }
            : chat,
        ),
      );
    },
    [send],
  );

  const requestList = useCallback(() => {
    send({ type: "session.list" });
  }, [send]);

  const deleteSession = useCallback(
    (id: string) => {
      send({ type: "session.delete", sessionId: id });
      // Removed here rather than waiting for the next session.list broadcast
      // to prune it — the operator asked for it gone, not eventually gone.
      setChats((current) => current.filter((chat) => chat.session.id !== id));
      setActiveId((current) => (current === id ? undefined : current));
      if (pendingSendSession.current === id) {
        pendingSendSession.current = undefined;
      }
    },
    [send],
  );

  return {
    sessions,
    activeId,
    start,
    focus,
    setSessionSetting,
    chatFor,
    send: sendChat,
    requestList,
    deleteSession,
  };
}
