import { useEffect, useRef, useState } from "react";
import {
  matchCommand,
  suggestAddressees,
  suggestCommands,
  type Addressee,
} from "../commands";

const IDLE_TEXT = "type / for a command, @ to address an agent, or a prompt to start a new session";

/** One row of the suggestion list — a command or an agent. Enter runs `run`;
 * Tab completes to `complete` and keeps typing. */
interface Suggestion {
  key: string;
  label: string;
  help: string;
  run: string;
  complete: string;
}

function suggestionsFor(value: string, agents: Addressee[]): Suggestion[] {
  const commands = suggestCommands(value).map((command) => ({
    key: `cmd-${command.name}`,
    label: `/${command.name}`,
    help: command.help,
    run: `/${command.name}`,
    complete: `/${command.name}`,
  }));
  if (commands.length > 0) return commands;
  return suggestAddressees(value, agents).map((agent) => ({
    key: `agent-${agent.callsign}`,
    label: `@${agent.callsign}`,
    help: agent.title ?? (agent.running ? "running" : "dormant"),
    run: `@${agent.callsign}`,
    complete: `@${agent.callsign} `,
  }));
}

/**
 * The prompt terminal — one line at the bottom of the field, always. Click or
 * Cmd+K focuses it; Escape blurs. It never grows into a transcript panel.
 *
 * A leading `/` is a command: names autocomplete and Enter runs the highlighted
 * one. A leading `@` addresses an agent by callsign: `@linda <text>` relays the
 * text to it (spec/behaviour/relay.md §2). Everything else starts a new console
 * session in the active project with it as the opening prompt — the
 * conversation itself happens there.
 *
 * No tab and no close button, unlike a window: the terminal is permanent
 * furniture, not a surface you summon and dismiss.
 */
export function Prompt({
  focused,
  onFocus,
  onBlur,
  onSubmit,
  agents = [],
}: {
  /** Whether the bar is focused. */
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onSubmit: (input: string) => void;
  /** Agents `@` can address, for completion. */
  agents?: Addressee[];
}) {
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestions = suggestionsFor(value, agents);
  const suggestionKey = suggestions.map((suggestion) => suggestion.key).join(",");
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
      onSubmit(suggestions[active].run);
      setValue("");
      return;
    }
    // A command typed with arguments runs as typed; an unknown one stays put.
    if (trimmed.startsWith("/") && matchCommand(trimmed) === undefined) return;
    onSubmit(trimmed);
    setValue("");
  }

  function complete(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    setValue(suggestion.complete);
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
          aria-label="suggestions"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.key}
              type="button"
              role="option"
              id={`prompt-${suggestion.key}`}
              aria-selected={index === active}
              className={`prompt-suggest-item ${index === active ? "current" : ""}`}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSubmit(suggestion.run);
                setValue("");
              }}
            >
              <span className="prompt-suggest-name">{suggestion.label}</span>
              <span className="prompt-suggest-help">{suggestion.help}</span>
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
                listing ? `prompt-${suggestions[active].key}` : undefined
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
                  const already = value === suggestions[active].complete;
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
