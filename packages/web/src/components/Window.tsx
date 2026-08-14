import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon, ResizeIcon } from "./icons";

const MIN_WIDTH = 420;
const MIN_HEIGHT = 240;

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
  height,
  variant,
  onClose,
  onRaise,
  onMove,
  onResize,
  children,
}: {
  title: string;
  x: number;
  y: number;
  z: number;
  width: number;
  /** Body height when resizable. Absent = CSS max-height default. */
  height?: number;
  /** `console` fills flush and may expose a resize grip. */
  variant?: "console";
  onClose: () => void;
  onRaise: () => void;
  onMove: (x: number, y: number) => void;
  onResize?: (width: number, height: number) => void;
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

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

  useEffect(() => {
    if (!resizing || !onResize) return;

    function onPointerMove(e: PointerEvent) {
      if (!resize.current) return;
      const nextW = Math.max(
        MIN_WIDTH,
        Math.min(
          window.innerWidth - x - 16,
          resize.current.startW + (e.clientX - resize.current.startX),
        ),
      );
      const nextH = Math.max(
        MIN_HEIGHT,
        Math.min(
          window.innerHeight - y - 48,
          resize.current.startH + (e.clientY - resize.current.startY),
        ),
      );
      onResize?.(nextW, nextH);
    }
    function onPointerUp() {
      setResizing(false);
      resize.current = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [resizing, onResize, x, y]);

  const bodyStyle =
    height !== undefined && expanded
      ? { maxHeight: "none" as const, height }
      : undefined;

  return (
    <div
      className={`window ${variant === "console" ? "window-console" : ""} ${dragging || resizing ? "dragging" : ""}`}
      style={{ left: x, top: y, width, zIndex: z }}
      onPointerDown={(e) => {
        onRaise();
        // Controls and scrollable content keep their own pointer behaviour.
        if (
          (e.target as HTMLElement).closest(
            "button, input, textarea, .no-drag, .xterm, .window-resize",
          )
        )
          return;
        drag.current = { dx: e.clientX - x, dy: e.clientY - y };
        setDragging(true);
      }}
    >
      <div className={`window-tab ${revealed ? "revealed" : ""}`}>
        <span style={{ color: "var(--mark-fill)" }}>▽</span>
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
        <div
          className={`window-body no-drag ${expanded ? "expanded" : ""}`}
          style={bodyStyle}
        >
          {children}
        </div>
        {onResize && height !== undefined && (
          <button
            type="button"
            className="window-resize no-drag"
            aria-label={`resize ${title}`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRaise();
              resize.current = {
                startX: e.clientX,
                startY: e.clientY,
                startW: width,
                startH: height,
              };
              setResizing(true);
            }}
          >
            <ResizeIcon />
          </button>
        )}
      </div>
    </div>
  );
}
