import { ChevronIcon } from "./icons";
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
        return (
          <div
            key={option.key}
            className={`session-ctl ${open ? "open" : ""}`}
          >
            <button
              className="session-ctl-head"
              onClick={() => onToggle(option.key)}
              aria-expanded={open}
            >
              <span className="session-ctl-key">{i + 1}</span>
              <span className="session-ctl-label">{option.label}</span>
              <span
                className={`session-ctl-value ${option.danger?.includes(value) ? "danger" : ""}`}
              >
                {value || "—"}
              </span>
              <span className="session-ctl-chevron">
                <ChevronIcon open={open} />
              </span>
            </button>

            {option.values.length > 0 && (
              <div className="session-ctl-values">
                {option.values.map((candidate) => (
                  <button
                    key={candidate}
                    className={`session-ctl-option ${candidate === value ? "current" : ""} ${
                      option.danger?.includes(candidate) ? "danger" : ""
                    }`}
                    onClick={() => onSelect(option.key, candidate)}
                  >
                    <span className="session-ctl-mark">
                      {candidate === value ? "▪" : ""}
                    </span>
                    {candidate}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Context is the one option that needs more than a value, so it opens a window. */}
      <div className="session-ctl">
        <button className="session-ctl-head" onClick={onOpenContext}>
          <span className="session-ctl-key">{options.length + 1}</span>
          <span className="session-ctl-label">context</span>
          <span className="session-ctl-value">
            {contextCount === 0 ? "empty" : `${contextCount} attached`}
          </span>
          <span className="session-ctl-chevron">›</span>
        </button>
      </div>
    </div>
  );
}
