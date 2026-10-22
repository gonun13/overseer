import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { CliRunner } from "../src/cli.js";
import type { ServeClient, ServeFactory } from "../src/serve.js";
import { dbPath, sessionStore, title } from "../src/sessions.js";

/** The columns this adapter reads, from the pinned CLI's `session` table. */
const SCHEMA = `CREATE TABLE session (
  id text PRIMARY KEY, project_id text NOT NULL, parent_id text,
  directory text NOT NULL, title text NOT NULL,
  time_created integer NOT NULL, time_updated integer NOT NULL,
  time_archived integer)`;

let root: string;
let env: NodeJS.ProcessEnv;

function seed(
  rows: Array<{
    id: string;
    directory: string;
    title: string;
    created: number;
    updated: number;
    parent?: string;
    archived?: number;
  }>,
) {
  const db = new DatabaseSync(dbPath(env));
  db.exec(SCHEMA);
  const insert = db.prepare(
    "INSERT INTO session VALUES (?, 'p', ?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows)
    insert.run(
      row.id,
      row.parent ?? null,
      row.directory,
      row.title,
      row.created,
      row.updated,
      row.archived ?? null,
    );
  db.close();
}

function fakeCli(answer: { code: number; stdout?: string; stderr?: string }) {
  const calls: Array<{ args: string[]; cwd?: string }> = [];
  const run: CliRunner = async (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    return { stdout: "", stderr: "", ...answer };
  };
  return { run, calls };
}

function fakeServe(answer: unknown) {
  const calls: Array<{
    cwd: string;
    method: string;
    path: string;
    opts: unknown;
  }> = [];
  let closed = 0;
  const factory: ServeFactory = async (cwd) =>
    ({
      async request(method, requestPath, opts) {
        calls.push({ cwd, method, path: requestPath, opts });
        return answer as never;
      },
      async close() {
        closed += 1;
      },
    }) satisfies ServeClient;
  return {
    factory,
    calls,
    get closed() {
      return closed;
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "overseer-opencode-"));
  env = { HOME: root, XDG_DATA_HOME: path.join(root, "data") };
  await mkdir(path.join(root, "data", "opencode"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listProjectSessions", () => {
  it("lists the operator's sessions in this project, newest first", async () => {
    seed([
      {
        id: "ses_old",
        directory: "/workspace/demo",
        title: "Fix the parser",
        created: 1_000,
        updated: 2_000,
      },
      {
        id: "ses_new",
        directory: "/workspace/demo",
        title: "New session - 2026-10-22T21:55:19.907Z",
        created: 3_000,
        updated: 4_000,
      },
      {
        id: "ses_child",
        directory: "/workspace/demo",
        title: "Explore the repo (@general subagent)",
        created: 3_100,
        updated: 3_200,
        parent: "ses_new",
      },
      {
        id: "ses_archived",
        directory: "/workspace/demo",
        title: "Gone",
        created: 1,
        updated: 1,
        archived: 5,
      },
      {
        id: "ses_elsewhere",
        directory: "/workspace/other",
        title: "Other project",
        created: 1,
        updated: 1,
      },
    ]);
    const store = sessionStore({
      serve: fakeServe({}).factory,
      cli: fakeCli({ code: 0 }).run,
      env,
    });
    const sessions = await store.listProjectSessions("/workspace/demo");
    assert.deepEqual(
      sessions.map((s) => [s.id, s.name]),
      [
        ["ses_new", undefined],
        ["ses_old", "Fix the parser"],
      ],
    );
    assert.deepEqual(sessions[1], {
      id: "ses_old",
      adapterId: "opencode",
      projectDir: "/workspace/demo",
      name: "Fix the parser",
      status: "dormant",
      createdAt: new Date(1_000).toISOString(),
      lastActiveAt: new Date(2_000).toISOString(),
      totalCostUsd: 0,
    });
  });

  it("is empty before the CLI has ever run", async () => {
    const store = sessionStore({
      serve: fakeServe({}).factory,
      cli: fakeCli({ code: 0 }).run,
      env,
    });
    assert.deepEqual(await store.listProjectSessions("/workspace/demo"), []);
  });
});

describe("titles", () => {
  it("leaves the CLI's placeholder unnamed until it titles the session", () => {
    assert.equal(
      title({ title: "New session - 2026-10-22T21:55:19.907Z" }),
      undefined,
    );
    assert.equal(title({ title: "  Pong  " }), "Pong");
  });

  it("looks a title up only within its project", async () => {
    seed([
      {
        id: "ses_a",
        directory: "/workspace/demo",
        title: "Pong",
        created: 1,
        updated: 1,
      },
    ]);
    const store = sessionStore({
      serve: fakeServe({}).factory,
      cli: fakeCli({ code: 0 }).run,
      env,
    });
    assert.equal(
      await store.lookupSessionTitle("/workspace/demo", "ses_a"),
      "Pong",
    );
    assert.equal(
      await store.lookupSessionTitle("/workspace/other", "ses_a"),
      undefined,
    );
  });
});

describe("deleteSession", () => {
  beforeEach(() =>
    seed([
      {
        id: "ses_a",
        directory: "/workspace/demo",
        title: "Pong",
        created: 1,
        updated: 1,
      },
    ]),
  );

  it("deletes through the CLI, in the project", async () => {
    const cli = fakeCli({ code: 0 });
    const store = sessionStore({
      serve: fakeServe({}).factory,
      cli: cli.run,
      env,
    });
    await store.deleteSession("/workspace/demo", "ses_a");
    assert.deepEqual(cli.calls, [
      { args: ["session", "delete", "ses_a"], cwd: "/workspace/demo" },
    ]);
  });

  it("starts no CLI for an id this project does not own", async () => {
    const cli = fakeCli({ code: 0 });
    const store = sessionStore({
      serve: fakeServe({}).factory,
      cli: cli.run,
      env,
    });
    await store.deleteSession("/workspace/other", "ses_a");
    await store.deleteSession("/workspace/demo", "0b8e0c39-loop-uuid");
    assert.deepEqual(cli.calls, []);
  });

  it("treats a session the CLI no longer has as deleted", async () => {
    const store = sessionStore({
      serve: fakeServe({}).factory,
      cli: fakeCli({ code: 1, stderr: "Error: Session not found: ses_a" }).run,
      env,
    });
    await store.deleteSession("/workspace/demo", "ses_a");
  });

  it("fails on any other CLI failure", async () => {
    const store = sessionStore({
      serve: fakeServe({}).factory,
      cli: fakeCli({ code: 1, stderr: "database is locked" }).run,
      env,
    });
    await assert.rejects(store.deleteSession("/workspace/demo", "ses_a"));
  });
});

describe("mintSessionId", () => {
  it("creates an empty session in the project and closes the server", async () => {
    const serve = fakeServe({ id: "ses_e9a6", directory: "/workspace/demo" });
    const store = sessionStore({
      serve: serve.factory,
      cli: fakeCli({ code: 0 }).run,
      env,
    });
    assert.equal(
      await store.mintSessionId({
        projectDir: "/workspace/demo",
        prompt: "hi",
      }),
      "ses_e9a6",
    );
    assert.deepEqual(serve.calls, [
      {
        cwd: "/workspace/demo",
        method: "POST",
        path: "/session",
        opts: { query: { directory: "/workspace/demo" }, body: {} },
      },
    ]);
    assert.equal(serve.closed, 1);
  });

  it("refuses an answer that is not a session in this project", async () => {
    for (const answer of [
      { id: "ses_x", directory: "/workspace/other" },
      { id: "not-an-id", directory: "/workspace/demo" },
      undefined,
    ]) {
      const serve = fakeServe(answer);
      const store = sessionStore({
        serve: serve.factory,
        cli: fakeCli({ code: 0 }).run,
        env,
      });
      await assert.rejects(
        store.mintSessionId({ projectDir: "/workspace/demo" }),
      );
      assert.equal(serve.closed, 1);
    }
  });
});
