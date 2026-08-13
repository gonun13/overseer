import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_GREETING,
  MAX_NAME,
  MAX_TYPING_CHANCE,
  parseOperatorName,
  parseOperatorTone,
  validatePersonalityObject,
} from "../src/memory/personality/validate.js";

describe("validatePersonalityObject", () => {
  it("accepts every allowlisted field", () => {
    const { applied, rejected } = validatePersonalityObject({
      tone: "dry",
      name: "Ada",
      greeting: "hello operator",
      typingChance: 0.25,
    });
    assert.deepEqual(applied, {
      tone: "dry",
      name: "Ada",
      greeting: "hello operator",
      typingChance: 0.25,
    });
    assert.deepEqual(rejected, []);
  });

  it("trims name and greeting", () => {
    const { applied, rejected } = validatePersonalityObject({
      name: "  Ada  ",
      greeting: "  hi  ",
    });
    assert.equal(applied.name, "Ada");
    assert.equal(applied.greeting, "hi");
    assert.deepEqual(rejected, []);
  });

  it("ignores comment keys and $schema", () => {
    const { applied, rejected } = validatePersonalityObject({
      "// note": "hand-edited",
      $schema: "https://example.test/schema.json",
      tone: "warm",
    });
    assert.deepEqual(applied, { tone: "warm" });
    assert.deepEqual(rejected, []);
  });

  it("rejects named forbidden fields with operator-facing reasons", () => {
    const { applied, rejected } = validatePersonalityObject({
      logging: false,
      permissions: ["shell"],
      signals: [],
    });
    assert.deepEqual(applied, {});
    assert.equal(rejected.length, 3);
    assert.ok(rejected.every((entry) => entry.reason.length > 0));
    assert.deepEqual(
      rejected.map((entry) => entry.field).sort(),
      ["logging", "permissions", "signals"],
    );
  });

  it("rejects unknown fields by default", () => {
    const { applied, rejected } = validatePersonalityObject({
      favoriteColor: "blue",
    });
    assert.deepEqual(applied, {});
    assert.deepEqual(rejected, [
      {
        field: "favoriteColor",
        reason: "not a customizable field · see docs/overseer.md §6.4",
      },
    ]);
  });

  it("rejects invalid allowlisted values", () => {
    const { applied, rejected } = validatePersonalityObject({
      tone: "sarcastic",
      name: "",
      greeting: "x".repeat(MAX_GREETING + 1),
      typingChance: MAX_TYPING_CHANCE + 0.1,
    });
    assert.deepEqual(applied, {});
    assert.equal(rejected.length, 4);
    assert.ok(rejected.some((entry) => entry.field === "tone"));
    assert.ok(rejected.some((entry) => entry.field === "name"));
    assert.ok(rejected.some((entry) => entry.field === "greeting"));
    assert.ok(rejected.some((entry) => entry.field === "typingChance"));
  });
});

describe("parseOperatorName", () => {
  it("accepts a trimmed name within bounds", () => {
    assert.deepEqual(parseOperatorName("  Ada  "), { ok: true, name: "Ada" });
  });

  it("rejects empty or oversized names", () => {
    assert.equal(parseOperatorName("   ").ok, false);
    assert.equal(parseOperatorName("x".repeat(MAX_NAME + 1)).ok, false);
  });
});

describe("parseOperatorTone", () => {
  it("accepts known tones", () => {
    assert.deepEqual(parseOperatorTone("neutral"), {
      ok: true,
      tone: "neutral",
    });
  });

  it("rejects unknown tones", () => {
    const result = parseOperatorTone("sarcastic");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /expected one of/);
    }
  });
});
