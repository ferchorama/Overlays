# Digital Assets Market — live crypto board for OBS

A **1920×1080** dark trading-terminal board: a title, category tabs, a column
header row and up to eleven asset rows (rank · logo + name + ticker · 7-day
trend · price · 24h · 7d). The shipped categories are **PRIVACY · REVENUE · AI ·
DINO COINS · DEFI**, and they are data — the roster lives in `config.js` and is
editable from the control panel. Prices come from **CoinGecko** through a cached
proxy in the shared hub, with a **CoinPaprika** fallback for when the free tier is
rate-limiting — see [Data](#data) below.

Like the other two overlays this is plain **HTML + CSS + vanilla JS + GSAP**, with
no build step and no npm dependencies, and it is built to sit on air: the
entrance plays once, tab switches animate, and the board is taken off air by
hiding the OBS source rather than by animating out.

There is deliberately **no auto-rotating carousel**. The board holds the category
you chose, for as long as you want it — on air you do not want it moving on
mid-sentence. Switch tabs by clicking one, with the arrow keys, or with the
`next` / `prev` commands.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The board. Point OBS at this. |
| `style.css` | Layout only — every colour, size and font arrives as a CSS custom property from `script.js`. |
| `config.js` | **All defaults / design tokens** — palette, columns, categories, data policy, animation, sync. |
| `config-merge.js` | Version-aware migration: a saved config from an older build keeps your *content* and takes the shipped *look*. |
| `script.js` | Engine: fetch → normalise → format → render, the board DOM, GSAP entrance and tab transitions, the command API. |
| `admin.html` / `admin.css` / `admin.js` | The control panel: live preview, 8 tabs of editors, export/import, raw JSON. |
| `config.json` | Created by the hub when you hit **Save** — the board polls it, so OBS follows your edits live. |
| `vendor/gsap.min.js` | Local GSAP 3.12.5 so the board works offline (the CDN is the fallback). |
| `tests/smoke.js` | Runs the real engine in Node with a DOM shim and a stubbed proxy (3 modes). |
| `tests/contrast.js` | WCAG AA gate over the composited panel + a colour-blind separation check. |
| `tests/admin.js` | Control-panel runtime check: boots the real `admin.html` + `admin.js`, drives the editors, asserts what was written and posted. |
| `tests/measure.html` | Measurement harness: loads the real board in a same-origin iframe and reports the **computed** font family and size of every text element, the vertical flow (each block's gap against the hairline above it, against a minimum the design requires) and the tab strip's active state — so a font token that fails to resolve, or a strip that has drifted onto a rule, shows up as a number rather than a vibe. |
| `tools/bump.js` | Raises the `?v=` cache-buster everywhere at once. |
| `assets/crypto-wallpaper-1080p.png` | A concept test, not part of the build — `tools/package.js` excludes it. |
| `.skills/` | Third-party SKILL.md reference documents (not loaded at runtime). |

**There is no standalone `server.js` here.** Weather and topics each ship one;
this board does not, and is only ever served by the hub — its cached market
proxy, its `config.json` store and its command API all live in
`Overlays/server.js`.

---

## Quick start

Start the shared hub once; the board comes up with it:

```bash
cd Overlays
node server.js            # → hub at http://localhost:8790
```

* Control panel: <http://localhost:8790/market/admin.html>
* OBS browser source: <http://localhost:8790/market/index.html> (1920×1080)

On Windows, `start.bat` does the same thing after checking Node and the port.

### OBS browser-source settings

| Setting | Value |
|---|---|
| Width / Height | `1920` × `1080` |
| Custom CSS | *(empty)* |
| Shutdown source when not visible | **off** |
| Refresh browser when scene becomes active | **off** |

Transparency is automatic (`html, body { background: transparent }`). The board
designs on a fixed 1920×1080 stage and scales itself to whatever size the source
is, so a 1280×720 source still lines up exactly.

---

## Controls

| Action | Admin button | HTTP |
|---|---|---|
| Play the entrance | **▶ Play entrance** | `/api/command?action=in` |
| Hide (off air) | **Hide** | `/api/command?action=hide` |
| Re-fetch now | **↻ Refresh** | `/api/command?action=refresh` |
| Next category | **Next ›** | `/api/command?action=next` |
| Previous category | **‹ Prev** | `/api/command?action=prev` |

Keyboard in the overlay window: `←` / `→` change category, `space` replays the
entrance.

### Stream Deck / Companion

A **Web Request** against `http://localhost:8790/market/api/command?action=next`,
and so on. The hub writes the action to `state.json`; the board polls
`api/state` (every 700 ms by default) and acts when the sequence number changes.
An unknown action is ignored rather than guessed at.

The same commands also arrive over `postMessage`, which is how the control panel's
buttons reach the board without waiting for a poll. Both paths land in one
handler, so they cannot drift apart.

---

## Customizing

The control panel has eight tabs:

* **Content** — title text, header/column visibility, the six column header
  labels, max rows per category.
* **Categories** — one editor per tab: id (also the `?category=` value), label,
  and the comma-separated CoinGecko ids. The shipped roster is
  `privacy` · `revenue` · `ai` · `dino` · `defi`; reorder with ⠿ or ↑/↓, remove
  with ✕ (the last one is protected). **Add category** appends one, and
  **clean coin lists** drops blanks and duplicates. Ids, not tickers: a ticker is
  ambiguous across exchanges, and CoinGecko's ids are what the API takes.
* **Look** — panel background/border/radius/opacity/padding/shadow, glass blur,
  saturate, inner highlight and sheen; title size/weight/colour/rule/shadow; the
  tab pills including the active fill; row height, radius, dividers, zebra and
  the tick flash; logo size and fallback colours; the asset/price/change type.
  Every rgba colour has a **paired alpha field**, because a native
  `<input type="color">` cannot carry alpha and would otherwise flatten the glass
  on the first edit.
* **Columns** — reorder, relabel, resize and hide the six columns. A hidden
  column becomes a chip you can click to bring back. The `asset` column takes the
  leftover width, so its width box is deliberately not editable — widen the
  panel instead and the trend chart grows.
* **Type** — a typeface picker. The faces are files in `fonts/` (SIL Open Font
  License, see `fonts/OFL.txt`), plus Segoe UI, which Windows already has.
  Nothing is loaded from a CDN. Choosing a face sets the title, tabs, names and
  numbers together. Also the point sizes, weights and letter-spacing, the ticker
  tracking, name clipping, and the price/change number formats (plain vs compact,
  prefix, decimals, small-price decimals, sign, arrow).
* **Animation** — entrance timings and ease, the sparkline stroke-draw, the tab
  switch recipe (indicator slide / out / in), value tweening and the tick flash.
* **Data** — refresh seconds, currency, sparkline on/off, timeout, retry delay,
  stale threshold, cache key, and whether the last good response may be used when
  the network fails.
* **Advanced** — the stage size/fit/alignment, export, import, reset, raw JSON,
  and the OBS/Stream Deck reference for this board.

Everything is written to `localStorage` (`cm-config-v1`), pushed to the live
preview over `postMessage`, and saved to `config.json` through the hub.

### URL parameters

| Parameter | Effect |
|---|---|
| `?category=<id>` | Open on a specific category (`privacy`, `revenue`, `ai`, `dino`, `defi`) |
| `?refresh=<seconds>` | Override the poll interval |
| `?config=<base64 json>` | Apply a one-off config overlay |
| `?fit=contain\|cover\|width\|none` | Override the scaling mode |
| `?nosync=1` | Disable the `config.json` poll, the command poll and the OBS sync — what a screenshot or a test wants |

---

## Data

The board never calls CoinGecko directly first. It asks the hub:

```
GET /market/api/market?ids=bitcoin,ethereum,…&currency=usd&changes=24h,7d&sparkline=1
```

The hub caches the upstream response for **60 s** (90 s for the fallback) so ten
browser sources still cost one upstream call, retries 5xx/timeouts/429 with
exponential backoff **and jitter**, honours `Retry-After`, and — if CoinGecko is
down or rate-limiting — reshapes a **CoinPaprika** ticker list into CoinGecko's
`/coins/markets` shape so the board needs no knowledge of who answered.

* **Retry policy** — 5xx, timeouts and 429 only. Any other 4xx fails fast, because
  retrying a client error just burns quota and hides the bug.
* **The fallback's blind spot, and how it is covered.** CoinPaprika's bulk list
  stops at roughly the top 2000 coins by rank. A coin below that cut is simply
  absent from the payload — Zama, for instance, sits near rank 6300 — so any coin
  the bulk list misses is fetched **one at a time** afterwards (capped at six per
  refresh, and only on this degraded path) and merged in. Without that, mapping a
  lower-ranked coin had no effect and its row silently emptied for the length of
  an outage. Both behaviours are logged:
  `CoinPaprika bulk list missed 1 coin(s) — filled 1 individually (zama)`.
* **Stale beats broken** — if both providers fail, the proxy serves the last good
  response for up to 15 minutes with `X-Cache: STALE`, and the board labels it
  `cached (upstream unavailable)` rather than passing old prices off as live.
* **Degraded is visible** — when CoinPaprika answers, the board appends
  `no trend data` to its footer note, because that provider publishes no sparkline
  and no logos. Rows fall back to ticker initials. If the board already knew a
  coin's real name and logo from CoinGecko, that identity is **kept** — the
  fallback otherwise relabels `the-open-network` as "TONToken" for the duration of
  an outage.
* **Then the API directly, then the cache** — if the proxy is missing entirely
  (opened from disk) the board calls CoinGecko itself, and if that fails it uses
  the last good response in `localStorage` (`cm-cache-v1`).
* **Honest failure** — with no cache and no network the rows keep their layout and
  show `—` everywhere; the board never invents a price.

Data refreshes every **120 s** by default, aborts anything in flight after 12 s,
and the currency is switchable from the Data tab (`usd`, `eur`, …).

---

## Accessibility

* A visually-hidden `role="status" aria-live="polite"` summary (`#cm-live`)
  announces the visible category and each holding's price and 24 h move.
* Tabs are real `<button>` elements with `aria-pressed`, reachable by keyboard.
* Direction is carried by a **sign**, not colour alone — the palette's up/down
  pair is not separable for deuteranopia, so the glyph has to do the work.
  `tests/contrast.js` asserts both the separation and the presence of the cue.
* `prefers-reduced-motion` removes the entrance, the tab transitions and the
  sparkline draw; `forced-colors` falls back to system colours.
* `data-testid` / `data-state` hooks exist so tests never bind to CSS classes.

---

## Caching & versions

OBS caches whatever the browser source loaded, so a changed `style.css` or
`script.js` can keep running the **old** code even after a restart. Every local
asset is therefore referenced with a version stamp:

```html
<link rel="stylesheet" href="style.css?v=1.0.2" />
<script src="script.js?v=1.0.2"></script>
```

After changing any file, raise the version everywhere at once:

```bash
node tools/bump.js          # patch  1.0.2 → 1.0.3   (the usual one)
node tools/bump.js minor    # 1.0.3 → 1.1.0
node tools/bump.js major    # 1.1.0 → 2.0.0
node tools/bump.js sync     # re-stamp with the current version, no bump
node tools/bump.js --check  # report only, change nothing
```

It updates `meta.version` in `config.js`, then rewrites `index.html` and
`admin.html` — adding a stamp to any asset that is missing one (including the
admin preview iframe) and preserving other query parameters. The control panel
header shows the version it loaded, so you can confirm OBS is not on a stale copy.

Still seeing the old build? In OBS right-click the source → **Refresh**, or tick
**Refresh browser when scene becomes active** in the source properties.

### Saved configs are migrated, not pinned

The panel, the overlay and the server each keep a copy of the config
(`localStorage`, `config.json`). If that copy came from an older build it would
otherwise win, so a palette fix would silently revert the next time the panel
rendered.

`config-merge.js` fixes that: while `meta.version` is unchanged your saved
settings win; when the version changes, the saved config keeps only your
**content** (categories, max rows, refresh cadence, currency) and the shipped
build supplies the whole **look** — including the endpoint URLs, because a stale
proxy path would silently break the board. The control panel reports it in
Advanced.

### Live sync only reacts to a visible change

The overlay polls `config.json` every 2 s, and a config change is applied by
rebuilding the board — a full teardown, so it must not happen for nothing:

* **The comparison ignores `meta`.** Migrating a saved config stamps
  `meta.migratedFrom` onto it. That is bookkeeping the board never renders, but
  including it made the *first* poll tear the board down and rebuild it ~2 s after
  load, blanking every price for a data round trip — a visible flash on air with
  nothing actually changed. `CM.configSignature()` is what the poll compares, and
  it covers everything the board draws and nothing else.
* **A rebuild carries the data over.** The replacement board inherits the previous
  board's coins *and* its freshness (`fetchedAt`, source, cached/error flags), so
  `mount()` renders the last known prices immediately and the refresh updates them
  in place, rather than showing `—` in every row until the fetch lands. The note
  under the rows stays continuous too.

So a genuine edit still rebuilds — and cannot blank the board when it does.

---

## Tests

```bash
node tests/smoke.js        # happy path
node tests/smoke.js --stale   # proxy answered from a stale cache
node tests/smoke.js --offline # proxy and direct both down, nothing cached
node tests/contrast.js     # WCAG AA + colour-blind separation
node tests/admin.js        # control panel: boots, editors, commands, save
```

No browser, no server and no npm packages — each test shims the small DOM the
engine needs and loads the **real** `config.js`, `config-merge.js`, `script.js`
and `admin.js`, so a missing element or a stale config key fails the run.

| Check | Result |
|---|---|
| Smoke, happy path (structure, formatting, sparklines, data path, placement, entrance, tab switch and its initial state, migration, live-sync rules, command API, the note's font chain) | **46/46** |
| Smoke, `--stale` | **48/48** |
| Smoke, `--offline` (placeholders, honest `error` state) | **41/41** |
| Contrast gate: 9 text tokens at the AA threshold for their size/weight, 6 colour checks | **15/15** |
| Admin panel: boot, 189 bindings resolve, rgba alpha pairs, categories, columns, commands, debounced save, migration | **34/34** |

Two of the smoke checks are the reason the command API and the hide path exist at
all: the stub answers the first `/api/state` poll with a **hide**, and the test
asserts the board actually leaves the screen and comes back.

### Verifying visually

Headless Chrome never exits after `--screenshot`, so bound it with an alarm:

```bash
perl -e 'alarm 45; exec @ARGV' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir=/tmp/cmshot --window-size=1920,1080 --virtual-time-budget=9000 \
  --screenshot=/tmp/cm.png "http://localhost:8790/market/index.html"
```

For the **computed** type rather than pixels — which is how a font token that
fails to resolve gets caught — use the measurement harness. Chrome's `--dump-dom`
cannot read computed styles, so the harness folds them into its own DOM:

```bash
chrome --headless=new --virtual-time-budget=14000 --dump-dom \
  "http://localhost:8790/market/tests/measure.html" | sed -n '/<pre id="out">/,/<\/pre>/p'
```

It prints one line per text element with its computed font family and size, and
flags `GENERIC-SERIF!` on anything that has fallen through to the browser default.
That is exactly the failure this board has now hit twice (`--rank-font`, then the
note's `--cols-font`), and both times the only visible symptom was a text run in a
serif face.

It then prints the vertical flow, with the gap between each block and the hairline
above it checked against **`minGap` — the design expectation, not a suggestion**:

```
board-title  top=     178 h=  116.5
tabs         top=   310.5 h=     44  gap=    16  ok (needs >= 8px)
cols         top=   374.5 h=     40  gap=    20
rows         top=   414.5 h=    468  gap=     0
```

The tab strip's minimum is 8px because those pills are 44px tall and rounded at
999px: at a 0px margin the strip begins on the title rule's own pixel and the line
reads as cutting through every pill. A table header's rule sitting on the first
row, by contrast, is deliberately allowed to be flush. The harness also reports
the tab strip's active state, and asserts there is exactly one active tab — the
board used to come up with none until the first switch.

The same two invariants are asserted in `tests/smoke.js` without a browser, so a
regression fails `node tests/smoke.js` alone.

Finally it checks **panel placement** — the panel is sized by its rows and centred
in the stage, so `--panel-y` has to agree with the panel's own rendered height:

```
panel height=787  stage height=1080  alignY=middle
--panel-y=147  expected=147  drift=0px  ok
panel bottom = 934 / 1080  inside the stage
```

This one is worth keeping: `layout()` used to run in `mount()` *before*
`renderRows()`, so it centred a panel that had no rows yet and parked the board
~250px low with the last row off the bottom. A first load escaped it because the
`ResizeObserver`'s initial callback re-ran `layout()` a frame later — but every
config poll rebuilds the board, and from the first poll (~2s in) onwards the
offset stayed wrong, which is what "it opens centred and then drops" looked like.
A DOM shim cannot catch it (it reports a fixed `offsetHeight`), so `tests/smoke.js`
asserts the call order in the source and this harness measures the result.
