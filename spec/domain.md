# Domain — Concepts, Rules and Invariants

The settled words for Overseer's concepts and the rules that hold between them. Use these words in
code, UI copy and docs; do not coin synonyms (see the "renaming things" anti-pattern,
[ui-ux.md §10](ui-ux.md#10-anti-patterns)). Dev-loop vocabulary has its own glossary (§6).

---

## 1. People and places

| Term | Meaning |
|---|---|
| **Operator** | The one developer using this instance. |
| **Workspace** | `/workspace` in the container — a host directory beside the repo (`OVERSEER_WORKSPACE_HOST`). The only surface shared with the host in production; dev also shares the source repo. |
| **Project** | One git repository directly under the workspace, `/workspace/<project>/`. |
| **Active project** | The project new sessions, shells and prompts target. Chosen by the operator, remembered in internal memory; existing consoles keep their own project. |
| **`overseer-personality`** | A project the overseer scaffolds on first discovery to hold `personality.json`. An ordinary project otherwise. |

## 2. Providers

| Term | Meaning |
|---|---|
| **Provider** | An agent CLI as the operator sees it — attached, signed in, configured. Identified by an id (`claude`, `cursor`, …). |
| **Adapter** | The code that translates one provider's CLI into the protocol. Same id as its provider. |
| **Catalog stub** | A provider whose CLI ships in the image but whose adapter is not built (`app: "stub"`). Listed, not usable. |
| **Attached provider** | The one provider new app sessions use. Restored from the operator's pick, otherwise the first authenticated provider. |
| **Bundle** | A provider's loop-side config tree (`providers/<id>/provider.sh` + config). |

## 3. Consoles and sessions

| Term | Meaning |
|---|---|
| **Console** | A process in a PTY the server owns, shown in a window. Kind `agent`, `shell` or `loop`; status `running` or `exited`. |
| **Session** | One provider conversation, identified by its transcript id. **Live** when a console runs it; **dormant** otherwise. A loop session has `origin: "loop"`. |
| **Attach / detach** | A browser window joining or leaving a running console. Detaching never ends the process. |
| **Kill** | Explicitly ending a console's process. Never reported as a failure. |
| **Transcript** | The CLI's own on-disk record of a session. Read only to list and delete. |

## 4. The overseer

| Term | Meaning |
|---|---|
| **Overseer** | The system's own voice — wizard, supervisor, automation trigger and notification point. Not chat, not a dashboard, not a log. (The dev loop's orchestrating session is also called "the overseer" inside `loop/`; context disambiguates.) |
| **Activity** | The one status vocabulary: `approval` → `attention` → `waiting` → `working` → `done` → `idle`, in rank order. |
| **Message** | The overseer's one uppercase line, in the operator's tone. |
| **Signal** | A ranked, actionable sentence derived from real state on every render; never stored. Has a kicker (its category). |
| **Status window** | Telegraphic rows of service work. A row is a **state** (a condition, replaced in place) or an **event** (a happening, append-only). |
| **Tone** | `neutral`, `dry` or `warm` — the copy pack the message speaks in. |
| **Wizard** | The startup state machine: `boot` → `welcome` → `discovery` → `settling` → `ready`. |
| **Discovery** | The startup pass that learns time, personality, projects and providers. |
| **Internal memory** | `/app/.overseer` — action register, snapshot, run logs. Container-owned, authoritative. |
| **External memory** | `personality.json` in `overseer-personality`. Host-writable, allowlisted, never authoritative. |

UI primitives — field, rail, stage, furniture, window, panel, widget, decision — are defined in
[ui-ux.md](ui-ux.md).

## 5. Invariants

These hold everywhere; code that breaks one is a bug, a spec change that breaks one needs a
[decision record](decisions/).

1. **No agent process on the host.** Everything that spawns a CLI or the loop runs in the container.
2. **One CLI per transcript.** A session never has two live consoles.
3. **One loop run per project.** Guarded by the loop's lease; reaching one held elsewhere is an
   explicit, confirmed take-over.
4. **One attached provider.** Restore the operator's previous pick when registered; otherwise attach
   the first already authenticated provider. Never start login automatically.
5. **External never overrides internal.** Host-writable input (`personality.json`) cannot change
   policy, logging, permissions, paths, or signals. A rejected field is reported, never silently ignored.
6. **The action register has no mute switch.** Reporting starts a best-effort asynchronous record
   write, then broadcasts without waiting for persistence.
7. **Signals are derived, never stored**, and every signal is actionable.
8. **Personality changes phrasing, never meaning.** Activity, errors, paths and diffs are verbatim.
9. **Sign-in is not memory.** Resetting the overseer never touches provider auth.
10. **Server git generally goes through `packages/server/src/vcs/`.** Personality scaffolding is
    the exception and spawns `git` directly.
11. **No private key leaves the container.** Only the public half of the git ssh key is ever shown.
12. **`publish` gates the selected request only.** It reads that request's review artifact (or
    accepts `--force`); stacked ancestors are not independently gated.

## 6. Dev loop vocabulary

Request, step, stint, phase, tracer and tracer group, trunk, train, route, outcome and status are
defined in [`loop/CONTEXT.md`](../loop/CONTEXT.md). It lives beside the loop because loop sessions
read it at runtime; it is part of this spec all the same. The two-word distinctions that matter
most: a **stint** (the runtime working-tree lock, one request per workspace) is not a **phase** (a
plan-time batch of tracers inside one request), and a **route** (where `decide` sends a request
next) is not an **outcome** (the human's `review` verdict).
