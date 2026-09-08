/**
 * The dedupe key a file-view window is opened under, and its inverse.
 *
 * A window's payload is compared by identity when `useWindows` decides whether
 * to raise an existing window or open another, so a view that needs more than
 * one field has to fold them into a single string — an object would be a fresh
 * reference on every click and would stack a new window each time.
 *
 * NUL is the separator because it is the one byte a path cannot contain, so no
 * filename can forge a boundary. It also makes the key self-identifying: the
 * diff window's other caller, a tool turn's inspect control, passes a bare
 * target with no separator in it, and `parse` declining that is what keeps
 * that entry point on its own "not available yet" note instead of asking the
 * server to read a file it has no project for.
 */
const SEP = "\u0000";

export interface FileView {
  projectPath: string;
  file: string;
  /** The pre-rename name, for a renamed file — git only reports a rename when
   * it is given both sides. */
  previousPath?: string;
}

export function fileViewKey(
  projectPath: string,
  file: string,
  previousPath?: string,
): string {
  return [projectPath, file, previousPath ?? ""].join(SEP);
}

export function parseFileViewKey(key: string): FileView | undefined {
  const parts = key.split(SEP);
  if (parts.length !== 3) return undefined;
  const [projectPath, file, previousPath] = parts;
  if (!projectPath || !file) return undefined;
  return { projectPath, file, ...(previousPath ? { previousPath } : {}) };
}
