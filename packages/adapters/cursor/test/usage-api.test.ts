import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readDashboardUsage } from "../src/usage-api.js";

/**
 * The direct read: the token `agent login` leaves on disk, POSTed to the same
 * dashboard endpoints the CLI uses. Payloads here are the real ones, captured
 * from a Pro account on 2026-09-08 — including `billingCycleEnd` arriving as
 * a string of epoch millis while the spend figures arrive as numbers.
 */

const USAGE = {
  billingCycleStart: "1788516389000",
  billingCycleEnd: "1791108389000",
  planUsage: {
    totalSpend: 38,
    includedSpend: 38,
    remaining: 1962,
    limit: 2000,
    autoPercentUsed: 0,
    apiPercentUsed: 0.8444444444444443,
    totalPercentUsed: 0.07676767676767676,
  },
  displayMessage: "You've used 2% of your included usage",
};

const PLAN = {
  planInfo: {
    planName: "Pro",
    includedAmountCents: 2000,
    price: "$20/mo",
  },
};

async function homeWithToken(token = "eyJhbGciOi.test"): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "overseer-cursor-home-"));
  const dir = path.join(home, ".config", "cursor");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "auth.json"),
    JSON.stringify({ accessToken: token, refreshToken: "r" }),
    "utf8",
  );
  return home;
}

/** A fetch that answers each dashboard method from a table, recording calls. */
function stubFetch(
  answers: Record<string, { status?: number; body?: unknown }>,
): typeof fetch & { calls: { url: string; auth: string | null }[] } {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization") });
    const method = url.split("/").pop() ?? "";
    const answer = answers[method] ?? { status: 404 };
    const status = answer.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => answer.body,
    } as Response;
  }) as typeof fetch & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

describe("readDashboardUsage", () => {
  it("turns the live payload into gauges, spend and a report", async () => {
    const home = await homeWithToken();
    const fetchImpl = stubFetch({
      GetCurrentPeriodUsage: { body: USAGE },
      GetPlanInfo: { body: PLAN },
    });

    const result = await readDashboardUsage({ home, fetchImpl });
    assert.notEqual(result, undefined);
    assert.deepEqual(result?.windows, [
      // Spend against the included limit — the ratio the display message
      // rounds to "2%", not the API's own `totalPercentUsed`, which is on
      // some other scale entirely.
      { id: "included", label: "included", used: 0.019, resets: "Oct 4, 2026" },
      { id: "auto", label: "auto", used: 0, resets: "Oct 4, 2026" },
      {
        id: "api",
        label: "api",
        used: 0.008444444444444444,
        resets: "Oct 4, 2026",
      },
    ]);
    assert.equal(result?.spend, "$0.38");
    assert.match(result?.report ?? "", /\*\*Plan:\*\* Pro \$20\/mo/);
    assert.match(result?.report ?? "", /\| included \| 1\.9% \(\$0\.38 of \$20\.00\) \|/);
    assert.match(result?.report ?? "", /used 2% of your included usage/);
  });

  it("sends the stored token as a bearer to both endpoints", async () => {
    const home = await homeWithToken("tok-123");
    const fetchImpl = stubFetch({
      GetCurrentPeriodUsage: { body: USAGE },
      GetPlanInfo: { body: PLAN },
    });

    await readDashboardUsage({ home, fetchImpl });
    assert.deepEqual(
      fetchImpl.calls.map((call) => call.url),
      [
        "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
        "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo",
      ],
    );
    for (const call of fetchImpl.calls) {
      assert.equal(call.auth, "Bearer tok-123");
    }
  });

  it("still reports the gauges when the plan lookup fails", async () => {
    const home = await homeWithToken();
    const fetchImpl = stubFetch({
      GetCurrentPeriodUsage: { body: USAGE },
      GetPlanInfo: { status: 500 },
    });

    const result = await readDashboardUsage({ home, fetchImpl });
    assert.equal(result?.windows.length, 3);
    assert.doesNotMatch(result?.report ?? "", /\*\*Plan:\*\*/);
  });

  it("gives up rather than guess when there is no token", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "overseer-cursor-home-"));
    const fetchImpl = stubFetch({ GetCurrentPeriodUsage: { body: USAGE } });
    assert.equal(await readDashboardUsage({ home, fetchImpl }), undefined);
    assert.equal(fetchImpl.calls.length, 0);
  });

  it("gives up on an unauthorized read", async () => {
    const home = await homeWithToken();
    const fetchImpl = stubFetch({ GetCurrentPeriodUsage: { status: 401 } });
    assert.equal(await readDashboardUsage({ home, fetchImpl }), undefined);
  });

  it("gives up when the payload no longer carries the spend figures", async () => {
    // The shape moved. Better to hand the ask to the CLI than to draw a
    // gauge out of fields that no longer mean what they used to.
    const home = await homeWithToken();
    const fetchImpl = stubFetch({
      GetCurrentPeriodUsage: {
        body: { planUsage: { autoPercentUsed: 0, apiPercentUsed: 12 } },
      },
    });
    assert.equal(await readDashboardUsage({ home, fetchImpl }), undefined);
  });

  it("gives up when the network read throws", async () => {
    const home = await homeWithToken();
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND api2.cursor.sh");
    }) as unknown as typeof fetch;
    assert.equal(await readDashboardUsage({ home, fetchImpl }), undefined);
  });
});
