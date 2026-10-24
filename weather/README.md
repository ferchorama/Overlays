# Vertical Weather Widget — sky-glass OBS overlay

A **portrait 1080p** weather widget for OBS Studio: **1080 px tall, 460 px wide**
(never 1920 wide). A **light** frosted-glass slab, huge temperature, animated inline-SVG
condition icon, hi/lo, and a glass stat row (wind / humidity / feels-like).

Live data comes from **[Open-Meteo](https://open-meteo.com)** — free, **no API
key**, no signup, CORS-enabled (works straight from a browser source).
One or two cities, auto-updating, fully customisable from a control panel.

The entrance animates once and the widget then **stays on screen** — there is
deliberately no exit animation (in OBS you hide the source).

Built with plain HTML + CSS + vanilla JS + GSAP, applying 15 public agent skills
(see [`SKILLS.md`](SKILLS.md)) and guarded by a DOM-level smoke test.

---

## Design

| | |
|---|---|
| **Stage** | the widget itself: `460 × 1080` portrait |
| **Surface** | bright sky glass — `rgba(216,242,255,0.88)` tint + sky surfaces at ~0.9 alpha + specular sheen + 34 px corners. The slab composites to **hsl(199,100%,79%)** by day and **hsl(225,99%,82%)** by night, and looks the same over dark or bright footage |
| **Palette** | cyan-sky by day, periwinkle by night — **no greys and no blacks**; every surface, hairline, shadow and ink carries hue (guarded by `tests/contrast.js`) |
| **Type** | Apple system stack (`-apple-system / SF Pro`), Figtree fallback for Windows |
| **Ink** | deep indigo / royal blue on the bright slab — measured 5.6:1 … 9.3:1 (see the contrast gate) |
| **Hero** | 250 px animated icon on a frosted orb, 170 px semibold temperature |
| **Stats** | glass strip, value over label, hairline between cells — **one row up to three fields, two rows beyond that** (all six fit a 3×2) |
| **Surfaces** | two *light* gradients, day and night (`is-night` class from the API's `is_day`) |

This is intentionally **not** the silver/black "today's topics" theme used by the
talking-points panel.

**OBS tip:** a browser source composites *over* your video, so `backdrop-filter`
has nothing of yours to blur — the glass is built from its own tint + sheen.
The tint is `rgba(198,232,255,0.74)`: high enough that the slab stays light
even over black video (it composites to an azure ~rgb(133,195,234)), low enough
that your footage still shows through. Lower the alpha for more video bleed,
but re-run `node tests/contrast.js` if you go below ~0.7 — the ink is tuned to
that background.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The widget. Point OBS at this. |
| `icons.js` | Animated inline-SVG weather icons + WMO mapping (29 codes, 14 groups, day/night). |
| `config.js` | **All defaults** — glass tokens, cities, units, layout, animation, data policy. |
| `script.js` | Engine: fetch → normalise → render, entrance timeline, live sync, command API. |
| `style.css` | Glass surfaces, layout, ambient icon animation, a11y tokens. |
| `admin.html` / `admin.css` / `admin.js` | Control panel: live preview, editors, 4 glass presets, export/import. |
| `server.js` | Optional zero-dep Node server: serves files, stores `config.json`, HTTP command API. |
| `tests/smoke.js` | Runs the real engine in Node with a DOM shim + mocked Open-Meteo (3 modes). |
| `vendor/gsap.min.js` | Local GSAP so the widget works offline (CDN is the fallback). |
| `.skills/` | The 15 SKILL.md documents this build applied (reference only). |

---

## Quick start

### 1. Simplest (no server)

1. OBS → **Add → Browser** → *Local file* → `index.html`.
2. Width **460**, Height **1080** (the widget maps 1:1).
   *(Dropping it on a 1920×1080 canvas also works — `contain` keeps it at 100% on the left.)*
3. It animates in on load and stays.

### 2. Recommended (live control + Stream Deck)

Both overlays share **one** server — start it once and this widget is up too:

```bash
cd ~/Documents/Overlays
node server.js            # → hub at http://localhost:8790
```

* Control panel: <http://localhost:8790/weather/admin.html>
* OBS browser source: <http://localhost:8790/weather/index.html> (460×1080)

The old per-app port (`http://localhost:8788/index.html`) is no longer opened by
default. Point your OBS source at the `/weather/` URL above, or start the hub with
`LEGACY=1` if you would rather not re-wire it.

<details>
<summary>Running this folder without the hub (standalone server)</summary>

```bash
cd weather          # from ~/Documents/Overlays
node server.js            # → http://localhost:8788 (standalone only)
```

* Control panel: <http://localhost:8788/admin.html>
* OBS browser source: <http://localhost:8788/index.html> (460×1080)

This per-app server is the only thing that still listens on the legacy `8788`.
The hub ignores that port unless you start it with `LEGACY=1`; the `/weather/`
URLs above are the default.

</details>

Edits are written to `config.json`; the running source picks them up within ~2 s
**without replaying the entrance**.

### 3. OBS browser-source settings

| Setting | Value |
|---|---|
| Width / Height | `460` × `1080` |
| Custom CSS | *(empty)* |
| Shutdown source when not visible | **off** |
| Refresh browser when scene becomes active | **off** |

Want a wider strip? Change `stage.width` (and `panel.width`) in the Layout tab —
everything else reflows, and the city cards keep splitting the full height.

---

## Cities & units

* **1 or 2 cities** — cards split the 1080 px height equally
  (2 cities → 517 px each: 76 city + 319 hero + 122 stats).
* Type a city name → geocoded automatically, or pin exact `lat`/`lon`.
* **Units**: imperial (°F, mph, in) or metric (°C, km/h, mm); wind override to
  m/s or knots; 12/24-hour clock; locale.
* Typing in a greyed-out city enables it; drag ⠿ to reorder.

### A city has two names

| Field | What it is |
|---|---|
| **Search name** | the place handed to the geocoder — this is what gets looked up |
| **City label** | the title printed in the card header, on air |

They are separate on purpose: the search name can be `Springfield` while the
title is whatever reads best on screen.

Adding a city does **not** invent a title, and **typing a search name does not
rename the card** — typing is only a lookup. The title changes in exactly one
place: when you **choose a place from the dropdown**, which sets the title to that
place's name and pins its coordinates. That is deliberate: renaming on every
keystroke put half-typed text on air (`Spr`, `Spri`, …) while the weather being
fetched still belonged to the old city.

A title you type yourself is left alone by later searches. Choosing another place
*does* rename the card again, because that is you saying "this is a different
city" — edit the title afterwards if you want something other than the place name.
A city with no title yet shows no name in the widget until a place is picked.

A city saved by an older build could carry the literal placeholder title
`New City`, which then stayed on air no matter what was typed. The panel repairs
that from the search name when it loads — the search name being the only name
the operator ever actually typed — and says so in its status line.

### Picking the right one when a name repeats

`Springfield` is a city in at least five US states, and a plain lookup answers with
whichever one the geocoder ranks first (Missouri, as it happens). So **Search name**
is a picker: type two characters and every match drops down with its **state and
country**, then click one — or move with ↑/↓ and press Enter.

Choosing a match pins that place's exact **latitude/longitude** *and* renames the
card to it. The coordinates are what actually disambiguate: the overlay skips geocoding entirely once both coordinates
are set, so two cards can even show two different cities that share a name. Editing
the search name again releases the pin, because otherwise the new name could never
take effect.

The list is debounced and a superseded request is aborted, so typing quickly does
not spray requests at the geocoder. Escape closes it, arrow keys and Enter work,
and a name with no matches says so rather than silently doing nothing.

---

## Controls

| Action | Admin button | HTTP |
|---|---|---|
| Play the entrance | **▶ Play entrance** | `/api/command?action=in` |
| Hide instantly | **Hide** | `/api/command?action=hide` |
| Re-fetch now | **↻ Refresh data** | `/api/command?action=refresh` |

Keyboard in the overlay window: `i` = in, `h` = hide, `r` = refresh.
Stream Deck / Companion: a **Web Request** against
`http://localhost:8790/weather/api/command?action=refresh` (etc.).

---

## Data: verified behaviour

**Endpoints** (checked live against the real API):
`geocoding-api.open-meteo.com/v1/search` and `api.open-meteo.com/v1/forecast`
with `current=` + `daily=` + `timezone=auto` + unit params (exact field list in
`config.js`). Confirmed response:

```json
{ "timezone": "America/New_York", "utc_offset_seconds": -14400,
  "current": { "time": "2026-09-24T13:00", "temperature_2m": 84.4,
               "relative_humidity_2m": 75, "apparent_temperature": 93.2,
               "is_day": 1, "weather_code": 1, "wind_speed_10m": 5.4,
               "cloud_cover": 25, "surface_pressure": 1012.3 },
  "daily": { "temperature_2m_max": [ ... ], "temperature_2m_min": [ ... ] } }
```

* `timezone=auto` → `current.time` is the **city's** local time (shown next to
  the city name); the footer shows when we last fetched.
* **WMO → icon/label**: all 29 documented codes mapped, day + night variants.
* **Cache**: every success is stored in `localStorage` (`data.cacheKey`), so a
  cold start paints instantly and an outage keeps the last good reading. A
  cached reading is labelled `Updated 12:25 PM (cached)` and the widget reports
  `data-state="stale"` — it never pretends cached data is live.
* **Refresh**: every `data.refreshMinutes` (10). On failure the retry backs off
  exponentially **with jitter** (60s → 120s → 240s… capped at 15 min), resets on
  success, and the panel shows `RETRYING IN <n>S`.
* **Timeouts** 9 s; a new refresh aborts anything in flight (`AbortController`),
  so stale responses cannot overwrite newer ones.
* **Fail fast** on a malformed payload (missing coords/temperature) before render.

---

## Customizing

Seven tabs: **Cities · Data · Look · Fonts · Layout · Animation · Advanced**. (The
Advanced tab keeps `presets` as its internal id — it is where the preset selector
used to live before the one-palette rule removed it.)

* **One palette, no theme switcher** — this is a one-off widget, so the colours
  are simply values in the Look tab (and `config.js`). There is no preset
  selector to keep in sync.
* **Look** — glass tint (rgba), accent colour, backdrop blur, border, radius,
  shadow, city/hero/stat colours and sizes, and all **eight icon colours** the
  animated SVG set reads (`--wx-sun`, `--wx-moon`, `--wx-cloud`,
  `--wx-cloud-dark`, `--wx-rain`, `--wx-snow`, `--wx-bolt`, `--wx-fog`).
* **Layout** — stage size (= the widget size), panel x/y/width, height mode
  (fill the 1080p height / auto), band heights, icon size, readout align, scale mode.
* **Fonts** — Google Fonts list + font-family/weight/tracking per text style,
  plus a **custom font CSS URL** field.
* **Animation** — entrance direction (default: rise from the bottom), distance,
  card duration/stagger/delay/ease, ambient icon motion, value tweening.
  The shipped entrance is deliberately unhurried: 0.4 s lead-in, 0.9 s header,
  then each card rises over 1.8 s `power3.out` staggered by 0.5 s (≈3.3 s total),
  and data refreshes count the numbers over 1.4 s.

Accessibility: labelled icon SVGs, a visually-hidden `aria-live` summary of each
update, `prefers-reduced-motion` support (entrance becomes instant, ambient loop
stops), `forced-colors` fallbacks, and `data-testid` / `data-state` hooks.


### Type sizes (measured at 460x1080, two cities)

Nominal point size is not what lands on screen — the hero is scaled to fit. These
are **computed** sizes read back from the rendered page (`tests/measure.html`):

| Text | Before | After |
|---|---|---|
| High / low (`H 65°  L 60°`) | **14.9px** | **21.5px** |
| Condition (`Overcast`) | **18.2px** | **25.8px** |
| Stat label (`Humidity`) | **13px** | **15px** |
| Footer (`Updated …`) | **14px** | **16px** |
| City local time | 17px | 20px |
| Stat value (`14 MPH`) | 34px | 36px |
| Temperature | 110px | 138px |
| Icon | 162px | 140px |

The two-height budget was rebalanced to pay for the bigger type: the stat strip
went 122px -> 106px and the city band 76px -> 72px, which is ~46px of chrome
returned to the hero. Nothing is clipped; every text node reports
`scrollWidth <= clientWidth`.

### Layout robustness (found by screenshotting the real page)

Rendered at 460x1080 with two cities, the hero needs ~470px but a card only has
~320px — the icon was cropped and the condition + high/low were invisible, and
three equal stat cells clipped a long wind value (`10 MPH ESE` showed as
`0 MPH ESE`). All three are fixed and measured:

* `Panel.fitHero()` fits the icon + temperature + condition + high/low into the
  card so it adapts to 1 or 2 cities and to any stage height. Type and icon
  scale **independently**: `--text-scale` stops at a legibility floor (0.86)
  and `--icon-scale` absorbs the rest, because a shrunken icon is fine and
  shrunken type is not. Scaling everything by one factor — the original
  approach — drove the high/low to **14.9px** and the condition to **18.2px**.
  `Panel.computeHeroScales()` is pure and unit-tested in `tests/type.js`.
* Wind direction moved into the small label (`Wind ESE`) so the big value
  stays short, and `Panel.fitStatValues()` shrinks any value that still
  overflows instead of clipping it.
* **The stat strip re-flows instead of squeezing.** Tick all six fields and six
  36px values in one 460px row painted over each other (`MPH66% 500.009EB hPa0%`).
  The strip is a grid now: one row up to three fields, two rows beyond that, with
  the type scaled (36px → 30px, label 15px → 12px) so both rows fit the fixed
  106px height. The vertical hairline is suppressed on the first cell of each row.
  `fitStatValues()` also works now — a value used to size to its own content, so
  `scrollWidth > clientWidth` was never true and nothing was ever shrunk; it is
  capped to its cell now. Measured in a real browser with all six selected:
  2 rows × 152.7px, **0 overlapping cell pairs**, 0 values or labels wider than
  their cell.
* The admin preview frame now uses the widget's own aspect ratio (a 16:9 box
  cropped the bottom of a portrait panel), and the overlay re-fits on
  `ResizeObserver` because a window resize event never fires when only the
  embedding frame changes.
