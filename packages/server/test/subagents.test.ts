import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentAdapter,
  Subagent,
  SubagentDraft,
  SubagentScope,
} from "@overseer/protocol";
import { createSubagents } from "../src/subagents.js";

function agent(over: Partial<Subagent> = {}): Subagent {
  return {
    name: "reviewer",
    description: "Reviews code",
    prompt: "You are the reviewer.",
    model: "",
    tools: "",
    scope: "project",
    file: "/workspace/p/.claude/agents/reviewer.md",
    ...over,
  };
}

function draft(over: Partial<SubagentDraft> = {}): SubagentDraft {
  return {
    name: "reviewer",
    description: "Reviews code",
    prompt: "You are the reviewer.",
    model: "",
    tools: "",
    scope: "project",
    ...over,
  };
}

/** An adapter that records what it was actually asked to do. */
function recordingAdapter(
  over: {
    existing?: Subagent[];
    write?: (opts: unknown) => Promise<Subagent>;
    remove?: (opts: unknown) => Promise<void>;
    omit?: ("listSubagents" | "writeSubagent" | "deleteSubagent")[];
    authenticated?: boolean;
  } = {},
) {
  const writes: unknown[] = [];
  const deletes: unknown[] = [];
  const adapter: Record<string, unknown> = {
    id: "claude-code",
    getStatus: async () => ({ authenticated: over.authenticated ?? true }),
    listSubagents: async () => over.existing ?? [],
    writeSubagent: async (opts: unknown) => {
      writes.push(opts);
      return over.write !== undefined ? over.write(opts) : agent();
    },
    deleteSubagent: async (opts: unknown) => {
      deletes.push(opts);
      if (over.remove !== undefined) await over.remove(opts);
    },
  };
  for (const method of over.omit ?? []) delete adapter[method];
  return { adapter: adapter as unknown as AgentAdapter, writes, deletes };
}

function deps(
  adapter: AgentAdapter,
  over: {
    project?: string | undefined;
    provider?: string | undefined;
    inside?: boolean;
  } = {},
) {
  return {
    readSnapshot: async () =>
      ({
        attached_provider: "provider" in over ? over.provider : "claude-code",
        last_active_project: "project" in over ? over.project : "/workspace/p",
      }) as never,
    isInsideWorkspace: async () => over.inside ?? true,
    getAdapter: () => adapter,
  };
}

describe("subagents.list", () => {
  it("reports the adapter's inventory for the active project", async () => {
    const { adapter } = recordingAdapter({ existing: [agent()] });
    const result = await createSubagents(deps(adapter)).list();
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.providerId, "claude-code");
    assert.equal(result.ok && result.projectDir, "/workspace/p");
    assert.equal(result.ok && result.subagents.length, 1);
  });

  it("refuses when no provider is attached", async () => {
    const { adapter } = recordingAdapter();
    const result = await createSubagents(
      deps(adapter, { provider: undefined }),
    ).list();
    assert.deepEqual(result, { ok: false, reason: "no provider attached" });
  });

  it("refuses when there is no active project", async () => {
    const { adapter } = recordingAdapter();
    const result = await createSubagents(
      deps(adapter, { project: undefined }),
    ).list();
    assert.deepEqual(result, { ok: false, reason: "no active project" });
  });

  it("refuses a project outside the workspace", async () => {
    const { adapter } = recordingAdapter();
    const result = await createSubagents(deps(adapter, { inside: false })).list();
    assert.match(
      result.ok ? "" : result.reason,
      /not inside the workspace/,
    );
  });

  it("refuses an adapter that cannot manage subagents", async () => {
    // Not an empty inventory: "you have none" and "this provider has none"
    // are different answers, and only one invites writing one.
    const { adapter } = recordingAdapter({ omit: ["listSubagents"] });
    const result = await createSubagents(deps(adapter)).list();
    assert.deepEqual(result, {
      ok: false,
      reason: "claude-code cannot manage subagents",
    });
  });
});

