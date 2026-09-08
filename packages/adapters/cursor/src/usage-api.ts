import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AdapterUsageWindow } from "@overseer/protocol";

/**
 * The fast, deterministic half of the cursor usage read: the same dashboard
 * endpoints the CLI itself is authenticated against, called directly with the
 * token the CLI stored at login.
 *
 * Why this exists at all — `usage.ts` used to ask the model for the numbers
 * (`agent -p "/usage"`), and that stopped working: verified live against
 * 2026.09.02-c22c1a3, the model now answers "/usage is a built-in interactive
 * command, run it yourself" and reports nothing, so the widget drew no gauges.
 * The model *can* still fetch them, but only with shell access and after a
 * ~160s, ~100k-token turn. So the CLI turn became the fallback (see
 * `usage.ts`) and this — sub-second, free, and the same source the model
 * reaches for anyway — became the first try.
 *
 * Everything here fails soft: a missing token, an endpoint that moved, an
 * answer whose shape changed all return `undefined`, and the caller asks the
 * model instead. Nothing here is ever guessed or filled in with a plausible
 * zero.
 */

/** Where `agent login` leaves the bearer token, newest location first. */
function tokenPaths(home: string): string[] {
  const xdg = process.env.XDG_CONFIG_HOME;
  return [
    path.join(xdg !== undefined && xdg !== "" ? xdg : path.join(home, ".config"), "cursor", "auth.json"),
    path.join(home, ".cursor", "auth.json"),
    path.join(home, "Library", "Application Support", "cursor", "auth.json"),
  ];
}

/** The CLI's own endpoint override, so a self-hosted endpoint is honoured. */
function apiBase(): string {
  const endpoint = process.env.CURSOR_API_ENDPOINT;
  const base = endpoint !== undefined && endpoint.trim() !== "" ? endpoint.trim() : "https://api2.cursor.sh";
  return base.replace(/\/+$/, "");
}

/** Reads are free, but must never hold the operator's click open. */
const API_TIMEOUT_MS = 10_000;

export interface DashboardDeps {
  home?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function readToken(home: string): Promise<string | undefined> {
  for (const file of tokenPaths(home)) {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
      const token = (raw as { accessToken?: unknown } | null)?.accessToken;
      if (typeof token === "string" && token.trim() !== "") return token.trim();
    } catch {
      // Missing or unreadable is the ordinary case on a machine that never
      // logged in here; try the next location.
    }
  }
  return undefined;
}

async function post(
  deps: Required<Pick<DashboardDeps, "fetchImpl" | "timeoutMs">>,
  method: string,
  token: string,
): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetchImpl(
      `${apiBase()}/aiserver.v1.DashboardService/${method}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as unknown;
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** A number however the wire spelled it — these fields arrive as both. */
function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Cents to the operator's own units. */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** `1791108389000` → `Oct 4, 2026`. Undefined for anything implausible. */
function whenResets(ms: number | undefined): string | undefined {
  if (ms === undefined || ms <= 0) return undefined;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function gauge(
  id: string,
  label: string,
  fraction: number | undefined,
  resets: string | undefined,
): AdapterUsageWindow | undefined {
  if (fraction === undefined || !Number.isFinite(fraction)) return undefined;
  if (fraction < 0 || fraction > 1) return undefined;
  return { id, label, used: fraction, ...(resets !== undefined ? { resets } : {}) };
}

export interface DashboardUsage {
  windows: AdapterUsageWindow[];
  report: string;
  spend?: string;
}

/**
 * Read the account's current period straight from the dashboard service.
 * `undefined` whenever the read cannot be trusted end to end — no token, a
 * non-200, or a payload without the spend figures this draws its gauges from.
 */
export async function readDashboardUsage(
  deps: DashboardDeps = {},
): Promise<DashboardUsage | undefined> {
  const home = deps.home ?? homedir();
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? API_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") return undefined;

  const token = await readToken(home);
  if (token === undefined) return undefined;

  const usage = await post({ fetchImpl, timeoutMs }, "GetCurrentPeriodUsage", token);
  if (usage === undefined) return undefined;

  const plan = record(usage["planUsage"]);
  if (plan === undefined) return undefined;

  const limit = num(plan["limit"]);
  const spent = num(plan["totalSpend"]);
  // The included-spend gauge is the one the operator reads as "how much of my
  // plan is gone", so without both halves of that ratio there is no reading
  // worth drawing and the model gets asked instead.
  if (limit === undefined || limit <= 0 || spent === undefined || spent < 0) {
    return undefined;
  }

  const resets = whenResets(num(usage["billingCycleEnd"]));
  const percent = (value: unknown): number | undefined => {
    const raw = num(value);
    return raw === undefined ? undefined : raw / 100;
  };

  const windows = [
    gauge("included", "included", Math.min(spent / limit, 1), resets),
    gauge("auto", "auto", percent(plan["autoPercentUsed"]), resets),
    gauge("api", "api", percent(plan["apiPercentUsed"]), resets),
  ].filter((window): window is AdapterUsageWindow => window !== undefined);

  // Plan name and price are decoration on the report; a failure here must not
  // cost the operator the gauges.
  const planInfo = record(
    (await post({ fetchImpl, timeoutMs }, "GetPlanInfo", token))?.["planInfo"],
  );

  return {
    windows,
    spend: dollars(spent),
    report: writeReport({
      planName: typeof planInfo?.["planName"] === "string" ? planInfo["planName"] : undefined,
      planPrice: typeof planInfo?.["price"] === "string" ? planInfo["price"] : undefined,
      message:
        typeof usage["displayMessage"] === "string" ? usage["displayMessage"] : undefined,
      spent,
      limit,
      resets,
      windows,
    }),
  };
}

/**
 * The operator-facing write-up. The widget draws the gauges; this is what the
 * report pane shows, and it says where the figures came from so a stale or
 * surprising number can be chased to its source.
 */
function writeReport(input: {
  planName?: string;
  planPrice?: string;
  message?: string;
  spent: number;
  limit: number;
  resets?: string;
  windows: AdapterUsageWindow[];
}): string {
  const plan = [input.planName, input.planPrice].filter((part) => part !== undefined).join(" ");
  const lines = ["## Usage", ""];
  const header = [
    plan !== "" ? `**Plan:** ${plan}` : undefined,
    input.resets !== undefined ? `**Cycle ends:** ${input.resets}` : undefined,
  ].filter((part) => part !== undefined);
  if (header.length > 0) lines.push(header.join(" · "), "");

  lines.push("| Pool | Used |", "|------|------|");
  for (const window of input.windows) {
    const used = `${(window.used * 100).toFixed(1)}%`;
    const detail =
      window.id === "included"
        ? ` (${dollars(input.spent)} of ${dollars(input.limit)})`
        : "";
    lines.push(`| ${window.label} | ${used}${detail} |`);
  }
  if (input.message !== undefined && input.message.trim() !== "") {
    lines.push("", input.message.trim());
  }
  lines.push("", "_Read from Cursor's dashboard API._");
  return lines.join("\n");
}
