# The Overseer — Behavioral Spec

[architecture.md](../architecture.md) defines the system, [ui-ux.md](../ui-ux.md) defines the interface,
[data.md](../data.md) defines the stores, and this document defines the overseer's **behavior**: what it
says, when it says it, and what it remembers.

This document is the **ship bar for `0.1.x`** — see [architecture.md §8](../architecture.md#8-versioning).

Visual details are not repeated here; see [the overseer space](../ui-ux.md#4-the-overseer-space) and
[windows](../ui-ux.md#5-windows).

---

## 1. What the overseer is

Not a zone. The system's own voice — the one component that speaks about the machine rather than about a
project. It is four things at once:

- **Wizard** — moves a fresh instance from nothing to a working setup.
- **Supervisor** — watches projects, consoles, sessions and the provider, and surfaces what changed — a console waiting on the operator, one that died with an error.
  Project changes under `/workspace` stream from `packages/server/src/workspace-monitor.ts` without rerunning
  discovery.
- **Automation trigger** — will start agents, scripts, and `claude` commands on the operator's behalf.
  Today it relays: it types a prompt into an agent console addressed by callsign, verbatim, when that
  console is idle ([relay.md](relay.md)). Routing a prompt is not conversing with the operator.
- **Notification point** — turns escalations into signals and messages, never toasts or modals
  ([UI anti-patterns](../ui-ux.md#10-anti-patterns)).

### What it is not

- **Not chat.** Conversation happens in the provider's own CLI, in a console; the overseer speaks only about state.
- **Not a dashboard.** Every signal is actionable
  ([UI anti-patterns](../ui-ux.md#10-anti-patterns)).
- **Not a log.** The screen shows derived conclusions; records stay in internal memory (§6).

---

## 2. The communication contract

The overseer has exactly three output surfaces: **message**, **signals**, and **status**. It does
not grow a fourth. All three live in the overseer space, which docks with the prompt into the right
rail's overseer layer ([ui-ux §4](../ui-ux.md#4-the-overseer-space)).

All three are driven by one API — `createOverseerSpace` (`packages/server/src/overseer/space.ts`) on the
server, and the store in `packages/web/src/state/space.ts` on the client. A service does not broadcast to a
surface directly; it reports to the space, and the space decides what the operator sees. Before this, each
surface had its own mechanism and services hand-rolled `overseer.step` frames at a dozen call sites, which is
how a line written at boot could outlive the fact behind it.

### 2.1 Message

A one-liner the overseer throws at the operator, in their tone.

In steady state it comes from the most urgent signal: `ACTIVITY_MESSAGE_KEY` maps that signal's activity to a
key, and the operator's tone pack supplies the words.

| Activity    | Key         | Neutral                    |
| ----------- | ----------- | -------------------------- |
| `approval`  | `approval`  | `waiting on your approval` |
| `attention` | `attention` | `something needs you`      |
| `waiting`   | `blocked`   | `blocked`                  |
| `working`   | `working`   | `working`                  |
| `done`      | `ready`     | `ready`                    |
| `idle`      | `idle`      | `nothing running`          |

**The line is text and nothing else.** No light rides on it: the rule beneath it already widens while
anything is in motion, and the top-ranked signal immediately below carries the same `Activity` with its own
light. A third reading of one state on the sparest surface in the app is what §2 means by not growing a
fourth surface.

The line stays **uppercase**. The shout was never decoration on the one-word form; it is the field's register,
and a message set in sentence case reads as speech rather than as the machine. It is set smaller than the word
it replaced (26px, not 34px) and allowed to wrap, because a full line at the old size does not survive a
narrow viewport.

The server can raise a message of its own through `space.say()`, naming a key and an activity; the client
renders it in the operator's tone and hands the surface back to the ranked signal list after a short hold. The
server never sends prose, which is what keeps tone from being able to change meaning.

The wizard supplies transient copy before there is a world to rank: startup and connection status, name/tone
prompts (with the self-introduction as the tone-pick message), greeting, and discovery status. Recovery may
use the explicit alarm set, which is **verbatim** — an alarm word is not for a tone pack to soften. A reset
outranks all of it (§6.5). All copy comes from `packages/web/src/lang/` and `packages/web/src/state/wizard.ts`,
never ad hoc call sites.

Message changes normally swap instantly; about 15% type out. Reduced motion makes every change instant
([motion](../ui-ux.md#9-motion)).

### 2.2 Signals

The surface reserved for things that **require interaction**. Ranked, actionable sentences derived on every
render by `deriveSignals` (`packages/web/src/state/signals.ts`). They are never stored.

**Rules for signal prose:**

- Use sentence case and a terminal full stop; telegraphic prose belongs to status.
- State what happened and what it means.
- Preserve paths, commands, errors, and tool names verbatim.
- Never infer facts the system has not reported.

### 2.3 Voice, and where personality is allowed

Smart, focused, minimalist, and only occasionally personable.

| Surface                | Personality allowed?                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| Message                | Yes — this is the surface that carries voice. Never at the cost of the status light being accurate. |
| Signals                | No. A signal is an instruction. Wit in a line the operator must act on is friction. |
| Status                 | No. Telegraphic status only.                                                  |
| Errors, paths, diffs   | Never. Verbatim, always.                                                      |

Personality may change message phrasing, never meaning or severity. `activity` is named by the server and the
`FORBIDDEN` map in `memory/personality/validate.ts` refuses any attempt to customize the vocabulary itself.

---

## 3. Status

The status rows sit under the signals in the right rail's overseer layer, just over the prompt. They are
there from discovery's first step — while the message still speaks from the stage centre — so the
message and signals docking above them later does not move them. They are where trigger logs from every service land,
centrally managed rather than fired ad hoc. Status is not a window: no command opens it and nothing
dismisses it.

### Format

One telegraphic line per row:

```
scanning workspace...     [OK]
checking provider auth... [FAILED]
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

### States and events

Every row is one of two kinds, and the distinction is what keeps the list honest:

| Mode | Means | Lifecycle |
| ---- | ----- | --------- |
| `state` | A condition that holds right now — "the provider is not authenticated", "the prompt is held", "git is slow in this mount" | Keyed by `(service, key)`. A later report **replaces it in place**; `space.clear()` removes it when the condition ends. |
| `event` | Something that happened — "committed foo", "generated an ssh key", "adding project bar" | Append-only and immutable. A second one never overwrites the first. |

A row reported as a `state` and re-reported unchanged is dropped rather than re-broadcast.

Treating a condition as an event is the bug this split exists to prevent: it is why `checking provider
auth... [BLOCKED]` used to survive a successful login. Every path that changes provider auth now calls
`refreshProviderRows`, and the rows correct themselves.

Rows read **conditions first, then happenings** (`spaceRows`).

### Lifecycle

- **Appends live**, one row at a time; a `state` row revising itself changes in place.
- **Follows its newest row**, unless the operator has scrolled up to read an older one.
- **Shows once discovery starts.** Nothing stands under the boot copy or the name and tone asks, and the
  goodbye clears it — that is a message and nothing else (§6.5). A replay to a joining tab fills it
  without being new work.
- **Passive.** Rows are readouts, not controls; anything that genuinely needs the operator becomes a signal
  instead. Reading the list never cancels the operation behind it.
- Only the most recent 200 events are kept on screen; the action register is the archive.

---

## 4. The startup wizard

The state machine in `packages/web/src/state/wizard.ts` owns phase, message, furniture reveal, and operations
window state. It also owns the reset stage (§6.5), which is a field of its own rather than a phase: a reset
can be asked for at any point once the clock is up, and folding it into the phase would throw away whichever
phase was running.

| Phase       | Behavior |
| ----------- | -------- |
| `boot`      | Show the tone's `starting` copy and loading bar for the minimum beat. If the socket is still unavailable, switch to its `connecting` copy. |
| `welcome`   | Fill any missing name or tone, then greet. "I AM THE OVERSEER" is the message behind the tone pick, not a beat before the name ask. A returning instance starts at its first missing beat, or greets immediately. Discovery waits. |
| `discovery` | Show the tone's `lookingAround` copy and stream discovery steps into status. |
| `settling`  | Mount newly knowable furniture and return the message to derived state. |
| `ready`     | Stop driving the interface; normal operation takes over. |

### Progressive furniture disclosure

Once mounted, furniture stays until a confirmed reset takes it away (§6.5). It appears when its state becomes
*knowable*, not necessarily healthy:

| Furniture         | Mounts when                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| Overseer message | Always. The ranked signal list waits until active-project state is knowable.    |
| Clock + settings  | After the `checking the time` step.                                            |
| Project panel     | After personality is read (and scaffolded first if it was absent).             |
| Active project    | After the active project is resolved from internal memory (or defaults to `overseer-personality`). |
| Provider widget   | After provider auth is checked — including reporting that none are attached.   |
| Footer            | With `releasing the prompt` (version line).                                    |
| Prompt + controls | After `releasing the prompt`, when an attached provider is authenticated.      |
| Help link         | With the footer; it does not require provider authentication.                   |

Discovery step order: time → (create personality if missing) → read personality → scan workspace → select
active project → check providers → release the prompt.

Under reduced motion, animations become instant; phases and information remain
([motion](../ui-ux.md#9-motion)).

---

## 5. Provider-backed querying (planned, not built)

Planned internal-system queries use an authenticated provider but add no surface: progress goes to
status, actionable results become signals, the message reflects activity, and actions enter the
register. A feature that needs a fourth surface belongs elsewhere.

---

## 6. Memory

### 6.0 External input vs internal state

- `/workspace/overseer-personality/personality.json` is host-writable advisory input.
- `/app/.overseer/` is container-owned internal state backed by the `overseer-memory` volume.

They are neither mirrors nor halves of one store. See [data.md §1](../data.md#1-where-things-live).

### 6.1 The precedence rule

**External files never override internal policy, audit state, or deployment facts.** The overseer filters
`overseer-personality` through an allowlist before applying it. Host-writable input is never authoritative.

### 6.2 Internal memory — `.overseer/`

`/app/.overseer` is backed by a named volume and is not exposed through the workspace bind or accepted as a
workspace path.

Its layout and record shapes — `logs/`, `actions.jsonl`, `state.json` — are
[data.md §2](../data.md#2-internal-memory--appoverseer). Behaviourally:

- **`actions.jsonl`** records selected overseer actions. Some reports start the best-effort append
  without waiting for it to finish.
- **`state.json`** drives returning-instance behavior and remembers the active project and theme.
- The server owns all access (`packages/server/src/memory/internal.ts`).
- `./bin/reset` discards this volume and `agent-home`. `reset overseer` in the settings panel empties the
  store from inside the running server and leaves auth alone (§6.5).

### 6.3 External memory — `overseer-personality`

A git project at `/workspace/overseer-personality`, scaffolded on first discovery and never clobbered.
The overseer watches `personality.json`; valid live edits apply without restart.

If the file is deleted, the server does not recreate it live. It records a blocked operation and action,
shows a persistent restart signal, and uses an alarm message (`danger`, `braindead`, or `why???`). Clicking
the signal reloads the app; discovery restores defaults on boot and reports it.

That complaint describes an accident. A reset deletes the same file on purpose, so the wizard ignores the
monitor's report while one is running (§6.5) — the reload it would ask for is already coming.

The project appears in the normal project panel. Edit it on the host, or in a console
session in that project. Its current contents are limited to the allowlisted presentation fields below.

### 6.4 The customization boundary

Validation lives in `packages/server/src/memory/personality/`.

**Customizable — accepted from `overseer-personality`:**

| Field         | Effect                                                                          |
| ------------- | ------------------------------------------------------------------------------- |
| `tone`        | `neutral` \| `dry` \| `warm` — selects the copy pack in `packages/web/src/lang`. |
| `name`        | What the operator is called in the welcome message.                             |
| `typingChance` | 0–0.5. How often the message types out instead of swapping.                    |
| `greeting`    | A replacement welcome line. Length-capped; it is a message, not a paragraph.    |

**Not customizable — rejected, always:**

| Field pattern                              | Why                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Anything disabling or filtering logging     | The internal record is not user-configurable.                        |
| Anything hiding entries from the action register | An audit trail cannot have a mute switch.                       |
| Anything granting permissions or auth       | Permission belongs to the permission system, not to a prose file.    |
| Anything changing paths or mounts           | The container's shape is a deployment fact, not a preference.        |
| Anything overriding signal ranking or text  | Signals are derived from real state; editable signals are fiction.   |
| Unknown fields                              | Rejected by default; `$schema` and `//`-prefixed metadata keys are ignored. |

**A rejection is never silent.** A `waiting` signal names the field and reason and opens the project selector.

### 6.5 Resetting the overseer — forgetting on purpose

`reset overseer` in the settings panel's danger row is the operator's way of making the overseer a stranger
again. It is the one action that destroys memory, so it is the one action that blocks the interface to ask:
a [decision](../ui-ux.md#54-the-decision--the-one-surface-that-blocks) goes up, and until it is answered
nothing else in the field can be clicked or tabbed to.

**What a confirmed reset erases**, as one `memory.reset` frame handled in `packages/server/src/ws.ts`:

| Store                                        | Erased | Why                                                              |
| -------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `state.json` — the world snapshot             | Yes    | Its existence is what makes the next boot a return visit (§6.2). |
| `actions.jsonl` — the action register         | Yes    | The record is of an instance that will not exist.                |
| `logs/` — every run log                       | Yes    | Same.                                                             |
| `callsigns.json` — session names              | Yes    | Names were given by this instance ([relay.md](relay.md)).        |
| `personality.json`                            | Yes    | The name and tone were given to this instance (§6.3).            |
| The `overseer-personality` project around it  | No     | An ordinary git project with the operator's own history in it.   |
| Workspace projects                            | No     | Never the overseer's to remove.                                  |
| Provider auth (`agent-home`)                  | No     | Sign-in is not memory. `./bin/reset` is what discards that.      |

The order is `personality.json` → run logs → callsigns → action register → snapshot (`erasing memory`). The snapshot
goes last so status ends on memory itself; the register is still cleared before that so the
deletes' own audit lines do not survive as the new instance's first memory. A wipe that fails stops there
and keeps that trail, which is the one case worth having it.

**How it plays out.** The overseer reacts to the question in the message — surprise, in the tone it was
given — and answers again when it is refused; the decision itself states the terms in plain machine copy
(§2.3). On confirmation each delete arrives as an ordinary status row and costs one piece of
furniture, controls first and the clock last. When the last store is gone the interface is a message and
nothing else: one goodbye in the same tone, held for ten seconds with the caret blinking (a click
restarts immediately), then the page reloads into a first run — discovery finds no
snapshot, scaffolds `personality.json` back to defaults, and asks for a name.

A wipe that fails partway does not reload. The failed step stands in status and the error
becomes the message, because a first-run boot would quietly contradict memory that is still on disk.

---

## 7. Where each piece lives

| Concern                       | Module                                          |
| ----------------------------- | ----------------------------------------------- |
| Status vocabulary             | `packages/protocol/src/space.ts` (`Activity`), `packages/web/src/status.ts` (the UI's maps) |
| Space API (server)            | `packages/server/src/overseer/space.ts`          |
| Space store (client)          | `packages/web/src/state/space.ts`                |
| Provider rows + prompt gate   | `packages/server/src/overseer/provider-status.ts` |
| Signal derivation             | `packages/web/src/state/signals.ts`              |
| Message typing                | `packages/web/src/state/useOccasionalTyping.ts`  |
| Wizard state machine          | `packages/web/src/state/wizard.ts`               |
| Tone-aware message copy       | `packages/web/src/lang/`                         |
| Discovery client              | `packages/web/src/state/useDiscovery.ts`         |
| Reset decision                | `packages/web/src/components/DecisionWindow.tsx` |
| Status rows                   | `packages/web/src/components/OverseerSpace.tsx` (`StatusRows`) |
| Adapter status + discovery events | `packages/protocol/src/adapter.ts` (runtime contract), `packages/protocol/src/discovery.ts` |
| WS routing + discovery pass   | `packages/server/src/ws.ts`, `packages/server/src/discovery.ts` |
| Workspace monitor (live projects) | `packages/server/src/workspace-monitor.ts` |
| Internal memory               | `packages/server/src/memory/internal.ts`         |
| Callsigns + relay             | `packages/server/src/callsigns.ts`, `packages/server/src/relay.ts` |
| External memory + validation  | `packages/server/src/memory/personality/`      |
