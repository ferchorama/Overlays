#!/usr/bin/env node
/* ============================================================================
   Admin page — runtime check
   ----------------------------------------------------------------------------
   Loads the REAL admin.html, builds a DOM shim from the ids/inputs it actually
   contains, then executes config.js + config-merge.js + admin.js against it.
   This is the check a syntax pass cannot give you: a missing element or a stale
   config key throws at boot and leaves the control panel dead.

     node tests/admin.js

   Weather and topics have carried a test like this for a while; the market board
   is the largest of the three panels and had none, so every binding it grew was
   unverified. The shim parses innerHTML into real child nodes (like a browser)
   so the dynamically built rows — categories, columns, labels — are exercised
   for real, then drives the page: edits fields, clicks buttons, and asserts the
   config, localStorage, postMessage and HTTP calls all happen.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');

/* ------------------------------------------------------------ DOM shim --- */
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

/* enough HTML parsing for the templates admin.js injects */
function parseFragment(html) {
  const roots = [];
  const stack = [];
  const re = /<(\/)?([a-z0-9]+)((?:\s+[^>]*?)?)(\/)?>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { if (stack.length) stack.pop(); continue; }
    const tag = m[2];
    const attrsRaw = m[3] || '';
    const selfClose = !!m[4] || /^(input|br|img|hr|meta|link)$/i.test(tag);
    const attrs = {};
    attrsRaw.replace(/([a-z-]+)="([^"]*)"/gi, (_, k, v) => { attrs[k.toLowerCase()] = v; return ''; });
    const node = mkNode(tag, attrs);
    if (stack.length) stack[stack.length - 1].appendChild(node); else roots.push(node);
    if (!selfClose) stack.push(node);
  }
  return roots;
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
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this.children = parseFragment(String(v)); }
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
const fetches = [];
const messages = [];
const store = {};

const documentShim = {
  readyState: 'complete',
  head: mkNode('head'),
  body: mkNode('body'),
  documentElement: mkNode('html'),
  createElement: (t) => mkNode(t),
  getElementById: (id) => elements.get(id) || null,
  addEventListener() {},
  querySelector() { return null; },
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
/* the panel is only ever served by the shared hub, at /market/admin.html */
global.location = { search: '', hash: '', protocol: 'http:', origin: 'http://localhost:8790', pathname: '/market/admin.html' };
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.confirm = () => true;
global.alert = () => {};
global.addEventListener = () => {};
global.Blob = function () {};
global.URL.createObjectURL = () => 'blob:x';
global.URL.revokeObjectURL = () => {};
global.fetch = (url, opts) => {
  fetches.push({ url: String(url), method: (opts && opts.method) || 'GET' });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
};

/* ------------------------------------------------------------------ boot */
const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

let bootError = null;
try {
  require(path.join(ROOT, 'config.js'));
  require(path.join(ROOT, 'config-merge.js'));
  /* the asset picker IS the shared combobox (same component as the weather
     city picker), and admin.js assumes it loaded first */
  require(path.join(ROOT, '..', 'shared', 'combobox.js'));
  require(path.join(ROOT, 'admin.js'));
} catch (e) { bootError = e; }

check('admin.js boots without throwing', !bootError, bootError ? bootError.message : 'clean');
if (bootError) {
  console.log('\n  market admin — runtime check\n  ' + '-'.repeat(52));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '   [' + r.info + ']'));
  console.log('\n  ' + String(bootError.stack).split('\n').slice(0, 5).join('\n  ') + '\n');
  process.exit(1);
}

