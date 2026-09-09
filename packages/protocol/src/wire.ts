import type {
  AdapterStatus,
  AdapterUsageWindow,
  LoginPhase,
  PermissionDecision,
  PermissionMode,
  ProviderOption,
  ProviderOptions,
  SessionMeta,
} from "./adapter.js";
import type { AgentEvent } from "./events.js";
import type { PlanMeta, PlanStatusOverride } from "./plan.js";
import type { Subagent, SubagentScope } from "./subagent.js";
import type { TurnWire } from "./transcript.js";
import type {
  AppliedPersonality,
  DiscoveredProject,
  DiscoveryEvent,
  DiscoveryOutcome,
  RejectedCustomization,
  UntrackedFolder,
} from "./discovery.js";

/**
 * The `/ws` envelope. Discovery is the first traffic to go over this socket,
 * but it will not be the last — the session supervisor (webui design doc §1.2)
 * routes over the same connection. So the envelope is a plain `type`-tagged
 * union with no discovery-specific framing: new families join by adding
 * variants, not by wrapping.
 */

export type PersonalityTone = NonNullable<AppliedPersonality["tone"]>;

/** UI theme — samaritan is the default; machine inverts it. Persisted in
 * internal memory the same way the active project is. */
export type OverseerTheme = "samaritan" | "machine";

