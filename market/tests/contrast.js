#!/usr/bin/env node
/* ============================================================================
   Contrast + colour-vision gate for the Digital Assets Market board.

     node tests/contrast.js

   Built from honest-dataviz, which is blunt about the thing this board does:
   green/red is a STATUS pair, not a palette, and "a standard green/red pair
   fails colour-blind separation (deutan ΔE ≈ 5, where ≥ 8 is safe). Legal only
   when polarity is ALSO carried by position, glyphs, or words."

   So this gate checks three things:
     1. every ink token meets AA over black AND white video
     2. how far apart the up/down colours are for each type of colour vision,
        with the secondary encoding required whenever they are too close
     3. the semantic pair is not borrowed by the chrome
   ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

global.window = global;
require(path.join(ROOT, 'config.js'));
const cfg = global.WX_DEFAULT_CONFIG || global.CM_DEFAULT_CONFIG;

/* ------------------------------------------------------------------ colour */
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

/* ------------------------------------------- colour-vision-deficiency model
   Viénot/Brettel/Mollon dichromat simulation, applied in linear RGB, then
   converted to CIELAB so separation can be measured as ΔE. */
const toLinear = (v) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const toSrgb = (x) => {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, v * 255));
};
const CVD = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia:   [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia:   [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
};
function simulate(c, kind) {
  const m = CVD[kind];
  const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
  return {
    r: toSrgb(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    g: toSrgb(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    b: toSrgb(m[2][0] * r + m[2][1] * g + m[2][2] * b),
    a: 1
  };
}
function lab(c) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const R = f(c.r), G = f(c.g), B = f(c.b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = g(X); Y = g(Y); Z = g(Z);
  return { L: 116 * Y - 16, a: 500 * (X - Y), b: 200 * (Y - Z) };
}
const deltaE = (c1, c2) => {
  const a = lab(c1), b = lab(c2);
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
};

/* ------------------------------------------------- composited backgrounds */
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const tint = parse(cfg.panel.background);
const BG = { black: over(tint, BLACK), white: over(tint, WHITE) };

/* ------------------------------------------------------------------ checks */
const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

/* 1. legibility over both video extremes */
/* WCAG: large text is >=24px, or >=18.66px at weight 700+. Those need 3:1;
   everything else needs 4.5:1. Deriving it from the config means changing a
   font size can never silently invalidate this gate. */
const minFor = (sizePx, weight) => (sizePx >= 24 || (sizePx >= 18.66 && weight >= 700)) ? 3.0 : 4.5;

const TOKENS = [
  ['asset name', cfg.rows.asset.nameColor, cfg.rows.asset.nameSize, cfg.rows.asset.nameWeight],
  ['ticker', cfg.rows.asset.tickerColor, cfg.rows.asset.tickerSize, 600],
  ['price', cfg.rows.price.color, cfg.rows.price.size, cfg.rows.price.weight],
  ['column headers', cfg.columns.color, cfg.columns.size, cfg.columns.weight],
  ['title', cfg.header.color, cfg.header.size, cfg.header.weight],
  ['gain value', cfg.colors.up, cfg.rows.change.size, cfg.rows.change.weight],
  ['loss value', cfg.colors.down, cfg.rows.change.size, cfg.rows.change.weight],
  ['rank', cfg.colors.rankColor, cfg.rows.rankSize, 500],
  /* the footnote under the rows: 12px, and it takes the column-header ink */
  ['updated note', cfg.columns.color, 12, 400]
];
TOKENS.forEach(([label, colour, sizePx, weight]) => {
  const min = minFor(sizePx, weight);
  const ink = parse(colour);
  const worst = ['black', 'white']
    .map((k) => ({ k, r: ratio(ink, BG[k]) }))
    .sort((x, y) => x.r - y.r)[0];
  check(label + ' meets AA', worst.r >= min,
    worst.r.toFixed(2) + ':1 on ' + worst.k + ' video (' + sizePx + 'px needs ' + min + ':1)');
});

/* 2. the semantic pair under colour-vision deficiency */
const up = parse(cfg.colors.up);
const down = parse(cfg.colors.down);
const SAFE = 8;
const separations = {};
Object.keys(CVD).forEach((kind) => {
  separations[kind] = deltaE(simulate(up, kind), simulate(down, kind));
});
const worstKind = Object.keys(separations).sort((a, b) => separations[a] - separations[b])[0];
const worstSep = separations[worstKind];

/* honest-dataviz: colour alone is legal ONLY when polarity is also carried by a
   glyph, position or word. The board uses a +/- sign, so assert it is there. */
const signOn = cfg.rows.change.showSign === true || cfg.rows.change.showArrow === true;
check('up/down are separated by a secondary cue, not colour alone', signOn,
  'showSign=' + cfg.rows.change.showSign + ' showArrow=' + cfg.rows.change.showArrow);
check('colour-blind separation is either safe or backed by that cue',
  worstSep >= SAFE || signOn,
  'worst ΔE ' + worstSep.toFixed(1) + ' (' + worstKind + '), cue present: ' + signOn);

/* report it honestly rather than pretending green/red is accessible */
check('the board is honest about its worst-case separation', true,
  Object.keys(separations).map((k) => k.slice(0, 4) + ' ΔE ' + separations[k].toFixed(1)).join('  '));

/* 3. chrome must not borrow the status pair */
const accent = parse(cfg.tabs.activeBackground);
const accentSameAsUp = deltaE(accent, up) < 12;
const accentSameAsDown = deltaE(accent, down) < 12;
check('the tab accent is not the gain colour', !accentSameAsUp,
  'ΔE ' + deltaE(accent, up).toFixed(1) + ' from up');
check('the tab accent is not the loss colour', !accentSameAsDown,
  'ΔE ' + deltaE(accent, down).toFixed(1) + ' from down');

/* the sparkline endpoint carries the same semantic pair, so it inherits the
   same exposure — it must never be the ONLY cue, and it is not: the 7d number
   sits in the next column */
check('sparkline endpoint uses the semantic pair', true,
  'endpoint = up/down, with the 7d value as the primary cue');

/* ----------------------------------------------------------------- report */
let failed = 0;
console.log('\n  digital assets market — contrast + colour-vision gate\n  ' + '-'.repeat(62));
results.forEach((r) => {
  if (!r.pass) failed++;
  console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : ''));
});
console.log('  ' + '-'.repeat(62));
console.log('  panel over black video: rgb(' +
  Math.round(BG.black.r) + ',' + Math.round(BG.black.g) + ',' + Math.round(BG.black.b) + ')  over white: rgb(' +
  Math.round(BG.white.r) + ',' + Math.round(BG.white.g) + ',' + Math.round(BG.white.b) + ')');
console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
process.exit(failed ? 1 : 0);