* **The panel can no longer be left invisible.** GSAP's `.from()` renders its
  start state immediately, so an interrupted or throttled entrance (hidden OBS
  source, paused rAF) left a blank glass slab. `play()` now arms a safety timer
  that snaps the timeline to its finished state shortly after it should have
  ended, and logs a warning.
* A **loading state** reserves the layout: before the first fetch lands the card
  shows the temperature as `—` and the stat labels with `—` values instead of
  an empty slab.

### Saved configs are migrated, not pinned

The control panel and the overlay each keep a full copy of the config
(`localStorage` and `config.json`). If that copy came from an older build it
used to win, so a palette fix would silently revert the next time the panel
rendered — the theme appearing to "change back" on the next edit.

`config-merge.js` fixes that: while `meta.version` is unchanged your saved
settings win; when the version changes, the saved config keeps only your
**content** (cities, units, refresh policy) and the shipped build supplies the
whole **look**. The panel header tells you when this happened, e.g.
`look updated to v3.0.10 (was v3.0.0) — your cities were kept`.

Content is copied **by value and as-is**. An earlier build cloned with
`JSON.parse(JSON.stringify(o || {}))`, which turned a saved `false` (or `0`) into an
empty object — and `{}` is truthy, so a migrated switch could come back ON. Falsy
values now survive a migration unchanged.

