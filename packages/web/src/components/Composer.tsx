import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The input half of every prose surface: the prompt terminal and each chat
 * window use this one field so they cannot drift apart.
 *
 * The native caret is replaced by the blinking block, the same way the
 * first-run name ask does it (OverseerSpace): a mirror carries the visible
 * glyphs and the textarea sits transparent on top of it, so the block lands
 * with the text instead of being pinned to one end. The mirror is also what
 * gives the field its height — the box grows with the content up to the CSS
 * cap, with nothing measured in JS.
 *
 * Controlled, because the collapsed prompt bar reads the text back out while
 * the field itself is unmounted.
 */
export function Composer({
  value,
  placeholder,
  meta,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  /** The line under the field. Callers own it: the terminal and a session
   * window do not report the same things. */
  meta?: ReactNode;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const field = useRef<HTMLDivElement>(null);
  // Where the block is drawn in the mirror. The real caret is invisible, so
  // arrow keys, clicks and Home/End would otherwise move nothing the eye can
  // see — the block has to follow selectionStart, not the end of the text.
  const [caret, setCaret] = useState(value.length);

  const syncCaret = useCallback(() => {
    const area = box.current;
    if (area) setCaret(area.selectionStart ?? 0);
  }, []);

  // Both surfaces are summoned to be typed into.
  useEffect(() => {
    box.current?.focus();
  }, []);

  // Keys and clicks are covered by the field's own handlers, but a caret moved
  // by anything else — a drag-select finishing outside the box, an undo, the
  // OS text menu — only reports through this.
  useEffect(() => {
    document.addEventListener("selectionchange", syncCaret);
    return () => document.removeEventListener("selectionchange", syncCaret);
  }, [syncCaret]);

  // The value can also change from outside (a caller clearing the field after
  // a send), which moves the caret without any event of ours firing.
  useEffect(() => {
    syncCaret();
  }, [value, syncCaret]);

  // Past the cap the field is what scrolls, and the browser will not scroll it
  // to a caret it cannot see — the textarea is sized to its own content, so
  // there is nothing for it to scroll. Following the caret is only correct
  // while it is at the end; a mid-text edit must not yank the view down.
  useEffect(() => {
    const el = field.current;
    const area = box.current;
    if (!el || !area) return;
    if (area.selectionStart === value.length) el.scrollTop = el.scrollHeight;
  }, [value]);

  // A block cursor covers the character it sits on rather than displacing it,
  // so the text does not jiggle sideways as the caret walks through it. At the
  // end of the text — or on a line break, which has no width of its own — it
  // covers a blank instead: the field is monospaced, so an empty cell and a
  // full one are the same block, and the caret does not change shape as it
  // walks off the end of the line.
  const at = Math.min(caret, value.length);
  const under = value.slice(at, at + 1);
  const covers = under !== "" && under !== "\n";

  return (
    <div className="composer">
      <div className="composer-field" ref={field}>
        <div className="composer-stack">
          <div className="composer-mirror" aria-hidden>
            {value.slice(0, at)}
            <span className="composer-cursor">{covers ? under : "\u00a0"}</span>
            {value.slice(covers ? at + 1 : at)}
          </div>
          <textarea
            ref={box}
            rows={1}
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              onChange(e.target.value);
              syncCaret();
            }}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onFocus={syncCaret}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>
      </div>
      {meta && <div className="composer-meta">{meta}</div>}
    </div>
  );
}
