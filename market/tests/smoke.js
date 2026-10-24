#!/usr/bin/env node
/* ============================================================================
   Smoke test — runs the real overlay engine in Node against a DOM shim and a
   stubbed proxy, then asserts what actually renders.

     node tests/smoke.js            happy path
     node tests/smoke.js --stale    proxy answers from a stale cache
     node tests/smoke.js --offline  proxy unreachable, nothing cached

   The browser source cannot be inspected in every environment, so this proves
   the fetch -> normalise -> format -> render path end to end.
   ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const MODE = process.argv.includes('--stale') ? 'stale'
  : process.argv.includes('--offline') ? 'offline' : 'ok';

/* ------------------------------------------------------------------ DOM shim */
function makeNode(tag, ns) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    namespaceURI: ns || null,
    className: '',
    children: [],
    dataset: {},
    attrs: {},
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      removeProperty(k) { delete this._p[k]; },
      getPropertyValue(k) { return this._p[k] || ''; }
    },
    textContent: '',
    clientWidth: 1200, clientHeight: 600,
    scrollWidth: 200, scrollHeight: 60,
    offsetHeight: 620, offsetWidth: 1110, offsetLeft: 0,
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
    insertBefore(child, ref) {
      const i = this.children.indexOf(ref);
      if (i === -1) this.children.push(child); else this.children.splice(i, 0, child);
      this.firstChild = this.children[0];
      return child;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); return c; },
    addEventListener(type, fn) { (this._h = this._h || {})[type] = (this._h[type] || []).concat(fn); },
    removeEventListener() {},
    dispatch(type) { ((this._h || {})[type] || []).forEach((fn) => fn.call(this, { target: this, preventDefault() {} })); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getTotalLength() { return 100; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; this.firstChild = v ? { nodeType: 1 } : null; }
  };
  if (ns) node.ownerSVGElement = {};
  return node;
}

const ids = {};
function getEl(id) {
  if (!ids[id]) { ids[id] = makeNode('div'); ids[id].id = id; }
  return ids[id];
}