export type ClientMessage =
  /** Ask the server to run a discovery pass. Explicit rather than
   * connect-time-automatic: a reconnect must not silently re-run a scan the
   * operator did not ask for, and the client needs the operations window
   * mounted before steps start arriving. */
  | { type: "discovery.run" }
  /** First-run welcome: the operator's name, stored in overseer-personality.
   * The wizard asks before discovery so the greeting can use it. */
  | { type: "operator.name"; name: string }
  /** First-run: tone chosen after the name ask — "I AM THE OVERSEER" is the
   * headline behind the picker. */
  | { type: "operator.tone"; tone: PersonalityTone }
  /** Persist the operator's active project into internal memory. */
  | { type: "project.select"; path: string }
  /** Persist the operator's theme into internal memory. */
  | { type: "theme.select"; theme: OverseerTheme }
  /** Attach a provider from the picker. Auth is a separate later step. */
  | { type: "provider.connect"; id: string }
  /** Ask what the attached provider offers a session in the active project —
   * models, permission modes, subagents. Explicit rather than pushed at
   * connect time: the answer costs a subprocess, and only a client with the
   * controls on screen needs it. */
  | { type: "provider.options" }
  /**
   * Ask the attached provider for an on-demand usage report (`AgentAdapter
   * .checkUsage`) — the operator's own request, never sent automatically.
   * Unlike `provider.options`, some adapters answer this with a real,
   * possibly slow, possibly costly CLI turn (cursor's `/usage` is an ordinary
   * prompt the model answers, not a free deterministic command), so it is
   * gated behind an explicit ask rather than run on any timer.
   */
  | { type: "provider.checkUsage" }
  /** Start the provider's login. Single-flight on the server: a second asker
   * joins the flow already running rather than spawning a second one, because
   * each spawn mints its own PKCE challenge and the operator would be holding
   * a code that only the other process can redeem. */
  | { type: "auth.start"; providerId: string }
  /** The operator's paste, `<code>#<state>`. Relayed to the CLI's stdin
   * verbatim — the server does not parse, split or decode it. */
  | { type: "auth.code"; code: string }
  /** Abandon the login in flight. Nothing to say if there isn't one. */
  | { type: "auth.cancel" }
  /** `claude auth logout`. Idempotent. */
  | { type: "auth.signout"; providerId: string }
  /** Erase the overseer's memory — internal `.overseer` and the external
   * `personality.json`. Provider auth is not memory and is left alone. Only
   * sent after the operator answered the decision (ui-ux-design.md §5.2). */
  | { type: "memory.reset" }
  /**
   * Open a raw PTY into the attached provider's interactive CLI, in the active
   * project. One console per socket; a second open replaces the first.
   * `cols`/`rows` are the initial terminal size. `mode: "loop"` opens the dev
   * loop's overseer session (`loop/run`) instead of the bare provider CLI.
   */
  | {
      type: "console.open";
      cols: number;
      rows: number;
      mode?: "loop";
      /**
       * End the loop run currently holding this workspace's lease before
       * starting a new one. Only meaningful with `mode: "loop"`, and only sent
       * after the operator answered a decision — it destroys a conversation
       * that may be mid-request, possibly one attached to another terminal.
       */
      takeover?: boolean;
    }
  /** Keystrokes / paste from the browser terminal, opaque to Overseer. */
  | { type: "console.input"; id: string; data: string }
  /** Browser terminal resized — forwarded to the PTY. */
  | { type: "console.resize"; id: string; cols: number; rows: number }
  /** Operator dismissed the console window (or the tab is leaving). */
  | { type: "console.close"; id: string }
  /** List sessions for the active project. */
  | { type: "session.list" }
  /** Start a new stream-json session in the active project. */
  | {
      type: "session.create";
      model?: string;
      permissionMode?: PermissionMode;
      /** Subagent to run turns as. Empty string means none — the operator
       * chose the "none" row, which is not the same as never having chosen. */
      agent?: string;
      name?: string;
    }
  /** Subscribe to a session, backfill history, resume if dormant. */
  | { type: "session.open"; sessionId: string }
  /** Send a user turn to a live session. */
  | { type: "session.send"; sessionId: string; text: string }
  /** Retarget an already-running session's next turn — a control request on
   * the live process, not a respawn. Resumes a dormant session first, the
   * same as `session.send`. */
  | { type: "session.model"; sessionId: string; model: string }
  /** Retarget an already-running session's next turn's permission mode — a
   * control request on the live process, not a respawn. Resumes a dormant
   * session first, the same as `session.model`. */
  | { type: "session.mode"; sessionId: string; mode: PermissionMode }
  /** Answer a pending `can_use_tool` request on a live session — inline,
   * inside the session that raised it. */
  | {
      type: "approval.resolve";
      sessionId: string;
      requestId: string;
      decision: PermissionDecision;
    }
  /** Interrupt the in-flight turn. */
  | { type: "session.interrupt"; sessionId: string }
  /** Close a live session process. */
  | { type: "session.close"; sessionId: string }
  /** Stop the process if running and permanently delete the session's transcript. */
  | { type: "session.delete"; sessionId: string }
  /** List the plans the active project's transcripts show. */
  | { type: "plan.list" }
  /** Retire a plan by hand, or hand it back to what the transcript says
   * (`"open"`). The three derived statuses are not settable — they are a
   * reading of the transcript, not an opinion about it. */
  | { type: "plan.status"; planId: string; status: PlanStatusOverride }
  /**
   * Continue a plan in the session that built it: leave `plan` mode and send
   * the implement turn there, so the work lands in the transcript that holds
   * the plan. A plan whose session is gone starts a new one, seeded with the
   * plan itself.
   */
  | { type: "plan.implement"; planId: string }
  /**
   * Read the loop's own provider/model configuration — separate from the
   * app's single attached provider (`provider.connect`); the loop picks its
   * own (`loop/.provider`) and is configured independently. Explicit rather
   * than pushed at connect time: it shells out to `loop/bin/models`, and
   * only a client with the loop tab of the providers window open needs it.
   */
  /**
   * List the operator's own subagent files for the active project — both
   * scopes. Explicit rather than pushed at connect time, like
   * `provider.options`: only a client with the capabilities window open needs
   * it. Unlike that one it costs no subprocess, just two directory reads.
   */
  | { type: "subagent.list" }
  /**
   * Create or replace one subagent file.
   *
   * `previousName`/`previousScope` name the file being edited: the name *is*
   * the filename, so a rename or a scope move has to remove the old file, and
   * only the request knows which one that was. Both absent means create.
   *
   * `model` and `tools` empty mean inherit the session's — not an empty model
   * and not an empty allowlist.
   */
  | {
      type: "subagent.write";
      name: string;
      description: string;
      prompt: string;
      model: string;
      tools: string;
      scope: SubagentScope;
      previousName?: string;
      previousScope?: SubagentScope;
    }
  /**
   * Remove one subagent file.
   *
   * Deliberately accepts a `name` the write path would refuse: a hand-written
   * file whose frontmatter name is not kebab-case is exactly the one an
   * operator most wants to delete. The server resolves it through the
   * adapter's own listing rather than composing a path from it.
   */
  | { type: "subagent.delete"; name: string; scope: SubagentScope }
  | { type: "loop.config.read" }
  /** Select which provider the loop runs on next (`loop/bin/provider`). */
  | { type: "loop.provider.set"; id: string }
  /**
   * Set one model slot for one loop-runnable provider (`loop/bin/models
   * set`). `slot` is a step name or the literal `"overseer"`; the server
   * validates it against the live step list, not this frame — the loop's
   * `db.sh` is the source of truth for what a step is. `model` empty clears
   * the slot back to inherit.
   */
  | { type: "loop.model.set"; providerId: string; slot: string; model: string }
  /**
   * The models one loop-runnable provider actually offers — `loop/bin/models
   * list-models <providerId>`, which asks that provider's own CLI directly
   * (each bundle's `provider_list_models`). Deliberately independent of the
   * app's single attached provider: the loop's own provider is configured
   * separately, so the model list for it must not be limited to whichever
   * one the app happens to be attached to.
   */
  | { type: "loop.models.read"; providerId: string }
  /** Create a new project: `mkdir` under the workspace root, `git init`, and
   * write a README from `name`/`description`. `folder` is what the operator
   * confirmed in the create-project form — usually a slugified `name`, but
   * theirs to edit first. */
  | {
      type: "project.create";
      name: string;
      folder: string;
      description: string;
    }
  /** Read branch, ahead/behind, remote presence, and changed files for one
   * project — opens the project management window. `path` rather than the
   * active project only, so the window works from any row in the panel. */
  | { type: "project.git.status"; path: string }
  /** `git add -A` then commit in `path`, with `message`. */
  | { type: "project.git.commit"; path: string; message: string }
  /** `git push -u origin <branch>` in `path`. Only offered by the client when
   * the last status read reported a remote. */
  | { type: "project.git.push"; path: string }
  /** Merge the current branch into `path`'s default branch, locally —
   * offered only when `path` has no remote (a remote implies a PR process
   * upstream instead). The default branch is whatever the server's
   * `project.git.status` reply named — `main`, `master`, or otherwise. */
  | { type: "project.git.merge"; path: string }
  /** Discard every uncommitted change in `path` — `git reset --hard` plus a
   * clean of untracked files. */
  | { type: "project.git.revert"; path: string }
  /** Read one file out of `path`'s worktree — either its unified diff against
   * the last commit (which is what a commit made from here would record, since
   * `project.git.commit` stages everything first) or its current contents.
   *
   * `file` is repo-relative: never absolute, never containing `..`. The
   * project directory is checked for workspace containment the same way every
   * other frame in this family is, and the file is checked against the project
   * directory in turn — this field is the second half of that question, so it
   * is validated rather than trusted. `previousPath` is the pre-rename name,
   * present only for a renamed file. */
  | {
      type: "project.git.show";
      path: string;
      file: string;
      mode: "diff" | "content";
      previousPath?: string;
    }
  /** Read the container's git access: whether an ssh key exists, the public
   * half of it, and the identity commits are made under. Never carries the
   * private key — nothing in the protocol can ask for it. */
  | { type: "git.access.read" }
  /** Generate the container's ssh keypair. Refused when one already exists:
   * replacing a working key is `git.ssh.remove` first, so it cannot happen by
   * a stray double-click. */
  | { type: "git.ssh.generate" }
  /** Authenticate against one host to prove the key was added there. `host` is
   * offered by the client from the remotes the workspace actually uses, not
   * typed freehand; `port` is present for a remote that names one. */
  | { type: "git.ssh.test"; host: string; port?: number }
  /** Delete the keypair. `known_hosts` is deliberately left alone. */
  | { type: "git.ssh.remove" }
  /** The name and email commits the app makes are authored under. */
  | { type: "git.identity.set"; name: string; email: string };

