export type WindowKind =
  | "overseer"
  | "providers"
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
  /** Body height when the kind is resizable (console). Absent = CSS default. */
  h?: number;
  /** Stacking order. DOM order stays fixed so clicks survive a raise. */
  z: number;
  payload?: unknown;
}

/** Spawn positions are assigned, not computed — windows land where the design
 * puts them and the operator drags from there (design-system.md §5).
 * `w` is the frame width; content never sets its own, so nothing can overflow it.
 * `h` is optional body height for kinds the operator can resize. */
export const WINDOW_SPEC: Record<
  WindowKind,
  { title: string; x: number; y: number; w: number; h?: number }
> = {
  // The overseer's own report. Narrower than the rest: its content is one
  // short padded line per step and nothing else, so a wide frame would be
  // mostly empty. The only kind summoned by the machine rather than the
  // operator (docs/overseer.md §3).
  //
  // Top-right, under the clock/settings corner that already owns that region
  // (design-system.md §1) — the machine's own voice belongs with the machine's
  // own controls, not over the middle of the field. x is deliberately past any
  // viewport: the spawn clamp below pins it to `innerWidth - w - 24`, which
  // right-anchors it on every screen width rather than at one assumed one. y
  // clears both the clock (top 20, ~42 tall) and the centred active-project
  // readout (top 18, ~60 tall).
  overseer: { title: "overseer", x: 9999, y: 96, w: 460 },
  // Bottom-right, above the provider widget — spawn position is computed in
  // useWindows from the viewport so it clears the instrument on any height.
  providers: { title: "providers", x: 9999, y: 9999, w: 420 },
  sessions: { title: "sessions", x: 96, y: 168, w: 620 },
  approvals: { title: "approvals", x: 620, y: 148, w: 560 },
  capabilities: { title: "capabilities", x: 150, y: 250, w: 540 },
  capability: { title: "capability", x: 260, y: 210, w: 560 },
  context: { title: "context", x: 120, y: 300, w: 500 },
  // Mid-right: spawn position is computed in useWindows from the viewport so
  // it sits on the right edge, vertically centred. Height is operator-
  // resizable from the bottom-right grip.
  console: { title: "console", x: 9999, y: 9999, w: 720, h: 480 },
  help: { title: "help", x: 380, y: 190, w: 560 },
  diff: { title: "diff", x: 700, y: 260, w: 580 },
};
