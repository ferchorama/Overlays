#!/usr/bin/env node
/* ============================================================================
   Admin page — runtime check
   ----------------------------------------------------------------------------
   Loads the REAL admin.html, builds a DOM shim from the ids/inputs it actually
   contains, then executes config.js + admin.js against it. This is the check a
   syntax pass cannot give you: a missing element or a stale config key throws
   at boot and leaves the control panel dead.

     node tests/admin.js

   The shim parses innerHTML into real child nodes (like a browser) so the
   dynamically built rows — cities, gradient stops — are exercised for real.
   It then drives the page: edits fields, clicks buttons, and asserts the
   config, localStorage, postMessage and HTTP calls all happen. It also boots
   against a live config.json and asserts the panel adopts it without writing —
   the regression where an empty profile overwrote the operator's real config.
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
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    attrs: attrs || {},
    id: (attrs && attrs.id) || '',
    className: (attrs && attrs.class) || '',
    type: (attrs && attrs.type) || '',
    value: (attrs && attrs.value) || '',
    checked: false,
    textContent: '',
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
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector(sel) { return descendants(this).find((n) => matches(n, sel)) || null; },
    querySelectorAll(sel) { return descendants(this).filter((n) => matches(n, sel)); },
    /* key events need their key through to the handler, so carry the object */
    dispatch(type, ev) {
      (this._handlers[type] || []).forEach((fn) => fn.call(this,
        Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, ev || {})));
    },
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this.children = parseFragment(String(v)); }
  };
  return node;
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
/* What GET api/config answers. Set before admin.js boots: config.json is the
   copy that is actually on air, so the panel must adopt it. */
let serverConfig = null;

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
global.location = { search: '', hash: '', protocol: 'http:', origin: 'http://localhost:8790', pathname: '/weather/admin.html' };
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
/* What the geocoder really answers for a shared name: several places called the
   same thing, told apart only by admin1/country. Mirrors the live shape. */
const GEO_FIXTURE = {
  springfield: [
    { id: 1, name: 'Springfield', admin1: 'Missouri', country: 'United States', country_code: 'US', latitude: 37.21533, longitude: -93.29824, population: 170188 },
    { id: 2, name: 'Springfield', admin1: 'Illinois', country: 'United States', country_code: 'US', latitude: 39.80172, longitude: -89.64371, population: 114394 },
    { id: 3, name: 'Springfield', admin1: 'Massachusetts', country: 'United States', country_code: 'US', latitude: 42.10148, longitude: -72.58981, population: 154341 }
  ],
  portland: [
    { id: 4, name: 'Portland', admin1: 'Oregon', country: 'United States', country_code: 'US', latitude: 45.52345, longitude: -122.67621, population: 652503 },
    { id: 5, name: 'Portland', admin1: 'Maine', country: 'United States', country_code: 'US', latitude: 43.65737, longitude: -70.2589, population: 66881 }
  ]
};

global.fetch = (url, opts) => {
  const method = (opts && opts.method) || 'GET';
  fetches.push({ url: String(url), method, at: Date.now(), body: opts && opts.body });
  if (method === 'GET' && String(url).indexOf('api/config') !== -1) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(serverConfig) });
  }
  if (String(url).indexOf('geocoding-api') !== -1) {
    const m = /[?&]name=([^&]*)/.exec(String(url));
    const q = (m ? decodeURIComponent(m[1]) : '').trim().toLowerCase();
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: GEO_FIXTURE[q] || [] }) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
};

/* ------------------------------------------------------------------ boot */
const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

