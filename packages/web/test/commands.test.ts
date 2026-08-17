import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMANDS,
  matchCommand,
  slashName,
  suggestCommands,
} from "../src/commands.ts";

describe("slashName", () => {
  it("is undefined when the input is not a command", () => {
    assert.equal(slashName("help"), undefined);
    assert.equal(slashName("look at the repo"), undefined);
    assert.equal(slashName(""), undefined);
  });

  it("returns the first token after a leading slash", () => {
    assert.equal(slashName("/"), "");
    assert.equal(slashName("/help"), "help");
    assert.equal(slashName("  /HELP extra"), "HELP");
  });
});

describe("matchCommand", () => {
  it("requires a leading slash", () => {
    assert.equal(matchCommand("help"), undefined);
    assert.equal(matchCommand("console"), undefined);
  });

  it("matches a canonical name or alias", () => {
    assert.equal(matchCommand("/help")?.name, "help");
    assert.equal(matchCommand("/HELP")?.name, "help");
    assert.equal(matchCommand("/term")?.name, "console");
  });

  it("ignores a bare slash and unknown names", () => {
    assert.equal(matchCommand("/"), undefined);
    assert.equal(matchCommand("/nope"), undefined);
  });

  it("does not include a context command", () => {
    assert.equal(
      COMMANDS.some((command) => command.name === "context"),
      false,
    );
    assert.equal(matchCommand("/context"), undefined);
  });
});

describe("suggestCommands", () => {
  it("lists nothing unless the input starts with a slash", () => {
    assert.deepEqual(suggestCommands("help"), []);
    assert.deepEqual(suggestCommands("con"), []);
  });

  it("lists every command for a bare slash", () => {
    assert.deepEqual(
      suggestCommands("/").map((command) => command.name),
      COMMANDS.map((command) => command.name),
    );
  });

  it("filters by name or alias prefix", () => {
    assert.deepEqual(
      suggestCommands("/he").map((command) => command.name),
      ["help"],
    );
    assert.deepEqual(
      suggestCommands("/term").map((command) => command.name),
      ["console"],
    );
  });
});
