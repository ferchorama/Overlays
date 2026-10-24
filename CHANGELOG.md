# Changelog

All notable changes to the overlays hub. The four widgets ship independently —
each has its own `meta.version` and cache-buster — so versions are listed per
app. This entry describes the current working tree (nothing is tagged yet).

## 2026-10-24

### Versions

| App | Version | Saved configs found in the wild |
|---|---|---|
| Vertical Weather | **3.2.5** | 3.1.7 |
| Digital Assets Market | **1.1.8** | 1.0.13 |
| Prediction Markets | **1.4.1** | 1.3.0 |
| Talking Points | **1.1.4** | — |

All older saved configs migrate automatically on load.

---

### Hub (`server.js`)

**Added**
- Provider access moved behind the hub for every overlay:
  - `GET /weather/api/data` — **one** Open-Meteo forecast request for both
    cities (comma-separated coordinates, per-location `timezone=auto`);
    geocodes only cities without pinned coordinates, cached 24 h; 120 s response
    cache, 15 min stale-on-failure.
  - `GET /market/api/market` — CoinGecko markets, 90 s cache, CoinPaprika
    fallback with per-coin top-up for coins the bulk list misses.
  - `GET /predictions/api/data` — the **same** CoinGecko request/cache as the
    market board, reached through the prediction app's own prefix.
  - `GET /market/api/search?q=` — normalised CoinGecko search behind the asset
    picker (5 min cache).
  - `GET /{app}/api/status` — `{hasData, fetchedAt, ageMs, inFlight, stale,
    source, error}` so dashboards can show “last updated”.
- `/shared/` static route for the browser modules used by several panels.
- `force=1` on every data endpoint: joins an in-flight request, replaces the
  cache entry, and is rate-limited by a 2 s server cooldown (`429`).
- Command actions `refresh` (re-read the warm hub cache) and `update` (force one
  provider read) on market and predictions.

**Changed**
- Every data response carries `X-Cache`, `X-Cache-Age`, `X-Fetched-At`,
  `X-Source` and `X-Degraded`; CORS exposes them to the browser.
- Retries only 5xx, timeouts and 429 (honouring `Retry-After`, jittered
  backoff); stale-but-labelled data is preferred to an empty board.

**Fixed**
- A city with `lat: null` / `lon: null` was coerced by `Number(null)` to `0,0`
  and never geocoded — New York was silently read as the Gulf of Guinea. Only a
  present, finite coordinate pair now counts as pinned.
- `createUpstream` returned before assigning its status getter, leaving
  `/predictions/api/status` stuck at `fetchedAt: 0`.

**Removed**
- `GET /weather/api/photo` and its Wikimedia Commons provider (the weather
  widget no longer fetches images at all; see below).

---

### Vertical Weather — 3.2.5

**Changed**
- **Data:** no periodic provider fetch. One hub read per load; the last good
  payload is painted from `localStorage` first and confirmed in the background.
  There is no refresh interval, retry loop or idle provider traffic.
- **Update now** (Data tab) forces one hub read, shows an in-flight/cooldown
  state and a last-updated clock, and keeps the previous data on error.
- **City picker** now uses the shared combobox: debounced, abortable, cached,
  keyboard/ARIA complete; the hub geocodes cities without pinned coordinates.
- Failure copy is `PRESS R TO RETRY` / `data-state=error`; a failed manual
  update keeps the values on screen marked cached.
- `?theme=` overrides now resolve into the config the engine sees, so a light
  override on a dark saved config no longer leaves mismatched palettes.

**Removed**
- The weather-driven sky backdrop experiment (`backdrop.js`, its per-card scene
  CSS, the admin “Weather scene” controls and its tests). The widget is again the
  plain glass slab; no photo, image source, licence or attribution is involved.

**Fixed**
- Migration keeps a saved `0`, `false` or `''` instead of turning it into `{}`.

---

### Digital Assets Market — 1.1.8

**Added**
- **Asset editor per section:** one row per asset (name, ticker, provider id)
  with ↑/↓ reorder, **Change** (pick a replacement by name in place) and ✕.
  Below the list, add an asset by name. Section labels/order stay the operator's.
- Asset picker reuses the shared combobox against the hub's search; the picked
  asset is validated against the provider before it is saved, so an asset the
  provider cannot price is refused with a clear message.
- **Restore default assets** per section (labels/order/look kept).
- **Settings are persistent:** a build update keeps every saved value the build
  still knows, fills in new options, drops retired keys, and keeps provider URLs
  build-owned. Saved `false`/`0`/`''` survive.
- **New-asset entrance animation:** adding an asset to the live category slides
  only that row in (18 px + fade, 0.55 s) instead of replaying the board.