export interface ConnectedMessage {
  type: "connected";
  /** Server's clock at connect. The client renders time; the server owns it. */
  serverTime: string;
  /** True when this instance has a prior world snapshot — drives "welcome back". */
  returning: boolean;
  /** Accepted personality fields known before discovery (name/greeting for the
   * welcome beat). Absent fields mean unset, not "not yet asked". */
  personality?: AppliedPersonality;
  /** Theme remembered in internal memory. Absent means the samaritan default. */
  theme?: OverseerTheme;
}

export interface ErrorMessage {
  type: "error";
  /** Echoes the client message `type` that failed, when there was one. */
  about?: string;
  /**
   * True when the request was refused but nothing is broken — a duplicate
   * `discovery.run` while a pass is already in flight, a name that failed
   * validation. The client must not tear the wizard down for these. Without
   * the distinction "your other tab asked first" and "the discovery pass
   * threw" arrive as the same frame, and treating either one as the other is
   * wrong in a different direction.
   */
  benign?: boolean;
  message: string;
}

/** Ack that the operator's name was written to external memory. */
export interface OperatorNamedMessage {
  type: "operator.named";
  name: string;
}

/** Ack that the operator's tone was written to external memory. */
export interface OperatorTonedMessage {
  type: "operator.toned";
  tone: PersonalityTone;
}

/** Ack that the active project was recorded in internal memory. */
export interface ProjectSelectedMessage {
  type: "project.selected";
  path: string;
}

/** Ack that `/workspace/<folder>` was created, `git init`'d, and README-ed.
 * The actual project list update follows separately, via the ordinary
 * `workspace.projects` broadcast the workspace monitor already sends once it
 * notices the new directory — this frame exists only for immediate feedback
 * to the create-project form. */
export interface ProjectCreatedMessage {
  type: "project.created";
  path: string;
  name: string;
}

/** One changed path from `git status --porcelain`, reduced to the one status
 * word the project window shows next to it. `previousPath` is the name a
 * renamed file used to have — carried because a diff of the new path alone
 * reads as a whole-file addition, and git only detects the rename when both
 * sides are named. Absent for every other status. */
export interface GitFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "unmerged";
  previousPath?: string;
}

/** Reply to `project.git.status`. `ahead`/`behind` are absent when the branch
 * has no upstream to compare against — never collapsed to `0`, the same rule
 * `DiscoveredProject.dirty` already follows. A branch that *does* track an
 * upstream and matches it reports `0`/`0`: "in sync" and "nothing to compare"
 * are different states, and the push button reads them differently. `defaultBranch` is this
 * project's trunk — `main` in the common case, but `master` or whatever a
 * clone's `origin/HEAD` names for one that predates that convention — and is
 * what `project.git.merge` targets, and what the merge button labels itself
 * after. */
export interface ProjectGitStatusMessage {
  type: "project.git.status";
  path: string;
  branch: string;
  dirty: boolean;
  hasRemote: boolean;
  remoteUrl?: string;
  ahead?: number;
  behind?: number;
  defaultBranch: string;
  files: GitFileChange[];
}

/** Reply to `project.git.show`.
 *
 * `mode` is echoed rather than assumed: the operator can flip the view faster
 * than the reads come back, so the window matches a reply to what it is
 * currently showing instead of trusting arrival order. `truncated` means the
 * caps in this file clipped the text — not that the file ends there. */
export interface ProjectGitShowMessage {
  type: "project.git.show";
  path: string;
  file: string;
  mode: "diff" | "content";
  text: string;
  truncated: boolean;
}

/** Ack that `path` was committed. The file list itself follows via a fresh
 * `project.git.status` the client re-asks for, not inline here. */
export interface ProjectGitCommittedMessage {
  type: "project.git.committed";
  path: string;
}

/** Ack that `path`'s current branch was pushed. */
export interface ProjectGitPushedMessage {
  type: "project.git.pushed";
  path: string;
}

/** Ack that `path`'s feature branch (`branch`) was merged into its default
 * branch (`into`), locally. */
export interface ProjectGitMergedMessage {
  type: "project.git.merged";
  path: string;
  branch: string;
  into: string;
}

/** Ack that every uncommitted change in `path` was discarded. */
export interface ProjectGitRevertedMessage {
  type: "project.git.reverted";
  path: string;
}

/** One ssh host a workspace remote points at, for the client to offer as a
 * test target. `port` only when the remote names a non-default one. */
export interface GitRemoteHost {
  host: string;
  port?: number;
}

/**
 * The container's git access, as one frame — the settings panel's whole `git
 * access` section reads from this.
 *
 * `key` is absent when none has been generated. Only ever the *public* half:
 * the private key is never read into a response, and there is no message that
 * could ask for it.
 *
 * `permissionsOk` is false when the key exists but ssh will refuse it — the
 * mode is wrong, or the volume's files are owned by a uid the container no
 * longer runs as (which happens when the host's uid changes between builds).
 * The panel must offer to regenerate rather than render this as healthy.
 */
export interface GitAccessStateMessage {
  type: "git.access.state";
  key?: {
    publicKey: string;
    fingerprint: string;
    createdAt: string;
  };
  permissionsOk: boolean;
  identity?: { name: string; email: string };
  /** Hosts the workspace's own remotes use — the test targets on offer. */
  hosts: GitRemoteHost[];
}

/** The result of one `git.ssh.test`. Transient feedback for the tab that
 * asked, never broadcast. `account` is who the host said you are, when it
 * greeted by name. */
export interface GitSshTestResultMessage {
  type: "git.ssh.test.result";
  host: string;
  ok: boolean;
  account?: string;
  hostFingerprint?: string;
  message: string;
}

