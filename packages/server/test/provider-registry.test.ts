import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { readProviderManifests } from "../src/provider-registry.js";

/** Write providers/<id>/manifest.json with whatever body the case needs. */
async function bundle(root: string, id: string, body: unknown): Promise<void> {
  await mkdir(path.join(root, id), { recursive: true });
  await writeFile(
    path.join(root, id, "manifest.json"),
    typeof body === "string" ? body : JSON.stringify(body),
    "utf8",
  );
}

const valid = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  cli: id,
  configDir: `.${id}`,
  app: "stub",
  loop: "none",
  ...over,
});

describe("provider registry", () => {
  let root: string;
  let errors: string[];
  let restoreConsole: () => void;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "overseer-providers-"));
    // The reader logs a reason for every manifest it drops. Capture rather
    // than silence: the tests below assert it does not fail quietly.
    errors = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    restoreConsole = () => {
      console.error = original;
    };
  });

  after(async () => {
    restoreConsole();
    await rm(root, { recursive: true, force: true });
  });

  it("reads every manifest, sorted by id", async () => {
    await bundle(root, "zeta", valid("zeta"));
    await bundle(root, "alpha", valid("alpha", { app: "adapter", loop: "bundle" }));

    const manifests = readProviderManifests(root);
    assert.deepEqual(
      manifests.map((m) => m.id),
      ["alpha", "zeta"],
    );
    assert.equal(manifests[0]?.app, "adapter");
    assert.equal(manifests[0]?.loop, "bundle");
    assert.equal(manifests[1]?.configDir, ".zeta");
  });

  it("skips a directory with no manifest, silently", async () => {
    await mkdir(path.join(root, "not-a-provider"), { recursive: true });
    const before = errors.length;

    const ids = readProviderManifests(root).map((m) => m.id);
    assert.equal(ids.includes("not-a-provider"), false);
    assert.equal(errors.length, before, "a plain directory is not an error");
  });

  it("drops a malformed manifest and says why, without throwing", async () => {
    await bundle(root, "broken-json", "{ not json");
    await bundle(root, "wrong-id", valid("something-else"));
    await bundle(root, "bad-role", valid("bad-role", { app: "sometimes" }));
    await bundle(root, "no-cli", { id: "no-cli", configDir: ".x", app: "stub", loop: "none" });

    const ids = readProviderManifests(root).map((m) => m.id);
    for (const dropped of ["broken-json", "wrong-id", "bad-role", "no-cli"]) {
      assert.equal(ids.includes(dropped), false, `${dropped} should be dropped`);
      assert.ok(
        errors.some((line) => line.includes(dropped)),
        `${dropped} should be reported`,
      );
    }
    // The good ones from earlier cases are still there.
    assert.equal(ids.includes("alpha"), true);
  });

  it("returns nothing when the registry directory is missing", () => {
    assert.deepEqual(readProviderManifests(path.join(root, "nope")), []);
  });
});