/* ---------------------------------------------- stale saved config --- */
/* Settings must be persistent: a build update may add new options, but it must
   never reset the look the operator saved. The one exception is the provider
   endpoints, which stay build-owned. */
{
  const M = global.CM_MIGRATE;
  check('version-aware migration is loaded', !!M && typeof M.apply === 'function',
    M ? 'CM_MIGRATE' : 'missing');

  if (M) {
    const shipped = global.CM_DEFAULT_CONFIG;
    const stale = JSON.parse(JSON.stringify(shipped));
    stale.meta = Object.assign({}, shipped.meta, { version: '0.0.1' });
    stale.panel = Object.assign({}, shipped.panel, { background: 'rgba(0,0,0,0.9)' });
    stale.rows = JSON.parse(JSON.stringify(shipped.rows));
    stale.rows.price.color = '#ff00ff';
    delete stale.columns.assetMaxWidth;              /* a key the saved copy predates */
    stale.categories = [{ id: 'mine', label: 'MINE', coins: ['bitcoin', 'ethereum'] }];
    stale.maxRows = 4;
    stale.data = Object.assign({}, shipped.data, { currency: 'eur', proxyUrl: 'https://evil.example/' });
    stale.font = { id: 'plex' };

    const merged = M.apply(shipped, stale);
    check('a saved palette survives the version bump (settings are persistent)',
      merged.panel.background === 'rgba(0,0,0,0.9)', merged.panel.background);
    check('a saved ink survives the version bump', merged.rows.price.color === '#ff00ff',
      merged.rows.price.color);
    check('a key the saved copy never had comes from the build',
      merged.columns.assetMaxWidth === shipped.columns.assetMaxWidth,
      'assetMaxWidth=' + merged.columns.assetMaxWidth);
    check('saved categories survive the migration',
      merged.categories.length === 1 && merged.categories[0].label === 'MINE',
      merged.categories.map((c) => c.label).join(','));
    check('saved content data survives the migration',
      merged.data.currency === 'eur',
      merged.data.currency);
    /* the endpoint must always come from the build: a stale proxy path would
       silently break the board with no visible cause */
    check('a stale proxy URL is discarded', merged.data.proxyUrl === shipped.data.proxyUrl,
      merged.data.proxyUrl);
    check('a saved typeface survives the migration', merged.font && merged.font.id === 'plex',
      merged.font && merged.font.id);
    check('same-version edits are still respected',
      M.apply(shipped, Object.assign(JSON.parse(JSON.stringify(shipped)),
        { panel: Object.assign({}, shipped.panel, { radius: 41 }) })).panel.radius === 41,
      'edit kept');
  }
}

