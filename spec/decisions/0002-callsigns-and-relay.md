# Callsigns and relay

The operator runs several agents at once and has no way to refer to one except by finding its
window. The prompt bar could only start a session; it could not speak to a running one. Agent
sessions now carry a **callsign** — a person's name — and the overseer can **relay** a prompt to
one: `@linda build two new file adapters` from the prompt bar, or `overseer tell linda …` from
inside another agent's console.

What this changes in settled spec:

- **The prompt bar** gains a third input form beside `/command` and a new-session prompt:
  `@callsign text` relays `text` to that session. Update ui-ux §7 and the prompt's idle copy.
- **The overseer is still not chat.** It routes a relay verbatim and reports the delivery; it never
  answers, rewrites or interprets the text. Free-text addressing ("overseer, tell Linda…") is
  deliberately not supported — understanding it would put a model behind the overseer. Relay is the
  first concrete use of the "automation trigger" role. Update behaviour/overseer.md §1.
- **Overseer writes into a CLI's input** for the first time. Until now only the operator typed into
  a console. A relay is typed only into an **idle** console with no operator draft in its prompt,
  never into one that is working, waiting on an approval, or not yet known — typing into a
  permission prompt could answer it. This is a new invariant (domain §5.13). Delivery is one
  message per idle, so two prompts never collide.
- **A new internal store**, `callsigns.json`, maps session ids to callsigns. It is overseer memory:
  `reset overseer` erases it. Update data §2 and behaviour/overseer.md §6.5.
- **A new loopback endpoint**, `/relay/<console>/<token>`, lets an agent CLI relay and read the
  roster, authenticated the same way as hooks (loopback plus the console's token). Update data §4
  and architecture §6.1.
- **Agent consoles are told who they are** — a callsign, a relay URL and a short appended system
  prompt — so agents can address each other. Agent relays are framed `[from <callsign>]`, capped,
  cooled down, and held for the operator's approval past the cap, because two agents prompting each
  other is an unbounded loop otherwise. A held relay is an `approval` signal, the one new signal
  kind.

What it does not change: PROJECT requirement 4 still holds. "Spawn two agents" in a relayed prompt
is the receiving CLI's own subagent feature; Overseer starts nothing on its behalf. Transcripts are
still read only to list sessions — what an agent is "on" is the session title the adapter already
derives, plus its activity.

The flow itself is [behaviour/relay.md](../behaviour/relay.md). Updated with this record:
`domain.md` §3 and §5, `data.md` §2 and §4, `ui-ux.md` §5.3, §6 and §7, `architecture.md` §1.2,
§3 and §6.1, `behaviour/consoles.md` §1 and §5, `behaviour/overseer.md` §1 and §6.5, `PROJECT.md`'s
index, and `AGENTS.md`'s spec list.
