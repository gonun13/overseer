/**
 * Telling what the operator actually typed apart from what the CLI wrote for
 * its own bookkeeping.
 *
 * Claude Code's transcript records both under `type: "user"`. Running a slash
 * command writes three of them before the operator's next real prompt: a meta
 * record carrying the caveat banner, the command echo, and the command's
 * stdout. Taking "the first user record" at face value therefore titles a
 * session `<local-command-caveat>` — and replays the plumbing as operator turns
 * when the transcript is backfilled — for any session whose first act was
 * `/model`, `/agents`, or any other command.
 */

/** The wrappers the CLI puts around its own text. Not an exhaustive list of
 * everything it may ever emit — anything left unrecognised simply reads as
 * operator text, which is the safe direction to fail. */
const SYNTHETIC_TAGS = [
  "local-command-caveat",
  "local-command-stdout",
  "local-command-stderr",
  "command-name",
  "command-message",
  "command-args",
  "system-reminder",
] as const;

const SYNTHETIC_BLOCK = new RegExp(
  `<(${SYNTHETIC_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>`,
  "gi",
);

/** A tag left unclosed, or its orphaned closer. */
const SYNTHETIC_TAG = new RegExp(
  `</?(?:${SYNTHETIC_TAGS.join("|")})\\b[^>]*>`,
  "gi",
);

export interface TextRecord {
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: unknown;
  };
}

/** Flatten a message's content to its text blocks. Tool calls and results
 * carry no `text` block and so flatten to "". */
export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("");
}

/**
 * The operator's own words from a `type: "user"` record, or `undefined` when
 * the record is the CLI talking to itself.
 *
 * Stripping rather than rejecting outright: a genuine prompt can arrive with a
 * `<system-reminder>` appended to it, and that prompt is still the operator's.
 * Only a record with nothing left after the wrappers come off is discarded.
 */
export function operatorText(record: TextRecord): string | undefined {
  // The caveat banner is marked meta by the CLI, which is the one reliable
  // signal here — it holds even if the wrapper tag is ever renamed.
  if (record.isMeta === true) return undefined;
  const raw = textFromContent(record.message?.content);
  if (raw === "") return undefined;
  const stripped = raw
    .replace(SYNTHETIC_BLOCK, "")
    .replace(SYNTHETIC_TAG, "")
    .trim();
  if (stripped === "") return undefined;
  return stripped;
}