The control panel also reads `config.json` when it opens and adopts it as the
source of truth, merged over the browser's copy with that same migration. A
fresh browser profile (or a stale `localStorage`) therefore shows the cities and
settings actually on air instead of the shipped samples, and simply opening the
panel no longer writes anything back.

### URL parameters

`?fit=contain|cover|width|none` · `?units=imperial|metric` · `?configUrl=…` ·
`?nosync=1` (screenshot mode) · `?preview=1`

---

## Caching & versions

OBS caches whatever the browser source loaded, so a changed `style.css` or
`script.js` can keep running the **old** code even after a restart. Every local
asset is therefore referenced with a version stamp:

```html
<link rel="stylesheet" href="style.css?v=3.0.1" />
<script src="script.js?v=3.0.1"></script>
```

After changing any file, raise the version everywhere at once:

```bash
node tools/bump.js          # patch  3.0.1 → 3.0.2   (the usual one)
node tools/bump.js minor    # 3.0.2 → 3.1.0
node tools/bump.js major    # 3.1.0 → 4.0.0
node tools/bump.js sync     # re-stamp with the current version, no bump
node tools/bump.js --check  # report only, change nothing
```

It updates `meta.version` in `config.js`, then rewrites `index.html` and
`admin.html` — adding a stamp to any asset that is missing one (including the
admin preview iframe) and preserving other query parameters. The control panel
header shows the version it loaded, so you can confirm OBS is not on a stale
copy.

