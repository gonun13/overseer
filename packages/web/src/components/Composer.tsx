import { useEffect, useRef, type ReactNode } from "react";

/**
 * The input half of every prose surface: the prompt terminal and each chat
 * window use this one field so they cannot drift apart.
 *
 * The native caret is replaced by the blinking block, the same way the
 * first-run name ask does it (OverseerSpace): a mirror carries the visible
 * glyphs and the textarea sits transparent on top of it, so the block lands
 * after the last character and wraps with the text instead of being pinned to
 * one end. The mirror is also what gives the field its height — the box grows
 * with the content up to the CSS cap, with nothing measured in JS.
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

  // Both surfaces are summoned to be typed into.
  useEffect(() => {
    box.current?.focus();
  }, []);

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

  return (
    <div className="composer">
      <div className="composer-field" ref={field}>
        <div className="composer-stack">
          <div className="composer-mirror" aria-hidden>
            {value}
            <span className="composer-cursor blink" />
          </div>
          <textarea
            ref={box}
            rows={1}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
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