let bootError = null;
try {
  require(path.join(ROOT, 'config.js'));
  require(path.join(ROOT, 'config-merge.js'));
  /* the city picker is the shared combobox now, and admin.js assumes it */
  require(path.join(ROOT, '..', 'shared', 'combobox.js'));

  /* A saved config written by the build that injected the "New City" label, so
     the boot-time repair is genuinely exercised rather than assumed. Same
     meta.version, so this is the operator's own config and not a migration
     fixture: city 2 has the placeholder title but a real search name. */
  const seeded = JSON.parse(JSON.stringify(global.WX_DEFAULT_CONFIG));
  seeded.cities = [
    { label: 'New York', query: 'New York', countryCode: 'US', lat: null, lon: null, enabled: true },
    { label: 'New City', query: 'Miami', countryCode: '', lat: null, lon: null, enabled: true }
  ];
  store['wx-config-v1'] = JSON.stringify(seeded);

  /* The live config.json. The regression: a browser profile whose local copy is
     empty or stale used to overwrite this with the shipped samples on open. The
     distinctive label/title below must be what the rendered panel shows. */
  serverConfig = JSON.parse(JSON.stringify(global.WX_DEFAULT_CONFIG));
  serverConfig.header.text = 'LIVE FROM CONFIG.JSON';
  serverConfig.cities = [
    { label: 'New York', query: 'New York', countryCode: 'US', lat: null, lon: null, enabled: true },
    { label: 'Distinctive Server City', query: 'Miami', countryCode: '', lat: null, lon: null, enabled: true }
  ];

  require(path.join(ROOT, 'admin.js'));
} catch (e) { bootError = e; }

check('admin.js boots without throwing', !bootError, bootError ? bootError.message : 'clean');
if (bootError) {
  console.log('\n  admin page — runtime check\n  ' + '-'.repeat(52));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '   [' + r.info + ']'));
  console.log('\n  ' + String(bootError.stack).split('\n').slice(0, 5).join('\n  ') + '\n');
  process.exit(1);
}

/* ---------------------------------------------- stale saved config --- */
/* Settings must be persistent: a build update may add new options, but it must
   never reset the look the operator saved. */
{
  const shipped = global.WX_DEFAULT_CONFIG;
  const stale = JSON.parse(JSON.stringify(shipped));
  stale.meta = Object.assign({}, shipped.meta, { version: '0.0.1' });
  stale.panel = Object.assign({}, shipped.panel, { background: 'rgba(14,20,32,0.40)', accentColor: '#000000' });
  stale.card = JSON.parse(JSON.stringify(shipped.card));
  stale.card.body.temp.color = '#ffffff';
  delete stale.card.cityBand.showCountry;          /* a key the saved copy predates */
  stale.cities = [{ label: 'Tampa', query: 'Tampa', lat: null, lon: null, enabled: true }];
  stale.units = Object.assign({}, shipped.units, { system: 'metric' });

  const merged = global.WX_MIGRATE.apply(shipped, stale);
  check('a saved palette survives the version bump (settings are persistent)',
    merged.panel.background === 'rgba(14,20,32,0.40)', merged.panel.background);
  check('a saved ink survives the version bump', merged.card.body.temp.color === '#ffffff',
    merged.card.body.temp.color);
  check('a key the saved copy never had comes from the build',
    merged.card.cityBand.showCountry === shipped.card.cityBand.showCountry,
    'showCountry=' + merged.card.cityBand.showCountry);
  check('stored cities survive the migration', merged.cities.length === 1 && merged.cities[0].label === 'Tampa',
    merged.cities.map((c) => c.label).join(','));
  check('stored units survive the migration', merged.units.system === 'metric', merged.units.system);
  check('same-version edits are still respected',
    global.WX_MIGRATE.apply(shipped, Object.assign(JSON.parse(JSON.stringify(shipped)), { panel: Object.assign({}, shipped.panel, { accentColor: '#ff2d55' }) })).panel.accentColor === '#ff2d55',
    'edit kept');
}