/** Ack that the theme was recorded in internal memory. */
export interface ThemeSelectedMessage {
  type: "theme.selected";
  theme: OverseerTheme;
}

/** Ack that a provider was attached (not necessarily authenticated). */
export interface ProviderConnectedMessage {
  type: "provider.connected";
  id: string;
}

/**
 * Fresh provider status after a background usage refresh (or any later
 * re-check that is not a login). Discovery and `auth.state` still carry status
 * inline; this frame is for updates that arrive after furniture is up.
 */
export interface ProviderStatusMessage {
  type: "provider.status";
  id: string;
  status: AdapterStatus;
}

/**
 * Reply to `provider.checkUsage` (see `AdapterUsageCheck`): `windows` are the
 * gauges the widget draws, `report` the prose they were read out of — kept so
 * an unreadable report still has something to show, and so the numbers on the
 * instrument always have a receipt behind them.
 *
 * Broadcast, same reasoning as `ProviderOptionsMessage`: the ask can be slow
 * and costly, so a second tab must not trigger a second one just to see the
 * answer that is already on its way.
 */
export interface ProviderUsageCheckMessage {
  type: "provider.usageCheck";
  id: string;
  report: string;
  windows: AdapterUsageWindow[];
  spend?: string;
}

/**
 * What the attached provider offers a session, for one project.
 *
 * Broadcast rather than sent to the asking socket: the answer is a fact about
 * the instance, not about who asked, and a second tab must not have to spawn
 * the CLI again to learn it.
 *
 * `projectDir` is on the frame because the lists are project-scoped — a client
 * that has already moved on to another project can tell this reply is stale
 * instead of rendering another project's subagents.
 */
export interface ProviderOptionsMessage {
  type: "provider.options";
  providerId: string;
  projectDir: string;
  options: ProviderOptions;
}

/**
 * Every subagent file the operator has, for one project.
 *
 * Broadcast rather than sent to the asker, and re-broadcast after every
 * successful write or delete — the same reasoning as `ProviderOptionsMessage`:
 * this is a fact about the instance, and a second tab must not have to re-ask
 * to see an edit made in the first.
 *
 * `projectDir` is on the frame because project-scoped agents are, so a client
 * that has moved on can tell this reply is stale.
 */
export interface SubagentListMessage {
  type: "subagent.list";
  providerId: string;
  projectDir: string;
  subagents: Subagent[];
}

/**
 * One write landed, as it reads back off disk — which is not always what was
 * asked for, since the name in the frontmatter decides the filename.
 *
 * Sent to the socket that asked rather than broadcast, so its form can close:
 * the `subagent.list` that follows is what updates every other tab. Same shape
 * and reasoning as `ProjectCreatedMessage`.
 */
export interface SubagentWrittenMessage {
  type: "subagent.written";
  subagent: Subagent;
}

/** One subagent file is gone. Sent to the asker, for the same reason. */
export interface SubagentDeletedMessage {
  type: "subagent.deleted";
  name: string;
  scope: SubagentScope;
}

/**
 * The whole state of the login flow in one frame.
 *
 * One state frame rather than a stream of deltas: a tab that connects (or asks)
 * mid-flow has to be handed the whole picture in a single message, which is
 * what joining an in-flight login instead of refusing it requires.
 *
 * Always broadcast, never sent to one socket — a login finished in one tab has
 * to land in all of them.
 */
export interface AuthStateMessage {
  type: "auth.state";
  providerId: string;
  phase: "idle" | LoginPhase;
  /**
   * Present from `awaiting-code` on. The operator clicks it in *their* browser,
   * on their own machine; the container never opens anything and there is no
   * callback for a browser to reach.
   *
   * Carries a PKCE challenge — a secret. It goes to the operator's screen and
   * nowhere else: not the run logs, not the action register, not the
   * operations window.
   */
  verificationUrl?: string;
  /** Operator-facing reason when `phase === "failed"`, in the CLI's own words. */
  detail?: string;
  /** True when the CLI is still at the prompt and another code may be pasted. */
  retryable?: boolean;
  /** Refreshed status once the flow settles — same shape discovery reports, so
   * `DiscoveredProvider.status` and this frame never diverge. */
  status?: AdapterStatus;
}

/** Live workspace project list from the monitor worker — create/delete under
 * `/workspace`, not a full discovery pass. */
export interface WorkspaceProjectsMessage {
  type: "workspace.projects";
  projects: DiscoveredProject[];
  /** Direct children of `/workspace` that are not git projects. */
  untrackedFolders: UntrackedFolder[];
  /** Present when the previous active project vanished and the server picked
   * a replacement (or cleared). Omitted when the active path is unchanged. */
  activeProjectPath?: string;
  /** Accepted personality after a change. Empty object means defaults / gone. */
  personality?: AppliedPersonality;
  /** Refusals from a live re-read of `personality.json`. */
  rejected?: RejectedCustomization[];
  /** True when personality was deleted while running. The client
   * must ask for a restart — the monitor does not recreate it live. */
  personalityMissing?: true;
}

/** One line for the operations window from a supervisor worker (not discovery).
 * Same telegraphic shape as discovery steps — the window does not care who
 * authored the line (docs/overseer.md §3). */
export interface OverseerStepMessage {
  type: "overseer.step";
  id: string;
  label: string;
  outcome: DiscoveryOutcome;
  detail?: string;
}

/** Every store named by `memory.reset` is gone. The steps of the wipe arrived
 * as ordinary `overseer.step` lines; this is only the end of them, and the
 * client's cue to reload into a first run. */
export interface MemoryResetDoneMessage {
  type: "memory.reset.done";
}

/** PTY is up — subsequent input/resize/close must carry this `id`. */
export interface ConsoleOpenedMessage {
  type: "console.opened";
  id: string;
  /** Echoes the open request's mode. The raw CLI and the dev loop hold a PTY
   * slot each, so a socket can have two console windows live at once; without
   * this each of them would adopt whichever ack landed last. */
  mode?: "loop";
}

