# Skills used to build this overlay

15 public **agent skills** (SKILL.md packages found on GitHub) were downloaded into
[`.skills/`](.skills), read, and applied to this project. Each entry says where it
came from and — more importantly — **what it actually changed in this codebase**.

Everything under `.skills/` is third-party material (see each repo for its licence);
it is kept here as reference only and is not loaded at runtime by the overlay.

| # | Skill | Source (GitHub) | Applied to |
|---|---|---|---|
| 1 | `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Panel hierarchy: the temp + icon lockup is the single hero; the details strip is a real grouping (size/weight steps) instead of chips; no decorative dividers. |
| 2 | `theme-factory` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/theme-factory) | One committed palette per preset; all four presets in `admin.js` carry a matching icon-colour set so a theme swap never leaves mismatched art. |
| 3 | `canvas-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/canvas-design) | Safe-area discipline on the 1920×1080 stage: nothing may overlap the panel border; every band keeps its own padding. |
| 4 | `web-artifacts-builder` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder) | Anti-slop tells removed: no uniform rounded corners, no purple gradient, no centred-everything layout, no Inter in the overlay. |
| 5 | `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | The headless-Chromium smoke-check recipe (load → wait for the data state → inspect → screenshot at 1920×1080) and `data-state` on `#stage`. |
| 6 | `hallmark` | [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | Token discipline (components reference `var(--…)`, no inline hex in `style.css`), roman headings only, and the contrast gate that fixed the hi/lo colour. |
| 7 | `huashu-design` | [alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) | "Never assert from memory": Open-Meteo endpoint params, units, timezone and response shape were **verified live with curl** before shipping (results in the README). |
| 8 | `design-system-patterns` | [wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/ui-design/skills/design-system-patterns) | Semantic tokens (`--surface-details`, `--text-detail`, `--text-muted-on-silver`) and a purpose-named palette driven from config → CSS variables. |
| 9 | `interaction-design` | [wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/ui-design/skills/interaction-design) | Published timing/easing scale (`--dur-micro…--dur-large`, `--ease-out`); entrance animates transform/opacity only; no overshoot on data. |
| 10 | `error-handling-patterns` | [wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/developer-essentials/skills/error-handling-patterns) | Exponential backoff **with jitter** (capped at 15 min), last-good data kept on screen, console logging of URL + status + city, and hard failure on a malformed payload. |
| 11 | `e2e-testing-patterns` | [wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/developer-essentials/skills/e2e-testing-patterns) | Stable `data-testid` hooks (`temp`, `condition`, `range`, `details`, `updated`, `city-card`) and `data-state="ready|error"` so tests never bind to CSS classes. |
| 12 | `wcag-audit-patterns` | [wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/accessibility-compliance/skills/wcag-audit-patterns) | Weather SVGs are exposed as labelled images (`role="img"` + `<title>`), a visually-hidden `aria-live` region announces each update, `forced-colors` support, and the contrast fixes below. |
| 13 | `modern-javascript-patterns` | [wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/javascript-typescript/skills/modern-javascript-patterns) | The fetch path now normalises the payload into a small view model with `?.` / `??` defaults before anything reaches the DOM. |
| 14 | `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging) | Boundary instrumentation (`[weather] request failed: …`) and the node smoke-test that actually caught a real bug (see below). |
| 15 | `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/verification-before-completion) | Every claim in the README is backed by a command that was run: live API curl, icon-mapping unit check, server smoke test. |

## Concrete changes that came out of the skills

