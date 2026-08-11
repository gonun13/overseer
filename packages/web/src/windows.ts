export type WindowKind =
  | "overseer"
  | "sessions"
  | "approvals"
  | "capabilities"
  | "capability"
  | "context"
  | "console"
  | "help"
  | "diff";

export interface OpenWindow {
  id: string;
  kind: WindowKind;
  title: string;
  x: number;
  y: number;
  w: number;
  /** Stacking order. DOM order stays fixed so clicks survive a raise. */
  z: number;
  payload?: unknown;
}

/** Spawn positions are assigned, not computed — windows land where the design
 * puts them and the operator drags from there (design-system.md §5).
 * `w` is the frame width; content never sets its own, so nothing can overflow it. */
export const WINDOW_SPEC: Record<
  WindowKind,
  { title: string; x: number; y: number; w: number }
> = {
  // The overseer's own report. Narrower than the rest: its content is one
  // short padded line per step and nothing else, so a wide frame would be
  // mostly empty. The only kind summoned by the machine rather than the
  // operator (docs/overseer.md §3).
  overseer: { title: "overseer", x: 420, y: 130, w: 460 },
  sessions: { title: "sessions", x: 96, y: 168, w: 620 },
  approvals: { title: "approvals", x: 620, y: 148, w: 560 },
  capabilities: { title: "capabilities", x: 150, y: 250, w: 540 },
  capability: { title: "capability", x: 260, y: 210, w: 560 },
  context: { title: "context", x: 120, y: 300, w: 500 },
  // Wider than the rest: it holds fixed-width terminal output, which is the one
  // kind of content that cannot reflow to fit a narrower frame.
  console: { title: "console", x: 200, y: 150, w: 720 },
  help: { title: "help", x: 380, y: 190, w: 560 },
  diff: { title: "diff", x: 700, y: 260, w: 580 },
};
