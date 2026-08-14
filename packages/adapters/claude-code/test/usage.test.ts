import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { claudeCodeAdapter } from "../src/index.js";
import { parseUsageReport, readUsageWindows, withUsage } from "../src/usage.js";

/**
 * Prose captured from `claude -p "/usage" --output-format json` against
 * 2.1.226 in the dev container, 2026-08-14. The JSON envelope is the live
 * shape; the two Current * lines are what the widget draws.
 */
const PINNED_RESULT = `You are currently using your subscription to power your Claude Code usage

Current session: 16% used · resets Aug 14, 11:30pm (UTC)
Current week (all models): 11% used · resets Aug 21, 3am (UTC)`;

const PINNED_JSON = JSON.stringify({
  type: "result",
  is_error: false,
  result: PINNED_RESULT,
  num_turns: 0,
  total_cost_usd: 0,
});

describe("parseUsageReport", () => {
  it("reads session and week from the pinned 2.1.226 report", () => {
    assert.deepEqual(parseUsageReport(PINNED_RESULT), [
      {
        id: "session",
        label: "session",
        used: 0.16,
        resets: "Aug 14, 11:30pm (UTC)",
      },
      {
        id: "week",
        label: "week",
        used: 0.11,
        resets: "Aug 21, 3am (UTC)",
      },
    ]);
  });

  it("accepts the 'resets … at …' phrasing and extra weekly caps", () => {
    const text = [
      "Current session: 60% used · resets Aug 10 at 8:59pm (Asia/Seoul)",
      "Current week (all models): 96% used · resets Aug 13 at 7:59am (Asia/Seoul)",
      "Current week (Fable): 100% used · resets Aug 13 at 8am (Asia/Seoul)",
    ].join("\n");
    assert.deepEqual(parseUsageReport(text), [
      {
        id: "session",
        label: "session",
        used: 0.6,
        resets: "Aug 10 at 8:59pm (Asia/Seoul)",
      },
      {
        id: "week",
        label: "week",
        used: 0.96,
        resets: "Aug 13 at 7:59am (Asia/Seoul)",
      },
      {
        id: "week:fable",
        label: "fable",
        used: 1,
        resets: "Aug 13 at 8am (Asia/Seoul)",
      },
    ]);
  });

  it("keeps a 0% reading and drops a line with no percentage", () => {
    const text = [
      "Current session: 0% used · resets Aug 14, 11:30pm (UTC)",
      "Current week (all models): used · resets Aug 21, 3am (UTC)",
    ].join("\n");
    assert.deepEqual(parseUsageReport(text), [
      {
        id: "session",
        label: "session",
        used: 0,
        resets: "Aug 14, 11:30pm (UTC)",
      },
    ]);
  });

  it("returns nothing for prose that is not a usage report", () => {
    assert.deepEqual(parseUsageReport("not logged in"), []);
    assert.deepEqual(parseUsageReport(""), []);
  });
});

describe("readUsageWindows / withUsage", () => {
  let binDir: string;
  let originalPath: string | undefined;

  before(async () => {
    binDir = await mkdtemp(path.join(tmpdir(), "overseer-usage-"));
    const fixture = path.join(binDir, "usage.json");
    await writeFile(fixture, `${PINNED_JSON}\n`, "utf8");
    const file = path.join(binDir, "claude");
    await writeFile(
      file,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.226 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'
  exit 0
fi
if [ "$1" = "-p" ]; then
  cat "$USAGE_FIXTURE"
  exit 0
fi
exit 1
`,
      "utf8",
    );
    await chmod(file, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    process.env.USAGE_FIXTURE = fixture;
  });

  after(() => {
    process.env.PATH = originalPath;
    delete process.env.USAGE_FIXTURE;
  });

  it("pulls windows out of the JSON envelope, not the exit code", async () => {
    const windows = await readUsageWindows();
    assert.equal(windows.length, 2);
    assert.equal(windows[0]?.id, "session");
    assert.equal(windows[1]?.id, "week");
  });

  it("attaches usage only when the operator is signed in", async () => {
    const signedOut = await withUsage({
      authenticated: false,
      version: "2.1.226",
    });
    assert.equal(signedOut.usage, undefined);

    const signedIn = await withUsage({
      authenticated: true,
      version: "2.1.226",
    });
    assert.equal(signedIn.usage?.length, 2);
  });

  it("surfaces usage on getStatus when the CLI is signed in", async () => {
    const status = await claudeCodeAdapter.getStatus();
    assert.equal(status.authenticated, true);
    assert.equal(status.version, "2.1.226");
    assert.equal(status.usage?.[0]?.used, 0.16);
    assert.equal(status.usage?.[1]?.used, 0.11);
  });
});
