# Overseer — UI/UX Design

**Reference:** [samaritan-web](https://git.kaki87.net/thornhill-corp/samaritan-web) for layout and interaction
model. Colour and type below are Overseer's own.

**Premise:** an operator watches agents work. The interface answers _what should I be looking at?_ before
offering controls. Everything is either **permanent furniture** or a **summoned surface**.

This is a fixed instrument frame, not a dashboard or chat shell. Startup, discovery, and recovery behavior
are specified in [overseer-behavior.md](overseer-behavior.md).

---

## 1. The field

Fullscreen and fixed, with no page or horizontal scrolling. The background is a soft radial vignette.
The steady-state layout is:

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
│    ● CAPABILITY   sentry MCP needs authentication · tools unavailable.         │
│    ● SESSION      overseer / web shell · editing packages/web/src/App.tsx.     │
│                                          ↑ the overseer space                  │
│                                                                                │
│ │1 MODEL    opus-5    ▾                                    ┌            ┐      │
│ │2 MODE     ask       ▾                                     PROVIDER  ●        │
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
| top-centre    | **active project** — target for new prompts and sessions                       |
| top-right     | **clock** and the **settings** gear                                           |
| centre        | **the overseer space** — headline plus ranked, clickable signals              |
| bottom-left   | **prompt controls** — the numbered accordion                                  |
| bottom-centre | **the prompt** — transcript and composer as sibling panels — and the footer   |
| bottom-right  | **provider widget** — provider, auth, usage, spend                            |

Furniture appears progressively as its state becomes knowable; the prompt appears only after an authenticated
provider is attached. Widths are capped and centred. Windows stay within the viewport. Below 1024px is out of
scope.

---

## 2. Colour — four levels, and the inversion

**Samaritan is the default and reference theme; machine inverts it at every level.**

| Level       | What lives there                                                                                         | Samaritan (default) | Machine            |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| **field**   | ground, the overseer space, the active project, the clock, widgets, readouts, menus, the transcript page | light               | dark               |
| **surface** | what you act _through_ — windows, panels, the project list once it opens, and every input (§7.1)         | dark                | light              |
| **stamp**   | what gets printed — session output, headings, and reference chips                                       | a darker light      | a lighter dark     |
| **void**    | a window's own tab; an opened prompt control's option list                                               | near-black          | near-white         |

A component's level follows **what it is, not where it sits**. Readouts stay on the field; work surfaces
invert; stamps carry content; machine chrome such as window tabs and opened prompt-control options uses
void, which matches the surface's solid ground so a tab continues the frame. `--page` is an opaque field
used only by the transcript.

Machine preserves Samaritan's alphas, contrast hierarchy, and token relationships. Dark grounds may need a
wider numeric step to preserve the same perceived contrast; `:root` is the source of truth.

| Token                                                   | Level   | `samaritan`                            | `machine`                         |
| ------------------------------------------------------- | ------- | -------------------------------------- | --------------------------------- |
| `--bg`                                                  | field   | `#ffffff`                              | `#1c1c1c`                         |
| `--bg-vignette`                                         | field   | `#8f8f8f`                              | `#101010`                         |
| `--text` / `--text-dim` / `--text-faint`                | field   | dark                                   | light                             |
| `--edge`                                                | field   | `rgba(17,17,17,0.85)`                  | `rgba(243,243,243,0.85)`          |
| `--accent` · `--ok` · `--warn`                          | field   | `#d0342c` · `#1e9e57` · `#a97400`      | `#e11d1d` · `#2ecc71` · `#f1c40f` |
| `--mark`                                                | field   | `#d0342c` (identity ▲)                 | `#4a90f0`                         |
| `--mark-fill`                                           | surface | `#ff4a44` (identity ▽)                 | `#1a5bb8`                         |
| `--raise`                                               | field   | `rgba(17,17,17,0.05)`                  | `rgba(243,243,243,0.05)`          |
| `--page`                                                | field   | `rgba(255,255,255,0.97)`               | `rgba(28,28,28,0.97)`             |
| `--scrim`                                               | field   | `rgba(255,255,255,0.74)`               | `rgba(28,28,28,0.74)`             |
| `--stamp`                                               | stamp   | `#e4e4e4`                              | `#333333`                         |
| `--stamp-ink` / `--stamp-dim` / `--stamp-faint`         | stamp   | dark                                   | light                             |
| `--stamp-edge`                                          | stamp   | `rgba(17,17,17,0.2)`                   | `rgba(243,243,243,0.2)`           |
| `--fill` / `--fill-solid`                               | surface | `rgba(10,10,10,0.95)` / `#0a0a0a`       | `rgba(238,238,238,0.95)` / `#eeeeee` |
| `--ink` / `--ink-dim` / `--ink-faint` / `--ink-rule`    | surface | light                                  | dark                              |
| `--accent-fill` · `--ok-fill` · `--warn-fill`           | surface | `#ff4a44` · `#35d67f` · `#f1c40f`      | `#c0201c` · `#1a8a4c` · `#8a6100` |
| `--void` / `--void-ink` / `--void-dim` / `--void-faint` | void    | near-black, light ink                  | near-white, dark ink              |
| `--void-edge` / `--void-raise`                          | void    | light on near-black                    | dark on near-white                |

Rules:

- Field uses `--text*` and `--accent`; surfaces use `--ink*` and `--accent-fill`.
- Identity triangles (headline `▲`, window/panel `▽`) and selection marks
  (active project, `▪` current options) use `--mark` / `--mark-fill` — red in
  samaritan, blue in machine. Danger and attention stay on `--accent*`.
- Stamps bring `--stamp*` ground, ink, and edge tokens.
- Controls use the foreground of the level they act on; they never look like content stamps.
- Void matches `--fill-solid` / `--ink` so a tab continues its frame; machine must invert `--void*` with the surface.
- Status lights use contextual `--light-*` tokens, never hard-coded colors.

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

The centre region: a **derived, ranked answer** to what deserves attention.

- **Headline** — in steady state, one uppercase activity word (`ATTENTION`, `BLOCKED`, `WORKING`, `READY`,
  `IDLE`) taken from the most urgent signal. Recovery may supply a stronger alert word. Onboarding uses the
  same space for questions and choices. Beneath it, a rule widens 30→150px while busy; a loading bar replaces
  the `▲` during boot.
- **Signals** — `[light] KICKER  sentence.` rows, most urgent first. The kicker is the category (`APPROVAL`,
  `PROVIDER`, `CAPABILITY`, `SESSION`, `USAGE`, `PROJECT`, `WORKSPACE`, `PERSONALITY`, or `STANDBY`);
  the sentence states what happened and what it means.
- **Every signal is actionable** and opens the relevant window, panel, selector, prompt, or recovery action.
- Signals are derived on every render, never stored.
- When nothing is wrong and nothing is running, exactly one `idle` signal remains: standby.

Semantics live in `packages/web/src/state/signals.ts`. New system state earns a derivation rule there, not a
new widget.

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
  it is the machine's own label for the window rather than anything the window contains — matching the
  frame's solid ground in both themes, `--mark-fill` `▽` glyph (red in samaritan, blue in machine),
  `///` separator, the label, then a **close ✕**. Because it is in flow, its left edge _is_ the
  frame's left edge; there is no offset left to drift. It wipes in via `clip-path`.
- Window chrome is draggable; `.no-drag`, inputs, and buttons remain interactive.
- Dismissed by the ✕, or `Esc` for the topmost surface.
- **Multiple windows coexist and may overlap.** They are not modal and never block the prompt.

The **operations window** is summoned automatically for multi-step system work. It shows telegraphic steps
and may be dismissed without cancelling the operation. Lifecycle rules live in
[overseer-behavior.md](overseer-behavior.md).

### 5.1 Windows carry controls

Structured input belongs in a window with real buttons. `.w-btn` is transparent, bordered, inked with
`--ink`, and bolds type and border on hover — it does not fill. Destructive actions use `--accent-fill`
and still invert solid on hover.

### 5.2 Content primitives

| Primitive  | Level     | Use                                                               |
| ---------- | --------- | ----------------------------------------------------------------- |
| `w-title`  | stamp     | section heading inside a surface                                  |
| `w-data`   | stamp     | an inline reference tag — an approval's ref number, not a value   |
| `w-btn`    | _control_ | the button — `--ink`, not `--stamp-ink`; `.danger`, `.w-btn-mark` |
| `w-inline` | surface   | label left, value right, one rule-free row                        |
| `w-pre`    | surface   | preformatted block that wraps; diffs, commands, paths             |
| `w-row`    | surface   | list row: light, primary, secondary, right value, actions         |
| `w-editor` | _input_   | a prose configuration field                                       |
| `w-note`   | surface   | one dim line explaining the control beneath it                    |

`w-inline` values are plain surface text. Use `w-data` only for short references embedded among unrelated
content. `w-editor` is an input and therefore uses the input ground (§7.1).

### 5.3 The console

A raw terminal into the provider CLI, available only when signed in. Open it from the provider widget or with
`console`. Slash commands, output, and errors appear verbatim via a PTY bridged over `/ws` into an xterm.js
surface. Closing the window terminates the CLI process; the CLI exiting (`/exit`, `/quit`) closes the window.

Credentials come from the same container `CLAUDE_CONFIG_DIR` volume as Overseer login. Before spawn, Overseer
marks Claude's interactive onboarding complete (and trusts the active project) so the TUI does not re-run the
theme picker / browser login that pipe-based `claude auth login` already finished.

The console is a continuous stream on the window surface (`--fill-solid`) — dark in samaritan, light in
machine — not stamp paper and not §7.1's input/output split. Frame chrome matches other windows (horizontal
edges only).

