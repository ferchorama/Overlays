# Talking Points Panel — animated OBS overlay

A rebuild of the *Talking Points Panel* overlay (the uno / Singular.live app at
`app.overlays.uno/control/4oceBOenWny4XCR5EGJN0J`) as plain **HTML + CSS + JS**
with **GSAP** for the animation — and a full control panel so every colour,
font, size, timing and text can be changed without touching code.

---

## What it does

* **Animated entrance only.** The panel animates IN (header drops in, topic rows
  cascade from the top, one every `rowStagger` seconds) and then **stays on
  screen**. There is deliberately **no out animation** — in OBS you just hide the
  browser source when you're done.
* **Fully customizable** — title, subtitle (or auto date), the topic list, every
  gradient stop, both fonts, sizes, letter-spacing, weights, panel geometry,
  border, shadow, entrance direction/duration/stagger/ease.
* **Live control** — an admin panel with a real-time preview, plus an HTTP API
  for a Stream Deck / Bitfocus Companion / `curl`.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The overlay itself. Point OBS at this. |
| `vendor/gsap.min.js` | Local GSAP build so the overlay works offline (CDN is the fallback). |
| `style.css` | Layout + themable CSS variables. |
| `script.js` | Config merge, DOM build, GSAP entrance, sync + control API. |
| `config.js` | **All default values / design tokens.** Edit here for permanent changes. |
| `admin.html` / `admin.css` / `admin.js` | The control panel (live preview + editors + presets). |
| `server.js` | Optional zero-dependency Node server: serves the files, stores `config.json`, exposes the command API. |
| `config.json` | Created by the server when you hit **Save** — the overlay polls it, so OBS follows your edits live. |

---

## Quick start

### 1. Simplest (no server)

1. OBS → **Add → Browser** → *Local file* → `index.html`.
2. Width `1920`, Height `1080`, **Shutdown source when not visible = off**.
3. The panel animates in on load and stays.

Change things permanently by editing `config.js`, or open `admin.html` directly,
customize, hit **Export** and paste the JSON into `config.js`.

### 2. Recommended (live control + Stream Deck)

Both overlays share **one** server — start it once and this widget is up too:

```bash
cd ~/Documents/Overlays
node server.js            # → hub at http://localhost:8790
```

* Control panel: <http://localhost:8790/topics/admin.html>
* OBS browser source: `http://localhost:8790/topics/index.html`

The old per-app port (`http://localhost:8787/index.html`) is no longer opened by
default. Point your OBS source at the `/topics/` URL above, or start the hub with
`LEGACY=1` if you would rather not re-wire it.

<details>
<summary>Running this widget on its own</summary>

```bash
cd topics           # from ~/Documents/Overlays
node server.js            # → http://localhost:8787
```

* Control panel: <http://localhost:8787/admin.html>
* OBS browser source URL: `http://localhost:8787/index.html`

</details>

Now every edit in the control panel is written to `config.json` and the running
OBS source picks it up within ~1.5 s **without replaying the entrance**.

### 3. OBS browser-source settings

| Setting | Value |
|---|---|
| Width / Height | `1920` × `1080` |
| Custom CSS | *(empty)* |
| Shutdown source when not visible | **off** |
| Refresh browser when scene becomes active | **off** |
| Control audio via OBS | off |

Transparency is automatic (`html, body { background: transparent }`).
The overlay designs on a fixed 1920×1080 stage and scales itself to whatever
size the source is, so a 1280×720 source still lines up exactly.

---

## Controls

| Action | Admin button | HTTP |
|---|---|---|
| Play the entrance | **▶ Play entrance** | `/api/command?action=in` |
| Hide instantly (off air) | **Hide** | `/api/command?action=out` |

Keyboard (overlay window): `i` plays the entrance.

### Stream Deck / Companion

Add a **Web Request** action pointing at
`http://localhost:8787/api/command?action=in` etc. — that's it.

---

## Customizing

The control panel has six tabs:

* **Content** — title, subtitle (with optional auto-date), show/hide bands,
  the topic list (drag ⠿ to reorder, ✕ to delete, click ⠿ to enable/disable), max rows.
* **Look** — every gradient (title band, subtitle band, row gradient with
  add/remove stops), text colours and sizes, row height,
  panel background/border/radius/shadow, gloss toggles.
* **Fonts** — Google Fonts list to load, plus font-family / weight /
  letter-spacing / UPPERCASE / max-lines / auto-shrink for each of the three
  text styles, and a **custom font CSS URL** for licensed fonts.
* **Layout** — stage size, panel X/Y/width, vertical anchor, band heights,
  row gap, separator, scale mode, horizontal alignment.
* **Animation** — entrance direction (top/bottom/left/right), travel distance,
  row duration/stagger/start delay/ease, header duration/ease, fade rows.
