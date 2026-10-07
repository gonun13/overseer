import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoginUpdate } from "@overseer/protocol";
import { createCodexAdapter } from "../src/index.js";
import type {
  ClientFactory,
  Notification,
  RpcClient,
} from "../src/app-server.js";
import { parseUsage } from "../src/usage.js";
import { title, type Thread } from "../src/sessions.js";

function harness(
  opts: {
    complete?: boolean;
    quotaError?: boolean;
    windows?: boolean;
    nameError?: boolean;
    persistError?: boolean;
    failConnect?: boolean;
    freshSignedOut?: boolean;
  } = {},
) {
  const calls: Array<{ method: string; params: any }> = [];
  const clients: Array<{ closed: boolean }> = [];
  let signedIn = false;
  const factory: ClientFactory = async () => {
    if (opts.failConnect) throw new Error("credentials must not escape");
    const record = { closed: false };
    clients.push(record);
    const listeners = new Set<(notification: Notification) => void>();
    return {
      async request<T>(method: string, params: any = {}): Promise<T> {
        calls.push({ method, params });
        let result: unknown = {};
        if (method === "account/read")
          result = { account: signedIn ? { type: "chatgpt" } : null };
        if (method === "account/logout") signedIn = false;
        if (method === "account/login/start") {
          if (opts.complete !== false) {
            signedIn = !opts.freshSignedOut;
            // Deliberately before the response, to exercise the notification race.
            for (const notify of listeners)
              notify({
                method: "account/login/completed",
                params: { loginId: "login-1", success: true },
              });
          }
          result = {
            type: "chatgptDeviceCode",
            loginId: "login-1",
            verificationUrl: "https://auth.openai.com/codex/device",
            userCode: "ABCD-1234",
          };
        }
        if (method === "account/rateLimits/read") {
          if (opts.quotaError) throw new Error("secret quota error");
          result =
            opts.windows === false
              ? {}
              : {
                  rateLimits: {
                    primary: {
                      usedPercent: 42,
                      windowDurationMins: 300,
                      resetsAt: 1800000000,
                    },
                  },
                };
        }
        if (method === "thread/start") result = { thread: thread("native-id") };
        if (method === "thread/name/set" && opts.nameError)
          throw new Error("name failed");
        if (method === "thread/resume" && opts.persistError)
          throw new Error("persist failed");
        if (method === "thread/read")
          result = { thread: thread(params.threadId) };
        if (method === "thread/list")
          result = params.cursor
            ? { data: [thread("second")], nextCursor: null }
            : {
                data: [
                  thread("first"),
                  thread("elsewhere", { cwd: "/workspace/ab" }),
                  thread("child", { parentThreadId: "first" }),
                  thread("exec", { source: "exec" }),
                  thread("sub", { source: { subAgent: {} } }),
                  thread("ephemeral", { ephemeral: true }),
                ],
                nextCursor: "page2",
              };
        return result as T;
      },
      onNotification(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      async close() {
        record.closed = true;
      },
    } satisfies RpcClient;
  };
  return {
    adapter: createCodexAdapter(factory, 15),
    calls,
    clients,
    signIn: () => {
      signedIn = true;
    },
  };
}

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    cwd: "/workspace/a",
    source: "appServer",
    createdAt: 1700000000,
    updatedAt: 1700000001,
    name: "new session",
    preview: "first message",
    gitInfo: { branch: "work" },
    ...overrides,
  };
}

