import { useEffect, useRef } from "react";
import type { Turn } from "../domain";

/**
 * Lives inside a session window or the prompt terminal when it shows history.
 *
 * The distinction that matters here is **who did it**. What the agent produced
 * is printed: a stamp laid on the surface, the same material as tabs, chips and
 * buttons. What you asked for stays part of the surface you asked it from — open
 * text in the prompt's own colours, marked by an accent lane. Nothing is a
 * bubble and nothing is aligned to a side (design-system.md §7.2).
 */
/**
 * A tool call reads as running until its result lands. Backfilled history has
 * no status — it is settled, so it sits back rather than reporting an outcome
 * the transcript never actually watched.
 */
const TOOL_MARK = {
  running: { glyph: "▸", color: "var(--light-accent)" },
  ok: { glyph: "▪", color: "var(--light-ok)" },
  error: { glyph: "✕", color: "var(--light-accent)" },
  settled: { glyph: "▪", color: "var(--light-idle)" },
} as const;

export function Transcript({
  turns,
  onInspect,
}: {
  turns: Turn[];
  onInspect: (id: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  // Follows the bottom by default — opening a session, or a reply starting to
  // stream, lands scrolled down. Scrolling up to read back releases it; it
  // reattaches once the operator returns to the bottom themselves.
  const stuck = useRef(true);

  useEffect(() => {
    const panel = end.current?.closest(".transcript-panel");
    if (!(panel instanceof HTMLElement)) return;
    const onScroll = () => {
      stuck.current =
        panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 48;
    };
    panel.addEventListener("scroll", onScroll, { passive: true });
    return () => panel.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // `turns.length` alone misses text streaming into the last turn — the
    // agent's message grows in place, so the array only gains an entry at the
    // *next* turn, and the transcript would stay pinned at the top for the
    // entire reply. Depending on `turns` itself re-fires on every delta,
    // since each one replaces the last turn with a new object.
    if (stuck.current) end.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  return (
    <div className="transcript no-drag">
      {turns.map((turn) => {
        if (turn.kind === "tool") {
          return (
            <button
              key={turn.id}
              className="turn-tool"
              data-status={turn.status}
              onClick={() => onInspect(turn.id)}
            >
              <span style={{ color: TOOL_MARK[turn.status ?? "settled"].color }}>
                {TOOL_MARK[turn.status ?? "settled"].glyph}
              </span>
              <span className="turn-tool-name">{turn.tool}</span>
              <span className="turn-tool-target">{turn.target}</span>
            </button>
          );
        }
        return (
          <div
            key={turn.id}
            className={turn.kind === "user" ? "turn-operator" : "turn-agent"}
          >
            <div className="turn-label">
              {turn.kind === "user" ? "operator" : "agent"}
            </div>
            <p className="turn-text">{turn.text}</p>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
