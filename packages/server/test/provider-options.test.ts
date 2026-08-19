import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAdapter, ProviderOptions } from "@overseer/protocol";
import { createProviderOptions } from "../src/provider-options.js";

const OPTIONS: ProviderOptions = {
  models: [{ value: "opus", label: "Opus" }],
  permissionModes: [{ value: "auto", label: "auto" }],
  agents: [{ value: "", label: "none" }],
  defaultPermissionMode: "auto",
};

/** An adapter that counts how often it was actually asked. */
function countingAdapter(
  options: ProviderOptions | (() => Promise<ProviderOptions>) = OPTIONS,
) {
  const calls: string[] = [];
  const adapter = {
    id: "claude-code",
    getStatus: async () => ({ authenticated: true }),
    listOptions: async ({ projectDir }: { projectDir: string }) => {
      calls.push(projectDir);
      return typeof options === "function" ? await options() : options;
    },
  } as unknown as AgentAdapter;
  return { adapter, calls };
}

function deps(
  adapter: AgentAdapter,
  project: () => string | undefined,
  provider: () => string | undefined = () => "claude-code",
) {
  return {
    readSnapshot: async () =>
      ({
        attached_provider: provider(),
        last_active_project: project(),
      }) as never,
    isInsideWorkspace: async () => true,
    getAdapter: () => adapter,
  };
}

describe("provider-options", () => {
  it("asks the adapter for the active project", async () => {
    const { adapter, calls } = countingAdapter();
    const service = createProviderOptions(
      deps(adapter, () => "/workspace/demo"),
    );

    const result = await service.read();
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["/workspace/demo"]);
    if (result.ok) {
      assert.equal(result.providerId, "claude-code");
      assert.equal(result.projectDir, "/workspace/demo");
      assert.deepEqual(result.options, OPTIONS);
    }
  });

  it("re-asks every time rather than caching", async () => {
    // Part of the answer is the operator's own `.claude/agents/` files, which
    // they can change without telling us — a cached list would go on offering
    // agents they deleted until they happened to switch projects.
    const { adapter, calls } = countingAdapter();
    const service = createProviderOptions(
      deps(adapter, () => "/workspace/demo"),
    );

    await service.read();
    await service.read();
    await service.read();
    assert.equal(calls.length, 3);
  });

  it("collapses concurrent asks into one subprocess", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { adapter, calls } = countingAdapter(async () => {
      await gate;
      return OPTIONS;
    });
    const service = createProviderOptions(
      deps(adapter, () => "/workspace/demo"),
    );

    // Two tabs opening the model row in the same tick.
    const both = Promise.all([service.read(), service.read()]);
    release?.();
    const [first, second] = await both;

    assert.equal(calls.length, 1);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  });

  it("follows the active project — subagents are project-scoped", async () => {
    let project = "/workspace/one";
    const { adapter, calls } = countingAdapter();
    const service = createProviderOptions(deps(adapter, () => project));

    await service.read();
    project = "/workspace/two";
    await service.read();

    assert.deepEqual(calls, ["/workspace/one", "/workspace/two"]);
  });

  it("refuses rather than inventing menus when the adapter cannot enumerate", async () => {
    const stub = {
      id: "codex",
      getStatus: async () => ({ authenticated: true }),
    } as unknown as AgentAdapter;
    const service = createProviderOptions(
      deps(stub, () => "/workspace/demo", () => "codex"),
    );

    const result = await service.read();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /codex cannot report session options/);
    }
  });

  it("refuses when nothing is attached, no project is active, or auth is out", async () => {
    const { adapter } = countingAdapter();

    const noProvider = createProviderOptions(
      deps(adapter, () => "/workspace/demo", () => undefined),
    );
    assert.equal((await noProvider.read()).ok, false);

    const noProject = createProviderOptions(deps(adapter, () => undefined));
    assert.equal((await noProject.read()).ok, false);

    const signedOut = createProviderOptions({
      ...deps(adapter, () => "/workspace/demo"),
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: false }),
          listOptions: async () => OPTIONS,
        }) as unknown as AgentAdapter,
    });
    const result = await signedOut.read();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not signed in/);
  });

  it("refuses a project outside the workspace", async () => {
    const { adapter, calls } = countingAdapter();
    const service = createProviderOptions({
      ...deps(adapter, () => "/etc"),
      isInsideWorkspace: async () => false,
    });

    const result = await service.read();
    assert.equal(result.ok, false);
    // And never reached the CLI to ask about it.
    assert.deepEqual(calls, []);
  });

  it("surfaces an adapter throw as a refusal, and recovers on the next ask", async () => {
    let fail = true;
    const adapter = {
      id: "claude-code",
      getStatus: async () => ({ authenticated: true }),
      listOptions: async () => {
        if (fail) throw new Error("claude went missing");
        return OPTIONS;
      },
    } as unknown as AgentAdapter;
    const service = createProviderOptions(
      deps(adapter, () => "/workspace/demo"),
    );

    const failed = await service.read();
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.match(failed.reason, /claude went missing/);

    fail = false;
    assert.equal((await service.read()).ok, true);
  });
});
