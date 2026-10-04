import type { AdapterUsageWindow } from "@overseer/protocol";
import type { Activity } from "./status";

/**
 * The shapes the UI renders. Types only — no data. Everything that renders
 * live server state imports from here so the overseer path stays provably
 * free of canned data.
 */

export interface Project {
  id: string;
  name: string;
  path: string;
  /** Undefined when git could not be read — never collapsed to a guess. */
  branch?: string;
  dirty?: boolean;
  activity: Activity;
  /** Why the light is lit — shown next to the project in the selector. */
  note?: string;
}

export interface Session {
  id: string;
  /** Lit by the console running this session; idle when none is. */
  activity: Activity;
  name: string;
  /** The project directory the session belongs to. */
  projectId: string;
  providerId: string;
  branch: string;
  lastActiveAt: string;
  /** The console running this session right now, if any. */
  consoleId?: string;
  /** Set when this is a dev-loop run. Such a session lives in its loop
   * console and is never resumed in a second CLI. */
  origin?: "loop";
  /** Workspace the loop run belongs to. Only set with `origin: "loop"`. */
  loopWorkspace?: string;
  /** The session's person name (spec/behaviour/relay.md). */
  callsign?: string;
}

/** What the provider widget reads out. Empty strings mean "not been told yet",
 * never a stand-in value. */
export interface ProviderInfo {
  name: string;
  version: string;
  authenticated: boolean;
  /** False when the provider runtime could not be reached. */
  reachable?: boolean;
  /** Operator-facing status clause from the adapter, when it gave one. */
  detail?: string;
  /** True when this instance was signed in on an earlier run and now is not —
   * an expired or revoked credential, not a login never started. */
  authExpired?: boolean;
  /** Subscription windows. Empty means "not been told yet", never a stand-in. */
  usage: AdapterUsageWindow[];
  /** How the usage read went when signed in. */
  usageState?: "pending" | "ready" | "unavailable";
  /** Mirrors `AdapterCapabilities.usageCheck`: this provider has no automatic
   * gauges, but can be asked for a report on demand. Drives the widget's
   * CHECK USAGE button, and suppresses the "not available" line that would
   * otherwise describe the missing automatic path. */
  usageCheck: boolean;
  spend: string;
  context: string;
}