const documentShim = {
  readyState: 'complete',
  head: makeNode('head'),
  body: makeNode('body'),
  documentElement: makeNode('html'),
  createElement: (t) => makeNode(t),
  createElementNS: (ns, t) => makeNode(t, ns),
  getElementById: getEl,
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

/* ------------------------------------------------------------------ globals */
const store = {};
global.window = global;
global.document = documentShim;
global.location = { search: '', href: 'http://localhost/market/index.html', protocol: 'http:' };
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
global.innerWidth = 1920;
global.innerHeight = 1080;
global.addEventListener = () => {};
global.getComputedStyle = () => ({ fontSize: '21px', lineHeight: '22px' });
global.URLSearchParams = URLSearchParams;
global.AbortController = function () { this.signal = {}; this.abort = () => {}; };

/* recording GSAP stub — script.js installs its own no-op shim only when
   window.gsap is absent, so defining this first lets the test observe the
   timeline choreography */
const gsapLog = [];
/* structured record of standalone tweens (an added row, a tab switch): lets a
   test assert WHICH nodes were animated, not just that something moved */
const tweenLog = [];
function tweenTargets(t) {
  return (Array.isArray(t) ? t : [t]).map((n) => (n && n.dataset ? (n.dataset.coin || n.dataset.testid || '') : '')).filter(Boolean);
}
/* the board is taken off air with gsap.set(panel, { opacity }) — recorded so a
   hide command can be proven to actually hide something */
let lastPanelOpacity = null;
global.gsap = {
  timeline() {
    const tl = { _active: false, _cbs: [] };
    ['from', 'to', 'set', 'kill', 'delay'].forEach((k) => { tl[k] = () => tl; });
    tl.add = (fn) => { if (typeof fn === 'function') tl._cbs.push(fn); return tl; };
    /* chainable, like GSAP: showInstant() calls .progress(1, true).pause() */
    tl.progress = () => tl;
    tl.duration = () => 2.0;
    tl.play = () => { gsapLog.push('play'); tl._active = true; return tl; };
    tl.pause = () => { gsapLog.push('pause'); tl._active = false; return tl; };
    return tl;
  },
  killTweensOf: () => {},
  set: (target, vars) => {
    if (vars && vars.opacity != null) {
      gsapLog.push('opacity:' + vars.opacity);
      if (target && String(target.className || '').indexOf('panel') !== -1) {
        lastPanelOpacity = vars.opacity;
      }
    }
  },
  from: (t, v) => {
    tweenLog.push({ kind: 'from', targets: tweenTargets(t), vars: v || {} });
    if (v && v.onUpdate) v.onUpdate();
  },
  fromTo: (t, f, v) => {
    tweenLog.push({ kind: 'fromTo', targets: tweenTargets(t), vars: v || {} });
    if (v && v.onUpdate) v.onUpdate();
  },
  /* the tab switch hands control back through onComplete — the stub must fire
     it, or the test would silently assert against un-swapped rows */
  to: (t, v) => {
    tweenLog.push({ kind: 'to', targets: tweenTargets(t), vars: v || {} });
    if (v && v.onComplete) v.onComplete();
  }
};

/* ------------------------------------------------------------- canned proxy */
function coin(id, symbol, name, price, c24, c7) {
  return {
    id, symbol, name,
    image: 'https://assets.coingecko.com/coins/images/' + id + '.png',
    market_cap_rank: Math.floor(Math.random() * 200) + 1,
    current_price: price,
    price_change_percentage_24h_in_currency: c24,
    price_change_percentage_7d_in_currency: c7,
    sparkline_in_7d: { price: Array.from({ length: 168 }, (_, i) => price * (1 + Math.sin(i / 12) * 0.05)) }
  };
}

/* The canned response mirrors what the board currently ships, so every row in
   every category has data to render. Prices are the real ones observed at the
   time of writing; the 24h/7d moves are invented, with a deliberate mix of signs
   so the direction classes and the sign-vs-colour check have both to work with.
   Keep this in step with `categories` in config.js when the board changes. */
const COINS = [
  /* PRIVACY */
  coin('zcash', 'zec', 'Zcash', 1330.83, 2.10, 9.40),
  coin('near', 'near', 'NEAR Protocol', 4.87, 1.25, -3.10),
  coin('zama', 'zama', 'Zama', 0.08453, -4.20, 12.60),
  coin('monero', 'xmr', 'Monero', 546.81, -0.85, 4.75),
  coin('arcium', 'arx', 'Arcium', 0.26747, 5.60, -8.30),
  coin('dash', 'dash', 'Dash', 59.85, -1.40, 2.20),
  /* REVENUE */
  coin('hyperliquid', 'hype', 'Hyperliquid', 90.64, 3.35, 18.90),
  coin('lighter', 'lit', 'Lighter', 3.65, 0.95, -2.45),
  coin('pump-fun', 'pump', 'Pump.fun', 0.006398, -2.75, 6.10),
  coin('aerodrome-finance', 'aero', 'Aerodrome Finance', 0.86087, 1.80, 11.30),
  coin('derive', 'drv', 'Derive', 0.40603, -3.10, -7.20),
  coin('arbitrum', 'arb', 'Arbitrum', 0.20315, 0.60, 3.85),
  coin('ether-fi', 'ethfi', 'Ether.fi', 0.74386, 2.45, 7.55),
  /* AI */
  coin('akash-network', 'akt', 'Akash Network', 0.80507, -1.95, 5.40),
  coin('pha', 'phala', 'Phala Network', 0.07498, 4.10, -6.25),
  coin('bittensor', 'tao', 'Bittensor', 303.60, 2.90, 14.10),
  /* DINO COINS */
  coin('litecoin', 'ltc', 'Litecoin', 70.38, -0.45, 1.85),
  coin('ripple', 'xrp', 'XRP', 1.51, 1.10, 8.20),
  coin('stellar', 'xlm', 'Stellar', 0.22485, -0.70, 2.65),
  coin('bitcoin-cash', 'bch', 'Bitcoin Cash', 320.25, 0.85, 4.30),
  coin('dogecoin', 'doge', 'Dogecoin', 0.09628, 2.20, 9.95),
  /* DEFI */
  coin('ethereum', 'eth', 'Ethereum', 2722.56, 1.55, 6.40),
  coin('chainlink', 'link', 'Chainlink', 14.18, -1.20, 3.75),
  coin('sky', 'sky', 'Sky', 0.09593, 3.60, 15.20),
  coin('syrup', 'syrup', 'Maple Finance', 0.25635, -2.30, 5.85),
  coin('uniswap', 'uni', 'Uniswap', 9.13, 0.75, -1.95),
  coin('aave', 'aave', 'Aave', 180.34, 2.05, 7.10),
  coin('morpho', 'morpho', 'Morpho', 2.70, -0.55, 4.60)
];

let fetchLog = [];
global.fetch = (url) => {
  const u = String(url);
  fetchLog.push(u);
  if (u.indexOf('api/market') !== -1) {
    if (MODE === 'offline') return Promise.reject(new Error('proxy down'));
    const wanted = decodeURIComponent((u.match(/ids=([^&]*)/) || [, ''])[1]).split(',');
    const list = COINS.filter((c) => wanted.indexOf(c.id) !== -1);
    const cache = MODE === 'stale' ? 'STALE' : 'MISS';
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'x-cache' ? cache : null) },
      json: () => Promise.resolve(list)
    });
  }
  if (u.indexOf('coingecko') !== -1) {
    if (MODE === 'offline') return Promise.reject(new Error('direct down'));
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(COINS) });
  }
  if (u.indexOf('config.json') !== -1) {
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({}) });
  }
  /* the command API. Answering with a real hide proves the whole
     /api/command → state.json → /api/state → board path, which the board did
     not implement at all before. */
  if (u.indexOf('api/state') !== -1) {
    return Promise.resolve({
      ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ seq: 1, action: 'hide', index: -1, ts: Date.now() })
    });
  }
  return Promise.reject(new Error('unexpected fetch: ' + u));
};

/* -------------------------------------------------------------------- boot */
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'config-merge.js'));
require(path.join(ROOT, 'script.js'));

/* ---------------------------------------------------------------- helpers */
function descendants(node, out) {
  out = out || [];
  (node.children || []).forEach((c) => { out.push(c); descendants(c, out); });
  return out;
}
function collect(node, testid) {
  return descendants(node).filter((n) => n.dataset && n.dataset.testid === testid);
}
function textOf(node, testid) {
  const hit = collect(node, testid)[0];
  return hit ? hit.textContent : null;
}

