#!/usr/bin/env node
/* ============================================================================
   Prediction Markets — board suite
   Runs the real config.js + config-merge.js + script.js in a DOM shim.

     node tests/board.js

   Covers the two boards the `source` switch chooses between, and pins the three
   defects this work fixed so they cannot come back:

     • the Polymarket headline board — grouped sections, per-category count, the
       headline selection, and the freshness stamp
     • a fetched market with no price prints an em dash, never a fabricated 0%
     • clicking a list row opens the market ON THAT ROW under every sort, not
       whichever market happens to sit at the row's config index
     • space on a focused row selects that row and does NOT then skip past it
     • a venue name never reaches the board, on either source
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
    textContent: '', clientWidth: 420, clientHeight: 120, scrollWidth: 200, scrollHeight: 40,
    offsetHeight: 100, offsetWidth: 100, firstChild: null, _html: '',
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      contains(c) { return this._set.has(c); },
      toggle(c, f) {
        const on = f === undefined ? !this._set.has(c) : !!f;
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      }
    },
    appendChild(ch) { this.children.push(ch); this.firstChild = this.children[0]; return ch; },
    append(...c) { c.forEach((x) => this.appendChild(x)); },
    _ls: {},
    addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); },
    removeEventListener() {},
    /* a real event keeps defaultPrevented, and that flag is exactly what the
       window keydown handler now checks before acting on a space press */
    dispatch(t, ev) {
      ev = ev || {};
      if (!ev.preventDefault) ev.preventDefault = function () {};
      (this._ls[t] || []).forEach((fn) => fn(ev));
    },
    setAttribute(k, v) { this[k] = v; if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getTotalLength() { return 100; },
    getBoundingClientRect() { return { width: 1920, height: 1080, left: 0, top: 0 }; },
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
  createElementNS: (ns, tag) => makeNode(tag),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
  getElementById: getEl,
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  fonts: { ready: Promise.resolve() }
};

/* ------------------------------------------------------------------ globals */
const store = {};
/* window-level listeners are CAPTURED (the smoke suite throws them away), because
   the spacebar bug is a two-handler interaction between a row and the window */
const winListeners = {};
global.window = global;
global.document = documentShim;
global.location = { search: '?nosync=1', href: 'http://localhost/', protocol: 'http:', hash: '' };
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.innerWidth = 1920;
global.innerHeight = 1080;
global.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
global.getComputedStyle = () => ({ lineHeight: '20px' });
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
global.URLSearchParams = global.URLSearchParams || require('url').URLSearchParams;
global.setInterval = () => 0;

const gsapLog = [];
function makeTl(opts) {
  const tl = { _active: false, _delay: 0, _span: 0, _done: opts && opts.onComplete };
  const finish = () => { if (tl._done) { const d = tl._done; tl._done = null; d(); } };
  ['from', 'to', 'fromTo', 'set', 'progress', 'add', 'kill'].forEach((k) => {
    tl[k] = (...a) => {
      if (k === 'from' || k === 'to' || k === 'fromTo') {
        gsapLog.push(k);
        const vars = a[1] || {};
        tl._span = Math.max(tl._span, (vars.duration || 0.3) + (vars.stagger || 0) * 4);
      }
      return tl;
    };
  });
  tl.delay = (d) => { tl._delay = d || 0; return tl; };
  tl.duration = () => tl._span || 0.3;
  tl.play = () => { tl._active = true; global.setTimeout(finish, (tl._delay + tl._span + 0.02) * 1000); return tl; };
  tl.pause = () => { tl._active = false; return tl; };
  return tl;
}
global.gsap = {
  timeline: (o) => makeTl(o),
  set: () => {},
  from: () => {},
  to: () => {},
  fromTo: (...a) => { if (a[3] && a[3].onComplete) a[3].onComplete(); }
};

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
const textOf = (node) => walk(node, () => true).map((n) => n.textContent).filter(Boolean).join(' ');
const wait = (ms) => new Promise((r) => global.setTimeout(r, ms));
const waitFor = (fn, ms) => new Promise((res) => {
  const t0 = Date.now();
  const tick = () => {
    if (fn()) return res(true);
    if (Date.now() - t0 > (ms || 1200)) return res(false);
    global.setTimeout(tick, 10);
  };
  tick();
});
const press = (key) => {
  const ev = { key, defaultPrevented: false };
  ev.preventDefault = function () { ev.defaultPrevented = true; };
  ev.stopPropagation = function () {};
  return ev;
};

