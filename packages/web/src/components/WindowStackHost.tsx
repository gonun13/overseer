import { useState } from "react";
import type {
  ClientMessage,
  OverseerTheme,
  ServerMessage,
} from "@overseer/protocol";
import type { Approval, Project, ProviderInfo, Session } from "../domain";
import type {
  SessionOption,
  SessionOptionKey,
  SessionSettings,
} from "../session";
import type { Chat } from "../state/useChatSessions";
import type { DiscoveryController } from "../state/useDiscovery";
import type { OpenWindow, WindowKind } from "../windows";
import { Window } from "./Window";
import { ApprovalsWindow } from "./windows/ApprovalsWindow";
import { CapabilitiesWindow } from "./windows/CapabilitiesWindow";
import { CapabilityWindow } from "./windows/CapabilityWindow";
import { ConsoleWindow } from "./windows/ConsoleWindow";
import { ContextWindow } from "./windows/ContextWindow";
import { DiffWindow } from "./windows/DiffWindow";
import { HelpWindow } from "./windows/HelpWindow";
import { OverseerWindow } from "./windows/OverseerWindow";
import { ProvidersWindow } from "./windows/ProvidersWindow";
import { SessionWindow } from "./windows/SessionWindow";
import { SessionsWindow } from "./windows/SessionsWindow";

type OpenWindowAction = (
  kind: WindowKind,
  payload?: unknown,
  title?: string,
) => void;

interface WindowStackHostProps {
  windows: OpenWindow[];
  wizard: DiscoveryController;
  projects: Project[];
  activeProject?: Project;
  provider: ProviderInfo;
  theme: OverseerTheme;
  sessions: Session[];
  openWindow: OpenWindowAction;
  closeWindow: (id: string) => void;
  raiseWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  openChat: (session: Session) => void;
  startChat: () => void;
  chatFor: (id: string) => Chat | undefined;
  sendChat: (id: string, input: string) => void;
  onDeleteSession: (id: string) => void;
  sessionOptions: SessionOption[];
  /** Provider defaults plus the operator's picks — the fallback for a row a
   * session has not reported on yet. */
  armedSession: SessionSettings;
  openSessionControls: Partial<Record<string, SessionOptionKey>>;
  onToggleSessionControl: (sessionId: string, key: SessionOptionKey) => void;
  onSelectSessionControl: (
    sessionId: string,
    key: SessionOptionKey,
    value: string,
  ) => void;
  onOpenSessionContext: (sessionId: string) => void;
  send: (message: ClientMessage) => void;
  subscribeConsole: (listener: (message: ServerMessage) => void) => () => void;
}

/** Renders window frames and dispatches each window kind to its content. */
export function WindowStackHost({
  windows,
  wizard,
  projects,
  activeProject,
  provider,
  theme,
  sessions,
  openWindow,
  closeWindow,
  raiseWindow,
  moveWindow,
  resizeWindow,
  openChat,
  startChat,
  chatFor,
  sendChat,
  onDeleteSession,
  sessionOptions,
  armedSession,
  openSessionControls,
  onToggleSessionControl,
  onSelectSessionControl,
  onOpenSessionContext,
  send,
  subscribeConsole,
}: WindowStackHostProps) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const models = sessionOptions.find((o) => o.key === "model")?.values ?? [];

  return windows.map((windowState) => {
    // A session window's payload is the session id it belongs to; everything it
    // renders is read back from the conversation store, never held in the frame.
    const chat =
      windowState.kind === "chat"
        ? chatFor(String(windowState.payload ?? ""))
        : undefined;

    return (
      <Window
        key={windowState.id}
        title={windowState.title}
        detail={windowState.detail}
        x={windowState.x}
        y={windowState.y}
        z={windowState.z}
        width={windowState.w}
        height={windowState.h}
        variant={
          windowState.kind === "console"
            ? "console"
            : windowState.kind === "chat"
              ? "session"
              : undefined
        }
        onClose={() => closeWindow(windowState.id)}
        onRaise={() => raiseWindow(windowState.id)}
        onMove={(x, y) => moveWindow(windowState.id, x, y)}
        onResize={
          windowState.h !== undefined
            ? (w, h) => resizeWindow(windowState.id, w, h)
            : undefined
        }
      >
        {windowState.kind === "overseer" && (
          <OverseerWindow steps={wizard.steps} />
        )}
        {windowState.kind === "providers" && (
          <ProvidersWindow
            providers={wizard.providers}
            attachedId={wizard.attachedProviderId}
            auth={wizard.auth}
            onConnect={(id) => {
              // Stays open: connecting an unauthenticated provider hands this
              // window straight to its login step, and closing it would put the
              // operator back at square one for the step they just unlocked.
              wizard.connectProvider(id);
            }}
            onStartLogin={wizard.startLogin}
            onSubmitCode={wizard.submitAuthCode}
            onCancelLogin={wizard.cancelLogin}
            onSignOut={wizard.signOut}
          />
        )}
        {windowState.kind === "sessions" && (
          <SessionsWindow
            sessions={sessions}
            projects={projects}
            provider={provider}
            models={models}
            onOpenSession={(id) => {
              const chat = chatFor(id);
              if (chat) openChat(chat.session);
            }}
            onNewSession={startChat}
            onDeleteSession={onDeleteSession}
          />
        )}
        {chat && (
          <SessionWindow
            turns={chat.turns}
            busy={chat.session.activity === "working"}
            // A row this session has said nothing about falls back to what is
            // armed, which is seeded from the provider's own defaults — so the
            // head reads what the next turn will actually run on, never "—".
            settings={{
              model: chat.settings.model || armedSession.model,
              mode: chat.settings.mode || armedSession.mode,
              agent: chat.settings.agent || armedSession.agent,
            }}
            options={sessionOptions}
            openSessionControl={openSessionControls[chat.session.id] ?? null}
            contextCount={0}
            onToggleSessionControl={(key) =>
              onToggleSessionControl(chat.session.id, key)
            }
            onSelectSessionControl={(key, value) =>
              onSelectSessionControl(chat.session.id, key, value)
            }
            onOpenSessionContext={() => onOpenSessionContext(chat.session.id)}
            onSubmit={(input) => sendChat(chat.session.id, input)}
            onInspect={(turnId) => {
              const turn = chat.turns.find(
                (candidate) => candidate.id === turnId,
              );
              if (turn?.kind === "tool")
                openWindow("diff", turn.target, turn.tool);
            }}
          />
        )}
        {windowState.kind === "approvals" && (
          <ApprovalsWindow
            approvals={approvals}
            provider={provider}
            onResolve={(id) =>
              setApprovals((current) =>
                current.filter((approval) => approval.id !== id),
              )
            }
          />
        )}
        {windowState.kind === "capabilities" && (
          <CapabilitiesWindow
            capabilities={[]}
            provider={provider}
            onEdit={(name) => openWindow("capability", name, name)}
          />
        )}
        {windowState.kind === "capability" && (
          <CapabilityWindow name={String(windowState.payload ?? "")} />
        )}
        {windowState.kind === "context" && (
          <ContextWindow
            projectName={activeProject?.name}
            provider={provider}
          />
        )}
        {windowState.kind === "console" && (
          <ConsoleWindow
            provider={provider}
            theme={theme}
            send={send}
            subscribe={subscribeConsole}
            onProcessExit={() => closeWindow(windowState.id)}
          />
        )}
        {windowState.kind === "help" && <HelpWindow provider={provider} />}
        {windowState.kind === "diff" && (
          <DiffWindow target={String(windowState.payload ?? "")} />
        )}
      </Window>
    );
  });
}
