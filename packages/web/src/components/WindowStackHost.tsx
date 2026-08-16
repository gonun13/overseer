import { useState } from "react";
import type {
  ClientMessage,
  OverseerTheme,
  ServerMessage,
} from "@overseer/protocol";
import type { Approval, Project, ProviderInfo, Session } from "../domain";
import type { Chat } from "../state/useChatSessions";
import type { DiscoveryController } from "../state/useDiscovery";
import type { OpenWindow, WindowKind } from "../windows";
import { Window } from "./Window";
import { ApprovalsWindow } from "./windows/ApprovalsWindow";
import { CapabilitiesWindow } from "./windows/CapabilitiesWindow";
import { CapabilityWindow } from "./windows/CapabilityWindow";
import { ChatWindow } from "./windows/ChatWindow";
import { ConsoleWindow } from "./windows/ConsoleWindow";
import { ContextWindow } from "./windows/ContextWindow";
import { DiffWindow } from "./windows/DiffWindow";
import { HelpWindow } from "./windows/HelpWindow";
import { OverseerWindow } from "./windows/OverseerWindow";
import { ProvidersWindow } from "./windows/ProvidersWindow";
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
  send,
  subscribeConsole,
}: WindowStackHostProps) {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  return windows.map((windowState) => {
    // A chat window's payload is the session id it belongs to; everything it
    // renders is read back from the conversation store, never held in the frame.
    const chat =
      windowState.kind === "chat"
        ? chatFor(String(windowState.payload ?? ""))
        : undefined;

    return (
      <Window
        key={windowState.id}
        title={windowState.title}
        x={windowState.x}
        y={windowState.y}
        z={windowState.z}
        width={windowState.w}
        height={windowState.h}
        variant={windowState.kind === "console" ? "console" : undefined}
        onClose={() => closeWindow(windowState.id)}
        onRaise={() => raiseWindow(windowState.id)}
        onMove={(x, y) => moveWindow(windowState.id, x, y)}
        onResize={
          windowState.kind === "console"
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
            onOpenSession={(id) => {
              const chat = chatFor(id);
              if (chat) openChat(chat.session);
            }}
            onNewSession={startChat}
          />
        )}
        {chat && (
          <ChatWindow
            turns={chat.turns}
            busy={chat.session.activity === "working"}
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
