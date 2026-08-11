import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectPanel } from "./components/ProjectPanel";
import { ActiveProject } from "./components/ActiveProject";
import { Clock } from "./components/Clock";
import { OverseerSpace } from "./components/OverseerSpace";
import { PromptControls } from "./components/PromptControls";
import { AdapterWidget } from "./components/AdapterWidget";
import { Prompt } from "./components/Prompt";
import { SettingsPanel } from "./components/SettingsPanel";
import { Window } from "./components/Window";
import { SessionsWindow } from "./components/windows/SessionsWindow";
import { ApprovalsWindow } from "./components/windows/ApprovalsWindow";
import { CapabilitiesWindow } from "./components/windows/CapabilitiesWindow";
import { CapabilityWindow } from "./components/windows/CapabilityWindow";
import { ConsoleWindow } from "./components/windows/ConsoleWindow";
import { ContextWindow } from "./components/windows/ContextWindow";
import { HelpWindow } from "./components/windows/HelpWindow";
import { DiffWindow } from "./components/windows/DiffWindow";
import { useWindows } from "./state/useWindows";
import { deriveSignals, headlineFor, type Signal } from "./state/signals";
import { matchCommand } from "./commands";
import {
  DEFAULT_PROMPT_SETTINGS,
  PROMPT_OPTIONS,
  type PromptOptionKey,
  type PromptSettings,
} from "./prompt";
import {
  mockAdapter,
  mockApprovals,
  mockCapabilities,
  mockContextFiles,
  mockProjects,
  mockSessions,
  mockTranscript,
  type Project,
  type Turn,
} from "./data/mock";

