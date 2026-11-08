import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipboardChord,
  isMacPlatform,
  osc52Text,
} from "../src/components/windows/terminalClipboard.ts";

function b64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

describe("osc52Text", () => {
  it("decodes a copy to the system clipboard", () => {
    // What Codex emits after a mouse drag.
    assert.equal(
      osc52Text(
        "c;ID5fIE9wZW5BSSBDb2RleCAodjAuMTYzLjApCiAgICAgL3RtcC9wcm9iZQ==",
      ),
      " >_ OpenAI Codex (v0.163.0)\n     /tmp/probe",
    );
  });

  it("decodes UTF-8, not Latin-1", () => {
    assert.equal(osc52Text(`c;${b64("são ▽ 日本")}`), "são ▽ 日本");
  });

  it("takes any selection buffer, including none", () => {
    assert.equal(osc52Text(`p;${b64("x")}`), "x");
    assert.equal(osc52Text(`;${b64("y")}`), "y");
  });

  it("never answers a clipboard read", () => {
    assert.equal(osc52Text("c;?"), null);
  });

  it("ignores malformed sequences", () => {
    assert.equal(osc52Text("c"), null);
    assert.equal(osc52Text("c;"), null);
    assert.equal(osc52Text("c;!!not base64!!"), null);
    assert.equal(
      osc52Text(`c;${Buffer.from([0xff, 0xfe]).toString("base64")}`),
      null,
    );
  });
});

describe("clipboardChord", () => {
  const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
    type: "keydown",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    code,
    ...mods,
  });

  it("maps Ctrl+Shift+C and Ctrl+Shift+V off a Mac", () => {
    const mods = { ctrlKey: true, shiftKey: true };
    assert.equal(clipboardChord(key("KeyC", mods), false), "copy");
    assert.equal(clipboardChord(key("KeyV", mods), false), "paste");
  });

  it("leaves Ctrl+C and Ctrl+V to the CLI", () => {
    assert.equal(clipboardChord(key("KeyC", { ctrlKey: true }), false), null);
    assert.equal(clipboardChord(key("KeyV", { ctrlKey: true }), false), null);
  });

  it("does nothing on a Mac, where ⌘C and ⌘V already work", () => {
    const mods = { ctrlKey: true, shiftKey: true };
    assert.equal(clipboardChord(key("KeyC", mods), true), null);
  });

  it("only acts on keydown", () => {
    const mods = { ctrlKey: true, shiftKey: true, type: "keyup" };
    assert.equal(clipboardChord(key("KeyC", mods), false), null);
  });
});

describe("isMacPlatform", () => {
  it("reads the platform, falling back to the user agent", () => {
    assert.equal(isMacPlatform({ platform: "MacIntel", userAgent: "" }), true);
    assert.equal(
      isMacPlatform({ platform: "Linux x86_64", userAgent: "" }),
      false,
    );
    assert.equal(
      isMacPlatform({
        platform: "",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
      true,
    );
  });
});
