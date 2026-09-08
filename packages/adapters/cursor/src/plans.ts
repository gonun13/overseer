import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AdapterPlan } from "@overseer/protocol";
import { cursorHome, findProjectDirForSession } from "./transcripts.js";

/**
 * Cursor's plans, read off disk — captured against the real CLI (`agent
 * 2026.09.02-c22c1a3`, `./src/utils/plan-utils.ts`), not published.
 *
 * Unlike claude-code, where a plan exists only as an `ExitPlanMode` tool call
 * buried in a transcript, cursor writes each plan out as its own file:
 *
 *   ~/.cursor/plans/<title>-<chatId first 8>.plan.md   the CLI's own output
 *   <project>/.cursor/plans/*.plan.md                  older desktop-app plans
 *
 * A CLI-written file always opens with `<!-- <conversationId> -->` carrying the
 * full chat id, which is what ties a plan back to the session that can continue
 * it. Desktop-app files carry no such comment and are attributed by where they
 * sit instead.
 *
 * Note the CLI writes its plans to the *user's* home, not the project — so a
 * plan does not know which project it belongs to, and the chat id is the only
 * way to find out. Plans whose session cannot be resolved to this project are
 * dropped rather than guessed at.
 */

const PLAN_SUFFIX = ".plan.md";

/** How much of the first line a row can show before it stops being a title.
 * The same ceiling claude-code's plan reader uses — this feeds the same
 * window, and two different clamps would read as a bug. */
const TITLE_MAX_CHARS = 72;

/** `<!-- 0199a4f2-... -->` on the first line, and nothing else on that line. */
const ID_COMMENT = /^<!--\s*(\S+)\s*-->\s*$/;

/**
 * A todo line's `status`, which is nested two levels into the frontmatter and
 * so is deliberately matched on its indentation.
 *
 * This is the whole reason this module does not borrow claude-code's
 * `splitFrontmatter`: that reader is flat and anchored (`^([A-Za-z_][\w-]*)`),
 * so every indented line here is invisible to it and every plan would read as
 * `proposed`. One nested field is not worth a YAML dependency, but it is worth
 * a scanner that can actually see it.
 */
const TODO_STATUS = /^\s+status\s*:\s*(\S+)/;

