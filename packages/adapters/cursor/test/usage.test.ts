import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { checkUsage, parseUsageReport } from "../src/usage.js";

/**
 * `checkUsage` spawns `agent -p "/usage" --output-format json --trust` and
 * reads back the same `{type:"result", is_error, result}` envelope
 * claude-code's own `/usage` uses — verified live against
 * 2026.08.31-4057e58 (see `usage.ts`'s module doc): `result` is the model's
 * own markdown prose, not a fixed report, but the JSON wrapper around it is
 * consistent.
 */

/**
 * The real thing, captured from `agent -p "/usage" --output-format json
 * --trust` against 2026.08.31-4057e58 on 2026-09-02 (Pro account). Kept whole,
 * including the model's narration of its own tool calls, because that preamble
 * is exactly the kind of noise the parser has to walk past.
 */
const PINNED_REPORT = `Checking what \`/usage\` refers to in this project and environment.
Checking Cursor docs and CLI for the \`/usage\` command.
Fetching your Cursor account usage from the API.
Shell access to the API was blocked; checking for locally cached usage data.
## Usage

**Account:** ada@example.com · **Pro** ($20/mo)
**Billing cycle:** Aug 4 – Sep 4, 2026 (resets Sep 4)

### Included usage

| Pool | Used | Status |
|------|------|--------|
| **Total** | 9.1% | $45.13 total ($20.00 included + $25.13 bonus) |
| **Auto** | 0% | — |
| **API (named models)** | **100%** | Limit reached |

You've used all included API (named model) usage for this cycle. Bonus usage from model providers is covering additional spend beyond your $20 included allowance.

### Spend this cycle

| Model | Cost |
|-------|------|
| claude-opus-5-thinking-high | $25.72 |
| gpt-5.6-sol-medium | $10.23 |
| composer-2.5-fast | $9.18 |
| Auto (default) | $0.00 |
| **Total** | **$45.13** |

### Notes

- **On-demand billing:** Disabled — you can't exceed included limits without enabling it.
- **Named models are throttled** — switch to **Auto** to continue, or enable on-demand usage / upgrade to Pro+.
- **Full breakdown:** [cursor.com/dashboard/spending](https://cursor.com/dashboard/spending)`;

let binDir: string;
let projectDir: string;
let originalPath: string | undefined;

async function writeStub(script: string): Promise<void> {
  const file = path.join(binDir, "agent");
  await writeFile(file, script, "utf8");
  await chmod(file, 0o755);
}

before(async () => {
  binDir = await mkdtemp(path.join(tmpdir(), "overseer-cursor-usage-"));
  projectDir = await mkdtemp(path.join(tmpdir(), "overseer-cursor-project-"));
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

after(() => {
  process.env.PATH = originalPath;
});

describe("parseUsageReport", () => {
  it("reads pools, percentages and cycle spend out of the pinned report", () => {
    assert.deepEqual(parseUsageReport(PINNED_REPORT), {
      windows: [
        { id: "total", label: "total", used: 0.091, resets: "Sep 4" },
        { id: "auto", label: "auto", used: 0, resets: "Sep 4" },
        {
          id: "api-named-models",
          label: "api (named models)",
          used: 1,
          resets: "Sep 4",
        },
      ],
      spend: "$45.13",
    });
  });

  it("takes the spend table's own total, not the pools table's amount clause", () => {
    // `| **Total** | 9.1% | $45.13 total ($20.00 included + …) |` is a
    // sentence, not a figure — only a cell that is *only* an amount counts.
    const { spend } = parseUsageReport(`
| **Total** | 9.1% | $45.13 total ($20.00 included + $25.13 bonus) |
`);
    assert.equal(spend, undefined);
  });

  it("keeps a 0% pool but refuses a row with no clean percentage", () => {
    const { windows } = parseUsageReport(`
| Pool | Used |
|------|------|
| **Auto** | 0% |
| **Bonus** | plenty left |
| **Odd** | 100% of $20 |
`);
    assert.deepEqual(windows, [{ id: "auto", label: "auto", used: 0 }]);
  });

  it("reads nothing out of prose that has no pool table", () => {
    assert.deepEqual(
      parseUsageReport(
        "I could not reach the usage API, so I have nothing to report.",
      ),
      { windows: [] },
    );
  });

  it("refuses a percentage outside 0-100 rather than clamping it", () => {
    const { windows } = parseUsageReport("| **Total** | 140% |");
    assert.deepEqual(windows, []);
  });

  it("caps how many gauges one report can put on the instrument", () => {
    const rows = ["a", "b", "c", "d", "e", "f"]
      .map((name) => `| ${name} | 10% |`)
      .join("\n");
    assert.equal(parseUsageReport(rows).windows.length, 4);
  });

  it("does not mine a long prose line for a reset date", () => {
    // Only short, cycle-shaped lines are read for the phrase — otherwise any
    // sentence mentioning a reset would end up under a gauge as a date.
    const { windows } = parseUsageReport(
      `Your quota resets whenever the provider decides it does, which is not something this report can tell you with any confidence at all.\n| **Total** | 5% |`,
    );
    assert.deepEqual(windows, [{ id: "total", label: "total", used: 0.05 }]);
  });
});

describe("checkUsage", () => {
  it("reads the model's prose out of the result envelope", async () => {
    const report = "## Usage\\n\\n**Account:** ada@example.com";
    await writeStub(`#!/bin/sh
printf '%s' '{"type":"result","is_error":false,"result":"${report}"}'
`);
    const result = await checkUsage({ projectDir });
    assert.deepEqual(result, {
      ok: true,
      report: "## Usage\n\n**Account:** ada@example.com",
      // Prose with no pool table in it: no gauges, and no invented zero.
      windows: [],
    });
  });

  it("passes the project dir as cwd", async () => {
    await writeStub(`#!/bin/sh
printf '%s' "{\\"type\\":\\"result\\",\\"is_error\\":false,\\"result\\":\\"$(pwd)\\"}"
`);
    const result = await checkUsage({ projectDir });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.report, projectDir);
  });

  it("surfaces is_error as a refusal, not a report", async () => {
    await writeStub(`#!/bin/sh
printf '%s' '{"type":"result","is_error":true,"result":"model refused"}'
`);
    const result = await checkUsage({ projectDir });
    assert.deepEqual(result, { ok: false, reason: "model refused" });
  });

  it("refuses on output that is not the expected envelope", async () => {
    await writeStub(`#!/bin/sh
printf 'not json at all'
`);
    const result = await checkUsage({ projectDir });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /could not read/);
  });

  it("refuses when the CLI answers with nothing", async () => {
    await writeStub(`#!/bin/sh
exit 0
`);
    const result = await checkUsage({ projectDir });
    assert.deepEqual(result, { ok: false, reason: "agent did not answer" });
  });

  it("settles unavailable when the CLI never answers, rather than hanging", async () => {
    await writeStub(`#!/bin/sh
trap '' TERM
sleep 30
`);
    const result = await checkUsage({
      projectDir,
      timeoutMs: 40,
      killGraceMs: 20,
    });
    assert.equal(result.ok, false);
  });
});
