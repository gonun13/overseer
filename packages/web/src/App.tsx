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
import type { Session } from "./domain";
import { SESSION_CONTROL_KEYS, type SessionOptionKey } from "./session";
import type { Signal } from "./state/signals";
import { useChatSessions } from "./state/useChatSessions";
import { useDiscovery } from "./state/useDiscovery";
import { usePromptSession } from "./state/usePromptSession";
import { useProviderOptions } from "./state/useProviderOptions";
import { useShellKeyboard } from "./state/useShellKeyboard";
import { useShellPresentation } from "./state/useShellPresentation";
import { useWindows } from "./state/useWindows";

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

  const prompt = usePromptSession({
    openWindow: open,
    closeAllWindows: closeAll,
    openSettings,
    openProjectSelector,
    toggleTheme,
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

  const {
    sessions,
    activeId: activeSessionId,
    start: startSession,
    focus: focusSession,
    setSessionSetting,
    chatFor,
    send: sendChat,
    deleteSession,
  } = useChatSessions(
    wizard.send,
    wizard.subscribeSession,
    (session) => openChatRef.current(session),
    armedSession,
  );
  const sessionBusy = sessions.some(
    (session) => session.activity === "working",
  );
  const shell = useShellPresentation(wizard, sessionBusy, open, sessions);

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
      setSessionSetting(sessionId, key, value);
      // The adapter has no runtime setter for model or mode, so a pick cannot
      // retarget the session that is already running. It arms the next one.
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
      open("chat", session.id, session.name);
    },
    [focusSession, open],
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

  useEffect(() => {
    for (const session of sessions) {
      retitle("chat", session.id, session.name);
    }
  }, [retitle, sessions]);

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

  const deciding = wizard.reset === "confirm";

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
    [open, openProjectSelector, openSettings, startChat, startLogin],
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
                const last = [...sessions]
                  .reverse()
                  .find((session) => session.projectId === project.id);
                if (last) focusSession(last.id);
              }
              wizard.selectProject(project.path);
            }}
          />
        )}

        {shell.furniture.activeProject && (
          <ActiveProject
            project={shell.activeProject}
            onPick={openProjectSelector}
          />
        )}

        {shell.furniture.clock && <Clock onOpenSettings={openSettings} />}

        <OverseerSpace
          signals={shell.signals}
          headline={shell.headline}
          busy={sessionBusy}
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
            onSelect={openChat}
            onNew={startChat}
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
                onOpenProviders={() => open("providers")}
                onOpenConsole={() => open("console")}
              />
            ) : undefined
          }
          onPromptFocus={focusPrompt}
          onPromptBlur={prompt.blur}
          onPromptSubmit={submitPrompt}
          onOpenHelp={openHelp}
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
          sessionOptions={sessionOptions}
          armedSession={armedSession}
          openSessionControls={openSessionControls}
          onToggleSessionControl={toggleSessionControl}
          onSelectSessionControl={selectSessionControl}
          onOpenSessionContext={openSessionContext}
          send={wizard.send}
          subscribeConsole={wizard.subscribeConsole}
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
          onStartLogin={startLogin}
          onSignOut={() => {
            if (shell.provider.name) wizard.signOut(shell.provider.name);
          }}
          onResetOverseer={startReset}
        />
      </div>

      {deciding && (
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
