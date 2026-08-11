import type { Activity } from "../status";

/** Static placeholder data — wireframe only. Replaced by live state once the
 * server's session supervisor and WS event stream exist. */

export type Turn =
  | { id: string; kind: "user" | "agent"; text: string }
  | { id: string; kind: "tool"; tool: string; target: string };

export const mockTranscript: Turn[] = [
  { id: "t1", kind: "user", text: "Add rate limiting to the refund endpoint." },
  {
    id: "t2",
    kind: "agent",
    text: "I'll add a token-bucket limiter in the refund handler and wire it through the existing middleware chain.",
  },
  {
    id: "t3",
    kind: "tool",
    tool: "edit",
    target: "packages/billing/src/refund.ts",
  },
  { id: "t4", kind: "tool", tool: "bash", target: "npm test -- refund" },
  {
    id: "t5",
    kind: "agent",
    text: "Tests pass. Limiter caps refunds at 5/min per account.",
  },
];

export interface Project {
  id: string;
  name: string;
  path: string;
  branch: string;
  dirty: boolean;
  activity: Activity;
  /** Why the light is lit — shown next to the project in the selector. */
  note?: string;
}

export const mockProjects: Project[] = [
  {
    id: "p1",
    name: "billing-service",
    path: "/work/billing-service",
    branch: "fix/refund-race",
    dirty: true,
    activity: "attention",
    note: "2 approvals",
  },
  {
    id: "p2",
    name: "overseer",
    path: "/work/overseer",
    branch: "main",
    dirty: false,
    activity: "working",
    note: "running",
  },
  {
    id: "p3",
    name: "docs-site",
    path: "/work/docs-site",
    branch: "main",
    dirty: false,
    activity: "done",
    note: "3 files changed",
  },
  {
    id: "p4",
    name: "infra",
    path: "/work/infra",
    branch: "main",
    dirty: false,
    activity: "idle",
  },
];

export interface Session {
  id: string;
  activity: Activity;
  name: string;
  projectId: string;
  branch: string;
  model: string;
  cost: string;
  /** One line on what it is doing right now, for the overseer space. */
  doing: string;
}

export const mockSessions: Session[] = [
  {
    id: "s1",
    activity: "attention",
    name: "billing / refund flow",
    projectId: "p1",
    branch: "fix/refund-race",
    model: "opus-5",
    cost: "$1.24",
    doing: "blocked on two tool approvals",
  },
  {
    id: "s2",
    activity: "working",
    name: "overseer / web shell",
    projectId: "p2",
    branch: "main",
    model: "sonnet-5",
    cost: "$0.41",
    doing: "editing packages/web/src/App.tsx",
  },
  {
    id: "s3",
    activity: "done",
    name: "docs / api reference",
    projectId: "p3",
    branch: "main",
    model: "sonnet-5",
    cost: "$2.47",
    doing: "finished 4m ago, 3 files changed",
  },
];

export interface Approval {
  id: string;
  activity: Activity;
  ref: string;
  sessionId: string;
  session: string;
  tool: string;
  body: string;
}

export const mockApprovals: Approval[] = [
  {
    id: "a1",
    activity: "waiting",
    ref: "0417",
    sessionId: "s1",
    session: "billing / refund flow",
    tool: "bash",
    body: "rm -rf ./tmp/refund-cache",
  },
  {
    id: "a2",
    activity: "attention",
    ref: "0418",
    sessionId: "s1",
    session: "billing / refund flow",
    tool: "edit",
    body: "packages/billing/src/refund.ts",
  },
];

export interface Capability {
  id: string;
  activity: Activity;
  name: string;
  kind: string;
  tools: number;
  /** Set when the capability needs the operator before it can be used. */
  problem?: string;
}

export const mockCapabilities: Capability[] = [
  {
    id: "c1",
    activity: "done",
    name: "filesystem",
    kind: "mcp · stdio",
    tools: 8,
  },
  {
    id: "c2",
    activity: "done",
    name: "postgres",
    kind: "mcp · stdio",
    tools: 5,
  },
  {
    id: "c3",
    activity: "waiting",
    name: "linear",
    kind: "mcp · http",
    tools: 0,
    problem: "missing API token",
  },
  { id: "c4", activity: "idle", name: "code-review", kind: "skill", tools: 0 },
  { id: "c5", activity: "idle", name: "tech-lead", kind: "subagent", tools: 0 },
];

export const mockAdapter = {
  name: "claude-code",
  version: "2.1.4",
  authenticated: false,
  /** Fraction of the plan's window consumed. */
  usage: 0.78,
  spend: "$4.12",
  context: "128k",
};

export const mockContextFiles = [
  { path: "docs/design-system.md", tokens: "4.1k" },
  { path: "packages/protocol/src/index.ts", tokens: "2.6k" },
];

export type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

export const mockDiff: DiffLine[] = [
  { kind: "ctx", text: "export async function refund(req: RefundRequest) {" },
  { kind: "del", text: "  return processRefund(req);" },
  { kind: "add", text: "  await limiter.consume(req.accountId);" },
  { kind: "add", text: "  return processRefund(req);" },
  { kind: "ctx", text: "}" },
];

/** A console line. `in` is what the operator sent to the CLI, `out` is what it
 * printed back, `err` is stderr — the three states a terminal has. */
export type ConsoleLine = { kind: "in" | "out" | "err"; text: string };

export const mockConsole: ConsoleLine[] = [
  {
    kind: "out",
    text: "claude-code 2.1.4 — attached to /work/billing-service",
  },
  { kind: "out", text: "session s1 · fix/refund-race · opus-5" },
  { kind: "out", text: "" },
  { kind: "in", text: "/status" },
  { kind: "out", text: "model      opus-5" },
  { kind: "out", text: "mode       ask" },
  { kind: "out", text: "context    128k · 31% used" },
  { kind: "out", text: "mcp        filesystem, postgres (2 ok, 1 failed)" },
  { kind: "out", text: "" },
  { kind: "in", text: "/mcp reconnect linear" },
  { kind: "err", text: "linear: missing API token (LINEAR_API_KEY unset)" },
  { kind: "out", text: "" },
];

export interface CapabilityDraft {
  name: string;
  kind: string;
  description: string;
  /** Free text for a skill or subagent; the thing actually being edited. */
  instructions: string;
  model: string;
  tools: { name: string; enabled: boolean }[];
}

export const mockCapabilityDraft: CapabilityDraft = {
  name: "code-review",
  kind: "skill",
  description: "Review the working tree for correctness bugs before a push.",
  instructions:
    "Read the diff against the merge base. Flag correctness bugs and\nreuse opportunities. Do not comment on formatting — the linter owns\nthat. Report findings most-severe first.",
  model: "inherit",
  tools: [
    { name: "read", enabled: true },
    { name: "grep", enabled: true },
    { name: "bash", enabled: true },
    { name: "edit", enabled: false },
    { name: "write", enabled: false },
  ],
};