|                 | Treatment                                      |
| --------------- | ---------------------------------------------- |
| stream          | xterm.js matching the Overseer theme           |
| process lifecycle | one PTY per browser socket; close kills child |
| auth            | shared container credentials; onboarding pre-seeded |

Native Claude commands `/exit` and `/quit` end the process; Overseer does not rewrite a bare `exit`.

### 5.4 The decision — the one surface that blocks

Windows are never modal (§5) and escalations become signals rather than dialogs (§10). **A decision is the
single exception, and it exists only for an action that destroys memory** — today, `reset overseer` (§6.5 of
[overseer-behavior.md](overseer-behavior.md)). A signal can be ignored and a window can be dismissed; neither
is an acceptable way to answer "erase everything I know".

- Built from the window's parts — tab, frame, `w-btn` answers — but the **tab is centred**, which is the tell
  that this is not a window the operator summoned.
- **Centred horizontally and placed above the headline**, never over it: the overseer answers the decision in
  the headline, so the question and its answer must be readable together.
- **No ✕, no drag, no `Esc`, no dismiss-on-outside-click.** It is answered by its two buttons or not at all.
- Above the settings panel in the stack, over a `--scrim` wash of the field — thin enough that the operator
  can still see what they are about to erase.
- The field behind it is `inert`, not merely covered: a scrim stops the mouse and nothing else.
- The decision states facts in plain machine copy. Personality belongs to the headline, never to the terms
  (§2.3 of [overseer-behavior.md](overseer-behavior.md)).

