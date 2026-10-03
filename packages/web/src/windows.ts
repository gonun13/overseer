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
  /** Whole window height, tab included — set by the tile. Absent = CSS default. */
  h?: number;
  /** Stacking order. DOM order stays fixed so clicks survive a raise. */
  z: number;
  payload?: unknown;
}

/** Every window tiles the stage (useWindows), so a kind carries only its
 * default tab title — no spawn place or size of its own. */
export const WINDOW_SPEC: Record<WindowKind, { title: string }> = {
  overseer: { title: "overseer" },
  providers: { title: "providers" },
  sessions: { title: "sessions" },
  // One per console; the payload is the console id (or `pending:<reqId>`
  // until the server answers).
  console: { title: "console" },
  help: { title: "help" },
  changelog: { title: "changelog" },
  // Payload carries the project and file, and doubles as the dedupe key.
  diff: { title: "diff" },
  // Payload carries the project and folder, and doubles as the dedupe key.
  folder: { title: "folder" },
  // One per provider; the payload is the provider id.
  loopModels: { title: "loop models" },
  projectCreate: { title: "create project" },
  // Payload is the project's path.
  project: { title: "project" },
  gitConfig: { title: "git config" },
};
