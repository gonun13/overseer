import type { PromptOption, PromptSettings } from "../prompt";
import type {
  AdapterInfo,
  Approval,
  Capability,
  CapabilityDraft,
  ConsoleLine,
  DiffLine,
  Project,
  Session,
  Turn,
  WorkspaceInfo,
} from "../domain";

/** Static placeholder data — design development only. Replaced by live state
 * once the server's session supervisor and WS event stream exist.
 *
 * Everything an instance would learn at runtime belongs here, not just the
 * obviously fake rows: the model and subagent lists, the prompt's starting
 * settings, the workspace paths and the adapter's own name are all facts about
 * a running instance, and a build that has never talked to an adapter knows
 * none of them. A plausible default is still invented data — it just lies more
 * convincingly — so the blank side of every pair below is genuinely empty.
 *
 * None of it ships. The fixtures load only when VITE_OVERSEER_WIREFRAME is
 * explicitly set, which docker-compose.dev.yml does and the production image
 * does not, so a real instance cannot serve invented projects, approvals and
 * spend figures as its own. Vite inlines the variable at build time, so the
 * selection block at the bottom of this file folds to a constant and the
 * fixtures are dropped from the bundle rather than shipped-but-unused.
 *
 * Deliberately not `import.meta.env.DEV`: that is derived from NODE_ENV, which
 * the Dockerfile's dev stage sets and its builder stage doesn't — far too
 * implicit for the switch that decides whether fake data reaches an operator.
 * Set VITE_OVERSEER_WIREFRAME=0 to preview the empty state while in dev. */
const WIREFRAME = import.meta.env.VITE_OVERSEER_WIREFRAME === "1";

const wireframeTranscript: Turn[] = [
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

const wireframeProjects: Project[] = [
  {
    id: "p1",
    name: "billing-service",
    path: "/workspace/billing-service",
    branch: "fix/refund-race",
    dirty: true,
    activity: "attention",
    note: "2 approvals",
  },
  {
    id: "p2",
    name: "overseer",
    path: "/workspace/overseer",
    branch: "main",
    dirty: false,
    activity: "working",
    note: "running",
  },
  {
    id: "p3",
    name: "docs-site",
    path: "/workspace/docs-site",
    branch: "main",
    dirty: false,
    activity: "done",
    note: "3 files changed",
  },
  {
    id: "p4",
    name: "infra",
    path: "/workspace/infra",
    branch: "main",
    dirty: false,
    activity: "idle",
  },
];

const wireframeSessions: Session[] = [
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

const wireframeApprovals: Approval[] = [
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

const wireframeCapabilities: Capability[] = [
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

const wireframeAdapter: AdapterInfo = {
  name: "claude-code",
  version: "2.1.4",
  authenticated: false,
  usage: [
    {
      id: "session",
      label: "session",
      used: 0.42,
      resets: "Aug 14, 11:30pm (UTC)",
    },
    {
      id: "week",
      label: "week",
      used: 0.78,
      resets: "Aug 21, 3am (UTC)",
    },
  ],
  spend: "$4.12",
  context: "128k",
};

const wireframeContextFiles = [
  { path: "docs/design-system.md", tokens: "4.1k" },
  { path: "packages/protocol/src/index.ts", tokens: "2.6k" },
];

const wireframeDiff: DiffLine[] = [
  { kind: "ctx", text: "export async function refund(req: RefundRequest) {" },
  { kind: "del", text: "  return processRefund(req);" },
  { kind: "add", text: "  await limiter.consume(req.accountId);" },
  { kind: "add", text: "  return processRefund(req);" },
  { kind: "ctx", text: "}" },
];

const wireframeConsole: ConsoleLine[] = [
  {
    kind: "out",
    text: "claude-code 2.1.4 · attached to /workspace/billing-service",
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

const wireframeCapabilityDraft: CapabilityDraft = {
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
  file: ".claude/skills/code-review/SKILL.md",
};

const blankCapabilityDraft: CapabilityDraft = {
  name: "",
  kind: "",
  description: "",
  instructions: "",
  model: "",
  tools: [],
  file: "",
};

/** What the prompt's control surface offers. Real instances read this from the
 * adapter (models, permission modes) and the project's `.claude/agents`, so a
 * build cannot know it — note that the fixture's mode names don't even match
 * `PermissionMode` in @overseer/protocol, which is what inventing them costs. */
const wireframePromptOptions: PromptOption[] = [
  { key: "model", label: "model", values: ["opus-5", "sonnet-5", "haiku-4.5"] },
  {
    key: "mode",
    label: "mode",
    values: ["ask", "auto-accept", "plan", "bypass"],
    danger: ["bypass"],
  },
  {
    key: "agent",
    label: "agent",
    values: ["default", "developer", "tech-lead", "project-manager"],
  },
];

const wireframePromptSettings: PromptSettings = {
  model: "opus-5",
  mode: "ask",
  agent: "default",
};

/** Nothing is armed for the next turn, because nothing has offered an option. */
const blankPromptSettings: PromptSettings = { model: "", mode: "", agent: "" };

/** Where the agent's files live. A deployment fact the server owns — the
 * container's mounts decide it, so the frontend must be told, not assume. */
const wireframeWorkspace: WorkspaceInfo = { root: "/workspace", staging: "/workspace/_overseer/import" };
const blankWorkspace: WorkspaceInfo = { root: "", staging: "" };

/** A real instance has no projects, no sessions and no adapter attached until
 * the session supervisor exists. Not even the adapter's name: the registry is
 * behind /api/adapters and the frontend has never asked. */
const blankAdapter: AdapterInfo = {
  name: "",
  version: "",
  authenticated: false,
  usage: [],
  spend: "",
  context: "",
};

export const mockTranscript = WIREFRAME ? wireframeTranscript : [];
export const mockProjects = WIREFRAME ? wireframeProjects : [];
export const mockSessions = WIREFRAME ? wireframeSessions : [];
export const mockApprovals = WIREFRAME ? wireframeApprovals : [];
export const mockCapabilities = WIREFRAME ? wireframeCapabilities : [];
export const mockContextFiles = WIREFRAME ? wireframeContextFiles : [];
export const mockDiff = WIREFRAME ? wireframeDiff : [];
export const mockConsole = WIREFRAME ? wireframeConsole : [];
export const mockAdapter = WIREFRAME ? wireframeAdapter : blankAdapter;
export const mockPromptOptions = WIREFRAME ? wireframePromptOptions : [];
export const mockPromptSettings = WIREFRAME
  ? wireframePromptSettings
  : blankPromptSettings;
export const mockWorkspace = WIREFRAME ? wireframeWorkspace : blankWorkspace;
export const mockCapabilityDraft = WIREFRAME
  ? wireframeCapabilityDraft
  : blankCapabilityDraft;