/* ------------------------------------------------------------------- data */
const item = (id, title, prob, chg, vol) => ({
  id, title, probability: prob, change: chg, volume24hr: vol, entity: 'events', slug: id
});
const cat = (id, label, count, items, selection) => ({
  id, label, tagId: '1', tagSlug: id, count, selection: selection || [], items: items || [], error: ''
});

const CRYPTO = [
  item('c1', 'Will Bitcoin close above $150k?', 68, 4.2, 4800000),
  item('c2', 'Will the Fed cut twice?', 31, -1.1, 3000000),
  item('c3', 'Will Ethereum flip Bitcoin?', null, null, 1200000),
  item('c4', 'Will a SOL ETF launch?', 22, 0, 600000),
  item('c5', 'Will ETH burn accelerate?', 9, 1.5, 300000)
];
const ECONOMY = [item('e1', 'Will CPI print under 3%?', 44, 0.4, 2000000), item('e2', 'Will GDP beat?', 57, -0.2, 1500000)];
const FINANCE = [item('f1', 'Will the S&P close above 7000?', 39, 1.2, 1700000), item('f2', 'Will the 10y break 5%?', 26, -0.8, 1100000)];

let results = [];
function check(name, pass, info) { results.push({ name, pass, info }); }

setTimeout(async () => {
  const PM = global.PM;
  const board = PM.board;
  const stage = ids['stage'];

  const polyCfg = (over) => Object.assign({
    source: 'polymarket',
    polymarket: {
      endpoint: 'api/polymarket', entity: 'events', fetched: 5, sortKey: '',
      categories: [
        cat('crypto', 'Crypto', 3, CRYPTO, []),
        cat('economy', 'Economy', 2, ECONOMY, []),
        cat('finance', 'Finance', 2, FINANCE, [])
      ],
      updatedAt: Date.now() - 120000, lastError: ''
    }
  }, over || {});

  /* -------------------------------------------------- the two board layouts */
  check('the shipped source is the hand-typed board', global.PM_DEFAULT_CONFIG.source === 'manual',
    'source=' + global.PM_DEFAULT_CONFIG.source);
  PM.apply({ source: 'manual' }, { animate: false });
  await wait(80);
  check('manual source shows the hand-typed board',
    board.main.style.display === '' && board.groups.style.display === 'none',
    'main=' + JSON.stringify(board.main.style.display) + ' groups=' + JSON.stringify(board.groups.style.display));

  PM.apply(polyCfg(), { animate: false });
  await wait(80);
  check('polymarket source shows the headline board instead',
    board.main.style.display === 'none' && board.groups.style.display === '',
    'main=' + board.main.style.display + ' groups=' + JSON.stringify(board.groups.style.display));
  /* The hand-typed board is HIDDEN rather than destroyed — it is rebuilt on every
     config change, so throwing it away would only cost work. What matters is
     that the headline board does not render any of its rows. */
  check('the headline board renders no hand-typed rows',
    byClass(board.groups, 'row').length === 0, byClass(board.groups, 'row').length + ' list rows in groups');

  /* ------------------------------------------------------------- the groups */
  const groups = byClass(stage, 'group');
  check('one section per category', groups.length === 3, groups.length + ' sections');
  check('sections are labelled in config order',
    groups.map((g) => textOf(byClass(g, 'group__label')[0])).join(' | ') === 'Crypto | Economy | Finance',
    groups.map((g) => textOf(byClass(g, 'group__label')[0])).join(' | '));
  check('each section renders its configured count',
    groups.map((g) => byClass(g, 'grow').length).join(',') === '3,2,2',
    groups.map((g) => byClass(g, 'grow').length).join(','));
  check('rows are in fetched order, i.e. by 24h volume',
    byClass(stage, 'grow__topic').map((n) => n.textContent).slice(0, 3).join(' | ') ===
    'Will Bitcoin close above $150k? | Will the Fed cut twice? | Will Ethereum flip Bitcoin?',
    byClass(stage, 'grow__topic')[0].textContent);
  check('the section meta states how many of how many, and the ranking basis',
    /3 of 5/.test(textOf(byClass(groups[0], 'group__meta')[0])) &&
    /24h volume/.test(textOf(byClass(groups[0], 'group__meta')[0])),
    textOf(byClass(groups[0], 'group__meta')[0]));
  check('three visible categories give a three-column grid',
    String(board.groups.children[1].style['--group-cols']) === '3',
    '--group-cols=' + board.groups.children[1].style['--group-cols']);

  /* --------------------------------------------------------- the numbers */
  const firstRow = byClass(stage, 'grow')[0];
  check('the probability is rendered as a percentage',
    textOf(byClass(firstRow, 'grow__pct')[0]) === '68%', textOf(byClass(firstRow, 'grow__pct')[0]));
  check('the move is labelled in probability points, not as a price change',
    /\+\s?4\.2 pts/.test(textOf(byClass(firstRow, 'grow__mv')[0])),
    textOf(byClass(firstRow, 'grow__mv')[0]));
  check('the volume is labelled 24h, because that is what it is',
    /24h/.test(textOf(byClass(firstRow, 'grow__mv')[0])), textOf(byClass(firstRow, 'grow__mv')[0]));
  check('a price move is coloured', byClass(firstRow, 'grow__mv')[0].children[0].className === 'up',
    'class=' + byClass(firstRow, 'grow__mv')[0].children[0].className);

  const c3Row = byClass(stage, 'grow')[2];
  check('a market with no price shows an em dash, never a fabricated 0%',
    textOf(byClass(c3Row, 'grow__pct')[0]) === '\u2014', textOf(byClass(c3Row, 'grow__pct')[0]));
  check('a market with no move shows no move at all',
    !/pts/.test(textOf(byClass(c3Row, 'grow__mv')[0])) && !/NaN/.test(textOf(stage)),
    JSON.stringify(textOf(byClass(c3Row, 'grow__mv')[0])));
  check('no undefined or NaN ever reaches the board',
    !/undefined|NaN/.test(textOf(stage)), 'scanned the whole stage');

  /* ------------------------------------------------------------ the stamp */
  const stamp = byClass(stage, 'groups__stamp')[0];
  check('the board says how stale the headlines are, without naming a venue',
    /updated/i.test(stamp.textContent) && /2m ago/.test(stamp.textContent) &&
    !/polymarket|coingecko/i.test(stamp.textContent), stamp.textContent);
  PM.apply(polyCfg({ polymarket: Object.assign(polyCfg().polymarket, { updatedAt: Date.now() - 3000 }) }), { animate: false });
  await wait(60);
  check('a fresh pull reads "just now"', /just now/.test(byClass(stage, 'groups__stamp')[0].textContent),
    byClass(stage, 'groups__stamp')[0].textContent);

  /* ------------------------------------------------------ count = hide */
  PM.apply(polyCfg({
    polymarket: {
      endpoint: 'api/polymarket', entity: 'events', fetched: 5, sortKey: '',
      categories: [cat('crypto', 'Crypto', 3, CRYPTO, []), cat('economy', 'Economy', 0, ECONOMY, []),
        cat('finance', 'Finance', 2, FINANCE, [])],
      updatedAt: Date.now(), lastError: ''
    }
  }), { animate: false });
  await wait(60);
  const g2 = byClass(stage, 'group');
  check('count 0 hides a category completely, heading included',
    g2.length === 2 && !/Economy/.test(textOf(stage)),
    g2.length + ' sections');
  check('the grid re-flows to the categories that are left',
    String(board.groups.children[1].style['--group-cols']) === '2',
    '--group-cols=' + board.groups.children[1].style['--group-cols']);

  /* ----------------------------------------------------- the selection */
  PM.apply(polyCfg({
    polymarket: {
      endpoint: 'api/polymarket', entity: 'events', fetched: 5, sortKey: '',
      categories: [cat('crypto', 'Crypto', 5, CRYPTO, ['c3', 'c1', 'c5']),
        cat('economy', 'Economy', 2, ECONOMY, []), cat('finance', 'Finance', 2, FINANCE, [])],
      updatedAt: Date.now(), lastError: ''
    }
  }), { animate: false });
  await wait(60);
  const selRows = byClass(byClass(stage, 'group')[0], 'grow');
  check('the selection narrows the board to the chosen headlines',
    selRows.length === 3, selRows.length + ' rows');
  check('the selection renders in FETCHED order, not tick order',
    byClass(byClass(stage, 'group')[0], 'grow__topic').map((n) => n.textContent).join('|') ===
    'Will Bitcoin close above $150k?|Will Ethereum flip Bitcoin?|Will ETH burn accelerate?',
    byClass(byClass(stage, 'group')[0], 'grow__topic').map((n) => n.textContent).join('|'));
  check('the count still caps the selection',
    PM.headlinesFor(cat('crypto', 'Crypto', 1, CRYPTO, ['c3', 'c1'])).map((i) => i.id).join(',') === 'c1',
    PM.headlinesFor(cat('crypto', 'Crypto', 1, CRYPTO, ['c3', 'c1'])).map((i) => i.id).join(','));

  /* a selection from an older top 5 must degrade, not break */
  check('ids that are no longer in the top 5 are simply dropped',
    PM.headlinesFor(cat('x', 'X', 5, CRYPTO, ['gone1', 'c2', 'gone2'])).map((i) => i.id).join(',') === 'c2',
    PM.headlinesFor(cat('x', 'X', 5, CRYPTO, ['gone1', 'c2', 'gone2'])).map((i) => i.id).join(','));
  check('an empty selection means "all of them", so count alone works',
    PM.headlinesFor(cat('x', 'X', 2, CRYPTO, [])).map((i) => i.id).join(',') === 'c1,c2',
    PM.headlinesFor(cat('x', 'X', 2, CRYPTO, [])).map((i) => i.id).join(','));

  /* ------------------------------------------------------- empty states */
  PM.apply(polyCfg({
    polymarket: {
      endpoint: 'api/polymarket', entity: 'events', fetched: 5, sortKey: '',
      categories: [cat('crypto', 'Crypto', 3, [], []), cat('economy', 'Economy', 2, [], []),
        cat('finance', 'Finance', 2, [], [])],
      updatedAt: 0, lastError: ''
    }
  }), { animate: false });
  await wait(60);
  check('a never-fetched board says so instead of rendering blank',
    /press Update/i.test(textOf(stage)) && !/undefined/.test(textOf(stage)),
    byClass(stage, 'groups__stamp')[0].textContent);

  PM.apply(polyCfg({
    polymarket: {
      endpoint: 'api/polymarket', entity: 'events', fetched: 5, sortKey: '',
      categories: [cat('crypto', 'Crypto', 0, CRYPTO, []), cat('economy', 'Economy', 0, ECONOMY, []),
        cat('finance', 'Finance', 0, FINANCE, [])],
      updatedAt: Date.now(), lastError: ''
    }
  }), { animate: false });
  await wait(60);
  check('a board where every category is hidden says so',
    /Every category is set to 0/.test(textOf(stage)), textOf(byClass(stage, 'groups__none')[0]));

  /* a failed category shows its error rather than an empty section */
  PM.apply(polyCfg({
    polymarket: {
      endpoint: 'api/polymarket', entity: 'events', fetched: 5, sortKey: '',
      categories: [cat('crypto', 'Crypto', 3, CRYPTO, []),
        Object.assign(cat('economy', 'Economy', 2, [], []), { error: 'no Polymarket tag matches "economy"' }),
        cat('finance', 'Finance', 2, FINANCE, [])],
      updatedAt: Date.now(), lastError: 'economy failed'
    }
  }), { animate: false });
  await wait(60);
  check('a failed category shows why, on the board and in the section meta',
    /no Polymarket tag matches/.test(textOf(stage)) &&
    /unavailable/.test(textOf(byClass(stage, 'group__meta')[1])),
    textOf(byClass(stage, 'group__none')[0]));

  /* --------------------------------------------- venue honesty by source */
  PM.apply({ source: 'polymarket', footer: { left: { source: 'Polymarket' } } }, { animate: false });
  await wait(40);
  check('the venue name stays off the board even when headlines are selected',
    !/Polymarket/i.test(textOf(byClass(stage, 'ftxt')[0])), textOf(byClass(stage, 'ftxt')[0]));
  PM.apply({ source: 'manual', footer: { left: { source: 'Polymarket' } } }, { animate: false });
  await wait(40);
  check('the venue name stays off the hand-typed board too',
    !/Polymarket/i.test(textOf(byClass(stage, 'ftxt')[0])), textOf(byClass(stage, 'ftxt')[0]));

  /* ============================ the hand-typed board's own two defects ==== */
  PM.apply({ source: 'manual' }, { animate: false });
  await wait(60);

  /* --- clicking a row must open the market PRINTED on that row --- */
  for (const sort of ['manual', 'volume', 'probability', 'change', 'topic']) {
    PM.apply({ markets: { sort } }, { animate: false });
    await wait(60);
    const rows = byClass(stage, 'row');
    let wrong = 0;
    for (let i = 0; i < rows.length; i++) {
      const want = board.rowMarkets[i];
      PM.show(0, { force: true });
      await wait(180);
      rows[i].dispatch('click');
      await wait(320);
      const got = board.heroMarket();
      if (!got || !want || got.topic !== want.topic) wrong++;
    }
    check('clicking a row opens that row\'s market (sort=' + sort + ')', wrong === 0,
      wrong + ' of ' + rows.length + ' wrong');
  }

  /* a disabled market in the middle shifts every cfg index below it */
  const shipped = JSON.parse(JSON.stringify(global.PM_DEFAULT_CONFIG.markets.items));
  shipped.splice(2, 0, { topic: 'DISABLED MIDDLE', probability: 50, volume: 9999999, change: 0, enabled: false });
  PM.apply({ markets: { sort: 'manual', items: shipped } }, { animate: false });
  await wait(60);
  let midWrong = 0;
  const midRows = byClass(stage, 'row');
  for (let i = 0; i < midRows.length; i++) {
    const want = board.rowMarkets[i];
    PM.show(0, { force: true });
    await wait(180);
    midRows[i].dispatch('click');
    await wait(320);
    const got = board.heroMarket();
    if (!got || !want || got.topic !== want.topic) midWrong++;
  }
  check('clicking a row still works with a disabled market above it', midWrong === 0,
    midWrong + ' of ' + midRows.length + ' wrong');

  /* --- space on a focused row: select it, do not then skip past it --- */
  PM.apply(polyCfg({ source: 'manual' }), { animate: false });
  await wait(60);
  PM.show(0, { force: true });
  await wait(250);
  const kbRows = byClass(stage, 'row');
  const kbWant = board.rowMarkets[2];
  const rowEv = press(' ');
  kbRows[2].dispatch('keydown', rowEv);                       /* the row's own handler */
  (winListeners['keydown'] || []).forEach((f) => f(rowEv));    /* ...then it bubbles to window */
  await wait(400);
  check('space on a focused row opens THAT row and does not skip past it',
    board.heroMarket().topic === kbWant.topic,
    'wanted "' + String(kbWant.topic).slice(0, 30) + '" got "' + String(board.heroMarket().topic).slice(0, 30) + '"');
  check('the row marks the key press handled', rowEv.defaultPrevented === true,
    'defaultPrevented=' + rowEv.defaultPrevented);

  /* and the window path still works on its own, so the guard is not just
     disabling the shortcut */
  const beforeIdx = board.heroIdx;
  const winEv = press(' ');
  (winListeners['keydown'] || []).forEach((f) => f(winEv));
  await wait(400);
  check('space with no row focused still advances the topic',
    board.heroIdx === (beforeIdx + 1) % board.markets.length,
    'idx ' + beforeIdx + ' -> ' + board.heroIdx);

  /* the guard must not have disabled the other shortcuts with it */
  await waitFor(() => board.heroIdx === beforeIdx, 1200);
  const arrowFrom = board.heroIdx;
  const arrowEv = press('ArrowLeft');
  (winListeners['keydown'] || []).forEach((f) => f(arrowEv));
  await waitFor(() => board.heroIdx !== arrowFrom, 1200);
  check('the arrow keys still work after the spacebar guard',
    board.heroIdx === (arrowFrom - 1 + board.markets.length) % board.markets.length,
    'idx ' + arrowFrom + ' -> ' + board.heroIdx);

  PM.apply({ source: 'manual' }, { animate: false });

  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  prediction markets — board suite\n  ' + '-'.repeat(66));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(66));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}, 600);