describe("subagents.write", () => {
  it("passes a trimmed draft through to the adapter", async () => {
    const { adapter, writes } = recordingAdapter();
    const result = await createSubagents(deps(adapter)).write({
      draft: draft({ name: " reviewer ", prompt: "  body  ", model: " opus " }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(writes, [
      {
        projectDir: "/workspace/p",
        draft: {
          name: "reviewer",
          description: "Reviews code",
          prompt: "body",
          model: "opus",
          tools: "",
          scope: "project",
        },
      },
    ]);
  });

  it("forwards previous so a rename can unlink the old file", async () => {
    const { adapter, writes } = recordingAdapter();
    await createSubagents(deps(adapter)).write({
      draft: draft({ name: "auditor" }),
      previous: { name: "reviewer", scope: "project" },
    });
    assert.deepEqual((writes[0] as { previous: unknown }).previous, {
      name: "reviewer",
      scope: "project",
    });
  });

  for (const [label, bad, pattern] of [
    ["a blank name", draft({ name: "  " }), /needs a name/],
    ["a name that is not kebab-case", draft({ name: "Code Reviewer" }), /lowercase letters/],
    ["a blank description", draft({ description: " " }), /cannot be blank/],
    ["a blank prompt", draft({ prompt: "\n" }), /not a subagent/],
  ] as const) {
    it(`refuses ${label} without touching the adapter`, async () => {
      const { adapter, writes } = recordingAdapter();
      const result = await createSubagents(deps(adapter)).write({ draft: bad });
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.benign, true);
      assert.match(result.ok ? "" : result.reason, pattern);
      assert.deepEqual(writes, []);
    });
  }

  it("caps how many one folder can hold, on create", async () => {
    const full = Array.from({ length: 200 }, (_, i) =>
      agent({ name: `agent-${i}` }),
    );
    const { adapter, writes } = recordingAdapter({ existing: full });
    const result = await createSubagents(deps(adapter)).write({ draft: draft() });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, /already holds 200/);
    assert.deepEqual(writes, []);
  });

  it("does not cap an edit — an existing agent stays editable at the ceiling", async () => {
    const full = Array.from({ length: 200 }, (_, i) =>
      agent({ name: `agent-${i}` }),
    );
    const { adapter } = recordingAdapter({ existing: full });
    const result = await createSubagents(deps(adapter)).write({
      draft: draft({ name: "agent-1" }),
      previous: { name: "agent-1", scope: "project" },
    });
    assert.equal(result.ok, true);
  });

  it("counts only the scope being written to", async () => {
    const full = Array.from({ length: 200 }, (_, i) =>
      agent({ name: `agent-${i}`, scope: "user" }),
    );
    const { adapter } = recordingAdapter({ existing: full });
    const result = await createSubagents(deps(adapter)).write({ draft: draft() });
    assert.equal(result.ok, true);
  });

  it("reports a name collision as the operator's to resolve, not a fault", async () => {
    const { adapter } = recordingAdapter({
      write: async () => {
        throw new Error("a project subagent named reviewer already exists");
      },
    });
    const result = await createSubagents(deps(adapter)).write({ draft: draft() });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.benign, true);
  });

  it("reports anything else as a fault", async () => {
    const { adapter } = recordingAdapter({
      write: async () => {
        throw new Error("EACCES: permission denied");
      },
    });
    const result = await createSubagents(deps(adapter)).write({ draft: draft() });
    assert.equal(!result.ok && result.benign, false);
    assert.match(result.ok ? "" : result.reason, /EACCES/);
  });

  it("refuses a second write while one is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { adapter } = recordingAdapter({
      write: async () => {
        await gate;
        return agent();
      },
    });
    const service = createSubagents(deps(adapter));
    const first = service.write({ draft: draft() });
    const second = await service.write({ draft: draft({ name: "other" }) });
    assert.equal(second.ok, false);
    assert.match(second.ok ? "" : second.reason, /already saving/);
    release();
    assert.equal((await first).ok, true);
  });

  it("writes for a provider that is not signed in", async () => {
    // Deliberate divergence from provider-options: writing a config file needs
    // no CLI and no credential, and an operator whose token expired must still
    // be able to fix the agent their next sign-in will run.
    const { adapter } = recordingAdapter({ authenticated: false });
    const result = await createSubagents(deps(adapter)).write({ draft: draft() });
    assert.equal(result.ok, true);
  });

  it("refuses an adapter that cannot write", async () => {
    const { adapter } = recordingAdapter({ omit: ["writeSubagent"] });
    const result = await createSubagents(deps(adapter)).write({ draft: draft() });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.benign, true);
  });
});

describe("subagents.remove", () => {
  it("asks the adapter by name and scope, composing no path", async () => {
    const { adapter, deletes } = recordingAdapter();
    const result = await createSubagents(deps(adapter)).remove({
      name: "reviewer",
      scope: "user",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(deletes, [
      { projectDir: "/workspace/p", name: "reviewer", scope: "user" },
    ]);
  });

  it("passes through a name the write path would refuse", async () => {
    // The point of resolving through the listing: a hand-written file with an
    // unusable name is the one most worth being able to delete.
    const { adapter, deletes } = recordingAdapter();
    const result = await createSubagents(deps(adapter)).remove({
      name: "code reviewer",
      scope: "project",
    });
    assert.equal(result.ok, true);
    assert.equal((deletes[0] as { name: string }).name, "code reviewer");
  });

  it("treats a missing agent as benign — already gone is the asked-for state", async () => {
    const { adapter } = recordingAdapter({
      remove: async () => {
        throw new Error("no project subagent named missing");
      },
    });
    const result = await createSubagents(deps(adapter)).remove({
      name: "missing",
      scope: "project" as SubagentScope,
    });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.benign, true);
  });

  it("reports a real failure as a fault", async () => {
    const { adapter } = recordingAdapter({
      remove: async () => {
        throw new Error("EACCES: permission denied");
      },
    });
    const result = await createSubagents(deps(adapter)).remove({
      name: "reviewer",
      scope: "project",
    });
    assert.equal(!result.ok && result.benign, false);
  });
});
