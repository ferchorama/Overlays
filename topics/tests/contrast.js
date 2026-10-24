#!/usr/bin/env node
/* ============================================================================
   Contrast + vibe gate for the Talking Points panel.

     node tests/contrast.js

   Two things are checked, both learned the hard way on the weather widget:

   1. LEGIBILITY. A browser source composites over live video, so the effective
      background is the glass tint, then the band/row surface, composited over
      the video pixel. This script composites the shipped palette over BLACK and
      over WHITE video — the two extremes — and measures every ink token against
      the result. AA: 4.5:1 body, 3:1 large (>=24px or >=18.66px bold).

   2. VIBE. The theme must stay LIGHT and COLOURFUL. "It went dark and grey
      again" was a recurring regression, so lightness/saturation are asserted
      rather than eyeballed.
   ========================================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global;
require(path.join(ROOT, 'config.js'));
const cfg = global.TP_DEFAULT_CONFIG;

/* ---------------------------------------------------------------- colour */
function parse(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const h = m[1];
    const n = parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
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
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: sat, l };
}

/* -------------------------------------------------- composited backgrounds */
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const tint = parse(cfg.panel.background);
const midStop = (arr) => parse(arr[Math.floor(arr.length / 2)].color);
const topStop = (arr) => parse(arr[0].color);

/* row background = row gradient over the slab over the video */
function rowBg(video) { return over(midStop(cfg.topics.gradient), over(tint, video)); }
function topRowBg(video) { return over(topStop(cfg.topics.gradient), over(tint, video)); }
function headerBg(video) { return over(topStop(cfg.header.gradient), over(tint, video)); }
function subBg(video) { return over(topStop(cfg.subtitle.gradient), over(tint, video)); }

const BG = {
  rowBlack: rowBg(BLACK), rowWhite: rowBg(WHITE),
  topRowBlack: topRowBg(BLACK), topRowWhite: topRowBg(WHITE),
  headerBlack: headerBg(BLACK), headerWhite: headerBg(WHITE),
  subBlack: subBg(BLACK), subWhite: subBg(WHITE),
  slabBlack: over(tint, BLACK), slabWhite: over(tint, WHITE)
};

/* ------------------------------------------------------------- text tokens */
const TOKENS = [
  /* [label, colour, min ratio, sample backgrounds] */
  ['row text (top of row)', cfg.topics.text.color, 4.5, ['topRowBlack', 'topRowWhite']],
  ['row text (middle of row)', cfg.topics.text.color, 4.5, ['rowBlack', 'rowWhite']],
  ['title (TODAY\'S TOPICS)', cfg.header.title.color, 3.0, ['headerBlack', 'headerWhite']],
  ['subtitle / date', cfg.subtitle.color, 3.0, ['subBlack', 'subWhite']]
];

const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

TOKENS.forEach(([label, colorStr, min, bgs]) => {
  const ink = parse(colorStr);
  const worst = bgs
    .map((k) => ({ k, r: ratio(ink, BG[k]) }))
    .sort((a, b) => a.r - b.r)[0];
  check(label + ' meets AA', worst.r >= min,
    worst.r.toFixed(1) + ':1 on ' + worst.k + ' (min ' + min + ':1)');
});

/* --------------------------------------------- vibe: light and colourful */
const slabDay = BG.slabBlack;
const slabHsl = hsl(slabDay);
check('slab stays light over dark video', slabHsl.l >= 0.55,
  'L=' + slabHsl.l.toFixed(2) + ' (min 0.55)');
check('slab stays colourful (not grey)', slabHsl.s >= 0.25,
  'S=' + slabHsl.s.toFixed(2) + ' (min 0.25)');

const rowHsl = hsl(BG.rowBlack);
check('rows stay light over dark video', rowHsl.l >= 0.55, 'L=' + rowHsl.l.toFixed(2));
check('rows stay colourful (not grey)', rowHsl.s >= 0.25, 'S=' + rowHsl.s.toFixed(2));

const headerHsl = hsl(BG.headerBlack);
check('header band is azure, not grey', headerHsl.s >= 0.25,
  'H=' + headerHsl.h.toFixed(0) + '° S=' + headerHsl.s.toFixed(2));

/* The two video extremes must read as the SAME theme. A translucent tint
   always shifts a little in lightness, and that is fine — what matters is that
   it never goes dark, and that the hue is stable. Letting the video dominate
   the tint was what made the old build read as "dark" and "grey". */
const slabWhiteHsl = hsl(BG.slabWhite);
let hueDelta = Math.abs(slabHsl.h - slabWhiteHsl.h);
if (hueDelta > 180) hueDelta = 360 - hueDelta;
check('slab hue is stable over black and white video', hueDelta < 12,
  hueDelta.toFixed(1) + '° apart (' + slabHsl.h.toFixed(0) + '° vs ' + slabWhiteHsl.h.toFixed(0) + '°)');
check('slab never goes dark over either extreme',
  Math.min(slabHsl.l, slabWhiteHsl.l) >= 0.55,
  'worst L=' + Math.min(slabHsl.l, slabWhiteHsl.l).toFixed(2));

/* no near-black ink and no grey surfaces anywhere in the shipped palette */
const inks = [
  ['title', cfg.header.title.color], ['subtitle', cfg.subtitle.color],
  ['row text', cfg.topics.text.color]
];
const darkInk = inks.filter(([, c]) => lum(parse(c)) < 0.02);
check('no near-black ink tokens', darkInk.length === 0,
  darkInk.map(([n]) => n).join(', ') || inks.length + ' tokens checked');

/* every preset must be light too, or one click undoes the theme */
const adminJs = require('fs').readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const presetNames = [...adminJs.matchAll(/^\s{4}([a-z]+):\s*\{\n\s*panel: \{ background: '([^']+)'/gm)]
  .map((m) => ({ name: m[1], bg: m[2] }));
check('presets found in the admin', presetNames.length >= 3, presetNames.map((p) => p.name).join(', '));
const darkPresets = presetNames.filter((p) => {
  const c = parse(p.bg);
  return hsl(over(c, BLACK)).l < 0.55;
});
check('every preset is light over dark video', darkPresets.length === 0,
  darkPresets.map((p) => p.name + ' L=' + hsl(over(parse(p.bg), BLACK)).l.toFixed(2)).join(', ') ||
  presetNames.length + ' presets checked');

/* presets must also carry alpha, or the glass goes flat and grey */
const flatPresets = presetNames.filter((p) => parse(p.bg).a >= 1);
check('every preset background is translucent', flatPresets.length === 0,
  flatPresets.map((p) => p.name).join(', ') || 'all have alpha');

/* ----------------------------------------------------------------- report */
let failed = 0;
console.log('\n  talking points — contrast + vibe gate\n  ' + '-'.repeat(58));
results.forEach((r) => {
  if (!r.pass) failed++;
  console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : ''));
});
console.log('  ' + '-'.repeat(58));
console.log('  slab over black: hsl(' + slabHsl.h.toFixed(0) + ', ' +
  (slabHsl.s * 100).toFixed(0) + '%, ' + (slabHsl.l * 100).toFixed(0) + '%)');
console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
process.exit(failed ? 1 : 0);