interface ParsedPlan {
  /** The chat that produced it, or "" for a file that does not say. */
  sessionId: string;
  /** Frontmatter `name`, which only the desktop dialect writes. */
  name?: string;
  /** Every todo status the frontmatter declared, in file order. */
  todoStatuses: string[];
  body: string;
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  const double = /^"(.*)"$/s.exec(trimmed);
  if (double !== null) return (double[1] as string).replace(/\\([\\"])/g, "$1");
  const single = /^'(.*)'$/s.exec(trimmed);
  if (single !== null) return (single[1] as string).trim();
  return trimmed;
}

/**
 * Split a plan file into the three things this reader wants from it.
 *
 * Both dialects are handled by the same pass, because they differ only in
 * which keys they happen to carry: the CLI writes `todos`/`isProject`/`phases`
 * under an id comment, the desktop app writes `name`/`overview`/`todos` under
 * nothing. Neither is required — a file that is all markdown is a valid plan
 * whose body is the whole file.
 */
export function parsePlanFile(source: string): ParsedPlan {
  const lines = source.split(/\r?\n/);
  let at = 0;

  let sessionId = "";
  const comment = ID_COMMENT.exec(lines[0] ?? "");
  if (comment !== null) {
    sessionId = comment[1] as string;
    at = 1;
  }

  let name: string | undefined;
  const todoStatuses: string[] = [];
  if (lines[at]?.trim() === "---") {
    let close = lines.length;
    for (let i = at + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (line.trim() === "---") {
        close = i;
        break;
      }
      const status = TODO_STATUS.exec(line);
      if (status !== null) {
        todoStatuses.push(status[1] as string);
        continue;
      }
      const flat = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (flat !== null && flat[1] === "name" && name === undefined) {
        const value = unquote(flat[2] ?? "");
        if (value !== "") name = value;
      }
    }
    at = close + 1;
  }

  // One blank line after the frontmatter is the conventional separator rather
  // than part of the plan; the trailing newline is a property of files.
  const rest = lines.slice(at);
  if (rest[0] === "") rest.shift();
  const parsed: ParsedPlan = {
    sessionId,
    todoStatuses,
    body: rest.join("\n").replace(/\s+$/, ""),
  };
  if (name !== undefined) parsed.name = name;
  return parsed;
}

function clamp(line: string): string {
  return line.length > TITLE_MAX_CHARS
    ? `${line.slice(0, TITLE_MAX_CHARS - 1)}…`
    : line;
}

/**
 * A line to put on the row — the same rule claude-code's reader uses, so the
 * plans window reads consistently whichever provider filled it.
 *
 * A plan that names itself (`# Ship the thing`) has already answered this. One
 * that opens straight into its sections has not: real plans routinely start
 * `## Context`, and a list of rows all reading "Context" names nothing.
 */
function titleOf(plan: ParsedPlan): string {
  if (plan.name !== undefined) return clamp(plan.name);
  const lines = plan.body.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("# ")) return clamp(line.slice(2).trim());
  }
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    return clamp(line.replace(/^[-*]\s+/, ""));
  }
  for (const raw of lines) {
    const line = raw.replace(/^\s*#+\s*/, "").trim();
    if (line !== "") return clamp(line);
  }
  return "untitled plan";
}

/** The two folders a plan can be sitting in, in the order they are read. */
function plansDirs(projectDir: string): { dir: string; owned: boolean }[] {
  return [
    // The CLI's own output: user-scoped, so it says nothing about which
    // project it belongs to and has to be attributed by its chat id.
    { dir: path.join(cursorHome(), ".cursor", "plans"), owned: false },
    // Desktop-app plans, which sit in the project they belong to.
    { dir: path.join(projectDir, ".cursor", "plans"), owned: true },
  ];
}

/** The project a user-scoped plan belongs to, or undefined when it cannot be
 * told. `findProjectDirForSession` throws on an id it has never seen, which
 * for this reader is an ordinary outcome, not a failure. */
async function ownerOf(sessionId: string): Promise<string | undefined> {
  if (sessionId === "") return undefined;
  try {
    return await findProjectDirForSession(sessionId);
  } catch {
    return undefined;
  }
}

/**
 * Every plan on disk for one project, newest first.
 *
 * Never throws: a project with no plans folder is the ordinary case, and an
 * unreadable file reports no plan rather than failing the whole window.
 */
export async function listProjectPlans(projectDir: string): Promise<AdapterPlan[]> {
  const plans: AdapterPlan[] = [];

  for (const { dir, owned } of plansDirs(projectDir)) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(PLAN_SUFFIX)) continue;
      const file = path.join(dir, entry);

      let source: string;
      let createdAt: string;
      try {
        source = await readFile(file, "utf8");
        createdAt = (await stat(file)).mtime.toISOString();
      } catch {
        continue;
      }

      const parsed = parsePlanFile(source);
      if (!owned && (await ownerOf(parsed.sessionId)) !== projectDir) continue;

      plans.push({
        // The file path, not the chat id: the CLI names files
        // `<title>-<chatId first 8>.plan.md`, so one chat that proposes two
        // differently-titled plans writes two files carrying the same id.
        // Keying on that id would collide, and an operator marking one plan
        // done would silently mark the other one too. The path is unique and
        // just as stable across rescans, which is all the id has to be.
        id: file,
        sessionId: parsed.sessionId,
        projectDir,
        title: titleOf(parsed),
        body: parsed.body,
        createdAt,
        derived: parsed.todoStatuses.some((status) => status !== "pending")
          ? "in-progress"
          : "proposed",
      });
    }
  }

  plans.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // A newer plan from the same chat replaces the older one: the operator asked
  // again, and the answer they are working from is the later one. Plans with no
  // chat id are not grouped — nothing says they came from the same place.
  const seen = new Set<string>();
  return plans.map((plan) => {
    if (plan.sessionId === "") return plan;
    if (seen.has(plan.sessionId)) return { ...plan, derived: "superseded" as const };
    seen.add(plan.sessionId);
    return plan;
  });
}
