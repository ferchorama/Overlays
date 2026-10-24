#!/usr/bin/env node
/* ============================================================================
   Contrast gate — the wcag-audit-patterns rule, made executable.

   A browser source composites over live video, so the effective background is
   the glass tint (+ card surface) composited over the video pixel. This script
   composites the shipped palette over BLACK and over WHITE video (the two
   extremes), then measures every text token against it.

     node tests/contrast.js

   AA thresholds: 4.5:1 body text, 3:1 for large text (>=24px or >=18.66px bold).
   ========================================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global;
require(path.join(ROOT, 'config.js'));
const cfg = global.WX_DEFAULT_CONFIG;

/* ---------------------------------------------------------------- colour */
function parse(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1
});
function lum(c) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* -------------------------------------------------- composited backgrounds */
const tint = parse(cfg.panel.background);
const surface = (stop) => parse(cfg.surfaces.day[stop].color);
const layer = (video) => over(surface(1), over(surface(0), over(tint, video)));
const BG = { black: layer({ r: 0, g: 0, b: 0, a: 1 }), white: layer({ r: 255, g: 255, b: 255, a: 1 }) };

/* ------------------------------------------------------------- text tokens */

/* ------------------------------------------------- slab vibe (not dark/grey) */
function hsl(c) {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: sat, l };
}
const vibe = hsl(BG.black);
const LIGHT_MIN = 0.55;   /* must read as a light surface            */
const SAT_MIN = 0.25;     /* must carry hue, not grey                */
const night = (() => {
  const t = parse(cfg.panel.background);
  const s = (i) => parse(cfg.surfaces.night[i].color);
  return hsl(over(s(1), over(s(0), over(t, { r: 0, g: 0, b: 0, a: 1 }))));
})();
const vibeChecks = [
  ['slab is light (not dark)', vibe.l >= LIGHT_MIN, 'L=' + vibe.l.toFixed(2) + ' (min ' + LIGHT_MIN + ')'],
  ['slab is colourful (not grey)', vibe.s >= SAT_MIN, 'S=' + vibe.s.toFixed(2) + ' (min ' + SAT_MIN + ')'],
  ['night surface is light too', night.l >= LIGHT_MIN, 'L=' + night.l.toFixed(2)],
  ['day and night differ in hue', Math.abs(vibe.h - night.h) > 15 || vibe.s < 0.05, 'day ' + Math.round(vibe.h) + '° / night ' + Math.round(night.h) + '°']
];

/* ------------------------------------------------------------- text tokens */
const TOKENS = [
  ['city name', cfg.card.cityBand.color, 30, false],
  ['city clock', cfg.card.cityBand.timeColor, 17, false],
  ['temperature', cfg.card.body.temp.color, 170, true],
  ['condition', cfg.card.body.condition.color, 28, true],
  ['high / low', cfg.card.body.range.color, 23, false],
  ['stat value', cfg.card.details.valueColor, 34, true],
  ['stat label', cfg.card.details.labelColor, 13, false],
  ['footer', cfg.footer.color, 14, false]
];

console.log('\n  Light-theme contrast gate');
console.log('  effective slab over black video: rgb(' +
  [BG.black.r, BG.black.g, BG.black.b].map((v) => Math.round(v)).join(',') + ')   over white video: rgb(' +
  [BG.white.r, BG.white.g, BG.white.b].map((v) => Math.round(v)).join(',') + ')');
console.log('  ' + '-'.repeat(64));

let failures = 0;
for (const [name, colour, size, large] of TOKENS) {
  const c = parse(colour);
  const need = (large || size >= 24) ? 3.0 : 4.5;
  const rBlack = ratio(c, BG.black);
  const rWhite = ratio(c, BG.white);
  const worst = Math.min(rBlack, rWhite);
  const pass = worst >= need;
  if (!pass) failures++;
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name.padEnd(12) +
    ' ' + String(colour).padEnd(24) +
    ' over black ' + rBlack.toFixed(2) + ':1   over white ' + rWhite.toFixed(2) + ':1' +
    '   needs ' + need.toFixed(1) + ':1');
}
console.log('  ' + '-'.repeat(64));
console.log('  ' + (TOKENS.length - failures) + '/' + TOKENS.length + ' tokens pass AA at the worst video extreme');
for (const [name, pass, info] of vibeChecks) {
  if (!pass) failures++;
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name.padEnd(30) + ' ' + info);
}
console.log('  slab: hsl(' + Math.round(vibe.h) + ', ' + Math.round(vibe.s * 100) + '%, ' + Math.round(vibe.l * 100) + '%)  day · hsl(' + Math.round(night.h) + ', ' + Math.round(night.s * 100) + '%, ' + Math.round(night.l * 100) + '%)  night');
console.log('  lightness of the slab (0 = black, 1 = white): ' +
  ((lum(BG.black) + lum(BG.white)) / 2).toFixed(2) + '\n');

process.exit(failures ? 1 : 0);