describe("Codex account and device login", () => {
  it("emits browser instructions, verifies fresh auth and closes every client", async () => {
    const h = harness();
    const updates: LoginUpdate[] = [];
    assert.equal((await h.adapter.getStatus()).authenticated, false);
    const handle = h.adapter.login!.start((u) => updates.push(u));
    handle.submitCode("ignored");
    const status = await handle.done;
    assert.equal(status.authenticated, true);
    assert.deepEqual(
      updates.map((u) => u.phase),
      ["starting", "awaiting-browser", "success"],
    );
    assert.equal(updates[1]!.userCode, "ABCD-1234");
    assert.equal(
      updates[1]!.verificationUrl,
      "https://auth.openai.com/codex/device",
    );
    assert.equal(h.calls.at(-1)!.method, "account/read");
    assert.ok(h.clients.every((c) => c.closed));
  });
  it("does not trust the login notification without a fresh signed-in account", async () => {
    const h = harness({ freshSignedOut: true });
    const updates: LoginUpdate[] = [];
    await h.adapter.login!.start((u) => updates.push(u)).done;
    assert.equal(updates.at(-1)!.phase, "failed");
  });
  it("cancels a device grant and reaps the client", async () => {
    const h = harness({ complete: false });
    const updates: LoginUpdate[] = [];
    let ready!: () => void;
    const instructions = new Promise<void>((r) => {
      ready = r;
    });
    const handle = h.adapter.login!.start((u) => {
      updates.push(u);
      if (u.phase === "awaiting-browser") ready();
    });
    await instructions;
    handle.cancel();
    await handle.done;
    assert.equal(updates.at(-1)!.detail, "login cancelled");
    assert.ok(
      h.calls.some(
        (c) =>
          c.method === "account/login/cancel" && c.params.loginId === "login-1",
      ),
    );
    assert.ok(h.clients.every((c) => c.closed));
  });
  it("handles cancellation before initialization completes", async () => {
    const h = harness({ complete: false });
    const handle = h.adapter.login!.start(() => {});
    handle.cancel();
    await handle.done;
    assert.equal(
      h.calls.filter((c) => c.method === "account/login/start").length,
      0,
    );
    assert.ok(h.clients.every((c) => c.closed));
  });
  it("times out a device login without leaking its grant", async () => {
    const h = harness({ complete: false });
    const updates: LoginUpdate[] = [];
    await h.adapter.login!.start((u) => updates.push(u)).done;
    assert.equal(updates.at(-1)!.detail, "Codex login timed out");
    assert.equal(updates.at(-1)!.userCode, undefined);
    assert.ok(h.clients.every((c) => c.closed));
  });
  it("signs out natively and is idempotent", async () => {
    const h = harness();
    h.signIn();
    await h.adapter.login!.signOut();
    await h.adapter.login!.signOut();
    assert.equal((await h.adapter.getStatus()).authenticated, false);
    assert.equal(
      h.calls.filter((c) => c.method === "account/logout").length,
      2,
    );
  });
  it("reports unreachable status with sanitized errors", async () => {
    const status = await harness({ failConnect: true }).adapter.getStatus();
    assert.equal(status.reachable, false);
    assert.ok(!JSON.stringify(status).includes("credentials"));
  });
});

describe("Codex usage", () => {
  it("reads quotas for background and manual checks without a turn", async () => {
    const h = harness();
    h.signIn();
    assert.equal((await h.adapter.getStatus()).usageState, "pending");
    const status = await h.adapter.refreshUsage!();
    assert.equal(status.usageState, "ready");
    assert.equal(status.usage![0]!.used, 0.42);
    assert.equal(status.usage![0]!.label, "5 hours");
    assert.equal(
      (await h.adapter.checkUsage!({ projectDir: "/workspace/a" })).ok,
      true,
    );
    assert.ok(
      h.calls.every(
        (c) => !c.method.startsWith("turn/") && !c.method.startsWith("thread/"),
      ),
    );
  });
  for (const opts of [{ quotaError: true }, { windows: false }]) {
    it(`keeps auth when quotas are unavailable: ${JSON.stringify(opts)}`, async () => {
      const h = harness(opts);
      h.signIn();
      const status = await h.adapter.refreshUsage!();
      assert.equal(status.authenticated, true);
      assert.equal(status.usageState, "unavailable");
      assert.equal(status.usage, undefined);
      assert.equal(
        (await h.adapter.checkUsage!({ projectDir: "/workspace/a" })).ok,
        false,
      );
    });
  }
  it("maps supplied buckets, durations and resets; omits absent percentages", () => {
    const windows = parseUsage({
      rateLimits: { primary: { usedPercent: 99 } },
      rateLimitsByLimitId: {
        codex: {
          primary: {
            usedPercent: 0,
            windowDurationMins: 15,
            resetsAt: 1700000000,
          },
          secondary: { usedPercent: 125, windowDurationMins: 10080 },
        },
        review: {
          limitName: "Review",
          primary: { windowDurationMins: 60 },
          secondary: { usedPercent: -5, windowDurationMins: 1440 },
        },
      },
    });
    assert.deepEqual(
      windows.map((w) => [w.id, w.label, w.used]),
      [
        ["codex:primary", "codex · 15 minutes", 0],
        ["codex:secondary", "codex · week", 1],
        ["review:secondary", "review · 1 day", 0],
      ],
    );
    assert.equal(windows[0]!.resets, "2023-11-14 22:13:20 UTC");
    assert.deepEqual(parseUsage({}), []);
  });
});

