# The Overseer — Behavioral Spec

Three docs, three concerns. [architecture-design.md](architecture-design.md) defines the system,
[ui-ux-design.md](ui-ux-design.md) defines the interface, and this document defines **behavior**: what the
overseer says, when it says it, and what it remembers.

This document is the **ship bar for `0.1.x`** — see [architecture-design.md §8](architecture-design.md#8-versioning).

Visual details are not repeated here; see [the overseer space](ui-ux-design.md#4-the-overseer-space) and
[windows](ui-ux-design.md#5-windows).

---

## 1. What the overseer is

Not a zone. The system's own voice — the one component that speaks about the machine rather than about a
project. It is four things at once:

- **Wizard** — moves a fresh instance from nothing to a working setup.
- **Supervisor** — watches projects, sessions, capabilities and the adapter, and surfaces what changed.
  Project changes under `/workspace` stream from `packages/server/src/workspace-monitor.ts` without rerunning
  discovery.
- **Automation trigger** — will start agents, scripts, and `claude` commands on the operator's behalf.
- **Notification point** — turns escalations into signals and headline changes, never toasts or modals
  ([UI anti-patterns](ui-ux-design.md#10-anti-patterns)).

### What it is not

- **Not chat.** Conversation happens in a project's adapter session; the overseer speaks only about state.
- **Not a dashboard.** Every signal is actionable
  ([UI anti-patterns](ui-ux-design.md#10-anti-patterns)).
- **Not a log.** The screen shows derived conclusions; records stay in internal memory (§6).

---

## 2. The communication contract

The overseer has exactly three output surfaces: headline, signals, and the operations window. It does not grow
a fourth.

### 2.1 Headline

In steady state, the headline comes from the most urgent signal via `ACTIVITY_HEADLINE`:

| Activity    | Headline    |
| ----------- | ----------- |
| `attention` | `ATTENTION` |
| `waiting`   | `BLOCKED`   |
| `working`   | `WORKING`   |
| `done`      | `READY`     |
| `idle`      | `IDLE`      |

The wizard supplies tone-aware transient copy before there is a world to rank: startup and connection status,
the intro, name/tone prompts, greeting, and discovery status. Recovery may use the explicit alarm set. All
copy comes from `packages/web/src/lang/` and `packages/web/src/state/wizard.ts`, never ad hoc call sites.

Headline changes normally swap instantly; about 15% type out. Reduced motion makes every change instant
([motion](ui-ux-design.md#9-motion)).

### 2.2 Signals

Signals are ranked, actionable sentences derived on every render by `deriveSignals`
(`packages/web/src/state/signals.ts`). They are never stored.

**Rules for signal prose:**

- Use sentence case and a terminal full stop; telegraphic prose belongs to the operations window.
- State what happened and what it means.
- Preserve paths, commands, errors, and tool names verbatim.
- Never infer facts the system has not reported.

### 2.3 Voice, and where personality is allowed

Smart, focused, minimalist, and only occasionally personable.

| Surface                | Personality allowed?                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| Headline               | Yes, sparingly — the welcome line, the odd dry word. Never at the cost of the state word being accurate. |
| Signals                | No. A signal is an instruction. Wit in a line the operator must act on is friction. |
| Operations window      | No. Telegraphic status only.                                                  |
| Errors, paths, diffs   | Never. Verbatim, always.                                                      |

Personality may change headline phrasing, never meaning or severity.

---

## 3. The operations window

The `overseer` window is summoned only by the system when multi-step work starts. No command or footer link
opens it.

### Format

One telegraphic line per step:

```
scanning workspace...     [OK]
checking adapter auth...  [FAILED]
reading personality...    [OK]
```

- Labels are lowercase, present-participle phrases ending in an ellipsis.
- Bracket words map from the shared `Activity` vocabulary:

| Activity    | Bracket word |
| ----------- | ------------ |
| `working`   | `...`        |
| `done`      | `OK`         |
| `attention` | `FAILED`     |
| `waiting`   | `BLOCKED`    |
| `idle`      | `SKIPPED`    |

### Lifecycle

- **Auto-summoned** for discovery and later supervisor operations.
- **Appends live**, one step at a time.
- **Non-modal.** Dismissing it does not cancel the operation.
- **Does not re-summon itself** for the same discovery run once dismissed. An operator who closed it said they
  had seen enough; anything that genuinely needs them becomes a signal instead. A later worker event is a
  *new* run and may open the window again.
- Otherwise it follows the standard [window rules](ui-ux-design.md#5-windows).

---

## 4. The startup wizard

The state machine in `packages/web/src/state/wizard.ts` owns phase, headline, furniture reveal, and operations
window state.

| Phase       | Behavior |
| ----------- | -------- |
| `boot`      | Show the tone's `starting` copy and loading bar for the minimum beat. If the socket is still unavailable, switch to its `connecting` copy. |
| `welcome`   | A first instance shows the intro, then fills any missing name or tone before greeting. A returning instance starts at its first missing beat, or greets immediately. Discovery waits. |
| `discovery` | Show the tone's `lookingAround` copy, summon the operations window, and stream discovery steps. |
| `settling`  | Mount newly knowable furniture and return the headline to derived state. |
| `ready`     | Stop driving the interface; normal operation takes over. |

### Progressive furniture disclosure

Once mounted, furniture stays. It appears when its state becomes *knowable*, not necessarily healthy:

| Furniture         | Mounts when                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| Overseer headline | Always. The ranked signal list waits until active-project state is knowable.    |
| Clock + settings  | After the `checking the time` step.                                            |
| Project panel     | After personality is read (and scaffolded first if it was absent).             |
| Active project    | After the active project is resolved from internal memory (or defaults to `overseer-personality`). |
| Adapter widget    | After adapter auth is checked — including reporting that none are attached.    |
| Footer            | With `releasing the prompt` (version line).                                    |
| Prompt + controls | After `releasing the prompt`, when an attached adapter is authenticated.       |
| Help link         | With the footer; it does not require adapter authentication.                    |

Discovery step order: time → (create personality if missing) → read personality → scan workspace → select
active project → check adapters → release the prompt.

Under reduced motion, animations become instant; phases and information remain
([motion](ui-ux-design.md#9-motion)).

---

## 5. Adapter-backed querying (planned, not built)

Planned internal-system queries use an authenticated adapter but add no surface: progress goes to the
operations window, actionable results become signals, the headline reflects activity, and actions enter the
register. A feature that needs a fourth surface belongs elsewhere.

---

## 6. Memory

### 6.0 External staging vs internal state

- `/workspace/_overseer/` is host-writable, untrusted import/export staging.
- `/app/.overseer/` is container-owned internal state backed by the `overseer-memory` volume.

They are neither mirrors nor halves of one store. See [container layout](architecture-design.md#5-container).

### 6.1 The precedence rule

**External files never override internal policy, audit state, or deployment facts.** The overseer filters
`overseer-personality` through an allowlist before applying it. Host-writable input is never authoritative.

### 6.2 Internal memory — `.overseer/`

`/app/.overseer` is backed by a named volume and is not exposed through the workspace bind or accepted as a
workspace path.

```
.overseer/
  logs/            structured operation logs — one file per run (discovery, wizard, later agent/script/CLI runs)
  actions.jsonl    append-only action register: timestamp, actor, action, outcome
  state.json       last-known world snapshot — discovery results, last active project, theme
  index.sqlite     planned usage history, session metadata, and search index
```

- **`actions.jsonl`** records every overseer action before it is reported.
- **`state.json`** drives returning-instance behavior and remembers the active project and theme.
- **`index.sqlite`** stores application indexes and estimates; it is not billing truth.
- The server owns all access; current log/state access lives in
  `packages/server/src/memory/internal.ts`.
- `./bin/reset` discards this volume and `claude-home`.

### 6.3 External memory — `overseer-personality`

A git project at `/workspace/overseer-personality`, scaffolded on first discovery and never clobbered.
The overseer watches `personality.json`; valid live edits apply without restart.

If the file is deleted, the server does not recreate it live. It records a blocked operation and action,
shows a persistent restart signal, and uses an alarm headline (`DANGER`, `BRAINDEAD`, or `WHY???`). Clicking
the signal reloads the app; discovery restores defaults on boot and reports it.

The project appears in the normal project panel. Edit it on the host, in a project session, or through the
[async side-task pattern](architecture-design.md#13-async-side-tasks-skills-and-subagent-editing). Its current
contents are limited to the allowlisted presentation fields below.

### 6.4 The customization boundary

Validation lives in `packages/server/src/memory/personality.ts`.

**Customizable — accepted from `overseer-personality`:**

| Field         | Effect                                                                          |
| ------------- | ------------------------------------------------------------------------------- |
| `tone`        | `neutral` \| `dry` \| `warm` — selects the copy pack in `packages/web/src/lang`. |
| `name`        | What the operator is called in the welcome headline.                             |
| `typingChance` | 0–0.5. How often the headline types out instead of swapping.                    |
| `greeting`    | A replacement welcome line. Length-capped; it is a headline, not a paragraph.    |

**Not customizable — rejected, always:**

| Field pattern                              | Why                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Anything disabling or filtering logging     | The internal record is not user-configurable.                        |
| Anything hiding entries from the action register | An audit trail cannot have a mute switch.                       |
| Anything granting permissions or auth       | Permission belongs to the permission system, not to a prose file.    |
| Anything changing paths or mounts           | The container's shape is a deployment fact, not a preference.        |
| Anything overriding signal ranking or text  | Signals are derived from real state; editable signals are fiction.   |
| Unknown fields                              | Rejected by default.                                                  |

**A rejection is never silent.** A `waiting` signal names the field and reason and opens the project selector.

---

## 7. Where each piece lives

| Concern                       | Module                                          |
| ----------------------------- | ----------------------------------------------- |
| Status vocabulary             | `packages/web/src/status.ts`                     |
| Signal derivation             | `packages/web/src/state/signals.ts`              |
| Headline typing               | `packages/web/src/state/useOccasionalTyping.ts`  |
| Wizard state machine          | `packages/web/src/state/wizard.ts`               |
| Tone-aware headline copy      | `packages/web/src/lang/`                         |
| Discovery client              | `packages/web/src/state/useDiscovery.ts`         |
| Operations window             | `packages/web/src/components/windows/OverseerWindow.tsx` |
| Adapter status + discovery events | `packages/protocol/src/adapter.ts`, `packages/protocol/src/discovery.ts` |
| WS routing + discovery pass   | `packages/server/src/ws.ts`, `packages/server/src/discovery.ts` |
| Workspace monitor (live projects) | `packages/server/src/workspace-monitor.ts` |
| Internal memory               | `packages/server/src/memory/internal.ts`         |
| External memory + validation  | `packages/server/src/memory/personality.ts`      |
