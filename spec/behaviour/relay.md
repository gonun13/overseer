# Callsigns and relay — Behavioural Spec

Agent sessions carry a person's name, and the overseer can type a prompt into one on someone's
behalf. Why this exists and what it changed is [decision 0002](../decisions/0002-callsigns-and-relay.md);
the consoles it acts on are [consoles.md](consoles.md).

The overseer routes; it does not converse. A relay is delivered **verbatim** (an agent's is framed,
§5.2), and the overseer never answers, rewrites or interprets it
([overseer.md §1](overseer.md#1-what-the-overseer-is)).

---

## 1. Callsigns

A **callsign** is a session's person name — `Linda`, `Bob`. It is how the operator and other agents
address that session, and it is shown wherever the session is (§6).

| Rule | |
|---|---|
| Who gets one | Every `agent` console, when it opens. Shells and loop consoles do not. |
| Where it comes from | A fixed pool of short, distinct first names, taken in order: the first name nobody holds. |
| How long it lasts | For the life of the session: a resumed session keeps its callsign, and so does a dormant one in the session list. |
| Keyed by | The session id. A console whose CLI did not adopt the minted id is keyed by its console id, and its callsign lasts as long as the console. |
| Uniqueness | Case-insensitive, across every remembered session in every project. |
| Released | When its session is deleted; when its console is dismissed before the CLI wrote a transcript; or by a reset (`reset overseer`). |
| Pool exhausted | Names held by sessions that no longer exist (not listed, no console) are reclaimed first; failing that, the pool repeats with a number (`Linda2`). |

### 1.1 Renaming

`/rename <callsign> <new>` renames a session. A new callsign starts with a letter, is 2–16
letters, digits or hyphens, matches no other callsign (ignoring case), and is not `overseer` or
`operator`. The outcome is a status event, `renaming linda...`; a refusal names the reason. Display keeps the operator's capitalisation; addressing
ignores case.

## 2. Addressing — `@callsign`

In the prompt bar ([ui-ux.md §7](../ui-ux.md#7-the-prompt)):

- `@` lists callsigns as suggestions: running consoles first, then dormant sessions of the active
  project, each with its session title. Tab completes the highlighted one so the message can
  follow; Enter on it raises that agent, as `@linda` alone does.
- `@linda <text>` relays `<text>` to Linda. It never starts a new session.
- `@linda` alone raises Linda's console window (resuming a dormant session), and relays nothing.
- An unknown callsign is refused and reported (§4).

Free text addressed to the overseer ("overseer, tell Linda…") is not parsed.

## 3. Delivery

A relay is typed into the target's CLI as one submitted prompt — the adapter owns how
(`AgentAdapter.relayInput`). A provider whose adapter cannot do that refuses relays by name.

**When.** Only into an **idle** console whose prompt holds no operator draft (domain invariant
13). Never while it is `working`, `waiting` (an approval or a question is on screen) or `unknown`
(not reported yet). Until then the relay is **queued** on that console:

- One relay per idle: the next waits for the next turn to end, so two prompts never collide.
- Queued relays are delivered first-in, first-out.
- **Draft guard.** Printable keys the operator typed into the console since its last Enter (or
  `Ctrl`+`C`) are a draft, and a relay waits until the operator submits or clears it that way.
  Without the guard a relay would be pasted onto the end of the operator's half-typed prompt.
- A CLI without hooks is idle after two quiet seconds ([consoles.md §4](consoles.md#4-activity)) —
  a weaker reading, accepted for relay all the same.
- Overseer assumes an idle CLI is at its prompt. A menu the operator opened in the TUI (a model
  picker, say) without typing a draft is not detected.

**Dormant targets.** Relaying to a dormant session resumes it in a new console
([consoles.md §2](consoles.md#2-opening--start-or-attach)) and delivers on its first idle. A session
held by a live loop run cannot be resumed, so it cannot be relayed to.

**Exit.** A console that exits drops its queue, and each dropped relay is reported as failed.

## 4. Reporting

Relay reports through the overseer space as service `relay`
([overseer.md §3](overseer.md#3-status)):

| Happening | Row |
|---|---|
| queued behind work | state `relaying to linda... [...]`, replaced as it moves on |
| held by a draft | state `relaying to linda... [BLOCKED]`, detail `operator draft in the prompt` |
| delivered | event `relaying to linda... [OK]`, recorded `console:relay` with the first 60 characters |
| refused or dropped | event `relaying to linda... [FAILED]`, with the reason verbatim |

The target's tab and session row carry a pending mark while it has queued relays
([ui-ux.md §5.3](../ui-ux.md#53-the-console)). A queue held by `waiting` adds no signal of its
own: the console's existing waiting signal already points at it.

## 5. Agent to agent

### 5.1 What an agent console is given

Each `agent` console is started knowing its callsign and how to reach the others:

- `OVERSEER_CALLSIGN` and `OVERSEER_RELAY_URL` in its environment, and the `overseer` command on
  its `PATH`.
- A short appended system prompt, where the CLI supports one (Claude Code's
  `--append-system-prompt`), naming the callsign and the commands below.

| Command | Does |
|---|---|
| `overseer whoami` | prints this console's callsign |
| `overseer who` | the roster: each callsign, project, light, session title, running or dormant |
| `overseer tell <callsign> <text…>` | relays `text` (or stdin when no text is given) |

The command talks to `/relay/<console>/<token>` on loopback with the console's own token, so an
agent can only relay as itself ([architecture.md §6.1](../architecture.md#61-approvals-and-hooks)).

### 5.2 Framing and limits

An agent's relay is delivered as `[from Bob] <text>`, so the receiver can tell it from the
operator. It obeys §3, plus:

| Guard | Rule |
|---|---|
| Self | An agent cannot relay to itself. |
| Dormant | An agent cannot wake a dormant session; only the operator can. Refused. |
| Rate | At most 6 relays per sender per 10 minutes. |
| Cooldown | 30 seconds between relays from one sender to the same target. |

A relay over the rate or cooldown is **held**, not dropped. A held relay is an `approval` signal —
`Bob wants to relay to Linda: …`. Following the signal releases it (it is then queued as usual,
past the limits); `/drop` drops every held relay. Every agent relay is recorded as `agent:relay`,
detail `bob→linda · …`.

## 6. Where callsigns show

- A console's tab: the callsign is its title (`LINDA`), never the session's title, and its detail
  is the project, plus `<n> queued` while relays wait.
- The session panel: the callsign names the row, for consoles and dormant sessions alike, beside
  the project; the note at its right names the provider, plus `<n> queued` while relays wait. A
  session without a callsign keeps its name.
- Signals about a console name it by callsign first.
- `@` suggestions and `overseer who`.
