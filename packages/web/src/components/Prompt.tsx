import { useEffect, useRef, useState } from "react";
import { suggestCommands } from "../commands";

const IDLE_TEXT = "type / for a command, or message the session";

/**
 * The prompt terminal — one line at the bottom of the field, always. Click or
 * Cmd+K focuses it; Escape blurs. It never grows into a transcript panel.
 *
 * A leading `/` is a command: names autocomplete and Enter runs the highlighted
 * one. Everything else is a prompt for the active project's session.
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
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestions = suggestCommands(value);
  const suggestionKey = suggestions.map((command) => command.name).join(",");
  const active = suggestions.length === 0 ? 0 : selected % suggestions.length;
  const listing = focused && suggestions.length > 0;
  const idleText = value.trim() || IDLE_TEXT;

  useEffect(() => {
    if (focused) input.current?.focus();
    else input.current?.blur();
  }, [focused]);

  useEffect(() => {
    setSelected(0);
  }, [suggestionKey]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (suggestions.length > 0) {
      onSubmit(`/${suggestions[active].name}`);
      setValue("");
      return;
    }
    if (trimmed.startsWith("/")) return;
    onSubmit(trimmed);
    setValue("");
  }

  function complete(index: number) {
    const command = suggestions[index];
    if (!command) return;
    setValue(`/${command.name}`);
    setSelected(index);
  }

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
      {listing && (
        <div
          className="prompt-suggest"
          role="listbox"
          id="prompt-commands"
          aria-label="commands"
        >
          {suggestions.map((command, index) => (
            <button
              key={command.name}
              type="button"
              role="option"
              id={`prompt-cmd-${command.name}`}
              aria-selected={index === active}
              className={`prompt-suggest-item ${index === active ? "current" : ""}`}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSubmit(`/${command.name}`);
                setValue("");
              }}
            >
              <span className="prompt-suggest-name">/{command.name}</span>
              <span className="prompt-suggest-help">{command.help}</span>
            </button>
          ))}
        </div>
      )}

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
              aria-label={IDLE_TEXT}
              aria-autocomplete="list"
              aria-expanded={listing}
              aria-controls={listing ? "prompt-commands" : undefined}
              aria-activedescendant={
                listing ? `prompt-cmd-${suggestions[active].name}` : undefined
              }
              onFocus={onFocus}
              onBlur={onBlur}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (listing && event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelected(
                    (current) => (current + 1) % suggestions.length,
                  );
                  return;
                }
                if (listing && event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelected(
                    (current) =>
                      (current - 1 + suggestions.length) % suggestions.length,
                  );
                  return;
                }
                if (listing && event.key === "Tab") {
                  event.preventDefault();
                  const already = value.trim() === `/${suggestions[active].name}`;
                  const next = event.shiftKey
                    ? (active - 1 + suggestions.length) % suggestions.length
                    : already
                      ? (active + 1) % suggestions.length
                      : active;
                  complete(next);
                  return;
                }
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
