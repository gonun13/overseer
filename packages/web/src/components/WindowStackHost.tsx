import type {
  ClientMessage,
  ConsoleInfo,
  OverseerTheme,
  ServerMessage,
} from "@overseer/protocol";
import type { Project, Session } from "../domain";
import type { DiscoveryController } from "../state/useDiscovery";
import type { LoopConfigState, LoopModelsEntry } from "../state/useLoopConfig";
import { consoleLight, type PendingConsole } from "../state/useConsoles";
import { PENDING_PREFIX } from "../state/console-layout";
import type { OpenWindow, WindowKind } from "../windows";
import { Window } from "./Window";
import { ChangelogWindow } from "./windows/ChangelogWindow";
import { GitConfigWindow } from "./windows/GitConfigWindow";
import { fileViewKey, folderViewKey, parseFolderViewKey } from "../fileview";
import { ConsoleWindow } from "./windows/ConsoleWindow";
import { DiffWindow } from "./windows/DiffWindow";
import { FolderWindow } from "./windows/FolderWindow";
import { HelpWindow } from "./windows/HelpWindow";
import { LoopModelsWindow } from "./windows/LoopModelsWindow";
import { OverseerWindow } from "./windows/OverseerWindow";
import { spaceRows } from "../state/space";
import { ProjectCreateWindow } from "./windows/ProjectCreateWindow";
import { ProjectWindow } from "./windows/ProjectWindow";
import { ProvidersWindow } from "./windows/ProvidersWindow";
import { SessionsWindow } from "./windows/SessionsWindow";
import type { ProviderInfo } from "../domain";

/** Mirrors `useWindows`' own `open`. `detail` is the dim secondary on the tab —
 * needed wherever the title alone is ambiguous, as it is for a file view whose
 * title is a basename two different files can share. */
type OpenWindowAction = (
  kind: WindowKind,
  payload?: unknown,
  title?: string,
  detail?: string,
) => void;

