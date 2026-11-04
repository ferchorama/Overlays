# Changelog

All notable changes to the overlays hub. The four widgets ship independently —
each has its own `meta.version` and cache-buster — so versions are listed per
app. This entry describes the current working tree (nothing is tagged yet).

## 2026-11-02

### Versions

| App | Version | Saved configs found in the wild |
|---|---|---|
| Vertical Weather | **3.3.1** | 3.1.7 |
| Digital Assets Market | **1.3.6** | 1.1.6 |
| Prediction Markets | **1.4.1** | 1.3.0 |
| Talking Points | **1.2.1** | 1.1.1 |

All older saved configs migrate automatically on load.

---

### Digital Assets Market — 1.3.6

**Changed**
- **Commodities are now commodity prices, not tokenised ETF shares.** The five
  rows use a new free `/market/api/commodities` feed: gold and silver are spot
  XAU/XAG, while WTI, natural gas and copper use Yahoo's front-month futures
  (the continuously quoted benchmark). Prices carry their units (`/oz`, `/bbl`,
  `/MMBtu`, `/lb`), and the row labels/tickers are XAU, XAG, CL, NG and HG.
  Gold/silver use neutral Au/Ag marks instead of the GLD/SLV ETF badges.
- The spot feed is cached for 60 s in the hub; the normal board build still
  fetches crypto and tokenised equities through CoinGecko as before.

---

### Digital Assets Market — 1.3.5

**Fixed**
- Adding an asset no longer blocks the dropdown on a second market lookup when
  the search hit already carries a market-cap rank — it commits immediately. A
  newly added id renders a loading row while its quote lands instead of showing
  a permanent-looking "no market data" placeholder.

---

### Digital Assets Market — 1.3.4

**Fixed**
- The X/diamond behind Circle, Galaxy and the six equity marks was the **xStocks
  platform motif** baked into CoinGecko's generated `Ticker_*` share images, not
  part of any company logo. Those nine rows now use clean company/fund marks, and
  local `assetImages` URLs get a `?v=<version>` suffix so an OBS reload cannot
  keep a cached copy of an old logo.
- NATGAS and Crude Oil WTI used two crops of the same USCF fuel-droplet mark, so
  they read as the same icon at 44px. They now point at distinct local marks —
  `natgas-flame.png` and `crude-oil-drop.png` — and the old files are removed so
  a cached copy cannot survive the OBS reload.
- The tokenised rows were showing the **Robinhood issuer feather** on Circle,
  Coinbase, Strategy, Galaxy Digital and Gold/Silver/Crude — one badge reused for
  every Robinhood token — and generic Ondo "USOF" badges on NATGAS/Copper. A new
  `assetImages` map points all 18 ids at local 128px PNGs of the company/fund
  mark in `assets/logos/`, so the board now shows the Coinbase C, the Strategy
  wordmark, the Circle ring, SpaceX, GLD, SLV, CPER and the rest. Anything not
  listed keeps the provider image (the initials layer is still the 404 fallback).

**Removed**
- **DINO COINS** tab removed from the shipped defaults and the saved
  `config.json` (litecoin, ripple, stellar, bitcoin-cash, dogecoin). The other
  sections are untouched; it can be re-created from the Categories tab if needed.

**Added**
- **CRYPTO EQUITIES, COMMODITIES and EQUITIES** sections with the requested
  roster: Securitize (SECZ), Circle (CRCL), Coinbase (COIN), Strategy (MSTR),
  Galaxy Digital (GLXY) and Robinhood (HOOD); gold, silver, NATGAS, WTI crude and
  copper; NVIDIA, Apple, Microsoft, Amazon, Meta, Tesla and SpaceX. They are
  tokenised proxies priced through the same CoinGecko markets endpoint and cache
  as the crypto rows, so no new provider or columns were needed. All three ship
  in `config.js` **and** the saved `config.json`;
  `?category=crypto-equities|commodities|equity` opens them directly.
