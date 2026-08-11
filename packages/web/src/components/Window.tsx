import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./icons";

/**
 * The summonable primitive. The tab is a flow child of the window box, not an
 * absolutely-positioned chip, so its left edge is the window's left edge by
 * construction — there is no offset left to drift (design-system.md §5).
 */
export function Window({
  title,
  x,
  y,
  z,
  width,
  onClose,
  onRaise,
  onMove,
  children,
}: {
  title: string;
  x: number;
  y: number;
  z: number;
  width: number;
  onClose: () => void;
  onRaise: () => void;
  onMove: (x: number, y: number) => void;
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // Tab wipes in, then the body expands beneath it.
  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), 60);
    const t2 = setTimeout(() => setExpanded(true), 260);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;

    function onPointerMove(e: PointerEvent) {
      if (!drag.current) return;
      // Keep the whole frame on-screen horizontally: a window that hangs off the
      // right edge is the one thing that could make the field scroll sideways.
      onMove(
        Math.max(
          0,
          Math.min(window.innerWidth - width, e.clientX - drag.current.dx),
        ),
        Math.max(
          28,
          Math.min(window.innerHeight - 60, e.clientY - drag.current.dy),
        ),
      );
    }
    function onPointerUp() {
      setDragging(false);
      drag.current = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragging, onMove, width]);

  return (
    <div
      className={`window ${dragging ? "dragging" : ""}`}
      style={{ left: x, top: y, width, zIndex: z }}
      onPointerDown={(e) => {
        onRaise();
        // Controls and scrollable content keep their own pointer behaviour.
        if (
          (e.target as HTMLElement).closest("button, input, textarea, .no-drag")
        )
          return;
        drag.current = { dx: e.clientX - x, dy: e.clientY - y };
        setDragging(true);
      }}
    >
      <div className={`window-tab ${revealed ? "revealed" : ""}`}>
        <span style={{ color: "var(--accent)" }}>▽</span>
        <span style={{ opacity: 0.5, fontSize: 12 }}>///</span>
        <span>{title}</span>
        <button
          className="tab-close"
          onClick={onClose}
          aria-label={`close ${title}`}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="window-frame">
        <div className={`window-body no-drag ${expanded ? "expanded" : ""}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
