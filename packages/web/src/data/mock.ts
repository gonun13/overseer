import type { Status } from "../components/primitives/StatusDot";

/** Static placeholder data — wireframe only. Replaced by live state once the
 * server's session supervisor and WS event stream exist. */

export const mockSessions = [
  {
    id: "s1",
    status: "live" as Status,
    name: "overseer / web wireframe",
    project: "overseer",
    branch: "main",
    model: "sonnet-5",
    elapsed: "04:12",
  },
  {
    id: "s2",
    status: "warn" as Status,
    name: "billing / refund flow",
    project: "billing-service",
    branch: "fix/refund-race",
    model: "opus-5",
    elapsed: "00:41",
  },
  {
    id: "s3",
    status: "idle" as Status,
    name: "docs / api reference",
    project: "docs-site",
    branch: "main",
    model: "sonnet-5",
    elapsed: "1:02:09",
  },
];

export const mockApprovals = [
  {
    id: "a1",
    severity: "warn" as Status,
    identifier: "TOOL-0417",
    sessionName: "billing / refund flow",
    tool: "Bash",
    summary: "rm -rf ./tmp/refund-cache",
  },
  {
    id: "a2",
    severity: "danger" as Status,
    identifier: "TOOL-0418",
    sessionName: "billing / refund flow",
    tool: "Edit",
    summary: "packages/billing/src/refund.ts",
  },
];

export const mockCapabilities = [
  { id: "c1", status: "live" as Status, name: "filesystem", kind: "MCP · stdio", tools: 8 },
  { id: "c2", status: "live" as Status, name: "postgres", kind: "MCP · stdio", tools: 5 },
  { id: "c3", status: "warn" as Status, name: "linear", kind: "MCP · http — pending approval", tools: 0 },
  { id: "c4", status: "idle" as Status, name: "code-review", kind: "Skill", tools: 0 },
  { id: "c5", status: "idle" as Status, name: "tech-lead", kind: "Subagent", tools: 0 },
];

export const mockTodos = [
  { content: "Scaffold Docker + tooling", status: "completed" as const },
  { content: "Build console wireframe", status: "in_progress" as const },
  { content: "Wire session supervisor to the claude-code adapter", status: "pending" as const },
];