describe("Codex native sessions", () => {
  it("paginates and filters by exact directory, interactive source and own thread id", async () => {
    const h = harness();
    const sessions =
      await h.adapter.sessions!.listProjectSessions("/workspace/a");
    assert.deepEqual(
      sessions.map((s) => s.id),
      ["first", "second"],
    );
    assert.equal(sessions[0]!.name, "first message");
    assert.equal(sessions[0]!.gitBranch, "work");
    assert.equal(sessions[0]!.createdAt, "2023-11-14T22:13:20.000Z");
    assert.deepEqual(h.calls[0]!.params.sourceKinds, [
      "cli",
      "vscode",
      "appServer",
    ]);
    assert.equal(h.calls[1]!.params.cursor, "page2");
  });
  it("persists an empty native thread by setting its initial name before console launch", async () => {
    const h = harness();
    const id = await h.adapter.sessions!.mintSessionId({
      projectDir: "/workspace/a",
      prompt: "fix it",
    });
    assert.equal(id, "native-id");
    assert.deepEqual(
      h.calls.map((c) => c.method),
      ["thread/start", "thread/name/set", "thread/resume"],
    );
    assert.equal(h.calls[0]!.params.cwd, "/workspace/a");
    assert.equal(h.calls[1]!.params.name, "fix it");
    assert.ok(h.clients.every((c) => c.closed));
    assert.deepEqual(
      await h.adapter.consoleCommand!({
        cwd: "/workspace/a",
        sessionId: id,
        prompt: "-fix it",
      }),
      {
        file: "codex",
        args: [
          "resume",
          "--no-daemon",
          "--sandbox",
          "danger-full-access",
          id,
          "--",
          "-fix it",
        ],
        cwd: "/workspace/a",
      },
    );
    assert.deepEqual(
      (
        await h.adapter.consoleCommand!({
          cwd: "/workspace/a",
          sessionId: id,
          resume: true,
          prompt: "ignored",
        })
      ).args,
      ["resume", "--no-daemon", "--sandbox", "danger-full-access", id],
    );
    await assert.rejects(h.adapter.consoleCommand!({ cwd: "/workspace/a" }));
  });
  it("removes prepared threads when naming fails and uses a generic title without a prompt", async () => {
    const h = harness({ nameError: true });
    await assert.rejects(
      h.adapter.sessions!.mintSessionId({ projectDir: "/workspace/a" }),
    );
    assert.equal(h.calls[1]!.params.name, "new session");
    assert.equal(h.calls[2]!.method, "thread/delete");
  });
  it("removes prepared threads it cannot persist", async () => {
    const h = harness({ persistError: true });
    await assert.rejects(
      h.adapter.sessions!.mintSessionId({ projectDir: "/workspace/a" }),
    );
    assert.deepEqual(
      h.calls.map((c) => c.method),
      ["thread/start", "thread/name/set", "thread/resume", "thread/delete"],
    );
  });
  it("uses explicit names, otherwise the first-message preview", () => {
    assert.equal(title(thread("a", { name: "My title" })), "My title");
    assert.equal(title(thread("a", { preview: "" })), "new session");
  });
  it("deletes through the native API and refuses the wrong project", async () => {
    const h = harness();
    await h.adapter.sessions!.deleteSession("/workspace/a", "first");
    assert.deepEqual(
      h.calls.map((c) => c.method),
      ["thread/read", "thread/delete"],
    );
    await assert.rejects(
      h.adapter.sessions!.deleteSession("/workspace/b", "first"),
    );
    assert.equal(h.calls.filter((c) => c.method === "thread/delete").length, 1);
  });
  it("wraps multiline relays in bracketed paste", () => {
    assert.equal(
      harness().adapter.relayInput!("hello\nworld"),
      "\x1b[200~hello\nworld\x1b[201~\r",
    );
  });
});
