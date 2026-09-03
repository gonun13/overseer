import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdapterPlan, SessionMeta } from "@overseer/protocol";
import type { PlanStore } from "../src/memory/internal.js";
import { mergePlans } from "../src/plan-registry.js";

const PROJECT = "/workspace/demo";

function remembered(
  plan: AdapterPlan,
  override?: "done" | "archived",
): PlanStore {
  return {
    [plan.id]: {
      plan,
      ...(override !== undefined ? { override } : {}),
      at: "2026-09-02T10:00:00Z",
    },
  };
}

function plan(id: string, over: Partial<AdapterPlan> = {}): AdapterPlan {
  return {
    id,
    sessionId: `s-${id}`,
    projectDir: PROJECT,
    title: id,
    body: "# plan",
    createdAt: "2026-09-01T10:00:00Z",
    derived: "proposed",
    ...over,
  };
}

function session(id: string): SessionMeta {
  return {
    id,
    adapterId: "claude-code",
    projectDir: PROJECT,
    model: "",
    status: "dormant",
    createdAt: "2026-09-01T09:00:00Z",
    lastActiveAt: "2026-09-01T09:00:00Z",
    totalCostUsd: 0,
  };
}

describe("mergePlans", () => {
  it("reports what the transcript says when the operator has said nothing", () => {
    const p = plan("p1", { derived: "in-progress" });
    const merged = mergePlans([p], remembered(p), [], PROJECT);
    assert.equal(merged[0]?.status, "in-progress");
  });

  it("lets an operator's verdict win over the derived one", () => {
    const p = plan("p1", { derived: "in-progress" });
    const merged = mergePlans([p], remembered(p, "done"), [], PROJECT);
    assert.equal(merged[0]?.status, "done");
    // The reading itself is kept: the window shows the verdict, but the
    // transcript's own answer is still what the next reader derives from.
    assert.equal(merged[0]?.derived, "in-progress");
  });

  it("prefers the live transcript over the remembered copy", () => {
    const p = plan("p1", { derived: "in-progress" });
    const stale = remembered(plan("p1", { derived: "proposed", title: "old" }));
    const merged = mergePlans([p], stale, [], PROJECT);
    assert.equal(merged[0]?.derived, "in-progress");
    assert.equal(merged[0]?.title, "p1");
  });

  it("keeps listing a plan whose transcript has been deleted", () => {
    const p = plan("p1", { derived: "proposed" });
    const merged = mergePlans([], remembered(p), [], PROJECT);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.sessionExists, false);
  });

  it("does not list a remembered plan from another project", () => {
    const other = plan("p1", { projectDir: "/workspace/elsewhere" });
    assert.deepEqual(mergePlans([], remembered(other), [], PROJECT), []);
  });

  it("marks a plan whose session is still listed", () => {
    const p = plan("p1");
    const merged = mergePlans([p], {}, [session("s-p1")], PROJECT);
    assert.equal(merged[0]?.sessionExists, true);
  });

  it("orders newest first, whatever order the adapter read them in", () => {
    const merged = mergePlans(
      [
        plan("old", { createdAt: "2026-09-01T10:00:00Z" }),
        plan("new", { createdAt: "2026-09-03T10:00:00Z" }),
      ],
      {},
      [],
      PROJECT,
    );
    assert.deepEqual(merged.map((p) => p.id), ["new", "old"]);
  });
});
