import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderManifest } from "../src/provider-registry.js";
import {
  readLoopConfig,
  readLoopModels,
  setLoopModel,
  setLoopProvider,
} from "../src/loop-config.js";

const manifest = (id: string, loopSubagents?: "verified" | "unverified"): ProviderManifest => ({
  id,
  cli: id,
  configDir: `.${id}`,
  app: "adapter",
  loop: "bundle",
  ...(loopSubagents !== undefined ? { loopSubagents } : {}),
});

describe("readLoopConfig", () => {
  it("folds loop/bin/models --json with each manifest's loopSubagents field", async () => {
    const config = await readLoopConfig({
      run: async (bin, args) => {
        assert.match(bin, /loop\/bin\/models$/);
        assert.deepEqual(args, ["--json"]);
        return {
          stdout: JSON.stringify({
            providers: {
              "claude-code": { overseer: null, steps: { request: "haiku" } },
              cursor: { overseer: "auto", steps: {} },
            },
            steps: ["request", "commit"],
            current: "cursor",
          }),
        };
      },
      readProviderManifests: () => [manifest("claude-code"), manifest("cursor", "unverified")],
    });

    assert.equal(config.current, "cursor");
    assert.deepEqual(config.steps, ["request", "commit"]);

    const claude = config.providers.find((p) => p.id === "claude-code");
    assert.equal(claude?.subagentsVerified, true, "absent manifest field reads as verified");
    assert.deepEqual(claude?.steps, { request: "haiku" });

    const cursor = config.providers.find((p) => p.id === "cursor");
    assert.equal(cursor?.subagentsVerified, false);
    assert.equal(cursor?.overseer, "auto");
  });

  it("reports an empty, current-only config rather than throwing on a bad reply", async () => {
    const config = await readLoopConfig({
      run: async () => ({ stdout: "not json" }),
      readProviderManifests: () => [],
    });
    assert.deepEqual(config, { type: "loop.config", current: "", providers: [], steps: [] });
  });
});

describe("setLoopProvider / setLoopModel", () => {
  it("shells out to loop/bin/provider with the chosen id", async () => {
    const calls: Array<{ bin: string; args: string[] }> = [];
    await setLoopProvider("cursor", {
      run: async (bin, args) => {
        calls.push({ bin, args });
        return { stdout: "" };
      },
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.bin, /loop\/bin\/provider$/);
    assert.deepEqual(calls[0]!.args, ["cursor"]);
  });

  it("shells out to loop/bin/models set with provider, slot, and model", async () => {
    const calls: Array<{ bin: string; args: string[] }> = [];
    await setLoopModel("cursor", "overseer", "gpt-5.3-codex", {
      run: async (bin, args) => {
        calls.push({ bin, args });
        return { stdout: "" };
      },
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.bin, /loop\/bin\/models$/);
    assert.deepEqual(calls[0]!.args, ["set", "cursor", "overseer", "gpt-5.3-codex"]);
  });

  it("propagates a rejection from the script (e.g. an unknown step)", async () => {
    await assert.rejects(
      () =>
        setLoopModel("cursor", "not-a-step", "x", {
          run: async () => {
            throw new Error("unknown step 'not-a-step'");
          },
        }),
      /unknown step/,
    );
  });
});

describe("readLoopModels", () => {
  it("asks loop/bin/models list-models <providerId> — the provider's own CLI, not the app's attached one", async () => {
    const calls: Array<{ bin: string; args: string[] }> = [];
    const result = await readLoopModels("cursor", {
      run: async (bin, args) => {
        calls.push({ bin, args });
        return {
          stdout: JSON.stringify({
            models: [
              { value: "auto", label: "Auto" },
              { value: "gpt-5.3-codex", label: "Codex 5.3" },
            ],
            defaultModel: "auto",
          }),
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.bin, /loop\/bin\/models$/);
    assert.deepEqual(calls[0]!.args, ["list-models", "cursor"]);

    assert.equal(result.type, "loop.models");
    assert.equal(result.providerId, "cursor");
    assert.equal(result.models.length, 2);
    assert.equal(result.defaultModel, "auto");
  });

  it("omits defaultModel when the script reports null", async () => {
    const result = await readLoopModels("claude-code", {
      run: async () => ({ stdout: JSON.stringify({ models: [], defaultModel: null }) }),
    });
    assert.deepEqual(result.models, []);
    assert.equal("defaultModel" in result, false);
  });

  it("reports an empty list rather than throwing when the script fails", async () => {
    const result = await readLoopModels("cursor", {
      run: async () => {
        throw new Error("agent CLI not found");
      },
    });
    assert.deepEqual(result, { type: "loop.models", providerId: "cursor", models: [] });
  });
});
