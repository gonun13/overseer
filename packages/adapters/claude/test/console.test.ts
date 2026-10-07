import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  consoleCommand,
  hookSettings,
  relayBrief,
  relayInput,
} from "../src/console.js";

/** The console command line: session flags and the hook settings layer. */

describe("claude consoleCommand", () => {
  let dir: string;
  let previous: string | undefined;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "claude-console-"));
    previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
  });

  after(async () => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it("runs bare claude in the cwd when no session is named", async () => {
    const command = await consoleCommand({ cwd: "/workspace/a" });
    assert.equal(command.file, "claude");
    assert.deepEqual(command.args, []);
    assert.equal(command.cwd, "/workspace/a");
    assert.equal(command.hooked, false);
  });

  it("adopts a minted id for a new session", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/a",
      sessionId: "abc",
    });
    assert.deepEqual(command.args, ["--session-id", "abc"]);
  });

  it("resumes an existing session", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/a",
      sessionId: "abc",
      resume: true,
    });
    assert.deepEqual(command.args, ["--resume", "abc"]);
  });

  it("passes an opening prompt after the flags", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/a",
      sessionId: "abc",
      prompt: "-fix the build",
    });
    assert.deepEqual(command.args, [
      "--session-id",
      "abc",
      "--",
      "-fix the build",
    ]);
  });

  it("layers hook settings when a hook url is given", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/a",
      hookUrl: "http://127.0.0.1:3000/hooks/id/token",
    });
    assert.equal(command.hooked, true);
    assert.equal(command.args[0], "--settings");
    const settings = JSON.parse(command.args[1]!) as {
      hooks: Record<
        string,
        Array<{ matcher?: string; hooks: Array<{ command: string }> }>
      >;
    };
    assert.match(settings.hooks.Stop![0]!.hooks[0]!.command, /activity=idle/);
    assert.match(
      settings.hooks.UserPromptSubmit![0]!.hooks[0]!.command,
      /activity=working/,
    );
    const notification = settings.hooks.Notification!.find(
      (entry) => entry.matcher === "permission_prompt",
    );
    assert.match(notification!.hooks[0]!.command, /activity=waiting/);
  });

  it("never lets a failed hook post fail the turn", () => {
    const settings = JSON.parse(hookSettings("http://x/hooks/a/b")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    for (const entries of Object.values(settings.hooks)) {
      for (const entry of entries) {
        assert.match(entry.hooks[0]!.command, /\|\| true$/);
      }
    }
  });

  it("tells a named agent who it is, before the opening prompt", async () => {
    const command = await consoleCommand({
      cwd: "/workspace/a",
      callsign: "Linda",
      prompt: "go",
    });
    assert.deepEqual(command.args, [
      "--append-system-prompt",
      relayBrief("Linda"),
      "--",
      "go",
    ]);
    assert.match(relayBrief("Linda"), /You are Linda/);
    assert.match(relayBrief("Linda"), /overseer tell/);
  });
});

describe("claude relayInput", () => {
  it("submits a relay as one bracketed paste and Enter", () => {
    assert.equal(relayInput("one\ntwo"), "\x1b[200~one\ntwo\x1b[201~\r");
  });

  it("strips paste markers that would end the paste early", () => {
    assert.equal(relayInput("a\x1b[201~b\x1b[200~"), "\x1b[200~ab\x1b[201~\r");
  });
});
