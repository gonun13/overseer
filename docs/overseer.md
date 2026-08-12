# The Overseer — Behavioral Spec

Three docs, three concerns. [`claude-code-webui-design.md`](claude-code-webui-design.md) is the architecture,
[`design-system.md`](design-system.md) is the visual language, and this one is **behavior**: what the overseer
says, when it says it, what it remembers, and what an operator is allowed to change about any of that.

Visual details — colours, layout, motion timing, the shape of a window — are not repeated here. Where behavior
has a visual consequence this doc cross-references [§4 The overseer space](design-system.md#4-the-overseer-space)
and [§5 Windows](design-system.md#5-windows) rather than re-specifying them.

---

## 1. What the overseer is

Not a zone. The system's own voice — the one component that speaks about the machine rather than about a
project. It is four things at once:

- **Wizard** — walks a fresh instance from nothing to a working setup, and tells the operator what is still
  missing.
- **Supervisor** — watches projects, sessions, capabilities and the adapter, and surfaces what changed.
  The workspace monitor (`packages/server/src/workspace-monitor.ts`) is the live half of that for
  projects: create/delete under `/workspace` updates the panel over the socket without re-running discovery.
- **Automation trigger** — starts agents, runs scripts and `claude` CLI commands on the operator's behalf.
- **Notification point** — the single place an escalation lands. There are no toasts and no modals; an
  escalation becomes a signal and changes the headline (§10 anti-patterns).

### What it is not

- **Not a chat surface.** The operator does not converse with the overseer. Conversation happens in the prompt,
  against a project's session, with an adapter. The overseer speaks in headlines and signals — one direction,
  short, and always about state.
- **Not a dashboard.** It does not display metrics for their own sake. Every line it emits is something the
  operator can act on; a readout the operator cannot act on does not belong in the overseer space (§10).
- **Not a log.** Logs are internal memory (§6). What reaches the screen is the ranked, derived conclusion, not
  the record that produced it.

---

## 2. The communication contract

The overseer has exactly two output surfaces, both already built. It does not grow a third.

### 2.1 Headline

One uppercase word, the whole system's state, taken from the most urgent signal so headline and list can never
disagree. The vocabulary is fixed and closed — `ACTIVITY_HEADLINE` in `packages/web/src/status.ts`:

| Activity    | Headline    |
| ----------- | ----------- |
| `attention` | `ATTENTION` |
| `waiting`   | `BLOCKED`   |
| `working`   | `WORKING`   |
| `done`      | `READY`     |
| `idle`      | `IDLE`      |

The wizard adds transient words for states that exist before there is any world to rank (`STARTING`,
`WELCOME, {user}`, `LOOKING AROUND`). They are still one line, still uppercase, still driven by a defined
state machine (`state/wizard.ts`) rather than written ad hoc at a call site. **New system state earns a
derivation rule, not a new widget** — the same rule §4 states for signals applies to the headline.

Motion: the headline normally swaps instantly. `useOccasionalTyping` types it out on roughly 1 in 7 real
changes, never on mount. Under `prefers-reduced-motion` the typing pass is skipped entirely and the change is
instant — see [§9 Motion](design-system.md#9-motion). The randomness only decides instant-vs-typed; it never
decides *whether* the state change shows.

### 2.2 Signals

Longer, ranked, clickable sentences. `[light] KICKER  sentence.` Derived on every render by `deriveSignals`
(`packages/web/src/state/signals.ts`), never stored, so they cannot go stale. Every signal knows what it wants
opened — a window, the settings panel, the project panel, the prompt.

**Rules for signal prose:**

- Sentence case, plain prose, terminal full stop. Not telegraphic — that register belongs to the operations
  window (§3).
- Say what happened *and* what it means: "linear (mcp · http) is unusable: missing API token." The consequence
  is the half the operator acts on.
- Name things verbatim — paths, commands, errors, tool names. No codenames, no renaming (§10).
- Never speculate. If the overseer has not been told something, the signal says it has not been told; it does
  not fill the gap with a plausible default.

### 2.3 Voice, and where personality is allowed

Smart, focused, minimalist. Occasionally personable — and *occasionally* is load-bearing. The tell that
something is watching should be rare enough that it never reads as a feature.

| Surface                | Personality allowed?                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| Headline               | Yes, sparingly — the welcome line, the odd dry word. Never at the cost of the state word being accurate. |
| Signals                | No. A signal is an instruction. Wit in a line the operator must act on is friction. |
| Operations window      | No. Telegraphic status only.                                                  |
| Errors, paths, diffs   | Never. Verbatim, always.                                                      |

Personality never changes *what* is reported, only occasionally *how* the headline reads. An overseer that
soft-pedals a failure to sound pleasant has broken the contract.

---

## 3. The operations window

A `WindowKind` like any other (`overseer` in `packages/web/src/windows.ts`), with one behavioral difference:
**it is summoned by the overseer, not by the operator.** No footer link, no typed command opens it. It appears
because the overseer started doing something multi-step and owes the operator a view of it.

### Format

Telegraphic. One line per step, label padded, status bracketed:

```
scanning workspace...     [OK]
checking adapter auth...  [FAILED]
reading personality...    [OK]
```

- The label is lowercase, present participle, ellipsised — it names the step while it runs.
- The status is uppercase in brackets, drawn from the same `Activity` vocabulary as everything else. No new
  colours, no new icons: a `StatusLight` and a word.

| Activity    | Bracket word |
| ----------- | ------------ |
| `working`   | `...`        |
| `done`      | `OK`         |
| `attention` | `FAILED`     |
| `waiting`   | `BLOCKED`    |
| `idle`      | `SKIPPED`    |

### Lifecycle

- **Auto-summoned** when a multi-step operation starts: the empty-project wizard's discovery pass, and later
  any supervisor worker that has something to report (e.g. workspace monitor adding/removing a project).
- **Appends live.** Steps arrive one at a time and the list grows; it is never rendered as a finished batch.
  Worker lines use the same telegraphic format (`adding project foo… [OK]`).
- **Not modal, and not required.** The operator can dismiss it mid-run with `Esc` or the tab's ✕. The operation
  continues — the window is a view of the work, not the work.
- **Does not re-summon itself** for the same discovery run once dismissed. An operator who closed it said they
  had seen enough; anything that genuinely needs them becomes a signal instead. A later worker event is a
  *new* run and may open the window again.
- Otherwise ordinary window chrome — draggable tab, `WINDOW_SPEC` width, clamped to viewport ([§5](design-system.md#5-windows)).

---

## 4. The empty-project wizard

What a fresh instance does: no sessions, no capabilities, no adapter, no projects. The sequence is driven by a
state machine in `packages/web/src/state/wizard.ts` — not by conditionals scattered through `App.tsx` — and
that machine is the single source for which furniture is mounted, what the headline says, and what the
operations window shows.

| Phase        | Headline           | What happens                                                                   |
| ------------ | ------------------ | ------------------------------------------------------------------------------ |
| `boot`       | `STARTING`              | Loading bar. The socket is connecting; nothing is known yet.                    |
| `welcome`    | first turn: `I AM THE OVERSEER` → name → tone → greet | Connected. Asks for name, then tone, whenever those are unset in `overseer-personality`. Copy comes from `packages/web/src/lang` and varies with tone. A return visit with both set greets; missing name or tone re-asks that beat. |
| `discovery`  | `LOOKING AROUND`        | Operations window opens; server runs the discovery pass and streams steps.      |
| `settling`   | derived            | Discovery complete. Furniture mounts per resolved capability; the headline hands back to `headlineFor`. |
| `ready`      | derived            | The wizard is done and stops driving anything. Normal operation.                |

### Progressive furniture disclosure

Furniture is **permanent** — once mounted it stays. What the wizard controls is when each piece first earns its
place, and the rule is that a piece of furniture appears when the capability it reports on becomes *knowable*,
not when it becomes *good*. Discovery unlocks pieces on each finished step:

| Furniture         | Mounts when                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| Overseer space    | Always. It is the thing that explains the absence of everything else.           |
| Clock + settings  | After the `checking the time` step.                                            |
| Project panel     | After personality is read (and scaffolded first if it was absent).             |
| Active project    | After the active project is resolved from internal memory (or defaults to `overseer-personality`). |
| Adapter widget    | After adapter auth is checked — including reporting that none are attached.    |
| Footer            | With `releasing the prompt` (version line).                                    |
| Prompt + controls | After `releasing the prompt`, when an attached adapter is authenticated.       |
| Ask for help      | With the prompt — same gate.                                                   |

Discovery step order: time → (create personality if missing) → read personality → scan workspace → select
active project → check adapters → release the prompt.

### Reduced motion

The loading bar and the headline typing both collapse to instant state changes under
`prefers-reduced-motion` ([§9](design-system.md#9-motion)). The *phases* still happen and still show — reduced
motion removes the animation, never the information.

---

## 5. Adapter-backed querying (planned, not built)

Once an authenticated adapter exists, the overseer can answer questions about internal systems by asking the
LLM. The point of writing this down now is that **it introduces no new communication surface.** It maps onto
what already exists:

- The query runs as a multi-step operation → the **operations window** (§3), one line per step, same
  telegraphic format.
- The answer, if it needs the operator to do something → a **signal** (§2.2), ranked with everything else.
- The system's state while it runs → the **headline** (§2.1), `WORKING`, same as any turn in flight.
- Anything the overseer actually did on the way → the **action register** (§6.2), same as any other action.

If a future feature cannot be expressed in headline + signals + operations window, that is a signal the feature
is wrong for this component, not that the component needs a fourth surface.

---

## 6. Memory

### 6.0 Two things called "overseer" — read this first

There are two directories whose names look alike and whose trust models are opposites. Conflating them
defeats the entire precedence model below.

| | `/workspace/_overseer/` | `.overseer/` |
| --- | --- | --- |
| Prefix | underscore | dot |
| Where | under the host bind mount | container/app root (`/app/.overseer`) |
| Backing | host filesystem, via `./workspace` | named Docker volume, never bind-mounted |
| Host-reachable | **Yes — that is its purpose** | **No — that is its purpose** |
| Holds | config import/export staging, the SQLite index (webui design doc §2, §5) | logs, action register, state snapshot (§6.2) |
| Trust | user-writable, therefore untrusted | container-owned, therefore authoritative |

One exists **specifically to move files across the host/container boundary**. The other exists **specifically
to never cross it**. They are not two halves of one store and neither is a mirror of the other.

### 6.1 The precedence rule

**Internal memory always wins. External memory is advisory input, not configuration with authority.**

The overseer reads `overseer-personality` (§6.3) and filters it through an internal allowlist before any of it
can influence behavior. It is never merged blindly. This is enforceable only because internal memory is
unreachable from the host — anything host-writable is by definition user-writable, and a rule the user can
edit is not a rule.

### 6.2 Internal memory — `.overseer/`

Container-owned, at `/app/.overseer`, backed by a named Docker volume declared in both compose files and bind-mounted
in neither — the same pattern as `claude-home`. A console into the container can reach it; the host cannot, and
neither can any workspace project.

```
.overseer/
  logs/            structured operation logs — one file per run (discovery, wizard, later agent/script/CLI runs)
  actions.jsonl    append-only action register: timestamp, actor, action, outcome
  state.json       last-known world snapshot — discovery results, last active project
```

- **`actions.jsonl` is append-only and total.** Every action the overseer takes is recorded before it is
  reported. Nothing can turn this off — see the allowlist below.
- **`state.json`** is what lets a restart know it is not a stranger's first boot; it drives the wizard's
  "welcome back" branch (§4) and remembers the last active project.
- Server-side access lives in `packages/server/src/memory/internal.ts`. Nothing in the web package reads or
  writes it directly.
- `./bin/reset` discards this volume along with `claude-home`. That is correct: reset means "this instance
  forgets everything it learned", and an action register surviving a reset would be a record of a machine that
  no longer exists.

### 6.3 External memory — `overseer-personality`

A real git project at `/workspace/overseer-personality`, auto-scaffolded on first discovery if absent and never
clobbered if present. Because it is an ordinary project under the workspace mount, it is discovered by the
normal scanner, appears in the project panel like anything else, and is editable the three ways any workspace
project already is — on the host directly, through a session opened against it, or via the async side-task
editing pattern used for skills and subagents (webui design doc §1.3). No fourth editing path.

Contents are prose and config, not code: tone preferences, preferred automations, custom triggers — written the
way a skill is written.

### 6.4 The customization boundary

This is the exact line #10 implements. Validation lives in `packages/server/src/memory/personality.ts`.

**Customizable — accepted from `overseer-personality`:**

| Field         | Effect                                                                          |
| ------------- | ------------------------------------------------------------------------------- |
| `tone`        | `neutral` \| `dry` \| `warm` — selects the copy pack in `packages/web/src/lang`. |
| `name`        | What the operator is called in the welcome headline.                             |
| `typingChance`| 0–0.5. How often the headline types out instead of swapping. Capped, not free.   |
| `greeting`    | A replacement welcome line. Length-capped; it is a headline, not a paragraph.    |

**Not customizable — rejected, always:**

| Field pattern                              | Why                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Anything disabling or filtering logging     | The record is not the user's to edit. §6.2.                          |
| Anything hiding entries from the action register | Same. An audit trail with a mute switch is not an audit trail.   |
| Anything granting permissions or auth       | Permission belongs to the permission system, not to a prose file.    |
| Anything changing paths or mounts           | The container's shape is a deployment fact, not a preference.        |
| Anything overriding signal ranking or text  | Signals are derived from real state; editable signals are fiction.   |
| Unknown fields                              | Rejected by default. An allowlist that accepts the unrecognized is not an allowlist. |

**A rejection is never silent.** When a field is refused, the operator gets a `waiting` signal naming the field
and the reason, targeted at the personality project. Silently dropping something a user deliberately wrote is
worse than refusing it loudly — they would go on believing it took effect.

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
