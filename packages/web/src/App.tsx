import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleInfo } from "@overseer/protocol";
import { ActiveProject } from "./components/ActiveProject";
import { Clock } from "./components/Clock";
import { DecisionWindow } from "./components/DecisionWindow";
import { OverseerSpace } from "./components/OverseerSpace";
import { ProjectPanel } from "./components/ProjectPanel";
import { Footer } from "./components/Footer";
import { Prompt } from "./components/Prompt";
import { ProviderWidget } from "./components/ProviderWidget";
import { SessionActions, SessionPanel } from "./components/SessionPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { WindowStackHost } from "./components/WindowStackHost";
import type { Session } from "./domain";
import type { Signal } from "./state/signals";
import type { WindowKind } from "./windows";
import {
  PENDING_PREFIX,
  isConsoleId,
  loadConsoleLayout,
  saveConsoleLayout,
} from "./state/console-layout";
import { useConsoles, type ConsoleOpenRequest } from "./state/useConsoles";
import { useDiscovery } from "./state/useDiscovery";
import { furnitureFor } from "./state/wizard";
import { useLoopConfig } from "./state/useLoopConfig";
import { usePromptSession } from "./state/usePromptSession";
import { useRelay } from "./state/useRelay";
import type { Addressee } from "./commands";
import { useSessions } from "./state/useSessions";
import { useShellKeyboard } from "./state/useShellKeyboard";
import { useShellPresentation } from "./state/useShellPresentation";
import { useUsageCheck } from "./state/useUsageCheck";
import { useWindows } from "./state/useWindows";

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Tab label for a console window before the server has named it. */
function pendingTitle(request: ConsoleOpenRequest): string {
  if (request.kind === "agent") return request.providerId ?? "agent";
  return request.kind;
}

