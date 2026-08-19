import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { claudeCodeAdapter } from "../src/index.js";
import {
  findInitializeBody,
  normalizePermissionMode,
  parseInitializeResponse,
  readProviderOptions,
} from "../src/options.js";

/**
 * The real `initialize` control response, captured from 2.1.226 in the dev
 * container. Trimmed and de-identified — see the `_comment` in the fixture.
 */
const FIXTURE_PATH = path.join(
  import.meta.dirname,
  "fixtures",
  "initialize-response.json",
);

async function fixtureLine(): Promise<string> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  // One NDJSON line is what the child actually writes.
  return `${JSON.stringify(JSON.parse(raw))}\n`;
}

describe("parseInitializeResponse", () => {
  it("reads the models the pinned 2.1.226 build offers", async () => {
    const line = await fixtureLine();
    const options = parseInitializeResponse(findInitializeBody(line));

    assert.deepEqual(
      options.models.map((m) => m.value),
      ["default", "sonnet", "claude-fable-5[1m]", "opus", "haiku"],
    );
    // The CLI's own display name and description, not ours.
    assert.deepEqual(options.models[3], {
      value: "opus",
      label: "Opus",
      detail: "Opus 5 · Best for everyday, complex tasks · ~2× usage vs Sonnet",
    });
  });

  it("ignores the CLI's built-in agents entirely", () => {
    // `initialize` mixes Claude's own routing agents in with the operator's,
    // with nothing to tell them apart — so this parse takes none of them, and
    // the agent row is filled from disk instead.
    const answer = parseInitializeResponse({
      agents: [
        { name: "Explore", description: "built-in" },
        { name: "general-purpose", description: "built-in" },
      ],
      models: [{ value: "opus" }],
    });
    assert.equal("agents" in answer, false);
  });

  it("reports the mode and model the CLI says it will use", async () => {
    const line = await fixtureLine();
    const answer = parseInitializeResponse(findInitializeBody(line));
    assert.equal(answer.defaultPermissionMode, "auto");
    // So the model row can read "Default (recommended)" rather than a blank.
    assert.equal(answer.defaultModel, "default");
  });

  it("names no default model when the CLI offers no `default` entry", () => {
    const answer = parseInitializeResponse({ models: [{ value: "opus" }] });
    assert.equal(answer.defaultModel, undefined);
  });

  it("guesses nothing from a shape it does not recognise", () => {
    for (const body of [undefined, null, "nope", 7, {}, { models: "opus" }]) {
      const answer = parseInitializeResponse(body);
      assert.deepEqual(answer.models, []);
      assert.equal(answer.defaultPermissionMode, undefined);
    }
  });

  it("skips entries missing the value the CLI would be handed", () => {
    const answer = parseInitializeResponse({
      models: [
        { displayName: "No value" },
        { value: "" },
        { value: "opus" },
        "not an object",
      ],
    });
    assert.deepEqual(answer.models, [{ value: "opus", label: "opus" }]);
  });
});

describe("permission modes", () => {
  it("always offers the six, with bypass the only dangerous one", async () => {
    // Not from the probe: the modes are the adapter's own knowledge, so they
    // survive a CLI that answers nothing at all.
    const options = await readProviderOptions(
      { projectDir: tmpdir() },
      { timeoutMs: 300, killGraceMs: 50 },
    );
    assert.deepEqual(
      options.permissionModes.map((m) => m.value),
      ["auto", "manual", "acceptEdits", "plan", "dontAsk", "bypassPermissions"],
    );
    assert.equal(
      options.permissionModes.filter((m) => m.danger === true).map((m) => m.value)
        .length,
      1,
    );
    assert.equal(
      options.permissionModes.find((m) => m.danger === true)?.value,
      "bypassPermissions",
    );
  });
});

describe("normalizePermissionMode", () => {
  it("folds the CLI's `default` readback onto its own display name", () => {
    // Pass `manual` and `initialize` reports `default` — one mode, two words.
    assert.equal(normalizePermissionMode("default"), "manual");
    assert.equal(normalizePermissionMode("manual"), "manual");
  });

  it("passes the other five through unchanged", () => {
    for (const mode of [
      "auto",
      "acceptEdits",
      "plan",
      "dontAsk",
      "bypassPermissions",
    ]) {
      assert.equal(normalizePermissionMode(mode), mode);
    }
  });

  it("refuses anything it does not know", () => {
    for (const value of ["bogus", "", undefined, null, 3, {}]) {
      assert.equal(normalizePermissionMode(value), undefined);
    }
  });
});

