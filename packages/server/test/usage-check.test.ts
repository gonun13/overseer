import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdapterUsageCheck, AgentAdapter } from "@overseer/protocol";
import { createUsageCheck } from "../src/usage-check.js";

const REPORT = "## Usage\n\n| **Total** | 9.1% |";
const WINDOWS = [{ id: "total", label: "total", used: 0.091 }];
const OK: AdapterUsageCheck = {
  ok: true,
  report: REPORT,
  windows: WINDOWS,
  spend: "$45.13",
};

/** An adapter that counts how often it was actually asked. */
function countingAdapter(
  outcome: AdapterUsageCheck | (() => Promise<AdapterUsageCheck>) = OK,
) {
  const calls: string[] = [];
  const adapter = {
    id: "cursor",
    getStatus: async () => ({ authenticated: true }),
    checkUsage: async ({ projectDir }: { projectDir: string }) => {
      calls.push(projectDir);
      return typeof outcome === "function" ? await outcome() : outcome;
    },
  } as unknown as AgentAdapter;
  return { adapter, calls };
}

function deps(
  adapter: AgentAdapter,
  project: () => string | undefined,
  provider: () => string | undefined = () => "cursor",
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

describe("usage-check", () => {
  it("asks the adapter for the active project's report", async () => {
    const { adapter, calls } = countingAdapter();
    const service = createUsageCheck(deps(adapter, () => "/workspace/demo"));

    const result = await service.check();
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["/workspace/demo"]);
    if (result.ok) {
      assert.equal(result.providerId, "cursor");
      assert.equal(result.report, REPORT);
      // The gauges the widget draws ride along with the prose they came from.
      assert.deepEqual(result.windows, WINDOWS);
      assert.equal(result.spend, "$45.13");
    }
  });

  it("carries a report the adapter could not read gauges out of", async () => {
    // An unreadable report is still the operator's answer — it must reach the
    // providers window rather than being refused for having no numbers in it.
    const { adapter } = countingAdapter({
      ok: true,
      report: "the usage API was unreachable",
      windows: [],
    });
    const service = createUsageCheck(deps(adapter, () => "/workspace/demo"));

    const result = await service.check();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.windows, []);
      assert.equal(result.spend, undefined);
      assert.match(result.report, /unreachable/);
    }
  });

  it("collapses concurrent asks into one subprocess", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { adapter, calls } = countingAdapter(async () => {
      await gate;
      return OK;
    });
    const service = createUsageCheck(deps(adapter, () => "/workspace/demo"));

    // Two tabs pressing "check usage" in the same tick.
    const both = Promise.all([service.check(), service.check()]);
    release?.();
    const [first, second] = await both;

    assert.equal(calls.length, 1);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  });

  it("re-asks (not cached) once the in-flight ask has settled", async () => {
    const { adapter, calls } = countingAdapter();
    const service = createUsageCheck(deps(adapter, () => "/workspace/demo"));

    await service.check();
    await service.check();
    assert.equal(calls.length, 2);
  });

  it("surfaces the adapter's own failure reason", async () => {
    const { adapter } = countingAdapter({
      ok: false,
      reason: "agent did not answer",
    });
    const service = createUsageCheck(deps(adapter, () => "/workspace/demo"));

    const result = await service.check();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "agent did not answer");
  });

  it("refuses rather than asking when the adapter has no checkUsage", async () => {
    const stub = {
      id: "claude-code",
      getStatus: async () => ({ authenticated: true }),
    } as unknown as AgentAdapter;
    const service = createUsageCheck(
      deps(stub, () => "/workspace/demo", () => "claude-code"),
    );

    const result = await service.check();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /claude-code has no usage report/);
    }
  });

  it("refuses when nothing is attached, no project is active, or auth is out", async () => {
    const { adapter } = countingAdapter();

    const noProvider = createUsageCheck(
      deps(adapter, () => "/workspace/demo", () => undefined),
    );
    assert.equal((await noProvider.check()).ok, false);

    const noProject = createUsageCheck(deps(adapter, () => undefined));
    assert.equal((await noProject.check()).ok, false);

    const signedOut = createUsageCheck({
      ...deps(adapter, () => "/workspace/demo"),
      getAdapter: () =>
        ({
          id: "cursor",
          getStatus: async () => ({ authenticated: false }),
          checkUsage: async () => OK,
        }) as unknown as AgentAdapter,
    });
    const result = await signedOut.check();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not signed in/);
  });

  it("refuses a project outside the workspace", async () => {
    const { adapter, calls } = countingAdapter();
    const service = createUsageCheck({
      ...deps(adapter, () => "/etc"),
      isInsideWorkspace: async () => false,
    });

    const result = await service.check();
    assert.equal(result.ok, false);
    assert.deepEqual(calls, []);
  });

  it("surfaces an adapter throw as a refusal, and recovers on the next ask", async () => {
    let fail = true;
    const adapter = {
      id: "cursor",
      getStatus: async () => ({ authenticated: true }),
      checkUsage: async () => {
        if (fail) throw new Error("agent went missing");
        return OK;
      },
    } as unknown as AgentAdapter;
    const service = createUsageCheck(deps(adapter, () => "/workspace/demo"));

    const failed = await service.check();
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.match(failed.reason, /agent went missing/);

    fail = false;
    assert.equal((await service.check()).ok, true);
  });
});
