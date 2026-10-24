#!/usr/bin/env node
/* ============================================================================
   Talking Points Panel — smoke test
   Runs the real config.js + script.js in a tiny DOM shim and asserts what the
   panel actually builds. No browser needed.

     node tests/smoke.js

   Covers: rows render, title/subtitle render, the entrance starts exactly once
   (and never gets a .delay() while already playing — that re-begins a GSAP
   timeline and used to play the entrance twice), and that the removed on-air
   highlight feature is really gone.
   ========================================================================== */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ DOM shim */
function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    children: [],
    dataset: {},
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    textContent: '',
    clientWidth: 420,
    clientHeight: 120,
    scrollWidth: 200,
    scrollHeight: 40,
    offsetHeight: 100,
    firstChild: null,
    _html: '',
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : !!force;
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      }
    },
    appendChild(child) { this.children.push(child); this.firstChild = this.children[0]; return child; },
    append(...c) { c.forEach((x) => this.appendChild(x)); },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; this.firstChild = v ? { nodeType: 1 } : null; }
  };
  return node;
}

const ids = {};
const getEl = (id) => (ids[id] || (ids[id] = Object.assign(makeNode('div'), { id })));

const documentShim = {
  readyState: 'complete',
  head: makeNode('head'),
  body: makeNode('body'),
  documentElement: makeNode('html'),
  createElement: makeNode,
  getElementById: getEl,
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

/* ------------------------------------------------------------------ globals */
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
global.innerWidth = 1920;
global.innerHeight = 1080;
global.addEventListener = () => {};
global.getComputedStyle = () => ({ lineHeight: '20px' });
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

/* recording GSAP stub — script.js installs its own no-op shim only when
   window.gsap is missing, so this lets the test watch the choreography */
const gsapLog = [];
global.gsap = {
  timeline() {
    const tl = { _active: false };
    ['from', 'to', 'set', 'progress', 'add', 'kill', 'delay'].forEach((k) => {
      tl[k] = () => { if (k === 'delay') gsapLog.push(tl._active ? 'delay:WHILE-PLAYING' : 'delay'); return tl; };
    });
    tl.play = () => { gsapLog.push('play'); tl._active = true; return tl; };
    tl.pause = () => { gsapLog.push('pause'); tl._active = false; return tl; };
    return tl;
  },
  set: () => {},
  from: () => {},
  to: () => {}
};

/* -------------------------------------------------------------------- boot */
require(path.join(ROOT, 'config.js'));
  require(path.join(ROOT, 'config-merge.js'));
require(path.join(ROOT, 'script.js'));

/* ----------------------------------------------------------------- helpers */
function walk(node, pred, out) {
  out = out || [];
  if (!node) return out;
  if (pred(node)) out.push(node);
  (node.children || []).forEach((c) => walk(c, pred, out));
  return out;
}
const byClass = (root, cls) => walk(root, (n) => String(n.className).split(/\s+/).indexOf(cls) !== -1);

setTimeout(() => {
  const cfg = global.TP_DEFAULT_CONFIG;
  const stage = ids['stage'];
  const rows = byClass(stage, 'row');
  const rowTexts = byClass(stage, 'row__text').map((n) => n.textContent);
  const title = byClass(stage, 'band--header').length
    ? byClass(stage, 'band--header')[0].children.map((c) => c.textContent).join('')
    : '';
  const enabledTopics = (cfg.topics.items || []).filter((i) => i.enabled !== false && String(i.text || '').trim() !== '');

  const results = [];
  const check = (name, pass, info) => results.push({ name, pass, info });
  const plays = () => gsapLog.filter((c) => c === 'play').length;

  check('rows built from enabled topics', rows.length === enabledTopics.length,
    rows.length + ' rows / ' + enabledTopics.length + ' enabled');
  check('topic text rendered', rowTexts[0] === enabledTopics[0].text, rowTexts[0]);
  check('all rows carry text', rowTexts.every((t) => t && t.length), rowTexts.join(' | ').slice(0, 60));
  check('title band rendered', /TODAY'S TOPICS/i.test(title), title.slice(0, 40));
  check('entrance started exactly once', plays() === 1, 'play() calls=' + plays());
  check('no delay() while playing', gsapLog.indexOf('delay:WHILE-PLAYING') === -1, gsapLog.join(' → '));
  check('highlight feature removed from config', cfg.topics.highlight === undefined,
    'topics keys: ' + Object.keys(cfg.topics).join(','));
  check('no active-row class emitted', byClass(stage, 'row--active').length === 0, 'ok');

  /* the saved-config merge must not turn a saved `false` into a truthy `{}` —
     that is what silently re-enabled subtitle.autoDate after a version bump */
  const merged = global.TP_MIGRATE.apply(cfg, {
    meta: { version: '0.0.9' },
    subtitle: { autoDate: false, dateFormat: 'MM/DD/YY', text: 'KEPT SUBTITLE' },
    topics: { items: [{ text: 'A kept topic', enabled: true }] }
  });
  check('migration keeps subtitle.autoDate false, never {}',
    merged.subtitle.autoDate === false,
    JSON.stringify(merged.subtitle.autoDate) + ' (' + typeof merged.subtitle.autoDate + ')');
  check('migration keeps the typed rows', (merged.topics.items || []).length === 1,
    JSON.stringify((merged.topics.items || []).map((r) => r.text)));


  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  talking points panel — smoke test\n  ' + '-'.repeat(50));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(50));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}, 600);