---

## 6. Permanent furniture

Furniture is not summoned or dismissed, but it appears progressively as discovery makes each readout
meaningful. Nothing takes it away except a confirmed reset (§5.4), which removes it a piece at a time. Readouts stay on the field; opened project choices use a surface, and opened prompt-control
options use void.

1. **ProjectPanel** (top-left) — appears after project discovery and opens by default. It is a status panel
   before it is a selector: its lights show work in projects that are **not** active. Each row
   is a light, a name, a branch, and a note saying why the light is lit; the active row is marked with an
   accent bar in `--mark-fill`, since the list is a surface. **Selecting a project never closes the panel —
   only the chevron in its header does.** The list scrolls vertically at 44vh. Future selectable scopes
   (sessions, worktrees) belong in this same panel, not in a new corner.
2. **ActiveProject** (top-centre) — kicker, light, name, branch · dirty state. New prompts and sessions target
   it; existing sessions retain their own project. The workspace path is implied and not shown. Unset, the name reads
   `NONE` in `--accent`. When git cannot answer, the meta line says so rather than inventing `clean`.
   Clicking the readout opens the project panel.
3. **Clock** (top-right) — `HH:MM:SS` tabular plus the date, and the gear that opens settings. The gear
   is unboxed and drawn larger than the other glyphs: the clock beside it has no frame either, so a
   border would make the gear the only boxed thing in that corner. A glyph big enough to hit does not
   need one. `.icon-btn` — the boxed variant — stays for small glyphs that do, like the panel's ✕.