/* ------------------------------------------------------------- structure */
const boundIds = [...ADMIN_JS.matchAll(/bind\('[^']+',\s*'([^']+)'/g)].map((x) => x[1]);
const missingIds = boundIds.filter((id) => !elements.has(id));
check('every bound field exists in admin.html', missingIds.length === 0,
  missingIds.join(', ') || boundIds.length + ' fields');

const controls = [...elements.values()].filter((n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName));
check('form controls present', controls.length > 60, controls.length + ' controls');
check('no dead preset selector left', !/class="preset"/.test(HTML), 'presets removed');

/* Every number input must be able to REPRESENT its own configured default.
   The icon size shipped as 250px while its input capped at 220 — so opening the
   panel silently clamped the design. This catches that whole class of drift. */
{
  const shipped = global.WX_DEFAULT_CONFIG;
  const binds = [...ADMIN_JS.matchAll(/bind\('([^']+)',\s*'([^']+)'/g)].map((m) => ({ path: m[1], id: m[2] }));
  const at = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const offenders = [];
  let numeric = 0;
  binds.forEach(({ path: cfgPath, id }) => {
    const node = elements.get(id);
    if (!node || node.getAttribute('type') !== 'number') return;
    numeric++;
    const value = at(shipped, cfgPath);
    if (typeof value !== 'number') return;
    const min = Number(node.getAttribute('min'));
    const max = Number(node.getAttribute('max'));
    if (isFinite(min) && value < min) offenders.push(id + ' default ' + value + ' < min ' + min);
    if (isFinite(max) && value > max) offenders.push(id + ' default ' + value + ' > max ' + max);
  });
  check('every numeric input can hold its own default', offenders.length === 0,
    offenders.join('; ') || numeric + ' numeric inputs in range');
}

/* the two smallest labels in the widget were not adjustable at all */
check('local-time size is adjustable', !!elements.get('c_cityTimeSize') &&
  boundIds.includes('c_cityTimeSize'), 'c_cityTimeSize');
check('high/low size is adjustable', !!elements.get('c_rangeSize') &&
  boundIds.includes('c_rangeSize'), 'c_rangeSize');
/* Guarded on purpose: an unguarded dereference here would throw before any
   PASS/FAIL line was printed, hiding the very regression it looks for. */
{
  const timeNode = elements.get('c_cityTimeSize');
  const rangeNode = elements.get('c_rangeSize');
  check('new size inputs show the shipped defaults',
    !!timeNode && !!rangeNode &&
    String(timeNode.value) === String(global.WX_DEFAULT_CONFIG.card.cityBand.timeSize) &&
    String(rangeNode.value) === String(global.WX_DEFAULT_CONFIG.card.body.range.size),
    'time=' + (timeNode && timeNode.value) + ' range=' + (rangeNode && rangeNode.value));
}

/* Every colour the icon set reads must have a picker: cloudDark and fog were
   missing, so two of the eight could only be changed by editing raw JSON. */
{
  const iconIds = ['c_icSun', 'c_icMoon', 'c_icCloud', 'c_icCloudDark',
    'c_icRain', 'c_icSnow', 'c_icBolt', 'c_icFog'];
  const unbound = iconIds.filter((id) => !elements.has(id) || !boundIds.includes(id));
  check('every icon colour has a bound picker', unbound.length === 0,
    unbound.join(', ') || iconIds.length + ' pickers');
}

const statusNode = elements.get('status');
check('status line shows the build version', /v\d+\.\d+\.\d+/.test(statusNode.textContent), statusNode.textContent);

/* dynamic rows built from innerHTML — what a browser-only check would miss */
const cityRows = elements.get('cityList').children;
check('city rows built', cityRows.length === 2, cityRows.length + ' rows');
const firstCity = cityRows[0];
const cityFields = firstCity ? ['.label', '.query', '.lat', '.lon'].map((s) => firstCity.querySelector(s)) : [];
check('city row fields wired', cityFields.every(Boolean), cityFields.filter(Boolean).length + '/4');
check('city label prefilled', !!(cityFields[0] && cityFields[0].value === 'New York'), cityFields[0] && cityFields[0].value);

/* The reported bug: a city added by an older build carried the literal title
   "New City", which nothing ever replaced — so the card kept the placeholder no
   matter what was typed into Search name. The boot repair takes the search name,
   the only name the operator actually typed. */
const healedRow = cityRows[1];
check('a legacy "New City" placeholder is repaired from its search name at boot',
  !!(healedRow && healedRow.querySelector('.label').value === 'Miami'),
  healedRow ? '"' + healedRow.querySelector('.label').value + '"' : 'no second row');
check('a real city label is left alone by the repair',
  !!(cityFields[0] && cityFields[0].value === 'New York'), cityFields[0] && cityFields[0].value);

const stopRows = (elements.get('bodyStops') || { children: [] }).children;
check('gradient stop rows built', stopRows.length >= 2, stopRows.length + ' stops');
check('stop colour prefilled as hex (alpha separate)',
  stopRows.length > 0 && /^#[0-9a-f]{6}$/i.test(stopRows[0].querySelector('input[type="color"]').value),
  stopRows.length ? stopRows[0].querySelector('input[type="color"]').value : '-');
check('stop alpha control present',
  stopRows.length > 0 && stopRows[0].querySelector('input[type="number"]') !== null,
  stopRows.length ? String(stopRows[0].querySelector('input[type="number"]').value) : '-');

/* Where OBS is told to point. Served from the hub the overlay is its sibling;
   the legacy per-app port must not leak into the hint. */
{
  const obsUrl = elements.get('obsUrl').textContent;
  check('OBS hint is the hub URL when served from the hub',
    obsUrl === 'http://localhost:8790/weather/index.html', obsUrl);
}

/* ------------------------------------------- config.json is the truth ---
   Booting must READ the live config and must not write anything. The local copy
   seeded above deliberately disagrees with config.json, so what the rendered
   panel shows tells us which copy won. */
setTimeout(() => {
  const gets = fetches.filter((f) => f.method === 'GET' && f.url.includes('api/config'));
  check('boot GETs api/config', gets.length === 1, gets.length + ' config GETs');

  const rows = elements.get('cityList').children;
  const adoptedLabel = rows[1] ? rows[1].querySelector('.label').value : '';
  check('a config returned by api/config wins over the local copy',
    adoptedLabel === 'Distinctive Server City', JSON.stringify(adoptedLabel));
  check('the shipped sample labels are not rendered after adopting config.json',
    rows.every((row) => row.querySelector('.label').value !== 'New City'),
    rows.map((row) => row.querySelector('.label').value).join(','));

  check('bound inputs are refreshed from the adopted config',
    elements.get('c_headerText').value === 'LIVE FROM CONFIG.JSON',
    elements.get('c_headerText').value);

  let raw = null;
  try { raw = JSON.parse(elements.get('rawJson').value); } catch (e) { /* reported below */ }
  check('raw JSON textarea matches the adopted config',
    !!raw && raw.cities[1].label === 'Distinctive Server City' && raw.header.text === 'LIVE FROM CONFIG.JSON',
    raw ? raw.cities[1].label + ' / ' + raw.header.text : 'unparseable');

  check('status line reports the adopted config.json',
    /config\.json/.test(statusNode.textContent), statusNode.textContent);
}, 250);

/* ------------------------------------------------------------ interaction */
function runInteractions() {
  /* one input event must produce exactly one config message, not two: a second
     syncUI() would double-bind every listener */
  const msgBefore = messages.length;
  elements.get('c_headerText').value = 'TODAY FROM THE DESK';
  elements.get('c_headerText').dispatch('input');
  const newMessages = messages.slice(msgBefore).filter((m) => m.type === 'wx:config');
  check('one edit fires one listener (bindings were not set up twice)',
    newMessages.length === 1, newMessages.length + ' config messages');
  const s1 = JSON.parse(store['wx-config-v1'] || '{}');
  check('editing a field updates the config', !!(s1.header && s1.header.text === 'TODAY FROM THE DESK'),
    s1.header && s1.header.text);
  check('edit is pushed to the preview iframe',
    messages.some((m) => m.type === 'wx:config' && m.config.header.text === 'TODAY FROM THE DESK'),
    messages.length + ' messages');

  elements.get('c_tempSize').value = '190';
  elements.get('c_tempSize').dispatch('input');
  check('number fields coerce to numbers',
    JSON.parse(store['wx-config-v1']).card.body.temp.size === 190,
    String(JSON.parse(store['wx-config-v1']).card.body.temp.size));

  elements.get('c_glassBlur').value = '48';
  elements.get('c_glassBlur').dispatch('input');
  check('glass blur writes to panel.glass.blur',
    JSON.parse(store['wx-config-v1']).panel.glass.blur === 48,
    String(JSON.parse(store['wx-config-v1']).panel.glass.blur));

  elements.get('c_accent').value = '#ff2d55';
  elements.get('c_accent').dispatch('input');
  check('accent colour writes through', JSON.parse(store['wx-config-v1']).panel.accentColor === '#ff2d55',
    JSON.parse(store['wx-config-v1']).panel.accentColor);

  const before = fetches.length;
  elements.get('btnRefresh').dispatch('click');
  check('Refresh data hits the command API',
    fetches.slice(before).some((f) => f.url.includes('api/command') && f.url.includes('refresh')),
    fetches.slice(before).map((f) => f.url).join(', ') || 'none');

  /* typing into a greyed-out city re-enables it (behaviour added earlier).
     Re-query: adopting config.json rebuilt these rows. */
  const secondRow = elements.get('cityList').children[1];
  if (secondRow) {
    secondRow.querySelector('.on').dispatch('click');
    const labelInput = secondRow.querySelector('.label');
    labelInput.value = 'Tampa';
    labelInput.dispatch('input');
    const cities = JSON.parse(store['wx-config-v1']).cities;
    check('typing re-enables a disabled city', cities[1].enabled === true && cities[1].label === 'Tampa',
      JSON.stringify(cities[1]).slice(0, 64));
  }

  /* ---------------------------------- adding a city must not invent a title
     The reported path exactly: press "Add city", type the place into Search name,
     and the card title has to follow it. */
  {
    const list = elements.get('cityList');
    const cfgCities = () => JSON.parse(store['wx-config-v1']).cities;

    /* make room — the shipped config caps the list at two cities */
    list.children[1].querySelector('.del').dispatch('click');
    const afterDelete = cfgCities().length;
    elements.get('btnAddCity').dispatch('click');
    const fresh = list.children[list.children.length - 1];

    check('adding a city does not invent a title',
      cfgCities().length === afterDelete + 1 && cfgCities()[1].label === '',
      afterDelete + ' -> ' + cfgCities().length + ' cities, label=' + JSON.stringify(cfgCities()[1].label));
    check('the new row leaves the title input empty (the placeholder is a hint, not data)',
      fresh.querySelector('.label').value === '', JSON.stringify(fresh.querySelector('.label').value));

    /* type one character at a time, the way a browser delivers it */
    const q = fresh.querySelector('.query');
    ['T', 'Ta', 'Tam', 'Tamp', 'Tampa'].forEach((v) => { q.value = v; q.dispatch('input'); });
    check('typing a search name does NOT rename the card',
      cfgCities()[1].label === '',
      'label=' + JSON.stringify(cfgCities()[1].label) + ' query=' + JSON.stringify(cfgCities()[1].query));
    check('the title input stays empty while typing',
      fresh.querySelector('.label').value === '', JSON.stringify(fresh.querySelector('.label').value));
    check('the typed text is kept as the lookup query',
      cfgCities()[1].query === 'Tampa', JSON.stringify(cfgCities()[1].query));

    /* a title the operator wrote stays put while the lookup changes */
    const lbl = fresh.querySelector('.label');
    lbl.value = 'Downtown';
    lbl.dispatch('input');
    q.value = 'Tampa Bay';
    q.dispatch('input');
    check('a hand-written title survives a later change of search name',
      cfgCities()[1].label === 'Downtown' && cfgCities()[1].query === 'Tampa Bay',
      'label=' + JSON.stringify(cfgCities()[1].label) + ' query=' + JSON.stringify(cfgCities()[1].query));

    /* clearing the title leaves it blank — only choosing a city sets it again */
    lbl.value = '';
    lbl.dispatch('input');
    q.value = 'Orlando';
    q.dispatch('input');
    check('clearing the title leaves it empty until a city is chosen',
      cfgCities()[1].label === '', JSON.stringify(cfgCities()[1].label));
  }
}

/* ------------------------------------------------------- city lookup
   Typing a name shared by several states must offer the matches and pin the
   chosen one's exact coordinates. Driven through the real row DOM: type, wait
   out the debounce, then click/keyboard-pick. */
async function geoChecks() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const list = elements.get('cityList');
  const row = list.children[list.children.length - 1];
  if (!row) { check('city lookup row exists', false, 'no row'); return; }
  const q = row.querySelector('.query');
  const dd = row.querySelector('.geo-list');
  const latIn = row.querySelector('.lat');
  const lonIn = row.querySelector('.lon');
  const cfgCities = () => JSON.parse(store['wx-config-v1']).cities;
  const idx = cfgCities().length - 1;
  const geoCalls = () => fetches.filter((f) => f.url.includes('geocoding-api'));
  const baseCalls = geoCalls().length;   /* earlier typing in this suite also geocodes */
  const options = () => row.querySelectorAll('.geo-item').filter((n) => String(n.className).indexOf('geo-item--none') === -1);

  check('the search field is a combobox wired to a listbox',
    q.getAttribute('role') === 'combobox' && q.getAttribute('aria-controls') === dd.id,
    'role=' + q.getAttribute('role') + ' controls=' + q.getAttribute('aria-controls'));

  /* one character is not worth a request */
  q.value = 'S';
  q.dispatch('input');
  await sleep(400);
  check('a single character does not query the geocoder', geoCalls().length === baseCalls,
    (geoCalls().length - baseCalls) + ' new calls');

  /* a shared name → every match, each labelled with its state */
  q.value = 'Springfield';
  q.dispatch('input');
  await sleep(450);
  const opts = options();
  const where = opts.map((n) => (n.querySelector('.geo-item__where') || {}).textContent || '');
  check('typing queries the geocoder', geoCalls().length > baseCalls,
    (geoCalls().length - baseCalls) + ' new calls');
  check('the request asks for several matches, not one',
    geoCalls().some((f) => /[?&]count=10(&|$)/.test(f.url)),
    (geoCalls().find((f) => f.url.includes('Springfield')) || {}).url || 'none');
  check('the dropdown opens with every match', dd.hidden === false && opts.length === 3,
    opts.length + ' options, hidden=' + dd.hidden);
  check('each match shows the state that tells them apart',
    /Missouri/.test(where.join('|')) && /Illinois/.test(where.join('|')) && /Massachusetts/.test(where.join('|')),
    where.join(' | '));
  check('the field reports the list as expanded',
    q.getAttribute('aria-expanded') === 'true', q.getAttribute('aria-expanded'));

  /* choosing pins the exact coordinates — the thing that actually disambiguates */
  opts[1].dispatch('click');
  check('choosing a match pins its latitude/longitude',
    cfgCities()[idx].lat === 39.80172 && cfgCities()[idx].lon === -89.64371,
    'lat=' + cfgCities()[idx].lat + ' lon=' + cfgCities()[idx].lon);
  check('the coordinate fields show the pinned place',
    Number(latIn.value) === 39.80172 && Number(lonIn.value) === -89.64371,
    'lat=' + latIn.value + ' lon=' + lonIn.value);
  check('choosing closes the dropdown',
    dd.hidden === true && q.getAttribute('aria-expanded') === 'false',
    'hidden=' + dd.hidden + ' expanded=' + q.getAttribute('aria-expanded'));
  check('choosing a match renames the card to the place picked',
    cfgCities()[idx].label === 'Springfield', JSON.stringify(cfgCities()[idx].label));

  /* keyboard: ArrowDown then Enter picks the highlighted match */
  q.value = 'Portland';
  q.dispatch('input');
  await sleep(450);
  check('typing after a selection does not rename the card again',
    cfgCities()[idx].label === 'Springfield', JSON.stringify(cfgCities()[idx].label));
  q.dispatch('keydown', { key: 'ArrowDown' });
  q.dispatch('keydown', { key: 'Enter' });
  check('ArrowDown + Enter selects the highlighted match',
    cfgCities()[idx].lat === 45.52345 && cfgCities()[idx].lon === -122.67621,
    'lat=' + cfgCities()[idx].lat + ' lon=' + cfgCities()[idx].lon);
  check('the second selection renames the card again',
    cfgCities()[idx].label === 'Portland', JSON.stringify(cfgCities()[idx].label));

  /* editing the name again must release the pin, or the name could never win */
  q.value = 'Portland, Maine';
  q.dispatch('input');
  check('editing the name releases a pinned coordinate',
    cfgCities()[idx].lat === null && cfgCities()[idx].lon === null && latIn.value === '',
    'lat=' + cfgCities()[idx].lat + ' input=' + JSON.stringify(latIn.value));

  /* a query with nothing behind it must say so, not silently do nothing */
  q.value = 'zzzzzz';
  q.dispatch('input');
  await sleep(450);
  const none = row.querySelector('.geo-item--none');
  check('a search with no matches says so',
    dd.hidden === false && !!none && /no matching places/.test(none.textContent),
    none ? none.textContent : 'no row');

  /* Escape closes */
  q.value = 'Springfield';
  q.dispatch('input');
  await sleep(450);
  q.dispatch('keydown', { key: 'Escape' });
  check('Escape closes the dropdown', dd.hidden === true, 'hidden=' + dd.hidden);
}

/* Start editing only after the old 400 ms boot-save window has passed, so "no
   POST before any edit" also catches a stray boot save. */
let firstEditAt = 0;
setTimeout(() => {
  const posts = fetches.filter((f) => f.method === 'POST');
  check('boot does NOT POST api/config (no POST before the first edit)',
    posts.length === 0, posts.length + ' POSTs before any edit');
  firstEditAt = Date.now();
  runInteractions();
}, 700);

setTimeout(async () => {
  await geoChecks();
  const configPosts = fetches.filter((f) => f.url.includes('api/config') && f.method === 'POST');
  check('Save persists config.json (debounced POST)', configPosts.length > 0,
    configPosts.length + ' config posts');
  check('the first POST happens after the first edit',
    configPosts.length > 0 && configPosts[0].at >= firstEditAt,
    configPosts.length ? (configPosts[0].at - firstEditAt) + 'ms after the edit' : 'no posts');
  /* a boot save would POST the untouched config; only edited bodies may appear */
  check('no POST carries the pre-edit (boot) config',
    configPosts.length > 0 && configPosts.every((p) => {
      try { return JSON.parse(p.body).header.text === 'TODAY FROM THE DESK'; }
      catch (e) { return false; }
    }),
    configPosts.map((p) => {
      try { return JSON.parse(p.body).header.text; } catch (e) { return 'unparseable'; }
    }).join(' | ') || 'no posts');
  check('tabs and panels line up', tabNodes.length === panelNodes.length,
    tabNodes.length + ' tabs / ' + panelNodes.length + ' panels');

  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  admin page — runtime check\n  ' + '-'.repeat(56));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(56));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}, 1800);
