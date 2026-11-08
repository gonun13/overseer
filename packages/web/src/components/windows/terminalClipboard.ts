/**
 * Clipboard rules for console terminals (spec/ui-ux.md §5.3).
 *
 * Pure, so they test under node; ConsoleTerminal wires them to xterm.
 */

/**
 * The text an OSC 52 sequence asks to put on the clipboard, or `null` when it
 * puts nothing there.
 *
 * `data` is what follows `ESC ] 52 ;` — `<selection>;<base64>`. TUIs that
 * capture the mouse (Codex, opencode) copy their own selections this way,
 * since the container has no clipboard of its own. A `?` payload asks the
 * terminal to *report* the clipboard: that is never answered, so nothing
 * running in a console can read what the operator copied. Every selection
 * buffer (`c`, `p`, `s`, none) lands on the one clipboard a browser has.
 */
export function osc52Text(data: string): string | null {
  const split = data.indexOf(";");
  if (split < 0) return null;
  const payload = data.slice(split + 1);
  if (payload === "" || payload === "?") return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export type ClipboardChord = "copy" | "paste" | null;

type ChordEvent = Pick<
  KeyboardEvent,
  "type" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "code"
>;

/**
 * Off a Mac, Ctrl+C and Ctrl+V belong to the CLI (interrupt, literal next),
 * so the terminal's copy and paste are Ctrl+Shift+C and Ctrl+Shift+V, as in
 * desktop terminals. On a Mac ⌘C and ⌘V already reach the browser untouched.
 */
export function clipboardChord(
  event: ChordEvent,
  mac: boolean,
): ClipboardChord {
  if (mac || event.type !== "keydown") return null;
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey)
    return null;
  if (event.code === "KeyC") return "copy";
  if (event.code === "KeyV") return "paste";
  return null;
}

/** Best effort: an operator on a Mac is who `macOptionClickForcesSelection`
 * and the ⌘ chords are for. */
export function isMacPlatform(
  nav: Pick<Navigator, "platform" | "userAgent">,
): boolean {
  return /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent);
}