4. **PromptControls** (bottom-left) — an **accordion** of four rows, joined by a bracket rule.
   **A closed row prints the value in force, not its own name** — `1 OPUS`, `2 ACCEPTEDITS`,
   `3 REVIEWER` — because the row's identity is already carried by its digit and its fixed place in
   the bar, and what the operator needs at a glance is what the next turn is armed with. The name
   survives on the button's `aria-label`, so the rows stay addressable to a screen reader. Row 4 is the
   exception: it has no selection to print, so it keeps its name and hangs its count off it
   (`4 CONTEXT · EMPTY`).

   A head never reads `—` once the provider has answered: a row the operator has not touched shows the
   default that provider is actually sitting on (`1 DEFAULT`, `2 AUTO`, `3 NONE`), because a control
   that says nothing tells the operator nothing about what the next turn will do. The head also drops a
   trailing parenthetical — the CLI's `Default (recommended)` becomes `DEFAULT` — since four heads share
   the composer's width and the annotation would crowd out the name; the menu keeps it in full.

   Closed, the rows are a menu on the **field**, blending with the background the same
   as the clock. Opening one drops its values on **`--void`** beneath it — this is the machine's own menu, not
   a value the session produced, the same reasoning that keeps a window's tab off the stamp scale — current
   value marked `▪`; picking a value closes the section. One section open at a time. The block is
   bottom-anchored, so it grows upward. Values that arm something dangerous (`bypass`) render in `--accent`.
   Row 4 has no values — context needs more than a value, so it summons a window. These rows control **the
   next prompt**; this is the prompt's control surface, not navigation.

   The values are the provider's, not ours: each entry prints the CLI's own name with its own
   description beneath it in prose case — the one thing in this bar that is not uppercased, for the
   same reason prompt text is not ([§7.1](#71-input-is-dark-output-is-light)). A row the provider has
   not answered for stays shut and reads `—`; it never shows a plausible default.

   Row 3 lists **the operator's own subagents** — the `.md` files they wrote into
   `.claude/agents/` — and never the CLI's built-in routing agents, which are Claude's internal
   machinery rather than a choice anyone made. It leads with `none`, which has to stay reachable
   after another agent is picked, and an operator who has written none still gets a row that opens
   and says so. A pick arms the *next* session — the CLI has no runtime setter for model or mode — so
   a head can read what a live session is running while something else is armed for the next.
5. **ProviderWidget** (bottom-right) — see §6.2. When signed in, `OPEN CONSOLE` with CONSOLE in `--ok` sits under it.
6. **Prompt** (bottom-centre) — appears only after an authenticated provider is attached.
7. **Footer** — one line under the prompt: product, version, and `ask for HELP` with HELP in `--accent`.

### 6.1 Panels

A **panel** is edge-anchored, single, fixed, and a surface. Settings is the only one today. It slides in from
the right, carries a 2px leading border, and closes on `Esc` or its ✕.

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

For a small fixed choice, show every option inline instead of a button describing the next state. Mark the
current option with `.w-btn-mark`, a leading `--mark-fill` glyph with reserved width. Persistent selections
never use a hover fill.

---

## 7. The prompt

### 7.1 Input is dark, output is light

In Samaritan, operator input uses a dark surface and agent output uses a light page or stamp. Machine inverts
both while preserving the contrast relationship.

|           | Input — dark                  | Output — light                                              |
| --------- | ----------------------------- | ----------------------------------------------------------- |
| collapsed | `.prompt-bar`                 | —                                                           |
| expanded  | `.composer`, `.turn-operator` | `.transcript-panel` (the page), `.turn-agent`, `.turn-tool` |

The transcript and composer are sibling panels with separate 2px horizontal edges and a 6px field gap.

The transcript uses `--page`. The collapsed prompt bar, expanded composer, and echoed operator turns share
`--fill`/`--ink`. The session tab uses void.

- **No exec button.** `Enter` sends, `Shift`+`Enter` inserts a newline.
- Expanded width is capped at `min(880px, max(520px, 100vw - 600px))` so the chat never covers the two bottom
  corners it depends on — the prompt controls to its left, the provider widget to its right.
- **The text is not uppercased.** This is prose going to a model and should look like prose while it is being
  written. Uppercase remains for labels and chrome only.
- The composer grows with its content to 168px, then scrolls.
- Beneath it, one meta line: the send hint, or `TURN IN FLIGHT`. **Not** the armed model · mode ·
  agent — the control heads directly below already print exactly that, and stating it twice makes the
  operator work out which of the two is authoritative.
- A leading `/` starts a command; names autocomplete from
  `packages/web/src/commands.ts` and open the corresponding surface or action.
  Anything else goes to the active project's session, starting one if none is active.

### 7.2 What you did vs what the agent did

Authorship is carried by §7.1's rule, not by bubbles or side-alignment: your turns are input and stay dark,
the agent's are output and stay light.

|          | Operator — input                            | Agent — output                            |
| -------- | ------------------------------------------- | ----------------------------------------- |
| ground   | `--fill`, the same dark as the composer     | a `--stamp` block on the light page       |
| text     | `--ink`                                     | `--stamp-ink`                             |
| edge     | a 2px `--accent-fill` lane rule             | a `--stamp-edge` border on all four sides |
| label    | above the prose, in `--ink-faint`           | above the prose, in `--stamp-faint`       |
| relation | identical to the composer it was typed into | identical to tool rows and chips          |

The lane rule keeps operator turns from reading as stamps. Tool calls are slim stamps that open a detail
window.

Consecutive `.turn-tool` rows form one continuous bordered block with no internal gaps.

### 7.3 Keys

| Key                | Does                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `1`–`4`            | open the matching numbered prompt control, when present and prompt closed |
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
- **Case:** UPPERCASE for labels, statuses, command labels, tab titles, kickers and the headline. Left alone: agent
  prose, the operator's typed input, signal sentences, code, paths and diffs.
- **Numbers:** `tabular-nums` wherever a value changes in place — clock, gauge, cost.
- **Letter-spacing:** 1.5px on kickers, 1px on labels, 0.5px on chips, none on prose.

---

## 9. Motion

Motion means the system changed state. Never decoration.

- **Pulse** — status lights only; 1.2s working, 0.7s attention.
- **Boot progress** — a determinate loading bar replaces the centre marker until startup settles.
- **Tab wipe** — `clip-path: inset(0 N% 0 0)` 100→0 over ~200ms when a window opens.
- **Body expand** — `max-height` 0→`min(420px, 52vh)`, 500ms, after the tab lands.
- **Accordion** — `max-height` over 220ms; project list over 260ms; settings panel `translateX` over 280ms.
- **Rule widen** — the headline rule 30→150px, 300ms, while a turn is in flight.
- **Blink** — 0.6s alternate on prompt and typing cursors.
- **Headline typing** — about 15% of real headline changes type at ~55ms per character; never on mount or idle.
- **Furniture reveal** — newly knowable furniture settles into place once; it does not replay on ordinary updates.
- **Teardown** — a confirmed reset takes one piece of furniture away per delete step, controls first and the
  clock last, so the report and the field say the same thing at the same time.
- Transcript append is instant; auto-scroll unless the operator has scrolled up.
- Honour `prefers-reduced-motion`; every transition becomes instant.

---

## 10. Anti-patterns

- **A horizontal scrollbar.** Anywhere. It is always a layout bug.
- Wrong-level tokens, hard-coded status colors, or a machine theme that leaves `--void*` uninverted.
- Buttons shaped like stamps or persistently filled; use a selection mark. Ordinary hover bolds — only
  danger may fill.
- A verb-labelled toggle for a small fixed choice; show all options inline (§6.3).
- A widget styled as a window, or a window that does not invert. The transcript is the documented exception.
- Input and output that violate §7.1's contrast or material relationships.
- Visible gaps inside a run of tool-call rows.
- Describing a level in machine's terms. Samaritan is the reference; machine is derived by inversion.
- Content that sets its own width inside a window.
- A control that closes the panel it lives in as a side effect of being used.
- Card-style layout containers: shadows, large radii, and boxed chrome.
- A tab, chip or label that does not align to the edge of the thing it names.
- Modals that block, and toasts. Escalations become a signal in the overseer space and change the headline.
  The decision (§5.4) is the only exception, and only for destroying memory.
- Spinners. Use the boot bar or headline rule.
- Message bubbles, side-aligned turns, avatars, emoji in chrome. Authorship is carried by stamp-vs-plain.
- A readout the operator cannot act on sitting in the overseer space.
- Renaming things. No codenames; paths, commands, errors and diffs appear verbatim.