/** Opaque PTY output chunk for the owning socket only. */
export interface ConsoleOutputMessage {
  type: "console.output";
  id: string;
  data: string;
}

/**
 * The CLI process ended. Native `/exit` and `/quit` land here; the client
 * closes the console window. `signal` is present when the process was killed.
 */
export interface ConsoleExitMessage {
  type: "console.exit";
  id: string;
  exitCode: number;
  signal?: number;
}

/** Sessions for the active project — broadcast to all tabs. */
export interface SessionListMessage {
  type: "session.list";
  sessions: SessionMeta[];
}

/** JSONL backfill before live streaming begins. */
export interface SessionHistoryMessage {
  type: "session.history";
  sessionId: string;
  turns: TurnWire[];
}

/** One normalized adapter event from a live session. */
export interface SessionEventMessage {
  type: "session.event";
  event: AgentEvent;
}

/** Session metadata changed (status, cost, name). */
export interface SessionMetaMessage {
  type: "session.meta";
  session: SessionMeta;
}

/** Plans for the active project — broadcast to all tabs, like the session
 * list, so a plan retired in one tab leaves the others' lists too. */
export interface PlanListMessage {
  type: "plan.list";
  plans: PlanMeta[];
}

/** A plan is being continued, in this session. The client opens (or raises)
 * that session's window: the server has already sent the turn, and the output
 * is about to arrive there. */
export interface PlanImplementingMessage {
  type: "plan.implementing";
  planId: string;
  sessionId: string;
}

/** One loop-runnable provider's model allocation, mirroring `loop/bin/models
 * --json`'s `providers.<id>` entry. */
export interface LoopProviderInfo {
  id: string;
  /** Mirrors `providers/<id>/manifest.json`'s `loopSubagents` field (absent
   * there reads as verified) — false means this provider runs every step
   * itself, regardless of any model configured below, until a model is
   * confirmed to actually delegate. See `loop/overseer.md`'s
   * `subagents_available` rule, which is what this field describes. */
  subagentsVerified: boolean;
  overseer: string | null;
  steps: Record<string, string | null>;
}

/** The loop's own provider/model configuration — broadcast, not sent to one
 * socket, so every tab with the loop tab open stays in sync after another
 * one changes it. Separate from `DiscoveredProvider`/`provider.status`:
 * the loop's provider selection and the app's attached provider are
 * independent (docs/architecture-design.md §9). */
export interface LoopConfigMessage {
  type: "loop.config";
  /** `loop/.provider` — the provider the loop runs on next. */
  current: string;
  /** Every provider the loop can run (manifest `loop: "bundle"`). */
  providers: LoopProviderInfo[];
  /** Step names in loop order — `loop/bin/lib/db.sh`'s `step_names`, read
   * once here rather than duplicated in this union. */
  steps: string[];
}

/**
 * The models one loop-runnable provider offers, from `loop/bin/models
 * list-models <providerId>` — that provider's own CLI, asked directly and
 * independent of the app's attached provider (unlike `ProviderOptionsMessage`,
 * which only ever answers for the one the app has attached and authenticated).
 * Broadcast, so a provider switched from another tab still lands here.
 */
export interface LoopModelsMessage {
  type: "loop.models";
  providerId: string;
  models: ProviderOption[];
  defaultModel?: string;
}

export type ServerMessage =
  | ConnectedMessage
  | ErrorMessage
  | OperatorNamedMessage
  | OperatorTonedMessage
  | ProjectSelectedMessage
  | ProjectCreatedMessage
  | ProjectGitStatusMessage
  | ProjectGitShowMessage
  | ProjectGitCommittedMessage
  | ProjectGitPushedMessage
  | ProjectGitMergedMessage
  | ProjectGitRevertedMessage
  | GitAccessStateMessage
  | GitSshTestResultMessage
  | ThemeSelectedMessage
  | ProviderConnectedMessage
  | ProviderStatusMessage
  | ProviderUsageCheckMessage
  | ProviderOptionsMessage
  | SubagentListMessage
  | SubagentWrittenMessage
  | SubagentDeletedMessage
  | AuthStateMessage
  | WorkspaceProjectsMessage
  | OverseerStepMessage
  | MemoryResetDoneMessage
  | ConsoleOpenedMessage
  | ConsoleOutputMessage
  | ConsoleExitMessage
  | SessionListMessage
  | SessionHistoryMessage
  | SessionEventMessage
  | SessionMetaMessage
  | PlanListMessage
  | PlanImplementingMessage
  | LoopConfigMessage
  | LoopModelsMessage
  | DiscoveryEvent;

/** Hard caps so a malformed frame cannot pin memory or a PTY. */
export const CONSOLE_MAX_COLS = 500;
export const CONSOLE_MAX_ROWS = 200;
export const CONSOLE_MAX_INPUT_CHARS = 64_000;
export const SESSION_MAX_ID_CHARS = 64;
export const SESSION_MAX_TEXT_CHARS = 64_000;
export const SESSION_MAX_NAME_CHARS = 256;
/** Matches `SESSION_MAX_AGENT_CHARS` — a menu value, not free text. */
export const SESSION_MAX_MODEL_CHARS = 128;

/** Mirrors `PermissionMode`. The CLI rejects anything else outright, and a
 * rejected spawn reads to the operator as a broken session rather than a bad
 * frame — so the socket refuses it here instead. */
const PERMISSION_MODES = new Set<string>([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "manual",
  "dontAsk",
  "plan",
  "ask",
]);

/** A subagent name, as the provider reported it. Empty means "none". */
export const SESSION_MAX_AGENT_CHARS = 128;

/** A plan id is a provider tool-use id, not something Overseer mints, so this
 * is a sanity bound rather than a format. */
export const PLAN_MAX_ID_CHARS = 128;

/** A permission request id is the provider's own `can_use_tool` request id —
 * a sanity bound, not a format, same reasoning as `PLAN_MAX_ID_CHARS`. */
