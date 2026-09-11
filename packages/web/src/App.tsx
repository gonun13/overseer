import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActiveProject } from "./components/ActiveProject";
import { Clock } from "./components/Clock";
import { DecisionWindow } from "./components/DecisionWindow";
import { OverseerSpace } from "./components/OverseerSpace";
import { ProjectPanel } from "./components/ProjectPanel";
import { PromptChrome } from "./components/PromptChrome";
import { ProviderWidget } from "./components/ProviderWidget";
import { SessionPanel } from "./components/SessionPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { WindowStackHost } from "./components/WindowStackHost";
import type { Project, Session } from "./domain";
import {
  SESSION_CONTROL_KEYS,
  stoppableSessions,
  type SessionOptionKey,
} from "./session";
import type { Signal } from "./state/signals";
import type { WindowKind } from "./windows";
import { useChatSessions } from "./state/useChatSessions";
import { useDiscovery } from "./state/useDiscovery";
import { useLoopConfig } from "./state/useLoopConfig";
import { usePlans } from "./state/usePlans";
import { usePromptSession } from "./state/usePromptSession";
import { useProviderOptions } from "./state/useProviderOptions";
import { useSkills } from "./state/useSkills";
import { useSubagents } from "./state/useSubagents";
import { useShellKeyboard } from "./state/useShellKeyboard";
import { useShellPresentation } from "./state/useShellPresentation";
import { useUsageCheck } from "./state/useUsageCheck";
import { useWindows } from "./state/useWindows";

/** Tab label for a chat window: session name + project as dim detail. */
function chatWindowLabel(
  session: Session,
  projects: Project[],
): { title: string; detail?: string } {
  const project = projects.find((p) => p.id === session.projectId);
  return project === undefined
    ? { title: session.name }
    : { title: session.name, detail: project.name };
}


