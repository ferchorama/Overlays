# Prediction Markets — hand-driven OBS overlay

A rebuild of the reference board at
`rollup-prediction-markets.vercel.app` as plain **HTML + CSS + JS** with **GSAP**
for every transition — plus a full control panel so the markets, odds and copy are
typed by hand instead of pulled from a feed.

---

## What it does

This board has **two sources**, chosen by a switch in the control panel:

* **Manual** (the default) — the hero market plus a ranked list of the markets you
  typed yourself.
* **Polymarket** — the top headlines of **Crypto, Economy and Finance**, ranked by
  **24-hour volume** and grouped on screen. Nothing is fetched until you press
  **Update**. See [Polymarket headlines](#polymarket-headlines-the-other-source).

Everything from here to that section describes the hand-typed layout.

* **One hero market plus a ranked list.** The biggest 7-day volume leads, the rest
  rank underneath with their probability and move. A footer carries the live dot.
* **A 7-day chart of the asset's real price.** Put a CoinGecko id in a market's
  **asset** column and the hero line plots that asset's actual 7-day price series —
  the same cached feed the Digital Assets board uses — with price labels in the
  gutter. Without an asset (or with `historyMode` set to `auto`/`flat`) it falls back
  to a synthesised probability walk, and if the topic is not about an asset at all
  the chart is withheld entirely: a rate decision has no price history, so drawing
  one would be a lie on air. `hero.showWhenNotAsset` forces it on; `hero.assetKeywords`
  controls what counts as an asset.
* **A travelling glow on the chart.** The same animation the Digital Assets board runs
  on its 7-day trend column: a short bright dash sweeps the length of the line, rests,
  then repeats, so the chart reads as live rather than as a still. It is a second path
  with the line's own geometry, so it follows every dip exactly. Toggle and colour are
  in the panel under **Hero market**; the timings are `hero.chartGlow`; and
  `prefers-reduced-motion` removes it entirely.
* **The layout adapts to the space it is given.** Content is fitted on two axes: the
  figures row shrinks so it never runs off the column, and if the block is too tall
  the topic yields a few points first, then the chart shrinks and finally steps
  aside. Nothing overflows, and the sizes always start from your configured values
  so repeated fits cannot ratchet the layout smaller.
* **Manual topic changes — never on a timer.** Moving the hero on is *always* an
  explicit act: **click any row**, the arrow keys, a Stream Deck key, or `#3` in
  the URL. There is deliberately **no auto-advance**, so
  the board never changes under the operator mid-sentence. (Rotation exists but
  ships **off**; see *Optional rotation* below.)
* **Clickable list — a row opens across the whole board.** Every row is a button:
  click it (or tab to it and press Enter) and that market takes **both columns** —
  the list steps aside, its headline, number, statistics and chart are set larger to
  fill the width, and a **← Back to list** button returns to the split view with
  that market as the hero. **Escape** is the same as Back. `list.clickToSwitch:
  false` makes the board read-only; `list.clickOpensDetail: false` restores the old
  behaviour, where a click only swapped the hero in the left column.
* **Animated with GSAP.** The entrance staggers header → hero → rows → footer, the
  probability line draws itself, and switching topic fades the hero out and staggers
  the new one in. With no GSAP available the board still appears — it just cuts
  between topics.
* **Entrance only.** There is no out animation; in OBS you hide the browser source.
  There is deliberately **no progress/loading bar**: the topic changes when you
  change it, so a bar filling on a timer would advertise an auto-advance that does
  not exist.
* **No provider, no API key, no dependencies.** Every market is typed by hand. If
  GSAP is blocked, nothing else on the board needs the network except the fonts.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The overlay itself. Point OBS at this. |
| `style.css` | Layout + themable CSS custom properties. |
| `script.js` | Config merge, market normalising/sorting, the SVG probability line, GSAP transitions, sync + control API. |
| `config.js` | **All default values** — the eight sample markets and every design token. Edit here for permanent changes. |
| `admin.html` / `admin.css` / `admin.js` | The control panel (markets editor, live preview, presets, raw JSON). |
| `config-merge.js` | Saved-config migration: a version bump keeps your markets and takes the shipped look. |
| `server.js` | Optional zero-dependency server for running this app **on its own** (port 8791). |
| `config.json` | Written automatically on every edit — the overlay polls it, so OBS follows your edits live. |
| `assets/` | The Rollup logo and the optional NYC banner band. |
| `vendor/gsap.min.js` | Local GSAP so the overlay works offline inside OBS. |
| `tests/smoke.js` | Headless engine test of the hand-typed board — see *Tests*. |
| `tests/board.js` | Headless test of the headline board + the click/keyboard regressions. |
| `tests/detail.html` | Browser harness: measures the split view vs the opened detail view in real Chrome. |
| `tests/glow.html` | Browser harness: measures the chart's travelling glow (dash geometry, loop, reduced motion). |

---

## Quick start

### 1. Recommended — the shared hub

One server runs every overlay:

```bash
cd ~/Documents/Overlays
node server.js            # → hub at http://localhost:8790
```

* **Control panel:** <http://localhost:8790/predictions/admin.html>
* **OBS browser source:** `http://localhost:8790/predictions/index.html`

On **Windows 11**, double-click `Overlays\start.bat` instead — it checks Node,
finds a free port and opens the hub. Keep the console window open; that *is* the
server.

### 2. OBS browser-source settings

| Setting | Value |
|---|---|
| Width / Height | `1920` × `1080` |
| Custom CSS | *(empty)* |
| Shutdown source when not visible | **off** |
| Refresh browser when scene becomes active | **off** |

Transparency is automatic. The overlay designs on a fixed 1920×1080 stage and scales
itself to the source size, so a 1280×720 source still lines up exactly.

### 3. Running this app on its own

```bash
cd predictions
node server.js            # → http://localhost:8791
```

* Control panel: <http://localhost:8791/admin.html>
* Overlay: `http://localhost:8791/index.html`

The Polymarket fetch is **hub-only**. `predictions/server.js` serves the board and
the panel, but the `/api/polymarket` proxy lives in `Overlays/server.js` — it needs
the hub's cache, retry and error-shaping machinery, and there is no sense in
duplicating the Gamma adapter. Running this app standalone, the board still works in
**manual** mode; **Update** reports that the proxy is not being served. Use the hub
for the headline source.

---

## The market row, column by column

The editor is labelled, because an input's placeholder disappears the moment it has
a value — which is exactly when a row is full and you most need to know what each
field is. The header sits above the list and shares **one** grid definition
(`--mk-cols`) with the rows, so a label cannot drift out of alignment with its column:

| Column | Meaning |
|---|---|
| ⠿ | drag to reorder · click to toggle the market on/off |
| **Topic** | the market question; blank means the row is not a market |
| **Asset** | CoinGecko id — drives both the 7-day price chart and the ↻ Fetch lookup |
| **Prob %** | your probability, 0–100 |
| **Volume** | volume in dollars (used for the ranking and the hero) |
| **Chg** | move in percentage points; may be negative |
| **Category** | free text, e.g. `Crypto` |
| **Ends** | closing date |
| **Live** | tick to render this market |
| ↻ | fetch live numbers for this row's asset (see below) |
| ✕ | remove the market |

---

## Fetching numbers instead of typing them

Each market row has a **↻ Fetch** button (enabled once the row has an **asset**).
One click looks up that asset and offers the genuinely external numbers:

| Field | Source | Notes |
|---|---|---|
| `change` | 7-day price change | shown in percentage points |
| `volume` | 24h dollar volume | labelled as such — no 7-day volume is published on this endpoint |

**`probability` is deliberately never fetched.** It is your editorial call and cannot
be read off a price feed; overwriting it with a 24-hour move would quietly change what
the market claims.

Fetched values appear in a review panel **before they touch the board**, showing the
current value against the proposed one, each tickable, with **Apply** and **Discard**.
That step is not ceremony: this panel autosaves into `config.json` on every edit and
the OBS source follows it within ~1.5 s, so writing a lookup straight into the config
would put a bad number on air the moment it arrived. Nothing is written until you
press Apply.

The lookup tries the hub proxy first (`/market/api/market`, already cached upstream)
and falls back to the public endpoint in `data.directUrl`, which is what makes Fetch
work when the panel is opened without a hub. Results are cached in the page for
2 minutes, so re-opening the panel for the same asset costs no request.

---

## Entering topics (the point of this overlay)

Open the control panel and use the **Content** tab. Each market row edits inline:

| Field | Meaning |
|---|---|
| **topic** | The question. Required — a blank question is not a market. |
| **probability** | 0–100, shown as the big percentage. |
| **volume** | 7-day volume in dollars. Drives the ranking and the hero. |
| **change** | Percentage-point move. Negative is allowed and colours the row red. |
| **category** | Free text, e.g. `Crypto`. |
| **ends** | A date; rendered as `Dec 31, 2026`. |
| **enabled** | Un-ticked markets are kept but never rendered. |

Buttons: **+ Add market**, per-row **delete**, and **drag ⠿ to reorder**.

**Paste list** is the fast path before a show — one market per line:

```
Will Ethereum close above $6,000 this quarter? | 68 | $4,820,000 | +4.2
Will the Fed cut rates in December? | 74 | 3.96m | -1.8
```

Only the topic is required; `%`, `$`, commas and `m`/`b` suffixes are accepted and
stripped. A question containing a comma stays intact (the parser picks the delimiter
that yields numeric fields).

**Sort** controls the order the list ranks by: `manual` (your arrangement), `volume`,
`probability`, `change` or `topic`. The hero is chosen by `hero.mode` — `volume`
(default), `first`, or a fixed `index`.

Every edit reaches the running OBS source within ~1.5 s **without replaying the
entrance**.

---

## Polymarket headlines (the other source)

Set **Source → polymarket** in the control panel and the board switches from the
hand-typed hero + list to **grouped headline sections** — one column per category,
each showing the headlines you picked. The two layouts never share the stage; a
half-built board would be worse than either one.

### Nothing moves until you press Update

There is no timer and no auto-refresh. **Update headlines** is the only thing that
fetches, which is the same rule the rest of this overlay follows: the board never
changes under the operator. The fetch runs in the **control panel**, not in the
overlay:

```
control panel ──GET──▶ hub  /predictions/api/polymarket ──▶ gamma-api.polymarket.com
      │                                                              │
      └── writes the result into config.json ◀───────────────────────┘
                              │
              overlay polls config.json (1.5 s) and renders
```

So the OBS source has **no network path to Polymarket at all**. It cannot spend
your rate limit, cannot fail on air, and cannot invent a headline by itself. If a
fetch fails, the panel reports it per category and the board keeps the headlines
it already had — a failed update never blanks a category that is live.

### Categories, the top 5, and what you show

Each category pulls its **top 5 by 24-hour volume** (`polymarket.fetched`). For
each one the panel gives you three controls:

| Control | What it does |
|---|---|
| **Tag** | which Polymarket tag the category is. Press **Load tags** and pick one, or type a tag id. |
| **Count** | how many headlines to render, 1–5. **0 hides the category entirely.** |
| **Selection** | tick which of the five are eligible. Unticked ones never appear. |

The rendered list is always in **fetched order** — by 24h volume — even if you
tick them in a different order, so the board cannot be accidentally re-sorted by
hand. An empty selection means "all of them", so the count control alone is
enough. A tick that survives an update keeps showing; a headline that drops out of
the top 5 falls away instead of breaking the board.

The stamp above the columns names the source and how stale it is
(`polymarket · updated 2m ago`).

### The tag binding is explicit, and why

Polymarket's `/events` endpoint filters by `tag_id` — a number — and those ids
cannot be known without asking. So on Update the panel resolves the configured
`tagSlug` (`crypto`, `economy`, `finance`) against the live tag list and stores
the id it found. If nothing matches, that category reports an error naming the
slug rather than silently fetching the **global** top, which would put the same
headlines in every column. The hub refuses a request with no binding for the same
reason.

`entity` decides which endpoint is used:

| `entity` | Endpoint | A row is |
|---|---|---|
| `events` (default) | `/events` | a headline question; its number comes from the busiest market inside it |
| `markets` | `/markets` | a sub-question directly |

The two endpoints document **different sort-key spellings** (`volume_24hr` vs
`volume24hr`). The hub picks the right one per entity, and `polymarket.sortKey`
overrides it if the upstream ever rejects the derived spelling. The ranking is
applied **in the hub** rather than trusted from the upstream's `order` parameter,
because "the best 5" is the one guarantee the whole feature rests on.

### What is on a headline row

| Field | Meaning |
|---|---|
| Question | the event title (or the market question when `entity: markets`) |
| **68%** | the YES price of the busiest market, as a percentage |
| `+4.2 pts` | 24-hour move, in probability **points** |
| `$4.8M 24h` | 24-hour dollar volume — labelled 24h because that is what it is |

A market that has not traded has **no** price. It prints an em dash (`—`), never
`0%`: on an odds board a fabricated zero reads as information.

### One honest caveat about verification

**The machine this was developed on cannot reach polymarket.com.** The local ISP
filter resets the TLS handshake (measured: TCP connects on 443, then the handshake
is reset, across node, curl and .NET alike), and plain `http://` is answered with a
302 to the national gambling regulator. `kalshi.com` is blocked the same way. No
live Gamma response has ever been observed from here, so nothing below claims one
was.

The adapter is therefore written to the published documentation, and the
unverifiable part has been squeezed into a single base URL:

* `Overlays/tests/polymarket.js` boots the **real hub** against a **fake Gamma
  server** in-process that implements the documented contract, and verifies the
  request the hub builds (`tag_id`, `volume_24hr`, `active`, `closed`, `limit`),
  the ranking, both `outcomePrices` encodings, nested event markets, the 400 on a
  missing tag binding, the error shapes and the cache — **49 checks**.
* Every field is read defensively: both spellings of the sort key, both encodings
  of `outcomePrices`, `volume`/`volumeNum`, `liquidity`/`liquidityNum`, and nested
  event markets. A payload that yields nothing usable is an **error**, not a
  silently empty board.
* `POLYMARKET_API_BASE` overrides the base URL — which is how the test isolates
  the network, and how the adapter can be pointed at a mirror.

**The residual risk is exactly one thing:** if Gamma's real field names differ
from the documentation, `normalisePolymarket()` in `Overlays/server.js` needs a
one-line change. Nothing else about the feature is unproven.

---

## Controls

| Action | Dashboard | HTTP |
|---|---|---|
| Play the entrance | **▶ Play entrance** | `/api/command?action=in` |
| Hide instantly | **Hide** | `/api/command?action=out` |
| **Fetch the top headlines** | **Update headlines** | — (control panel only) |
| **Show a specific market** | **click its row** | — (in-page) |
| **Next topic** | arrow keys / `→` | `/api/command?action=next` |
| **Previous topic** | arrow keys / `←` | `/api/command?action=prev` |
| Jump to a topic | `1`–`9` | `/api/command?action=show&index=2` |

The dashboard deliberately carries only **Play entrance · Hide · Export · Reset**
plus the theme switch. Next/Prev live on the overlay's own keys and on the HTTP API,
and there is **no Save button** — every edit is written automatically (debounced
500 ms), so a change can never be left unsaved by forgetting to click.

Keyboard (overlay window): `→` / `space` next · `←` previous · `1`–`9` jump · `i`
entrance · `o` hide · `Escape` back to the list. With a row focused, `Enter` or
`space` opens that market.

### The detail view — a row across the whole board

Clicking a row opens that market **full width**: the list steps aside and the hero
gets both columns. `.board` gains `is-detail`, the list goes `display: none` (it stays
in the DOM, so its highlight is intact when you come back), and the content is fitted
to the wider room — headline 52 → 74px, the big number 176 → 204px, the chart frame
64 → 99px — with the key/values pushed to the right edge, so the market occupies the
whole stage instead of the old left half. A **← Back to list** button sits at the top
right of the detail view; **Escape** does the same thing.

* **Opening is also a topic change.** Back returns to the split view with that market
  as the hero and keyboard focus on its row.
* **It is a layout change, not a redraw.** The room grows; the content does not
  restart. Opening the market that is already on screen keeps the very same chart path
  and the same running glow loop — nothing is re-rendered, so the series is never
  drawn again. Opening a *different* market renders its content once and fades the
  block in; the new line starts complete rather than crawling in across the widened
  board (a dash-draw over a width jump was the "incomplete, slowly completing" look).
* **It parks rotation.** An opened market stays on screen until you go back and open
  another one — if rotation is enabled it is stopped on open and handed back on Back,
  so a selection is never advanced out from under you.
* **`next`/`prev`/`show` keep it open**, so a Stream Deck key still steps through
  markets while one is opened; Back lands on whatever is on screen.
* **It survives a control-panel edit**, matched by topic, so re-order the list or
  recolour the board mid-show and the opened market stays put.
* **`list.clickOpensDetail: false`** restores the old behaviour, where a click only
  swapped the hero in the left column; `list.clickToSwitch: false` makes rows inert.
* **Keyboard:** `Enter`/`space` on a focused row opens it, `Escape` closes it, and the
  Back button is only in the tab order while a market is open.

The view is a class on the board, not a second rendering path: the same hero content
is simply laid out in the room the list used to take, so nothing can drift out of
sync between the two.

### The full-size transition — eight beats, one engine

Going full size is choreographed with **GSAP**, which is the same engine the board
already ships in `vendor/gsap.min.js`; nothing else was added. A second animation
library (Anime.js, Motion) would mean a second copy of an engine, a second failure
mode inside OBS and two competing tickers for one 1-second transition — the wins here
are all timelines and staggers, which is exactly what GSAP is for. The whole reveal is
**1.02 s** and runs in this order:

| t | what happens |
|---|---|
| 0.00 | the **Back button** slides in and fades up (it is the only new control) |
| 0.02 | an **accent hairline** draws itself across the widened hero (`scaleX` 0 → 1), then fades out by 0.62 — it is an arrival, never decoration on air |
| 0.06 | **eyebrow** rises in |
| 0.14 | **headline** is wiped open with `clip-path: inset(0 0 100% 0)` → `none`, so it reveals rather than slides |
| 0.20 | **chart** fades in — *revealed, not redrawn* |
| 0.24 | the **travelling glow flares** (`--glow-boost` 1 → 1.5 → 1, width 3.4 → 5.08 → 3.4px) and the **end dot pops** in |
| 0.25 | **figures row** rises |
| 0.30 | the **big number** lands with `back.out` weight (scale 0.92 → 1) |
| 0.32 | the **key/values** stagger across to the right edge |

At the same time the hero's gutter and dividing rule animate on a CSS transition
(`padding-right 64 → 0`, `border-right-color` → transparent, 420 ms), so the column
visibly *opens* instead of snapping.

**Back** reverses in one beat: the layout collapses and the ranking rows stagger back
in from the right. The accent rule and the flare are one-shot on both sides, so
nothing keeps moving after the transition except the chart's travelling glow.

Two guardrails: every stage's final value is also written by the switch safety net
(`_armSwitch`), so a throttled ticker in a hidden OBS source cannot strand the
headline clipped or the number scaled; and `prefers-reduced-motion` skips all of it —
the board still expands, it just does not move.

### Stream Deck / Companion

Add a **Web Request** action pointing at the hub:

```
http://localhost:8790/predictions/api/command?action=next
```

That is the whole integration — one key per topic if you like, using
`action=show&index=N` (index is 0-based). `action=open&index=N` opens a market full
width and `action=back` returns to the list.

### Optional rotation

`rotate.enabled` ships **false** and the control panel exposes it, but treat it as
opt-in only: the design intent is that the operator changes the topic. When enabled,
the hero advances every `rotate.ms`.

---

## Customizing

* **Content** — the markets editor, all header/footer copy, logo and banner paths,
  hero mode, row cap, which figures show, the per-market **asset** id that drives
  both the real 7-day price line and the **↻ Fetch** lookup, the asset data feed
  (proxy + public fallback), and whether the chart is drawn for non-asset topics
  (`hero.showWhenNotAsset` / `hero.assetKeywords`).
* **Look** — the palette swatches (`palette.*`), each showing its hex value beside
  it so a colour can be read without opening the picker; hero probability and topic
  sizes, row height, footer size, stage background.
* **Layout** — stage size, scale mode, safe-area insets, hero column width, gaps.
* **Animation** — timings and eases for the entrance and the topic transition.
* **Presets** — four dark editorial palettes (**Graphite** as shipped, **Terminal**,
  **Blueprint**, **Broadcast**) plus raw JSON editing.

Everything is written to `localStorage`, pushed to the live preview instantly and,
with a server running, saved to `config.json`.

### URL parameters

| Parameter | Effect |
|---|---|
| `?market=3` | Open with the 4th market as the hero (0-based) |
| `#3` | Same, and re-selectable at runtime via the hash |
| `?fit=contain\|cover\|width\|none` | Override the scale mode |
| `?configUrl=…` | Poll a different config endpoint |
| `?nosync=1` | Disable all polling (used by tests/screenshots) |
| `?preview=1` | Marks the control panel's preview iframe |

---

## How the animation is built

`script.js` builds two kinds of timeline.

**Entrance** (`buildTimeline`) — played once on load, or by an `in` command:

```js
tl.from(header,       { opacity: 0, y: -16, duration: fadeDuration, ease: 'power2.out' }, 0)
  .from(heroBody.children, { opacity: 0, y: 16, duration: fadeDuration, ease: rowEase, stagger }, 0.1)
  .from(rows,         { opacity: 0, x: 18, duration: rowDuration, ease: rowEase }, 0.2)
  .from(footer,       { opacity: 0, duration: fadeDuration }, 0.3);
```

**Topic change** (`animateHeroOut` → `animateHeroIn`) — the only way the hero moves.
It is a strict handover: fade the *outgoing* content out, swap, fade the new content in.

```js
// 1. the hero INDEX moves at once (so a stalled ticker cannot lose the command)
// 2. the outgoing elements fade out — the new ones are not built yet
tl.to(oldBits, { opacity: 0, y: -10, duration: rowDuration * 0.6, ease: 'power1.in', stagger: 0.03 })
// 3. on completion: renderHero(new), markHeroInList(new), restartProgress()
// 4. the new elements fade in
tl.from(newBits, { opacity: 0, y: 14, duration: rowDuration, ease: rowEase, stagger })
```

**Why the swap is not done up front.** Re-rendering the hero immediately and then
animating showed the new market at full opacity, faded it away with the out-tween and
brought it back — the topic *flashed, vanished and reappeared*. The content therefore
changes at the handover, not before it, so nothing is ever painted twice. Verified by
instrumenting the timelines in a real browser: the fade-out targets the outgoing text
and the new content does not exist yet when it starts.

**Why the index still moves up front.** Driving the swap from `onComplete` alone is
what made a throttled `requestAnimationFrame` (a hidden OBS browser source) leave the
topic silently unchanged. The state moves immediately; the pixels follow the
animation, with the safety net below covering a timeline that never finishes.

### Where the chart's numbers come from

| `historyMode` | Line plotted |
|---|---|
| `asset` (default) | the real 7-day price series for the market's `asset` id |
| `auto` | a synthetic probability walk seeded from the market's topic |
| `flat` | a flat line at the market's probability |
| `manual` | whatever integers you put in the market's `history` array |

`asset` mode asks the shared hub for the series:
`/market/api/market?ids=…&sparkline=1` — the Digital Assets board's own cached proxy,
so one upstream CoinGecko call serves both overlays. That matters: measured from this
machine, **10 of 12 rapid keyless CoinGecko calls returned 429**, and the assets
board's server carries a CoinPaprika fallback for exactly that reason.

Because a price series is not a percentage, the y-range is padded relatively instead
of being clamped to 0–100, and the axis prints money instead of `%`. A probability
series is still clamped and still prints `%`.

### The 7-day chart is drawn, not faded in

The chart is an inline SVG with no charting dependency, matched to the reference
board's own implementation: the y-range is padded 20% past the series' high/low so
the line reads as a shape, three gridlines mark 0 / 50 / 100% of that range with the
middle one dashed, each carries a percentage label in a 70px gutter, and the latest
point gets a hollow pulsing ring plus a solid dot.

It animates as a drawing rather than an opacity fade, because a fade says nothing
about the shape: the grid and labels arrive first, the series is then drawn on
left-to-right via a `strokeDasharray` / `strokeDashoffset` tween measured from its
own `getTotalLength()`, and the end marker lands once the line reaches it.

Two ordering details that are easy to get wrong and were caught by measuring the
rendered pixels:

* the area fill must be appended **before** the gridlines, or it paints over them
  and the axes vanish (the base line measured as the fill colour, not the line colour);
* the gridlines use `vector-effect: non-scaling-stroke`, otherwise scaling the
  viewBox to the column width antialiases a 1px rule into near-invisibility.

The draw is a tween, so a stalled ticker can strand it — and a half-drawn series is
the one animation artefact that survives in a still frame on air. `settleChartLine()`
therefore removes `stroke-dasharray` / `stroke-dashoffset` from the path directly,
after the draw window and in every safety net (topic switch, entrance, instant show).
If the tween ran, this is a no-op on a finished path; if it stalled, it is what makes
the line end complete.

### The travelling glow — the Digital Assets board's animation

Once the line is on screen a short bright dash runs along it, rests, and repeats, so
the chart reads as live rather than as a still. It is the same treatment the **Digital
Assets board** puts on its 7-day trend column, and it is built the same way: a
**second path with the line's own geometry**, drawn as one short dash and moved by a
looping `strokeDashoffset` timeline, with a `drop-shadow` bloom behind it (no SVG
`<defs>` to thread through).

```
hero.chartGlow: {
  enabled:  true,
  color:    '#7fe6ff',
  length:   150,     // the dash, viewBox units — the chart is 1000 wide, so ~15%
  width:    3.4,     // its stroke width
  duration: 3.0,     // seconds to cross the line
  rest:     2.5,     // seconds of quiet before the next pass
  opacity:  0.95,
  halo:     8        // px blur — this is the glow
}
```

Four details that matter:

* **The length comes from the geometry, not `getTotalLength()`.** In a hidden OBS
  browser source the path has no layout and `getTotalLength()` returns 0, which would
  draw a dash of the wrong size or none at all. The polyline length is summed from the
  points instead, and the same value is used by the draw-in tween.
* **The gap is `line + dash`**, so exactly one dash exists on the path — the next one
  in the pattern sits past the end of the line and is never seen.
* **It is re-armed on every chart render**, so a data refresh or a config edit cannot
  leave the loop pointing at a path that no longer exists (`armChartGlow()` kills the
  previous timeline first).
* **`prefers-reduced-motion` removes it entirely** — it is the one element that never
  stops moving, so it is the one thing an operator with motion sensitivity can switch
  off at the OS level. `hero.chartGlow.enabled: false` does the same on air, and the
  control panel exposes both the toggle and the colour under **Hero market**.


### Two failure modes this guards against

* **GSAP's `.from()` applies its invisible start state immediately.** If the entrance
  is interrupted — a throttled or paused `requestAnimationFrame` in a hidden OBS
  source, a dropped frame — every element would sit at `opacity: 0` and the board
  would stay blank on air. `_armSafety` snaps to the finished state shortly after the
  timeline should have ended and logs
  `[prediction-markets] entrance did not finish — snapping to the visible state`.
* **A stalled ticker must not be able to stop a topic change.** An earlier version
  swapped the hero text *inside* the animation's `onComplete`. A throttled
  `requestAnimationFrame` — exactly what a hidden OBS browser source does, and what
  headless Chrome does — meant `onComplete` never fired and **the topic silently
  refused to change on air**. The hero state now moves before the animation, so the
  switch is idempotent and callable from any entry point.
* **Both halves of the switch carry a safety net.** `_armSwitch` is armed for the
  fade-in *and* the fade-out, because the fade-out owns the handover: if it stalled,
  the outgoing topic would freeze on screen and the new one would never arrive. A
  single guarded callback (`once`) stops a stall plus a late completion from
  performing the handover twice. Measured in a real browser with the ticker stalled,
  the topic still switched — the net fired at ~1.4 s and settled the hero.
* **Snapping the timeline is not enough.** A stalled entrance can leave GSAP's
  `.from()` start values applied to the DOM with nothing animating them away — a
  real browser check caught the board sitting at **17% opacity** after its entrance
  (and, in the same session, the flash-and-reappear described above).
  Both safety nets now also `clearProps` the inline `opacity`/`transform` on their
  targets, so "settled" means genuinely settled.

### The figures row fits itself

Four stats beside a 176px number are wider than the hero column. `fitHeroFigures`
first tries a 2×2 stat grid, and only shrinks the number — within a floor of 110px —
if that still will not fit. It re-runs after `document.fonts.ready`, because
measuring against a fallback font picks the wrong size.

---

## Windows 11 notes

* **Launch with `Overlays\start.bat`.** It is the Windows counterpart of
  `start.command` and handles finding Node and a free port.
* **Config writes retry.** A rename over a file another process holds open fails on
  Windows with `EPERM`/`EBUSY`/`EACCES` — an antivirus scanner, or our own read
  stream still draining a previous poll. Both this app's `server.js` and the shared
  hub retry with real async delays, then fall back to writing in place; a save that
  silently does nothing on air is the worse failure.
* **No POSIX assumptions.** All paths go through `path.join`/`path.resolve`, the
  traversal guard compares against the directory boundary, and there is no `exec`,
  `chmod`, symlink or hard-coded POSIX path anywhere in the app.
* **Case-safe filenames.** No two files differ only by case, so the app also works
  on a case-insensitive volume.
* **Windows paths in config.** A logo or banner path may be an absolute Windows path
  or a full URL; it is used verbatim in a `src`/`background-image`, not resolved on
  disk.

---

## Tests

```bash
node tests/smoke.js     # the hand-typed board
node tests/board.js     # the headline board + the click/keyboard regressions
node tests/admin.js     # the control panel, incl. that it never clobbers config.json
```

`smoke.js` runs the real `config.js`, `config-merge.js` and `script.js` in a small DOM shim —
no browser needed. It covers rendering, disabled markets, hero selection, formatting,
the GSAP entrance, and above all that **topic changing is manual**: `next`/`prev`/
`show` step the hero, they animate, they wrap at both ends, clicking a row (or
pressing Enter on it) shows that market, and nothing on a timer moves the board on
its own. It also covers the stall case — a topic change must land even if the
animation never reports completion — that the graphic appears for an asset market
and is withheld for a rate decision, that `showWhenNotAsset` overrides that, and that
the hero fits itself without overflowing, that a real asset series is plotted with
price labels and never clamped to percentages, and that markets carry their asset id
through normalising (the slip that silently disabled the whole asset path).
The detail view is covered as a measurable claim rather than a screenshot: a click
marks the board `is-detail`, hides the list from assistive tech, sets the headline and
the number larger than the split view does, puts the Back button in the tab order, and
Back restores every one of those — including after stepping with `next`. Opening the
market that is already on screen is pinned too: it must keep the same chart path and
the same glow loop, and the line must never be left mid-draw in either opening path. The reveal itself is pinned by what is being animated, not just that something is: the headlines clip-path wipe, the glow flare and the Back-button arrival are each asserted from the tween vars. The config
migration is pinned too: a saved `false` must come back as `false` (never as a truthy
`{}`), and a flag that is not exactly `true` cannot arm the rotation timer. The
travelling glow has its own checks: the second path uses the line's geometry, its dash
is the configured length with a gap that leaves exactly one dash on the line, it is
armed on a looping timeline, and `chartGlow.enabled: false` removes both the path and
the loop.

`board.js` covers the Polymarket layout (grouped sections, count, selection, the
freshness stamp, the empty and error states, and that a priceless market prints an
em dash) and pins three fixed defects so they cannot come back: clicking a row opens
the market **on that row** under every sort mode, space on a focused row selects that
row without then skipping past it, and the venue name is kept only when Polymarket
really is the source.

Current results: **84/84** (smoke) · **41/41** (board) · **74/74** (panel).

The two layout claims that no DOM shim can make — that an opened market really takes
both columns, and that Back really gives the list its column back — are measured in
real Chrome by `tests/detail.html`:

```bash
chrome --headless=new --virtual-time-budget=25000 --dump-dom \
  "http://localhost:8790/predictions/tests/detail.html?flat=1"
```

Split view: `1040px 688px` · hero `1040px` · list `display: flex` · no Back button.
Opened: `1728px` (one column) · hero `1728px` — both sides · list `display: none` ·
Back visible at the top right · headline `52 → 73.84px` · number `176 → 204.16px` ·
chart `64 → 99.19px` · statistics pinned to the right edge · no overflow or clipping.
Back returns all of it, with the opened market still the hero.

The glow is measured the same way by `tests/glow.html`, because a tween that runs is not
the same thing as a dash that is the right size and a loop that is armed:

```bash
chrome --headless=new --virtual-time-budget=12000 --dump-dom \
  "http://localhost:8790/predictions/tests/glow.html"
```

```
glow path: present
  class=glow stroke=#7fe6ff width=3.4
  dasharray=150 1150    d matches line: true
  filter=drop-shadow(rgb(127, 230, 255) 0px 0px 8px)
  chartLineLen=1000
loop: armed  repeat=-1  repeatDelay=2.5  duration=3
  progress 0.00  opacity=0      dashoffset=1150px
  progress 0.12  opacity=0.95   dashoffset=994px
  progress 0.40  opacity=0.95   dashoffset=630px
  progress 0.70  opacity=0.95   dashoffset=240px
  progress 0.95  opacity=0.2726 dashoffset=-85px
```

With `--force-prefers-reduced-motion` the same run reports `glow path: MISSING` and
`loop: none`. The hub's side of the Polymarket proxy is tested from
`Overlays/tests/polymarket.js` against a fake Gamma server — see the caveat above.

---

## Caching & versions

OBS caches whatever the browser source loaded, so a changed `style.css` or
`script.js` can keep running the **old** code even after a restart. Every local asset
is therefore referenced with a version stamp:

```html
<link rel="stylesheet" href="style.css?v=1.0.0" />
<script src="script.js?v=1.0.0"></script>
```

After changing any file, raise the version everywhere at once:

```bash
node tools/bump.js          # patch  1.0.0 → 1.0.1
node tools/bump.js sync     # re-stamp with the current version, no bump
node tools/bump.js --check  # report only, change nothing
```

Still seeing the old build? In OBS right-click the source → **Refresh**, or tick
**Refresh browser when scene becomes active**.

### Saved configs are migrated, not pinned

The panel and the overlay each keep a full copy of the config (`localStorage` and
`config.json`). If that copy came from an older build it used to win, so a palette fix
would appear to revert itself on the next render.

`config-merge.js` fixes that: while `meta.version` is unchanged your saved settings
win; when the version changes, the saved config keeps only your **content** — the
markets above all, which cannot be regenerated — and the shipped build supplies the
whole **look**.

Content is copied **by value**. That matters for the booleans: an earlier build
cloned with `JSON.parse(JSON.stringify(o || {}))`, so a saved `false` came through a
migration as `{}` — and `{}` is truthy. `rotate.enabled: false` therefore came back
as `{}`, the board saw a truthy flag and started cycling through the markets on its
own. Content is copied verbatim now (only `undefined` has no copy), and a flag can
only arm a timer when it is exactly `true`.