export const APPROVAL_MAX_ID_CHARS = 128;
/** An "allow always" rule, e.g. `Bash(git *)` — short by construction. */
export const APPROVAL_MAX_RULE_CHARS = 256;
/** Optional free text on a deny. */
export const APPROVAL_MAX_FEEDBACK_CHARS = 2_000;
/** A question tool asks at most four questions in one call (claude's
 * `AskUserQuestion`); the bound is that, with room to spare. */
export const APPROVAL_MAX_ANSWERS = 8;
/** Answer keys are the question text verbatim, so they are a sentence. */
export const APPROVAL_MAX_QUESTION_CHARS = 1_000;
/** An answer is a picked option's label, or the operator's own words in place
 * of one — the same order of magnitude as a deny's feedback. */
export const APPROVAL_MAX_ANSWER_CHARS = 2_000;

/** Mirrors `PlanStatusOverride` — the derived statuses are deliberately absent:
 * a client asking for one is asking to overwrite a reading of the transcript. */
const PLAN_OVERRIDE_STATUSES = new Set<string>(["done", "archived", "open"]);

export const PROJECT_MAX_NAME_CHARS = 200;
export const PROJECT_MAX_FOLDER_CHARS = 100;
export const PROJECT_MAX_DESCRIPTION_CHARS = 4_000;
/** A path frame names a workspace directory, not a document — same order of
 * magnitude as `PROJECT_MAX_FOLDER_CHARS` plus room for the workspace root. */
export const GIT_MAX_PATH_CHARS = 4_096;
export const GIT_MAX_COMMIT_MESSAGE_CHARS = 4_000;
/** A diff or a file view is a document the operator reads in one window, not
 * an archive. Past this the frame costs more than the reading is worth, so the
 * text is clipped and the reply says it was. Both caps live here rather than
 * on the server so the window can name the same number it is held to. */
export const GIT_MAX_DIFF_CHARS = 200_000;
/** One DOM node per line: the line cap is the render cost, the char cap the
 * frame cost, and either can be the one that trips first. */
export const GIT_MAX_DIFF_LINES = 2_000;
/** A hostname's own limit, brackets of an IPv6 literal included. */
export const GIT_SSH_MAX_HOST_CHARS = 253;
export const GIT_MAX_IDENTITY_NAME_CHARS = 128;
/** RFC 5321's cap on an address. */
export const GIT_MAX_IDENTITY_EMAIL_CHARS = 254;

/** A subagent name is also its filename; kebab-case at this length covers
 * every real agent name and keeps the path short. */
export const SUBAGENT_MAX_NAME_CHARS = 64;
/** The description is the routing hint a CLI matches a task against — a
 * sentence or two, not a document. */
export const SUBAGENT_MAX_DESCRIPTION_CHARS = 1_000;
/** The body. Same bound as a user turn: it is prose of the same order. */
export const SUBAGENT_MAX_PROMPT_CHARS = 64_000;
/** A comma-separated tool allowlist, not free prose. */
export const SUBAGENT_MAX_TOOLS_CHARS = 1_000;

/** Mirrors `SubagentScope`. */
const SUBAGENT_SCOPES = new Set<string>(["project", "user"]);

function isConsoleSize(cols: unknown, rows: unknown): boolean {
  return (
    typeof cols === "number" &&
    typeof rows === "number" &&
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= 1 &&
    rows >= 1 &&
    cols <= CONSOLE_MAX_COLS &&
    rows <= CONSOLE_MAX_ROWS
  );
}

const TONES = new Set<string>(["neutral", "dry", "warm"]);
const THEMES = new Set<string>(["samaritan", "machine"]);

