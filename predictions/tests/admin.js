#!/usr/bin/env node
/* ============================================================================
   Prediction Markets — control panel runtime check
   ----------------------------------------------------------------------------
   Loads the REAL admin.html, builds a DOM shim from the ids/inputs it actually
   contains, then executes config.js + config-merge.js + admin.js against it,
   with a stubbed `fetch` that can answer per URL. No browser, no server.

     node tests/admin.js

   The two things this guards that a syntax pass cannot:

     • F1 — the panel must READ config.json on load. It autosaves the whole
       config on every edit, so on a browser whose localStorage was empty or
       stale the first keystroke used to overwrite the live file with the
       shipped sample markets and delete every key that only existed in the
       file. The panel now mirrors what is on air, and loading must never POST.

     • The Polymarket Update path — the only network call this panel makes. A
       failed category must keep the headlines it already has (a board on air is
       never blanked by a hiccup), a category without a usable tag must not be
       fetched at all, a slug must resolve to an id from the loaded tag list,
       and a tick the operator made must survive an Update.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');

/* ------------------------------------------------------------- DOM shim --- */
function matches(node, sel) {
  sel = sel.trim();
  const m = /^([a-z]+)?((?:\.[\w-]+)*)(?:\[([\w-]+)="([^"]*)"\])?$/i.exec(sel);
  if (!m) return false;
  const tag = m[1], classes = m[2], attr = m[3], val = m[4];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (classes) {
    for (const c of classes.split('.').filter(Boolean)) {
      if (!String(node.className).split(/\s+/).includes(c)) return false;
    }
  }
  if (attr && String((node.attrs || {})[attr] !== undefined ? node.attrs[attr] : node[attr]) !== val) return false;
  return !!(tag || classes || attr);
}

function descendants(node, out) {
  out = out || [];
  (node.children || []).forEach((c) => { out.push(c); descendants(c, out); });
  return out;
}

function mkNode(tag, attrs) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    attrs: attrs || {},
    id: (attrs && attrs.id) || '',
    className: (attrs && attrs.class) || '',
    type: (attrs && attrs.type) || '',
    value: (attrs && attrs.value) || '',
    checked: false,
    disabled: false,
    textContent: '',
    placeholder: '',
    title: '',
    children: [],
    dataset: {},
    _handlers: {},
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
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
    appendChild(c) { this.children.push(c); return c; },
    append(...c) { c.forEach((x) => this.children.push(x)); },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    querySelector(sel) { return descendants(this).find((n) => matches(n, sel)) || null; },
    querySelectorAll(sel) { return descendants(this).filter((n) => matches(n, sel)); },
    dispatch(type) { (this._handlers[type] || []).forEach((fn) => fn.call(this, { target: this, preventDefault() {} })); },
    focus() {},
    select() {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = String(v); this.children = []; }
  };
}

/* --------------------------------------------------- parse the real page */
const elements = new Map();
{
  const re = /<([a-z0-9]+)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(HTML))) {
    const tag = m[1].toLowerCase();
    const attrs = {};
    m[2].replace(/([a-z-]+)="([^"]*)"/gi, (_, k, v) => { attrs[k.toLowerCase()] = v; return ''; });
    if (attrs.id) elements.set(attrs.id, mkNode(tag, attrs));
  }
}

const tabs = [...HTML.matchAll(/data-tab="([a-z]+)"/g)].map((x) => x[1]);
const panels = [...HTML.matchAll(/data-panel="([a-z]+)"/g)].map((x) => x[1]);
const tabNodes = tabs.map((t) => Object.assign(mkNode('button'), { dataset: { tab: t } }));
const panelNodes = panels.map((p) => Object.assign(mkNode('div'), { dataset: { panel: p } }));

/* ------------------------------------------------------------------ globals */
const fetches = [];          /* every HTTP call the panel makes */
const polyCalls = [];        /* just the what=top calls, for URL assertions */
const messages = [];
const store = {};
let bootError = null;

const documentShim = {
  readyState: 'complete',
  head: mkNode('head'),
  body: mkNode('body'),
  documentElement: mkNode('html'),
  createElement: (t) => mkNode(t),
  getElementById: (id) => elements.get(id) || null,
  addEventListener() {},
  querySelector(sel) {
    const p = /\[data-panel="([a-z]+)"\]/.exec(sel);
    if (p) return panelNodes.find((n) => n.dataset.panel === p[1]) || null;
    return null;
  },
  querySelectorAll(sel) {
    if (sel === '.tab') return tabNodes;
    if (sel === '.panel-body') return panelNodes;
    return [];
  },
  execCommand: () => true
};