setTimeout(async () => {
  const results = [];
  const check = (name, pass, info) => results.push({ name, pass, info });
  const stage = ids['stage'];
  const board = global.CM.engine.board;
  const cfg = global.CM.getConfig();

  /* ---------------------------------------------------------- structure */
  check('stage reports a state', stage && !!stage.dataset.state, stage && stage.dataset.state);
  check('title rendered', /DIGITAL ASSETS MARKET/i.test(textOf(stage, 'title') || ''), textOf(stage, 'title'));

  const tabs = collect(stage, 'tab');
  check('a tab per category', tabs.length === cfg.categories.length,
    tabs.length + ' tabs / ' + cfg.categories.length + ' categories');
  check('tab labels match the categories', tabs.map((t) => t.textContent).join(',') ===
    cfg.categories.map((c) => c.label).join(','), tabs.map((t) => t.textContent).join(','));
  /* web-performance-a11y: interactive elements must be real buttons */
  check('tabs are real <button> elements (keyboard reachable)',
    tabs.every((t) => t.tagName === 'BUTTON'), tabs.map((t) => t.tagName).join(','));
  check('tabs expose aria-pressed',
    tabs.every((t) => t.getAttribute('aria-pressed') !== undefined),
    tabs.map((t) => t.getAttribute('aria-pressed')).join(','));

  /* The board used to come up with NO tab marked active: movePill() only ran on
     a category switch, so the indicator and aria-pressed stayed at their
     initial state until the operator clicked a tab or sent next/prev. */
  {
    /* classList, not className: movePill() toggles the class through classList,
       and this shim keeps classList separate from className. */
    const active = tabs.filter((t) => t.classList.contains('is-active'));
    check('exactly one tab is marked active on first paint', active.length === 1,
      active.length + ' active: ' + active.map((t) => t.textContent).join(','));
    check('the active tab is the category the board is showing',
      !!active[0] && active[0].textContent === cfg.categories[board.activeIndex].label,
      active[0] ? active[0].textContent + ' vs ' + cfg.categories[board.activeIndex].label : 'none');
    check('the active tab reports aria-pressed=true',
      !!active[0] && active[0].getAttribute('aria-pressed') === 'true',
      active[0] ? active[0].getAttribute('aria-pressed') : 'none');
    check('the tab indicator has a width on first paint',
      /^\d+(\.\d+)?px$/.test(board.tabPill.style.width || ''), board.tabPill.style.width || '(unset)');
  }

  /* The title ends in a full-width hairline (header.rule) and the tabs are
     999px-rounded pills: at margin 0 the strip starts on the rule's own pixel
     and the line reads as cutting through the pills. */
  if (cfg.header.rule) {
    check('the tab strip keeps clear of the title rule', (cfg.tabs.marginTop || 0) >= 8,
      'tabs.marginTop=' + cfg.tabs.marginTop + 'px (needs >= 8)');
  }

  /* A DOM shim cannot see this one: it reports a fixed offsetHeight, so measuring
     the panel before its rows exist looks identical to measuring it after. The
     panel is sized by its rows and centred in the stage, so layout() has to run
     once they are built — assert the call order in the source instead. Without
     it the board sits ~250px low with its last row off the bottom, correct only
     on a first load (the ResizeObserver's initial callback hid the bug). */
  {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const body = (src.match(/Board\.prototype\.renderRows = function[\s\S]*?\n  \};/) || [''])[0];
    const placed = /this\.layout\(\);/.test(body);
    check('the panel is placed after its rows are built', placed,
      !body ? 'renderRows() not found'
        : placed ? 'layout() inside renderRows()'
          : 'renderRows() never calls layout()');
  }

  const cols = collect(stage, 'cols')[0];
  const colKeys = cols ? cols.children.map((c) => c.dataset.col) : [];
  check('columns follow columns.order', colKeys.join(',') === cfg.columns.order.join(','),
    colKeys.join(','));

  const rows = collect(stage, 'row');
  const activeCat = cfg.categories[board.activeIndex];
  const expectRows = Math.min(activeCat.coins.length, cfg.maxRows);
  check('a row per coin in the active category', rows.length === expectRows,
    rows.length + ' rows / expected ' + expectRows);
  check('rows carry their coin id', rows.every((r) => !!r.dataset.coin),
    rows.slice(0, 3).map((r) => r.dataset.coin).join(','));

  /* ---------------------------------------------------------- formatting */
  const prices = collect(stage, 'price').map((n) => n.textContent);
  const c24 = collect(stage, 'change24h').map((n) => n.textContent);
  const sparks = collect(stage, 'sparkline');
  const hasData = MODE !== 'offline';

  if (hasData) {
    /* The formatter is exercised directly, so these assertions do not depend on
       which coins the shipped catalogue happens to contain — editing the
       categories should never be able to break the price formatting checks. */
    check('large price gets 2 decimals and grouping',
      global.CM.formatPrice(83713.42, cfg.rows) === '$83,713.42',
      global.CM.formatPrice(83713.42, cfg.rows));
    check('sub-dollar price gets 3 decimals',
      global.CM.formatPrice(0.0969, cfg.rows) === '$0.097',
      global.CM.formatPrice(0.0969, cfg.rows));
    check('a tiny price never renders as $0.000',
      global.CM.formatPrice(0.00001234, cfg.rows) === '$0.00001234',
      global.CM.formatPrice(0.00001234, cfg.rows));
    const priced = prices.filter((p) => p !== '—');
    check('every price that has data is formatted, none clipped',
      priced.length >= 3 && priced.every((p) => /^\$[\d,]+(\.\d+)?$/.test(p)),
      priced.length + ' of ' + prices.length + ' rows priced');

    check('24h change carries a sign (colour is not the only cue)',
      c24.every((t) => /^[+-]\d+\.\d\d%$/.test(t)), c24.slice(0, 4).join(' '));
    check('negative change uses a real minus', c24.some((t) => t.charAt(0) === '-'), c24.join(' '));

    const downCells = collect(stage, 'change24h').filter((n) => n.className.indexOf('is-down') !== -1);
    const upCells = collect(stage, 'change24h').filter((n) => n.className.indexOf('is-up') !== -1);
    check('direction classes applied', upCells.length > 0 && downCells.length > 0,
      upCells.length + ' up / ' + downCells.length + ' down');

    check('sparkline cell per row', sparks.length === rows.length,
      sparks.length + ' sparklines / ' + rows.length + ' rows');
    check('sparkline draws a path',
      sparks.some((sp) => descendants(sp).some((n) => n.tagName === 'PATH')), 'path present');
    check('sparkline has a coloured endpoint dot',
      sparks.some((sp) => descendants(sp).some((n) => n.tagName === 'CIRCLE')), 'circle present');
  } else {
    /* With no cache and no network the board must still reserve its layout and
       show an honest placeholder — never a blank slab and never a fake number. */
    check('offline shows placeholders, not invented prices',
      prices.length > 0 && prices.every((p) => p === '—'), prices.slice(0, 4).join(' '));
    check('offline reserves the row layout', rows.length === expectRows,
      rows.length + ' rows');
    check('offline changes are placeholders too',
      c24.length > 0 && c24.every((t) => t === '—'), c24.slice(0, 4).join(' '));
    /* with NO cache the honest state is "error": calling it "stale" would
       imply we are showing older real prices, and we are showing none at all */
    check('offline with no cache reports its true state', stage.dataset.state === 'error',
      stage.dataset.state);
    /* The footer is the age of the last successful fetch and nothing else. With
       no fetch at all there is no age to print, so it stays empty — the stage's
       data-state (asserted just above) is what carries the error. */
    check('offline leaves the footer empty instead of inventing an age',
      (textOf(stage, 'note') || '') === '', JSON.stringify(textOf(stage, 'note')));
  }

  /* ------------------------------------------- skill-driven regressions */
  const panel = board.panel;
  const rankFont = panel.style.getPropertyValue('--rank-font');
  check('rank numerals get the real font, not the UA serif', !!rankFont, rankFont);
  check('logo box does not clip (no circular mask on the frame)',
    !/\.logo\s*\{[^}]*border-radius/.test(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')),
    'frame is unclipped');

  /* The note under the rows reads --cols-font, but a custom property only
     inherits DOWN the tree. It used to be set on the column-header strip — a
     sibling of the note — so the note's `font-family: var(--cols-font)` had
     nothing to resolve against: invalid at computed-value time, which drops
     font-family to the inherited value and, with html/body unset, to the
     browser's default serif. The same thing had already happened once with
     --rank-font, so both halves are asserted now. */
  {
    const cssText = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
    const noteRule = (cssText.match(/\.board-note\s*\{[^}]*\}/) || [''])[0];
    check('the note under the rows asks for a font token',
      /font-family:\s*var\(--cols-font/.test(noteRule) &&
      /font-weight:\s*var\(--cols-weight/.test(noteRule) &&
      /font-size:\s*var\(--cols-size/.test(noteRule),
      'rule found: ' + !!noteRule);
    check('that token is published where the note can inherit it',
      panel.style.getPropertyValue('--cols-font') !== '' &&
      panel.style.getPropertyValue('--board-font') !== '',
      'cols-font=' + panel.style.getPropertyValue('--cols-font').slice(0, 26) +
      ' board-font=' + panel.style.getPropertyValue('--board-font').slice(0, 26));
  }

  /* ------------------------------------------------------------ data path */
  check('proxy is tried first', fetchLog.length > 0 && fetchLog[0].indexOf('api/market') !== -1,
    fetchLog[0] || 'no fetch');
  if (MODE === 'stale') {
    check('stale proxy response is marked as cached', board.state.fromCache === true,
      String(board.state.error));
    check('stale board still renders prices', /^\$/.test(prices[0] || ''), prices[0]);
  }
  if (MODE === 'offline') {
    check('offline with no cache reports a state', stage.dataset.state === 'stale' || stage.dataset.state === 'error',
      stage.dataset.state);
  }

  /* ----------------------------------------------------------- entrance */
  const plays = gsapLog.filter((x) => x === 'play').length;
  check('entrance started exactly once', plays === 1, 'play() calls=' + plays);

  /* --------------------------------------------- category switching */
  const before = collect(stage, 'row').map((r) => r.dataset.coin).join(',');
  global.CM.setCategory(1);
  const after = collect(stage, 'row').map((r) => r.dataset.coin).join(',');
  check('switching category changes the rows', before !== after,
    'market=' + before.split(',').length + ' coins, ai=' + after.split(',').length + ' coins');
  const secondCat = cfg.categories[1];
  check('the second tab shows its own coins',
    after.split(',').every((id) => secondCat.coins.indexOf(id) !== -1), after);
  check('aria-pressed follows the active tab',
    collect(stage, 'tab')[1].getAttribute('aria-pressed') === 'true',
    collect(stage, 'tab').map((t) => t.getAttribute('aria-pressed')).join(','));

  /* ---------------------------------------------------------- migration */
  const M = global.CM_MIGRATE;
  const shipped = global.CM_DEFAULT_CONFIG;
  const stale = JSON.parse(JSON.stringify(shipped));
  stale.meta = Object.assign({}, shipped.meta, { version: '0.0.1' });
  stale.panel = Object.assign({}, shipped.panel, { background: 'rgba(0,0,0,1)' });
  stale.categories = [{ id: 'custom', label: 'MINE', coins: ['bitcoin'] }];
  delete stale.rows.gap;                       /* a key the saved copy predates */
  const merged = M.apply(shipped, stale);
  check('a saved look survives the version bump (settings are persistent)',
    merged.panel.background === 'rgba(0,0,0,1)', merged.panel.background);
  check('a key the saved copy never had comes from the build',
    merged.rows.gap === shipped.rows.gap, 'rows.gap=' + merged.rows.gap);
  check('saved categories survive migration',
    merged.categories.length === 1 && merged.categories[0].label === 'MINE',
    merged.categories.map((c) => c.label).join(','));
  check('migration is reported', M.migrated === true && /kept as saved/.test(M.lastNote || ''),
    M.lastNote);
  check('endpoint URLs still come from the build, never from the saved copy',
    merged.data.proxyUrl === shipped.data.proxyUrl && merged.data.directUrl === shipped.data.directUrl,
    merged.data.proxyUrl + ' / ' + merged.data.directUrl);

  /* The first config poll used to rebuild the whole board, because migrating a
     saved config adds meta.migratedFrom — a metadata-only difference that the
     poll's whole-JSON comparison counted as a change. A rebuild blanks every
     price for a data round trip, which is the flash seen ~2s after load. These
     pin the rule the poll now uses. */
  {
    const savedStale = JSON.parse(JSON.stringify(shipped));
    savedStale.meta = Object.assign({}, shipped.meta, { version: '0.0.1' });
    const migrated = M.apply(shipped, savedStale);
    check('a metadata-only config change is not a visible change',
      global.CM.configSignature(shipped) === global.CM.configSignature(migrated),
      'meta.migratedFrom=' + ((migrated.meta || {}).migratedFrom));
    const contentChange = JSON.parse(JSON.stringify(shipped));
    contentChange.maxRows = 3;
    check('a content change still counts',
      global.CM.configSignature(shipped) !== global.CM.configSignature(contentChange), 'maxRows 11 -> 3');
    const lookChange = JSON.parse(JSON.stringify(shipped));
    lookChange.panel.width = 1500;
    check('a look change still counts',
      global.CM.configSignature(shipped) !== global.CM.configSignature(lookChange), 'panel.width -> 1500');
    /* __startIndex is a runtime hint set by ?category= and by next/prev, and a
       resolved config.json never carries it — counting it forced a rebuild on
       the first poll and reset the board to the first category. */
    const hinted = JSON.parse(JSON.stringify(shipped));
    hinted.__startIndex = 2;
    check('the runtime category hint is not a visible change',
      global.CM.configSignature(shipped) === global.CM.configSignature(hinted),
      'start index excluded');
  }

  /* --------------------------------------------------------- command API
     Driven from the server: /api/command writes state.json, the board polls
     /api/state and acts on a changed seq. The stub answers the first poll with
     a hide, so this exercises the real path end to end. */
  const statePolls = fetchLog.filter((u) => u.indexOf('api/state') !== -1);
  /* two by 900ms: the immediate poll at 400ms and the repeating one at 700ms.
     Requiring both means neither half of the wiring can be dropped unseen. */
  check('the board polls the command API, immediately and on a timer',
    statePolls.length >= 2,
    statePolls.length + ' poll(s) of ' + (cfg.sync && cfg.sync.stateUrl || 'api/state'));
  check('a hide command from the API takes the board off air',
    lastPanelOpacity === 0 && board.state.onAir === false,
    'opacity=' + lastPanelOpacity + ' onAir=' + board.state.onAir);

  global.CM.play();
  check('playing again after a hide puts the board back',
    lastPanelOpacity === 1 && board.state.onAir === true,
    'opacity=' + lastPanelOpacity + ' onAir=' + board.state.onAir);
  global.CM.hide();
  check('the engine remembers a hide across a config rebuild',
    global.CM.engine.hidden === true, 'hidden=' + global.CM.engine.hidden);
  global.CM.play();

  /* A genuine rebuild must not blank the board either: the new board inherits the
     old one's data and freshness, so mount() renders real prices before the
     fetch lands. */
  {
    const before = global.CM.engine.board;
    const hasData = Object.keys(before.data).length > 0;
    const cfgNow = JSON.parse(JSON.stringify(global.CM.getConfig()));
    /* deliberately NOT setting __startIndex: the engine must carry the category
       that is on air across the rebuild by itself (it used to snap back to the
       first one, and this test used to patch the index in to hide that) */
    const idxBefore = before.activeIndex;
    global.CM.engine.applyConfig(cfgNow);
    const rebuilt = global.CM.engine.board;
    check('a rebuild replaces the board', rebuilt !== before,
      rebuilt !== before ? 'new board object' : 'same object');
    check('a rebuild keeps the category that is on air',
      rebuilt.activeIndex === idxBefore, 'index ' + idxBefore + ' -> ' + rebuilt.activeIndex);
    if (hasData) {
      const prices = collect(stage, 'price');
      const priced = prices.filter((p) => /^\$/.test(p.textContent)).length;
      check('a rebuild paints the last known prices at once',
        prices.length > 0 && priced === prices.length,
        priced + '/' + prices.length + ' rows priced at the rebuild');
    }
  }

    /* ------------------------------------- config merging and column flex */
    /* A patch with no meta.version used to be read by CM_MIGRATE as an unknown
       old build, which keeps CONTENT_KEYS only - so ?config=, a partial push or
       an unversioned config.json silently lost every look key it carried. */
    {
      const shipped = global.CM_DEFAULT_CONFIG;
      const patched = global.CM.mergeIncoming(shipped, { rows: { gap: 20 } });
      check('an unversioned patch merges instead of being read as an old build',
        patched.rows.gap === 20, 'rows.gap=' + patched.rows.gap);
      check('an unversioned patch keeps the look keys around it',
        patched.panel.width === shipped.panel.width &&
        patched.columns.order.length === shipped.columns.order.length,
        'panel.width=' + patched.panel.width);

      const oldBuild = JSON.parse(JSON.stringify(shipped));
      oldBuild.meta = { version: '0.0.1' };
      oldBuild.rows = Object.assign({}, oldBuild.rows, { gap: 99 });
      const migrated = global.CM.mergeIncoming(shipped, oldBuild);
      check('an older build keeps the user setting instead of resetting it',
        migrated.rows.gap === 99, 'rows.gap=' + migrated.rows.gap);

      const sameBuild = JSON.parse(JSON.stringify(shipped));
      sameBuild.rows = Object.assign({}, sameBuild.rows, { gap: 33 });
      const kept = global.CM.mergeIncoming(shipped, sameBuild);
      check('a same-version config keeps the user edits',
        kept.rows.gap === 33, 'rows.gap=' + kept.rows.gap);
    }

    /* Widening the panel must spread the columns to fill it, and the header and
       the rows must derive that from one place or the labels drift off the data.
       The asset column is the one exception: it stops at columns.assetMaxWidth,
       so the surplus grows the trend chart instead of opening a gutter. */
    {
      const row = collect(stage, 'row')[0];
      const cells = row ? row.children.slice() : [];
      const growers = cells.filter((c) => /^\d+(\.\d+)? 1 \d/.test(String(c.style.flex || '')));
      check('every column is a proportional grower, so widening the panel fills it',
        cells.length > 0 && growers.length === cells.length,
        growers.length + '/' + cells.length + ' columns grow');
      check('the header column uses the same flex formula as its row cell',
        !!board.colsEl && board.colsEl.children.every((h, i) => {
          const c = cells[i];
          if (!c) return true;
          const hf = String(h.style.flex || '');
          return hf === '' || hf === String(c.style.flex || '');
        }),
        board.colsEl ? board.colsEl.children.map((h) => h.style.flex).join(' | ') : 'no header');

      /* assetMaxWidth used to be documented but never applied, so the asset
         column kept absorbing surplus and pushed the chart narrow. The shim
         keeps classList separate from className, so both are found by position
         in columns.order rather than by class. */
      const assetIdx = (shipped.columns.order || []).indexOf('asset');
      const assetCell = assetIdx === -1 ? null : cells[assetIdx];
      const assetHead = (assetIdx === -1 || !board.colsEl) ? null : board.colsEl.children[assetIdx];
      const cap = shipped.columns.assetMaxWidth + 'px';
      check('assetMaxWidth caps the asset column, header and cell alike',
        !!assetCell && !!assetHead && assetCell.style.maxWidth === cap && assetHead.style.maxWidth === cap,
        'cell=' + (assetCell && assetCell.style.maxWidth) + ' head=' +
        (assetHead && assetHead.style.maxWidth) + ' want=' + cap);
    }

    /* The footer is the age of the last fetch (see updateNote). Switching it off
       must actually clear the node, because the stylesheet hides an EMPTY
       .board-note — text left behind would keep the padding under the last row
       and the panel would not collapse. In the offline mode there is no fetch to
       age, so the correct text is no text at all. */
    {
      const b = global.CM.engine.board;
      const note = collect(stage, 'note')[0];
      const hasData = MODE !== 'offline';
      check('the footer carries the fetch age when there is data',
        !!note && b.cfg.footer && b.cfg.footer.enabled === true &&
        (hasData ? /^Updated /.test(note.textContent) : note.textContent === ''),
        note ? JSON.stringify(note.textContent) : 'no note node');

      b.cfg.footer = { enabled: false };
      b.updateNote();
      check('footer.enabled false clears the status line',
        note.textContent === '', JSON.stringify(note.textContent));

      b.cfg.footer = { enabled: true };
      b.updateNote();
      check('footer.enabled true brings it back',
        hasData ? /^Updated /.test(note.textContent) : note.textContent === '',
        note.textContent);
    }

  /* ------------------------------------------- no timer, manual force
     The refresh interval is gone from the config and the engine. A load reads
     the hub (which owns the provider cache); only a manual update forces a new
     provider read, and that is visible as force=1 on the request. */
  check('the config carries no refresh interval',
    global.CM.getConfig().data.refreshSeconds === undefined,
    String(global.CM.getConfig().data.refreshSeconds));
  check('the engine has no automatic refresh timer',
    global.CM.engine.schedule === undefined, typeof global.CM.engine.schedule);

  fetchLog = [];
  await global.CM.refresh(false);
  const plainCall = fetchLog.filter((u) => u.indexOf('api/market') !== -1).pop() || '';
  check('a normal load does not force the provider', plainCall.indexOf('force=1') === -1,
    plainCall.slice(0, 90));

  fetchLog = [];
  await global.CM.refresh(true);
  const forcedCall = fetchLog.filter((u) => u.indexOf('api/market') !== -1).pop() || '';
  check('a manual update asks the hub for a forced read', forcedCall.indexOf('force=1') !== -1,
    forcedCall.slice(0, 100));
  /* The dashboard sends `update`; the handler must turn that into a forced read. */
  fetchLog = [];
  global.CM.handleCommand({ action: 'update', seq: 4242 });
  await new Promise((r) => setTimeout(r, 120));
  const cmdCall = fetchLog.filter((u) => u.indexOf('api/market') !== -1).pop() || '';
  check('the update command forces a provider read', cmdCall.indexOf('force=1') !== -1,
    cmdCall.slice(0, 110));

  /* A section can legitimately be empty; it must say so rather than showing a
     titled panel with nothing under it. */
  {
    const cfgNow = global.CM.getConfig();
    const active = global.CM.engine.board.activeIndex;
    const saved = cfgNow.categories[active].coins;
    cfgNow.categories[active].coins = [];
    global.CM.engine.board.renderRows();
    check('an empty category renders an explicit empty state',
      collect(stage, 'empty').length === 1, collect(stage, 'empty').length + ' empty node(s)');
    cfgNow.categories[active].coins = saved;
    global.CM.engine.board.renderRows();
  }

  /* A provider can answer a request for 7 ids with 6 rows (CoinGecko's search
     indexes coins that /coins/markets does not price), and a client-side timeout
     can leave the hub still retrying. Neither may leave a new row shimmering
     forever: once the read has finished, an unanswered id is an explicit
     "no market data" row, and one retry is scheduled to pick up the hub cache. */
  {
    const b = global.CM.engine.board;
    const coins = b.activeCoins();
    const victim = coins[0];
    const saved = b.data[victim] || { id: victim, name: victim, symbol: 'XX', rank: 1, price: 1, change24h: 1, change7d: 1 };
    delete b.data[victim];
    b.state.loaded = true;
    b.stage.dataset.state = 'ready';
    if (b._retryTimer) { clearTimeout(b._retryTimer); b._retryTimer = null; }
    b._retries = 0;
    b.renderRows();

    const row = b.rowEls.filter((r) => r.coin === victim)[0];
    check('a payload without a record stops shimmering and marks the row missing',
      !!row && !row.root.classList.contains('is-loading') && row.root.classList.contains('is-missing'),
      row ? row.root.className : 'row not found');
    check('the missing row still carries the id and dashes, not a blank hole',
      !!row && row.cells.asset.children[1].children[0].textContent === victim &&
      row.cells.price.textContent === '\u2014' && row.cells.change24h.textContent === '\u2014',
      row ? JSON.stringify([row.cells.asset.children[1].children[0].textContent,
        row.cells.price.textContent, row.cells.change24h.textContent]) : 'no row');

    b.afterRefresh();
    check('an unanswered read schedules exactly one retry',
      !!b._retryTimer && b._retries === 1, b._retries + ' retry, timer=' + !!b._retryTimer);
    b.afterRefresh();
    check('the retry is not re-armed while one is pending',
      b._retries === 1, b._retries + ' retries');

    clearTimeout(b._retryTimer);
    b._retryTimer = null;
    b._retries = 0;
    b.data[victim] = saved;
    b.renderRows();
    check('restoring the record clears the missing state',
      b.rowEls.filter((r) => r.coin === victim)[0].root.classList.contains('is-missing') === false,
      'restored');
  }
  /* An asset added while the board is on air must enter on its own, not pop in
     with the rebuilt board. Only the new row animates; the existing prices stay
     put (a full entrance would flash every price on air). */
  {
    const cfgNow = global.CM.getConfig();
    const prevBoard = global.CM.engine.board;
    const act = prevBoard.activeIndex;
    if (!prevBoard.state.onAir) prevBoard.state.onAir = true;   /* showInstant path */
    const before = tweenLog.length;
    /* the poll hands the engine a NEW resolved object; mutating the live one in
       place would also mutate the old board's view and hide the addition */
    const nextCfg = JSON.parse(JSON.stringify(cfgNow));
    nextCfg.categories[act].coins = nextCfg.categories[act].coins.concat(['cardano']);
    global.CM.engine.applyConfig(nextCfg);
    await new Promise((r) => setTimeout(r, 300));

    const added = tweenLog.slice(before).filter((t) => t.kind === 'from' && t.targets.indexOf('cardano') !== -1);
    check('a newly added asset animates in instead of popping in',
      added.length === 1, added.length + ' tween(s) for cardano');
    check('the new-row entrance is a slide + fade',
      added.length === 1 && added[0].vars.opacity === 0 && added[0].vars.y > 0,
      added[0] ? 'opacity=' + added[0].vars.opacity + ' y=' + added[0].vars.y : 'no tween');
    check('only the new row animates; existing rows do not replay',
      added.length === 1 && added[0].targets.length === 1,
      added[0] ? 'targets=' + added[0].targets.join(',') : 'no tween');

    const beforeSecond = tweenLog.length;
    const backCfg = JSON.parse(JSON.stringify(nextCfg));
    backCfg.categories[act].coins.pop();
    global.CM.engine.applyConfig(backCfg);
    await new Promise((r) => setTimeout(r, 300));
    const rowTweens = tweenLog.slice(beforeSecond).filter((t) => t.kind === 'from');
    check('a config edit that adds no asset does not animate any row', rowTweens.length === 0,
      rowTweens.length + ' row tween(s)');
  }
  /* Removing an asset mirrors the add: the row collapses out on the OLD board,
     then the board rebuilds without it — so the exit is visible instead of the
     row vanishing in a wholesale re-render. */
  {
    const cfgNow = global.CM.getConfig();
    const oldBoard = global.CM.engine.board;
    const act = oldBoard.activeIndex;
    const victim = oldBoard.activeCoins()[0];
    const rowCount = oldBoard.rowEls.length;
    if (!oldBoard.state.onAir) oldBoard.state.onAir = true;
    const before = tweenLog.length;
    const next = JSON.parse(JSON.stringify(cfgNow));
    next.categories[act].coins = next.categories[act].coins.filter((id) => id !== victim);
    global.CM.engine.applyConfig(next);

    const out = tweenLog.slice(before).filter((t) => t.kind === 'to' && t.targets.indexOf(victim) !== -1);
    check('removing an asset animates its row out', out.length === 1,
      out.length + ' exit tween(s) for ' + victim);
    check('the row exit is a collapse + fade, not a pop', out.length === 1 && out[0].vars.height === 0 &&
      out[0].vars.opacity === 0, out[0] ? JSON.stringify(out[0].vars) : 'no tween');
    check('the exit animates only the removed row', out.length === 1 && out[0].targets.length === 1,
      out[0] ? 'targets=' + out[0].targets.join(',') : 'no tween');

    await new Promise((r) => setTimeout(r, 600));
    const rebuilt = global.CM.engine.board;
    check('the board rebuilds without the removed row after the exit',
      rebuilt.rowEls.length === rowCount - 1 && rebuilt.rowEls.every((r) => r.coin !== victim),
      rebuilt.rowEls.length + ' rows (was ' + rowCount + ')');

    const restore = JSON.parse(JSON.stringify(cfgNow));
    global.CM.engine.applyConfig(restore);
    await new Promise((r) => setTimeout(r, 400));
  }
  /* OBS throttles rAF while the browser source is hidden, and GSAP completes
     tweens from ticker callbacks — a collapse that never ticks must not strand
     the board on the old config. The safety timer rebuilds regardless. */
  {
    const cfgNow = global.CM.getConfig();
    const oldBoard = global.CM.engine.board;
    const act = oldBoard.activeIndex;
    const victim = oldBoard.activeCoins()[0];
    if (!oldBoard.state.onAir) oldBoard.state.onAir = true;
    const realTo = global.gsap.to;
    global.gsap.to = () => { /* a tween that never completes */ };
    const next = JSON.parse(JSON.stringify(cfgNow));
    next.categories[act].coins = next.categories[act].coins.filter((id) => id !== victim);
    global.CM.engine.applyConfig(next);
    const stayedOnOldBoard = global.CM.engine.board === oldBoard;
    await new Promise((r) => setTimeout(r, 1100));
    global.gsap.to = realTo;
    check('a throttled exit still rebuilds through the safety timer',
      stayedOnOldBoard && global.CM.engine.board !== oldBoard &&
      global.CM.engine.board.rowEls.every((r) => r.coin !== victim),
      'rebuilt=' + (global.CM.engine.board !== oldBoard));
    const restore = JSON.parse(JSON.stringify(cfgNow));
    global.CM.engine.applyConfig(restore);
    await new Promise((r) => setTimeout(r, 400));
  }
  /* ------------------------------------------------------------- report */  let failed = 0;
  console.log('\n  digital assets market — smoke test — mode: ' + MODE + '\n  ' + '-'.repeat(58));
  results.forEach((r) => {
    if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : ''));
  });
  console.log('  ' + '-'.repeat(58));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
  /* 900ms, not 250ms: the command poll is armed for 400ms, and the point of the
     last four checks is that the poll actually reaches the board. */
}, 900);