/** Narrows an unknown parsed frame to a client message. The socket is a trust
 * boundary even on loopback — nothing downstream should be casting. */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  if (type === "discovery.run") return true;
  if (type === "operator.name") {
    return typeof (value as { name?: unknown }).name === "string";
  }
  if (type === "operator.tone") {
    return TONES.has((value as { tone?: unknown }).tone as string);
  }
  if (type === "project.select") {
    return typeof (value as { path?: unknown }).path === "string";
  }
  if (type === "theme.select") {
    return THEMES.has((value as { theme?: unknown }).theme as string);
  }
  if (type === "provider.connect") {
    return typeof (value as { id?: unknown }).id === "string";
  }
  if (type === "provider.options") return true;
  if (type === "provider.checkUsage") return true;
  if (type === "auth.start" || type === "auth.signout") {
    return typeof (value as { providerId?: unknown }).providerId === "string";
  }
  if (type === "auth.code") {
    // Only that it is a string. The shape of a code is the CLI's business —
    // anything stricter here would be this process guessing at a format it does
    // not own, and rejecting a valid paste is indistinguishable to the operator
    // from a broken login.
    return typeof (value as { code?: unknown }).code === "string";
  }
  if (type === "auth.cancel") return true;
  if (type === "memory.reset") return true;
  if (type === "console.open") {
    const msg = value as { cols?: unknown; rows?: unknown };
    return isConsoleSize(msg.cols, msg.rows);
  }
  if (type === "console.input") {
    const msg = value as { id?: unknown; data?: unknown };
    return (
      typeof msg.id === "string" &&
      msg.id.length > 0 &&
      msg.id.length <= 64 &&
      typeof msg.data === "string" &&
      msg.data.length <= CONSOLE_MAX_INPUT_CHARS
    );
  }
  if (type === "console.resize") {
    const msg = value as { id?: unknown; cols?: unknown; rows?: unknown };
    return (
      typeof msg.id === "string" &&
      msg.id.length > 0 &&
      msg.id.length <= 64 &&
      isConsoleSize(msg.cols, msg.rows)
    );
  }
  if (type === "console.close") {
    const msg = value as { id?: unknown };
    return (
      typeof msg.id === "string" && msg.id.length > 0 && msg.id.length <= 64
    );
  }
  if (type === "session.list") return true;
  if (type === "session.create") {
    const msg = value as {
      model?: unknown;
      permissionMode?: unknown;
      agent?: unknown;
      name?: unknown;
    };
    if (msg.model !== undefined && typeof msg.model !== "string") return false;
    if (
      msg.permissionMode !== undefined &&
      !PERMISSION_MODES.has(msg.permissionMode as string)
    ) {
      return false;
    }
    // An empty agent is legal — it is the "none" row, and it must be
    // distinguishable from the field never having been sent.
    if (
      msg.agent !== undefined &&
      (typeof msg.agent !== "string" ||
        msg.agent.length > SESSION_MAX_AGENT_CHARS)
    ) {
      return false;
    }
    if (msg.name !== undefined) {
      return (
        typeof msg.name === "string" &&
        msg.name.length > 0 &&
        msg.name.length <= SESSION_MAX_NAME_CHARS
      );
    }
    return true;
  }
  if (
    type === "session.open" ||
    type === "session.interrupt" ||
    type === "session.close" ||
    type === "session.delete"
  ) {
    const msg = value as { sessionId?: unknown };
    return isSessionId(msg.sessionId);
  }
  if (type === "session.send") {
    const msg = value as { sessionId?: unknown; text?: unknown };
    return (
      isSessionId(msg.sessionId) &&
      typeof msg.text === "string" &&
      msg.text.length > 0 &&
      msg.text.length <= SESSION_MAX_TEXT_CHARS
    );
  }
  if (type === "session.model") {
    const msg = value as { sessionId?: unknown; model?: unknown };
    return (
      isSessionId(msg.sessionId) &&
      typeof msg.model === "string" &&
      msg.model.length > 0 &&
      msg.model.length <= SESSION_MAX_MODEL_CHARS
    );
  }
  if (type === "session.mode") {
    const msg = value as { sessionId?: unknown; mode?: unknown };
    return (
      isSessionId(msg.sessionId) && PERMISSION_MODES.has(msg.mode as string)
    );
  }
  if (type === "approval.resolve") {
    const msg = value as {
      sessionId?: unknown;
      requestId?: unknown;
      decision?: unknown;
    };
    return (
      isSessionId(msg.sessionId) &&
      typeof msg.requestId === "string" &&
      msg.requestId.length > 0 &&
      msg.requestId.length <= APPROVAL_MAX_ID_CHARS &&
      isPermissionDecision(msg.decision)
    );
  }
  if (type === "plan.list") return true;
  if (type === "plan.implement") {
    return isPlanId((value as { planId?: unknown }).planId);
  }
  if (type === "plan.status") {
    const msg = value as { planId?: unknown; status?: unknown };
    return (
      isPlanId(msg.planId) && PLAN_OVERRIDE_STATUSES.has(msg.status as string)
    );
  }
  if (type === "loop.config.read") return true;
  if (type === "loop.provider.set") {
    const msg = value as { id?: unknown };
    return typeof msg.id === "string" && msg.id.length > 0 && msg.id.length <= 64;
  }
  if (type === "loop.model.set") {
    const msg = value as { providerId?: unknown; slot?: unknown; model?: unknown };
    return (
      typeof msg.providerId === "string" &&
      msg.providerId.length > 0 &&
      msg.providerId.length <= 64 &&
      typeof msg.slot === "string" &&
      msg.slot.length > 0 &&
      msg.slot.length <= 64 &&
      // Model itself may be "" (clears the slot back to inherit).
      typeof msg.model === "string" &&
      msg.model.length <= SESSION_MAX_MODEL_CHARS
    );
  }
  if (type === "loop.models.read") {
    const msg = value as { providerId?: unknown };
    return typeof msg.providerId === "string" && msg.providerId.length > 0 && msg.providerId.length <= 64;
  }
  if (type === "project.create") {
    const msg = value as {
      name?: unknown;
      folder?: unknown;
      description?: unknown;
    };
    return (
      typeof msg.name === "string" &&
      msg.name.length > 0 &&
      msg.name.length <= PROJECT_MAX_NAME_CHARS &&
      typeof msg.folder === "string" &&
      msg.folder.length > 0 &&
      msg.folder.length <= PROJECT_MAX_FOLDER_CHARS &&
      typeof msg.description === "string" &&
      msg.description.length <= PROJECT_MAX_DESCRIPTION_CHARS
    );
  }
  if (
    type === "project.git.status" ||
    type === "project.git.push" ||
    type === "project.git.merge" ||
    type === "project.git.revert"
  ) {
    return isGitPath((value as { path?: unknown }).path);
  }
  if (type === "project.git.commit") {
    const msg = value as { path?: unknown; message?: unknown };
    return (
      isGitPath(msg.path) &&
      typeof msg.message === "string" &&
      msg.message.trim().length > 0 &&
      msg.message.length <= GIT_MAX_COMMIT_MESSAGE_CHARS
    );
  }
  if (type === "project.git.show") {
    const msg = value as {
      path?: unknown;
      file?: unknown;
      mode?: unknown;
      previousPath?: unknown;
    };
    return (
      isGitPath(msg.path) &&
      isRepoRelativePath(msg.file) &&
      (msg.mode === "diff" || msg.mode === "content") &&
      (msg.previousPath === undefined || isRepoRelativePath(msg.previousPath))
    );
  }
  if (
    type === "git.access.read" ||
    type === "git.ssh.generate" ||
    type === "git.ssh.remove"
  ) {
    return true;
  }
  if (type === "git.ssh.test") {
    const msg = value as { host?: unknown; port?: unknown };
    return isSshHost(msg.host) && isSshPort(msg.port);
  }
  if (type === "git.identity.set") {
    const msg = value as { name?: unknown; email?: unknown };
    return isGitIdentityName(msg.name) && isGitIdentityEmail(msg.email);
  }
  if (type === "subagent.list") return true;
  if (type === "subagent.write") {
    const msg = value as {
      name?: unknown;
      description?: unknown;
      prompt?: unknown;
      model?: unknown;
      tools?: unknown;
      scope?: unknown;
      previousName?: unknown;
      previousScope?: unknown;
    };
    return (
      isSubagentName(msg.name) &&
      typeof msg.description === "string" &&
      msg.description.length <= SUBAGENT_MAX_DESCRIPTION_CHARS &&
      typeof msg.prompt === "string" &&
      msg.prompt.length <= SUBAGENT_MAX_PROMPT_CHARS &&
      typeof msg.model === "string" &&
      msg.model.length <= SESSION_MAX_MODEL_CHARS &&
      typeof msg.tools === "string" &&
      msg.tools.length <= SUBAGENT_MAX_TOOLS_CHARS &&
      SUBAGENT_SCOPES.has(msg.scope as string) &&
      (msg.previousName === undefined || isSubagentName(msg.previousName)) &&
      (msg.previousScope === undefined ||
        SUBAGENT_SCOPES.has(msg.previousScope as string))
    );
  }
  if (type === "subagent.delete") {
    const msg = value as { name?: unknown; scope?: unknown };
    return isSubagentName(msg.name) && SUBAGENT_SCOPES.has(msg.scope as string);
  }
  return false;
}

