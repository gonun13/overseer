export type WindowKind =
  | "overseer"
  | "providers"
  | "sessions"
  | "console"
  | "help"
  | "changelog"
  | "diff"
  | "folder"
  | "loopModels"
  | "projectCreate"
  | "project"
  | "gitConfig";

export interface OpenWindow {
  id: string;
  kind: WindowKind;
  title: string;
  /** Dim secondary on the tab (e.g. project name on a chat window). */
  detail?: string;
  x: number;
  y: number;
  w: number;
  /** Body height when the kind is resizable (console, diff…). Absent = CSS default. */
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
  // Mid-right: right-aligned with the provider instrument that summons it,
  // vertically centred — spawn position is computed in useWindows from the
  // viewport, and loopModels rides a fixed step above it.
  providers: { title: "providers", x: 9999, y: 9999, w: 420 },
  sessions: { title: "sessions", x: 96, y: 168, w: 620 },
  // One per console — any number, across projects. Mid-right: spawn position
  // is computed in useWindows from the viewport, and repeats cascade. The
  // payload is the console id (or `pending:<reqId>` until the server
  // answers). Height is operator-resizable from the bottom-right grip, and
  // the layout survives a reload (console-layout.ts).
  console: { title: "console", x: 9999, y: 9999, w: 720, h: 480 },
  help: { title: "help", x: 380, y: 190, w: 560 },
  // Beside help, offset so the two can sit open together — they answer the
  // neighbouring questions "what can this do" and "what changed". Opened from
  // the `/changelog` command or by clicking the version in the footer. Height
  // is operator-resizable: the list grows by one section every release.
  changelog: { title: "changelog", x: 420, y: 220, w: 560, h: 400 },
  // Opened by clicking a changed file in the project window — the payload
  // carries the project and the file, and doubles as the dedupe key, so a
  // second click on the same row raises the window it already opened.
  //
  // Wider and taller than the fixed kinds: a diff's line length is the file's
  // and not ours, so a narrow frame wraps every line twice, and its length has
  // no bound at all — the same reasoning console and changelog are resizable
  // under.
  diff: { title: "diff", x: 700, y: 260, w: 640, h: 400 },
  // Opened by clicking a folder row in the project window, or a folder inside
  // another one of these — the payload carries the project and the folder and
  // doubles as the dedupe key, so walking back into a folder raises the window
  // already open on it rather than stacking a second copy.
  //
  // Narrower than the diff it sits beside: a listing is one short name per
  // row, so the diff's width would be mostly empty. Offset from it so a folder
  // and a file opened out of it can be read together.
  folder: { title: "folder", x: 720, y: 290, w: 520 },
  // Opened from the providers window's loop tab, one per provider (the
  // payload — a provider id — is also useWindows' dedupe key, so a second
  // click on the same provider raises the existing window). Height is
  // operator-resizable: up to ten slot rows can be open at once.
  loopModels: { title: "loop models", x: 9999, y: 9999, w: 460, h: 380 },
  // Opened from the project panel's own "+ create project" row — a fixed
  // mid-field spawn, same as context/help, since it has no instrument to
  // anchor near.
  projectCreate: { title: "create project", x: 260, y: 220, w: 480 },
  // Opened from the project panel's per-row manage icon (payload: that
  // project's path — also the dedupe key, so a second click on the same row
  // raises the existing window rather than stacking another one), from the
  // active-project readout, or from the `/project` command — the last two
  // both target the active project. Top-centre, under the active-project
  // readout it answers for: x is the 9999 sentinel, since the spawn is
  // centred on the viewport in useWindows rather than at one assumed width.
  project: { title: "project", x: 9999, y: 96, w: 520 },
  // Opened from the settings panel's "configure git" button, or the `/git`
  // command. Settings keeps only a status summary of what this window holds —
  // the same split it draws with capabilities, whose own detail lives in a
  // window and not the panel. Fixed mid-field spawn: it has no instrument on
  // the furniture to anchor near, the same reasoning `help`/`context` use.
  gitConfig: { title: "git config", x: 300, y: 180, w: 520 },
};