* **Presets** — four light presets that all match the weather widget's sky glass:
  **Sky Glass**, **Dusk Periwinkle**, **Lagoon** and **Sunrise**, plus raw JSON
  editing. There is deliberately no dark preset left — one that restored the old
  greys would undo the look in a single click.

Everything is written to `localStorage`, pushed to the live preview instantly,
and (with `server.js` running) saved to `config.json`.

### Fonts

* Title / subtitle: **Montserrat** (Google Fonts) — matches the original.
* Topic rows: the original uses a licensed **Proxima Nova A** served from the
  Singular account-fonts CDN. The default config points at that URL and falls
  back to **Figtree** → **Montserrat** if it can't load. Swap it in
  *Fonts → Topic font → Custom font CSS URL* for any other hosted font.

### URL parameters

| Parameter | Effect |
|---|---|
| `?fit=contain\|cover\|width\|none` | Override the scaling mode |
| `?configUrl=…` | Poll a different config endpoint |
| `?nosync=1` | Disable all polling (useful for screenshots/tests) |
| `?preview=1` | Marks the admin panel's preview iframe |

---

## How the animation is built

`script.js` builds one paused GSAP timeline (entrance only):

```js
tl.from(header,  { yPercent: -100, duration: headerDuration, ease: headerEase }, 0.1)
  .from(outline, { yPercent: -100, duration: headerDuration, ease: headerEase }, 0)
  .from([title, subtitle], { opacity: 0, y: -26, duration: textDuration, ease: textEase }, 0.5);

rows.forEach((row, i) => tl.from(row, {
  y: -rowDistance, opacity: 0,            // direction configurable
  duration: rowDuration, ease: rowEase
}, rowStart + i * rowStagger));
```

Defaults mirror the original composition: rows `power3.out` 1.0 s each, 0.1 s
stagger, first row at 0.3 s; header `power1.out` 0.5 s; texts fade in at 0.5 s.
Once the timeline completes the panel just stays there.

### The panel can never be left invisible

GSAP `.from()` applies its invisible start state **immediately**, so every row
sits at `opacity: 0` until the tween runs. If the entrance is interrupted — a
throttled or paused `requestAnimationFrame` in a hidden OBS browser source, a
dropped frame — the timeline stalls at its first frame and the panel stays blank
on air while the source is technically visible.

`play()` therefore arms a safety timer for `delay + timeline duration + 0.6 s`.
If the timeline still has not reached `progress() === 1` by then, it is snapped
straight to the finished state and a warning is logged:

```
[topics] entrance did not finish — snapping to the visible state
```

`showInstant()` and `hideInstant()` clear the timer so a manual command can
never race it. This is the same guard the weather widget already carried, and it
is what makes a settled headless screenshot possible (`--virtual-time-budget`
does not drive GSAP's rAF, so the timer is the only thing that finishes the
tween).

---

## Tests

```bash
node tests/smoke.js      # the panel engine: rows, title, entrance-once
node tests/contrast.js   # WCAG AA over the bands, and every preset stays light
node tests/admin.js      # the control panel: boots, wiring, editing, save
```

All three run the real files in a small DOM shim — no browser needed. `smoke.js`
covers the entrance starting exactly once (a GSAP `.delay()` on an already-playing
timeline re-begins it). `contrast.js` measures the row ink against the **top and
middle** gradient stops and asserts no preset can quietly go dark. `admin.js`
confirms the on-air highlight feature is really gone, that every bound field still
exists, and that a config saved by an older build keeps your title, date and topics
but takes the shipped look — the same stale-config rule the weather widget is
guarded by.

Current results: smoke **8/8**, contrast **15/15**, admin **31/31**.

---

## Caching & versions

OBS caches whatever the browser source loaded, so a changed `style.css` or
`script.js` can keep running the **old** code even after a restart. Every local
asset is therefore referenced with a version stamp:

```html
<link rel="stylesheet" href="style.css?v=1.0.1" />
<script src="script.js?v=1.0.1"></script>
```

After changing any file, raise the version everywhere at once:

```bash
node tools/bump.js          # patch  1.0.1 → 1.0.2   (the usual one)
node tools/bump.js minor    # 1.0.2 → 1.1.0
node tools/bump.js major    # 1.1.0 → 2.0.0
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

### Saved configs are migrated, not pinned

The control panel and the overlay each keep a full copy of the config
(`localStorage` and `config.json`). If that copy came from an older build it
used to win, so a palette fix would silently revert the next time the panel
rendered — the theme appearing to "change back" on the next edit.

`config-merge.js` fixes that: while `meta.version` is unchanged your saved
settings win; when the version changes, the saved config keeps only your
**content** (the rows, the title, the theme) and the shipped build supplies the
whole **look**. The panel header tells you when this happened.

Content is copied **by value and as-is**. An earlier build cloned with
`JSON.parse(JSON.stringify(o || {}))`, which turned a saved `false` into an empty
object — and `{}` is truthy, so `subtitle.autoDate: false` could come back ON after a
version bump. Falsy values now survive a migration unchanged.

