import { useCallback, useEffect, useState } from "react";
import { ActiveProject } from "./components/ActiveProject";
import { AdapterWidget } from "./components/AdapterWidget";
import { Clock } from "./components/Clock";
import { OverseerSpace } from "./components/OverseerSpace";
import { ProjectPanel } from "./components/ProjectPanel";
import { PromptSessionChrome } from "./components/PromptSessionChrome";
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

  useShellKeyboard({
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
        case "restart":
          location.reload();
          return;
      }
    },
    [open, openProjectSelector, openPrompt, openSettings],
  );

  return (
    <div className="field">
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
          shell.furniture.adapterWidget ? (
            <AdapterWidget
              adapter={shell.adapter}
              onOpenAdapters={() => open("adapters")}
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
        adapter={shell.adapter}
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
        adapter={shell.adapter}
        workspace={shell.workspace}
        onClose={closeSettings}
        onSelectTheme={selectTheme}
        onOpenCapabilities={() => {
          open("capabilities");
          closeSettings();
        }}
        onStartLogin={() => {
          closeSettings();
          open("adapters");
        }}
      />
    </div>
  );
}
