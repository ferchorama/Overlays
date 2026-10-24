# The Rollup overlays hub

Four broadcast graphics for *The Rollup*, served by **one zero-dependency Node
process on one port**. Every overlay is an OBS browser source; every overlay has
a control panel that writes to the same store the source polls, so edits appear
on air within a couple of seconds without touching OBS.

```
node server.js            → hub at http://localhost:8790
PORT=9000 node server.js  → custom port
```

Requirements: **Node 18 or newer** (the proxies use the global `fetch`). There
are no npm dependencies, no build step, and no `node_modules` — the server uses
`http`, `fs` and `path` only, and every overlay vendors its own GSAP.

See [`CHANGELOG.md`](CHANGELOG.md) for what changed and which version each
overlay is on.

## Start it

| OS | Command |
|---|---|
| Windows | double-click `start.bat` (checks Node, installs it if missing, checks the port, starts the hub, opens the hub page) |
| macOS / Linux | `./start.command` (same checks) |
| Any | `node server.js` |

Checks only, without starting anything: `start.bat --check` or
`./start.command --check`.

## What is served

| Overlay | OBS source size | URL | Control panel | Driven by |
|---|---|---|---|---|
| Vertical Weather | **460×1080** | `/weather/index.html` | `/weather/admin.html` | Open-Meteo once per load, via the hub cache |
| Talking Points | 1920×1080 | `/topics/index.html` | `/topics/admin.html` | static topic list |
| Digital Assets Market | 1920×1080 | `/market/index.html` | `/market/admin.html` | CoinGecko once per load, via the hub cache |
| Prediction Markets | 1920×1080 | `/predictions/index.html` | `/predictions/admin.html` | hand-typed board, Polymarket headlines fetched by the panel, asset prices via the hub cache |

Weather, market and predictions read an external provider; **Talking Points does
not** — its content is the topic list you type. None of the four fetches on a
timer: each overlay asks the hub once when it loads, and the hub owns the
provider cache.

The hub page at `/` lists all four with copy-ready source URLs and command URLs.

Also available: `GET /healthz` (JSON status, port, per-app versions),
`GET /api/apps` (the same list the hub page renders) and, for the three data
overlays, `GET /{app}/api/status` — `{hasData, fetchedAt, ageMs, inFlight, stale,
source, error}`, which is where the dashboards get "last updated" from.

## Driving an overlay (Stream Deck / Companion / curl)

Every overlay exposes the same control endpoints under its prefix:

```
GET  /{app}/api/command?action=in             # bump the command sequence
GET  /{app}/api/command?action=next&index=2   # where the app supports an index
GET  /{app}/api/state                         # what the source is polling
GET  /{app}/api/config                        # the saved config.json
POST /{app}/api/config                        # save a config (JSON object)
```

Actions per app:

| App | Actions |
|---|---|
| weather | `in` `play` `hide` `out` `refresh` `update` |
| topics | `in` `out` `replay` |
| market | `in` `hide` `refresh` `update` `next` `prev` |
| predictions | `in` `out` `replay` `next` `prev` `show` `refresh` `update` |

A command writes `{seq, action, index, ts}` into `{app}/state.json`; each source
polls `api/state` and replays an action once per new `seq`, so a dropped poll
cannot skip or double-fire a command. Weather is strict — an unknown action gets
`400` plus the `allowed` list. The other apps fall back to their first action
rather than failing a Stream Deck key.

## How settings work

The same four-part contract in every overlay:

1. **`config.js`** — factory defaults plus `meta.version` (the "shipped" build).
2. **`config.json`** — what the control panel saved; what the source actually
   renders. Written atomically (temp file + rename, with retries for Windows
   `EPERM`/`EBUSY`).
3. **`localStorage`** — the panel's own copy, and the source's last good data
   (and its fallback config) so a reload paints before the hub answers.
4. **URL overrides** — `?config=`, `?fit=`, and per-app extras (`?theme=dark` on
   topics/weather, `?category=` on market, `?market=` on predictions).
   `?nosync=1` turns polling off entirely.

`config-merge.js` resolves them, and **settings are persistent**: the same
`meta.version` → your saved config wins; a build update → every value you saved
that the build still knows wins, new options are filled in from the shipped
build, and retired keys are dropped. A version bump can never silently reset
your text, palette, layout or data policy. Provider endpoint URLs stay
build-owned (a stale proxy path would break the board). A panel opened on a fresh
browser profile reads `config.json` first and only writes when you actually edit
something.

A panel edit reaches its **own live preview** by a `storage` event (~0 ms) and a
`postMessage` (~120 ms), and the **OBS source** by the `config.json` poll
(1.5–2 s) — a storage event or a BroadcastChannel cannot cross into OBS, and the
hub is the only thing both contexts share (see *Update now* below). Commands
travel separately through `api/state` (every 700 ms).

### Data: one read per load, no refresh timer

