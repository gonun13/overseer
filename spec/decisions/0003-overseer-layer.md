# The overseer layer

The overseer's status rows lived in a window — the one window kind the machine summoned on its own.
It opened over the operator's consoles whenever a service started work, had to be dismissed to get
the desk back, and carried a set of summon rules (`never re-summoned`, `does not re-summon itself`)
whose only job was to stop it being a nuisance. Meanwhile the message and signals it belonged with
sat in the right rail, and the provider widget sat between the prompt and the footer.

What this changes in settled spec:

- **Status is no longer a window.** The rows render under the signals in the right rail's overseer
  layer, there from discovery's first step while the message still speaks from the stage centre, so
  they never move when the message and signals dock above them. Nothing summons or dismisses
  them, so the summon rules are gone; the rows still follow the state/event split, and the list
  follows its newest row unless the operator scrolls up. The three output surfaces are message,
  signals and status. Updated behaviour/overseer.md §2, §2.3, §3, §4, §5, §6.5 and §7; ui-ux.md §4
  and §5; domain.md §4; data.md §2; behaviour/relay.md §1 and §4.
- **The right rail's middle is the overseer layer** — message, signals, status, and the prompt at its
  foot — with the footer under it. Updated ui-ux.md §1, §6 and §7.
- **The provider widget moves to the foot of the left rail**, under the start buttons. Updated
  ui-ux.md §1 and §6.

What it does not change: the communication contract (one space API behind all three surfaces),
the row format, or when furniture mounts.