- **Delete-asset exit animation:** removing one collapses its row out (height,
  padding and opacity, 0.28 s) before the board rebuilds; a safety timer
  guarantees the rebuild if OBS throttles rAF.
- Missing-data state: an id the provider does not price renders a muted
  `is-missing` row with its id and `—` cells instead of an endless shimmer, plus
  one bounded retry (per rebuild, not a polling timer).
- Read-first boot: opening the panel reads `config.json` and never POSTs over
  what is on air until the operator edits something.

**Changed**
- Categories are edited as rows, not a comma-separated textarea. Assets are
  stored by **CoinGecko id**, never ticker; `meta.schema: 2` versions the format
  and schema-1 files upgrade with blanks/tickers/duplicates dropped.
- No refresh interval and no data timer; only a manual update forces a provider
  read. The board asks the hub once per load and paints the local cache first.
- `?refresh=` URL override removed.

**Fixed**
- Duplicates in a section are refused at pick time and stripped **in place** on
  every save/push, so no path (fast double-pick, Raw JSON, old config) can store
  the same asset twice. The array identity is preserved, so row buttons keep
  pointing at the live list. One asset may still appear in two different
  sections (the shipped config lists NEAR in PRIVACY and AI).
- A new asset no longer leaves a permanent loading row when the first read times
  out; the row either fills from the hub cache on the bounded retry or is
  labelled “no market data”.
- Reordering/deleting stopped editing a detached array after a rebuild.
- The **Change** button’s text was clipped to “Cha”; it is now a wide button
  (`.ic--wide` plus a section-scoped width rule).
- Empty categories show an explicit “No assets in this section” state.

---

### Prediction Markets — 1.4.1

**Changed**
- **Asset price history** is read through this app’s own prefix
  (`/predictions/api/data`), which shares the market board’s CoinGecko cache — one
  provider call serves both overlays. No timer; last good series is painted from
  `localStorage` (`pm-asset-cache-v1`) first.
- **Update now** (Asset data) sends `force=1` with an in-flight guard, an 8 s
  cooldown, a last-updated clock and an error state that keeps the previous line;
  `refresh` re-reads the warm hub cache.
- Manual-update commands map to the hub: `update` forces the provider,
  `refresh` re-reads the cache.

**Fixed**
- Migration keeps a saved `false` as `false` (never `{}`), so rotation cannot
  switch itself on after a version bump.

---

### Talking Points — 1.1.4

**Changed**
- Read-first boot: opening the panel no longer pushes the browser's copy over
  `config.json`; the file that is on air wins until the operator edits.
- Settings persistence follows the same contract as the other overlays.

---

### Shared modules

**Added**
- `shared/combobox.js` — one dropdown implementation for both the weather city
  picker and the market asset picker: debounce, request abort, cache, keyboard
  navigation, `aria-activedescendant`, empty/error states.
- `shared/datasync.js` — the dashboard “Update now” control: in-flight guard,
  cooldown, last-updated clock, and a failure state that reports “still on air”
  while never bumping the refresh command.

### Tooling, tests and docs

- Per-app `bump.js sync` stamps plain patch/minor/major versions and every
  `?v=` cache-buster (including the shared modules) in one command.
- 21 test suites, all green: hub/Polymarket/data endpoints/Update control, plus
  per-app smoke, contrast, type and admin suites. Weather additionally gates the
  glass over black/white video; market gates the missing/duplicate/new/removed
  asset states.
- Root and per-app READMEs, plus weather `SKILLS.md`, updated for: hub-backed
  data, no timers, the cross-context transport decision, asset editing,
  persistence across updates, and the removal of the photo/backdrop work.
- New root `README.md` documents the hub, the Update-now flow, the settings
  contract, the layout and packaging.
- `update.bat` — puts the files on a Windows machine and keeps them current:
  `git clone` on the first run, `git fetch` + `git merge --ff-only` after that,
  and an in-place `git init`/checkout when the folder came from a zip. Installs
  Git with `winget` when it is missing; if winget is not available it stops and
  prints the Git for Windows download link (`--zip` skips Git altogether, no
  admin needed). Saved
  settings are copied aside and restored on every path, `state.json` is never
  touched, and a conflicting local edit is stashed, reported and kept rather
  than dropped.

### Breaking / operational notes

- `GET /weather/api/photo` is gone; any external caller should use
  `/weather/api/data`.
- Every overlay should be reloaded once after updating: OBS browser sources pick
  up the new `?v=` scripts on reload (enable “Refresh browser when scene becomes
  active” if you want that automatically).
- The dashboard and OBS cannot share `BroadcastChannel`/`storage` events (OBS has
  its own CEF storage partition). Data updates travel over HTTP through the hub;
  see the root README.