None of the overlays refresh a provider on a timer. Each asks the hub once when
it loads; the hub owns the provider cache and the overlay paints its last good
payload from `localStorage` first, then confirms in the background.

| App | Endpoint | Cache | Server-side behaviour |
|---|---|---|---|
| weather | `GET /weather/api/data` | 120 s | one Open-Meteo forecast request for **both** cities (multi-location coordinates); geocodes only cities without pinned lat/lon, cached 24 h |
| market | `GET /market/api/market` | 90 s | CoinGecko markets, CoinPaprika fallback |
| predictions | `GET /predictions/api/data` | 90 s | the **same** CoinGecko cache as the market board — one call serves both overlays |

Any of them accepts `force=1`, which bypasses the cache read but still joins an
in-flight request and is rate-limited by the hub (two forced reads inside 2 s
returns `429 cooldown`). `GET /{app}/api/status` reports `{hasData, fetchedAt,
ageMs, inFlight, stale, source, error}`.

### Update now (dashboard → on-air source)

The dashboard and an OBS browser source are different browser contexts — OBS
runs its own Chromium profile and storage partition, so **BroadcastChannel and
localStorage `storage` events cannot cross between them**. The hub is the only
thing both share, so the button is HTTP — which also means the dashboard can run
on another machine. No WebSocket, BroadcastChannel or storage-event transport was
added.

1. the panel calls the data endpoint with `force=1` (one provider read, with a
   hub-enforced cooldown and in-flight join);
2. the hub returns the fresh data and its fetch time;
3. the panel bumps the app's `refresh` command;
4. every overlay polls `api/state` (700 ms), sees the new `seq`, and re-reads the
   now-warm hub cache.

The control is `shared/datasync.js`, mounted by the weather Data tab, the market
Data tab and the prediction Asset-data panel: it has an in-flight guard, an 8 s
cooldown, a "last updated" clock, and an error state that says the previous data
is still on air (it never bumps the command after a failure, so nothing is
cleared). Topics has no external data and therefore no button.

## Upstream proxies

All provider access lives in `server.js`. Every endpoint caches and de-duplicates
concurrent calls; the upstream proxies retry `5xx`/timeouts/`429` with jittered
backoff, honour `Retry-After`, and all of them serve stale-but-labelled data
rather than an empty board. Responses carry `X-Cache`
(`HIT`/`MISS`/`REFRESH`/`STALE`), `X-Cache-Age`, `X-Fetched-At`, `X-Source` and
`X-Degraded`.

- **`/weather/api/data`** — Open-Meteo. Two cities cost one forecast request
  (comma-separated coordinates; `timezone=auto` resolves per location), and
  geocoding happens server-side only for a city without pinned coordinates
  (cached 24 h). 120 s TTL, 15 min stale-on-failure.
- **`/market/api/market`** — CoinGecko `/coins/markets`, 90 s TTL. On failure it
  falls back to CoinPaprika (explicit id mapping, per-coin top-up for coins the
  bulk list misses), reshaped into CoinGecko's response so the board needs no
  knowledge of which provider answered. `MARKET_FORCE_FALLBACK=1` exercises that
  path on demand.
- **`/predictions/api/data`** — the same CoinGecko request, the same cache, reached
  through the prediction app's own prefix. A price series already fetched for the
  market board is free here.
- **`/market/api/search?q=`** — CoinGecko `/search`, normalised to
  `{id, name, symbol, thumb, rank}`; backs the dashboard's "change asset" picker.
  5 min TTL.
- **`/predictions/api/polymarket`** — Polymarket Gamma `/events`, `/markets` and
  `/tags`, 120 s TTL, ranked server-side by 24 h volume so the panel's "top
  headlines" cannot depend on an unverified upstream `order` parameter. The
  overlay never calls it: the **control panel** does, when the operator presses
  Update, and writes the result into `config.json`.

