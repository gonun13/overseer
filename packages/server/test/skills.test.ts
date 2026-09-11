import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAdapter, Skill, SkillSource } from "@overseer/protocol";
import { createSkills } from "../src/skills.js";

function skill(over: Partial<Skill> = {}): Skill {
  return {
    name: "pdf-forms",
    description: "Fills in PDF forms",
    scope: "project",
    dir: "/workspace/p/.claude/skills/pdf-forms",
    file: "/workspace/p/.claude/skills/pdf-forms/SKILL.md",
    files: [],
    ...over,
  };
}

const upload: SkillSource = {
  kind: "upload",
  files: [{ path: "SKILL.md", text: "---\nname: pdf-forms\n---\n" }],
};

/** An adapter that records what it was actually asked to do. */
function recordingAdapter(
  over: {
    existing?: Skill[];
    importSkills?: (opts: unknown) => Promise<{ imported: Skill[]; skipped: { name: string; reason: string }[] }>;
    remove?: (opts: unknown) => Promise<void>;
    omit?: ("listSkills" | "importSkills" | "deleteSkill")[];
  } = {},
) {
  const imports: unknown[] = [];
  const deletes: unknown[] = [];
  const adapter: Record<string, unknown> = {
    id: "claude-code",
    getStatus: async () => ({ authenticated: true }),
    listSkills: async () => over.existing ?? [],
    importSkills: async (opts: unknown) => {
      imports.push(opts);
      return over.importSkills !== undefined
        ? over.importSkills(opts)
        : { imported: [skill()], skipped: [] };
    },
    deleteSkill: async (opts: unknown) => {
      deletes.push(opts);
      if (over.remove !== undefined) await over.remove(opts);
    },
  };
  for (const method of over.omit ?? []) delete adapter[method];
  return { adapter: adapter as unknown as AgentAdapter, imports, deletes };
}

/** A fetch that records the source and hands back a fixed directory. */
function recordingFetch(over: { fail?: string } = {}) {
  const seen: SkillSource[] = [];
  let cleaned = 0;
  const fetchSource = async (source: SkillSource) => {
    seen.push(source);
    if (over.fail !== undefined) return { ok: false as const, reason: over.fail };
    return {
      ok: true as const,
      dir: "/workspace/_overseer/skill-import/s-1/skill",
      cleanup: async () => {
        cleaned += 1;
      },
    };
  };
  return { fetchSource, seen, cleanups: () => cleaned };
}

function deps(
  adapter: AgentAdapter,
  over: {
    project?: string | undefined;
    provider?: string | undefined;
    fetchSource?: ReturnType<typeof recordingFetch>["fetchSource"];
    now?: () => number;
  } = {},
) {
  return {
    readSnapshot: async () =>
      ({
        attached_provider: "provider" in over ? over.provider : "claude-code",
        last_active_project: "project" in over ? over.project : "/workspace/p",
      }) as never,
    isInsideWorkspace: async () => true,
    getAdapter: () => adapter,
    ...(over.fetchSource !== undefined ? { fetchSource: over.fetchSource } : {}),
    // Past any cooldown by default, so a test that is not about rate limiting
    // does not have to think about one.
    now: over.now ?? (() => 1_000_000),
  };
}

describe("skills.list", () => {
  it("reports the adapter's inventory for the active project", async () => {
    const { adapter } = recordingAdapter({ existing: [skill()] });
    const result = await createSkills(deps(adapter)).list();
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.providerId, "claude-code");
    assert.equal(result.ok && result.projectDir, "/workspace/p");
    assert.equal(result.ok && result.skills.length, 1);
  });

  it("refuses when no provider is attached", async () => {
    const { adapter } = recordingAdapter();
    const result = await createSkills(deps(adapter, { provider: undefined })).list();
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /no provider attached/);
  });

  it("says the provider cannot, rather than reporting an empty inventory", async () => {
    // "you have no skills" and "this provider has no skills" are different
    // answers, and only one of them invites an import.
    const { adapter } = recordingAdapter({ omit: ["listSkills"] });
    const result = await createSkills(deps(adapter)).list();
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /claude-code cannot manage skills/);
  });
});

