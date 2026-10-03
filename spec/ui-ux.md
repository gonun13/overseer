# UI/UX

**Reference:** Person of Interest TV show for inspiration on layout and interaction
model. Colour and type below are Overseer's own.

**Premise:** an operator watches agents work. The interface answers _what should I be looking at?_ before
offering controls. Everything is either **permanent furniture** or a **summoned surface**.

This is a fixed instrument frame, not a dashboard or chat shell. Startup, discovery, and recovery behavior
are specified in [behaviour/overseer.md](behaviour/overseer.md).

---

## 1. The field

Fullscreen and fixed, with no page or horizontal scrolling. The background is a soft radial vignette.
The field is **three columns**: two rails of furniture around a stage that holds windows and nothing
else. It is a harness for many agents at once, so the middle of the screen belongs to their consoles.

```
┌ left rail · 1/5 ──────┬──────────────── stage · 3/5 ────────────────┬ right rail · 1/5 ─────┐
│ ACTIVE PROJECT        │ ○ /// SHELL · API      ✕ │ ● /// CLAUDE · API  ✕ │        14:32:07  [⚙] │
│ ● BILLING-SERVICE     │ ┌──────────────────────┐ │ ┌──────────────────┐ │                       │
│ fix/refund… · dirty   │ │ $ npm test           │ │ │ > refactor the…  │ │  NOTHING. AS USUAL    │
│                       │ │                      │ │ │                  │ │        ───            │
│ ● PROJECT billing… ▴  │ └──────────────────────┘ │ └──────────────────┘ │         ▲             │
│ │● billing-service    │ ● /// CLAUDE · DOCS   ✕ │                       │ ● APPROVAL            │
│ │○ overseer           │ ┌──────────────────────┐ │                       │   2 tool calls are…   │
│ │○ docs-site          │ │ ✻ thinking…          │ │                       │                       │
│ ● SESSIONS 3 RUNNING ▴│ └──────────────────────┘ │                       │ › message billing-…   │
│ │● claude · api       │                                                 │ ┌ PROVIDER       ● ┐ │
│ │○ shell · api        │                                                 │  claude              │
│ │ sessions · billing  │                                                 │  usage ▓▓▓▓▓░ 78%    │
│ [+ NEW SESSION] [+ SH]│                                                 │ v0.5 | ask for HELP  │
└───────────────────────┴─────────────────────────────────────────────────┴──────────────────────┘
```

| Region      | Owns, top to bottom                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| left rail   | **active project** · **project panel** · **session panel** (sessions, shells) · the start buttons     |
| stage       | **windows only** — every window tiles it                                                                |
| right rail  | **clock** and the **settings** gear · **the overseer space** · **the prompt** · **provider widget** · footer |

The rails take a fifth of the width each, floored at 260px; the stage takes the rest. A hairline in
`--stamp-edge` is all that separates a rail from the stage — rails are furniture on the field, not
panels. Each rail is a column that never scrolls sideways; its lists scroll inside themselves.

While the field is still being set up — boot, the first-run name and tone asks, the goodbye — there is
nothing for the stage to hold, and **the overseer space speaks from the stage centre**. Once the session
panel is revealed it docks into the right rail and the stage is handed to windows.

Furniture appears progressively as its state becomes knowable; the prompt appears only after an
authenticated provider is attached. Below 1024px is out of scope.

---

## 2. Colour — four levels, and the inversion

**Samaritan is the default and reference theme; machine inverts it at every level.**

| Level       | What lives there                                                                                         | Samaritan (default) | Machine            |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| **field**   | ground, the overseer space, the active project, the clock, widgets, readouts, menus | light               | dark               |
| **surface** | what you act _through_ — windows, panels, the project list once it opens, and every input (§7.1)         | dark                | light              |
| **stamp**   | what gets printed — session output, headings, and reference chips                                       | a darker light      | a lighter dark     |
| **void**    | a window's own tab; an opened prompt control's option list                                               | near-black          | near-white         |