describe("findInitializeBody", () => {
  it("ignores frames that are not our own control response", () => {
    const lines = [
      "",
      "not json",
      JSON.stringify({ type: "system", subtype: "init", models: ["nope"] }),
      JSON.stringify({
        type: "control_response",
        response: { subtype: "success", request_id: "someone_else", response: {} },
      }),
      JSON.stringify({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: "overseer_initialize",
          response: { current_permission_mode: "plan" },
        },
      }),
    ].join("\n");
    assert.deepEqual(findInitializeBody(lines), {
      current_permission_mode: "plan",
    });
  });

  it("treats an error response as no answer", () => {
    const line = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: "overseer_initialize",
        error: "unsupported",
      },
    });
    assert.equal(findInitializeBody(line), undefined);
  });
});

describe("readProviderOptions against a stand-in CLI", () => {
  let binDir: string;
  let originalPath: string | undefined;

  async function installCli(body: string): Promise<void> {
    const file = path.join(binDir, "claude");
    await writeFile(
      file,
      `#!/bin/sh
# Read the one control_request line, then answer as 2.1.226 does.
head -n 1 >/dev/null
${body}
`,
      "utf8",
    );
    await chmod(file, 0o755);
  }

  before(async () => {
    binDir = await mkdtemp(path.join(tmpdir(), "overseer-options-"));
    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    const fixture = path.join(binDir, "initialize.ndjson");
    await writeFile(fixture, await fixtureLine(), "utf8");
    process.env.OPTIONS_FIXTURE = fixture;
  });

  after(() => {
    process.env.PATH = originalPath;
    delete process.env.OPTIONS_FIXTURE;
  });

  it("asks the CLI in the project directory and parses the reply", async () => {
    await installCli('cat "$OPTIONS_FIXTURE"\nexit 0');
    const options = await readProviderOptions({ projectDir: tmpdir() });
    assert.equal(options.models.length, 5);
    assert.equal(options.defaultPermissionMode, "auto");
    // The CLI's built-ins are in that fixture and must not reach the row.
    assert.deepEqual(
      options.agents.map((a) => a.value),
      [""],
    );
  });

  it("reports nothing but the modes when the CLI answers with nonsense", async () => {
    await installCli('echo "not json at all"\nexit 0');
    const options = await readProviderOptions({ projectDir: tmpdir() });
    assert.deepEqual(options.models, []);
    assert.equal(options.permissionModes.length, 6);
  });

  it("reports nothing but the modes when the CLI refuses the request", async () => {
    await installCli('echo "unknown option --input-format" >&2\nexit 1');
    const options = await readProviderOptions({ projectDir: tmpdir() });
    assert.deepEqual(options.models, []);
    assert.equal(options.permissionModes.length, 6);
  });

  it("reports nothing but the modes when the CLI is not on PATH at all", async () => {
    const saved = process.env.PATH;
    process.env.PATH = path.join(binDir, "empty");
    try {
      const options = await readProviderOptions(
        { projectDir: tmpdir() },
        { timeoutMs: 500, killGraceMs: 50 },
      );
      assert.deepEqual(options.models, []);
      assert.equal(options.permissionModes.length, 6);
    } finally {
      process.env.PATH = saved;
    }
  });

  it("settles when the CLI never answers, rather than pinning the menus", async () => {
    // Ignores SIGTERM and never writes: the deadline and SIGKILL must resolve it.
    await installCli('trap "" TERM\nsleep 30');
    const started = Date.now();
    const options = await readProviderOptions(
      { projectDir: tmpdir() },
      { timeoutMs: 200, killGraceMs: 50 },
    );
    assert.deepEqual(options.models, []);
    assert.ok(Date.now() - started < 5_000);
  });

  it("is exposed on the adapter as listOptions", async () => {
    await installCli('cat "$OPTIONS_FIXTURE"\nexit 0');
    assert.equal(typeof claudeCodeAdapter.listOptions, "function");
    const options = await claudeCodeAdapter.listOptions!({
      projectDir: tmpdir(),
    });
    assert.equal(options.models.length, 5);
  });
});
