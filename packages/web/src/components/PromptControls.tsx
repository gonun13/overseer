import { ChevronIcon } from "./icons";
import type {
  PromptOption,
  PromptOptionKey,
  PromptSettings,
} from "../prompt";

/**
 * Bottom-left, permanent, sat beside the prompt because that is what it controls.
 * An **accordion**: a row opens to show its values and you pick one, so the whole
 * option set is legible instead of being hidden behind repeated clicks. One
 * section at a time; the block is bottom-anchored so it grows upward.
 *
 * Two levels, like the project panel. The rows are a menu you read, so they stay
 * on the field and blend with the background; opening one prints its options as
 * a stamp below it, since that's the part you act on.
 *
 * The numbers are keyboard shortcuts, taken as bare digits — safe because the
 * prompt only holds focus when it is open, and the shortcuts stand down while it
 * is (design-system.md §6).
 */
export function PromptControls({
  options,
  settings,
  openKey,
  contextCount,
  onToggle,
  onSelect,
  onOpenContext,
}: {
  /** Empty until a provider reports what this instance can be set to; the
   * accordion then has nothing to show and only the context row remains. */
  options: PromptOption[];
  settings: PromptSettings;
  openKey: PromptOptionKey | null;
  contextCount: number;
  onToggle: (key: PromptOptionKey) => void;
  onSelect: (key: PromptOptionKey, value: string) => void;
  onOpenContext: () => void;
}) {
  return (
    <div className="controls">
      {options.map((option, i) => {
        const open = openKey === option.key;
        const value = settings[option.key];
        return (
          <div key={option.key} className={`ctl ${open ? "open" : ""}`}>
            <button
              className="ctl-head"
              onClick={() => onToggle(option.key)}
              aria-expanded={open}
            >
              <span className="ctl-key">{i + 1}</span>
              <span className="ctl-label">{option.label}</span>
              <span
                className={`ctl-value ${option.danger?.includes(value) ? "danger" : ""}`}
              >
                {value}
              </span>
              <span className="ctl-chevron">
                <ChevronIcon open={open} />
              </span>
            </button>

            <div className="ctl-values">
              {option.values.map((candidate) => (
                <button
                  key={candidate}
                  className={`ctl-option ${candidate === value ? "current" : ""} ${
                    option.danger?.includes(candidate) ? "danger" : ""
                  }`}
                  onClick={() => onSelect(option.key, candidate)}
                >
                  <span className="ctl-mark">
                    {candidate === value ? "▪" : ""}
                  </span>
                  {candidate}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Context is the one option that needs more than a value, so it opens a window. */}
      <div className="ctl">
        <button className="ctl-head" onClick={onOpenContext}>
          <span className="ctl-key">{options.length + 1}</span>
          <span className="ctl-label">context</span>
          <span className="ctl-value">
            {contextCount === 0 ? "empty" : `${contextCount} attached`}
          </span>
          <span className="ctl-chevron">›</span>
        </button>
      </div>
    </div>
  );
}