export default function App() {
  const [projectsOpen, setProjectsOpen] = useState(true);
  // Open by default: sessions are the point of the field once a provider is
  // attached, not something the operator should have to find the chevron for.
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wizard = useDiscovery();
  const openChatRef = useRef<(session: Session) => void>(() => {});
  const {
    windows,
    open,
    close,
    closeTop,
    closeAll,
    closeKind,
    closeWhere,
    raise,
    move,
    resize,
    retitle,
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

  const openLoop = useCallback(() => {
    // Basename of the active project path, not a lookup into `shell.projects`
    // — that list isn't computed until useShellPresentation, further down,
    // and the loop targets whatever workspace/<name>/ directory is active
    // regardless of whether the project panel has resolved its display name.
    const name = wizard.activeProjectPath?.split("/").filter(Boolean).pop();
    open("console", "loop", `loop · ${name ?? "workspace"}`);
  }, [open, wizard.activeProjectPath]);

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

  const prompt = usePromptSession({
    openWindow,
    closeAllWindows: closeAll,
    openSettings,
    openProjectSelector,
    toggleTheme,
    openLoop,
  });
  const focusPrompt = prompt.focus;
  const submitCommand = prompt.submit;

  // Only a signed-in provider can be asked what it offers; a stub or a
  // signed-out one would have the server refuse.
  const optionsProviderId = useMemo(() => {
    const attached = wizard.providers.find(
      (candidate) => candidate.id === wizard.attachedProviderId,
    );
    return attached?.status.authenticated === true ? attached.id : undefined;
  }, [wizard.providers, wizard.attachedProviderId]);

  const {
    options: sessionOptions,
    armed: armedSession,
    arm: armSession,
    refresh: refreshSessionOptions,
  } = useProviderOptions(
    wizard.send,
    wizard.subscribeSession,
    optionsProviderId,
    wizard.activeProjectPath,
  );

  const subagents = useSubagents(
    wizard.send,
    wizard.subscribeSession,
    optionsProviderId,
    wizard.activeProjectPath,
    // A saved subagent is a new row in the session control menu, and waiting
    // for a project switch to see it is waiting for no reason.
    refreshSessionOptions,
  );

  const skills = useSkills(
    wizard.send,
    wizard.subscribeSession,
    optionsProviderId,
    wizard.activeProjectPath,
  );

  const usageCheck = useUsageCheck(wizard.send, wizard.subscribeSession);

  const {
    config: loopConfig,
    setProvider: setLoopProvider,
    setModel: setLoopModel,
    modelsByProvider: loopModelsByProvider,
    readModels: readLoopModels,
  } = useLoopConfig(wizard.send, wizard.subscribeLoop, wizard.connected);

  const {
    sessions,
    activeId: activeSessionId,
    start: startSession,
    focus: focusSession,
    setSessionSetting,
    chatFor,
    send: sendChat,
    stopSession,
    deleteSession,
    resolveApproval,
  } = useChatSessions(
    wizard.send,
    wizard.subscribeSession,
    (session) => openChatRef.current(session),
    armedSession,
  );
  const shell = useShellPresentation(wizard, open, sessions);

  // Implementing a plan sends the turn server-side; all this has to do is put
  // the session it went to in front of the operator. Routed through the same
  // ref `useChatSessions` uses, since `openChat` is defined further down.
  const openPlanSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (session !== undefined) openChatRef.current(session);
    },
    [sessions],
  );
  const {
    plans,
    refresh: refreshPlans,
    implement: implementPlan,
    setStatus: setPlanStatus,
    error: plansError,
  } = usePlans(wizard.send, wizard.subscribeSession, sessions, openPlanSession);

  // The window is opened by a command, not by a row that already had the data
  // — so it asks for a fresh list as it comes up. The server also broadcasts
  // one whenever the transcripts change, which is what keeps it current after.
  const plansOpen = windows.some((w) => w.kind === "plans");
  useEffect(() => {
    if (plansOpen) refreshPlans();
  }, [plansOpen, refreshPlans]);

  // Same reasoning for the subagent inventory: the operator can add a file to
  // `.claude/agents` from outside the app at any moment, so a window coming up
  // asks rather than trusting whatever the last ask returned.
  const subagentsOpen = windows.some(
    (w) => w.kind === "capabilities" || w.kind === "subagent",
  );
  const refreshSubagents = subagents.refresh;
  useEffect(() => {
    if (subagentsOpen) refreshSubagents();
  }, [subagentsOpen, refreshSubagents]);

  // Which accordion section is open in each session window. Digits on the
  // prompt terminal target the focused session's controls.
  const [openSessionControls, setOpenSessionControls] = useState<
    Partial<Record<string, SessionOptionKey>>
  >({});
  const openSessionControlsRef = useRef(openSessionControls);
  openSessionControlsRef.current = openSessionControls;
  const focusedChat =
    activeSessionId === undefined ? undefined : chatFor(activeSessionId);
  const activeOpenSessionControl =
    activeSessionId === undefined
      ? null
      : (openSessionControls[activeSessionId] ?? null);

  const closeSessionControl = useCallback(() => {
    if (activeSessionId === undefined) return;
    setOpenSessionControls((current) => {
      const next = { ...current };
      delete next[activeSessionId];
      return next;
    });
  }, [activeSessionId]);

  const toggleSessionControl = useCallback(
    (sessionId: string, key: SessionOptionKey) => {
      // Opening a row is the operator asking what is on offer, so take the
      // chance to re-read it — their subagent files may have changed since.
      // Read the current state here rather than inside the updater: a state
      // updater has to stay pure, and it can run twice.
      if (openSessionControlsRef.current[sessionId] !== key) {
        refreshSessionOptions();
      }
      setOpenSessionControls((current) => ({
        ...current,
        [sessionId]: current[sessionId] === key ? undefined : key,
      }));
    },
    [refreshSessionOptions],
  );

  const selectSessionControl = useCallback(
    (sessionId: string, key: SessionOptionKey, value: string) => {
      // Model and mode each have a runtime setter (`set_model` /
      // `set_permission_mode`) and `setSessionSetting` sends them, so a pick
      // there retargets the process that is already running. Agent does not
      // — the CLI offers no runtime control request for it — so a pick on
      // that row only arms the next session. Every row is armed regardless:
      // it is also the default the *next* session starts with.
      setSessionSetting(sessionId, key, value);
      armSession(key, value);
      setOpenSessionControls((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    },
    [setSessionSetting, armSession],
  );

  const toggleActiveSessionControl = useCallback(
    (key: SessionOptionKey) => {
      if (activeSessionId !== undefined)
        toggleSessionControl(activeSessionId, key);
    },
    [activeSessionId, toggleSessionControl],
  );

  // Summoning a session window that is already up raises it rather than
  // stacking a duplicate — useWindows matches on kind and payload, and the
  // payload is the session id. So one call covers both "open" and "focus".
  const openChat = useCallback(
    (session: Session) => {
      focusSession(session.id);
      const { title, detail } = chatWindowLabel(session, shell.projects);
      open("chat", session.id, title, detail);
    },
    [focusSession, open, shell.projects],
  );
  openChatRef.current = openChat;

  // Stopping and deleting is server-side (session-supervisor); the window
  // showing it is purely local state, so it has to be dismissed here too or
  // it would keep pointing at a session that no longer exists.
  const onDeleteSession = useCallback(
    (id: string) => {
      const win = windows.find((w) => w.kind === "chat" && w.payload === id);
      if (win) close(win.id);
      deleteSession(id);
    },
    [windows, close, deleteSession],
  );

  // Every session a stop would actually reach, read once: the settings sweep
  // fires on it and the button's own count comes off the same list, so the
  // number the operator reads is the number that gets interrupted.
  const stoppable = useMemo(() => stoppableSessions(sessions), [sessions]);
  const onStopAllSessions = useCallback(() => {
    for (const session of stoppable) stopSession(session.id);
  }, [stoppable, stopSession]);

  // One pass over the projects instead of a linear find per session. The sweep
  // still re-runs whenever a status light repaints a project object, but
  // `retitle` bails out when the text is unchanged, so a redundant pass costs a
  // few map lookups and schedules no render.
  const chatLabels = useMemo(() => {
    const names = new Map(shell.projects.map((p) => [p.id, p.name]));
    return sessions.map((session) => ({
      id: session.id,
      title: session.name,
      detail: names.get(session.projectId),
    }));
  }, [sessions, shell.projects]);

  useEffect(() => {
    for (const label of chatLabels)
      retitle("chat", label.id, label.title, label.detail);
  }, [retitle, chatLabels]);

  const activeProject = shell.activeProject;
  const startChat = useCallback(() => {
    startSession(activeProject);
  }, [activeProject, startSession]);

  // The panel is the active project's sessions; the sessions window is where
  // every project's are listed together.
  const projectSessions = useMemo(
    () => sessions.filter((session) => session.projectId === activeProject?.id),
    [sessions, activeProject?.id],
  );
  const projectActive =
    projectSessions.find((session) => session.id === activeSessionId) ??
    projectSessions.at(-1);

  const submitPrompt = useCallback(
    (input: string) => {
      if (submitCommand(input)) return;
      if (projectActive) {
        sendChat(projectActive.id, input);
        openChat(projectActive);
        return;
      }
      const session = startSession(activeProject);
      sendChat(session.id, input);
    },
    [
      activeProject,
      openChat,
      projectActive,
      sendChat,
      startSession,
      submitCommand,
    ],
  );

  const openSessionContext = useCallback(
    (sessionId?: string) => {
      const id = sessionId ?? activeSessionId;
      open("context", id);
    },
    [activeSessionId, open],
  );

  const openHelp = useCallback(() => open("help"), [open]);
  const openChangelog = useCallback(() => open("changelog"), [open]);

  // Workspace whose loop run the operator is being asked to take over, and the
  // one-shot flag the next loop console consumes once they say yes.
  const [loopTakeoverFor, setLoopTakeoverFor] = useState<string | null>(null);
  const [loopTakeover, setLoopTakeover] = useState(false);
  const loopConsoleOpen = windows.some(
    (w) => w.kind === "console" && w.payload === "loop",
  );

  // Clear the flag once the console that consumes it has mounted. Effects run
  // after that mount, and ConsoleTerminal latches the value in a ref, so the
  // run it started keeps its take-over while the next one starts clean.
  useEffect(() => {
    if (loopConsoleOpen && loopTakeover) setLoopTakeover(false);
  }, [loopConsoleOpen, loopTakeover]);

  /**
   * A loop row does not open a chat: that session belongs to a live
   * interactive PTY, and resuming it would put a second CLI on one transcript.
   * If this tab already has the console, raise it. Otherwise the run is
   * attached somewhere this tab cannot reach — another tab, or a host terminal
   * — and the only way to get it here is to end it and start again, which is a
   * decision rather than a click.
   */
  const openLoopSession = useCallback(
    (session: Session) => {
      const name = session.loopWorkspace ?? wizard.activeProjectPath ?? "";
      if (loopConsoleOpen) {
        // The server already named this row `loop · <ws>`; reusing it means
        // the tab and the row cannot disagree.
        open("console", "loop", session.name);
        return;
      }
      setLoopTakeoverFor(name);
    },
    [loopConsoleOpen, open, wizard.activeProjectPath],
  );

  /** Every list of sessions routes through here: a loop row goes to its
   * console, anything else opens as a conversation. */
  const openSessionRow = useCallback(
    (session: Session) => {
      if (session.origin === "loop") {
        openLoopSession(session);
        return;
      }
      openChat(session);
    },
    [openLoopSession, openChat],
  );

  const confirmLoopTakeover = useCallback(() => {
    const name = loopTakeoverFor;
    setLoopTakeoverFor(null);
    if (name === null) return;
    setLoopTakeover(true);
    open("console", "loop", `loop · ${name}`);
  }, [loopTakeoverFor, open]);

  const deciding = wizard.reset === "confirm" || loopTakeoverFor !== null;

  useShellKeyboard({
    blocked: deciding,
    settingsOpen,
    windowCount: windows.length,
    openSessionControl: activeOpenSessionControl,
    promptFocused: prompt.focused,
    sessionOptionKeys: SESSION_CONTROL_KEYS,
    sessionControlsAvailable: focusedChat !== undefined,
    closeSettings,
    closeTopWindow: closeTop,
    closeSessionControl,
    blurPrompt: prompt.blur,
    toggleSessionControl: toggleActiveSessionControl,
    openSessionContext: () => openSessionContext(),
    focusPrompt,
    toggleProjects,
    toggleSettings,
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
  const attachedProviderId = wizard.attachedProviderId;
  const wizardStartLogin = wizard.startLogin;
  const startLogin = useCallback(() => {
    closeSettings();
    open("providers");
    if (attachedProviderId !== undefined) wizardStartLogin(attachedProviderId);
  }, [attachedProviderId, closeSettings, open, wizardStartLogin]);

  // The goodbye is a headline and nothing else — including the operations
  // window that just finished reporting the wipe.
  useEffect(() => {
    if (wizard.reset === "goodbye") closeAll();
  }, [wizard.reset, closeAll]);

  const followSignal = useCallback(
    (signal: Signal) => {
      switch (signal.target.kind) {
        case "window":
          // A signal pointing at a chat window is pointing at a specific
          // session — raise it the same way every other route into a chat
          // window does, so the sidebar's active-session state stays honest.
          if (signal.target.window === "chat" && signal.target.payload) {
            focusSession(signal.target.payload);
          }
          open(signal.target.window, signal.target.payload);
          return;
        case "settings":
          openSettings();
          return;
        case "selector":
          openProjectSelector();
          return;
        case "session":
          startChat();
          return;
        case "login":
          startLogin();
          return;
        case "restart":
          location.reload();
          return;
      }
    },
    [open, openProjectSelector, openSettings, startChat, startLogin, focusSession],
  );

  return (
    <>
      {/* `inert` rather than a scrim alone: a covering layer stops the mouse
          and nothing else, and the field behind a decision must not be
          reachable by Tab either. */}
      <div className="field" inert={deciding}>
        {shell.furniture.projectPanel && (
          <ProjectPanel
            projects={shell.projects}
            active={shell.activeProject}
            open={projectsOpen}
            onToggle={toggleProjects}
            onSelect={(project) => {
              if (project.path !== shell.activeProject?.path) {
                // Console PTY is bound to the cwd it opened in; closing is
                // honest — a silent swap would strand the operator.
                closeKind("console");
                // A session window is scoped to the project its session runs
                // in the same way — left open across a switch it reads as
                // live when the checkout behind it is no longer in view.
                // Closes every chat window outside the target project, not
                // just the one being left, so windows stranded open by a
                // prior switch get swept up too.
                const targetIds = new Set(
                  sessions
                    .filter((session) => session.projectId === project.id)
                    .map((session) => session.id),
                );
                closeWhere(
                  (w) =>
                    w.kind === "chat" && !targetIds.has(String(w.payload ?? "")),
                );
                const last = [...sessions]
                  .reverse()
                  .find((session) => session.projectId === project.id);
                if (last) focusSession(last.id);
              }
              wizard.selectProject(project.path);
            }}
            onCreate={() => open("projectCreate")}
            onManage={(project) =>
              open("project", project.path, undefined, project.name)
            }
          />
        )}

        {shell.furniture.activeProject && (
          <ActiveProject
            project={shell.activeProject}
            onPick={openProjectSelector}
            // No payload: `openWindow` targets whatever is active, the same
            // path the readout is describing.
            onOpen={() => openWindow("project")}
          />
        )}

        {shell.furniture.clock && <Clock onOpenSettings={openSettings} />}

        <OverseerSpace
          signals={shell.signals}
          headline={shell.headline}
          loading={shell.loading}
          typingChance={shell.typingChance}
          holdCaret={shell.holdCaret}
          onGoodbyeClick={shell.onGoodbyeClick}
          onFollow={followSignal}
          onSubmitName={
            shell.askingName ? wizard.submitOperatorName : undefined
          }
          namePrefix={shell.namePrefix}
          onSubmitTone={
            shell.pickingTone ? wizard.submitOperatorTone : undefined
          }
          selectedTone={wizard.personality.tone ?? "neutral"}
          onHeadlineReady={wizard.onHeadlineReady}
        />

        {/* Gated with the prompt: both need an attached, signed-in provider,
            and a session list you cannot start a session from is furniture
            that does nothing. */}
        {shell.furniture.prompt && (
          <SessionPanel
            sessions={projectSessions}
            activeId={projectActive?.id}
            open={sessionsOpen}
            onToggle={toggleSessions}
            onSelect={openSessionRow}
            onNew={startChat}
            onStop={stopSession}
            onDelete={onDeleteSession}
          />
        )}

        <PromptChrome
          promptVisible={shell.furniture.prompt}
          footerVisible={shell.furniture.footer}
          promptFocused={prompt.focused}
          rightInstrument={
            shell.furniture.providerWidget ? (
              <ProviderWidget
                provider={shell.provider}
                usageCheck={usageCheck}
                onOpenProviders={() => open("providers")}
                onOpenConsole={() => open("console")}
              />
            ) : undefined
          }
          onPromptFocus={focusPrompt}
          onPromptBlur={prompt.blur}
          onPromptSubmit={submitPrompt}
          onOpenHelp={openHelp}
          onOpenChangelog={openChangelog}
        />

        <WindowStackHost
          windows={windows}
          wizard={wizard}
          projects={shell.projects}
          activeProject={shell.activeProject}
          provider={shell.provider}
          theme={wizard.theme}
          sessions={sessions}
          openWindow={open}
          closeWindow={close}
          raiseWindow={raise}
          moveWindow={move}
          resizeWindow={resize}
          openChat={openChat}
          startChat={startChat}
          chatFor={chatFor}
          sendChat={sendChat}
          onDeleteSession={onDeleteSession}
          onStopSession={stopSession}
          onResolveApproval={resolveApproval}
          plans={plans}
          plansError={plansError}
          onOpenPlanSession={openPlanSession}
          onImplementPlan={implementPlan}
          onSetPlanStatus={setPlanStatus}
          sessionOptions={sessionOptions}
          subagents={subagents}
          skills={skills}
          armedSession={armedSession}
          openSessionControls={openSessionControls}
          onToggleSessionControl={toggleSessionControl}
          onSelectSessionControl={selectSessionControl}
          onOpenSessionContext={openSessionContext}
          send={wizard.send}
          subscribeConsole={wizard.subscribeConsole}
          subscribeSession={wizard.subscribeSession}
          loopTakeover={loopTakeover}
          onOpenLoopSession={openLoopSession}
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
          onOpenCapabilities={() => {
            open("capabilities");
            closeSettings();
          }}
          onOpenGitConfig={() => {
            open("gitConfig");
            closeSettings();
          }}
          onStartLogin={startLogin}
          onSignOut={() => {
            if (shell.provider.name) wizard.signOut(shell.provider.name);
          }}
          onStopAllSessions={onStopAllSessions}
          stoppableCount={stoppable.length}
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
            the loop on {loopTakeoverFor} is running in another terminal or
            tab. this ends that run — including whatever request it is part way
            through — and starts a new one here.
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