const previewNode = elements.get('preview');
if (previewNode) previewNode.contentWindow = { postMessage: (msg) => messages.push(msg) };

global.window = global;
global.document = documentShim;
global.location = { search: '', hash: '', protocol: 'http:', origin: 'http://localhost:8790', pathname: '/predictions/admin.html' };
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.confirm = () => true;
global.alert = () => {};
global.addEventListener = () => {};
global.matchMedia = () => ({ matches: false });
global.Blob = function () {};
global.URL.createObjectURL = () => 'blob:x';
global.URL.revokeObjectURL = () => {};

/* ---------------------------------------------------------- fixtures ----- */

/* What config.json holds on the machine: ONE hand-typed market and a full
   Polymarket setup. The shipped defaults hold eight sample markets, so if the
   panel failed to read this file the difference is unmistakable. Built after
   config.js is required (below) — `let` so the boot block can fill it in. */
let liveCfg = {};

function item(id, title, probability, change, volume24hr) {
  return {
    id: id,
    title: title,
    slug: 'slug-' + id,
    url: 'https://polymarket.com/event/' + id,
    probability: probability,
    change: change,
    volume24hr: volume24hr,
    volume: volume24hr === null ? null : volume24hr * 2,
    liquidity: 1000,
    endDate: '2026-12-31T00:00:00Z',
    image: '',
    outcome: 'Yes',
    entity: 'events'
  };
}

const TAGS_BODY = {
  what: 'tags',
  total: 4,
  tags: [
    { id: '7', label: 'Crypto Markets', slug: 'crypto-markets' },
    { id: '9', label: 'Economy', slug: 'economy' },
    { id: '12', label: 'Finance', slug: 'finance' },
    { id: '3', label: 'Politics', slug: 'politics' }
  ]
};

/* id, title, probability, change, 24h volume. `c` deliberately has NO price:
   the panel must print an em dash for it, never a made-up 0%. */
const ROUND_A = {
  crypto: [
    item('a', 'Will BTC close above $150k?', 68, 4.2, 1200000),
    item('b', 'Will the Fed cut twice?', 31, -1.1, 4800000),
    item('c', 'Will ETH flip BTC?', null, null, 900000),
    item('d', 'Will a SOL ETF launch?', 22, 3.3, 600000),
    item('e', 'Multi-market headline', 55, 0, 3000000)
  ],
  economy: [item('q1', 'CPI under 3%?', 44, 0.5, 700000)],
  named: [item('n1', 'Named tag headline', 12, 0, 1000)]
};

/* b survives the reshuffle, the rest of round A does not. */
const ROUND_B_CRYPTO = [
  item('b', 'Will the Fed cut twice?', 34, 3.0, 5100000),
  item('x', 'A brand new headline', 19, 0, 2000000),
  item('y', 'Another new headline', 61, -2.0, 1500000)
];

/* what the category AFTER the failing one must still receive */
const ROUND_C_ECONOMY = [item('z1', 'Post-failure headline', 51, 0, 99000)];

const POLY_ERROR = { error: { code: 'upstream_error', message: 'Polymarket returned an error: maintenance' } };

const polyState = {
  fail: null,          /* category id that answers 502 with a JSON error */
  html404: null,       /* category id served a plain HTML 404 (the wrong server) */
  html200: null,       /* category id served a 200 body that is not JSON */
  items: JSON.parse(JSON.stringify(ROUND_A))
};

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: () => Promise.resolve(body)
  };
}

/* What predictions/server.js really answers for a path it does not know: an
   HTML 404, not a JSON error. `json()` must therefore REJECT, exactly as a
   browser's Response.json() does on a body it cannot parse. */
function htmlReply(status) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: () => Promise.reject(new Error('Unexpected token < in JSON at position 0')),
    text: () => Promise.resolve('<!DOCTYPE html><html><body>404 Not Found</body></html>')
  };
}

