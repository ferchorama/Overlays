# Digital Assets Market — live crypto board for OBS

A **1920×1080** dark trading-terminal board: a title, category tabs, a column
header row and up to eleven asset rows (rank · logo + name + ticker · 7-day
trend · price · 24h · 7d). The shipped categories are **PRIVACY · REVENUE · AI ·
DINO COINS · DEFI**, and they are data — the roster lives in `config.js` and is
editable from the control panel. Prices come from **CoinGecko** through a cached
proxy in the shared hub, with a **CoinPaprika** fallback for when the free tier is
rate-limiting — see [Data](#data) below.

Like the other overlays this is plain **HTML + CSS + vanilla JS + GSAP**, with
no build step and no npm dependencies, and it is built to sit on air: the
entrance plays once, tab switches animate, a newly added asset slides in on its own, a removed one collapses out, and the board is taken off air by
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
| `config-merge.js` | Version-aware migration that **keeps every saved setting** across a build update and fills in new options. |
| `script.js` | Engine: fetch → normalise → format → render, the board DOM, GSAP entrance and tab transitions, the command API. |
| `admin.html` / `admin.css` / `admin.js` | The control panel: live preview, 9 tabs of editors, Apply/Copy JSON, HTTP reference. |
| `config.json` | Created by the hub when you hit **Save** — the board polls it, so OBS follows your edits live. |
| `vendor/gsap.min.js` | Local GSAP 3.12.5 so the board works offline (the CDN is the fallback). |
| `tests/smoke.js` | Runs the real engine in Node with a DOM shim and a stubbed proxy (3 modes). |
| `tests/contrast.js` | WCAG AA gate over the composited panel + a colour-blind separation check. |
| `tests/admin.js` | Control-panel runtime check: boots the real `admin.html` + `admin.js`, drives the editors, asserts what was written and posted. |
| `tests/measure.html` | Measurement harness: loads the real board in a same-origin iframe and reports the **computed** font family and size of every text element, the vertical flow (each block's gap against the hairline above it, against a minimum the design requires) and the tab strip's active state — so a font token that fails to resolve, or a strip that has drifted onto a rule, shows up as a number rather than a vibe. |
| `../shared/combobox.js` | The search dropdown the asset editor uses (`/shared/combobox.js`, served by the hub). |
| `../shared/datasync.js` | The Data-tab **Update now** control and its guards (`/shared/datasync.js`). |
| `tools/bump.js` | Raises the `?v=` cache-buster everywhere at once. |
| `assets/crypto-wallpaper-1080p.png` | A concept test, not part of the build — `tools/package.js` excludes it. |
| `.skills/` | Third-party SKILL.md reference documents (not loaded at runtime). |

The board is served only by the hub. Its cached market proxy, its `config.json`
store and its command API all live in `Overlays/server.js`.

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
| Update now — force one provider read | **Update now** (Data tab) | `/api/command?action=update` |
| Re-read the hub cache | — (this is what the button bumps after the forced read) | `/api/command?action=refresh` |
| Next category | **Next ›** | `/api/command?action=next` |
| Previous category | **‹ Prev** | `/api/command?action=prev` |

Keyboard in the overlay window: `←` / `→` change category, `space` replays the
entrance.

`refresh` re-reads the hub's cache and costs no provider call while that cache is
warm. `update` forces the hub to read CoinGecko first. **Update now** does both:
it calls `api/market` with `force=1`, then bumps `refresh` so every open board
renders the fresh cache.

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

The control panel has nine tabs:

* **Content** — title text, header/column visibility, the six column header
  labels, the footer toggle, and max rows per category.
* **Categories** — one editor per tab: id (also the `?category=` value), label, and
  **the assets in that section as rows**. Each row shows the coin's name, ticker and
  provider id, with ↑/↓ to reorder, **Change** (type a name, pick from the match
  list — the id is replaced in place) and ✕ to remove. Under the list is an add
  search. Assets are stored by **CoinGecko id**, never by ticker, and a duplicate
  in the same section is refused — and every save re-checks it in place, so no path can store the same asset twice. (The same asset may still appear in two different sections.) A section may be empty: the board prints
  "No assets in this section" rather than a blank panel. **+ Add category**
  appends a section (the last one is protected), **Remove duplicates** runs
  `CM_MIGRATE.cleanCategories` (blanks, invalid ids and repeats all go) and
  **Restore default assets** puts the shipped list back in every section while
  keeping your labels, order and look. The shipped roster is
  `privacy` · `revenue` · `ai` · `dino` · `defi`. There is no bulk paste field and
  no comma-separated id box: the rows are the editor.
* **Columns** — reorder, relabel, resize and hide the six columns. A hidden
  column becomes a chip you can click to bring back. Every column, `asset`
  included, has an editable width; `columns.assetMaxWidth` (560 px shipped) caps
  the asset column — header and cell alike — past which the trend chart takes the
  slack.
* **Layout** — panel width, radius, border, padding and alignment; title rule and
  spacing; tab gap, height, padding and radius; row height, gap, radius, padding
  and divider width; logo size and shape; sparkline size; column-header height.
* **Type** — a typeface picker. The faces are files in `fonts/` (SIL Open Font
  License, see `fonts/OFL.txt`), plus Segoe UI, which Windows already has.
  Nothing is loaded from a CDN. Choosing a face sets the title, tabs, names and
  numbers together. Also the point sizes, weights and letter-spacing, the ticker
  tracking, name clipping, and the price/change number formats (plain vs compact,
  prefix, decimals, small-price decimals, sign, arrow).
* **Colour** — panel background/border/opacity, glass blur, saturate, inner
  highlight and sheen; title colour/rule/shadow; the tab pill palette including
  the active fill; row dividers and zebra; logo visibility and fallback colours;
  text and column-header colours; the sparkline stroke and fill; and the
  direction palette (up/down/flat/rank). Every rgba colour has a **paired alpha
  field**, because a native `<input type="color">` cannot carry alpha and would
  otherwise flatten the glass on the first edit.
* **Motion** — entrance timings and ease, the new-asset entrance and the row exit (duration, travel, ease), the sparkline stroke-draw, the trend
  line's travelling glow, and the tab switch recipe (indicator slide / out / in).
* **Data** — **Update now** (forces one provider read, with an in-flight guard, an
  8 s cooldown, a last-updated clock and an error that keeps the previous data),
  currency, sparkline on/off, timeout, cache key, and whether the last good
  response may be used when the network fails. There is deliberately **no
  refresh-interval field**: the board has no timer, and the old
  `data.refreshSeconds` key is gone.
* **Advanced** — the stage size/fit/alignment, raw JSON with **Apply JSON** and
  **Copy** (there is no file export/import), and the OBS/Stream Deck HTTP
  reference for this board.

Everything is written to `localStorage` (`cm-config-v1`), pushed to the live
preview over `postMessage`, and saved to `config.json` through the hub.

### URL parameters

| Parameter | Effect |
|---|---|
| `?category=<id>` | Open on a specific category (`privacy`, `revenue`, `ai`, `dino`, `defi`) |
| `?config=<base64 json>` | Apply a one-off config overlay |
| `?fit=contain\|cover\|width\|none` | Override the scaling mode |
| `?nosync=1` | Disable the `config.json` poll, the command poll and the OBS sync — what a screenshot or a test wants |

---

## Data

The board never calls CoinGecko directly first. It asks the hub:

```
GET /market/api/market?ids=bitcoin,ethereum,…&currency=usd&changes=24h,7d&sparkline=1
```

The hub caches the upstream response for **90 s** (the fallback TTL is 90 s too) so ten
browser sources still cost one upstream call, retries 5xx/timeouts/429 with
exponential backoff **and jitter**, honours `Retry-After`, and — if CoinGecko is
down or rate-limiting — reshapes a **CoinPaprika** ticker list into CoinGecko's
`/coins/markets` shape so the board needs no knowledge of who answered. Every
answer carries `X-Fetched-At` (plus `X-Cache`, `X-Source` and `X-Degraded`), which
is where the Data tab's "last updated" comes from.

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
  response for up to 15 minutes with `X-Cache: STALE`. The footer still only says
  how long ago that response was fetched.
* **Degraded is visible in the rows** — when the fallback answers, sparklines and
  logos are absent, so rows fall back to ticker initials. The footer does not
  say why. If the board already knew a coin's real name and logo, that identity
  is **kept** — the fallback otherwise relabels `the-open-network` as "TONToken"
  for the duration of an outage.
* **Then the API directly, then the cache** — if the proxy is missing entirely
  (opened from disk) the board calls CoinGecko itself, and if that fails it uses
  the last good response in `localStorage` (`cm-cache-v1`).
* **Honest failure** — with no cache and no network the rows keep their layout and
  show `—` everywhere; the board never invents a price.
* **An unpriced asset is labelled, not left shimmering.** CoinGecko's search
  indexes coins that `/coins/markets` does not price, and a refresh can time out
  in the browser while the hub is still retrying upstream. Once a read has
  finished, an id with no record renders a muted row (`is-missing`) showing its
  id and `—` cells instead of a permanent loading skeleton; the board schedules
  **one** retry five seconds later so the hub's completed (cached) answer can
  land. That retry is per rebuild, not a polling timer. The panel refuses to add
  or replace an asset with no market data, with a message naming the coin.

**There is no refresh timer.** The board asks the hub once per load and paints the
last good response from `localStorage` first; the hub re-reads CoinGecko only when
its 90 s cache is cold. **Update now** (Data tab, or the `update` command) adds
`force=1` — one provider read, joined with any request already in flight and
refused inside a 2 s window — then bumps the `refresh` command so every open board
re-reads the warm cache. Requests abort after 12 s, and the currency is switchable
from the Data tab (`usd`, `eur`, …). The hub reports `GET /market/api/status` with
`fetchedAt` / `error` / `inFlight`.

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

### Settings are persistent

The panel, the overlay and the server each keep a copy of the config
(`localStorage`, `config.json`). **A build update never resets what you saved.**
`config-merge.js` runs on every load and save:

* same `meta.version` → your saved config wins;
* new version → every saved value the build still knows wins, new options come
  from the shipped build, retired keys are dropped;
* `categories`, `maxRows`, `font` and the currency/policy fields are yours;
* the provider endpoint URLs (`data.proxyUrl`, `data.directUrl`) are the one
  thing that always comes from the build — a stale proxy path would silently
  break the board after an update;
* a saved `false`, `0` or `''` survives, because only `undefined` has no copy.

The control panel reports the upgrade once, e.g.
`settings upgraded to v1.1.5 (was v1.1.1) — your settings were kept`. The
brand line always shows which config version is loaded.

`meta.schema` is separate from `meta.version`: it versions the saved **asset
format**. Schema 2 stores each section's assets as unique CoinGecko ids, and a
save always writes schema 2. A schema-1 — or older-build — config is upgraded on
load through `CM_MIGRATE.cleanCategories`, which drops blank entries, bare
tickers and duplicates while keeping the assets that are real ids. An emptied
section stays empty rather than being refilled.
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
| Smoke, happy path (structure, formatting, sparklines, data path, placement, entrance, tab switch and its initial state, migration, live-sync rules, command API, the note's font chain, the asset-width cap, the category surviving a rebuild, **no refresh timer**, **a manual update sends force=1**, **the `update` command forces a read**, the empty-section state, **a record-less id stops shimmering and is marked missing**, **one bounded retry**, **a newly added asset animates in without replaying the board**, **a removed asset collapses out before the rebuild**) | **80/80** |
| Smoke, `--stale` | **82/82** |
| Smoke, `--offline` (placeholders, honest `error` state, empty footer) | **75/75** |
| Contrast gate: 9 text tokens at the AA threshold for their size/weight, 6 colour checks | **15/15** |
| Admin panel: boot, every bound field resolves, rgba alpha pairs, the asset rows (list, reorder, delete, empty section, restore), duplicate/ticker refusal, schema-1 upgrade, columns, commands, debounced save, migration, **no POST just from opening the panel**, **the replace button is wide enough for its word**, **duplicate ids are stripped in place without replacing the array** | **62/62** |

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