export default function App() {
  // Samaritan is the reference theme and the default; machine is its opposite.
  const [theme, setTheme] = useState<"machine" | "samaritan">("samaritan");
  const [activeProject, setActiveProject] = useState<Project | undefined>(
    mockProjects[0],
  );
  // The project panel is furniture, not an overlay: it starts open and stays open.
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptSettings, setPromptSettings] = useState<PromptSettings>(
    DEFAULT_PROMPT_SETTINGS,
  );
  const [openControl, setOpenControl] = useState<PromptOptionKey | null>(null);
  const [approvals, setApprovals] = useState(mockApprovals);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const { windows, open, close, closeTop, closeAll, raise, move } =
    useWindows();

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "machine" ? "samaritan" : "machine"));
  }, []);

  // The field gradient lives on <body>, so the theme has to be set on the root
  // element — scoping it to a div leaves the background on the old palette.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const signals = useMemo(
    () =>
      deriveSignals({
        projects: mockProjects,
        activeProject,
        sessions: mockSessions.filter(
          (s) => !activeProject || s.projectId === activeProject.id,
        ),
        approvals,
        capabilities: mockCapabilities,
        adapter: mockAdapter,
        busy,
      }),
    [activeProject, approvals, busy],
  );
  const headline = headlineFor(signals, busy);

  /** Accordion: opening one section closes the others. */
  const toggleControl = useCallback((key: PromptOptionKey) => {
    setOpenControl((current) => (current === key ? null : key));
  }, []);

  const selectControl = useCallback((key: PromptOptionKey, value: string) => {
    setPromptSettings((current) => ({ ...current, [key]: value }));
    setOpenControl(null);
  }, []);

  /** Signals are the primary navigation: each one knows what it wants opened. */
  const follow = useCallback(
    (signal: Signal) => {
      switch (signal.target.kind) {
        case "window":
          open(signal.target.window, signal.target.payload);
          return;
        case "settings":
          setSettingsOpen(true);
          return;
        case "selector":
          setProjectsOpen(true);
          return;
        case "prompt":
          setPromptOpen(true);
          return;
      }
    },
    [open],
  );

  // Esc unwinds the newest layer first. The project panel is not in that chain —
  // it is furniture and only its chevron closes it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else if (windows.length > 0) closeTop();
        else if (openControl) setOpenControl(null);
        else setPromptOpen(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea");

      // Bare digits drive the prompt controls, but only while the prompt is
      // closed — once it is open, every keystroke belongs to what is being typed.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !promptOpen && !typing) {
        const index = Number(e.key);
        if (index >= 1 && index <= PROMPT_OPTIONS.length) {
          e.preventDefault();
          toggleControl(PROMPT_OPTIONS[index - 1].key);
          return;
        }
        if (index === PROMPT_OPTIONS.length + 1) {
          e.preventDefault();
          open("context");
          return;
        }
      }

      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "k") {
        e.preventDefault();
        setPromptOpen(true);
      } else if (e.key === "p") {
        e.preventDefault();
        setProjectsOpen((v) => !v);
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeTop,
    open,
    openControl,
    promptOpen,
    settingsOpen,
    toggleControl,
    windows.length,
  ]);

  function handleSubmit(input: string) {
    const command = matchCommand(input);
    if (command) {
      switch (command.action.type) {
        case "open":
          open(command.action.kind);
          return;
        case "settings":
          setSettingsOpen(true);
          return;
        case "selector":
          setProjectsOpen(true);
          return;
        case "theme":
          toggleTheme();
          return;
        case "close-all":
          closeAll();
          return;
      }
    }

    // Not a command — it's a prompt for the active project's session.
    setTurns((current) => [
      ...current,
      { id: `u${current.length}`, kind: "user", text: input },
    ]);
    setBusy(true);
    // Placeholder for the real stream; replaced when the WS event pipe lands.
    setTimeout(() => {
      setTurns(mockTranscript);
      setBusy(false);
    }, 1200);
  }

  function inspectTurn(id: string) {
    const turn = turns.find((t) => t.id === id);
    if (turn?.kind === "tool") open("diff", turn.target, turn.tool);
  }

  return (
    <div className="field">
      <ProjectPanel
        projects={mockProjects}
        active={activeProject}
        open={projectsOpen}
        onToggle={() => setProjectsOpen((v) => !v)}
        onSelect={(project) => {
          setActiveProject(project);
          setTurns([]);
        }}
      />

      <ActiveProject
        project={activeProject}
        onPick={() => setProjectsOpen(true)}
      />

      <Clock onOpenSettings={() => setSettingsOpen(true)} />

      <OverseerSpace
        signals={signals}
        headline={headline}
        busy={busy}
        onFollow={follow}
      />

      <PromptControls
        settings={promptSettings}
        openKey={openControl}
        contextCount={mockContextFiles.length}
        onToggle={toggleControl}
        onSelect={selectControl}
        onOpenContext={() => open("context")}
      />

      <AdapterWidget
        adapter={mockAdapter}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="dock">
        <Prompt
          expanded={promptOpen}
          turns={turns}
          busy={busy}
          settings={promptSettings}
          projectName={activeProject?.name}
          onExpand={() => setPromptOpen(true)}
          onCollapse={() => setPromptOpen(false)}
          onSubmit={handleSubmit}
          onInspect={inspectTurn}
        />
        <p className="footer">
          overseer v0.1 | ask for{" "}
          <span style={{ color: "var(--accent)" }}>help</span> |{" "}
          <button className="footer-link" onClick={() => open("console")}>
            open <span style={{ color: "var(--ok)" }}>console</span>
          </button>
        </p>
      </div>

      {windows.map((w) => (
        <Window
          key={w.id}
          title={w.title}
          x={w.x}
          y={w.y}
          z={w.z}
          width={w.w}
          onClose={() => close(w.id)}
          onRaise={() => raise(w.id)}
          onMove={(x, y) => move(w.id, x, y)}
        >
          {w.kind === "sessions" && (
            <SessionsWindow
              sessions={mockSessions}
              projects={mockProjects}
              onOpenSession={() => {
                setTurns(mockTranscript);
                setPromptOpen(true);
                close(w.id);
              }}
              onNewSession={() => setProjectsOpen(true)}
            />
          )}
          {w.kind === "approvals" && (
            <ApprovalsWindow
              approvals={approvals}
              onResolve={(id) =>
                setApprovals((current) => current.filter((a) => a.id !== id))
              }
            />
          )}
          {w.kind === "capabilities" && (
            <CapabilitiesWindow
              capabilities={mockCapabilities}
              onEdit={(name) => open("capability", name, name)}
            />
          )}
          {w.kind === "capability" && (
            <CapabilityWindow name={String(w.payload ?? "")} />
          )}
          {w.kind === "context" && (
            <ContextWindow projectName={activeProject?.name} />
          )}
          {w.kind === "console" && <ConsoleWindow adapter={mockAdapter.name} />}
          {w.kind === "help" && <HelpWindow />}
          {w.kind === "diff" && <DiffWindow target={String(w.payload ?? "")} />}
        </Window>
      ))}

      <SettingsPanel
        open={settingsOpen}
        theme={theme}
        adapter={mockAdapter}
        onClose={() => setSettingsOpen(false)}
        onToggleTheme={toggleTheme}
        onOpenCapabilities={() => {
          open("capabilities");
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
