#!/usr/bin/env node
/* ============================================================================
   Type-size test — the legibility floor for the hero lockup.

     node tests/type.js

   Why this exists: with two cities the hero body is only ~340px tall, and the
   first implementation scaled the icon AND the type by one factor. The layout
   "fit", but the condition rendered at 18px and the high/low at 15px — which is
   exactly the "some texts are too small" bug. Reported sizes are in the README.

   These tests pin the two halves of the fix:
     1. computeHeroScales keeps hero TYPE at or above TEXT_FLOOR, and makes the
        icon absorb the shrink instead.
     2. the configured point sizes for the small print meet legibility minimums.
   ========================================================================== */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ DOM shim */
function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '', children: [], dataset: {},
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    textContent: '', clientWidth: 420, clientHeight: 120,
    scrollWidth: 200, scrollHeight: 60, offsetHeight: 120, offsetWidth: 100,
    firstChild: null, _html: '',
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      contains(c) { return this._set.has(c); },
      toggle(c, f) { const on = f === undefined ? !this._set.has(c) : !!f; on ? this._set.add(c) : this._set.delete(c); return on; }
    },
    appendChild(c) { this.children.push(c); this.firstChild = this.children[0]; return c; },
    append(...c) { c.forEach((x) => this.appendChild(x)); },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; this.firstChild = v ? { nodeType: 1 } : null; }
  };
  return node;
}

const ids = {};
const documentShim = {
  readyState: 'complete',
  head: makeNode('head'), body: makeNode('body'), documentElement: makeNode('html'),
  createElement: makeNode,
  getElementById(id) { if (!ids[id]) { ids[id] = makeNode('div'); ids[id].id = id; } return ids[id]; },
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
};

const store = {};
global.window = global;
global.document = documentShim;
global.location = { search: '?nosync=1', href: 'http://localhost/', protocol: 'http:' };
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
global.innerWidth = 1920; global.innerHeight = 1080;
global.addEventListener = () => {};
global.getComputedStyle = () => ({ lineHeight: '20px' });
global.gsap = {
  timeline() {
    const tl = {};
    ['from', 'to', 'set', 'add', 'kill', 'delay'].forEach((k) => { tl[k] = () => tl; });
    tl.progress = () => 1; tl.duration = () => 3.3;
    tl.play = () => tl; tl.pause = () => tl;
    return tl;
  },
  set: () => {}, from: () => {}, to: () => {}
};
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

/* ------------------------------------------------------------------- boot */
require(path.join(ROOT, 'icons.js'));
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'script.js'));

const CFG = global.window.WX_DEFAULT_CONFIG;
const Panel = global.window.WX.Panel;

const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

/* ------------------------------------------------- 1. the fit algorithm */
const fits = Panel.computeHeroScales;

/* measured from the real render at 460x1080 with two cities */
const ICON_H = 250;                       // iconSize at scale 1
const READ_H = 160 * 0.96 + 30 * 1.15 + 25 + 4;   // temp + condition + range + gaps
const BODY_2_CITY = 336;                  // measured body height, 2 cities
const BODY_1_CITY = 852;                  // measured body height, 1 city

const one = fits(BODY_1_CITY, ICON_H, READ_H);
check('one city: nothing is scaled', one.text === 1 && one.icon === 1,
  'text=' + one.text + ' icon=' + one.icon);

const two = fits(BODY_2_CITY, ICON_H, READ_H);
check('two cities: type stays at or above the floor', two.text >= 0.86,
  'text-scale=' + two.text);
check('two cities: icon absorbs the shrink', two.icon < two.text,
  'icon=' + two.icon + ' < text=' + two.text);
check('two cities: lockup fits the body', two.fits === true,
  'used=' + Math.round(READ_H * two.text + ICON_H * two.icon + 6) + '/' + BODY_2_CITY);

/* the regression itself: the old single-scale maths drove the high/low to ~15px.
   These are the HISTORICAL constants (v3.0.x), kept so the bug can never return
   quietly — the old range was 23px in a 318px body and rendered at 14.9px. */
const OLD_ICON_H = 250, OLD_BODY = 318, OLD_RANGE_SIZE = 23;
const OLD_READ_H = 170 * 0.96 + 28 * 1.15 + OLD_RANGE_SIZE + 4;
const oldUniform = (OLD_BODY - 6) / (OLD_ICON_H + OLD_READ_H);
const oldRangePx = OLD_RANGE_SIZE * oldUniform;
const newRangePx = CFG.card.body.range.size * two.text;
check('old maths would have rendered the high/low too small', oldRangePx < 16,
  oldRangePx.toFixed(1) + 'px');
check('new maths renders the high/low legibly', newRangePx >= 20,
  newRangePx.toFixed(1) + 'px');

/* extremes must never clip: the text may give, but only down to the hard floor */
const tiny = fits(120, ICON_H, READ_H);
check('extreme squeeze: icon floors, never negative', tiny.icon === 0.3, 'icon=' + tiny.icon);
check('extreme squeeze: type never falls below the hard floor', tiny.text >= 0.62,
  'text=' + tiny.text);
/* when the space is genuinely impossible it must SAY so, not pretend to fit */
check('extreme squeeze: reports honestly when it cannot fit', tiny.fits === false,
  'used=' + Math.round(READ_H * tiny.text + ICON_H * tiny.icon + 6) + '/120');

check('degenerate input does not produce NaN', (() => {
  const r = fits(0, 0, 0);
  return isFinite(r.text) && isFinite(r.icon);
})(), 'avail=0, icon=0, read=0');

/* ------------------------------------------- 2. configured small print */
const MIN = {
  'card.cityBand.timeSize': [CFG.card.cityBand.timeSize, 18, 'city local time'],
  'card.body.condition.size': [CFG.card.body.condition.size, 24, 'condition'],
  'card.body.range.size': [CFG.card.body.range.size, 22, 'high/low'],
  'card.details.labelSize': [CFG.card.details.labelSize, 14, 'stat label'],
  'card.details.valueSize': [CFG.card.details.valueSize, 32, 'stat value'],
  'footer.size': [CFG.footer.size, 15, 'footer']
};
Object.keys(MIN).forEach((key) => {
  const [actual, floor, label] = MIN[key];
  check('small print is big enough: ' + label, actual >= floor, actual + 'px (min ' + floor + 'px)');
});

/* the details row must not be so short that the bigger type is cramped */
const needed = CFG.card.details.valueSize + CFG.card.details.labelSize + 5 + 20;
check('details row has room for its type', CFG.card.details.height >= needed,
  CFG.card.details.height + 'px for ' + needed + 'px of content');

/* --------------------------------------- 3. hero type inherits the floor */
const src = require('fs').readFileSync(path.join(ROOT, 'script.js'), 'utf8');
check('icon and type no longer share one scale',
  /--icon-scale/.test(src) && /--text-scale/.test(src) && !/--hero-scale/.test(src),
  'text-scale + icon-scale, no hero-scale');
check('fitStatValues is no longer gated on the unset rowsEl',
  !/this\.rowsEl\s*\?/.test(src), 'dead-code guard removed');

/* ----------------------------------------------------------------- report */
let failed = 0;
console.log('\n  weather overlay type-size test\n  ' + '-'.repeat(52));
results.forEach((r) => {
  if (!r.pass) failed++;
  console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : ''));
});
console.log('  ' + '-'.repeat(52));
console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
process.exit(failed ? 1 : 0);
