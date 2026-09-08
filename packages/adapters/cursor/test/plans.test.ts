import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { listProjectPlans, parsePlanFile } from "../src/plans.js";

/** plans.ts reads `process.env.HOME` through `cursorHome()`, the same seam
 * `transcripts.test.ts` uses — the CLI writes its plans under the operator's
 * own home, not the project. Restored in `after`. */
let home = "";
let originalHome: string | undefined;
let projectDir = "";

const PROJECT = "/workspace/demo";

/** A plan exactly as the CLI writes it: id comment, then the frontmatter it
 * only emits when there is something to put in it, then the markdown. */
function cliPlan(
  chatId: string,
  body: string,
  opts: { todos?: string[] } = {},
): string {
  const lines = [`<!-- ${chatId} -->`];
  if (opts.todos !== undefined) {
    lines.push("---", "todos:");
    opts.todos.forEach((status, i) => {
      lines.push(`  - id: "t${i}"`, `    content: "step ${i}"`, `    status: ${status}`);
    });
    lines.push("isProject: false", "---");
  }
  lines.push(body);
  return lines.join("\n");
}

async function writeUserPlan(name: string, source: string, mtimeMs?: number): Promise<string> {
  const dir = path.join(home, ".cursor", "plans");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, source, "utf8");
  if (mtimeMs !== undefined) {
    const when = new Date(mtimeMs);
    await utimes(file, when, when);
  }
  return file;
}

async function writeProjectPlan(name: string, source: string): Promise<string> {
  const dir = path.join(projectDir, ".cursor", "plans");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, source, "utf8");
  return file;
}

/** The `chats/<hash>/<chatId>/meta.json` that `findProjectDirForSession`
 * scans for — the only thing tying a user-scoped plan to a project. */
async function registerChat(chatId: string, cwd: string): Promise<void> {
  const dir = path.join(home, ".cursor", "chats", "hash-0", chatId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ createdAtMs: 1, updatedAtMs: 2, cwd }),
    "utf8",
  );
}

describe("cursor plans", () => {
  before(() => {
    originalHome = process.env.HOME;
  });

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "cursor-plans-"));
    process.env.HOME = home;
    projectDir = await mkdtemp(path.join(tmpdir(), "cursor-project-"));
  });

  after(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  it("reads the chat id out of the CLI's leading comment", () => {
    const parsed = parsePlanFile(cliPlan("chat-abc", "# Ship it\n\nDo the thing."));
    assert.equal(parsed.sessionId, "chat-abc");
    assert.equal(parsed.body, "# Ship it\n\nDo the thing.");
  });

  it("reports no session for a file that carries no id comment", () => {
    const parsed = parsePlanFile("# Ship it\n\nDo the thing.");
    assert.equal(parsed.sessionId, "");
    assert.equal(parsed.body, "# Ship it\n\nDo the thing.");
  });

  it("sees nested todo statuses, which a flat frontmatter reader misses", () => {
    const parsed = parsePlanFile(
      cliPlan("chat-1", "# Ship it", { todos: ["pending", "completed"] }),
    );
    assert.deepEqual(parsed.todoStatuses, ["pending", "completed"]);
  });

  it("reads the desktop app's frontmatter name", () => {
    const parsed = parsePlanFile(
      ["---", 'name: Scaleway deploy setup', "overview: something", "todos: []", "---", "", "## Context"].join("\n"),
    );
    assert.equal(parsed.name, "Scaleway deploy setup");
    assert.equal(parsed.body, "## Context");
  });

  it("lists a CLI plan once its chat resolves to this project", async () => {
    await registerChat("chat-1", projectDir);
    await writeUserPlan("Ship it-chat-1.plan.md", cliPlan("chat-1", "# Ship it\n\nbody"));

    const plans = await listProjectPlans(projectDir);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.title, "Ship it");
    assert.equal(plans[0]?.sessionId, "chat-1");
    assert.equal(plans[0]?.projectDir, projectDir);
    assert.equal(plans[0]?.derived, "proposed");
  });

  it("marks a plan in progress when a todo has moved off pending", async () => {
    await registerChat("chat-1", projectDir);
    await writeUserPlan(
      "Ship it-chat-1.plan.md",
      cliPlan("chat-1", "# Ship it", { todos: ["completed"] }),
    );

    const plans = await listProjectPlans(projectDir);
    assert.equal(plans[0]?.derived, "in-progress");
  });

  it("gives two plans from one chat distinct ids", async () => {
    await registerChat("chat-1", projectDir);
    const older = await writeUserPlan(
      "First-chat-1.plan.md",
      cliPlan("chat-1", "# First"),
      Date.now() - 60_000,
    );
    const newer = await writeUserPlan(
      "Second-chat-1.plan.md",
      cliPlan("chat-1", "# Second"),
      Date.now(),
    );

    const plans = await listProjectPlans(projectDir);
    assert.equal(plans.length, 2);
    assert.notEqual(plans[0]?.id, plans[1]?.id);
    assert.deepEqual(
      [...plans.map((p) => p.id)].sort(),
      [older, newer].sort(),
    );
  });

  it("supersedes the older plan when one chat proposed two", async () => {
    await registerChat("chat-1", projectDir);
    await writeUserPlan("First-chat-1.plan.md", cliPlan("chat-1", "# First"), Date.now() - 60_000);
    await writeUserPlan("Second-chat-1.plan.md", cliPlan("chat-1", "# Second"), Date.now());

    const plans = await listProjectPlans(projectDir);
    // Newest first, so the survivor leads and the earlier one is retired.
    assert.equal(plans[0]?.title, "Second");
    assert.equal(plans[0]?.derived, "proposed");
    assert.equal(plans[1]?.title, "First");
    assert.equal(plans[1]?.derived, "superseded");
  });

  it("excludes a plan whose chat belongs to another project", async () => {
    await registerChat("chat-elsewhere", "/workspace/other");
    await writeUserPlan("Other-chat-elsewhere.plan.md", cliPlan("chat-elsewhere", "# Other"));

    assert.deepEqual(await listProjectPlans(projectDir), []);
  });

  it("drops a plan whose chat id resolves to nothing rather than throwing", async () => {
    await writeUserPlan("Ghost-chat-gone.plan.md", cliPlan("chat-gone", "# Ghost"));

    assert.deepEqual(await listProjectPlans(projectDir), []);
  });

  it("lists a project-scoped desktop plan without needing a chat", async () => {
    await writeProjectPlan(
      "scaleway-deploy.plan.md",
      ["---", "name: Scaleway deploy setup", "todos: []", "---", "", "## Context", "", "Deploy it."].join("\n"),
    );

    const plans = await listProjectPlans(projectDir);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.title, "Scaleway deploy setup");
    assert.equal(plans[0]?.sessionId, "");
    assert.equal(plans[0]?.derived, "proposed");
  });

  it("titles a plan with no heading from its first line of prose", async () => {
    await writeProjectPlan(
      "untitled.plan.md",
      ["## Context", "", "Move the deploy off cPanel.", "", "## Steps"].join("\n"),
    );

    const plans = await listProjectPlans(projectDir);
    assert.equal(plans[0]?.title, "Move the deploy off cPanel.");
  });

  it("reports no plans when neither folder exists", async () => {
    assert.deepEqual(await listProjectPlans(projectDir), []);
  });
});