A component's level follows **what it is, not where it sits**. Readouts stay on the field; work surfaces
invert; stamps carry content; machine chrome such as window tabs and opened prompt-control options uses
void, which matches the surface's solid ground so a tab continues the frame. `--page` (an opaque field) was the
chat transcript's ground and has had no consumer since `0.5.0`.

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
- Identity triangles (message `▲`, window/panel `▽`) and selection marks
  (active project, `▪` current options) use `--mark` / `--mark-fill` — red in
  samaritan, blue in machine. Danger and attention stay on `--accent*`.
- Stamps bring `--stamp*` ground, ink, and edge tokens.
- Controls use the foreground of the level they act on; they never look like content stamps.
- Void matches `--fill-solid` / `--ink` so a tab continues its frame; machine must invert `--void*` with the surface.
- Status lights use contextual `--light-*` tokens, never hard-coded colors.

---

## 3. Activity — the one status vocabulary

Projects, consoles, sessions and signals are all "an activity", and all use the same five values and the
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

The right rail's middle (the stage centre while the field is being set up, §1): a **derived, ranked
answer** to what deserves attention.

- **Message** — one uppercase line in the operator's tone, taken from the most urgent signal and set as text
  alone. Recovery may supply a verbatim alert word. Onboarding uses the same space for questions and choices.
  Beneath it, a rule widens 30→150px while busy; a loading bar replaces the `▲` during boot.
- **Signals** — `[light] KICKER  sentence.` rows, most urgent first. The kicker is the category (`APPROVAL`,
  `CONSOLE`, `PROVIDER`, `USAGE`, `PROJECT`, `WORKSPACE`, `PERSONALITY`, or `STANDBY`);
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

- `position: absolute`, **confined to the stage** (§1) and **tiled**: every window, of every kind, takes
  a cell of one near-square grid over the stage, in the order it was opened, with a 2px gap between
  cells. The grid re-tiles whenever a window opens or closes and when the viewport resizes. A window can
  still be dragged or resized (never onto a rail); `/tile` puts everything back on the grid. A tiled
  window's height is its whole box, tab included, and the body flexes to fill it, scrolling vertically.
  Columns never go narrower than 320px: a crowded stage gets more rows instead, and cells never overlap.
  `packages/web/src/layout.ts` owns the stage bounds and the grid.
- The **frame width is the contract**: it comes from `WINDOW_SPEC`, and content never sets its own width.
  Long paths ellipsise, preformatted blocks wrap (`pre-wrap` + `overflow-wrap: anywhere`). **Windows scroll
  vertically only** — a window that scrolls sideways has failed to lay out.
- **Borders on the horizontal edges only** — `border-width: 2px 0.5px`, left/right transparent. This is what
  keeps them from reading as cards.
- The **tab is a flow child of the window box**, sitting on top of the frame and **exactly as wide as
  it**: `--void`, not a stamp, because it is the machine's own label for the window rather than anything
  the window contains — matching the frame's solid ground in both themes. Left to right: the
  `--mark-fill` `▽` glyph (a status light on a console), `///`, the **name**, `·` and the **project**
  (dim), then the window's controls and the **close ✕** pinned to the right edge. A console's name is
  the session it runs, or `shell` / `loop` / the provider before there is one; its project is the
  console's own, not the active one. Name and project ellipsise — the project first — and the tab
  never overflows; the close is always on screen. It wipes in via `clip-path`.
- Window chrome is draggable; `.no-drag`, inputs, and buttons remain interactive.
- Dismissed by the ✕, or `Esc` for the topmost surface.
- **Multiple windows coexist side by side.** They are not modal and never block the prompt.

The **status window** is summoned automatically when a service starts work — it is where trigger logs from
every service land. It shows telegraphic rows and may be dismissed without cancelling the operation. Rows are
either conditions (which rewrite themselves in place) or events (which append). Lifecycle rules live in
[behaviour/overseer.md](behaviour/overseer.md).

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

