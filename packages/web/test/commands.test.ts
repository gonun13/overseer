import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMANDS,
  addressInput,
  commandArgs,
  matchCommand,
  slashName,
  suggestAddressees,
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
    assert.equal(matchCommand("/bash")?.name, "shell");
  });

  it("ignores a bare slash and unknown names", () => {
    assert.equal(matchCommand("/"), undefined);
    assert.equal(matchCommand("/nope"), undefined);
  });

  it("has no /console: every session is already a console", () => {
    assert.equal(matchCommand("/console"), undefined);
    assert.equal(matchCommand("/term"), undefined);
  });

  it("starts consoles rather than opening a window", () => {
    assert.deepEqual(matchCommand("/bash")?.action, { type: "shell" });
    assert.deepEqual(matchCommand("/tile")?.action, { type: "tile" });
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
      suggestCommands("/sh").map((command) => command.name),
      ["shell"],
    );
  });
});

describe("command arguments", () => {
  it("stops suggesting once arguments are being typed", () => {
    assert.deepEqual(
      suggestCommands("/rename").map((command) => command.name),
      ["rename"],
    );
    assert.deepEqual(suggestCommands("/rename "), []);
    assert.deepEqual(suggestCommands("/rename linda lucy"), []);
  });

  it("reads the words after the command name", () => {
    assert.deepEqual(commandArgs("/rename  linda   Lucy "), ["linda", "Lucy"]);
    assert.deepEqual(commandArgs("/drop"), []);
  });
});

describe("addressing an agent", () => {
  it("parses @callsign and the text after it", () => {
    assert.equal(addressInput("build it"), undefined);
    assert.deepEqual(addressInput("@"), { to: "", text: "" });
    assert.deepEqual(addressInput("@linda"), { to: "linda", text: "" });
    assert.deepEqual(addressInput(" @linda  build two\nadapters "), {
      to: "linda",
      text: "build two\nadapters",
    });
  });

  it("suggests callsigns by prefix, running agents first, until the message starts", () => {
    const agents = [
      { callsign: "Lena", running: false },
      { callsign: "Linda", running: true, title: "adapters" },
      { callsign: "Bob", running: true },
    ];
    assert.deepEqual(
      suggestAddressees("@l", agents).map((a) => a.callsign),
      ["Linda", "Lena"],
    );
    assert.deepEqual(
      suggestAddressees("@", agents).map((a) => a.callsign),
      ["Linda", "Bob", "Lena"],
    );
    assert.deepEqual(suggestAddressees("@linda hi", agents), []);
    assert.deepEqual(suggestAddressees("linda", agents), []);
  });
});
