import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePermissionMode, parseModelsOutput } from "../src/options.js";

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
