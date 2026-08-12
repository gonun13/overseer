# Overseer — Design System

**Reference:** [samaritan-web](https://git.kaki87.net/thornhill-corp/samaritan-web) for layout and interaction
model. Colour and type below are Overseer's own.

**Premise:** an operator watches agents work. The interface's job is to answer _what should I be looking
at?_ before it offers anything else. Everything on screen is either **permanent furniture** — the readouts
and controls that are always true — or a **summoned surface** that exists because the operator or the system
asked for it.

This is not a dashboard: there is no nav rail, no zone grid, no always-populated columns. It is a fixed frame
of instruments around a centre that stays quiet until there is something to say.

---

## 1. The field

Fullscreen, fixed, no page scroll, **never a horizontal scrollbar anywhere** — not on the field, not inside a
window, not inside a panel. The background is a soft radial vignette, brightest at centre, falling off at the
edges.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ● PROJECT  billing-service   ▾      ACTIVE PROJECT          14:32:07    [⚙]   │
│ ├ ● billing-service  fix/refund…  2 appr │ billing-service  tue 10 aug        │
│ ├ ● overseer         main         running│  fix/refund-race · dirty           │
│ ├ ● docs-site        main         3 files│                                    │
│ └ ○ infra            main                │                                    │
│                                                                                │
│                                 ATTENTION            ← headline                │
│                                 ─────────                                      │
│                                     ▲                                          │
│    ● APPROVAL     2 tool calls are waiting on your decision.                   │
│    ● ADAPTER      claude-code is not authenticated · sessions cannot start.    │
│    ● SESSION      overseer / web shell · editing packages/web/src/App.tsx.     │
│                                          ↑ the overseer space                  │
│                                                                                │
│ │1 MODEL    opus-5    ▾                                    ┌            ┐      │
│ │2 MODE     ask       ▾                                     ADAPTER   ●        │
│ │   ▪ ask                    ┌────────────────────────────┐ claude-code       │
│ │     auto-accept            │ › message billing-service  │ usage ▓▓▓▓▓░ 78%  │
│ │     plan                   └────────────────────────────┘                    │
│ │     bypass              v0.1 | ask for HELP | open CONSOLE └            ┘    │
│ │3 AGENT    default   ▾                                                        │
│ │4 CONTEXT  2 attached ›                                                       │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Region        | Owns                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| top-left      | **project panel** — persistent status list of every project, and the selector |
| top-centre    | **active project** — what every operation runs against                        |
| top-right     | **clock** and the **settings** gear                                           |
| centre        | **the overseer space** — headline plus ranked, clickable signals              |
| bottom-left   | **prompt controls** — the numbered accordion                                  |
| bottom-centre | **the prompt** — transcript and composer as sibling panels — and the footer   |
| bottom-right  | **adapter widget** — adapter, auth, usage, spend                              |

Widths are capped and centred, so there are no breakpoints. Windows clamp their spawn position and width to
the viewport. Below 1024px is out of scope — this is a desktop instrument.

---

## 2. Colour — four levels, and the inversion

A theme is not a palette swap. **Samaritan is the reference theme and the default; machine is its opposite at
every level.** Describe a level in samaritan's terms and machine follows by inversion. One level sits outside
that inversion entirely.

| Level       | What lives there                                                                                         | Samaritan (default) | Machine            |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| **field**   | ground, the overseer space, the active project, the clock, widgets, readouts, menus, the transcript page | light               | dark               |
| **surface** | what you act _through_ — windows, panels, the project list once it opens, and every input (§7.1)         | dark                | light              |
| **stamp**   | what gets printed — session output, chips, and (when current) a control's option                         | a darker light      | a lighter dark     |
| **void**    | a window's own tab; an opened prompt control's option list                                               | near-black, always  | near-black, always |

A component's level is decided by **what it is, not where it sits — and a single piece of furniture can cross
levels.** A menu you only read from — the project panel's collapsed header, a prompt control's row — stays on
the field, the same as the clock. What you click into to _choose_ something drops onto `--void` (a prompt
control's opened options) or inverts into a surface (the project list) depending on how much room the choice
needs; either way it is not the field anymore.

The sharpest case of that rule is the chat, where **input is dark and output is light** (§7.1) — the composer
and your echoed turns take the surface's ground, the transcript they sit on takes the field's. Read that
section before touching any colour inside the prompt.

A **stamp stays on the field's side of the scale, one step in toward the surface.** That is what lets it read
as paper whether it is printed onto the field or onto a surface. It also means a stamp keeps the field's
lightness, so **stamps reuse the field's status tokens** — `--accent`, `--ok` and `--warn` are correct on a
stamp with no extra variants.

**Void is not a fifth position on the field↔surface scale — it does not move.** It is reserved for the two
places where the chrome names or operates the machine itself rather than showing the operator's work: a
window's tab (the machine's label for the window, not the window's content) and an opened prompt control's
option list (the machine's own menu, not something a session produced). Both stay a fixed near-black with
light ink in _both_ themes — switching themes should never make the window furniture itself hard to find, and
this is the one place a literal, unchanging identity reads better than a relative one.

`--page` is the field made opaque enough to read as a bounded panel. It exists for exactly one thing: the
transcript, the only window frame that stays field-level rather than inverting, because output is light
(§7.1).

**Machine mirrors samaritan token for token — same alphas, same relationships, opposite lightness — and the
`:root` block is the source of truth.** Two checks catch the drift that creeps in when only one theme is
being looked at: every `rgba` pair must share an alpha, and every _relationship_ must survive the inversion,
not just every value. The second is the one that bites. When `--bg` moved to charcoal, `--stamp` stayed put
and the step between them collapsed from samaritan's 27 points to 10, so stamps stopped separating from the
page they print onto — a bug that is invisible if you only look at the light theme. Dark grounds need a
slightly wider step than light ones to read the same, so mirroring a relationship is not always mirroring an
arithmetic difference.

| Token                                                   | Level   | `samaritan`                            | `machine`                         |
| ------------------------------------------------------- | ------- | -------------------------------------- | --------------------------------- |
| `--bg`                                                  | field   | `#ffffff`                              | `#1c1c1c`                         |
| `--bg-vignette`                                         | field   | `#8f8f8f`                              | `#101010`                         |
| `--text` / `--text-dim` / `--text-faint`                | field   | dark                                   | light                             |
| `--edge`                                                | field   | `rgba(17,17,17,0.85)`                  | `rgba(243,243,243,0.85)`          |
| `--accent` · `--ok` · `--warn`                          | field   | `#d0342c` · `#1e9e57` · `#a97400`      | `#e11d1d` · `#2ecc71` · `#f1c40f` |
| `--raise`                                               | field   | `rgba(17,17,17,0.05)`                  | `rgba(243,243,243,0.05)`          |
| `--page`                                                | field   | `rgba(255,255,255,0.97)`               | `rgba(28,28,28,0.97)`             |
| `--stamp`                                               | stamp   | `#e4e4e4`                              | `#333333`                         |
| `--stamp-ink` / `--stamp-dim` / `--stamp-faint`         | stamp   | dark                                   | light                             |
| `--stamp-edge`                                          | stamp   | `rgba(17,17,17,0.2)`                   | `rgba(243,243,243,0.2)`           |
| `--fill` / `--fill-solid`                               | surface | `#0a0a0a`                              | `#eeeeee`                         |
| `--ink` / `--ink-dim` / `--ink-faint` / `--ink-rule`    | surface | light                                  | dark                              |
| `--accent-fill` · `--ok-fill` · `--warn-fill`           | surface | `#ff4a44` · `#35d67f` · `#f1c40f`      | `#c0201c` · `#1a8a4c` · `#8a6100` |
| `--void` / `--void-ink` / `--void-dim` / `--void-faint` | void    | near-black, light — fixed, both themes |
| `--void-edge` / `--void-raise`                          | void    | fixed, both themes                     |

Five rules keep this honest:

- **Never use a field token on a surface.** Red on a surface is `--accent-fill`, not `--accent`; in machine,
  amber on a light window must be `--warn-fill`, because `#f1c40f` is illegible there.
- **A stamp brings its own ground and ink with it.** Never colour text inside a stamp with `--ink*` or
  `--text*`; use `--stamp-ink`, `--stamp-dim`, `--stamp-faint`.
- **A control is never a stamp, even sitting inside stamped furniture.** Content — labels, values, agent
  output — is a stamp; a button is something the operator does, and it must never share a colour with
  something the operator only reads, or nothing on screen tells you what's clickable. A control takes the ink
  token of the level it acts _on_: `--text` for a control sitting on the field, `--ink` for one sitting on a
  surface. `.w-btn` is the canonical example (§5.1).
- **Void tokens are declared once, at `:root`, and never redefined under `[data-theme="machine"]`.** That
  omission _is_ the mechanism — anything reading `--void*` gets the same value under either theme because
  there is no second definition to override it.
- **Status colour is looked up, not hard-coded.** `--light-ok`, `--light-warn`, `--light-accent` and
  `--light-idle` are declared on `:root`, re-pointed on `.window-frame`/`.panel`/`.prompt-bar`, re-pointed
  again on `.window-tab`/`.ctl-values` for void's own idle colour, and pointed back to the field's on every
  stamp. One `StatusLight` component is therefore correct on every ground.

---

## 3. Activity — the one status vocabulary

Projects, sessions, capabilities and signals are all "an activity", and all use the same five values and the
same round light.

| Activity    | Light             | Means                                     |
| ----------- | ----------------- | ----------------------------------------- |
| `idle`      | unlit ring        | nothing happening — no light is the point |
| `working`   | pulsing green     | a turn is in flight                       |
| `done`      | steady green      | finished, result unread                   |
| `waiting`   | steady amber      | blocked on config, auth or a queue        |
| `attention` | pulsing red, fast | needs the operator to intervene           |

The round light is the **only circle in the interface** and the only thing that animates on its own. Pulse
rhythm carries urgency: 1.2s for work in progress, 0.7s for intervention. Colour is never the sole carrier —
every light sits beside a word.

Rank order for anything that sorts by status: `attention → waiting → working → done → idle`.

---

## 4. The overseer space

The centre region. Not a log and not a transcript: a **derived, ranked answer** to what deserves attention.

- **Headline** — one uppercase word for the whole system (`ATTENTION`, `BLOCKED`, `WORKING`, `READY`,
  `IDLE`), taken from the most urgent signal so headline and list can never disagree. Beneath it, a rule that
  widens 30→150px while a turn is in flight, and a `▲` in `--accent`. This replaces every spinner in the app.
- **Signals** — `[light] KICKER  sentence.` rows, most urgent first. The kicker is the category (`APPROVAL`,
  `ADAPTER`, `CAPABILITY`, `SESSION`, `USAGE`, `PROJECT`); the sentence is plain sentence-case prose saying
  what happened and what it means.
- **Every signal is clickable and opens the thing it is talking about** — a window, the settings panel, the
  project panel, the prompt. A signal the operator cannot act on is noise and does not belong here.
- Signals are **derived on every render**, never stored, so they cannot go stale.
- When nothing is wrong and nothing is running, exactly one `idle` signal remains: standby.

Semantics live in `state/signals.ts`. New system state earns a new derivation rule there, not a new widget.

---

## 5. Windows

**The summonable primitive**, and a _surface_ — it inverts the theme. Opened by a signal click, a typed
command, or a system escalation.

- `position: absolute`, spawned at an assigned position, clamped on spawn and while dragging so no part can
  leave the viewport.
- The **frame width is the contract**: it comes from `WINDOW_SPEC`, and content never sets its own width.
  Long paths ellipsise, preformatted blocks wrap (`pre-wrap` + `overflow-wrap: anywhere`). **Windows scroll
  vertically only** — a window that scrolls sideways has failed to lay out.
- **Borders on the horizontal edges only** — `border-width: 2px 0.5px`, left/right transparent. This is what
  keeps them from reading as cards.
- The **tab is a flow child of the window box**, sitting on top of the frame: `--void`, not a stamp, because
  it is the machine's own label for the window rather than anything the window contains — a fixed near-black
  in both themes, red `▽` glyph, `///` separator, the label, then a **close ✕**. Because it is in flow, its
  left edge _is_ the frame's left edge; there is no offset left to drift. It wipes in via `clip-path`.
- The tab is the drag handle. Body content is `.no-drag` so lists and text stay usable.
- Dismissed by the ✕, or `Esc` for the topmost surface.
- **Multiple windows coexist and may overlap.** They are not modal and never block the prompt.

### 5.1 Windows carry controls

Anything needing structured input — resolving an approval, attaching context, adding an MCP server — is a
window with real buttons. **A button is not a stamp**, on purpose: a stamp is content, a button is a control,
and the two must never share a colour, or nothing on screen tells the operator what's clickable. `.w-btn` is
cut out of the surface instead — transparent, bordered and inked in `--ink`, the surface's own foreground —
and inverts solid on hover, the one moment it does resemble a stamp. Destructive actions take `--accent-fill`,
not `--accent`, because the button lives on a surface.

### 5.2 Content primitives

| Primitive  | Level     | Use                                                               |
| ---------- | --------- | ----------------------------------------------------------------- |
| `w-title`  | stamp     | section heading inside a surface                                  |
| `w-data`   | stamp     | an inline reference tag — an approval's ref number, not a value   |
| `w-btn`    | _control_ | the button — `--ink`, not `--stamp-ink`; `.danger`, `.w-btn-mark` |
| `w-inline` | surface   | label left, value right, one rule-free row                        |
| `w-pre`    | surface   | preformatted block that wraps; diffs, commands, paths             |
| `w-row`    | surface   | list row: light, primary, secondary, right value, actions         |
| `w-editor` | _input_   | a prose field — a skill's instructions, an agent's brief          |
| `w-note`   | surface   | one dim line explaining the control beneath it                    |

**`w-inline`'s value slot is always plain surface text — never `w-data`.** A `WInline` row is a label paired
with its value; both halves describe the same fact, so wrapping only the value in a stamp chip makes two
`WInline` rows sitting next to each other look like they belong to different systems, for no reason a reader
can find. `w-data` exists for the other case: a short reference tag sitting inline among unrelated content —
an approval's `0417` beside its tool name and session — where a chip earns its keep by making the tag findable
at a glance. If a value is just answering its own label, leave it as text.

`w-editor` is the one content primitive that is an **input**, so it takes the input ground (§7.1) rather than
the surface's. Editing a skill or a subagent is mostly editing prose — the instructions _are_ the capability —
so that field gets the room, and it should feel like the composer, because it is the same act.

### 5.3 The console

A raw terminal into the adapter's CLI, opened from the adapter widget's `OPEN CONSOLE` (only when signed in) or by typing `console`.
Everything else in Overseer is a considered view of what the agent is doing; the console is the standing
admission that no set of views covers everything, and that an operator who knows the CLI should never be
walled off from it. Its slash commands, its output and its errors appear verbatim.

It is the **one place output is a terminal rather than a transcript, and so the one place §7.1's
input-dark/output-light split does not apply.** A terminal is a single continuous stream on a single ground —
scrollback where your commands and their results are interleaved and equally addressable. Splitting it into
alternating dark input rows and light output rows would destroy exactly the thing that makes it legible as a
terminal. Instead the whole stream sits on one stamp, and authorship is carried the way a terminal has always
carried it:

|                 | Treatment                                      |
| --------------- | ---------------------------------------------- |
| what you sent   | a `--ok` `$` sigil, text at full `--stamp-ink` |
| what it printed | no sigil, text at `--stamp-dim`                |
| stderr          | text in `--accent`                             |

The input line below the stream is a separate bordered row rather than the last line of the scrollback, so
there is always somewhere to type even when the stream is scrolled up. `--ok` marks the sigil and the focused
input's border — green is the console's colour throughout, including the word `CONSOLE` in the footer, and it
is the only place green appears outside a status light.

---

## 6. Permanent furniture

Furniture is never summoned and never dismissed, but its **level still follows what it is**, not where it
sits, and one piece can cross levels as its state changes. The active project, the clock and the widget are
pure readouts — they stay on the **field** and follow the theme. The project panel and the prompt controls
both split: what you _read_ — the panel's collapsed header, a control's closed row — stays on the field, the
same as the clock; what you _act on_ only exists once you open it, and it is a **stamp** for a control's
options or a **surface** for the project list, depending on how much room the choice needs. Each piece owns
its corner.

1. **ProjectPanel** (top-left) — _persistent and open by default._ A status panel before it is a selector: the
   lights on these rows are how the operator sees work happening in projects that are **not** active. Each row
   is a light, a name, a branch, and a note saying why the light is lit; the active row is marked with an
   accent bar in `--accent-fill`, since the list is a surface. **Selecting a project never closes the panel —
   only the chevron in its header does.** The list scrolls vertically at 44vh. Future selectable scopes
   (sessions, worktrees) belong in this same panel, not in a new corner.
2. **ActiveProject** (top-centre) — kicker, light, name, branch · dirty state. Every session, approval
   and tool call runs against it, so it is stated plainly and never hidden behind a menu. The workspace
   path is implied (projects live under the workspace root) and is not shown. Unset, the name reads
   `NONE` in `--accent`. When git cannot answer, the meta line says so rather than inventing `clean`.
3. **Clock** (top-right) — `HH:MM:SS` tabular plus the date, and the gear that opens settings. The gear
   is unboxed and drawn larger than the other glyphs: the clock beside it has no frame either, so a
   border would make the gear the only boxed thing in that corner. A glyph big enough to hit does not
   need one. `.icon-btn` — the boxed variant — stays for small glyphs that do, like the panel's ✕.
4. **PromptControls** (bottom-left) — an **accordion**, joined by a bracket rule: `1 MODEL`, `2 MODE`,
   `3 AGENT`, `4 CONTEXT`. Closed, the rows are a menu on the **field**, blending with the background the same
   as the clock. Opening one drops its values on **`--void`** beneath it — this is the machine's own menu, not
   a value the session produced, the same reasoning that keeps a window's tab off the stamp scale — current
   value marked `▪`; picking a value closes the section. One section open at a time. The block is
   bottom-anchored, so it grows upward. Values that arm something dangerous (`bypass`) render in `--accent`.
   Row 4 has no values — context needs more than a value, so it summons a window. These rows control **the
   next prompt**; this is the prompt's control surface, not navigation.
5. **AdapterWidget** (bottom-right) — see §6.2. When signed in, `OPEN CONSOLE` with CONSOLE in `--ok` sits under it.
6. **Footer** — one line under the prompt: product, version, and `ask for HELP` with HELP in `--accent`.

### 6.1 Panels

A **panel** is edge-anchored, single, not draggable, not summonable into the field, and — unlike other
furniture — a _surface_, because you act in it. Settings is the only one today. It slides in from the right
off the gear, carries a **2px border on the edge it slides from**, and closes on `Esc`, its ✕, or the gear.

Rule of thumb: _the work_ gets windows, _the machine_ gets panels.

### 6.2 Widgets

A **widget is not a window** and must never be mistaken for one:

|           | Window                                  | Widget                                        |
| --------- | --------------------------------------- | --------------------------------------------- |
| level     | surface — inverts the theme             | field — follows the theme                     |
| frame     | 2px top/bottom edges, transparent sides | **corner brackets only**, drawn from `--edge` |
| ground    | `--fill`                                | `--raise`, a faint lift over the vignette     |
| header    | a tab that overhangs the top-left       | an inline kicker inside the frame             |
| behaviour | summoned, draggable, dismissible        | permanent, fixed, readout-only                |

The brackets are eight background gradients keyed off `--edge`, so hover re-points `--edge` to `--accent` and
lights the whole frame at once. A widget "sits on top of" the background by tint and bracket, never by a
shadow.

### 6.3 Choice groups

Where a single control persistently holds one of a small, fixed set of values — the theme, say — show every
option **inline as its own button**, rather than one button whose label describes what clicking it would do
next. `switch to machine` makes the operator compute the current state from a verb; `samaritan` / `machine`
side by side, one of them visibly current, does not.

The current option is marked with `.w-btn-mark`, a small leading `--accent-fill` glyph — the same device the
prompt controls use for a current value (§5.1's `▪`) — with the button's own chrome otherwise untouched. It is
**not** marked by filling the button: a resting button that stays solid is a stamp again, in a fresh disguise
— `--ink` fill with `--fill-solid` text lands on the same light-chip, dark-text shape as a `--stamp` title in
samaritan, so the two are indistinguishable at a glance even though the tokens differ. Fill is reserved for
`:hover`, which is momentary by definition; a persistent selection state must never reuse it. Both options
render the mark's reserved width regardless of state, so the labels line up. Use this pattern anywhere a
toggle or enum is being represented, in place of a single button whose text changes.

---

## 7. The prompt

### 7.1 Input is dark, output is light

**This is the load-bearing rule of the chat, and it decides every colour in it.** In samaritan: everything the
operator types _through_ is a dark surface; everything produced for them to _read_ is a light page, or a stamp
printed on that page. Machine inverts both halves, so the relationship — input darker than the thing it sits
on — holds either way.

|           | Input — dark                  | Output — light                                              |
| --------- | ----------------------------- | ----------------------------------------------------------- |
| collapsed | `.prompt-bar`                 | —                                                           |
| expanded  | `.composer`, `.turn-operator` | `.transcript-panel` (the page), `.turn-agent`, `.turn-tool` |

**The transcript and the composer are sibling panels, not one frame split in half.** Each carries its own 2px
horizontal edges with the field showing in the 6px gap between them. They are different materials doing
different jobs, and nesting one inside the other's frame meant every change to the container had to be
undone for whichever half it was wrong for. As siblings they are styled independently and the split is
visible rather than implied.

The transcript **page** is the one frame that stays field-level rather than inverting: this is where the
operator reads prose at length, and that reads better as a page than as a lit panel you peer into. `--page` is
the field made opaque enough to bound it.

The **input parts keep the surface's dark ground** — `--fill`/`--ink`, declared once in a shared rule rather
than per component. Collapsed, the whole prompt is input, so the bar is dark end to end. Expanded, the
transcript panel opens above it and the composer stays exactly the colour the bar was. **The collapsed bar
and the expanded composer are the same control at two sizes and must never differ in ground**; the transcript
appearing above them is the change, and is not a reason for the input to follow it.

The **tab is neither** — it stays void, the machine's own label for the session ("session · billing-service")
rather than anything the session produced or the operator typed, the same reasoning that keeps every window's
tab off the field↔surface scale entirely (§2, §5).

- **No exec button.** `Enter` sends, `Shift`+`Enter` inserts a newline.
- Expanded width is capped at `min(880px, max(520px, 100vw - 600px))` so the chat never covers the two bottom
  corners it depends on — the prompt controls to its left, the adapter widget to its right.
- **The text is not uppercased.** This is prose going to a model and should look like prose while it is being
  written. Uppercase remains for labels and chrome only.
- The composer grows with its content to 168px, then scrolls.
- Beneath it, one meta line: the armed model · mode · agent, and the send hint or `TURN IN FLIGHT`.
- Unrecognised input goes to the active project's session as a prompt; recognised verbs (`sessions`,
  `projects`, `approvals`, `settings`, `help`, `theme`, `clear`) run as commands.

### 7.2 What you did vs what the agent did

The transcript's job is to make authorship unmistakable at a glance, without bubbles or side-alignment:

Authorship is carried by §7.1's rule, not by bubbles or side-alignment: your turns are input and stay dark,
the agent's are output and stay light.

|          | Operator — input                            | Agent — output                            |
| -------- | ------------------------------------------- | ----------------------------------------- |
| ground   | `--fill`, the same dark as the composer     | a `--stamp` block on the light page       |
| text     | `--ink`                                     | `--stamp-ink`                             |
| edge     | a 2px `--accent-fill` lane rule             | a `--stamp-edge` border on all four sides |
| label    | above the prose, in `--ink-faint`           | above the prose, in `--stamp-faint`       |
| relation | identical to the composer it was typed into | identical to tool rows and chips          |

An operator turn is the composer's colour, moved up the page — literally the thing you typed, still looking
like the thing you typed it into. The lane rule rather than a four-sided border is what stops it reading as
another stamp. Tool calls are slim stamps of their own and summon a detail window on click.

**Consecutive tool calls read as one continuous block, not a stack of separate chips.** A run of `.turn-tool`
rows shares a single top and bottom border — each row after the first drops its own top border — and carries
no margin between rows; the gap that would otherwise show the page between every command only appears once,
after the run ends, given to whatever turn follows it rather than to the tool row itself. This is the
terminal-output convention: a sequence of commands and their results is one panel, however many lines it
runs, and the ground behind it should never show through the middle of it.

### 7.3 Keys

| Key                | Does                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `1`–`4`            | open a prompt control — **bare digits, only while the prompt is closed**   |
| `Ctrl`/`Cmd` + `K` | open the prompt                                                            |
| `Ctrl`/`Cmd` + `P` | collapse or expand the project panel                                       |
| `Ctrl`/`Cmd` + `,` | toggle settings                                                            |
| `Esc`              | dismiss the topmost surface: settings → top window → open control → prompt |

Once the prompt is open it owns every keystroke, including digits. The project panel is furniture and is
never in the `Esc` chain.

---

## 8. Type

- **Family:** IBM Plex Mono, fallback `ui-monospace, monospace`. One family everywhere.
- **Scale:** 34/700 headline · 19/600 active project · 17 clock · 15 project value · 14 window tab, prompt and
  transcript · 13 signals and rows · 12 controls and window content · 11 secondary · 10 kickers.
- **Case:** UPPERCASE for labels, statuses, commands, tab titles, kickers and the headline. Left alone: agent
  prose, the operator's typed input, signal sentences, code, paths and diffs.
- **Numbers:** `tabular-nums` wherever a value changes in place — clock, gauge, cost.
- **Letter-spacing:** 1.5px on kickers, 1px on labels, 0.5px on chips, none on prose.

---

## 9. Motion

Motion means the system changed state. Never decoration.

- **Pulse** — status lights only; 1.2s working, 0.7s attention.
- **Tab wipe** — `clip-path: inset(0 N% 0 0)` 100→0 over ~200ms when a window opens.
- **Body expand** — `max-height` 0→`min(420px, 52vh)`, 500ms, after the tab lands.
- **Accordion** — `max-height` over 220ms; project list over 260ms; settings panel `translateX` over 280ms.
- **Rule widen** — the headline rule 30→150px, 300ms, while a turn is in flight.
- **Blink** — 0.6s alternate on the prompt cursor, and on the headline's cursor while it types (below).
- **Headline typing** — the headline normally swaps instantly on a state change, same as everything else here.
  On roughly 1 in 7 of those changes (`useOccasionalTyping`, `chance: 0.15`) it types the new word out instead,
  ~55ms a character, with a blinking cursor while it runs. This still satisfies "motion means the system
  changed state" — it only ever fires on a real change, never on mount, never idly — the randomness only
  controls whether that change is instant or typed, so it reads as a rare tell rather than a scheduled effect.
- Transcript append is instant; auto-scroll unless the operator has scrolled up.
- Honour `prefers-reduced-motion`: drop pulse, blink, wipe, slide and the headline typing pass — every motion
  in this list collapses to an instant state change, never to nothing.

---

## 10. Anti-patterns

- **A horizontal scrollbar.** Anywhere. It is always a layout bug.
- **A field token on a surface**, `--ink*` or `--text*` inside a stamp, or a hard-coded status colour instead
  of a `--light-*` lookup.
- **A button coloured or _shaped_ like a stamp.** A control must never share a colour with the content next to
  it, and a persistently filled button is the same failure by a different route: `--ink`-fill-with-`--fill-solid`-text
  is a solid light-on-dark (or dark-on-light) chip, exactly the shape a `--stamp` title already owns. Fill is
  for `:hover` only — a momentary state. Mark a resting selection with a small `--accent-fill` glyph instead
  (§6.3).
- **A single button whose label is a verb describing the other state** (`switch to machine`) where the choice
  is a small fixed set. Show the options inline instead and mark the current one (§6.3).
- **A widget that looks like a window**, or a window that follows the theme instead of inverting it — the
  transcript page is the one documented exception, and only because output is light (§7.1). "Field-level" is
  not a fallback for when a surface looks wrong.
- **An input that isn't darker than what it sits on**, or output that isn't lighter. The collapsed prompt bar,
  the composer and an operator's echoed turn are one material and must stay identical; the transcript page and
  the agent's stamps are another. Deciding either one component at a time is how the rule gets lost (§7.1).
- **A void element redefined under `[data-theme="machine"]`.** The absence of a machine override is what keeps
  a window's tab and an opened prompt control's options fixed; adding one silently turns void back into a
  stamp.
- **A run of tool-call rows with a visible gap between them.** Terminal output is one panel regardless of how
  many lines it runs; a gap in the middle is the surface showing through, not a deliberate break (§7.2).
- Describing a level in machine's terms. Samaritan is the reference; machine is derived by inversion.
- **Content that sets its own width** inside a window. The frame owns the width.
- A control that closes the panel it lives in as a side effect of being used.
- Cards — shadows, radii above 2px, four-sided borders. The round status light is the sole exception, and it
  is a light, not a shape.
- A tab, chip or label that does not align to the edge of the thing it names.
- Modals that block, and toasts. Escalations become a signal in the overseer space and change the headline.
- Spinners. The headline and its rule are the progress indicator.
- Message bubbles, side-aligned turns, avatars, emoji in chrome. Authorship is carried by stamp-vs-plain.
- A readout the operator cannot act on sitting in the overseer space.
- Renaming things. No codenames; paths, commands, errors and diffs appear verbatim.
