import { useEffect, useRef, useState } from "react";
import { Transcript } from "./Transcript";
import { CloseIcon } from "./icons";
import type { Turn } from "../data/mock";
import type { PromptSettings } from "../prompt";

/**
 * Collapsed it is one line at the bottom of the field. Clicked, it grows upward
 * into an ordinary chat window with the transcript above the composer — same
 * ground, two sizes, no separate "chat mode" (design-system.md §7.1).
 *
 * Field-level, not a surface like other windows: the operator reads and writes
 * prose here at length, and a page reads better over that much text than a lit
 * panel does. Only the tab stays void — it is the machine's own label for the
 * session, not something the session produced.
 *
 * There is no exec button and the text is not uppercased: this is prose going to
 * a model, and it should look like prose while it is being written.
 */
export function Prompt({
  expanded,
  turns,
  busy,
  settings,
  projectName,
  onExpand,
  onCollapse,
  onSubmit,
  onInspect,
}: {
  expanded: boolean;
  turns: Turn[];
  busy: boolean;
  settings: PromptSettings;
  projectName?: string;
  onExpand: () => void;
  onCollapse: () => void;
  onSubmit: (input: string) => void;
  onInspect: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (expanded) box.current?.focus();
  }, [expanded]);

  // Grow with the content up to the cap, then scroll inside.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value, expanded]);

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
          {value.trim() ||
            (projectName ? `message ${projectName}` : "message the agent")}
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
      <div className="window-tab revealed">
        <span style={{ color: "var(--accent)" }}>▽</span>
        <span style={{ opacity: 0.5, fontSize: 12 }}>///</span>
        <span>{projectName ? `session · ${projectName}` : "session"}</span>
        <button
          className="tab-close"
          onClick={onCollapse}
          aria-label="collapse prompt"
        >
          <CloseIcon />
        </button>
      </div>

      {turns.length > 0 && (
        <div className="transcript-panel">
          <Transcript turns={turns} onInspect={onInspect} />
        </div>
      )}

      <div className="composer">
        <textarea
          ref={box}
          rows={1}
          value={value}
          placeholder="Ask, or describe the change you want."
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-meta">
          {/* Unset options are omitted rather than shown blank, so the line
              never reads as " · " with the values rubbed out. */}
          <span>
            {[
              settings.model,
              settings.mode,
              settings.agent === "default" ? "" : settings.agent,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span>
            {busy
              ? "turn in flight"
              : "enter to send · shift+enter for a newline"}
          </span>
        </div>
      </div>
    </div>
  );
}