export default function App() {
  const [projectsOpen, setProjectsOpen] = useState(true);
  // Open by default: the consoles and sessions are the point of the field.
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wizard = useDiscovery();
  const {
    windows,
    open,
    close,
    closeTop,
    closeAll,
    closeWhere,
    raise,
    move,
    resize,
    rekey,
    tile,
  } = useWindows();

  const selectTheme = wizard.selectTheme;
  const toggleTheme = useCallback(() => {
    selectTheme(wizard.theme === "machine" ? "samaritan" : "machine");
  }, [selectTheme, wizard.theme]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const toggleSettings = useCallback(
    () => setSettingsOpen((current) => !current),
    [],
  );
  const openProjectSelector = useCallback(() => setProjectsOpen(true), []);
  const toggleProjects = useCallback(
    () => setProjectsOpen((current) => !current),
    [],
  );
  const toggleSessions = useCallback(
    () => setSessionsOpen((current) => !current),
    [],
  );

  // ---- consoles ------------------------------------------------------------

  /** The server answered an open: the placeholder window becomes the
   * console's own (or, if it attached a console already on screen, goes). */
  const onConsoleOpened = useCallback(
    (reqId: string, info: ConsoleInfo) => {
      rekey("console", `${PENDING_PREFIX}${reqId}`, info.id, info.title);
    },
    [rekey],
  );
  const consoles = useConsoles(wizard.send, wizard.subscribeConsole, onConsoleOpened);
  const consoleList = consoles.consoles;
  const startConsole = consoles.open;

  /** Ask for a console and put its window up at once — it says "starting…"
   * until the server answers, and why not if it refuses. */
  const openConsole = useCallback(
    (request: ConsoleOpenRequest) => {
      const reqId = startConsole(request);
      open(
        "console",
        `${PENDING_PREFIX}${reqId}`,
        pendingTitle(request),
        basename(request.projectPath),
      );
    },
    [open, startConsole],
  );

  /** Bring a running (or exited) console's window up. */
  const showConsole = useCallback(
    (info: ConsoleInfo) => open("console", info.id, info.title),
    [open],
  );

  const showConsoleById = useCallback(
    (id: string) => {
      const info = consoleList.find((c) => c.id === id);
      if (info !== undefined) showConsole(info);
    },
    [consoleList, showConsole],
  );

  // A reload puts every console window back where it was: the consoles never
  // stopped, only this tab's view of them did. Once per page, against the
  // first list the server sends — and nothing is saved before that, or the
  // empty desk of a fresh page would overwrite the layout it is about to
  // restore. Not before discovery has revealed the session panel: the field
  // comes up in discovery's order, and the consoles are part of the field.
  const restored = useRef(false);
  const sessionsRevealed = furnitureFor(wizard).sessions;
  useEffect(() => {
    if (restored.current || !consoles.listed || !sessionsRevealed) return;
    restored.current = true;
    const byId = new Map(consoleList.map((c) => [c.id, c]));
    for (const saved of loadConsoleLayout()) {
      const info = byId.get(saved.consoleId);
      if (info === undefined) continue;
      // Saved for which consoles were on the desk and in what order; the
      // tile decides where.
      open("console", info.id, info.title);
    }
  }, [consoles.listed, sessionsRevealed, consoleList, open]);

  useEffect(() => {
    if (restored.current) saveConsoleLayout(windows);
  }, [windows]);

  // A console another tab dismissed is gone for this one too.
  useEffect(() => {
    if (!consoles.listed) return;
    const live = new Set(consoleList.map((c) => c.id));
    closeWhere(
      (w) => w.kind === "console" && isConsoleId(w.payload) && !live.has(w.payload),
    );
  }, [consoles.listed, consoleList, closeWhere]);

  const dismissConsole = consoles.dismiss;
  /** A clean exit is the operator's own `/exit`: the window and the console
   * both go. A failure stays up — it is the only account of what went wrong. */
  const onConsoleExit = useCallback(
    (windowId: string, consoleId: string, clean: boolean) => {
      if (!clean) return;
      close(windowId);
      dismissConsole(consoleId);
    },
    [close, dismissConsole],
  );

  /** Closing a console window detaches it; closing a refused one also forgets
   * the request. */
  const forgetPending = consoles.forgetPending;
  const closeWindow = useCallback(
    (id: string) => {
      const win = windows.find((w) => w.id === id);
      const payload = win?.payload;
      if (win?.kind === "console" && typeof payload === "string" && payload.startsWith(PENDING_PREFIX)) {
        forgetPending(payload.slice(PENDING_PREFIX.length));
      }
      close(id);
    },
    [close, forgetPending, windows],
  );

  const tileWindows = tile;

  /** Raise the console window furthest down the stack — repeated, it walks
   * through every one — and hand it the keyboard. */
  const cycleConsoles = useCallback(() => {
    const consoleWindows = windows.filter((w) => w.kind === "console");
    if (consoleWindows.length === 0) return;
    const next = consoleWindows.reduce((a, b) => (b.z < a.z ? b : a));
    raise(next.id);
    requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        `[data-window-id="${next.id}"] .xterm-helper-textarea`,
      );
      textarea?.focus();
    });
  }, [raise, windows]);

  // ---- sessions ------------------------------------------------------------

  const { sessions, deleteSession } = useSessions(
    wizard.send,
    wizard.subscribeSession,
    wizard.connected,
    consoleList,
  );
  const relay = useRelay(wizard.send, wizard.subscribeConsole);
  const shell = useShellPresentation(wizard, consoleList, relay.held);
  const activeProject = shell.activeProject;
  const attachedProviderId = wizard.attachedProviderId;
  const canStartSession = shell.provider.authenticated && attachedProviderId !== undefined;

  /** A new provider session in the active project, optionally starting on a
   * prompt the operator typed into the prompt bar. */
  const newSession = useCallback(
    (prompt?: string) => {
      if (activeProject === undefined || attachedProviderId === undefined) return;
      openConsole({
        kind: "agent",
        projectPath: activeProject.path,
        providerId: attachedProviderId,
        ...(prompt !== undefined ? { prompt } : {}),
      });
    },
    [activeProject, attachedProviderId, openConsole],
  );

  const newShell = useCallback(() => {
    if (activeProject === undefined) return;
    openConsole({ kind: "shell", projectPath: activeProject.path });
  }, [activeProject, openConsole]);

  const runningLoop = useCallback(
    (projectPath: string) =>
      consoleList.find(
        (c) => c.kind === "loop" && c.status === "running" && c.projectPath === projectPath,
      ),
    [consoleList],
  );

  const openLoop = useCallback(() => {
    if (activeProject === undefined) return;
    const live = runningLoop(activeProject.path);
    if (live !== undefined) {
      showConsole(live);
      return;
    }
    openConsole({ kind: "loop", projectPath: activeProject.path });
  }, [activeProject, openConsole, runningLoop, showConsole]);

  // Project whose loop run the operator is being asked to take over.
  const [loopTakeoverFor, setLoopTakeoverFor] = useState<string | null>(null);

  /**
   * Every list of sessions routes through here. A session with a console
   * shows it. A loop run lives in its loop console — this server's, or one in
   * a terminal elsewhere, which only a take-over can bring here. Anything
   * else resumes in a new console.
   */
  const openSession = useCallback(
    (session: Session) => {
      if (session.consoleId !== undefined) {
        showConsoleById(session.consoleId);
        return;
      }
      if (session.origin === "loop") {
        const live = runningLoop(session.projectId);
        if (live !== undefined) {
          showConsole(live);
          return;
        }
        setLoopTakeoverFor(session.projectId);
        return;
      }
      openConsole({
        kind: "agent",
        projectPath: session.projectId,
        providerId: session.providerId,
        sessionId: session.id,
        resume: true,
      });
    },
    [openConsole, runningLoop, showConsole, showConsoleById],
  );

  const confirmLoopTakeover = useCallback(() => {
    const projectPath = loopTakeoverFor;
    setLoopTakeoverFor(null);
    if (projectPath === null) return;
    openConsole({ kind: "loop", projectPath, takeover: true });
  }, [loopTakeoverFor, openConsole]);

  const running = useMemo(
    () => consoleList.filter((c) => c.status === "running"),
    [consoleList],
  );
  /** Kill is deliberate: the console ends and goes — window, row and all —
   * at once. Ending a CLI by signal exits non-zero (129 for a hangup), and
   * left listed that read as a failure the overseer had to report. */
  const killConsole = useCallback(
    (id: string) => {
      closeWhere((w) => w.kind === "console" && w.payload === id);
      dismissConsole(id);
    },
    [closeWhere, dismissConsole],
  );
  const killAllConsoles = useCallback(() => {
    for (const c of running) killConsole(c.id);
  }, [running, killConsole]);

  // ---- windows, prompt, keys -----------------------------------------------

  // A slash command has no project row to hand a path payload from, so
  // `/project` (and any signal routed the same way) targets whatever is
  // active. A row's own manage icon (ProjectPanel's onManage) calls `open`
  // directly with that row's path instead of going through this.
  const openWindow = useCallback(
    (kind: WindowKind, payload?: unknown, title?: string) => {
      if (kind === "project" && payload === undefined) {
        const name = wizard.projects.find(
          (p) => p.path === wizard.activeProjectPath,
        )?.name;
        open(kind, wizard.activeProjectPath, undefined, name);
        return;
      }
      open(kind, payload, title);
    },
    [open, wizard.activeProjectPath, wizard.projects],
  );

  /** Every agent `@` can address: running ones, then dormant named sessions
   * of the active project (spec/behaviour/relay.md §2). */
  const agents = useMemo((): Addressee[] => {
    const live = consoleList.filter(
      (c) => c.kind === "agent" && c.status === "running" && c.callsign !== undefined,
    );
    const liveSessions = new Set(live.map((c) => c.sessionId));
    return [
      ...live.map((c) => {
        const title = sessions.find((s) => s.id === c.sessionId)?.name;
        return { callsign: c.callsign!, running: true, ...(title !== undefined ? { title } : {}) };
      }),
      ...sessions
        .filter(
          (s) =>
            s.callsign !== undefined &&
            s.origin !== "loop" &&
            s.projectId === activeProject?.path &&
            !liveSessions.has(s.id),
        )
        .map((s) => ({ callsign: s.callsign!, title: s.name, running: false })),
    ];
  }, [activeProject?.path, consoleList, sessions]);

  /** `@linda` alone: that agent's console, or its session resumed. */
  const showAgent = useCallback(
    (callsign: string) => {
      const needle = callsign.toLowerCase();
      const live = consoleList.find(
        (c) => c.kind === "agent" && c.status === "running" && c.callsign?.toLowerCase() === needle,
      );
      if (live !== undefined) {
        showConsole(live);
        return;
      }
      const session = sessions.find((s) => s.callsign?.toLowerCase() === needle);
      if (session !== undefined) openSession(session);
    },
    [consoleList, openSession, sessions, showConsole],
  );

  const prompt = usePromptSession({
    openWindow,
    closeAllWindows: closeAll,
    openSettings,
    openProjectSelector,
    toggleTheme,
    openLoop,
    openShell: newShell,
    tileWindows,
    relayTo: relay.relay,
    showAgent,
    renameAgent: relay.rename,
    dropRelays: relay.dropAll,
  });
  const focusPrompt = prompt.focus;
  const submitCommand = prompt.submit;

  const submitPrompt = useCallback(
    (input: string) => {
      if (submitCommand(input)) return;
      newSession(input);
    },
    [newSession, submitCommand],
  );

  const usageCheck = useUsageCheck(wizard.send, wizard.subscribeSession);

  const {
    config: loopConfig,
    setProvider: setLoopProvider,
    setModel: setLoopModel,
    modelsByProvider: loopModelsByProvider,
    readModels: readLoopModels,
  } = useLoopConfig(wizard.send, wizard.subscribeLoop, wizard.connected);

  const openHelp = useCallback(() => open("help"), [open]);
  const openChangelog = useCallback(() => open("changelog"), [open]);

  const deciding = wizard.reset === "confirm" || loopTakeoverFor !== null;

  useShellKeyboard({
    blocked: deciding,
    settingsOpen,
    windowCount: windows.length,
    closeSettings,
    closeTopWindow: closeTop,
    blurPrompt: prompt.blur,
    focusPrompt,
    toggleProjects,
    toggleSettings,
    cycleConsoles,
  });

  useEffect(() => {
    document.documentElement.dataset.theme = wizard.theme;
  }, [wizard.theme]);

  const askReset = wizard.askReset;
  const startReset = useCallback(() => {
    closeSettings();
    askReset();
  }, [askReset, closeSettings]);

  // The login surface is the providers window in its authenticate step, so this
  // both summons it and starts the flow — the URL has to be on screen a beat
  // after the click, not after a second click the operator has to find.
  //
  // With nothing attached there is nothing to sign in, and the same window's
  // picker step is the honest place to land.
  const wizardStartLogin = wizard.startLogin;
  const startLogin = useCallback(() => {
    closeSettings();
    open("providers");
    if (attachedProviderId !== undefined) wizardStartLogin(attachedProviderId);
  }, [attachedProviderId, closeSettings, open, wizardStartLogin]);

  // The goodbye is a message and nothing else — including the operations
  // window that just finished reporting the wipe.
  useEffect(() => {
    if (wizard.reset === "goodbye") closeAll();
  }, [wizard.reset, closeAll]);

  const releaseRelay = relay.release;
  const followSignal = useCallback(
    (signal: Signal) => {
      switch (signal.target.kind) {
        case "window":
          open(signal.target.window, signal.target.payload);
          return;
        case "console":
          showConsoleById(signal.target.id);
          return;
        case "settings":
          openSettings();
          return;
        case "selector":
          openProjectSelector();
          return;
        case "session":
          newSession();
          return;
        case "login":
          startLogin();
          return;
        case "restart":
          location.reload();
          return;
        case "relay":
          releaseRelay(signal.target.id, true);
          return;
      }
    },
    [newSession, open, openProjectSelector, openSettings, releaseRelay, showConsoleById, startLogin],
  );

  // The overseer docks into the right rail once the field is set up — the
  // stage is for windows. Boot, the first-run asks and the goodbye are the
  // whole of the field, so they keep the stage centre.
  const overseerDocked = shell.furniture.sessions && wizard.reset !== "goodbye";
  const overseerSpace = (
    <OverseerSpace
      docked={overseerDocked}
      signals={shell.signals}
      rows={shell.statusRows}
      message={shell.message}
      loading={shell.loading}
      typingChance={shell.typingChance}
      holdCaret={shell.holdCaret}
      onGoodbyeClick={shell.onGoodbyeClick}
      onFollow={followSignal}
      onSubmitName={shell.askingName ? wizard.submitOperatorName : undefined}
      namePrefix={shell.namePrefix}
      onSubmitTone={shell.pickingTone ? wizard.submitOperatorTone : undefined}
      selectedTone={wizard.personality.tone ?? "neutral"}
      onMessageReady={wizard.onMessageReady}
    />
  );

  return (
    <>
      {/* `inert` rather than a scrim alone: a covering layer stops the mouse
          and nothing else, and the field behind a decision must not be
          reachable by Tab either. */}
      <div className="field" inert={deciding}>
        {/* Left rail: what to work on — the project, every project, every
            console and session, the ways to start another, and the provider
            they run on. */}
        <aside className="rail rail-left">
          {shell.furniture.activeProject && (
            <ActiveProject
              project={shell.activeProject}
              onPick={openProjectSelector}
              // No payload: `openWindow` targets whatever is active, the same
              // path the readout is describing.
              onOpen={() => openWindow("project")}
            />
          )}

          {shell.furniture.projectPanel && (
            <ProjectPanel
              projects={shell.projects}
              active={shell.activeProject}
              open={projectsOpen}
              onToggle={toggleProjects}
              // Consoles are not scoped to the active project: every one keeps
              // running, and its window stays where it is, across a switch.
              onSelect={(project) => wizard.selectProject(project.path)}
              onCreate={() => open("projectCreate")}
              onManage={(project) =>
                open("project", project.path, undefined, project.name)
              }
            />
          )}

          {shell.furniture.sessions && (
            <>
              <SessionPanel
                consoles={consoleList}
                sessions={sessions}
                projectPath={activeProject?.path}
                projectName={activeProject?.name}
                open={sessionsOpen}
                onToggle={toggleSessions}
                onShowConsole={showConsole}
                onKillConsole={killConsole}
                onDismissConsole={dismissConsole}
                onSelectSession={openSession}
                onDeleteSession={deleteSession}
              />
              <SessionActions
                canStartSession={canStartSession}
                windowCount={windows.length}
                onNewSession={() => newSession()}
                onNewShell={newShell}
                onTile={tileWindows}
              />
            </>
          )}

          {shell.furniture.providerWidget && (
            <ProviderWidget
              provider={shell.provider}
              usageCheck={usageCheck}
              onOpenProviders={() => open("providers")}
            />
          )}
        </aside>

        {/* The stage: windows only. Consoles tile it; everything else floats
            inside it. Until the field is set up, the overseer speaks here. */}
        <main className="stage">{!overseerDocked && overseerSpace}</main>

        {/* Right rail: the machine — time and settings, then the overseer's
            layer (its message, signals and status, and the prompt that
            answers it), then version and help. */}
        <aside className="rail rail-right">
          {shell.furniture.clock && <Clock onOpenSettings={openSettings} />}

          <div className="overseer-layer">
            {overseerDocked && overseerSpace}
            {shell.furniture.prompt && (
              <div className="dock">
                <Prompt
                  focused={prompt.focused}
                  onFocus={focusPrompt}
                  onBlur={prompt.blur}
                  onSubmit={submitPrompt}
                  agents={agents}
                />
              </div>
            )}
          </div>

          {shell.furniture.footer && (
            <Footer
              helpVisible={shell.furniture.prompt}
              onOpenHelp={openHelp}
              onOpenChangelog={openChangelog}
            />
          )}
        </aside>

        <WindowStackHost
          windows={windows}
          wizard={wizard}
          projects={shell.projects}
          provider={shell.provider}
          theme={wizard.theme}
          sessions={sessions}
          consoles={consoleList}
          pendingConsoles={consoles.pending}
          openWindow={open}
          closeWindow={closeWindow}
          raiseWindow={raise}
          moveWindow={move}
          resizeWindow={resize}
          onConsoleExit={onConsoleExit}
          onKillConsole={killConsole}
          onOpenSession={openSession}
          onDeleteSession={deleteSession}
          send={wizard.send}
          subscribeConsole={wizard.subscribeConsole}
          subscribeSession={wizard.subscribeSession}
          loopConfig={loopConfig}
          onSetLoopProvider={setLoopProvider}
          onSetLoopModel={setLoopModel}
          loopModelsByProvider={loopModelsByProvider}
          onReadLoopModels={readLoopModels}
        />

        <SettingsPanel
          open={settingsOpen}
          theme={wizard.theme}
          provider={shell.provider}
          workspace={shell.workspace}
          onClose={closeSettings}
          onSelectTheme={selectTheme}
          onOpenGitConfig={() => {
            open("gitConfig");
            closeSettings();
          }}
          onStartLogin={startLogin}
          onSignOut={() => {
            if (shell.provider.name) wizard.signOut(shell.provider.name);
          }}
          onKillAllConsoles={killAllConsoles}
          runningCount={running.length}
          onResetOverseer={startReset}
          gitAccess={wizard.gitAccess}
        />
      </div>

      {loopTakeoverFor !== null && (
        <DecisionWindow
          title="take over loop"
          confirmLabel="take over"
          declineLabel="leave it"
          onConfirm={confirmLoopTakeover}
          onDecline={() => setLoopTakeoverFor(null)}
        >
          <p className="w-note">
            the loop on {basename(loopTakeoverFor)} is running in another
            terminal. this ends that run — including whatever request it is
            part way through — and starts a new one here.
          </p>
          <p className="w-note">
            recorded work is kept; the conversation is not. &gt; there is no
            undo &lt;
          </p>
        </DecisionWindow>
      )}

      {wizard.reset === "confirm" && (
        <DecisionWindow
          title="reset overseer"
          confirmLabel="erase"
          declineLabel="keep"
          onConfirm={wizard.confirmReset}
          onDecline={wizard.declineReset}
        >
          <p className="w-note">
            this will erase the overseer's memory: its internal memory, world
            snapshot, the action register, every run log and personality.
          </p>
          <p className="w-note">
            projects are untouched and the provider stays signed in. the page
            reloads into a first run. &gt; there is no undo &lt;
          </p>
        </DecisionWindow>
      )}
    </>
  );
}