interface WindowStackHostProps {
  windows: OpenWindow[];
  wizard: DiscoveryController;
  projects: Project[];
  provider: ProviderInfo;
  theme: OverseerTheme;
  sessions: Session[];
  consoles: ConsoleInfo[];
  pendingConsoles: PendingConsole[];
  openWindow: OpenWindowAction;
  closeWindow: (id: string) => void;
  raiseWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  /** A console window's process ended; `clean` is a zero exit. */
  onConsoleExit: (windowId: string, consoleId: string, clean: boolean) => void;
  onKillConsole: (id: string) => void;
  onOpenSession: (session: Session) => void;
  onDeleteSession: (id: string) => void;
  send: (message: ClientMessage) => void;
  subscribeConsole: (listener: (message: ServerMessage) => void) => () => void;
  /** Routes `project.git.*` frames to the project, diff and folder windows. */
  subscribeSession: (listener: (message: ServerMessage) => void) => () => void;
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
  provider,
  theme,
  sessions,
  consoles,
  pendingConsoles,
  openWindow,
  closeWindow,
  raiseWindow,
  moveWindow,
  resizeWindow,
  onConsoleExit,
  onKillConsole,
  onOpenSession,
  onDeleteSession,
  send,
  subscribeConsole,
  subscribeSession,
  loopConfig,
  onSetLoopProvider,
  onSetLoopModel,
  loopModelsByProvider,
  onReadLoopModels,
}: WindowStackHostProps) {
  /** Open one folder's listing. Shared by the project window's collapsed
   * folder rows and by a folder row inside a listing already open, so both
   * entry points title and key the window the same way — the key is what
   * raises an open window instead of stacking another on the same folder. */
  const openFolder = (projectPath: string, folder: string) => {
    openWindow(
      "folder",
      folderViewKey(projectPath, folder),
      // Basename on the tab, full path in the dim detail — the same split the
      // file view uses, and for the same reason.
      folder.split("/").pop(),
      folder,
    );
  };

  return windows.map((windowState) => {
    const payload = String(windowState.payload ?? "");
    const consoleInfo =
      windowState.kind === "console" ? consoles.find((c) => c.id === payload) : undefined;
    const pending =
      windowState.kind === "console" && payload.startsWith(PENDING_PREFIX)
        ? pendingConsoles.find((p) => `${PENDING_PREFIX}${p.reqId}` === payload)
        : undefined;
    const running = consoleInfo?.status === "running";

    return (
      <Window
        key={windowState.id}
        windowId={windowState.id}
        title={windowState.title}
        detail={windowState.detail}
        x={windowState.x}
        y={windowState.y}
        z={windowState.z}
        width={windowState.w}
        height={windowState.h}
        variant={windowState.kind === "console" ? "console" : undefined}
        light={consoleInfo !== undefined ? consoleLight(consoleInfo) : undefined}
        closeLabel={running ? "detach" : undefined}
        actions={
          running ? (
            <button
              type="button"
              className="tab-action"
              onClick={() => onKillConsole(consoleInfo.id)}
              aria-label={`kill ${windowState.title}`}
            >
              kill
            </button>
          ) : undefined
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
          <OverseerWindow rows={spaceRows(wizard.space)} />
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
        {windowState.kind === "sessions" && (
          <SessionsWindow
            sessions={sessions}
            projects={projects}
            onOpenSession={onOpenSession}
            onDeleteSession={onDeleteSession}
          />
        )}
        {windowState.kind === "gitConfig" && (
          <GitConfigWindow
            access={wizard.gitAccess}
            test={wizard.gitSshTest}
            onGenerate={wizard.generateGitKey}
            onRemove={wizard.removeGitKey}
            onTest={wizard.testGitKey}
            onSaveIdentity={wizard.saveGitIdentity}
          />
        )}
        {windowState.kind === "console" && (
          <ConsoleWindow
            info={consoleInfo}
            pending={pending}
            theme={theme}
            connected={wizard.connected}
            send={send}
            subscribe={subscribeConsole}
            onProcessExit={(clean) => onConsoleExit(windowState.id, payload, clean)}
          />
        )}
        {windowState.kind === "help" && <HelpWindow provider={provider} />}
        {windowState.kind === "changelog" && <ChangelogWindow />}
        {windowState.kind === "diff" && (
          <DiffWindow
            target={String(windowState.payload ?? "")}
            send={send}
            subscribe={subscribeSession}
          />
        )}
        {windowState.kind === "folder" && (
          <FolderWindow
            target={String(windowState.payload ?? "")}
            send={send}
            subscribe={subscribeSession}
            // A child is named, not pathed — the folder this window is showing
            // is what turns that name into a path, and joining the two here is
            // the whole of how the walk goes deeper.
            onOpenFile={(name) => {
              const view = parseFolderViewKey(String(windowState.payload ?? ""));
              if (!view) return;
              const file = `${view.folder}/${name}`;
              openWindow("diff", fileViewKey(view.projectPath, file), name, file);
            }}
            onOpenFolder={(name) => {
              const view = parseFolderViewKey(String(windowState.payload ?? ""));
              if (!view) return;
              openFolder(view.projectPath, `${view.folder}/${name}`);
            }}
          />
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
            onOpenFile={(file) => {
              const project = String(windowState.payload ?? "");
              // Git collapses an untracked directory into one row ending in a
              // slash rather than listing its files, so a row is not always a
              // file. That row opens a listing of the folder — there is no
              // diff of a directory to show, and the files under it are what
              // the operator clicked it to see.
              if (file.path.endsWith("/")) {
                const folder = file.path.replace(/\/+$/, "");
                openFolder(project, folder);
                return;
              }
              openWindow(
                "diff",
                fileViewKey(project, file.path, file.previousPath),
                // The tab takes the basename and the full path goes in the
                // dim detail beside it: a deep path would otherwise fill the
                // field and crowd out every other window's tab.
                file.path.split("/").pop(),
                file.path,
              );
            }}
          />
        )}
      </Window>
    );
  });
}
