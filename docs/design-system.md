# Overseer — Design System

Extracted from [`mockup/Agent Manager.dc.html`](mockup/Agent%20Manager.dc.html). That file is the source of truth for *look*; this doc is its translation into tokens, layout, and components. The mockup's content (agent rosters, threat feeds, case files) was reference material for the visual language only — none of its naming carries over.

**Premise:** a surveillance console, not a chat app. The operator watches autonomous agents work and intervenes when the system escalates to them. Everything on screen is live data or a control. No illustrations, gradients, shadows, rounded pills, or empty-state mascots.

**Target:** a fullscreen single-page app on a desktop display. Dense, but only with things that change.

---

## 1. Themes

Two themes, both shipped, both first-class. Values are the mockup's `THEMES` map.

| Token | `machine` (dark, default) | `samaritan` (light) |
|---|---|---|
| `--bg` | `#090c0a` | `#ffffff` |
| `--panel` | `#10140e` | `#f6f6f4` |
| `--panel-alt` | `#151a12` | `#ececea` |
| `--border` | `rgba(140,210,160,0.14)` | `rgba(0,0,0,0.10)` |
| `--border-strong` | `rgba(140,210,160,0.35)` | `rgba(0,0,0,0.22)` |
| `--text` | `#dff2e6` | `#111111` |
| `--text-dim` | `#7f9a89` | `rgba(17,17,17,0.6)` |
| `--text-faint` | `#4f6356` | `rgba(17,17,17,0.38)` |
| `--accent` | `#6ee7a0` | `#d0342c` |
| `--warn` | `#e0a458` | `#a8660f` |
| `--danger` | `#e2604c` | `#7a1414` |

**Renamed:** the mockup calls the accent slot `--green`, which misleads — `samaritan` puts a red in it. Ship it as `--accent`.

`machine` is phosphor-green on near-black; `samaritan` is black-on-white with a single arterial red. These are two opposed systems, not light/dark variants of one palette. Selection is explicit via `data-theme` on `:root`, defaulting to `machine` — **do not auto-follow `prefers-color-scheme`**; the theme is a deliberate choice, exposed in the system zone.

### 1.1 Semantic mapping

| Meaning | Token |
|---|---|
| Running, nominal, allowed | `--accent` |
| Awaiting human decision | `--warn` |
| Denied, failed, destructive, `bypassPermissions` | `--danger` |
| Idle, dormant, completed | `--text-faint` |
| Structural chrome | `--border`, `--border-strong` |

Status is always **a 7px dot plus a text label** — never colour alone.

---

## 2. Type

- **Family:** IBM Plex Mono 400/500/600/700, fallback `ui-monospace, monospace`. One family across the entire app, including body copy.
- **Base:** 13px.
- **Scale:** 20/700 zone title · 15/700 row primary · 13.5 body · 13 default · 12 nav & meta · 11.5 row secondary · 10.5 column headers and micro-labels · 9.5 graph labels.
- **Letter-spacing:** 1.5px wordmark · 1px nav and micro-labels · 0.5px labels and identifiers · 0.3px row primaries. Body prose gets none.
- **Case:** every label, nav item, column header, and status is UPPERCASE. Only agent prose, user input, and code are sentence case.
- **Numbers:** `font-variant-numeric: tabular-nums` anywhere a value changes in place — clocks, costs, token counts, durations, IDs.

---

## 3. Layout

Fullscreen, fixed chrome, no page scroll. Every pane scrolls independently.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ● OVERSEER   PLAN ████████░░ 78%  $4.12  3 SESSIONS │ 2 PENDING  14:22:07  │ 48
├────────┬───────────────┬────────────────────────────────┬──────────────────┤
│ 01 …   │ session rail  │ transcript                     │ inspector        │
│ 02 …   │               │                                │                  │
│ 03 …   │               │                                │                  │
│ 04 …   │               │                                │                  │
│ 05 …   │               │                                │                  │
│        │               ├────────────────────────────────┤                  │
│ status │               │ > prompt                       │                  │
└────────┴───────────────┴────────────────────────────────┴──────────────────┘
  190px      240px                fluid                        420px