`POLYMARKET_API_BASE`, `OPEN_METEO_BASE`, `OPEN_METEO_GEO_BASE` and
`COINGECKO_BASE` override the origins (used by the test suite's fake providers).

## Tests

Every suite is a plain Node script — no browser, no test runner, no
dependencies. Run them from this folder:

| Command | Covers |
|---|---|
| `node tests/server.js` | the hub over real HTTP: routing, per-app isolation, the `refresh`/`update` actions, config validation, traversal guard, the `/shared` mount, `.skills` containment, no legacy listener |
| `node tests/polymarket.js` | the Gamma adapter against a fake upstream: query building, ranking, defensive parsing, error shapes, caching |
| `node tests/hub-data.js` | the data endpoints against fake providers: one forecast request for two cities, geocode-once, TTL/`force`/cooldown, stale-on-failure, shared market+predictions cache, search normalisation, `/api/status` |
| `node tests/datasync.js` | the dashboard Update control: in-flight guard, cooldown, command bumped only on success, error keeps the previous data |
| `node market/tests/smoke.js` (`--stale`, `--offline`) | the real board engine in a DOM shim: fetch → normalise → format → render, in 3 network modes |
| `node market/tests/contrast.js` | WCAG AA for every ink token over black *and* white video, colour-vision separation, accent-vs-semantic separation |
| `node market/tests/admin.js` | the real control panel: every bound id exists, migration, editors, debounced save |
| `node topics/tests/smoke.js` · `contrast.js` · `admin.js` | panel build, entrance exactly once, palette gates, panel wiring |
| `node weather/tests/smoke.js` (`--fail`, `--no-cache`) | one hub read on load, cache reuse, honest failure states, nothing polling while idle |
| `node weather/tests/contrast.js` · `type.js` · `admin.js` | glass legibility over video, type floors, city picker, read-first boot |
| `node predictions/tests/smoke.js` · `board.js` · `admin.js` | hero/list layout, manual-only stepping, headline board, fetch review gates |

Heads-up: the suites spawn their own hub on a throwaway port, but they write the
**real** `{app}/state.json` files. If a live studio is running, an on-air source
may replay the last test command — stop the studio first, or accept a category
step.

## Layout

```
server.js              the whole backend: routing, config store, command API,
                       Open-Meteo, CoinGecko (+ CoinPaprika fallback),
                       Polymarket and asset-search proxies, hub page injection
index.html             hub page template (server injects window.__STUDIO__)
start.bat / .command   launchers: Node check, port check, start, open hub
tests/                 hub, proxy, data-endpoint and Update-control tests
tools/package.js       builds the Windows zip (run it on macOS/Linux; see below)

shared/                browser modules used by several control panels (not by the overlays):
  combobox.js          the search dropdown (city picker + asset picker)
  datasync.js          the Update-now control and its guards

weather/ topics/ market/ predictions/
  index.html           the OBS source (thin: loads the engine)
  script.js            render engine, GSAP entrance, sync + command handling
  config.js            factory defaults + meta.version
  config-merge.js      version-aware saved-config migration
  style.css            all styling; colours come from config via CSS variables
  admin.html/js/css    the control panel
  config.json          saved settings (what is on air)
  state.json           last command — git-ignored, the server recreates it
  vendor/gsap.min.js   local GSAP so a source never depends on a CDN
  tests/               DOM-shim tests for this overlay
  tools/bump.js        version bump + cache-busting stamp for index/admin
  .skills/             third-party reference documents (weather, market only);
                       never loaded at runtime, and not served: the static
                       handler refuses any dot-segment
```

## Packaging for the Windows machine

`tools/package.js` builds a clean zip containing a single top-level folder. It
must be run on macOS or Linux (`zip`/`unzip`), because PowerShell's
`Compress-Archive` adds the junk the script exists to keep out (`__MACOSX/`,
`._*`, `.DS_Store`, extended attributes). It excludes `state.json` (a stale
command would animate a source the moment it is added) and the unused 1080p
wallpaper.

```
node tools/package.js                  # clean archive
node tools/package.js --with-skills    # include the .skills reference trees
node tools/package.js --out D:\x.zip   # choose the output path
```

## Undo / rollback

The repo ships a pre-push hook (`tools/hooks/pre-push`). Enable it once per
clone:

```bash
git config core.hooksPath tools/hooks
```

Every push then leaves a local tag `backup/pre-push-<UTC timestamp>` at the
pushed commit, and the hook refuses any push that would rewrite published
history (non-fast-forward). That makes each push recoverable without a force:

| Goal | Command |
|---|---|
| Undo the last commit **before** pushing, keep the changes staged | `git reset --soft HEAD~1` |
| Undo the last commit before pushing and discard the changes | `git reset --hard HEAD~1` |
| Restore the exact tree from before a push | `git tag -l 'backup/pre-push-*'`, then `git reset --hard <tag>` |
| Undo an already-pushed commit safely | `git revert <sha>` then `git push` |
| Keep a restore point off-machine | `git push origin backup/pre-push-<timestamp>` |
| Deliberately rewrite remote history (rare) | `git push --no-verify --force-with-lease` |

`git revert` is the preferred remote rollback: it keeps history intact, is
pushable without the hook, and can itself be reverted. A restore tag is a local
undo point — it does not need to be pushed unless you want it on another machine.

## Troubleshooting

- **`port 8790 is already in use`** — another studio server is running. Stop it,
  or `set PORT=9000` (Windows) / `PORT=9000 node server.js`.
- **Panel says "local only"** — it was opened from disk or from another server.
  Open it from the hub URL; `api/config` is only served by this process.
- **A source shows old content** — the hub page shows both the shipped and the
  saved version. Hard-reload the source; the engine polls `config.json` and
  falls back to `localStorage` only when the file is unreachable.
- **Weather renders dark** — `weather/config.json` has `"theme": "dark"`. Change
  it in the panel (or delete the file to go back to the shipped light look).
