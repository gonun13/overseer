import { useState } from "react";
import { Composer } from "../Composer";
import { Transcript } from "../Transcript";
import type { Turn } from "../../domain";

/**
 * One conversation in its own frame: transcript above, composer below, scoped
 * to a single session so several can be open, dragged and closed independently.
 *
 * Unlike the prompt terminal it does not split into the page/surface materials:
 * everything here sits on the window's own ground, and the composer is marked
 * out by an accent outline instead (see `.chat-window` in index.css).
 *
 * The frame, the tab and the close are the ordinary Window primitive's; this is
 * only what goes inside it.
 */
export function ChatWindow({
  turns,
  busy,
  onSubmit,
  onInspect,
}: {
  turns: Turn[];
  busy: boolean;
  onSubmit: (input: string) => void;
  onInspect: (id: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="chat-window">
      <div className="transcript-panel">
        {turns.length === 0 ? (
          <p className="chat-empty">nothing said yet</p>
        ) : (
          <Transcript turns={turns} onInspect={onInspect} />
        )}
      </div>

      {/* The hint stays here though the terminal has dropped it: a session
          window is the surface an operator meets first and least often, and
          the slot is otherwise empty until a turn is in flight. */}
      <Composer
        value={value}
        placeholder="Ask, or describe the change you want."
        onChange={setValue}
        onSubmit={submit}
        meta={
          <span>
            {busy
              ? "turn in flight"
              : "enter to send · shift+enter for a newline"}
          </span>
        }
      />
    </div>
  );
}
