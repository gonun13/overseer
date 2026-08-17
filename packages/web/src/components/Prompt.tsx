import { useEffect, useRef, useState } from "react";

/**
 * The prompt terminal — one line at the bottom of the field, always. Click or
 * Cmd+K focuses it; Escape blurs. It never grows into a transcript panel:
 * commands and overseer messages stay on this bar (design-system.md §7.1).
 *
 * Talking to a model happens in that session's own chat window, which has its
 * own transcript, session controls and composer — nothing said here reaches one.
 *
 * No tab and no close button, unlike a window: the terminal is permanent
 * furniture, not a surface you summon and dismiss.
 */
export function Prompt({
  focused,
  onFocus,
  onBlur,
  onSubmit,
}: {
  /** Whether the bar is focused — session-control digits stand down while true. */
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onSubmit: (input: string) => void;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focused) input.current?.focus();
    else input.current?.blur();
  }, [focused]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }

  const idleText = value.trim() || "run a command, or message the overseer";

  return (
    <div
      className={`prompt-bar ${focused ? "open" : ""}`}
      onMouseDown={(event) => {
        if (event.target === input.current) return;
        event.preventDefault();
        onFocus();
        input.current?.focus();
      }}
    >
      <span className="prompt-caret">›</span>

      {focused ? (
        <div className="prompt-field">
          <div className="prompt-stack">
            <div className="prompt-mirror" aria-hidden>
              {value}
              <span className="prompt-cursor blink" />
            </div>
            <textarea
              ref={input}
              rows={1}
              value={value}
              aria-label="run a command, or message the overseer"
              onFocus={onFocus}
              onBlur={onBlur}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        </div>
      ) : (
        <>
          <span className="prompt-placeholder">{idleText}</span>
          <span className="prompt-cursor blink" />
        </>
      )}
    </div>
  );
}