- `assetLabels` maps those provider ids to the on-air name and ticker, so a row
  reads "Robinhood · HOOD" instead of "Robinhood Markets (Backpack Securities) ·
  HOOD"; Gold, Silver, NATGAS, Crude Oil WTI and Copper replace the long ETF /
  Ondo token names. Price and trend still come from the provider.
- The EQUITIES tab replaced the earlier xStock ETF roster (SP500, Nasdaq,
  Alphabet are no longer in it); every other section is unchanged.

**Operational**
- Those 18 tokenised ids are **CoinGecko-only**: CoinPaprika does not list them,
  so if the fallback answers those rows show "no market data" rather than a
  different token's price. The ids are declared in `COINGECKO_ONLY` and the hub
  test checks that every shipped id is either mapped or declared there.

---

### Vertical Weather — 3.3.1

**Changed**
- **The scrolling backdrop is now an editorial choice, not a weather mapping.**
  The Look tab has a thumbnail picker for the 13 day/neutral plates; the selected
  `backdrop.image` stays put while the live conditions change. The old
  condition/day-night lookup is gone, and night plates are no longer offered.
- **City clocks are real wall clocks.** Each card renders the current time in
  the city's IANA zone (`Intl.DateTimeFormat`) and updates every 15 s, instead of
  printing the provider's rounded observation timestamp and freezing between
  refreshes. A UTC-offset fallback covers a zone the browser cannot resolve.

**Fixed**
- New York and Miami (both Eastern) now read the same local time at the same
  instant; a Pacific city is correctly three hours behind, not two.

---

### Talking Points — 1.2.1

**Added**
- **Background tab** with a thumbnail picker for the weather widget's 13
  black-and-white plates (`../weather/backdrops/`), plus moving-background
  enable, opacity, blur, pan seconds and scrim tint.
- The chosen plate drifts behind the panel with the same two-layer crossfade and
  ping-pong pan as the weather widget. Bands and rows go transparent under it and
  a light scrim keeps the navy ink at WCAG AA over both photo extremes.
- The picker reads `weather/backdrops/_manifest.json` when the hub is serving the
  page, with the shipped list as the offline fallback. Plates are referenced, not
  copied.

**Changed**
- Cache-busters and `config.json` move to **1.2.1**; the version-aware migration
  adds the new `backdrop` block without touching saved content.

**Fixed**
- Choosing a plate no longer fades in and then blanks when the live config poll
  remounts the panel: the backdrop image key is now cleared with the layers, so
  `applyBackdrop()` cannot mistake a fresh layer for the already-painted one.

---

## 2026-10-24

### Versions

| App | Version | Saved configs found in the wild |
|---|---|---|
| Vertical Weather | **3.2.8** | 3.1.7 |
| Digital Assets Market | **1.2.0** | 1.1.6 |
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

### Vertical Weather — 3.2.8

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

**Added**
- **Scrolling backdrop**: the panel can sit on one of 18 generated
  black-and-white 4:3 plates in `weather/backdrops/` — one per WMO group, with
  day/night variants for the five groups whose icon set differs. Two layers
  crossfade when the condition changes and pan slowly sideways; a scrim keeps the
  ink legible. Controls: Look tab → **Scrolling backdrop** (enable, day/night,
  opacity, blur, pan seconds, tint) or `backdrop` in `config.js`;
  `enabled:false` restores the plain glass slab.
- The plate is only shown once it has loaded (no transparent slab while opening)
  and a missing file falls back to `overcast.webp`.

**Removed**
- The weather-driven sky backdrop experiment (`backdrop.js`, its per-card scene
  CSS, the admin “Weather scene” controls and its tests). Superseded by the plate
  backdrop above; no photo, image source, licence or attribution is involved.

**Fixed**
- Over the plate the panel outline read as an incomplete rectangle: the 1px
  translucent border disappeared on the darker half of the photograph, and the
  accent stripe only spans 12–88% of the left edge. The backdrop now draws a full
  hairline ring and the partial accent stripe is hidden while a plate is on.
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
- `README.md` is a short install-and-use guide: overview, install on this and
  another Windows machine, URLs, command API, settings, version tags and three
  troubleshooting lines.
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
