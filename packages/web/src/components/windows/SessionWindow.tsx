import { useState } from "react";
import { Composer } from "../Composer";
import { SessionControls } from "../SessionControls";
import { Transcript } from "../Transcript";
import type { Turn } from "../../domain";
import type {
  SessionOption,
  SessionOptionKey,
  SessionSettings,
} from "../../session";

/**
 * One conversation in its own frame: transcript, composer, then session
 * controls along the bottom — scoped to a single session so several can be
 * open, dragged, resized and closed independently.
 *
 * Model, mode, agent and context live here — they arm the *next* turn of this
 * session, not the prompt terminal. The terminal can still reach them through
 * keys and commands, but the bar is part of the window.
 *
 * Unlike the prompt terminal it does not split into the page/surface materials:
 * everything here sits on the window's own ground, and the composer is marked
 * out by an accent outline instead (see `.session-window` in index.css).
 *
 * The frame, the tab and the close are the ordinary Window primitive's; this is
 * only what goes inside it.
 */
export function SessionWindow({
  turns,
  busy,
  settings,
  options,
  openSessionControl,
  contextCount,
  onToggleSessionControl,
  onSelectSessionControl,
  onOpenSessionContext,
  onSubmit,
  onInspect,
}: {
  turns: Turn[];
  busy: boolean;
  settings: SessionSettings;
  options: SessionOption[];
  openSessionControl: SessionOptionKey | null;
  contextCount: number;
  onToggleSessionControl: (key: SessionOptionKey) => void;
  onSelectSessionControl: (key: SessionOptionKey, value: string) => void;
  onOpenSessionContext: () => void;
  onSubmit: (input: string) => void;
  onInspect: (id: string) => void;
}) {
  const [value, setValue] = useState("");

  const armed = [
    settings.model,
    settings.mode,
    settings.agent === "default" ? "" : settings.agent,
  ]
    .filter(Boolean)
    .join(" · ");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="session-window">
      <div className="transcript-panel">
        {turns.length === 0 ? (
          <p className="session-empty">nothing said yet</p>
        ) : (
          <Transcript turns={turns} onInspect={onInspect} />
        )}
      </div>

      <Composer
        value={value}
        placeholder="Ask, or describe the change you want."
        onChange={setValue}
        onSubmit={submit}
        meta={
          armed || busy ? (
            <>
              {armed && <span>{armed}</span>}
              {busy ? (
                <span>turn in flight</span>
              ) : (
                <span>enter to send · shift+enter for a newline</span>
              )}
            </>
          ) : (
            <span>enter to send · shift+enter for a newline</span>
          )
        }
      />

      <SessionControls
        options={options}
        settings={settings}
        openKey={openSessionControl}
        contextCount={contextCount}
        onToggle={onToggleSessionControl}
        onSelect={onSelectSessionControl}
        onOpenContext={onOpenSessionContext}
      />
    </div>
  );
}