```

- **Top bar, 48px**, `--panel` over a `--border` rule. Left: pulsing status dot + wordmark. Centre-left: account usage — plan gauge, spend, live session count (§5, Gauge). Right: pending-approval count in `--warn` (clickable → approvals zone), then the clock in `--text`/600.
- **Nav rail, 190px**, `--panel`. Zones numbered `01`–`05`. Active item gets `--accent` text, 600 weight, `--panel-alt` background — no left border, no pill. Footer block at 10.5px `--text-faint` for adapter, CLI version, uptime.
- **Content region.** Zone-dependent column count. Columns are separated by 1px `--border` rules, never gaps.
- **Padding** `32px 40px` in single-pane zones; `20px 24px` inside multi-pane columns.
- **Separation is borders only.** Radius `3–4px` where a container is genuinely needed. Zero `box-shadow` anywhere in the app.
- **Rows, not cards.** Lists are flex rows with a bottom rule and fixed-width right-aligned columns.

### 3.1 Density rules

Filling the screen is not the same as filling it with chrome.

- Panels and data tables **fill their column** — no centred max-width containers.
- Agent prose inside the transcript caps at **78ch** for readability; the surrounding column still fills, and the inspector takes the reclaimed width.
- Vertical rhythm is tight: 16px row padding, 22px between timeline events, 6px between log lines.
- If a pane has nothing in it, it collapses to zero width — not to an empty state with a message.

### 3.2 Breakpoints

| Width | Layout |
|---|---|
| ≥ 1720px | All four columns as drawn. |
| 1280–1719px | Session rail collapses into a session switcher at the top of the transcript column. |
| < 1280px | Inspector becomes an overlay drawer over the transcript, dismissed with `Esc`. |

Below 1024px is out of scope. This is a desktop instrument.

### 3.3 Focus-zone discipline

One zone owns the content region. **No modals containing content** — an approval is a pane, not a dialog. The only permitted overlay is a transient confirm for destructive irreversible actions, plus the sub-1280 inspector drawer.

Keyboard-first: `1`–`5` jump to zones, `/` focuses search, `Esc` goes back or dismisses, `Enter` opens the focused row, `Ctrl+Enter` submits a prompt, `Ctrl+C` interrupts a turn. The nav labels are numbered precisely so the shortcut is already on screen.

---

## 4. Zones

| # | Zone | Layout | Contents |
|---|---|---|---|
| **01** | **CONSOLE** | 4-col | The working zone; ~90% of time is here. Session rail (live sessions, status dot, model, elapsed) · transcript (turns, tool calls, nested subagents, prompt input) · inspector (diff for the focused tool call, terminal output, todo checklist, context and budget gauges, inline approval when one arrives for *this* session). |
| **02** | **SESSIONS** | 1-col | All sessions and background agents across every project under `/work`. Roster rows: status dot, name/model, project + git branch, permission mode, cost, last active. Search top-right. Create, fork, rename, close. |
| **03** | **APPROVALS** | 2-col | Cross-session intervention queue — everything awaiting a human, aggregated. Left: queue rows, identifier at 22/700 with severity dot beneath. Right: the actual tool call, diff or command, with allow-once / allow-always / deny / deny-with-feedback. Also holds plan-mode approvals and the permission rules editor. |
| **04** | **CAPABILITIES** | 2-col | MCP servers, skills, subagents, plugins, tools. Roster rows with connection dot, transport, tool count, `⏸ PENDING APPROVAL` in `--warn`. Right pane: selected item's detail, tool inventory, and its async side-task status. |
| **05** | **SYSTEM** | 1-col | Auth state and login flow, usage and spend history, settings sources, config import/export, `doctor` output, CLI version, adapter selection, theme. |

Approvals surface **in both** zone 01 (inline, for the active session) and zone 03 (aggregated, across all sessions). That is what makes the no-modal rule survive contact with a blocking prompt: the intervention is always somewhere you already are.

Labels are functional and uppercase. No codenames, no invented vocabulary, nothing renamed inside a code block, diff, error, or path — the aesthetic is carried by the visual system, not by dressing up the nouns.

---

## 5. Components

Eleven primitives, no component library. shadcn/PrimeVue defaults fight this aesthetic more than they help.

1. **StatusDot** — 7px circle, colour by state, `pulse-dot 2s infinite` only when live.
2. **ZoneHeader** — 20/700 title, 12px `--text-dim` subtitle, optional right-aligned control.
3. **RosterRow** — dot · primary+secondary stack · fixed right-aligned columns · bottom rule.
4. **ColumnHeader** — 10.5px `--text-faint`, widths matched to RosterRow.
5. **QueueEntry** — 150px identifier block (22/700 value, severity dot + label beneath) + fluid body.
6. **Timeline** — 56px time gutter + event text, 22px bottom padding per entry.
7. **LogStream** — timestamped lines, per-line colour, 6px gap, ref-driven auto-scroll.
8. **DiffView** — `--panel-alt` ground, `--accent` additions, `--danger` deletions, `--text-faint` gutter. No syntax-highlight rainbow.
9. **PromptInput** — transparent, borderless, `--accent` sigil, inherits font, grows to 8 lines then scrolls.
10. **Gauge** — horizontal bar, `--accent` fill on `--panel-alt`, tabular readout. Crosses to `--warn` at 80% and `--danger` at 95%. Used for plan usage, context window, budget.
11. **EntityGraph** — absolutely-positioned nodes over an SVG edge layer, 1px `--border-strong` lines. 12px circles for agents, 10px rotated squares for resources, 16px `--text` node with a soft ring for the session root.

---

## 6. Motion

Restrained and diegetic. Motion means *something changed in the system* — never decoration.

- `pulse-dot` 2s ease-in-out infinite, on live status dots only.
- **Digit scramble** on identifier reveal — dots → random digits (~14 frames at 70ms) → resolved value, staggered per row. Reserved for a *new* approval entering the queue. Overusing it turns the app into a screensaver faster than anything else here.
- Log and transcript append: instant, no slide-in, auto-scroll to bottom unless the user has scrolled up.
- Zone and pane switches: instant. No transitions.
- **Scanline overlay** — `repeating-linear-gradient` 1px on / 2px off at `rgba(255,255,255,0.015)`, `pointer-events:none`, fixed, top layer. **`machine` theme only**, as the mockup gates it. `samaritan`'s severity is its clinical flatness.
- Honour `prefers-reduced-motion`: drop pulse and scramble, keep colour and layout.

---

## 7. Anti-patterns

- Avatars, message bubbles, anything that reads as consumer chat.
- Emoji in UI chrome. Agent output is passthrough — that's the agent's business.
- Toasts. Escalations live in the approvals queue with a top-bar count, not floating over the work.
- Spinners. The event stream *is* the progress indicator.
- Two accents at once, or any colour outside the token table.
- Modals containing content.
- Centred fixed-width containers on a fullscreen instrument.
- Empty states that explain themselves. A pane with nothing in it collapses.
