import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { cursorAdapter } from "../src/index.js";

/**
 * `getStatus` has no `refreshUsage` to hand off to (cursor's `agent` CLI has
 * no subscription-window report), so it must stamp `usageState: "unavailable"`
 * itself whenever signed in — leaving it undefined reads, on the widget's
 * fallback, as "pending" and draws a countdown for a refresh that never runs.
 */

let binDir: string;
let originalPath: string | undefined;

function fakeCli(authenticated: boolean): string {
  const status = authenticated
    ? '{"status":"authenticated","isAuthenticated":true,"userInfo":{"email":"ada@example.com"}}'
    : '{"status":"unauthenticated","isAuthenticated":false}';
  return `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2026.08.31-4057e58"; exit 0; fi
if [ "$1" = "status" ]; then printf '%s\\n' '${status}'; exit 0; fi
exit 1
`;
}

async function writeStub(authenticated: boolean): Promise<void> {
  const file = path.join(binDir, "agent");
  await writeFile(file, fakeCli(authenticated), "utf8");
  await chmod(file, 0o755);
}

before(async () => {
  binDir = await mkdtemp(path.join(tmpdir(), "overseer-cursor-cli-"));
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

after(() => {
  process.env.PATH = originalPath;
});

describe("cursorAdapter.getStatus", () => {
  it("stamps usageState unavailable when signed in", async () => {
    await writeStub(true);
    const status = await cursorAdapter.getStatus();
    assert.equal(status.authenticated, true);
    assert.equal(status.usageState, "unavailable");
    assert.equal(status.usage, undefined);
  });

  it("carries no usageState when signed out", async () => {
    await writeStub(false);
    const status = await cursorAdapter.getStatus();
    assert.equal(status.authenticated, false);
    assert.equal(status.usageState, undefined);
  });
});