/** A DNS label: alphanumeric, inner hyphens, never leading or trailing one. */
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;

/**
 * An ssh host the client may ask us to authenticate against.
 *
 * Deliberately broader than a public-forge hostname. A naive
 * `/^[a-z0-9.-]+$/` passes `github.com` and quietly rejects two of the shapes
 * a real workspace uses: a private single-label host (`gitlab.local`) and a
 * bracketed IPv6 literal (`git@[2001:db8::1]:repos/x.git`). Both are ordinary
 * git remotes, so both have to be testable.
 *
 * The literal is validated by parsing what is inside the brackets rather than
 * by pattern — an address is not a thing a regex should be asked to judge.
 * `isIPv6` is inlined instead of imported so `protocol` stays free of `node:`
 * (the web bundle imports this module too).
 */
function isSshHost(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > GIT_SSH_MAX_HOST_CHARS) return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    return isIPv6Literal(value.slice(1, -1));
  }
  return value.split(".").every((label) => DNS_LABEL.test(label));
}

/** Enough to reject anything that is not an address; the ssh client does the
 * authoritative parse. Accepts the compressed and IPv4-mapped forms. */
function isIPv6Literal(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^[0-9a-f:.]+$/i.test(value)) return false;
  // At most one "::", and at least two groups to be an address at all.
  if (value.split("::").length > 2) return false;
  return value.includes(":");
}

function isSshPort(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

/**
 * Identity values reach a git config file, so a newline or a section bracket
 * would let one field forge another. Rejected here rather than escaped: there
 * is no legitimate name or address containing them, and a frame that carries
 * one is not a mistake worth explaining back.
 */
function hasConfigInjection(value: string): boolean {
  return /[\n\r[\]]/.test(value);
}

function isGitIdentityName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= GIT_MAX_IDENTITY_NAME_CHARS &&
    !hasConfigInjection(value)
  );
}

function isGitIdentityEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= GIT_MAX_IDENTITY_EMAIL_CHARS &&
    !hasConfigInjection(value) &&
    !/\s/.test(value) &&
    value.includes("@")
  );
}

/**
 * Shape and length only — deliberately not `SUBAGENT_NAME_PATTERN`.
 *
 * A name that is the right shape but the wrong format is a mistake the
 * operator made in a form, and it deserves a sentence telling them the rule
 * (which the server gives it), not a frame silently dropped as unrecognized.
 * The same split `project.create` makes with `PROJECT_FOLDER_PATTERN`.
 *
 * It is also what lets `subagent.delete` accept a hand-written name the write
 * path would refuse — the one file an operator most wants to be able to remove.
 */
function isSubagentName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SUBAGENT_MAX_NAME_CHARS
  );
}

function isGitPath(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= GIT_MAX_PATH_CHARS
  );
}

/**
 * A path *inside* a project, as opposed to `isGitPath`'s project directory
 * itself: relative, with no `..` segment, no leading slash, and no NUL.
 *
 * The server resolves this against the real project directory and re-checks
 * containment before it reads anything — this is the cheaper half of that
 * defence, refusing a frame that could not possibly name a file inside a
 * project before it reaches the code that would have to prove it does not.
 *
 * Backslashes are rejected too. Git pathspecs are `/`-separated on every
 * platform, so a backslash is never load-bearing here, and `..\` is the same
 * escape wearing a different separator. A leading `-` is refused so the value
 * cannot be read as a flag even if a caller forgets the `--` separator.
 */
function isRepoRelativePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > GIT_MAX_PATH_CHARS) return false;
  if (value.startsWith("/") || value.startsWith("-")) return false;
  if (value.includes("\0") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== ".." && segment !== "");
}

function isPlanId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= PLAN_MAX_ID_CHARS
  );
}

function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SESSION_MAX_ID_CHARS
  );
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  if (typeof value !== "object" || value === null) return false;
  const decision = value as {
    decision?: unknown;
    rule?: unknown;
    feedback?: unknown;
  };
  if (decision.decision === "allow-once") return true;
  if (decision.decision === "allow-always") {
    return (
      typeof decision.rule === "string" &&
      decision.rule.length > 0 &&
      decision.rule.length <= APPROVAL_MAX_RULE_CHARS
    );
  }
  if (decision.decision === "deny") {
    return (
      decision.feedback === undefined ||
      (typeof decision.feedback === "string" &&
        decision.feedback.length <= APPROVAL_MAX_FEEDBACK_CHARS)
    );
  }
  if (decision.decision === "answer") {
    const answers = (value as { answers?: unknown }).answers;
    if (typeof answers !== "object" || answers === null) return false;
    const entries = Object.entries(answers as Record<string, unknown>);
    if (entries.length === 0 || entries.length > APPROVAL_MAX_ANSWERS) {
      return false;
    }
    return entries.every(
      ([question, answer]) =>
        question.length > 0 &&
        question.length <= APPROVAL_MAX_QUESTION_CHARS &&
        typeof answer === "string" &&
        answer.length > 0 &&
        answer.length <= APPROVAL_MAX_ANSWER_CHARS,
    );
  }
  return false;
}
