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
import { OverseerWindow } from "./components/windows/OverseerWindow";
import { useWindows } from "./state/useWindows";
import { deriveSignals, headlineFor, type Signal } from "./state/signals";
import { useDiscovery } from "./state/useDiscovery";
import {
  furnitureFor,
  isLoading,
  projectsFor,
  wizardHeadline,
} from "./state/wizard";
import { matchCommand } from "./commands";
import type { PromptOptionKey, PromptSettings } from "./prompt";
// Fixtures, and only for windows outside the overseer's path: the sessions,
// approvals, capabilities-detail, context, console and diff windows are still
// design-development surfaces with their own issues (#3 non-goals). The
// overseer's own inputs — headline, signals, wizard state, the operations
// window — come from the server and never from here; see the `signals` memo.
import {
  mockApprovals,
  mockCapabilities,
  mockContextFiles,
  mockPromptOptions,
  mockPromptSettings,
  mockSessions,
  mockTranscript,
} from "./data/mock";
import type { Project, Turn } from "./domain";

/** Module-level so the identity is stable: a fresh [] every render would churn
 * OverseerSpace's ranking work on every boot frame. */
const EMPTY_SIGNALS: Signal[] = [];

export default function App() {
  // Samaritan is the reference theme and the default; machine is its opposite.
  const [theme, setTheme] = useState<"machine" | "samaritan">("samaritan");
  // The wizard owns the boot sequence and everything discovery learned. One
  // state machine decides which furniture is mounted, what the headline says
  // and what the operations window shows, rather than three sets of
  // conditionals in here drifting apart (docs/overseer.md §4).
  const wizard = useDiscovery();
  const furniture = furnitureFor(wizard);
  const projects = useMemo(() => projectsFor(wizard), [wizard]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  // Defaults to the first discovered project, but an explicit pick wins — so
  // discovery completing cannot yank the selection out from under the operator.
  const activeProject: Project | undefined =
    projects.find((p) => p.path === selectedPath) ?? projects[0];
  // The project panel is furniture, not an overlay: it starts open and stays open.
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptSettings, setPromptSettings] =
    useState<PromptSettings>(mockPromptSettings);
  const [openControl, setOpenControl] = useState<PromptOptionKey | null>(null);
  const [approvals, setApprovals] = useState(mockApprovals);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const { windows, open, close, closeTop, closeAll, raise, move } =
    useWindows();

  // The adapter widget reads out whatever discovery found — including finding
  // nothing, which is why it mounts on a bad result too. Usage and spend stay
  // empty: no adapter has reported them and a plausible 0% is still invented.
  const adapter = useMemo(() => {
    const authenticated = wizard.adapters.find((a) => a.status.authenticated);
    const reported = authenticated ?? wizard.adapters[0];
    return {
      name: reported?.id ?? "",
      version: reported?.status.version ?? "",
      authenticated: reported?.status.authenticated ?? false,
      usage: 0,
      spend: "",
      context: "",
    };
  }, [wizard.adapters]);

  // Where the agent's files live is a deployment fact the server owns, so it is
  // blank until discovery reports it rather than assumed to be "/workspace".
  const workspace = useMemo(
    () => ({
      root: wizard.workspaceRoot ?? "",
      staging: wizard.workspaceRoot ? `${wizard.workspaceRoot}/_overseer/import` : "",
    }),
    [wizard.workspaceRoot],
  );

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "machine" ? "samaritan" : "machine"));
  }, []);

  // The field gradient lives on <body>, so the theme has to be set on the root
  // element — scoping it to a div leaves the background on the old palette.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  /**
   * Every input here is real server state or an honest empty. Sessions,
   * approvals and capabilities are empty because this build has no session
   * supervisor and discovers no capabilities yet — that is the true answer, and
   * feeding the fixtures in would make the overseer report a machine that does
   * not exist. The windows those signals point at may still be fixture-backed
   * (#3 non-goals); the signals themselves may not be.
   *
   * The derivation itself runs throughout — the empty-instance signals ("no
   * project selected", "no adapter is attached") are these same rules doing
   * their job, not a special case. What is gated is only when the list becomes
   * *visible*: see `visibleSignals` below.
   */
  const signals = useMemo(
    () =>
      deriveSignals({
        projects,
        activeProject,
        sessions: [],
        approvals: [],
        capabilities: [],
        adapter,
        busy,
        rejected: wizard.rejected,
      }),
    [projects, activeProject, adapter, busy, wizard.rejected],
  );

  /**
   * Signals stay hidden until discovery has actually run. Derived from an empty
   * wizard state they are all true in form and premature in substance: "no
   * project selected" on the first frame reads as a finding about the machine,
   * when the machine has not been looked at yet. The headline and the
   * operations window are what carry the boot screen; the ranked list below
   * them arrives with the rest of the furniture.
   */
  const visibleSignals = furniture.signals ? signals : EMPTY_SIGNALS;

  // The wizard speaks only while it is running, and hands the headline back to
  // ordinary derivation the moment it settles — so a greeting can never end up
  // shadowing a real state word.
  const wizardWord = wizardHeadline(wizard);
  const derived = headlineFor(signals, busy);
  const headline = wizardWord
    ? { text: wizardWord, activity: "working" as const }
    : derived;
  // The wizard's own words always type out. Typing is normally a rare tell that
  // something is watching, but during boot it is the only thing on screen doing
  // anything — leaving it to a ~15% roll means most boots show the greeting
  // simply appearing. Scoped to the wizard: once it hands back to `derived`,
  // personality (or useOccasionalTyping's default) governs again.
  const typingChance = wizardWord ? 1 : wizard.personality.typingChance;

  // The operations window is the one window the machine summons (§3). Keyed on
  // the phase transition, so dismissing it mid-pass does not bring it back —
  // an operator who closed it has seen enough, and anything that genuinely
  // needs them becomes a signal instead.
  useEffect(() => {
    // Gated on the connection too, so a boot still waiting on the socket does
    // not summon an empty window to watch. The headline is already saying what
    // is going on; a frame with no steps in it would add nothing.
    if (wizard.phase === "discovery" && wizard.connected) open("overseer");
  }, [wizard.phase, wizard.connected, open]);

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
        if (index >= 1 && index <= mockPromptOptions.length) {
          e.preventDefault();
          toggleControl(mockPromptOptions[index - 1].key);
          return;
        }
        if (index === mockPromptOptions.length + 1) {
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
    // Outside the wireframe fixtures there is no canned transcript, so the turn
    // goes nowhere — replacing here would swallow what the operator typed.
    setTimeout(() => {
      if (mockTranscript.length > 0) setTurns(mockTranscript);
      setBusy(false);
    }, 1200);
  }

  function inspectTurn(id: string) {
    const turn = turns.find((t) => t.id === id);
    if (turn?.kind === "tool") open("diff", turn.target, turn.tool);
  }

  return (
    <div className="field">
      {/* Furniture mounts as each capability becomes knowable, not as it
          becomes good — a panel reading "none" is the honest answer, and the
          rule for which piece appears when lives in wizard.ts, not here. */}
      {furniture.projectPanel && (
        <>
          <ProjectPanel
            projects={projects}
            active={activeProject}
            open={projectsOpen}
            onToggle={() => setProjectsOpen((v) => !v)}
            onSelect={(project) => {
              setSelectedPath(project.path);
              setTurns([]);
            }}
          />

          <ActiveProject
            project={activeProject}
            onPick={() => setProjectsOpen(true)}
          />
        </>
      )}

      {furniture.clock && <Clock onOpenSettings={() => setSettingsOpen(true)} />}

      <OverseerSpace
        signals={visibleSignals}
        headline={headline}
        busy={busy}
        loading={isLoading(wizard)}
        typingChance={typingChance}
        onFollow={follow}
      />

      {/* The prompt is a control, not a readout: without an authenticated
          adapter there is nowhere to send a turn, so it stays unmounted rather
          than mounting broken. */}
      {furniture.prompt && (
        <PromptControls
          options={mockPromptOptions}
          settings={promptSettings}
          openKey={openControl}
          contextCount={mockContextFiles.length}
          onToggle={toggleControl}
          onSelect={selectControl}
          onOpenContext={() => open("context")}
        />
      )}

      {furniture.adapterWidget && (
        <AdapterWidget
          adapter={adapter}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      <div className="dock">
        {furniture.prompt && (
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
        )}
        {furniture.footer && (
          <p className="footer settles-in">
            overseer v{import.meta.env.VITE_APP_VERSION} | ask for{" "}
            <span style={{ color: "var(--accent)" }}>help</span> |{" "}
            <button className="footer-link" onClick={() => open("console")}>
              open <span style={{ color: "var(--ok)" }}>console</span>
            </button>
          </p>
        )}
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
          {w.kind === "overseer" && <OverseerWindow steps={wizard.steps} />}
          {w.kind === "sessions" && (
            <SessionsWindow
              sessions={mockSessions}
              projects={projects}
              adapter={adapter}
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
              adapter={adapter}
              onResolve={(id) =>
                setApprovals((current) => current.filter((a) => a.id !== id))
              }
            />
          )}
          {w.kind === "capabilities" && (
            <CapabilitiesWindow
              capabilities={mockCapabilities}
              adapter={adapter}
              onEdit={(name) => open("capability", name, name)}
            />
          )}
          {w.kind === "capability" && (
            <CapabilityWindow name={String(w.payload ?? "")} />
          )}
          {w.kind === "context" && (
            <ContextWindow
              projectName={activeProject?.name}
              adapter={adapter}
            />
          )}
          {w.kind === "console" && <ConsoleWindow adapter={adapter} />}
          {w.kind === "help" && <HelpWindow adapter={adapter} />}
          {w.kind === "diff" && <DiffWindow target={String(w.payload ?? "")} />}
        </Window>
      ))}

      <SettingsPanel
        open={settingsOpen}
        theme={theme}
        adapter={adapter}
        workspace={workspace}
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
