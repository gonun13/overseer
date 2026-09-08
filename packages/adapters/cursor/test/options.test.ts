import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  normalizePermissionMode,
  parseModelsOutput,
  readProviderOptions,
} from "../src/options.js";

// Captured live from `agent models` against `2026.08.31-4057e58`.
const REAL_OUTPUT = `Available models

auto - Auto (current, default)
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex - Codex 5.3
cursor-grok-4.6-high-fast - Cursor Grok 4.6 Fast
composer-2.5 - Composer 2.5
claude-opus-5-thinking-high - Claude Opus 5 1M Thinking
claude-fable-5-thinking-high - Claude Fable 5 1M Thinking (NO ZDR)
`;

describe("parseModelsOutput", () => {
  it("parses every row and marks the current default", () => {
    const { models, defaultModel } = parseModelsOutput(REAL_OUTPUT);
    assert.equal(models.length, 7);
    assert.deepEqual(models[0], { value: "auto", label: "Auto" });
    assert.deepEqual(models[1], { value: "gpt-5.3-codex-low", label: "Codex 5.3 Low" });
    assert.equal(defaultModel, "auto");
  });

  it("keeps a parenthetical that is not the default marker in the label", () => {
    const { models } = parseModelsOutput(REAL_OUTPUT);
    const fable = models.find((m) => m.value === "claude-fable-5-thinking-high");
    assert.equal(fable?.label, "Claude Fable 5 1M Thinking (NO ZDR)");
  });

  it("also treats a plain (current) marker as the default", () => {
    // Verified live: once the account's selection moves off the untouched
    // default, `agent models` marks the new current row `(current)` alone,
    // with no ", default" — a fresh account never shows this form.
    const { models, defaultModel } = parseModelsOutput(
      "auto - Auto\ngpt-5.3-codex - Codex 5.3 (current)\ngpt-5.3-codex-low - Codex 5.3 Low\n",
    );
    assert.equal(defaultModel, "gpt-5.3-codex");
    assert.equal(models.find((m) => m.value === "gpt-5.3-codex")?.label, "Codex 5.3");
  });

  it("ignores the heading and blank lines", () => {
    const { models } = parseModelsOutput("Available models\n\n\nauto - Auto\n");
    assert.equal(models.length, 1);
  });

  it("reports no default when nothing is marked current", () => {
    const { defaultModel } = parseModelsOutput("auto - Auto\ngpt-5.3-codex - Codex\n");
    assert.equal(defaultModel, undefined);
  });

  it("returns nothing for output it does not recognize", () => {
    const { models, defaultModel } = parseModelsOutput("some unrelated error text\n");
    assert.deepEqual(models, []);
    assert.equal(defaultModel, undefined);
  });
});

describe("normalizePermissionMode", () => {
  it("passes plan and ask through", () => {
    assert.equal(normalizePermissionMode("plan"), "plan");
    assert.equal(normalizePermissionMode("ask"), "ask");
  });

  it("refuses anything else, including the CLI's other flags", () => {
    assert.equal(normalizePermissionMode("force"), undefined);
    assert.equal(normalizePermissionMode("auto-review"), undefined);
    assert.equal(normalizePermissionMode(""), undefined);
    assert.equal(normalizePermissionMode(undefined), undefined);
  });
});

describe("readProviderOptions agents", () => {
  /** A stand-in `agent` on PATH, so `models` resolves without the real CLI. */
  let dir = "";
  let originalPath: string | undefined;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cursor-agent-stub-"));
    await writeFile(
      path.join(dir, "agent"),
      "#!/bin/sh\necho 'auto - Auto (current, default)'\n",
      { mode: 0o755 },
    );
    originalPath = process.env.PATH;
    process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
  });

  after(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(dir, { recursive: true, force: true });
  });

  it("names the one agent row rather than reporting an empty list", async () => {
    // An empty list draws a bare dash in the control bar, which reads as
    // "your subagents are not working" — they are, cursor just chooses.
    const { agents } = await readProviderOptions({ projectDir: dir });
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.label, "auto subagent");
  });

  it("keeps the unset value, so selecting it arms no flag", async () => {
    const { agents } = await readProviderOptions({ projectDir: dir });
    assert.equal(agents[0]?.value, "");
  });
});