/* ------------------------------------------------------------- structure */
const boundIds = [...ADMIN_JS.matchAll(/(?:bind|bindAlpha)\('([^']+)',\s*'([^']+)'/g)].map((m) => m[2]);
const missingIds = boundIds.filter((id) => !elements.has(id));
/* Same bug class as topics: opening the panel used to push() — which POSTs the
   browser's copy — over the config.json that is actually on air. Reading must
   never write. */
check('opening the panel reads config.json instead of saving it',
  fetches.some((f) => f.url.includes('api/config') && f.method === 'GET') &&
  !fetches.some((f) => f.method === 'POST'),
  fetches.map((f) => f.method + ' ' + f.url).join(', ') || 'no requests');
check('every bound field exists in admin.html', missingIds.length === 0,
  missingIds.join(', ') || boundIds.length + ' fields');

const controls = [...elements.values()].filter((n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName));
check('form controls present', controls.length > 100, controls.length + ' controls');

/* Controls for the tick flash, value tween and trend-colour features were
   removed with the config keys behind them: nothing in the engine ever read
   them, so every one of these was a switch that did nothing. */
check('no controls remain for features that do not exist',
  !/c_tickFlash|c_tweenValues|c_tweenDuration|c_tweenEase|c_flashOnTick|c_colSparkUp|c_colSparkDown|c_titleAutoShrink/.test(HTML),
  'dead controls absent');

/* every colour the admin edits as rgba has its own alpha field, or the native
   colour input would silently flatten the glass on the first edit */
{
  const pairs = ['c_panelBgA', 'c_titleColorA', 'c_tabsBgA', 'c_divColorA', 'c_assetNameCA'];
  const missing = pairs.filter((id) => !elements.has(id));
  check('rgba colours have separate alpha fields', missing.length === 0,
    missing.join(', ') || pairs.length + ' alpha pairs');
}

const statusNode = elements.get('status');
check('status line shows the build version', /v\d+\.\d+\.\d+/.test(statusNode.textContent), statusNode.textContent);
check('the brand shows the loaded config version',
  /^\d+\.\d+\.\d+$/.test(elements.get('appVersion').textContent), elements.get('appVersion').textContent);
check('a migration notice container exists', !!elements.get('versionMsg'), '#versionMsg');

/* ------------------------------------------------------------- typeface */
{
  const picker = elements.get('fontPicker');
  const faces = picker ? picker.children.length : 0;
  check('the typeface picker lists the bundled faces', faces >= 60, faces + ' faces');
  const inter = picker && picker.children.find((n) => n.getAttribute('data-font') === 'inter');
  if (inter) inter.dispatch('click');
  let saved = null;
  try { saved = JSON.parse(store['cm-config-v1'] || 'null'); } catch (e) { saved = null; }
  check('picking a face stores it and rewrites every role',
    !!(saved && saved.font && saved.font.id === 'inter' &&
      String(saved.header.fontFamily).indexOf("'Inter'") === 0 &&
      saved.rows.price.fontFamily === saved.header.fontFamily),
    saved && saved.header && saved.header.fontFamily);
  check('a picked face does not point at a font CDN',
    !(saved && /fonts\.googleapis|fonts\.gstatic/.test(JSON.stringify(saved))),
    'local stack');
}

/* ------------------------------------------------------------- categories */
const catRows = elements.get('categoryList').children;
const shippedCats = global.CM_DEFAULT_CONFIG.categories.length;
check('category rows built', catRows.length === shippedCats, catRows.length + ' rows / ' + shippedCats + ' shipped');
check('a label editor per category',
  elements.get('categoryLabels').children.length === shippedCats,
  elements.get('categoryLabels').children.length + ' label fields');

/* ---------------------------------------------------------------- assets
   The editor lists one row per asset and stores provider ids. These drive the
   real buttons, so a regression in the row wiring (a move that reorders the
   wrong array, a delete that leaves a hole) fails here rather than on air. */
{
  const shippedCat = global.CM_DEFAULT_CONFIG.categories[0];
  const firstCat = () => elements.get('categoryList').children[0];
  const assetRows = () => firstCat().querySelectorAll('.asset');
  const idsNow = () => Array.from(assetRows()).map((r) => r.dataset.id);
  const savedCats = () => JSON.parse(store['cm-config-v1'] || '{}').categories || [];

  check('category assets are listed as rows', assetRows().length === shippedCat.coins.length,
    assetRows().length + ' rows / ' + shippedCat.coins.length + ' shipped');  /* The replace control is a word, not a glyph: it needs `.ic--wide` or the
     shared square width clips it to "Cha" in the operator's dashboard. */
  check('the replace button carries the wide-button class',
    String((assetRows()[0].querySelector('.change') || {}).className || '').indexOf('ic--wide') !== -1,
    String((assetRows()[0].querySelector('.change') || {}).className || 'missing'));

  check('rows carry provider ids, never tickers',
    idsNow().join(',') === shippedCat.coins.join(','), idsNow().join(','));
  check('each row shows its id in the row',
    assetRows()[0].querySelector('.asset__id').textContent === shippedCat.coins[0],
    assetRows()[0].querySelector('.asset__id').textContent);

  /* move down / move up */
  assetRows()[0].querySelector('.down').dispatch('click');
  const moved = savedCats()[0].coins;
  check('move down swaps two assets in place',
    moved[0] === shippedCat.coins[1] && moved[1] === shippedCat.coins[0],
    moved.slice(0, 3).join(','));
  elements.get('categoryList').children[0].querySelectorAll('.asset')[1].querySelector('.up').dispatch('click');
  check('move up restores the order',
    savedCats()[0].coins.join(',') === shippedCat.coins.join(','), savedCats()[0].coins.join(','));

  /* delete */
  assetRows()[0].querySelector('.del').dispatch('click');
  check('delete removes one asset',
    savedCats()[0].coins.length === shippedCat.coins.length - 1,
    savedCats()[0].coins.length + ' left');
  check('deleting does not disturb the order of the rest',
    savedCats()[0].coins.join(',') === shippedCat.coins.slice(1).join(','), savedCats()[0].coins.join(','));

  /* empty section: delete everything, then check the note and the saved shape */
  let guard = 0;
  while (assetRows().length && guard++ < 40) assetRows()[0].querySelector('.del').dispatch('click');
  check('an emptied section says so instead of showing nothing',
    firstCat().querySelector('.assets__empty').style.display === 'block',
    firstCat().querySelector('.assets__empty').style.display);
  check('an emptied section is saved as an empty list',
    savedCats()[0].coins.length === 0 && Array.isArray(savedCats()[0].coins),
    JSON.stringify(savedCats()[0].coins));

  /* restore defaults */
  elements.get('btnRestoreAssets').dispatch('click');
  check('restore brings the shipped assets back',
    savedCats()[0].coins.join(',') === shippedCat.coins.join(','), savedCats()[0].coins.join(','));
  check('restore keeps every section',
    savedCats().length === shippedCats, savedCats().length + ' sections');
}

/* asset-format rules (ids only, unique, empty allowed, schema upgrade) */
{
  const M = global.CM_MIGRATE;
  const clean = M.cleanCategories([
    { id: 'a', label: 'A', coins: ['bitcoin', 'bitcoin', '', 'BTC', 'avalanche-2'] },
    { id: 'a', label: 'A again', coins: [] }
  ]);
  check('duplicate ids are removed', clean[0].coins.join(',') === 'bitcoin,avalanche-2',
    clean[0].coins.join(','));
  check('a ticker is refused, not guessed', clean[0].coins.indexOf('BTC') === -1, clean[0].coins.join(','));
  check('duplicate category ids are made unique', clean[0].id !== clean[1].id,
    clean[0].id + ' / ' + clean[1].id);
  check('an empty section survives cleaning', clean[1].coins.length === 0, '0 assets');

  /* The dashboard's live push must dedupe WITHOUT replacing the arrays: the
     row buttons hold a reference to `cat.coins`, and a replaced array made a
     move/delete edit the detached copy. This is the guard that makes "add the
     same asset twice" impossible on every save path. */
  const live = [{ id: 'privacy', label: 'PRIVACY', coins: ['bitcoin', 'bitcoin', 'monero', 'monero'] }];
  const liveArr = live[0].coins;
  const dropped = M.cleanInPlace(live);
  check('the in-place guard removes duplicate asset ids', dropped === 2 && live[0].coins.join(',') === 'bitcoin,monero',
    dropped + ' dropped · ' + live[0].coins.join(','));
  check('the in-place guard keeps the array identity (row buttons stay live)',
    live[0].coins === liveArr, 'same array=' + (live[0].coins === liveArr));
  check('the same asset is still allowed once per section',
    M.cleanInPlace([{ id: 'x', coins: ['near'] }, { id: 'y', coins: ['near'] }]) === 0,
    'cross-section duplicates stay legal');

  const shipped = JSON.parse(JSON.stringify(global.CM_DEFAULT_CONFIG));
  const old = JSON.parse(JSON.stringify(shipped));
  delete old.meta.schema;
  old.meta.version = '1.0.0';
  old.categories = [{ id: 'privacy', label: 'PRIVACY', coins: ['bitcoin', 'bitcoin', 'ETH', 'monero'] }];
  const upgraded = M.apply(shipped, old);
  check('a schema-1 saved config is migrated on load',
    upgraded.categories[0].coins.join(',') === 'bitcoin,monero', upgraded.categories[0].coins.join(','));
  check('the upgrade stamps the current asset schema', upgraded.meta.schema === 2, upgraded.meta.schema);
}

elements.get('btnAddCategory').dispatch('click');
const cfgAfterAdd = JSON.parse(store['cm-config-v1'] || '{}');
check('adding a category appends one', (cfgAfterAdd.categories || []).length === shippedCats + 1,
  (cfgAfterAdd.categories || []).length + ' categories');
check('the new category gets a usable id and label',
  !!(cfgAfterAdd.categories || []).slice(-1)[0] &&
  /^category-\d+$/.test(cfgAfterAdd.categories.slice(-1)[0].id) &&
  !!cfgAfterAdd.categories.slice(-1)[0].label,
  JSON.stringify((cfgAfterAdd.categories || []).slice(-1)[0] || {}).slice(0, 48));

/* delete down to one, then prove the last one cannot be removed */
{
  let guard = 0;
  while (elements.get('categoryList').children.length > 1 && guard++ < 20) {
    elements.get('categoryList').children[0].querySelector('.del').dispatch('click');
  }
  const last = elements.get('categoryList').children.length;
  if (last === 1) {
    elements.get('categoryList').children[0].querySelector('.del').dispatch('click');
  }
  check('the last category cannot be removed',
    elements.get('categoryList').children.length === 1 && /at least one category/.test(statusNode.textContent),
    elements.get('categoryList').children.length + ' left · ' + statusNode.textContent);
}

/* ---------------------------------------------------------------- columns */
function columnRows() { return elements.get('columnList').children; }
{
  const col = global.CM_DEFAULT_CONFIG.columns;
  const expected = col.order.map((k) => (col.labels && col.labels[k]) || k).join(',');
  const actual = columnRows().map((r) => r.children[2].value).join(',');
  check('column rows follow columns.order, labelled', actual === expected, actual);
}

/* The asset column is a fixed width like every other column, so its width is
   editable here and must write columns.widths.asset. It used to absorb the
   leftover width, which is why this box was once disabled — that behaviour is
   what opened the dead gap between the name and the trend chart. */
{
  const order = global.CM_DEFAULT_CONFIG.columns.order;
  const assetRow = columnRows()[order.indexOf('asset')];
  const assetWidth = assetRow && assetRow.children[3];
  const shown = assetWidth ? Number(assetWidth.value) : null;
  const configured = global.CM_DEFAULT_CONFIG.columns.widths.asset;
  check('the asset column width is editable and shows the configured value',
    !!assetWidth && assetWidth.disabled === false && shown === configured,
    assetWidth ? 'disabled=' + assetWidth.disabled + ' value=' + shown + ' expected=' + configured : 'no row');

  /* and it must actually write through, not just display */
  assetWidth.value = '470';
  assetWidth.dispatch('input');
  check('editing the asset width writes columns.widths.asset',
      JSON.parse(store['cm-config-v1']).columns.widths.asset === 470,
    'written columns.widths.asset=' + JSON.parse(store['cm-config-v1']).columns.widths.asset);
}

{
  const before = columnRows().length;
  const sparkRow = columnRows()[global.CM_DEFAULT_CONFIG.columns.order.indexOf('sparkline')];
  const on = sparkRow.children[1];
  on.checked = false;
  on.dispatch('change');
  const cfgNow = JSON.parse(store['cm-config-v1']);
  check('unchecking a column drops it from the order',
    cfgNow.columns.order.indexOf('sparkline') === -1 && columnRows().length === before - 1,
    cfgNow.columns.order.join(','));
  const chips = elements.get('columnAdd').children;
  check('a dropped column becomes a chip that can re-add it',
    chips.length === 1 && /Trend/.test(chips[0].textContent), chips.length + ' chip(s)');
  if (chips.length) {
    chips[0].dispatch('click');
    const after = JSON.parse(store['cm-config-v1']).columns.order;
    check('the chip restores the column', after.indexOf('sparkline') !== -1, after.join(','));
  }
}

/* ------------------------------------------------------------ interaction */
elements.get('c_headerText').value = 'DESK TITLE';
elements.get('c_headerText').dispatch('input');
check('editing a field updates the config',
  JSON.parse(store['cm-config-v1']).header.text === 'DESK TITLE',
  JSON.parse(store['cm-config-v1']).header.text);
/* the config message is coalesced on a 120ms timer — a config edit rebuilds the
   whole board, so the panel does not post one per keystroke. Asserted in the
   deferred block below, once that timer has run. */

elements.get('c_maxRows').value = '7';
elements.get('c_maxRows').dispatch('input');
check('number fields coerce to numbers',
  JSON.parse(store['cm-config-v1']).maxRows === 7,
  typeof JSON.parse(store['cm-config-v1']).maxRows + ' ' + JSON.parse(store['cm-config-v1']).maxRows);

/* a native colour input has no alpha channel; the panel must not lose it */
{
  const shippedAlpha = Number(String(global.CM_DEFAULT_CONFIG.panel.background).split(',')[3].replace(')', ''));
  elements.get('c_panelBg').value = '#ff0000';
  elements.get('c_panelBg').dispatch('input');
  const now = JSON.parse(store['cm-config-v1']).panel.background;
  check('editing a colour keeps the alpha it had',
    /^rgba\(255,0,0,/.test(now) && Math.abs(Number(now.split(',')[3].replace(')', '')) - shippedAlpha) < 0.001,
    now);
  check('the alpha field follows the colour edit',
    Math.abs(Number(elements.get('c_panelBgA').value) - shippedAlpha) < 0.001,
    String(elements.get('c_panelBgA').value));
}

/* ------------------------------------------------- commands to the overlay */
{
  const beforeMsgs = messages.length;
  const beforeF = fetches.length;
  elements.get('btnPrev').dispatch('click');
  elements.get('btnNext').dispatch('click');
  elements.get('btnHide').dispatch('click');
  const sent = messages.slice(beforeMsgs).filter((m) => m.type === 'cm:command').map((m) => m.action);
  check('prev / next / hide reach the preview over postMessage',
    ['prev', 'next', 'hide'].every((a) => sent.indexOf(a) !== -1), sent.join(','));
  check('the same commands hit the HTTP command API',
    fetches.slice(beforeF).filter((f) => f.url.indexOf('api/command') !== -1).length >= 3,
    fetches.slice(beforeF).filter((f) => f.url.indexOf('api/command') !== -1).length + ' command fetches');
}

/* ------------------------------------------------------------------- report */
setTimeout(() => {
  check('edit is pushed to the preview iframe (coalesced)',
    messages.some((m) => m.type === 'cm:config' && m.config.header.text === 'DESK TITLE'),
    messages.filter((m) => m.type === 'cm:config').length + ' config messages');
  check('Save persists api/config (debounced POST)',
    fetches.some((f) => f.url.indexOf('api/config') !== -1 && f.method === 'POST'),
    fetches.filter((f) => f.url.indexOf('api/config') !== -1 && f.method === 'POST').length + ' config posts');
  check('tabs and panels line up', tabNodes.length === panelNodes.length,
    tabNodes.length + ' tabs / ' + panelNodes.length + ' panels');

  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  market admin — runtime check\n  ' + '-'.repeat(56));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(56));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}, 1400);