describe("skills.importSkill", () => {
  it("hands the adapter a staging dir and a scope — and composes no path", async () => {
    const fetch = recordingFetch();
    const { adapter, imports } = recordingAdapter();
    const result = await createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource }),
    ).importSkill({ source: upload, scope: "project" });

    assert.equal(result.ok, true);
    assert.deepEqual(imports, [
      {
        projectDir: "/workspace/p",
        stagingDir: "/workspace/_overseer/skill-import/s-1/skill",
        scope: "project",
      },
    ]);
    // Nothing resembling a destination folder crossed this boundary.
    const passed = JSON.stringify(imports[0]);
    assert.doesNotMatch(passed, /\.claude|skills\/pdf-forms/);
  });

  it("passes an operator's name through, and omits it when blank", async () => {
    const fetch = recordingFetch();
    const { adapter, imports } = recordingAdapter();
    const service = createSkills(deps(adapter, { fetchSource: fetch.fetchSource }));

    await service.importSkill({ source: upload, scope: "user", name: "renamed" });
    assert.equal((imports[0] as { name?: string }).name, "renamed");
  });

  it("cleans up the staging directory, on success and on failure alike", async () => {
    const ok = recordingFetch();
    const { adapter } = recordingAdapter();
    await createSkills(deps(adapter, { fetchSource: ok.fetchSource })).importSkill({
      source: upload,
      scope: "project",
    });
    assert.equal(ok.cleanups(), 1);

    const bad = recordingFetch();
    const failing = recordingAdapter({
      importSkills: async () => {
        throw new Error("no skill found in that source");
      },
    });
    const result = await createSkills(
      deps(failing.adapter, { fetchSource: bad.fetchSource }),
    ).importSkill({ source: upload, scope: "project" });

    assert.equal(result.ok, false);
    // The staging tree never outlives the copy out of it, even when there was
    // no copy.
    assert.equal(bad.cleanups(), 1);
  });

  it("treats a name already taken as the operator's to resolve, not a fault", async () => {
    const fetch = recordingFetch();
    const { adapter } = recordingAdapter({
      importSkills: async () => ({
        imported: [],
        skipped: [{ name: "pdf-forms", reason: "already installed" }],
      }),
    });
    const result = await createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource }),
    ).importSkill({ source: upload, scope: "project" });

    // Nothing landed, so this is a refusal — but it carries the adapter's own
    // reason rather than a generic one, and it is not a fault.
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.benign, true);
    assert.match(!result.ok ? result.reason : "", /already installed/);
  });

  it("reports what landed and what was passed over", async () => {
    const fetch = recordingFetch();
    const { adapter } = recordingAdapter({
      importSkills: async () => ({
        imported: [skill({ name: "janitor" })],
        skipped: [
          { name: "changelog", reason: "already installed" },
          { name: "diagnose", reason: "already installed" },
        ],
      }),
    });
    const result = await createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource }),
    ).importSkill({ source: upload, scope: "project" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.skills.map((s) => s.name), ["janitor"]);
    assert.equal(result.ok && result.skipped.length, 2);
  });

  it("groups repeated reasons rather than repeating a sentence", async () => {
    const fetch = recordingFetch();
    const { adapter } = recordingAdapter({
      importSkills: async () => ({
        imported: [],
        skipped: Array.from({ length: 9 }, (_, i) => ({
          name: `s${i}`,
          reason: "already installed",
        })),
      }),
    });
    const result = await createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource }),
    ).importSkill({ source: upload, scope: "project" });

    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /9 already installed/);
  });

  it("surfaces a failed fetch in the fetcher's own words", async () => {
    const fetch = recordingFetch({ fail: "that repository is private, or does not exist" });
    const { adapter, imports } = recordingAdapter();
    const result = await createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource }),
    ).importSkill({
      source: { kind: "git", url: "https://example.com/private" },
      scope: "project",
    });

    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /private, or does not exist/);
    // Nothing reached the adapter, because nothing was fetched.
    assert.deepEqual(imports, []);
  });

  it("refuses a name the folder could not be composed from", async () => {
    const fetch = recordingFetch();
    const { adapter, imports } = recordingAdapter();
    const result = await createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource }),
    ).importSkill({ source: upload, scope: "project", name: "Not Kebab" });

    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /lowercase letters/);
    assert.deepEqual(imports, []);
  });

  it("holds the folder to a ceiling, counting only what it owns", async () => {
    const fetch = recordingFetch();
    // Foreign rows are another provider's folder, so they do not fill ours.
    const existing = [
      ...Array.from({ length: 200 }, (_, i) => skill({ name: `s${i}` })),
      skill({ name: "borrowed", foreign: ".claude/skills" }),
    ];
    const { adapter } = recordingAdapter({ existing });
    const result = await createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource }),
    ).importSkill({ source: upload, scope: "project" });

    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /already holds 200 skills/);
  });

  it("rate-limits back-to-back imports", async () => {
    const fetch = recordingFetch();
    let clock = 1_000_000;
    const { adapter } = recordingAdapter();
    const service = createSkills(
      deps(adapter, { fetchSource: fetch.fetchSource, now: () => clock }),
    );

    const first = await service.importSkill({ source: upload, scope: "project" });
    assert.equal(first.ok, true);

    clock += 100;
    const second = await service.importSkill({ source: upload, scope: "project" });
    assert.equal(second.ok, false);
    assert.equal(!second.ok && second.benign, true);

    clock += 5_000;
    const third = await service.importSkill({ source: upload, scope: "project" });
    assert.equal(third.ok, true);
  });

  it("says the provider cannot when it has no import at all", async () => {
    const { adapter } = recordingAdapter({ omit: ["importSkills"] });
    const result = await createSkills(deps(adapter)).importSkill({
      source: upload,
      scope: "project",
    });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /cannot manage skills/);
  });
});

describe("skills.remove", () => {
  it("passes the name and scope through untouched", async () => {
    const { adapter, deletes } = recordingAdapter();
    const result = await createSkills(deps(adapter)).remove({
      name: "pdf-forms",
      scope: "user",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(deletes, [
      { projectDir: "/workspace/p", name: "pdf-forms", scope: "user" },
    ]);
  });

  it("treats already-gone as the outcome the operator asked for", async () => {
    const { adapter } = recordingAdapter({
      remove: async () => {
        throw new Error("no user skill named pdf-forms");
      },
    });
    const result = await createSkills(deps(adapter)).remove({
      name: "pdf-forms",
      scope: "user",
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.benign, true);
  });
});
