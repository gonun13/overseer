import { useState } from "react";
import type {
  ClientMessage,
  OverseerTheme,
  ServerMessage,
} from "@overseer/protocol";
import type { Approval, Project, ProviderInfo, Turn } from "../domain";
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
  openWindow: OpenWindowAction;
  closeWindow: (id: string) => void;
  raiseWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  openProjectSelector: () => void;
  openTranscript: (turns: Turn[]) => void;
  send: (message: ClientMessage) => void;
  subscribeConsole: (
    listener: (message: ServerMessage) => void,
  ) => () => void;
}

/** Renders window frames and dispatches each window kind to its content. */
export function WindowStackHost({
  windows,
  wizard,
  projects,
  activeProject,
  provider,
  theme,
  openWindow,
  closeWindow,
  raiseWindow,
  moveWindow,
  resizeWindow,
  openProjectSelector,
  openTranscript,
  send,
  subscribeConsole,
}: WindowStackHostProps) {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  return windows.map((windowState) => (
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
          sessions={[]}
          projects={projects}
          provider={provider}
          onOpenSession={() => {
            openTranscript([]);
            closeWindow(windowState.id);
          }}
          onNewSession={openProjectSelector}
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
  ));
}
