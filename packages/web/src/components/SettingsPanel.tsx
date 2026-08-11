import { useEffect } from "react";
import { WInline, WTitle } from "./windows/bits";
import { CloseIcon } from "./icons";
import { StatusLight } from "./StatusLight";

/**
 * Slides in from the right edge off the gear beside the clock. Settings are not
 * a window: they are not summoned into the field, they are not draggable, and
 * only one can be open — they belong to the machine, not to the work
 * (design-system.md §6).
 */
export function SettingsPanel({
  open,
  theme,
  adapter,
  onClose,
  onToggleTheme,
  onOpenCapabilities,
}: {
  open: boolean;
  theme: "machine" | "samaritan";
  adapter: {
    name: string;
    version: string;
    authenticated: boolean;
    usage: number;
    spend: string;
  };
  onClose: () => void;
  onToggleTheme: () => void;
  onOpenCapabilities: () => void;
}) {
  // The panel overlays the right-hand widgets, so it must not be left open by accident.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // There are only two themes, so picking the one already active is a no-op —
  // the toggle only needs to fire when the choice actually changes.
  function selectTheme(target: "machine" | "samaritan") {
    if (target !== theme) onToggleTheme();
  }

  return (
    // `inert` rather than `aria-hidden`: the panel is always mounted so it can
    // slide, and its buttons must not be tabbable while it is off-screen.
    <aside className={`panel ${open ? "open" : ""}`} inert={!open}>
      <header className="panel-head">
        <span className="panel-title">
          <span style={{ color: "var(--accent-fill)" }}>▽</span> system
        </span>
        <button
          className="icon-btn"
          onClick={onClose}
          aria-label="close settings"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="panel-body">
        <WTitle>auth</WTitle>
        <WInline
          label="subscription"
          value={
            <span className="w-inline-flex">
              <StatusLight
                activity={adapter.authenticated ? "done" : "waiting"}
              />
              {adapter.authenticated ? "signed in" : "not signed in"}
            </span>
          }
        />
        <div className="btn-row">
          <button className="w-btn">
            {adapter.authenticated ? "sign out" : "start login"}
          </button>
          <button className="w-btn">use api key</button>
        </div>

        <WTitle>runtime</WTitle>
        <WInline label="adapter" value={adapter.name} />
        <WInline label="cli version" value={adapter.version} />
        <WInline label="spend this window" value={adapter.spend} />
        <WInline
          label="plan window used"
          value={`${Math.round(adapter.usage * 100)}%`}
        />

        <WTitle>workspace</WTitle>
        <WInline label="root" value="/work" />
        <WInline label="staging" value="/work/_overseer/import" />
        <div className="btn-row">
          <button className="w-btn">rescan projects</button>
          <button className="w-btn">import</button>
          <button className="w-btn">doctor</button>
        </div>

        <WTitle>capabilities</WTitle>
        <p className="panel-note">
          mcp servers, skills and subagents available to every session.
        </p>
        <div className="btn-row">
          <button className="w-btn" onClick={onOpenCapabilities}>
            open capabilities
          </button>
        </div>

        <WTitle>appearance</WTitle>
        <WInline
          label="theme"
          value={
            // A span, not a div: WInline's value slot is a <span>, and a block
            // element inside it would be invalid nesting.
            <span className="btn-row inline">
              <button
                className="w-btn"
                onClick={() => selectTheme("samaritan")}
              >
                <span className="w-btn-mark">
                  {theme === "samaritan" ? "▪" : ""}
                </span>
                samaritan
              </button>
              <button className="w-btn" onClick={() => selectTheme("machine")}>
                <span className="w-btn-mark">
                  {theme === "machine" ? "▪" : ""}
                </span>
                machine
              </button>
            </span>
          }
        />

        <WTitle>danger</WTitle>
        <div className="btn-row">
          <button className="w-btn danger">stop all sessions</button>
          <button className="w-btn danger">reset local state</button>
        </div>
      </div>
    </aside>
  );
}
