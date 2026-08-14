import { useCallback, useEffect, useState } from "react";
import { ActiveProject } from "./components/ActiveProject";
import { Clock } from "./components/Clock";
import { DecisionWindow } from "./components/DecisionWindow";
import { OverseerSpace } from "./components/OverseerSpace";
import { ProjectPanel } from "./components/ProjectPanel";
import { PromptSessionChrome } from "./components/PromptSessionChrome";
import { ProviderWidget } from "./components/ProviderWidget";
import { SettingsPanel } from "./components/SettingsPanel";
import { WindowStackHost } from "./components/WindowStackHost";
import { mockContextFiles, mockPromptOptions } from "./data/mock";
import type { Signal } from "./state/signals";
import { useDiscovery } from "./state/useDiscovery";
import { usePromptSession } from "./state/usePromptSession";
import { useShellKeyboard } from "./state/useShellKeyboard";
import { useShellPresentation } from "./state/useShellPresentation";
import { useWindows } from "./state/useWindows";

const PROMPT_OPTION_KEYS = mockPromptOptions.map((option) => option.key);

export default function App() {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wizard = useDiscovery();
  const { windows, open, close, closeTop, closeAll, raise, move } =
    useWindows();

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

  const prompt = usePromptSession({
    openWindow: open,
    closeAllWindows: closeAll,
    openSettings,
    openProjectSelector,
    toggleTheme,
  });
  const openPrompt = prompt.expand;
  const shell = useShellPresentation(wizard, prompt.busy, open);

  const openContext = useCallback(() => open("context"), [open]);
  const openHelp = useCallback(() => open("help"), [open]);

  const deciding = wizard.reset === "confirm";

  useShellKeyboard({
    blocked: deciding,
    settingsOpen,
    windowCount: windows.length,
    openControl: prompt.openControl,
    promptOpen: prompt.open,
    promptOptionKeys: PROMPT_OPTION_KEYS,
    closeSettings,
    closeTopWindow: closeTop,
    closeControl: prompt.closeControl,
    closePrompt: prompt.collapse,
    toggleControl: prompt.toggleControl,
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

        <PromptSessionChrome
          promptVisible={shell.furniture.prompt}
          footerVisible={shell.furniture.footer}
          expanded={prompt.open}
          turns={prompt.turns}
          busy={prompt.busy}
          settings={prompt.settings}
          options={mockPromptOptions}
          openControl={prompt.openControl}
          contextCount={mockContextFiles.length}
          projectName={shell.activeProject?.name}
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
          onCollapse={prompt.collapse}
          onSubmit={prompt.submit}
          onInspect={prompt.inspectTurn}
          onToggleControl={prompt.toggleControl}
          onSelectControl={prompt.selectControl}
          onOpenContext={openContext}
          onOpenHelp={openHelp}
        />

        <WindowStackHost
          windows={windows}
          wizard={wizard}
          projects={shell.projects}
          activeProject={shell.activeProject}
          provider={shell.provider}
          openWindow={open}
          closeWindow={close}
          raiseWindow={raise}
          moveWindow={move}
          openProjectSelector={openProjectSelector}
          openTranscript={prompt.loadTranscript}
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