The console is where all agent work happens: the provider CLI's own TUI, a plain shell, or a dev-loop run,
in an xterm.js surface bridged over `/ws` to a PTY the server owns. Every session is a console, so there
is no separate "open console": start one from the left rail (`+ new session`, `+ shell`, or a session
row), the prompt bar (a typed prompt starts a session on it), or with `/shell`, `/loop`.

Any number can be open, in any project, tiled on the stage with every other window (§5). `/tile` (or
`tile` in the left rail) puts them back on the grid after a drag. The terminal's inset is padding on
xterm's own element, never on its host: the fit addon sizes the grid from the host's box less the
terminal element's padding, so padding the host clips the right and bottom of the CLI. `Ctrl` + `` ` ``
raises the next one and hands it the keyboard. The tab shows a status light — what the
CLI is doing — in place of the usual mark.

xterm.js matches the Overseer theme. What closing, killing, an exit, a failure and a reload do to a
console is [behaviour/consoles.md §3](behaviour/consoles.md#3-lifecycle).

While focus is in a terminal the keyboard is the CLI's: Overseer's own keys stand down, except
`Ctrl` + `` ` ``, which is how you leave.

The console is a continuous stream on the window surface (`--fill-solid`) — dark in samaritan, light in
machine — not stamp paper. Frame chrome matches other windows (horizontal edges only).

### 5.4 The decision — the one surface that blocks

Windows are never modal (§5) and escalations become signals rather than dialogs (§10). **A decision is the
single exception, and it exists only for an action that destroys something the operator cannot get
back** — today, `reset overseer`, which erases memory (§6.5 of [behaviour/overseer.md](behaviour/overseer.md)),
and taking over a loop run held elsewhere, which ends it ([behaviour/consoles.md §2](behaviour/consoles.md#2-opening--start-or-attach)).
A signal can be ignored and a window can be dismissed; neither is an acceptable way to answer
"erase everything I know".

- Built from the window's parts — tab, frame, `w-btn` answers — but the **tab is centred**, which is the tell
  that this is not a window the operator summoned.
- **Centred on the stage**, clear of the right rail: the overseer answers the decision in the message,
  so the question and its answer must be readable side by side.
- **No ✕, no drag, no `Esc`, no dismiss-on-outside-click.** It is answered by its two buttons or not at all.
- Above the settings panel in the stack, over a `--scrim` wash of the field — thin enough that the operator
  can still see what they are about to erase.
- The field behind it is `inert`, not merely covered: a scrim stops the mouse and nothing else.
- The decision states facts in plain machine copy. Personality belongs to the message, never to the terms
  (§2.3 of [behaviour/overseer.md](behaviour/overseer.md)).

### 5.5 The file view

Opened by clicking a changed file in the project window. It shows that file's diff against the last commit —
the change a commit made from that window would record, since committing there stages everything first — with
a choice group switching to the file's current contents.

- **Unified, never side-by-side.** The frame width is the contract (§5) and a horizontal scrollbar is always a
  layout bug (§10), so a two-column diff has nowhere to go. Long lines wrap on the `w-pre` contract (§5.2),
  and a wrapped continuation hangs one character in behind the `+`/`-` so the marker stays on the first
  visual row only.
- **Added and removed reuse the file-row tones** — `--ok-fill` for added, `--accent-fill` for removed, the
  same two colours the project window's rows already carry for new and gone. A green row and its green `+`
  lines are one fact, not two conventions. Hunk headers are ruled like a row boundary rather than coloured;
  blob hashes and mode lines are dimmed, present but not read first.
- **No background bands and no syntax highlighting.** A filled row is a stamp and these are content (§7.1);
  the app has one family (§8) and a highlighter would bring a second palette that answers to nothing here.
- **The mode toggle is a choice group** (§6.3): both options inline, the current one marked, no hover fill.
- **Too large to show is said, not hidden.** A diff past the cap is clipped and carries a note giving the
  number of lines shown — a surface that silently truncates is lying about what changed.
- The view is **read once, on open and on each toggle**. It does not follow the file: an agent editing
  underneath leaves it stale, and reopening is the refresh.

### 5.6 The folder view

Not every row in the project window is a file. Git reports an untracked directory as a single collapsed row
ending in a slash rather than as the files under it, and that row opens **a listing of the folder** — there is
no diff of a directory to show, and the files inside it are what the operator clicked it to see.

- **The list is what a commit made from the project window would take from that folder**, the same framing the
  file view carries. So an unchanged or ignored child is absent by design; a folder view is not a file browser.
- **Rows are the project window's rows, one level down.** Same status word on the right, same file tones for
  new / gone / touched — a file does not change colour for having been reached through a folder.
- **A folder wears the slash**, so the two kinds are told apart by the name rather than by ink, which is
  already spoken for by the file's fate. A folder whose children disagree about their status reads `mixed`
  rather than picking one of them.
- **Folders nest as deep as the tree does.** A folder row opens another listing, a file row opens the file
  view (§5.5), and each window is keyed on its own path, so walking back into a folder raises the window
  already open on it instead of stacking a second copy.
- **Read once, on open**, like the file view — and truncated past the cap with a note saying how many entries
  are shown, on the same rule.

---

## 6. Permanent furniture

Furniture is not summoned or dismissed, but it appears progressively as discovery makes each readout
meaningful. Nothing takes it away except a confirmed reset (§5.4), which removes it a piece at a time. Readouts stay on the field; opened project choices use a surface, and opened prompt-control
options use void.

1. **ActiveProject** (left rail, top) — kicker, light, name, branch · dirty state. New prompts and
   sessions target it; existing sessions retain their own project. The workspace path is implied and not
   shown. Unset, the name reads `NONE` in `--accent`. When git cannot answer, the meta line says so
   rather than inventing `clean`. Clicking the readout opens the project panel.
2. **ProjectPanel** (left rail) — appears after project discovery and opens by default. It is a status
   panel before it is a selector: its lights show work in projects that are **not** active. Each row
   is a light, a name, a branch, and a note saying why the light is lit; the active row is marked with an
   accent bar in `--mark-fill`, since the list is a surface. Long names ellipsise. **Selecting a project
   never closes the panel — only the chevron in its header does.** The list takes at most 40% of the rail
   and scrolls vertically inside it.
3. **SessionPanel** (left rail, under projects) — the project panel's two levels again: a readout header
   (`SESSIONS · 3 RUNNING`, lit by the most urgent console) with a surface list opening downward under
   it and taking the rail's remaining height. The list has two groups. **Sessions** — every agent and
   loop console the server runs, in any project, each with its light, kill (running) or dismiss
   (exited), then the active project's sessions from the CLIs' own transcripts that no console holds.
   A console that has not written its transcript yet is a session all the same. Picking a console
   brings its window back, which is how a detached one is found again; picking a dormant session
   resumes it in a new console. **Shells** — every plain shell, the same way. Selecting never closes
   the panel.
4. **Start buttons** (left rail, foot) — `+ new session` (only with a signed-in provider), `+ shell`
   and, with two or more running, `tile`. Field-level `.rail-btn`s: the rail is not a surface.
5. **Clock** (right rail, top) — `HH:MM:SS` tabular plus the date, and the gear that opens settings. The
   gear is unboxed and drawn larger than the other glyphs: the clock beside it has no frame either, so
   a border would make the gear the only boxed thing there. `.icon-btn` — the boxed variant — stays
   for small glyphs that do, like the panel's ✕.
6. **The overseer space** (right rail, middle, once docked — §1, §4) — the message at 18px and the
   signals beneath it, each signal's sentence on its own line under its light and kicker. Scrolls
   vertically if the signals outgrow the rail.
7. **Prompt** (right rail, foot) — appears only after an authenticated provider is attached (§7).
8. **ProviderWidget** (right rail, under the prompt) — see §6.2. It is a readout and the way into the
   providers window; it does not start sessions.
9. **Footer** — one line under the widget: product, version, and `ask for HELP` with HELP in `--accent`.

### 6.1 Panels

A **panel** is edge-anchored, single, fixed, and a surface. Settings is the only one today. It slides in from
the right over the right rail, carries a 2px leading border, and closes on `Esc` or its ✕.

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

One line at the foot of the right rail, on the dark input surface (`--fill`/`--ink`). It never grows into a
transcript — conversations live in consoles (§5.3).

- A leading `/` starts a command; names autocomplete from `packages/web/src/commands.ts` and open the
  corresponding surface or action.
- Anything else starts a new session in the active project with it as the opening prompt, in a new console.
- **No exec button.** `Enter` runs it.

### 7.1 Keys

| Key                | Does                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `Ctrl` + `` ` ``   | raise the next console window and focus its terminal                       |
| `Ctrl`/`Cmd` + `K` | open the prompt                                                            |
| `Ctrl`/`Cmd` + `P` | collapse or expand the project panel                                       |
| `Ctrl`/`Cmd` + `,` | toggle settings                                                            |
| `Esc`              | dismiss the topmost surface: settings → top window → prompt                |

None of these fire while a terminal has focus, except `Ctrl` + `` ` ``. The project panel is furniture and
is never in the `Esc` chain.

---

## 8. Type

- **Family:** IBM Plex Mono, fallback `ui-monospace, monospace`. One family everywhere.
- **Scale:** message 26/700 on the stage centre, 18 docked in the rail, 34 for the first-run name ask · 19/600
  active project · 17 clock · 15 project value · 14 window tab and prompt · 13 signals and rows · 12 controls and window content · 11 secondary · 10 kickers.
- **Case:** UPPERCASE for labels, statuses, command labels, tab titles, kickers and the message. Left alone: agent
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
- **Rule widen** — the message rule 30→150px, 300ms, while a turn is in flight.
- **Blink** — 0.6s alternate on prompt and typing cursors.
- **Message typing** — about 15% of real message changes type at ~55ms per character; never on mount or idle.
- **Furniture reveal** — newly knowable furniture settles into place once; it does not replay on ordinary updates.
- **Teardown** — a confirmed reset takes one piece of furniture away per delete step, controls first and the
  clock last, so the report and the field say the same thing at the same time.
- Honour `prefers-reduced-motion`; every transition becomes instant.

---

## 10. Anti-patterns

- **A horizontal scrollbar.** Anywhere. It is always a layout bug.
- Wrong-level tokens, hard-coded status colors, or a machine theme that leaves `--void*` uninverted.
- Buttons shaped like stamps or persistently filled; use a selection mark. Ordinary hover bolds — only
  danger may fill.
- A verb-labelled toggle for a small fixed choice; show all options inline (§6.3).
- A widget styled as a window, or a window that does not invert.
- Input and output that violate §7.1's contrast or material relationships.
- Describing a level in machine's terms. Samaritan is the reference; machine is derived by inversion.
- Content that sets its own width inside a window.
- A control that closes the panel it lives in as a side effect of being used.
- Card-style layout containers: shadows, large radii, and boxed chrome.
- A tab, chip or label that does not align to the edge of the thing it names.
- Modals that block, and toasts. Escalations become a signal in the overseer space and change the message.
  The decision (§5.4) is the only exception, and only for an action that cannot be undone.
- Spinners. Use the boot bar or message rule.
- Message bubbles, side-aligned turns, avatars, emoji in chrome. Authorship is carried by stamp-vs-plain.
- A readout the operator cannot act on sitting in the overseer space.
- Renaming things. No codenames; paths, commands, errors and diffs appear verbatim.
