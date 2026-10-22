import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PLUGIN_ENV } from "../src/console.js";

/**
 * The plugin opencode loads into its own process. It reads the opening prompt
 * when the module loads, so the environment is set before the import.
 */

const posted: string[] = [];
const realFetch = globalThis.fetch;
let plugin: typeof import("../src/plugin.js");

before(async () => {
  process.env[PLUGIN_ENV.hookUrl] = "http://127.0.0.1:3000/hooks/c1/token";
  process.env[PLUGIN_ENV.brief] = "You are Ziggy.";
  process.env[PLUGIN_ENV.session] = "ses_new";
  process.env[PLUGIN_ENV.prompt] = "fix the parser";
  globalThis.fetch = (async (url: string | URL) => {
    posted.push(String(url).split("activity=")[1] ?? "");
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  plugin = await import("../src/plugin.js");
});

after(() => {
  globalThis.fetch = realFetch;
  for (const name of Object.values(PLUGIN_ENV)) delete process.env[name];
});

function client(messages: unknown[]) {
  const prompts: Array<{ id: string; text: string }> = [];
  return {
    prompts,
    session: {
      async messages() {
        return { data: messages };
      },
      async promptAsync(opts: {
        path: { id: string };
        body: { parts: Array<{ type: "text"; text: string }> };
      }) {
        prompts.push({ id: opts.path.id, text: opts.body.parts[0]!.text });
        return {};
      },
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("OverseerPlugin", () => {
  it("sends the opening prompt once, and keeps it from the agent's shells", async () => {
    assert.equal(process.env[PLUGIN_ENV.prompt], undefined);
    assert.equal(process.env[PLUGIN_ENV.session], undefined);
    const first = client([]);
    await plugin.OverseerPlugin({ client: first });
    await settle();
    assert.deepEqual(first.prompts, [
      { id: "ses_new", text: "fix the parser" },
    ]);

    // A reloaded instance initializes the plugin again.
    const again = client([]);
    await plugin.OverseerPlugin({ client: again });
    await settle();
    assert.deepEqual(again.prompts, []);
  });

  it("reports activity, leaving subagent status out and their prompts in", async () => {
    posted.length = 0;
    const hooks = await plugin.OverseerPlugin({ client: client([]) });
    const emit = (type: string, properties: object) =>
      hooks.event({ event: { type, properties } });

    await emit("session.status", {
      sessionID: "ses_a",
      status: { type: "busy" },
    });
    await emit("session.status", {
      sessionID: "ses_a",
      status: { type: "busy" },
    });
    await emit("session.created", {
      info: { id: "ses_kid", parentID: "ses_a" },
    });
    await emit("session.status", {
      sessionID: "ses_kid",
      status: { type: "idle" },
    });
    await emit("permission.asked", { sessionID: "ses_kid" });
    await emit("permission.replied", { sessionID: "ses_kid" });
    await emit("question.asked", { sessionID: "ses_a" });
    await emit("question.rejected", { sessionID: "ses_a" });
    await emit("session.status", {
      sessionID: "ses_a",
      status: { type: "idle" },
    });
    await settle();
    assert.deepEqual(posted, [
      "working",
      "waiting",
      "working",
      "waiting",
      "working",
      "idle",
    ]);
  });

  it("appends the relay brief to the operator's sessions only", async () => {
    const hooks = await plugin.OverseerPlugin({ client: client([]) });
    await hooks.event({
      event: {
        type: "session.updated",
        properties: { info: { id: "ses_kid", parentID: "ses_a" } },
      },
    });
    const own = { system: ["base"] };
    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_a" },
      own,
    );
    assert.deepEqual(own.system, ["base", "You are Ziggy."]);
    const child = { system: ["base"] };
    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_kid" },
      child,
    );
    assert.deepEqual(child.system, ["base"]);
  });
});
