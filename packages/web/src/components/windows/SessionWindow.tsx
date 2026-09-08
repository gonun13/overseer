import { useState } from "react";
import type { PermissionDecision } from "@overseer/protocol";
import { Composer } from "../Composer";
import { StopIcon } from "../icons";
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
 * session, not the prompt terminal. Digits 1–4 still reach them when the
 * terminal is unfocused.
 *
 * Unlike the prompt terminal it does not split into the page/surface materials:
 * everything here sits on the window's own ground, and the composer is marked
 * out by an accent outline instead (see `.session-window` in prompt.css).
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
  onStop,
  onInspect,
  onResolveApproval,
  note,
}: {
  turns: Turn[];
  busy: boolean;
  /** Why this session has nothing to show — a refused open, most often.
   * Without it a session that failed to open is indistinguishable from a new
   * one, which is how a refusal used to read as "nothing happened". */
  note?: string;
  settings: SessionSettings;
  options: SessionOption[];
  openSessionControl: SessionOptionKey | null;
  contextCount: number;
  onToggleSessionControl: (key: SessionOptionKey) => void;
  onSelectSessionControl: (key: SessionOptionKey, value: string) => void;
  onOpenSessionContext: () => void;
  onSubmit: (input: string) => void;
  /** Stop the turn in flight. Only reachable while `busy` — the button is not
   * rendered otherwise, since the supervisor has nothing to interrupt. */
  onStop: () => void;
  onInspect: (id: string) => void;
  onResolveApproval: (id: string, decision: PermissionDecision) => void;
}) {
  const [value, setValue] = useState("");
  const models = options.find((option) => option.key === "model")?.values ?? [];
  const awaitingApproval = turns.some((turn) => turn.kind === "approval");

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
          <p className="session-empty">{note ?? "nothing said yet"}</p>
        ) : (
          <Transcript
            turns={turns}
            models={models}
            onInspect={onInspect}
            onResolveApproval={onResolveApproval}
          />
        )}
      </div>

      <Composer
        value={value}
        placeholder="Ask, or describe the change you want."
        onChange={setValue}
        onSubmit={submit}
        // No armed summary here: the control heads below already print what
        // each row is set to, and saying it twice makes the operator check
        // which one is authoritative.
        meta={
          <>
            {awaitingApproval ? (
              <span>waiting on your approval</span>
            ) : busy ? (
              <span>turn in flight</span>
            ) : (
              <span>enter to send · shift+enter for a newline</span>
            )}
            {/* The meta row is already `space-between`, so the stop lands
                flush right of whatever the line says — and only while there
                is a turn to stop. */}
            {busy && (
              <button
                type="button"
                className="composer-stop"
                aria-label="stop this turn"
                onClick={onStop}
              >
                <StopIcon />
                stop
              </button>
            )}
          </>
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
