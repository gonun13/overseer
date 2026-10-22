import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectedProviders, type CliRunner } from "../src/cli.js";
import { consoleCommand, PLUGIN_ENV, relayInput } from "../src/console.js";
import { createOpencodeAdapter } from "../src/index.js";
import { isSessionsChange } from "../src/sessions.js";

function cli(answers: Record<string, { code: number; stdout?: string }>) {
  const calls: string[][] = [];
  const run: CliRunner = async (args) => {
    calls.push(args);
    const answer = answers[args.join(" ")] ?? { code: 1 };
    return { code: answer.code, stdout: answer.stdout ?? "", stderr: "" };
  };
  return { run, calls };
}

const unusedServe = async () => {
  throw new Error("serve is not started for status");
};

describe("getStatus", () => {
  it("is ready on the free models alone, with no credential", async () => {
    const { run } = cli({
      "--version": { code: 0, stdout: "1.19.4\n" },
      models: {
        code: 0,
        stdout: "opencode/big-pickle\nopencode/glm-5.3-flash-free\n",
      },
    });
    const adapter = createOpencodeAdapter({ cli: run, serve: unusedServe });
    assert.deepEqual(await adapter.getStatus(), {
      authenticated: true,
      version: "1.19.4",
      detail: "ready · free models",
      usageState: "unavailable",
    });
  });

  it("names the providers connected in the CLI", async () => {
    const { run } = cli({
      "--version": { code: 0, stdout: "1.19.4" },
      models: {
        code: 0,
        stdout:
          "opencode/big-pickle\nopenai/gpt-5.6-terra\ngithub-copilot/claude-sonnet-4.6\nopenai/gpt-5.5\n",
      },
    });
    const status = await createOpencodeAdapter({
      cli: run,
      serve: unusedServe,
    }).getStatus();
    assert.equal(status.detail, "ready · openai, github-copilot");
  });

  it("is unreachable when the CLI does not answer", async () => {
    const { run } = cli({});
    const status = await createOpencodeAdapter({
      cli: run,
      serve: unusedServe,
    }).getStatus();
    assert.equal(status.authenticated, false);
    assert.equal(status.reachable, false);
  });

  it("is not ready when no model can answer", async () => {
    const { run } = cli({
      "--version": { code: 0, stdout: "1.19.4" },
      models: { code: 1 },
    });
    const status = await createOpencodeAdapter({
      cli: run,
      serve: unusedServe,
    }).getStatus();
    assert.equal(status.authenticated, false);
    assert.equal(status.reachable, undefined);
    assert.match(status.detail ?? "", /connect a provider in opencode/);
  });

  it("offers no login and no usage reading", () => {
    const adapter = createOpencodeAdapter({
      cli: cli({}).run,
      serve: unusedServe,
    });
    assert.deepEqual(adapter.capabilities, {
      login: false,
      usageCheck: false,
    });
    assert.equal(adapter.login, undefined);
    assert.equal(adapter.refreshUsage, undefined);
    assert.equal(adapter.checkUsage, undefined);
  });
});

describe("connectedProviders", () => {
  it("reads provider ids off model lines and ignores anything else", () => {
    assert.deepEqual(
      connectedProviders(
        "opencode/a\n\nwarning: something\nopenai/b c\nzai-coding-plan/glm-5.3\n",
      ),
      ["opencode", "zai-coding-plan"],
    );
  });
});

describe("consoleCommand", () => {
  it("opens a prepared session and leaves its opening prompt to the plugin", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/demo",
      sessionId: "ses_abc",
      prompt: "-starts with a dash",
      hookUrl: "http://127.0.0.1:3000/hooks/c1/token",
    });
    assert.equal(command.file, "opencode");
    assert.deepEqual(command.args, ["--session", "ses_abc"]);
    assert.equal(command.cwd, "/workspace/demo");
    assert.equal(command.hooked, true);
    assert.equal(command.env?.OPENCODE_DISABLE_AUTOUPDATE, "1");
    assert.equal(command.env?.[PLUGIN_ENV.session], "ses_abc");
    assert.equal(command.env?.[PLUGIN_ENV.prompt], "-starts with a dash");
    assert.equal(
      command.env?.[PLUGIN_ENV.hookUrl],
      "http://127.0.0.1:3000/hooks/c1/token",
    );
    const config = JSON.parse(command.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
    assert.equal(config.plugin.length, 1);
    assert.match(config.plugin[0], /^file:\/\/.*\/plugin\.js$/);
  });

  it("sends no opening prompt on a resume", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/demo",
      sessionId: "ses_abc",
      resume: true,
      prompt: "ignored",
    });
    assert.deepEqual(command.args, ["--session", "ses_abc"]);
    assert.equal(command.env?.[PLUGIN_ENV.prompt], undefined);
    assert.equal(command.hooked, false);
  });

  it("falls back to the CLI's own prompt flag without a prepared session", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/demo",
      prompt: "hello",
    });
    assert.deepEqual(command.args, ["--prompt", "hello"]);
  });

  it("tells the agent its callsign through the plugin", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/demo",
      sessionId: "ses_abc",
      callsign: "Ziggy",
    });
    assert.match(command.env?.[PLUGIN_ENV.brief] ?? "", /^You are Ziggy,/);
  });
});

describe("relayInput", () => {
  it("is one bracketed paste and Enter, with paste markers stripped", () => {
    assert.equal(relayInput("a\nb\x1b[201~c"), "\x1b[200~a\nbc\x1b[201~\r");
  });
});

describe("isSessionsChange", () => {
  it("counts the database and its log, never the CLI's own logs", () => {
    assert.equal(isSessionsChange("opencode.db"), true);
    assert.equal(isSessionsChange("opencode.db-wal"), true);
    assert.equal(isSessionsChange("opencode.db-shm"), false);
    assert.equal(isSessionsChange("log/2026-10-22T215519.log"), false);
    assert.equal(isSessionsChange("x.jsonl"), false);
  });
});