global.fetch = (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  fetches.push({ url: u, method: method });

  if (u.indexOf('api/config') !== -1) {
    if (method === 'POST') return Promise.resolve(reply(200, { ok: true, keys: 1 }));
    return Promise.resolve(reply(200, JSON.parse(JSON.stringify(liveCfg))));
  }
  if (u.indexOf('api/polymarket') !== -1) {
    if (u.indexOf('what=tags') !== -1) return Promise.resolve(reply(200, TAGS_BODY));
    polyCalls.push(u);
    const m = /[?&]category=([^&]*)/.exec(u);
    const cat = m ? decodeURIComponent(m[1]) : '';
    if (polyState.html404 === cat) return Promise.resolve(htmlReply(404));
    if (polyState.html200 === cat) return Promise.resolve(htmlReply(200));
    if (polyState.fail === cat) return Promise.resolve(reply(502, POLY_ERROR));
    const items = polyState.items[cat];
    if (!items) return Promise.resolve(reply(502, { error: { code: 'upstream_error', message: 'no fixture for ' + cat } }));
    return Promise.resolve(reply(200, {
      what: 'top', category: cat, entity: 'events',
      fetchedAt: Date.now(), count: items.length, items: items
    }));
  }
  return Promise.resolve(reply(200, {}));
};

/* ------------------------------------------------------------------- boot */
const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const getCfg = () => JSON.parse(store['pm-config-v1'] || '{}');
const catCfg = (id) => ((getCfg().polymarket || {}).categories || []).find((c) => c.id === id) || {};
const blocks = () => (elements.get('polyCategories').children || []);
const blockFor = (label) => blocks().find((b) => {
  const n = b.querySelector('.polycat__name');
  return !!n && n.textContent === label;
});

/* the live file, applied AFTER config.js is loaded and BEFORE admin.js boots */
function buildLiveCfg() {
  liveCfg = JSON.parse(JSON.stringify(global.PM_DEFAULT_CONFIG || {}));
  liveCfg.markets.items = [{
    topic: 'Live from config.json',
    probability: 61,
    volume: 111000,
    change: 1.2,
    category: 'Desk',
    ends: '2026-12-31',
    enabled: true
  }];
  liveCfg.source = 'polymarket';
  liveCfg.footer.left.source = 'polymarket';
  liveCfg.polymarket.fetched = 5;
  liveCfg.polymarket.sortKey = '';
  liveCfg.polymarket.updatedAt = 0;
  liveCfg.polymarket.lastError = '';
  liveCfg.polymarket.categories = [
    { id: 'crypto', label: 'Crypto', tagId: '1', tagSlug: 'crypto', count: 3, selection: [], items: [], error: '' },
    { id: 'economy', label: 'Economy', tagId: '', tagSlug: 'economy', count: 2, selection: [], items: [], error: '' },
    { id: 'tagless', label: 'Tagless', tagId: '', tagSlug: '!!!', count: 1, selection: [], items: [], error: '' },
    { id: 'named', label: 'Named', tagId: '', tagSlug: 'Crypto Markets', count: 2, selection: [], items: [], error: '' },
    /* A LEGAL slug that matches no tag in the list. This is the case that used to
       be sent to /events as `tag_slug` — where an ignored filter does not fail,
       it returns the GLOBAL top, putting the same headlines in every column and
       looking like a design choice rather than a bug. */
    { id: 'unmatched', label: 'Unmatched', tagId: '', tagSlug: 'nonexistent-tag', count: 1, selection: [], items: [], error: '' }
  ];
}

try {
  require(path.join(ROOT, 'config.js'));
  require(path.join(ROOT, 'config-merge.js'));
  buildLiveCfg();
  require(path.join(ROOT, 'admin.js'));
} catch (e) { bootError = e; }

check('admin.js boots without throwing', !bootError, bootError ? bootError.message : 'clean');
if (bootError) {
  console.log('\n  predictions admin — runtime check\n  ' + '-'.repeat(56));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '   [' + r.info + ']'));
  console.log('\n  ' + String(bootError.stack).split('\n').slice(0, 6).join('\n  ') + '\n');
  process.exit(1);
}

/* ------------------------------------------------------------- structure */
check('a Polymarket tab exists in the strip',
  /<button class="tab" data-tab="poly"/.test(HTML), (HTML.match(/data-tab="poly"/g) || []).length + ' tab');
check('a matching panel body exists',
  (HTML.match(/data-panel="poly"/g) || []).length === 1,
  (HTML.match(/data-panel="poly"/g) || []).length + ' panel');
