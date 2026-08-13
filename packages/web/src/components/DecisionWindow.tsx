import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The one surface that blocks. Windows are never modal (ui-ux-design.md §5) and
 * escalations become signals rather than dialogs — but a decision that erases
 * the overseer's memory cannot be answered by a signal the operator may ignore,
 * and it must not be dismissible by the gestures that dismiss everything else.
 * So: no close, no drag, no Escape, and the field behind it is inert.
 *
 * It is built from the window's own parts rather than a second visual language,
 * with the tab centred instead of left-anchored — the one thing that tells the
 * operator this is not a window they summoned.
 */
export function DecisionWindow({
  title,
  children,
  confirmLabel,
  declineLabel,
  onConfirm,
  onDecline,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  declineLabel: string;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const decline = useRef<HTMLButtonElement | null>(null);

  // Same two-beat entrance as a window: the tab wipes in, the body follows.
  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), 60);
    const t2 = setTimeout(() => setExpanded(true), 260);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // The safe answer takes focus, and the field behind is inert, so the two
  // buttons are the only things a keyboard can reach.
  useEffect(() => {
    decline.current?.focus();
  }, []);

  const tabClass = `window-tab decision-tab${revealed ? " revealed" : ""}`;

  return (
    <div className="decision-scrim">
      <div
        className="decision"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={tabClass}>
          <span style={{ color: "var(--mark-fill)" }}>▽</span>
          <span style={{ opacity: 0.5, fontSize: 12 }}>///</span>
          <span>{title}</span>
        </div>
        <div className="window-frame">
          <div className={`window-body ${expanded ? "expanded" : ""}`}>
            {children}
            <div className="decision-actions">
              <button className="w-btn danger decision-btn" onClick={onConfirm}>
                {confirmLabel}
              </button>
              <button
                className="w-btn decision-btn"
                ref={decline}
                onClick={onDecline}
              >
                {declineLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
