# Skills used to rebuild the hub

Five public **agent skills** (SKILL.md packages found on GitHub) were downloaded
into [`.skills/`](.skills), read, and applied to `index.html`. Each row says where
it came from and what it actually changed here.

Everything under `.skills/` is third-party reference material (see each repo for
its licence). Nothing there is loaded at runtime by the hub — and the server
enforces that by refusing any request whose path contains a dot-segment, so the
trees cannot be fetched directly either.

| # | Skill | Source | What it changed in the hub |
|---|---|---|---|
| 1 | `taste-skill` (design-taste-frontend) | [BND-1/taste-skill](https://github.com/BND-1/taste-skill) | Killed the three-equal-cards layout — its "100 AI tells" bans the 3-column card row outright. Drove the switch to a numbered index of rows, the ban on outer glows (shadows are tinted and inset instead), the desaturated accent, and the staggered reveal. |
| 2 | `gpt-tasteskill` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | The 2–3 line iron rule for the H1 (it is set in a 21ch measure at 46px, never wrapping past two lines), the gapless grid, card restraint, and hover physics on the rows. |
| 3 | `brutalist-skill` (Swiss Industrial Print) | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Macro/micro type split: structural headings in the sans, every piece of *telemetry* — ports, versions, URLs, API paths — in monospace with tabular numerals. Also the numbered `01 / 02 / 03` index column. |
| 4 | `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Ground the design in the subject matter. This is an operator's control surface, not a landing page, so it reads as an instrument panel: status bar with a live pulse, a counters strip, and a rail for the API and legacy ports. |
| 5 | `hallmark` | [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | Pick a macrostructure before writing CSS, and run the slop test at the end. Token discipline: no inline hex outside the `:root` palette blocks. |

A sixth, `taste-skills-multi` ([Dragoon0x/taste-skills](https://github.com/Dragoon0x/taste-skills)),
was downloaded and read but its guidance overlapped the five above, so nothing
distinct from it shipped.

## Concrete changes that came out of the skills

1. **The banned layout, removed.** The hub was three identical cards side by side —
   the single pattern the taste skill names as a tell. It is now an asymmetric
   two-column board: a numbered index of overlays at `1.62fr`, a reference rail at
   `1fr`, grouped by rules rather than boxed in cards.
2. **Contrast gate found a real bug.** Measuring the rebuilt palette, six light-theme
   elements failed WCAG AA at **3.47:1** — the counter labels, row index, rail
   headings, port notes, pills and footer all used `--ink-faint: #6b8394`. Solved
   for the worst point across the whole background wash and darkened it to
   `#566e80` (**4.67:1**). All 22 text elements now pass in both themes.
3. **No outer glows.** Every shadow is inset-highlight plus a downward shadow tinted
   to the background hue, per the taste skill's ban on `box-shadow` bloom.
4. **Perpetual micro-motion, cheaply.** The status dot pings on an infinite loop.
   It animates `transform` and `opacity` only, and the grain texture sits on a
   `position: fixed; pointer-events: none` layer so it never repaints on scroll.
5. **Staggered reveal.** Rows rise in sequence via `animation-delay: calc(var(--i) * 70ms)`
   with a single `cubic-bezier(.16,1,.3,1)` easing — no linear easing anywhere.
6. **Tactile states.** Every button has an `:active` transform, and `:focus-visible`
   rings throughout.
7. **Desktop only, deliberately.** The viewport is pinned at `width=1280` and there
   is no breakpoint below it. This page only ever runs on the OBS machine.

## Bringing the control panels with it

The three original control panels (`weather/`, `topics/`, `market/`) were dark,
blue-accented, and carried a `box-shadow: 0 0 12px` glow on the brand dot — a tell
the taste skill bans by name. They now share the hub's palette and craft, and
`predictions/` — added after this pass — reads the same shared theme key:

- **One source of truth for the theme.** The panels read the same
  `obs-overlays-theme` key from `localStorage`. Same origin, so switching the hub
  switches every panel with it; there is no second preference to drift.
- **Kept the variable names, swapped the values.** `--bg`, `--bg-2`, `--txt`,
  `--muted` and friends are unchanged in name, so all ~550 lines of existing rules
  kept working. Only the tokens and the hardcoded strays changed — verified at
  **0 colours outside the palettes** across those stylesheets.
- **Glow removed**, insets added, and the topbar now shares the hub's hairline.
- **Inter dropped.** It was loaded from Google Fonts and is banned by the taste
  skill; the panels now use the hub's system stack. Montserrat was being fetched
  in all three panels and referenced by none — that request is gone too.
- **Rendering cost:** the panels no longer make any third-party font request.

## Verification

Every claim above was measured, not asserted:

- Contrast: 22 text elements sampled on the live rendered page in both themes.
- Layout: both themes rendered headless at 1440×1120 and inspected.
- Copy buttons: driven with a **trusted** click over the DevTools Protocol, on
  `localhost` (secure context → `navigator.clipboard`) and on the LAN IP
  (insecure → `execCommand` fallback), confirming the clipboard actually holds the URL.
