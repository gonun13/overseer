import { useState } from "react";
import {
  mockApprovals,
  mockCapabilities,
  mockSessions,
  mockTranscript,
} from "../data/mock";
import type { Project, ProviderInfo, Turn } from "../domain";
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
  openWindow: OpenWindowAction;
  closeWindow: (id: string) => void;
  raiseWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  openProjectSelector: () => void;
  openTranscript: (turns: Turn[]) => void;
}

/** Renders window frames and dispatches each window kind to its content. */
export function WindowStackHost({
  windows,
  wizard,
  projects,
  activeProject,
  provider,
  openWindow,
  closeWindow,
  raiseWindow,
  moveWindow,
  openProjectSelector,
  openTranscript,
}: WindowStackHostProps) {
  const [approvals, setApprovals] = useState(mockApprovals);

  return windows.map((windowState) => (
    <Window
      key={windowState.id}
      title={windowState.title}
      x={windowState.x}
      y={windowState.y}
      z={windowState.z}
      width={windowState.w}
      onClose={() => closeWindow(windowState.id)}
      onRaise={() => raiseWindow(windowState.id)}
      onMove={(x, y) => moveWindow(windowState.id, x, y)}
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
          sessions={mockSessions}
          projects={projects}
          provider={provider}
          onOpenSession={() => {
            openTranscript(mockTranscript);
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
          capabilities={mockCapabilities}
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
        <ConsoleWindow provider={provider} />
      )}
      {windowState.kind === "help" && <HelpWindow provider={provider} />}
      {windowState.kind === "diff" && (
        <DiffWindow target={String(windowState.payload ?? "")} />
      )}
    </Window>
  ));
}
