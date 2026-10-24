# The Rollup overlays hub

Four OBS browser-source graphics for *The Rollup* — Vertical Weather, Talking
Points, Digital Assets Market and Prediction Markets — served by one
zero-dependency Node process on one port. Each overlay has a control panel that
writes to the same store its source reads, so an edit is on air within a couple
of seconds without touching OBS.

```
node server.js            → http://localhost:8790
PORT=9000 node server.js  → custom port
```

Needs **Node 18 or newer**. No `npm install`, no build step, no dependencies;
every overlay vendors its own GSAP.

## Install

### On this machine

Double-click `start.bat`. It checks for Node (and installs it if missing), checks
the port and opens the hub page.

Other ways in: `start.bat --check` runs the checks without starting anything,
`node server.js` starts the hub directly, and macOS/Linux use `./start.command`.

### On another Windows machine

Put `update.bat` in the folder that should hold the overlays and double-click it.
The first run clones the repository; later runs only fast-forward to the newest
commits.

```
curl.exe -fL -o update.bat https://raw.githubusercontent.com/ferchorama/Overlays/main/update.bat
```

The repository is public, so no GitHub account is needed. Git must be present:
`update.bat` installs it with winget, and if winget is not available it prints
the Git for Windows download link. Options: `update.bat D:\OBS\Overlays` targets
another folder, `--zip` installs without Git, `--start` launches the hub when it
is done.

Saved settings are preserved across updates, `state.json` is left alone, and an
update can only move forward — it never force-pushes or rewrites history. Then
double-click `start.bat`.

## URLs

| Overlay | OBS source size | Source | Control panel |
|---|---|---|---|
| Vertical Weather | **460×1080** | `/weather/index.html` | `/weather/admin.html` |
| Talking Points | 1920×1080 | `/topics/index.html` | `/topics/admin.html` |
| Digital Assets Market | 1920×1080 | `/market/index.html` | `/market/admin.html` |
| Prediction Markets | 1920×1080 | `/predictions/index.html` | `/predictions/admin.html` |

The hub page at `http://localhost:8790/` lists all four with copy-ready URLs.

## Driving an overlay

```
GET  /{app}/api/command?action=in             # bump the command sequence
GET  /{app}/api/state                         # what the source is polling
GET  /{app}/api/config                        # the saved settings
POST /{app}/api/config                        # save settings (JSON object)
```

| App | Actions |
|---|---|
| weather | `in` `play` `hide` `out` `refresh` `update` |
| topics | `in` `out` `replay` |
| market | `in` `hide` `refresh` `update` `next` `prev` |
| predictions | `in` `out` `replay` `next` `prev` `show` `refresh` `update` |

Commands are stored in `{app}/state.json` and replayed by the source, so a missed
poll never skips or double-fires one.

## Settings

Every panel saves `config.json` beside its overlay and the source reads it, so
changes reach air without touching OBS. Settings persist across updates: a
version bump keeps every value you saved that still exists, fills in new options
and drops retired ones. The weather, market and prediction boards fetch their
provider once per load through the hub, which caches and de-duplicates the calls;
the **Update now** button on those panels forces one fresh read.

## Versions

The `v2026.10.24.*` tags mark every pushed state; `git tag --list 'v*'` lists
them, the [tags page](https://github.com/ferchorama/Overlays/tags) downloads any
one as a zip, and `git checkout <tag>` puts the folder on that state.
[CHANGELOG.md](CHANGELOG.md) says what changed in each.

## If something is wrong

- **`port 8790 is already in use`** — another hub is running. Stop it, or
  `set PORT=9000`.
- **A panel says "local only"** — open it from the hub URL, not from disk.
- **A source shows old content** — hard-reload the source in OBS.

Everything else — data flow, provider proxies, settings internals, tests, layout,
packaging and rollback commands — is in [REFERENCE.md](REFERENCE.md).