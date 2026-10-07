import type { AdapterUsageWindow } from "@overseer/protocol";

interface Window {
  usedPercent?: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}
interface Bucket {
  limitId?: string | null;
  limitName?: string | null;
  primary?: Window | null;
  secondary?: Window | null;
}
export interface RateLimits {
  rateLimits?: Bucket | null;
  rateLimitsByLimitId?: Record<string, Bucket> | null;
}

function duration(minutes: number): string {
  if (minutes % 10080 === 0)
    return minutes === 10080 ? "week" : `${minutes / 10080} weeks`;
  if (minutes % 1440 === 0)
    return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0)
    return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Only supplied windows become gauges. Never derive plan use from tokens. */
export function parseUsage(result: RateLimits): AdapterUsageWindow[] {
  const buckets =
    result.rateLimitsByLimitId &&
    Object.keys(result.rateLimitsByLimitId).length > 0
      ? Object.entries(result.rateLimitsByLimitId)
      : result.rateLimits
        ? [[result.rateLimits.limitId ?? "codex", result.rateLimits] as const]
        : [];
  const windows: AdapterUsageWindow[] = [];
  for (const [id, bucket] of buckets) {
    for (const key of ["primary", "secondary"] as const) {
      const window = bucket[key];
      if (
        !window ||
        typeof window.usedPercent !== "number" ||
        !Number.isFinite(window.usedPercent)
      )
        continue;
      const mins = window.windowDurationMins;
      const label =
        typeof mins === "number" && Number.isFinite(mins) && mins > 0
          ? duration(mins)
          : key;
      const prefix =
        buckets.length > 1
          ? `${(bucket.limitName || id).toLowerCase()} · `
          : "";
      const reset =
        typeof window.resetsAt === "number"
          ? new Date(window.resetsAt * 1000)
          : undefined;
      windows.push({
        id: `${id}:${key}`,
        label: prefix + label,
        used: Math.max(0, Math.min(1, window.usedPercent / 100)),
        ...(reset && Number.isFinite(reset.getTime())
          ? {
              resets: reset
                .toISOString()
                .replace("T", " ")
                .replace(".000Z", " UTC"),
            }
          : {}),
      });
    }
  }
  return windows;
}
