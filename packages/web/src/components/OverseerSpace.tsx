import { LoadingBar } from "./LoadingBar";
import { StatusLight } from "./StatusLight";
import { useOccasionalTyping } from "../state/useOccasionalTyping";
import type { Signal } from "../state/signals";
import type { Activity } from "../status";

/**
 * The centre of the field. Not a log and not a dashboard: a ranked, derived
 * answer to "what should I be looking at?". Every line is clickable and opens
 * the thing it is talking about (design-system.md §4).
 *
 * During the wizard's opening phases the signal list is empty and the headline
 * is the whole message — that is the "headline-only" state a fresh instance
 * boots into, not a special mode (docs/overseer.md §4).
 */
export function OverseerSpace({
  signals,
  headline,
  busy,
  loading = false,
  typingChance,
  onFollow,
}: {
  signals: Signal[];
  headline: { text: string; activity: Activity };
  busy: boolean;
  /** Socket still connecting; nothing is known yet. */
  loading?: boolean;
  /** From `overseer-personality`, when the operator set one and it passed
   * validation. Undefined leaves `useOccasionalTyping`'s own default. */
  typingChance?: number;
  onFollow: (signal: Signal) => void;
}) {
  const { display, typing } = useOccasionalTyping(headline.text, typingChance);

  return (
    <div className="overseer-space">
      <p className="os-headline">
        {display}
        {typing && <span className="os-cursor blink" />}
      </p>
      <hr className="os-rule" style={{ width: busy ? 150 : 30 }} />
      {loading ? <LoadingBar /> : <p className="os-marker">▲</p>}

      <div className="os-signals">
        {signals.map((signal) => (
          <button
            key={signal.id}
            className="os-signal"
            onClick={() => onFollow(signal)}
          >
            <StatusLight activity={signal.activity} />
            <span className="os-kicker">{signal.kicker}</span>
            <span className="os-text">{signal.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
