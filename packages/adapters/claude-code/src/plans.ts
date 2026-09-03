import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AdapterPlan } from "@overseer/protocol";
import { parseJsonlFile, type JsonlRecord } from "./jsonl.js";
import { projectDirSlug } from "./project-slug.js";

/** The tool the CLI calls to hand a finished plan back to the operator. Its
 * input carries the plan markdown, which is the only place that text exists —
 * the CLI does not write plans to disk as documents. */
const PLAN_TOOL = "ExitPlanMode";

/** Tools whose appearance after a plan means the session went on to act on it.
 * `Bash` is in here because a plan is just as often carried out by commands as
 * by edits, and a session that ran neither has plainly not started. */
const MUTATING_TOOLS = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Bash",
]);

/** How much of the first line a row can show before it stops being a title. */
const TITLE_MAX_CHARS = 72;

interface ToolUseBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

function toolUsesOf(record: JsonlRecord): ToolUseBlock[] {
  const content = record.message?.content;
  if (!Array.isArray(content)) return [];
  const blocks: ToolUseBlock[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as ToolUseBlock;
    if (b.type === "tool_use") blocks.push(b);
  }
  return blocks;
}

function planText(block: ToolUseBlock): string | undefined {
  const input = block.input;
  if (typeof input !== "object" || input === null) return undefined;
  const plan = (input as { plan?: unknown }).plan;
  return typeof plan === "string" && plan.trim() !== "" ? plan : undefined;
}

/**
 * A line to put on the row.
 *
 * A plan that names itself (`# Ship the thing`) has already answered this. One
 * that opens straight into its sections does not: real plans routinely start
 * `## Context`, and a list of rows all reading "Context" names nothing. So the
 * section header is passed over for the first line of actual prose, which is
 * the plan saying what it is about in its own words.
 */
function titleOf(plan: string): string {
  const lines = plan.split(/\r?\n/);
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

function clamp(line: string): string {
  return line.length > TITLE_MAX_CHARS
    ? `${line.slice(0, TITLE_MAX_CHARS - 1)}…`
    : line;
}

/** Every plan one transcript holds, in the order it proposed them. */
function plansInTranscript(
  records: JsonlRecord[],
  sessionId: string,
  projectDir: string,
): AdapterPlan[] {
  const plans: AdapterPlan[] = [];
  // Index of the record each plan was proposed at, so "what happened after"
  // is a scan forward from there rather than a second pass over the file.
  const proposedAt: number[] = [];

  records.forEach((record, index) => {
    if (record.type !== "assistant") return;
    for (const block of toolUsesOf(record)) {
      if (block.name !== PLAN_TOOL) continue;
      const body = planText(block);
      if (body === undefined) continue;
      plans.push({
        id: block.id ?? `${sessionId}:${index}`,
        sessionId,
        projectDir: record.cwd ?? projectDir,
        title: titleOf(body),
        body,
        createdAt: record.timestamp ?? new Date(0).toISOString(),
        derived: "proposed",
      });
      proposedAt.push(index);
    }
  });

  return plans.map((plan, i) => {
    // A newer plan in the same session replaces this one: the operator asked
    // again, and the answer they are working from is the later one.
    if (i < plans.length - 1) return { ...plan, derived: "superseded" as const };
    const from = proposedAt[i]! + 1;
    for (let index = from; index < records.length; index += 1) {
      const record = records[index]!;
      if (record.type !== "assistant") continue;
      for (const block of toolUsesOf(record)) {
        if (block.name !== undefined && MUTATING_TOOLS.has(block.name)) {
          return { ...plan, derived: "in-progress" as const };
        }
      }
    }
    return plan;
  });
}

/**
 * Every plan the CLI's own transcripts hold for one project, newest first.
 *
 * Read rather than tracked: a plan proposed before Overseer ever knew about
 * plans is still on disk, and re-reading is also what keeps the list honest
 * after a session is resumed from a terminal Overseer never saw.
 */
export async function listPlansForProject(
  configDir: string,
  projectDir: string,
): Promise<AdapterPlan[]> {
  const dir = path.join(configDir, "projects", projectDirSlug(projectDir));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const plans: AdapterPlan[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.slice(0, -".jsonl".length);
    const records = await parseJsonlFile(path.join(dir, file));
    plans.push(...plansInTranscript(records, sessionId, projectDir));
  }

  return plans.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
