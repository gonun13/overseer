import { ChevronIcon } from "./icons";
import { findOption, headLabel, labelForValue } from "../session";
import type {
  SessionOption,
  SessionOptionKey,
  SessionSettings,
} from "../session";

/**
 * Session controls along the bottom of a session window, one column per option.
 * Opening a column prints its values as a stamp above it so the list does not
 * grow the window. One section at a time.
 *
 * The numbers are keyboard shortcuts, taken as bare digits on the focused
 * session — safe because a focused textarea stands them down, and the prompt
 * terminal owns every key while it is focused (design-system.md §6).
 */
export function SessionControls({
  options,
  settings,
  openKey,
  contextCount,
  onToggle,
  onSelect,
  onOpenContext,
}: {
  /** Rows are always shown; value lists fill in when the provider reports them. */
  options: SessionOption[];
  settings: SessionSettings;
  openKey: SessionOptionKey | null;
  contextCount: number;
  onToggle: (key: SessionOptionKey) => void;
  onSelect: (key: SessionOptionKey, value: string) => void;
  onOpenContext: () => void;
}) {
  return (
    <div className="session-controls">
      {options.map((option, i) => {
        const open = openKey === option.key;
        const value = settings[option.key];
        // A model row's armed value can be the CLI's resolved id rather than
        // the menu's own wire value (see `findOption`) — matching on identity
        // once here, rather than `candidate.value === value` per row below,
        // is what keeps the ▪ mark and the head in agreement.
        const current = findOption(option.values, value);
        return (
          <div
            key={option.key}
            className={`session-ctl ${open ? "open" : ""}`}
          >
            {/* The head prints what is *selected*, not what the row is called:
                a row's identity is its digit and its place in the bar, and the
                operator needs to read the armed value at a glance. The name
                survives for screen readers on `aria-label`. */}
            <button
              className="session-ctl-head"
              onClick={() => onToggle(option.key)}
              aria-expanded={open}
              aria-label={`${option.label} ${labelForValue(option, value) ?? "unset"}`}
            >
              <span className="session-ctl-key">{i + 1}</span>
              <span
                className={`session-ctl-value ${current?.danger ? "danger" : ""}`}
              >
                {headLabel(option, value) ?? "—"}
              </span>
              <span className="session-ctl-chevron">
                <ChevronIcon open={open} />
              </span>
            </button>

            {option.values.length > 0 && (
              <div className="session-ctl-values" role="listbox">
                {option.values.map((candidate) => {
                  const selected = candidate === current;
                  return (
                    <button
                      key={candidate.value}
                      role="option"
                      aria-selected={selected}
                      className={`session-ctl-option ${selected ? "current" : ""} ${
                        candidate.danger ? "danger" : ""
                      }`}
                      onClick={() => onSelect(option.key, candidate.value)}
                    >
                      <span className="session-ctl-mark">
                        {selected ? "▪" : ""}
                      </span>
                      <span className="session-ctl-option-text">
                        {candidate.label}
                        {candidate.detail !== undefined && (
                          <span className="session-ctl-option-detail">
                            {candidate.detail}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Context is the one option that needs more than a value, so it opens a
          window — and the one row with no selection to print in place of its
          name, so it keeps the name and hangs its count off it. */}
      <div className="session-ctl">
        <button
          className="session-ctl-head"
          onClick={onOpenContext}
          aria-label={`context ${contextCount === 0 ? "empty" : `${contextCount} attached`}`}
        >
          <span className="session-ctl-key">{options.length + 1}</span>
          {/* Empty is the resting state, so the word alone says it — a column
              this narrow ellipsizes "context · empty" down to "context · …",
              which spends the width saying nothing. */}
          <span className="session-ctl-value">
            {contextCount === 0 ? "context" : `context · ${contextCount}`}
          </span>
          <span className="session-ctl-chevron">›</span>
        </button>
      </div>
    </div>
  );
}
