import { useCallback, useEffect, useMemo, useState } from "react";
import { ActiveProject } from "./components/ActiveProject";
import { Clock } from "./components/Clock";
import { DecisionWindow } from "./components/DecisionWindow";
import { OverseerSpace } from "./components/OverseerSpace";
import { ProjectPanel } from "./components/ProjectPanel";
import { PromptSessionChrome } from "./components/PromptSessionChrome";
import { ProviderWidget } from "./components/ProviderWidget";
import { SessionPanel } from "./components/SessionPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { WindowStackHost } from "./components/WindowStackHost";
import type { Session } from "./domain";
import { BLANK_PROMPT_SETTINGS, type PromptOptionKey } from "./prompt";
import type { Signal } from "./state/signals";
import { useChatSessions } from "./state/useChatSessions";
import { useDiscovery } from "./state/useDiscovery";
import { usePromptSession } from "./state/usePromptSession";
import { useShellKeyboard } from "./state/useShellKeyboard";
import { useShellPresentation } from "./state/useShellPresentation";
import { useWindows } from "./state/useWindows";

const PROMPT_OPTION_KEYS: PromptOptionKey[] = [];

export default function App() {
  const [projectsOpen, setProjectsOpen] = useState(true);
  // Closed by default: the collapsed header already reports the session in
  // hand, and the list is only needed when switching between several.
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wizard = useDiscovery();
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
  const openPrompt = prompt.expand;
  const shell = useShellPresentation(wizard, prompt.busy, open);

  const {
    sessions,
    activeId: activeSessionId,
    start: startSession,
    focus: focusSession,
    setSetting,
    chatFor,
    send: sendChat,
  } = useChatSessions();

  // The bottom-left menu arms a *session* — which model, which permission mode,
  // which subagent the next turn runs as — so it reads and writes the focused
  // conversation, and has nothing to say when there is not one. Only which
  // section is open belongs to the menu itself.
  const [openControl, setOpenControl] = useState<PromptOptionKey | null>(null);
  const focusedChat =
    activeSessionId === undefined ? undefined : chatFor(activeSessionId);

  const closeControl = useCallback(() => setOpenControl(null), []);
  const toggleControl = useCallback((key: PromptOptionKey) => {
    setOpenControl((current) => (current === key ? null : key));
  }, []);
  const focusedSessionId = focusedChat?.session.id;
  const selectControl = useCallback(
    (key: PromptOptionKey, value: string) => {
      if (focusedSessionId !== undefined)
        setSetting(focusedSessionId, key, value);
      setOpenControl(null);
    },
    [focusedSessionId, setSetting],
  );

  // Summoning a chat window that is already up raises it rather than stacking a
  // duplicate — useWindows matches on kind and payload, and the payload is the
  // session id. So one call covers both "open" and "focus".
  const openChat = useCallback(
    (session: Session) => {
      focusSession(session.id);
      open("chat", session.id, session.name);
    },
    [focusSession, open],
  );

  const activeProject = shell.activeProject;
  const startChat = useCallback(() => {
    openChat(startSession(activeProject));
  }, [activeProject, openChat, startSession]);

  // The panel is the active project's sessions; the sessions window is where
  // every project's are listed together.
  const projectSessions = useMemo(
    () => sessions.filter((session) => session.projectId === activeProject?.id),
    [sessions, activeProject?.id],
  );

  const openContext = useCallback(() => open("context"), [open]);
  const openHelp = useCallback(() => open("help"), [open]);

  const deciding = wizard.reset === "confirm";

  useShellKeyboard({
    blocked: deciding,
    settingsOpen,
    windowCount: windows.length,
    openControl,
    promptOpen: prompt.open,
    promptOptionKeys: PROMPT_OPTION_KEYS,
    // The digits open menu sections, so they are only live when the menu is.
    controlsAvailable: focusedChat !== undefined,
    closeSettings,
    closeTopWindow: closeTop,
    closeControl,
    closePrompt: prompt.collapse,
    toggleControl,
    openContext,
    openPrompt,
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
        case "prompt":
          openPrompt();
          return;
        case "login":
          startLogin();
          return;
        case "restart":
          location.reload();
          return;
      }
    },
    [open, openProjectSelector, openPrompt, openSettings, startLogin],
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
              }
              wizard.selectProject(project.path);
              prompt.resetTurns();
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
          busy={prompt.busy}
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
            activeId={activeSessionId}
            open={sessionsOpen}
            onToggle={toggleSessions}
            onSelect={openChat}
            onNew={startChat}
          />
        )}

        <PromptSessionChrome
          promptVisible={shell.furniture.prompt}
          // The menu is the focused session's, not the terminal's: it appears
          // with the first session and goes when there is none to arm.
          controlsVisible={shell.furniture.prompt && focusedChat !== undefined}
          footerVisible={shell.furniture.footer}
          expanded={prompt.open}
          turns={prompt.turns}
          busy={prompt.busy}
          settings={focusedChat?.settings ?? BLANK_PROMPT_SETTINGS}
          options={[]}
          openControl={openControl}
          contextCount={0}
          rightInstrument={
            shell.furniture.providerWidget ? (
              <ProviderWidget
                provider={shell.provider}
                onOpenProviders={() => open("providers")}
                onOpenConsole={() => open("console")}
              />
            ) : undefined
          }
          onExpand={openPrompt}
          onSubmit={prompt.submit}
          onInspect={prompt.inspectTurn}
          onToggleControl={toggleControl}
          onSelectControl={selectControl}
          onOpenContext={openContext}
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
