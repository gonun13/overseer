import { useState } from "react";
import { Composer } from "./Composer";
import { Transcript } from "./Transcript";
import type { Turn } from "../domain";
import type { PromptSettings } from "../prompt";

/**
 * The prompt terminal. Collapsed it is one line at the bottom of the field;
 * clicked, it grows upward into the transcript above the composer — same
 * ground, two sizes, no separate "chat mode" (design-system.md §7.1).
 *
 * This is the shell's own input: slash commands, and the overseer itself.
 * Talking to a model happens in that session's own chat window, which has its
 * own transcript and its own composer — nothing said here reaches one.
 *
 * No tab and no close button, unlike a window: the terminal is permanent
 * furniture that changes size, not a surface you summon and dismiss, and it
 * collapses on Escape (useShellKeyboard). A tab would have claimed otherwise.
 *
 * Field-level, not a surface like other windows: the operator reads and writes
 * prose here at length, and a page reads better over that much text than a lit
 * panel does.
 *
 * There is no exec button and the text is not uppercased: this is prose going to
 * a model, and it should look like prose while it is being written.
 */
export function Prompt({
  expanded,
  turns,
  busy,
  settings,
  onExpand,
  onSubmit,
  onInspect,
}: {
  expanded: boolean;
  turns: Turn[];
  busy: boolean;
  settings: PromptSettings;
  onExpand: () => void;
  onSubmit: (input: string) => void;
  onInspect: (id: string) => void;
}) {
  const [value, setValue] = useState("");

  // Unset options are omitted rather than shown blank, so the line never reads
  // as " · " with the values rubbed out — and with nothing armed and no turn in
  // flight there is no line at all, rather than an empty band under the field.
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

  // Collapsed is the expanded chat with the transcript taken out — the same
  // surface, the same borders, the same colours. Only what is inside it changes.
  if (!expanded) {
    return (
      <button className="prompt-bar" onClick={onExpand}>
        <span className="prompt-caret">›</span>
        <span className="prompt-placeholder">
          {value.trim() || "run a command, or message the overseer"}
        </span>
        <span className="prompt-cursor blink" />
      </button>
    );
  }

  // The transcript is its own panel, a sibling of the composer rather than a
  // child of one shared frame. Output and input are different materials
  // (§7.1), so they get different boxes and can be styled without one's rules
  // leaking into the other.
  return (
    <div className="chat">
      {turns.length > 0 && (
        <div className="transcript-panel">
          <Transcript turns={turns} onInspect={onInspect} />
        </div>
      )}

      <Composer
        value={value}
        placeholder="Run a command, or ask the overseer."
        onChange={setValue}
        onSubmit={submit}
        meta={
          armed || busy ? (
            <>
              <span>{armed}</span>
              {busy && <span>turn in flight</span>}
            </>
          ) : undefined
        }
      />
    </div>
  );
}
