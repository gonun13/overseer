import type {
  ClientMessage,
  OverseerTheme,
  PermissionDecision,
  ServerMessage,
} from "@overseer/protocol";
import type { Plan, Project, ProviderInfo, Session } from "../domain";
import type {
  SessionOption,
  SessionOptionKey,
  SessionSettings,
} from "../session";
import type { Chat } from "../state/useChatSessions";
import type { DiscoveryController } from "../state/useDiscovery";
import type { LoopConfigState, LoopModelsEntry } from "../state/useLoopConfig";
import type { OpenWindow, WindowKind } from "../windows";
import { Window } from "./Window";
import { CapabilitiesWindow } from "./windows/CapabilitiesWindow";
import { SubagentWindow } from "./windows/SubagentWindow";
import type { SubagentsState } from "../state/useSubagents";
import { findSubagent, subagentKey } from "../subagents";
import { ConsoleWindow } from "./windows/ConsoleWindow";
import { ContextWindow } from "./windows/ContextWindow";
import { DiffWindow } from "./windows/DiffWindow";
import { HelpWindow } from "./windows/HelpWindow";
import { LoopModelsWindow } from "./windows/LoopModelsWindow";
import { OverseerWindow } from "./windows/OverseerWindow";
import { PlansWindow } from "./windows/PlansWindow";
import { ProjectCreateWindow } from "./windows/ProjectCreateWindow";
import { ProjectWindow } from "./windows/ProjectWindow";
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
  onResolveApproval: (
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ) => void;
  plans: Plan[];
  /** Last plan refusal in the server's words, shown in the plans window. */
  plansError?: string;
  onOpenPlanSession: (sessionId: string) => void;
  onImplementPlan: (planId: string) => void;
  onSetPlanStatus: (planId: string, status: "done" | "open") => void;
  sessionOptions: SessionOption[];
  subagents: SubagentsState;
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
  /** Routes `project.git.*` frames to the project management window — same
   * channel `useProviderOptions`/`useChatSessions` already use, since these
   * are the same kind of single-window, project-scoped, benign-refusal-
   * tolerant request. */
  subscribeSession: (listener: (message: ServerMessage) => void) => () => void;
  /** True when the next loop console to mount should end the run currently
   * holding the workspace's lease. Consumed once, on that mount. */
  loopTakeover: boolean;
  /** A loop row goes to its console, never to a chat window. */
  onOpenLoopSession: (session: Session) => void;
  /** The loop's own provider/model configuration — independent of `provider`
   * above, which is the app's single attached one. */
  loopConfig: LoopConfigState;
  onSetLoopProvider: (id: string) => void;
  onSetLoopModel: (providerId: string, slot: string, model: string) => void;
  /** Model lists per loop-runnable provider, fetched on demand
   * (`onReadLoopModels`) straight from that provider's own CLI — independent
   * of which provider (if any) the app has attached. */
  loopModelsByProvider: Record<string, LoopModelsEntry>;
  onReadLoopModels: (providerId: string) => void;
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
  onResolveApproval,
  plans,
  plansError,
  onOpenPlanSession,
  onImplementPlan,
  onSetPlanStatus,
  sessionOptions,
  subagents,
  armedSession,
  openSessionControls,
  onToggleSessionControl,
  onSelectSessionControl,
  onOpenSessionContext,
  send,
  subscribeConsole,
  subscribeSession,
  loopTakeover,
  onOpenLoopSession,
  loopConfig,
  onSetLoopProvider,
  onSetLoopModel,
  loopModelsByProvider,
  onReadLoopModels,
}: WindowStackHostProps) {
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
            loopConfig={loopConfig}
            onSetLoopProvider={onSetLoopProvider}
            onOpenLoopModels={(id) => openWindow("loopModels", id, id)}
          />
        )}
        {windowState.kind === "loopModels" && (
          <LoopModelsWindow
            providerId={String(windowState.payload ?? "")}
            loopConfig={loopConfig}
            entry={loopModelsByProvider[String(windowState.payload ?? "")]}
            onReadModels={onReadLoopModels}
            onSetModel={(slot, model) =>
              onSetLoopModel(String(windowState.payload ?? ""), slot, model)
            }
          />
        )}
        {windowState.kind === "plans" && (
          <PlansWindow
            plans={plans}
            provider={provider}
            error={plansError}
            onOpenPlanSession={onOpenPlanSession}
            onImplementPlan={onImplementPlan}
            onSetPlanStatus={onSetPlanStatus}
          />
        )}
        {windowState.kind === "sessions" && (
          <SessionsWindow
            sessions={sessions}
            projects={projects}
            provider={provider}
            models={models}
            onOpenSession={(id) => {
              // A loop run lives in a console, not a conversation — routed
              // before `chatFor`, which would otherwise resume it.
              const session = sessions.find((s) => s.id === id);
              if (session?.origin === "loop") {
                onOpenLoopSession(session);
                return;
              }
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
            note={chat.note}
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
            onResolveApproval={(requestId, decision) =>
              onResolveApproval(chat.session.id, requestId, decision)
            }
          />
        )}
        {windowState.kind === "capabilities" && (
          <CapabilitiesWindow
            provider={provider}
            subagents={subagents}
            onEdit={(subagent) =>
              openWindow("subagent", subagentKey(subagent), subagent.name)
            }
            // An empty payload is the create form. It is also its dedupe key,
            // so a second "+ subagent" raises the one already open rather than
            // stacking a second blank form over it.
            onCreate={() => openWindow("subagent", "", "new subagent")}
          />
        )}
        {windowState.kind === "subagent" && (
          <SubagentWindow
            // Looked up rather than carried on the payload: after a save
            // renames a file, the row this window was opened from is gone and
            // the list is the only thing that knows where it went.
            existing={findSubagent(subagents.subagents, String(windowState.payload ?? ""))}
            subagents={subagents}
            models={sessionOptions.find((o) => o.key === "model")}
            onClose={() => closeWindow(windowState.id)}
          />
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
            mode={windowState.payload === "loop" ? "loop" : undefined}
            takeover={windowState.payload === "loop" && loopTakeover}
          />
        )}
        {windowState.kind === "help" && <HelpWindow provider={provider} />}
        {windowState.kind === "diff" && (
          <DiffWindow target={String(windowState.payload ?? "")} />
        )}
        {windowState.kind === "projectCreate" && (
          <ProjectCreateWindow
            wizard={wizard}
            onClose={() => closeWindow(windowState.id)}
          />
        )}
        {windowState.kind === "project" && (
          <ProjectWindow
            path={String(windowState.payload ?? "")}
            send={send}
            subscribe={subscribeSession}
          />
        )}
      </Window>
    );
  });
}