check('tabs and panels still line up one-to-one', tabs.length === panels.length,
  tabs.join(',') + ' / ' + panels.join(','));

const boundIds = [...ADMIN_JS.matchAll(/bind\('([^']+)',\s*'([^']+)'/g)].map((m) => m[2]);
const missingIds = boundIds.filter((id) => !elements.has(id));
check('every bound field exists in admin.html', missingIds.length === 0,
  missingIds.join(', ') || boundIds.length + ' fields');

const polyControls = ['c_source', 'c_polyEntity', 'c_polyFetched', 'c_polySortKey',
  'btnPolyUpdate', 'btnPolyTags', 'polyCategories', 'polyBoardStatus', 'polyProgress'];
const missingControls = polyControls.filter((id) => !elements.has(id));
check('the Polymarket controls all exist in admin.html', missingControls.length === 0,
  missingControls.join(', ') || polyControls.length + ' controls');
const unbound = ['c_source', 'c_polyEntity', 'c_polyFetched', 'c_polySortKey'].filter((id) => !boundIds.includes(id));
check('the Polymarket fields are bound to the config', unbound.length === 0,
  unbound.join(', ') || '4 bound');

/* the new tab really switches panels through the panel's own generic code */
tabNodes.find((t) => t.dataset.tab === 'poly').dispatch('click');
check('clicking the Polymarket tab shows its panel',
  panelNodes.find((p) => p.dataset.panel === 'poly').classList.contains('is-active'),
  'poly panel is-active');

/* ------------------------------------------------------------------ drive */
(async function main() {
  /* the boot push lands at 400ms; waiting for it is also what proves the load
     path no longer treats this browser's localStorage as the truth */
  await delay(650);

  const gets = fetches.filter((f) => f.url.indexOf('api/config') !== -1 && f.method === 'GET');
  const posts = fetches.filter((f) => f.url.indexOf('api/config') !== -1 && f.method === 'POST');
  check('the panel GETs api/config on load', gets.length === 1,
    gets.length + ' GET, ' + posts.length + ' POST');
  check('loading does NOT POST to api/config (the F1 regression)', posts.length === 0,
    posts.map((f) => f.method + ' ' + f.url).join(', ') || 'no writes on load');

  const cfgNow = getCfg();
  const shippedItems = (global.PM_DEFAULT_CONFIG.markets.items || []).length;
  check('the live board in config.json survives, not the shipped samples',
    (cfgNow.markets.items || []).length === 1 && cfgNow.markets.items[0].topic === 'Live from config.json',
    (cfgNow.markets.items || []).length + ' items (shipped has ' + shippedItems + ') "' +
      (((cfgNow.markets.items || [])[0] || {}).topic || '') + '"');
  check('no config.json key is dropped by the merge',
    cfgNow.source === 'polymarket' &&
    (cfgNow.polymarket.categories || []).length === liveCfg.polymarket.categories.length,
    'source=' + cfgNow.source + ' categories=' + (cfgNow.polymarket.categories || []).length +
      ' (the file holds ' + liveCfg.polymarket.categories.length + ')');

  const statusNode = elements.get('status');
  check('the status line says the panel mirrors what is on air',
    /mirrors what is on air/.test(statusNode.textContent), statusNode.textContent);

  /* -------------------------------------------------------- source + scrub */
  const src = elements.get('c_source');
  check('the source select shows the file\'s value', src.value === 'polymarket', String(src.value));

  /* switching back to the hand-typed board makes naming Polymarket a lie again */
  src.value = 'manual';
  src.dispatch('change');
  check('switching source writes source=manual', getCfg().source === 'manual', getCfg().source);
  check('the venue name is stripped again for the manual board',
    getCfg().footer.left.source === '', '"' + getCfg().footer.left.source + '"');
  check('the stripped venue is reflected in the footer field',
    elements.get('c_footSource').value === '', '"' + elements.get('c_footSource').value + '"');

  src.value = 'polymarket';
  src.dispatch('change');
  check('switching source back writes source=polymarket', getCfg().source === 'polymarket', getCfg().source);

  /* ------------------------------------------------------------ bindings */
  const ent = elements.get('c_polyEntity');
  ent.value = 'markets';
  ent.dispatch('change');
  check('the entity select writes polymarket.entity', getCfg().polymarket.entity === 'markets',
    getCfg().polymarket.entity);
  ent.value = 'events';
  ent.dispatch('change');

  const fetchedInput = elements.get('c_polyFetched');
  fetchedInput.value = '6';
  fetchedInput.dispatch('input');
  check('the fetched input coerces to a number', getCfg().polymarket.fetched === 6,
    typeof getCfg().polymarket.fetched + ' ' + getCfg().polymarket.fetched);
  fetchedInput.value = '5';
  fetchedInput.dispatch('input');

  const sortInput = elements.get('c_polySortKey');
  sortInput.value = 'liquidity';
  sortInput.dispatch('input');
  check('the sort-key override writes through', getCfg().polymarket.sortKey === 'liquidity',
    getCfg().polymarket.sortKey);

  /* edits DO autosave — the no-POST rule is about loading only. The save is
     debounced 500ms, so this waits for it rather than reading too early. */
  await delay(620);
  const earlyPosts = fetches.filter((f) => f.url.indexOf('api/config') !== -1 && f.method === 'POST').length;
  check('an edit after load DOES autosave', earlyPosts > 0, earlyPosts + ' posts since boot');

  /* -------------------------------------------------- categories, unloaded */
  check('one block per configured category, in config order',
    blocks().length === liveCfg.polymarket.categories.length &&
    blocks().map((b) => b.querySelector('.polycat__name').textContent).join(',') ===
      liveCfg.polymarket.categories.map((c) => c.label).join(','),
    blocks().map((b) => b.querySelector('.polycat__name').textContent).join(','));
  check('before Load tags the binding is a text id input plus a slug input',
    !!blockFor('Crypto').querySelector('.poly-tagid') &&
    !!blockFor('Crypto').querySelector('.poly-slug') &&
    !blockFor('Crypto').querySelector('.poly-tag'),
    'text input shown, no select yet');
  check('an empty category says there is nothing to pick yet',
    blockFor('Crypto').querySelectorAll('.hint').some((h) => /No headlines yet/.test(h.textContent)),
    blockFor('Crypto').querySelectorAll('.hint').map((h) => h.textContent).join(' | '));

  /* ------------------------------------------------------------- round A */
  const btn = elements.get('btnPolyUpdate');
  btn.dispatch('click');
  check('the Update button locks and reports progress while it runs',
    btn.disabled === true && /Updating/.test(btn.textContent),
    'disabled=' + btn.disabled + ' label="' + btn.textContent + '"');
  await waitFor(() => !btn.disabled, 2000);

  const crypto = catCfg('crypto');
  check('a 200 seeds the category items from the proxy',
    (crypto.items || []).map((i) => i.id).join(',') === 'a,b,c,d,e',
    (crypto.items || []).map((i) => i.id).join(','));
  check('a 200 seeds selection with every fetched id',
    (crypto.selection || []).join(',') === 'a,b,c,d,e', (crypto.selection || []).join(','));
  check('a 200 stamps polymarket.updatedAt', getCfg().polymarket.updatedAt > 0,
    'updatedAt=' + getCfg().polymarket.updatedAt);
  check('the pulled count is sent to the hub',
    polyCalls.some((u) => u.indexOf('category=crypto') !== -1 && u.indexOf('limit=5') !== -1),
    polyCalls.find((u) => u.indexOf('category=crypto') !== -1) || 'never called');
  check('a digits tag id is sent and the slug is left out',
    polyCalls.some((u) => /category=crypto&entity=events&limit=5&tagId=1&sortKey=liquidity/.test(u)),
    polyCalls.find((u) => u.indexOf('category=crypto') !== -1) || 'never called');
  check('a well-formed slug is resolved to a tag ID, not sent as a slug',
    polyCalls.some((u) => u.indexOf('category=economy') !== -1 && u.indexOf('tagId=9') !== -1 &&
      u.indexOf('tagSlug=') === -1),
    polyCalls.find((u) => u.indexOf('category=economy') !== -1) || 'never called');
  check('the resolved id is written back into the config',
    catCfg('economy').tagId === '9', 'tagId=' + JSON.stringify(catCfg('economy').tagId));
  check('Update loads the tag list itself when a category still needs resolving',
    fetches.filter((f) => f.url.indexOf('what=tags') !== -1).length >= 1,
    fetches.filter((f) => f.url.indexOf('what=tags') !== -1).length + ' tag call(s)');

  /* The guard that matters: a legal slug with no matching tag must NOT be sent to
     /events, because an ignored tag filter answers with the global top rather
     than an error. */
  const unmatched = catCfg('unmatched');
  check('a legal slug that matches no tag is not sent to the hub at all',
    polyCalls.filter((u) => u.indexOf('category=unmatched') !== -1).length === 0,
    polyCalls.filter((u) => u.indexOf('category=unmatched') !== -1).length + ' calls');
  check('...and it reports that it needs a tag from the loaded list',
    /nonexistent-tag/.test(unmatched.error || '') && /Load tags/.test(unmatched.error || ''),
    unmatched.error || '(no error)');

  const tagless = catCfg('tagless');
  check('a category with no usable tag binding is never fetched',
    polyCalls.filter((u) => u.indexOf('category=tagless') !== -1).length === 0,
    polyCalls.filter((u) => u.indexOf('category=tagless') !== -1).length + ' calls');
  check('...and records an error naming the slug and pointing at Load tags',
    /!!!/.test(tagless.error || '') && /Load tags/.test(tagless.error || ''),
    tagless.error || '(no error)');
  check('...while the other categories still updated in the same run',
    (catCfg('economy').items || []).map((i) => i.id).join(',') === 'q1' && catCfg('economy').error === '',
    'economy="' + (catCfg('economy').items || []).map((i) => i.id).join(',') + '" error="' + catCfg('economy').error + '"');
  check('the failure summary names exactly the categories that failed',
    /failed:.*Tagless/.test(getCfg().polymarket.lastError || '') &&
    /Unmatched/.test(getCfg().polymarket.lastError || '') &&
    !/Named/.test(getCfg().polymarket.lastError || ''),
    getCfg().polymarket.lastError);
  check('the prompt to Load tags also shows on the failed block',
    /Load tags/.test(blockFor('Tagless').querySelector('.polycat__status').textContent),
    blockFor('Tagless').querySelector('.polycat__status').textContent);

  const cRows = blockFor('Crypto').querySelectorAll('.polyitem');
  check('every fetched headline gets a checkbox, labelled with its numbers',
    cRows.length === 5 && cRows.every((r) => !!r.querySelector('.polyitem__title') &&
      !!r.querySelector('.polyitem__meta')),
    cRows.length + ' rows');
  check('a market with no price renders an em dash, never a fabricated 0%',
    /\u2014/.test(cRows[2].querySelector('.polyitem__meta').textContent) &&
    !/0%/.test(cRows[2].querySelector('.polyitem__meta').textContent),
    cRows[2].querySelector('.polyitem__meta').textContent);

  /* ---------------------------------------------------------- count + tick */
  const count = blockFor('Crypto').querySelector('.poly-count');
  const options = count.children.map((o) => o.textContent);
  check('the count select offers 0..fetched with 0 labelled hide',
    options[0] === 'hide' && options.length === 6, options.join(','));
  count.value = '2';
  count.dispatch('change');
  check('the count control writes count', catCfg('crypto').count === 2, String(catCfg('crypto').count));
  count.value = '0';
  count.dispatch('change');
  check('count 0 (hide the category) is allowed', catCfg('crypto').count === 0, String(catCfg('crypto').count));
  count.value = '3';
  count.dispatch('change');

  const picks = blockFor('Crypto').querySelectorAll('.poly-pick');
  check('every headline starts ticked when selection is "all"',
    picks.every((p) => p.checked), picks.filter((p) => p.checked).length + '/' + picks.length);
  picks[2].checked = false;
  picks[2].dispatch('change');
  check('unticking a headline rewrites selection in item order',
    (catCfg('crypto').selection || []).join(',') === 'a,b,d,e',
    (catCfg('crypto').selection || []).join(','));

  /* ------------------------------------------------------------ Load tags */
  elements.get('btnPolyTags').dispatch('click');
  await waitFor(() => !!blockFor('Crypto').querySelector('.poly-tag'), 1500);
  const tagPick = blockFor('Crypto').querySelector('.poly-tag');
  check('Load tags fetches what=tags and rebuilds the binding as a select',
    !!tagPick && tagPick.children.length === 5 &&
    fetches.some((f) => f.url.indexOf('what=tags') !== -1),
    tagPick ? tagPick.children.length + ' options, ' +
      fetches.filter((f) => f.url.indexOf('what=tags') !== -1).length + ' tags call' : 'no select');
  check('the loaded tag list is NOT written into the config',
    !Object.prototype.hasOwnProperty.call(getCfg().polymarket, 'tags'),
    Object.keys(getCfg().polymarket).join(','));
  check('the select shows the id already bound for the category',
    tagPick.value === '1', 'value=' + tagPick.value);

  tagPick.value = '12';
  tagPick.dispatch('change');
  check('binding a tag select writes the category tagId', catCfg('crypto').tagId === '12',
    String(catCfg('crypto').tagId));
  const tagPick2 = blockFor('Crypto').querySelector('.poly-tag');
  tagPick2.value = '1';
  tagPick2.dispatch('change');
  check('re-binding the tag select writes it back', catCfg('crypto').tagId === '1', String(catCfg('crypto').tagId));

  check('a human-typed tag name resolves by LABEL from the loaded list',
    catCfg('named').tagId === '7' && catCfg('named').tagSlug === 'Crypto Markets',
    'tagId="' + catCfg('named').tagId + '" slug="' + catCfg('named').tagSlug + '"');

  /* ------------------------------------------------------------- round B */
  polyState.items.crypto = JSON.parse(JSON.stringify(ROUND_B_CRYPTO));
  const beforeB = polyCalls.length;
  await runUpdate(btn);
  const cryptoB = catCfg('crypto');
  check('an Update replaces items with the new top N',
    (cryptoB.items || []).map((i) => i.id).join(',') === 'b,x,y',
    (cryptoB.items || []).map((i) => i.id).join(','));
  check('a previously ticked id still in the new top N stays ticked',
    (cryptoB.selection || []).indexOf('b') !== -1, (cryptoB.selection || []).join(','));
  check('selection is re-seeded with every fetched id',
    (cryptoB.selection || []).join(',') === 'b,x,y', (cryptoB.selection || []).join(','));
  check('ids that fell out of the list are dropped from selection',
    (cryptoB.selection || []).indexOf('a') === -1 && (cryptoB.selection || []).indexOf('c') === -1,
    (cryptoB.selection || []).join(','));

  const named = catCfg('named');
  const namedUrl = polyCalls.slice(beforeB).find((u) => u.indexOf('category=named') !== -1) || '';
  check('a slug resolves to a tag id from the loaded tag list', named.tagId === '7',
    'tagId=' + JSON.stringify(named.tagId) + ' slug=' + JSON.stringify(named.tagSlug));
  check('the resolved id is what is actually sent, the slug is dropped',
    /tagId=7/.test(namedUrl) && !/tagSlug=/.test(namedUrl), namedUrl || 'never called');
  check('the resolved category then fetches successfully',
    named.error === '' && (named.items || []).length === 1,
    'error="' + named.error + '" items=' + (named.items || []).length);

  /* ------------------------------------------------------------- round C
     A failed category keeps the headlines it already has, and the categories
     after it are still fetched. */
  const keptIds = (catCfg('crypto').items || []).map((i) => i.id).join(',');
  polyState.fail = 'crypto';
  polyState.items.economy = JSON.parse(JSON.stringify(ROUND_C_ECONOMY));
  const beforeC = polyCalls.length;
  await runUpdate(btn);
  const cryptoC = catCfg('crypto');
  check('a failed fetch keeps the OLD headlines (a board on air is never blanked)',
    (cryptoC.items || []).map((i) => i.id).join(',') === keptIds,
    (cryptoC.items || []).map((i) => i.id).join(',') + ' (was ' + keptIds + ')');
  check('a failed fetch records the hub\'s own error message',
    /maintenance/.test(cryptoC.error || ''), cryptoC.error || '(no error)');
  check('the error is shown on the category block',
    /maintenance/.test(blockFor('Crypto').querySelector('.polycat__status').textContent),
    blockFor('Crypto').querySelector('.polycat__status').textContent);
  check('the failure does not abort the categories after it',
    (catCfg('economy').items || []).map((i) => i.id).join(',') === 'z1' &&
    polyCalls.slice(beforeC).some((u) => u.indexOf('category=economy') !== -1),
    'economy="' + (catCfg('economy').items || []).map((i) => i.id).join(',') + '"');
  check('lastError names the failed category and the board status shows it',
    /failed:.*Crypto/.test(getCfg().polymarket.lastError || '') &&
    /failed:.*Crypto/.test(elements.get('polyBoardStatus').textContent),
    getCfg().polymarket.lastError + ' || ' + elements.get('polyBoardStatus').textContent);

  /* ------------------------------------------------------------- round D
     The panel opened from predictions/server.js (8791) instead of the hub: that
     server has no /api/polymarket route, so it answers a plain HTML 404. The
     operator must be told which server to start — and the category must keep
     the headlines it already has. */
  const keptNamed = (catCfg('named').items || []).map((i) => i.id).join(',');
  const keptEconomy = (catCfg('economy').items || []).map((i) => i.id).join(',');
  polyState.fail = null;
  polyState.html404 = 'named';
  polyState.html200 = 'economy';
  await runUpdate(btn);
  const namedD = catCfg('named');
  check('a plain HTML 404 is reported as the wrong server, not as "HTTP 404"',
    /Overlays\/server\.js/.test(namedD.error || '') && /localhost:8790/.test(namedD.error || '') &&
    !/HTTP 404/.test(namedD.error || ''),
    namedD.error || '(no error)');
  check('...and that category keeps the headlines it already had',
    (namedD.items || []).map((i) => i.id).join(',') === keptNamed,
    (namedD.items || []).map((i) => i.id).join(',') + ' (was ' + keptNamed + ')');
  check('...and the same hint is shown on the category block',
    /Overlays\/server\.js/.test(blockFor('Named').querySelector('.polycat__status').textContent),
    blockFor('Named').querySelector('.polycat__status').textContent);
  check('a 200 reply that is not JSON is an error too, never an empty board',
    /Overlays\/server\.js/.test(catCfg('economy').error || '') &&
    (catCfg('economy').items || []).map((i) => i.id).join(',') === keptEconomy,
    'error="' + catCfg('economy').error + '" items=' + (catCfg('economy').items || []).map((i) => i.id).join(','));
  polyState.html404 = null;
  polyState.html200 = null;

  check('Update is usable again once the run is over',
    btn.disabled === false && /Update headlines/.test(btn.textContent),
    'disabled=' + btn.disabled + ' label="' + btn.textContent + '"');

  /* ------------------------------------ entity=markets: the one slug fallback
     `/markets` documents `tag_slug`, so an unresolved-but-legal slug IS a safe
     filter there. That is the only branch that ever sends a slug, and it is
     pinned here so the guard above cannot quietly swallow it as well. */
  const entSel = elements.get('c_polyEntity');
  entSel.value = 'markets';
  entSel.dispatch('change');
  const beforeEnt = polyCalls.length;
  await runUpdate(btn);
  const unmUrl = polyCalls.slice(beforeEnt).find((u) => u.indexOf('category=unmatched') !== -1) || '';
  check('with entity=markets an unresolved legal slug IS sent, as tag_slug',
    /entity=markets/.test(unmUrl) && /tagSlug=nonexistent-tag/.test(unmUrl), unmUrl || 'never called');
  entSel.value = 'events';
  entSel.dispatch('change');
  await runUpdate(btn);

  /* ---------------------------------------------------------- Reset button
     Reset replaces the whole config object, so the category blocks must be
     rebuilt from the new one — a leftover block still holds the old category
     objects and would keep autosaving edits into a config that is gone. */
  elements.get('btnReset').dispatch('click');
  const shippedCats = (global.PM_DEFAULT_CONFIG.polymarket.categories || []).map((c) => c.label).join(',');
  check('Reset rebuilds the category blocks from the shipped config',
    blocks().length === shippedCats.split(',').length &&
    blocks().map((b) => b.querySelector('.polycat__name').textContent).join(',') === shippedCats,
    blocks().map((b) => b.querySelector('.polycat__name').textContent).join(',') + ' (shipped ' + shippedCats + ')');
  check('Reset puts the shipped headline source back',
    getCfg().source === 'manual' && (getCfg().markets.items || []).length > 1,
    'source=' + getCfg().source + ' markets=' + (getCfg().markets.items || []).length);

  report();
})();

function runUpdate(btn) {
  btn.dispatch('click');
  return waitFor(() => !btn.disabled, 2000);
}

function waitFor(fn, ms) {
  return new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      if (fn()) return res(true);
      if (Date.now() - t0 > (ms || 1500)) return res(false);
      setTimeout(tick, 5);
    };
    tick();
  });
}

function report() {
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  predictions admin — runtime check\n  ' + '-'.repeat(56));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(56));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}