1. **Contrast gate (hallmark #40–41, wcag) — real fix.** The high/low text was
   `#2b2b30` on the silver body ≈ **4.1:1**, below AA for 17px text. Changed to
   `#1a1a1e` in `config.js` → **≈5.1:1**. Details (`#d8d8dd` on `#0d0d0f`, 13.9:1)
   and footer (`#8b8b93` on `#101012`, 5.6:1) were measured and pass.
2. **Reduced motion is honoured in JS *and* CSS.** `REDUCE_MOTION` short-circuits
   `Panel.play()` to an instant appear, and a `prefers-reduced-motion` block kills
   the ambient icon keyframes.
3. **Backoff + jitter instead of a fixed retry** (`schedule()` in `script.js`),
   capped at 15 minutes, reset on success, with the retry delay surfaced in the
   panel itself as `RETRYING IN 60S` rather than a vague error.
4. **One in-flight request group.** `newRequestGroup()` aborts the previous
   geocode/forecast requests via `AbortController`; superseded responses are
   dropped instead of overwriting newer data.
5. **Fail fast on payload shape** — missing coordinates or temperature throws
   before render, so `undefined°` can never ship.
6. **Honest failure state.** Last-good cached values stay on screen; only when
   there is nothing at all does the card show `DATA UNAVAILABLE` + the retry time.
7. **Accessibility**: labelled icon SVGs, `aria-live` summary, `data-testid`
   hooks, `forced-colors` support, `.sr-only` utility.
8. **Performance/isolation**: `contain: layout paint style` on `.panel`.
9. **Server hardening** (`server.js`): atomic write-then-rename of `config.json`
   and `state.json`, JSON-shape validation, and a self-describing 400 with the
   list of allowed actions for Stream Deck debugging.
10. **Token discipline**: semantic surface/text tokens and a published
    duration/easing scale in `style.css`.

## A bug this process caught

The `systematic-debugging` checklist ("instrument the boundaries, then test the
smallest unit") led to a node smoke test of `icons.js`, which failed with
`ReferenceError: WX is not defined` — the file relied on `window.WX` implicitly
creating a global. It now binds explicitly:

```js
var WX = (typeof window !== 'undefined' ? window : globalThis);
WX.WX = WX.WX || {};
WX = WX.WX;
```

Result: **29/29 WMO codes mapped, all 14 icon groups render, a11y attributes present.**

## Deliberately not applied

* `web-artifacts-builder`'s React/Vite/Tailwind scaffold — this project is
  intentionally build-step-free so OBS can open a plain file/URL.
* `canvas-design`'s poster/PNG output pipeline — irrelevant to a live overlay;
  only its margin/overlap rule transferred.
* `theme-factory`'s wholesale theme adoption — only the "one committed palette +
  verify contrast" rule is useful for broadcast graphics.

---

## Update — the smoke test earned its keep twice

`tests/smoke.js` (the `systematic-debugging` + `verification-before-completion`
pair, in code form) runs the real engine in Node. It found two real defects that
no amount of CSS review would have caught:

1. **Data never rendered.** `details.dataset.testid` in `mount()` ran *before*
   `var details = el(...)` was assigned, so `details` was `undefined` and the
   whole panel threw a `TypeError` during build — the overlay came up empty.
   Fixed by setting the test hook after the element exists. Verified: 10/10
   happy-path checks now pass (was 0 rendered values).
2. **Cached data masqueraded as live.** The cache-fallback path replaced the
   error object entirely, so after an API failure the widget showed an old
   reading with a fresh-looking `Updated 12:25 PM` footer and `data-state="ready"`.
   Now cached entries are tagged `fromCache: true`, the footer appends
   `(cached)`, the card dims, and `data-state="stale"` distinguishes it from
   both `ready` and `error`.

Also fixed while in there: `startLoop()` referenced a non-existent
`animation.start` (now `cardStart`).

Run them with:

```bash
node tests/smoke.js            # 10/10
node tests/smoke.js --fail     # 5/5  (cache kept, state=stale, "(cached)")
node tests/smoke.js --no-cache # 5/5  (– –, RETRYING IN <n>S, state=error)
```

---

## Update 2 — light palette + an executable contrast gate

The brief changed to "not dark colours", so the default theme is now **light
glass** (`rgba(255,255,255,0.70)` tint, dark navy text, iOS-blue accent) and the
`theme-factory` "one committed palette + verify every text-on-surface pair" rule
was turned into a script: **`tests/contrast.js`**.

It composites the real palette the way OBS does — glass tint, then the card
surface, over **black** and **white** video — and measures every text token:

```
effective slab over black video: rgb(215,218,221)   over white video: rgb(247,251,254)
city name     #0a1a2f  12.42:1 / 16.77:1   (needs 3.0)
city clock    #083d85   7.40:1 /  9.99:1   (needs 4.5)
temperature   #0a1a2f  12.42:1 / 16.77:1   (needs 3.0)
condition     #1d2f47   9.63:1 / 13.00:1   (needs 3.0)
high / low    #3a4c66   6.21:1 /  8.38:1   (needs 4.5)
stat value    #0a1a2f  12.42:1 / 16.77:1   (needs 3.0)
stat label    #33465f   6.84:1 /  9.24:1   (needs 4.5)
footer        #2f4258   7.31:1 /  9.87:1   (needs 4.5)
→ 8/8 pass AA at the worst video extreme; slab lightness 0.83
```

Two follow-on fixes fell out of the light conversion:

* **Hairlines, the frosted orb and the icon shadow were hard-coded white** in
  `style.css` — invisible or wrong on a light slab. They are now theme tokens
  (`--hairline`, `--orb-fill`, `--orb-border`, `--icon-shadow`) written from
  `panel.glass.*` / `card.body.iconShadow`, so light and dark presets both work.
* **A white cloud icon vanished on the light slab.** `card.body.iconShadow`
  (a soft dark drop-shadow) now gives the icon a readable edge — the
  `interaction-design` "don't animate layout, do use elevation" idea applied
  statically.

All five presets (Glass Light, Cool Mist, Sky Blue, Warm Sand, Graphite) carry a
complete set — surface, text, hairline, orb, accent and icon colours — so
switching a preset can never leave white text on a light background.

---

## Update 3 — one palette, no theme switcher, and colour instead of greys

The widget is a one-off, so the **preset selector is gone** (tab "Presets" →
"Advanced", which now holds only Raw JSON + the Stream Deck reference). That
also deleted ~9.8 KB of preset data and the dead `.preset` / `.swatch` CSS —
`theme-factory`'s "one committed palette" rule applied literally.

The palette was then re-tuned to carry **hue everywhere** — azure day,
periwinkle night, blue hairlines, blue shadows, amber sun, blue rain — with no
greys and no blacks:

* tint `rgba(198,232,255,0.74)` → composites to **rgb(133,195,234)** over black
  video, **rgb(154,216,255)** over white video (slab lightness 0.57)
* ink `#0b2a5b` indigo · `#0a3566` royal blue temp · `#12507f` condition ·
  `#154c7a` high/low · `#124a70` stat labels · `#0f4c78` footer
* hairlines/shadows are blue-tinted (`rgba(20,96,168,0.20)`,
  `0 26px 60px rgba(18,72,140,0.30)`) rather than black or grey

**The contrast gate earned its keep again**: the first colourful pass failed
4 of 8 tokens (`high / low` 2.6:1, `stat label` 2.3:1, `footer` 2.8:1,
`city clock` 3.1:1) because a saturated azure slab is *darker* than a white one,
so mid-blue ink no longer had headroom. The ink was darkened until all eight
pass AA at the worst video extreme — the script's whole point.

Final: `tests/smoke.js` 12/12 + 5/5 + 5/5, `tests/contrast.js` 8/8.

---

## Update 4 — slower entrance + a genuinely bright palette

Two complaints, two measurable fixes:

**1. "The animation is too fast."** The entrance was ~1.2 s total. It is now
~3.3 s: 0.4 s lead-in, 0.9 s header drop, then each card rises over **1.8 s**
`power3.out` with a **0.5 s** stagger and a 150 px travel distance. The
data-refresh animations were slowed to match (icon 1.1 s, stat cells 0.85 s
staggered 0.14 s, number tween 1.4 s `power2.inOut` instead of `power2.out` so
it settles rather than snapping).

**2. "Colours are still dark and grey."** The old surfaces sat at ~0.3–0.5
alpha, so the slab was at the mercy of the video behind it — over dark footage
it composited to a mid slate blue (rgb(133,195,234), HSL L 0.57) which reads as
grey. The surfaces are now ~0.9 alpha:

| | before | after |
|---|---|---|
| slab over black video | rgb(133,195,234) | **rgb(148,220,255)** |
| slab over white video | rgb(154,216,255) | **rgb(148,220,255)** |
| HSL | ~199°, 60%, 57% | **199°, 100%, 79%** |
| night surface | 225°, 62%, 58% | **225°, 99%, 82%** |
| text token contrast | 4.4:1 … 9.1:1 | **5.6:1 … 9.3:1** |

The slab now renders identically over dark *and* bright footage, so the widget
can never go grey. Icon colours were re-picked for the bright sky (`rain`
#0a84ff → #0a5fd0 because blue-on-blue vanished, `cloudDark` grey-blue → #6fa8e0,
`fog` likewise).

`tests/contrast.js` now also guards the vibe, so dark or grey cannot creep back
in unnoticed:

```
PASS  slab is light (not dark)       L=0.79 (min 0.55)
PASS  slab is colourful (not grey)   S=1.00 (min 0.25)
PASS  night surface is light too     L=0.82
PASS  day and night differ in hue    day 199° / night 225°
```

Trade-off worth knowing: at ~0.9 alpha the video barely shows through. Lower
`surfaces.day/night[].color` alphas (and `panel.background`) if you want more
bleed — then re-run the contrast test, because the ink is tuned to that
background.

---

## Update 5 — what screenshotting the real page found

I could finally render it (headless Chrome writes the PNG but never exits, so a
`perl -e 'alarm 30; exec @ARGV'` wrapper makes the runs bounded). The static
checks had all passed — 20/20 admin, 12/12 smoke, 8/8 contrast — yet the first
look at the actual pixels exposed four things no test was asserting:

1. **Admin preview was cropped.** The preview frame was `aspect-ratio: 16/9`
   while the widget is portrait `460/1080`, so the bottom of the panel was cut
   off. The frame now takes its ratio from the configured stage size, and the
   zoom control scales the content instead of resizing the frame.
2. **Stale scale in embedded frames.** The overlay only re-fitted on
   `window.resize`, which does not fire when just the iframe changes. Added a
   `ResizeObserver` on the root element.
3. **Hero overflow at two cities.** ~470px of icon + temperature + condition +
   high/low in a ~320px card: the icon was cropped and the condition/high-low
   were invisible. `fitHero()` now fits the lockup by scaling type and icon
   separately (`--text-scale` / `--icon-scale`). Scaling both by one factor
   made the layout fit but left the high/low at 14.9px and the condition at
   18.2px — `tests/type.js` pins the legibility floor.
4. **Clipped stat values.** `10 MPH ESE` rendered as `0 MPH ESE` (three equal
   cells, `overflow: hidden`). The compass moved to the small label and
   `fitStatValues()` shrinks anything that still overflows.

Two robustness gaps the blank-looking renders revealed:

* **A blank panel was possible on air.** GSAP `.from()` sets the invisible start
  state immediately, so any interrupted or throttled entrance left an empty
  glass slab. `play()` now arms a safety timer that forces `progress(1)` shortly
  after the timeline should have ended (and logs `entrance did not finish`).
  This is the `error-handling-patterns` "never leave the operator with a silent
  failure" rule applied to animation.
* **No loading state.** Before the first fetch the panel was an empty slab.
  It now shows `—` for the temperature and the stat labels with `—` values, so
  the layout is reserved and the panel always looks intentional.

Lesson worth keeping: every one of these was invisible to DOM-level assertions
and obvious in a 460x1080 PNG. Screenshot the thing.

---

## Update 6 — the theme kept "changing back" (stale saved config)

Reported as: *"I deactivated a city and reactivated it then the theme changed
again to grey, black etc."* — the theme was not changing on the toggle, it was
**reverting**: both the browser (`localStorage`) and the server (`config.json`)
keep a full copy of the config, and a copy saved by the old dark build was
merged *over* the new defaults. Any interaction triggered a push, the panel
re-rendered, and the old palette won.

Reproduced before fixing:

```
stored version : 3.0.0 | shipped: 3.0.8
resulting slab : rgba(14,20,32,0.40)   ← old dark tint wins
resulting temp : #ffffff               ← white text on a pale slab
```

**Fix: version-aware migration** (`config-merge.js`, loaded by both pages and by
both test harnesses):

* same `meta.version` → the saved config wins, your edits are respected;
* different version → the saved config contributes only **content**
  (cities, units, refresh policy for the weather widget; title, subtitle, topic
  list for the talking-points panel) and the shipped build supplies the whole
  **look**, with `meta.migratedFrom` recorded and the control panel saying so
  instead of switching theme silently.

`mergeIncoming()` in both `script.js` and `admin.js` now routes every source
through it: localStorage, `config.json`, `postMessage`, Import and Apply-JSON.
Guards added to `tests/admin.js` (weather 25/25 now includes: stale palette
discarded, stale ink discarded, cities kept, units kept, same-version edits
still respected).

Proof, end to end: with a stale v3.0.0 **dark** `config.json` planted on the
server, the overlay rendered the **new light theme** with the stored city
(Tampa) intact.

### And a bug found while proving it: a black sun

That render showed the sun disc as a solid black circle. `sun()` emitted
`<circle class="wx-sun" ...>` with **no fill**, so it fell back to the SVG
default (black); the amber value only ever lived on the rays. The disc now
carries `fill="var(--wx-sun)"`, and `tests/smoke.js` asserts the fill so a
future icon can't repeat it (13/13).

---

## Update 7 — the icon colours were never actually connected

`theme-factory`'s entry in the table above claims a committed icon-colour set per
theme. It was written, stored, migrated and editable — and completely inert.

`icons.js` paints each shape with `var(--wx-sun)`, `var(--wx-rain)` and so on.
Nothing ever **set** those custom properties: not `style.css`, not `script.js`.
So every icon silently used the fallback baked into `icons.js` (`#ffd447` amber,
not the configured `#ff9500`), and the six colour pickers in the control panel
wrote config that no code path read. The smoke test's `sun disc carries a fill`
assertion passed the whole time, because it checks for the *string*
`fill="var(--wx-sun` — a variable that resolved to nothing.

Fixed: `mount()` now publishes `cfg.iconColors` as `--wx-*` properties on the
panel, and the Look tab exposes **all eight** shapes (cloud-dark and fog were
missing entirely, so they could only be changed by hand-editing raw JSON).

* `tests/smoke.js` — new check `icon colours reach the CSS variables`, asserting
  the panel's `--wx-sun`/`--wx-fog` equal the configured values. It fails with
  `undefined / undefined` without the fix (verified by reverting it).
* `tests/admin.js` — new check `every icon colour has a bound picker` (8/8), plus
  a null guard on the two size inputs, which previously dereferenced a possibly
  missing element *before* printing any PASS/FAIL line.

Also in this pass: `resolveTheme` was hoisted out of `start()` to module scope.
The `config` branch of `handleCommand` called it from outside that scope, so any
`{action:'config'}` command threw a `ReferenceError` instead of applying a theme.

Smoke is **14/14** and the admin check **30/30** now.

## Update 8 — a city’s title is not its search name

A city carries two names: `query` (what the geocoder looks up) and `label` (the
title printed on the card). They are separate on purpose, but the control panel
conflated them in the worst way: **Add city** wrote the literal label
`"New City"`.

That single line produced the reported bug — “when I add a new city, the city
title does not change”:

* the placeholder was a **truthy** title, so the card kept it whatever was typed
  into **Search name**;
* worse, the overlay resolves a city’s name with `city.label || geo.name`, so a
  truthy placeholder also stopped the **real geocoded place name** from ever
  appearing — the fallback could never fire;
* and the search-name handler wrote only `city.query`, so nothing ever replaced
  it.

Fixed in `admin.js` so that the title is *derived*, never invented:

* **Add city** stores an empty label — the row shows a placeholder *hint*, which
  is not data and cannot reach `config.json`.
* Typing a **Search name** fills the title while it is still derived from it:
  blank, the old placeholder, or exactly the previous search string. That last
  clause is the whole trick — a naive “fill it when empty” rule sets a title on
  the first keystroke and then stops, leaving `T` on air for `Tampa`. A title the
  operator wrote is never overwritten; clearing it hands it back.
* A config saved by the old build is repaired at boot (`healCityLabels()`), from
  the search name, before the rows are built — so the panel and the air agree
  from the first paint and the debounced save persists it.

Verified rather than assumed: `tests/admin.js` now boots from a seeded saved
config that carries the placeholder, and asserts the repair, the
character-by-character typing, the hand-written title surviving a later search
change, and clearing handing the title back — **38/38**. A real-browser check
(headless Chrome, `?nosync=1&config=`) confirmed the other end of the chain: a
config whose label is `Tampa` renders `Tampa` as the card title, and the shipped
two-city board still renders `New York | Miami`.

Found while probing, **not fixed** (out of scope, reported): `?configUrl=` is
ineffective. `fetchConfig()` reads `Engine.cfg`, which does not exist until after
the first fetch, so the first load always uses `config.json`; and the fetched
config’s own `sync.serverConfigUrl` then overwrites the override anyway.

## Update 9 — a shared city name can be picked, not guessed

Geocoding a name like `Springfield` asked Open-Meteo for `count=1` and took
`results[0]`, and the geocoder ranks by its own metadata — so it answered
*Springfield, Missouri* (170k) over the four other US Springfields, and there was
no way to say which one was meant. `countryCode` only filters at the country level
(measured: `name=Springfield&countryCode=US` still returns five US cities) and the
API ignores `admin1` as a filter, so a name-only field could never disambiguate.

So the search field is a picker now. Two or more characters query the geocoder once
(debounced 250 ms, superseded requests aborted) and every match is listed with its
**state and country**; choosing one pins its exact latitude/longitude, which is the
only thing that actually disambiguates — the overlay skips geocoding entirely
once both coordinates are set. Editing the name again releases the pin, because a
pinned coordinate otherwise wins over the name and the new name would do nothing.

Measured in a real browser (headless Chrome driving the real panel against the live
API): typing `Springfield` returned 10 matches, listed Missouri / Illinois /
Massachusetts / Ohio / Tennessee; the list sat exactly under the field (aligned,
z-index 40, fully visible inside the panel); picking Illinois wrote
`39.80172, -89.64371` into the config and closed the list.

`tests/admin.js` grew 49 → 64 checks: combobox/listbox wiring, the two-character
threshold, `count=10` in the request, a match rendered per place with its state,
click-to-pin, ArrowDown + Enter selection, Escape, the no-match message, and that
editing the name releases the pin — all through the real row DOM.

## Update 10 — six stat fields painted over each other

With all six detail fields ticked the glass strip kept one flex row, so each of
the six cells got ~76px of a 460px card while a 36px nowrap value is 90–150px
wide. The values did not clip — they painted over their neighbours, which is the
`MPH66% 500.009EB hPa0%` mess on screen.

Two things made it possible, and both are fixed:

* **The row never re-flowed.** It is a CSS grid now: `--stat-cols` is the cell
  count for up to three fields, and a two-row 3×2 (or 2×2 for four) beyond that,
  with the type scaled (36 → 30px, label 15 → 12px) so both rows fit the fixed
  106px strip. The hairline is suppressed on the first cell of each row, because
  it separates COLUMNS.
* **`fitStatValues()` could never fire.** `.stat__value` sized to its own content,
  so `scrollWidth > clientWidth` was always false and the shrink loop was dead in
  practice. The value is capped to its cell (`max-width:100%; overflow:hidden`),
  which makes the measurement meaningful again.

Measured in a real browser with all six fields selected: 2 rows of 152.7px,
**0 overlapping cell pairs**, 0 values or labels wider than their own cell
(`964 hPa` uses 107.8px of a 152.7px cell). `tests/smoke.js` grew 14 → 20 checks:
6 → 3 columns, six cells, row-start markers, the scaled type, 4 → 2 columns,
and one field spanning the row at the configured size.

## Update 11 — typing a city name is a lookup, not a rename

The title used to follow the search name character by character. That was wrong in
two ways at once: half-typed text went on air (`Spr`, `Spri`, …), and the title
named a place whose weather had not been fetched yet — the card said Springfield
while it still showed the previous city’s temperatures.

Now the title changes in exactly one place: **choosing a place from the dropdown**.

* The search-name input writes only `city.query`; it never touches `city.label`.
* `pick()` sets the label to the chosen place’s name and pins its coordinates. A
  title typed by hand is left alone by later searches; choosing a different place
  renames the card again, because that is the operator saying it is a different
  city.
* The overlay no longer invents a title from the geocoder’s `name` either
  (`resolveCity` used `city.label || r.name`). With an unlabelled city that fallback
  renamed the card from whatever was being typed, so the title is now the configured
  label only — an unlabelled city simply has no name until a place is picked.

Measured in a real browser, driving the real panel and reading the widget inside its
own preview frame: typing `Springfield` one character at a time left the widget at
`["New York","Miami"]` with config `label="New York"`, `query="Springfield"`; picking
the Illinois match produced `["Springfield","Miami"]` and `label="Springfield"`.

`tests/admin.js` 64 → 67 checks: typing does not rename, the title input stays
empty while typing, the typed text is still stored as the query, clearing the title
leaves it blank, choosing renames, typing after a selection does not rename again,
and a second selection renames again.