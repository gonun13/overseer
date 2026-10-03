import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Activity } from "../status";
import { stageBounds } from "../layout";
import { CloseIcon, ResizeIcon } from "./icons";
import { StatusLight } from "./StatusLight";

const MIN_WIDTH = 420;
const MIN_HEIGHT = 240;

/**
 * The summonable primitive. The tab is a flow child of the window box, not an
 * absolutely-positioned chip, so its left edge is the window's left edge by
 * construction — there is no offset left to drift (spec/ui-ux.md §5).
 */
export function Window({
  windowId,
  title,
  detail,
  x,
  y,
  z,
  width,
  height,
  variant,
  light,
  actions,
  closeLabel,
  onClose,
  onRaise,
  onMove,
  onResize,
  children,
}: {
  /** Stamped on the frame so keyboard commands can find a window's content. */
  windowId?: string;
  title: string;
  /** Dim secondary on the tab — not uppercased (e.g. project name). */
  detail?: string;
  x: number;
  y: number;
  z: number;
  width: number;
  /** Whole window height, tab included — every tiled window has one. Absent
   * = the body's CSS max-height default. */
  height?: number;
  /** `console` fills flush; `session` fills the body so the transcript can grow.
   * Either may expose a resize grip when `onResize` is set. */
  variant?: "console" | "session";
  /** A status light in place of the tab mark — what a console's CLI is doing. */
  light?: Activity;
  /** Extra tab controls, before close. */
  actions?: ReactNode;
  /** Overrides the close button's verb ("detach" on a console). */
  closeLabel?: string;
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
      // Keep the whole frame on the stage horizontally — windows never cross
      // onto a rail — and enough of the tab below its top to grab it back.
      const stage = stageBounds();
      onMove(
        Math.max(
          stage.left,
          Math.min(stage.right - width, e.clientX - drag.current.dx),
        ),
        Math.max(
          stage.top,
          Math.min(stage.bottom - 60, e.clientY - drag.current.dy),
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
      const stage = stageBounds();
      const nextW = Math.max(
        MIN_WIDTH,
        Math.min(
          stage.right - x,
          resize.current.startW + (e.clientX - resize.current.startX),
        ),
      );
      const nextH = Math.max(
        MIN_HEIGHT,
        Math.min(
          stage.bottom - y,
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

  return (
    <div
      className={`window ${variant ? `window-${variant}` : ""} ${height !== undefined ? "window-sized" : ""} ${dragging || resizing ? "dragging" : ""}`}
      style={{ left: x, top: y, width, height, zIndex: z }}
      data-window-id={windowId}
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
        {light !== undefined ? (
          <StatusLight activity={light} />
        ) : (
          <span style={{ color: "var(--mark-fill)" }}>▽</span>
        )}
        <span className="window-tab-sep" aria-hidden>
          ///
        </span>
        <span className="window-tab-title" title={title}>
          {title}
        </span>
        {detail !== undefined && detail !== "" && (
          <>
            <span className="window-tab-detail" aria-hidden>
              ·
            </span>
            <span className="window-tab-detail window-tab-project" title={detail}>
              {detail}
            </span>
          </>
        )}
        <span className="window-tab-end">
          {actions}
          <button
            className="tab-close"
            onClick={onClose}
            title={closeLabel ?? "close"}
            aria-label={
              detail !== undefined && detail !== ""
                ? `${closeLabel ?? "close"} ${title} ${detail}`
                : `${closeLabel ?? "close"} ${title}`
            }
          >
            <CloseIcon />
          </button>
        </span>
      </div>
      <div className="window-frame">
        <div
          className={`window-body no-drag ${expanded ? "expanded" : ""}`}
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
