import { useEffect, useRef, useState } from "react";
import type { ProviderOption } from "@overseer/protocol";
import type { Turn } from "../domain";
import { ChevronIcon } from "./icons";
import { findOption } from "../session";

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
  models,
  onInspect,
}: {
  turns: Turn[];
  /** The model row's catalog — resolves a turn's raw reported model id
   * (`"claude-haiku-4-5-20251001"`) back to the name the operator picked
   * (`"Haiku 4.5"`) the same way the session controls do. */
  models: ProviderOption[];
  onInspect: (id: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  // Follows the bottom by default — opening a session, or a reply starting to
  // stream, lands scrolled down. Scrolling up to read back releases it; it
  // reattaches once the operator returns to the bottom themselves.
  const stuck = useRef(true);
  // Explicit operator toggles for a thinking block, keyed by turn id. Absent
  // means "use the default" (see `isNewest` below) — a click always flips
  // whatever is currently showing, live or settled.
  const [thinkingToggled, setThinkingToggled] = useState<Record<string, boolean>>(
    {},
  );

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
      {turns.map((turn, i) => {
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
        if (turn.kind === "thinking") {
          // Open by default while it is the newest thing in the transcript —
          // reasoning is worth watching as it streams — and collapses to a
          // one-line head the moment a reply (or anything else) follows it,
          // the same way Claude Code's own CLI folds a finished thinking
          // block down to "thought for Ns". A manual click always wins.
          const isNewest = i === turns.length - 1;
          const expanded = thinkingToggled[turn.id] ?? isNewest;
          return (
            <div key={turn.id} className="turn-thinking">
              <button
                type="button"
                className="turn-thinking-head"
                aria-expanded={expanded}
                onClick={() =>
                  setThinkingToggled((current) => ({
                    ...current,
                    [turn.id]: !expanded,
                  }))
                }
              >
                <ChevronIcon open={expanded} />
                <span className="turn-label">thinking</span>
              </button>
              {expanded && <p className="turn-text turn-thinking-text">{turn.text}</p>}
            </div>
          );
        }
        const modelLabel =
          turn.kind === "agent" && turn.model !== undefined
            ? (findOption(models, turn.model)?.label ?? turn.model)
            : undefined;
        return (
          <div
            key={turn.id}
            className={turn.kind === "user" ? "turn-operator" : "turn-agent"}
          >
            <div className="turn-label">
              {turn.kind === "user" ? "operator" : "agent"}
              {modelLabel !== undefined && (
                <span className="turn-label-model"> · {modelLabel}</span>
              )}
            </div>
            <p className="turn-text">{turn.text}</p>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