Still seeing the old build? In OBS right-click the source → **Refresh**, or tick
**Refresh browser when scene becomes active** in the source properties.

---

## Tests

```bash
node tests/smoke.js            # happy path, 2 cities
node tests/smoke.js --fail     # API 503 with a warm cache
node tests/smoke.js --no-cache # API 503 with nothing cached
node tests/contrast.js         # WCAG contrast + palette vibe gate
node tests/admin.js            # control panel: boots, wiring, editing, save
node tests/type.js             # hero-fit maths + type legibility floor
```

The test loads the **real** `icons.js`, `config.js` and `script.js` into a small
DOM shim with a mocked Open-Meteo, then asserts what actually rendered.

| Check | Result |
|---|---|
| 20 happy-path checks (cards, temp, condition, hi/lo, stat values + labels, footer, `data-state=ready`, aria-live, API called, sun-disc fill, icon colours wired to `--wx-*`, entrance choreography, and the stat-strip layout for 1/4/6 fields) | **20/20** |
| 5 cached-failure checks (kept `80°`, `data-state=stale`, `(cached)` footer) — 3 real, 2 mode-specific | **5/5** |
| 5 no-cache failure checks (`– –`, `RETRYING IN <n>S`, `data-state=error`) — 3 real, 2 mode-specific | **5/5** |
| Contrast gate: 8 text tokens vs. the glass over black **and** white video | **8/8 AA** |
| Palette vibe gate (light, saturated, day≠night) | **4/4** |
| Admin page runtime check: boots, all bound fields resolve, rows/stop editor build, adopts `config.json` without writing, edits, save POST, numeric-input ranges, all eight icon pickers bound, hub URL hint, city picker (debounce, states, pin, keyboard), title only changes on selection | **67/67** |
| Type-size test: fit maths, legibility floor, small-print minimums, no NaN on degenerate input | **19/19** |
| `node --check` on every JS file | pass |
| Live Open-Meteo geocoding + forecast curl | 200, expected shape |
| Server smoke test (`node server.js` + curl) | pages 200, command API ok, bad action → 400 with `allowed`, bad config → 400 |

### Verifying visually

Headless Chrome never exits after `--screenshot`, so bound it with an alarm:

```bash
perl -e 'alarm 45; exec @ARGV' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir=/tmp/wxshot --window-size=460,1080 --virtual-time-budget=12000 \
  --screenshot=/tmp/wx.png "http://localhost:8790/weather/index.html"
```

For computed font sizes and clipping rather than pixels, use the measurement
harness — it loads the real overlay in a same-origin iframe and folds the results
into its own DOM for `--dump-dom`:

```bash
chrome --headless=new --virtual-time-budget=14000 --dump-dom \
  "http://localhost:8790/weather/tests/measure.html" | sed -n '/<pre id="out">/,/<\/pre>/p'
```

`--virtual-time-budget` does not drive GSAP's rAF, so it is the entrance safety
timer that makes a settled render visible.
