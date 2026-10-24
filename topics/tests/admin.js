#!/usr/bin/env node
/* ============================================================================
   Talking Points admin — runtime check
   ----------------------------------------------------------------------------
   Loads the REAL admin.html, builds a DOM shim from the ids/inputs it actually
   contains, then executes config.js + admin.js against it. This is the check a
   syntax pass cannot give you: a missing element or a stale config key throws
   at boot and leaves the control panel dead.

     node tests/admin.js

   The shim parses innerHTML into real child nodes (like a browser) so the
   dynamically built rows — cities, gradient stops — are exercised for real.
   It then drives the page: edits fields, clicks buttons, and asserts the
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
    querySelector(sel) { return descendants(this).find((n) => matches(n, sel)) || null; },
    querySelectorAll(sel) { return descendants(this).filter((n) => matches(n, sel)); },
    dispatch(type) { (this._handlers[type] || []).forEach((fn) => fn.call(this, { target: this, preventDefault() {} })); },
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
global.location = { search: '', hash: '', protocol: 'http:', origin: 'http://localhost:8790', pathname: '/topics/admin.html' };
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
  require(path.join(ROOT, 'admin.js'));
} catch (e) { bootError = e; }

check('admin.js boots without throwing', !bootError, bootError ? bootError.message : 'clean');
if (bootError) {
  console.log('\n  talking points admin — runtime check\n  ' + '-'.repeat(52));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '   [' + r.info + ']'));
  console.log('\n  ' + String(bootError.stack).split('\n').slice(0, 5).join('\n  ') + '\n');
  process.exit(1);
}

/* ---------------------------------------------- stale saved config --- */
/* The bug this guards, shared with the weather widget: a config stored by an
   older build overrode the shipped palette, so the look flipped back to the old
   one on the next edit. Weather had these assertions; this panel did not. */
{
  const M = global.TP_MIGRATE;
  check('version-aware migration is loaded', !!M && typeof M.apply === 'function',
    M ? 'TP_MIGRATE' : 'missing');

  if (M) {
    const shipped = global.TP_DEFAULT_CONFIG;
    const stale = JSON.parse(JSON.stringify(shipped));
    stale.meta = Object.assign({}, shipped.meta, { version: '0.0.1' });
    stale.panel = Object.assign({}, shipped.panel, { background: 'rgba(14,20,32,0.40)' });
    stale.header = JSON.parse(JSON.stringify(shipped.header));
    stale.header.title.color = '#ffffff';
    stale.topics = JSON.parse(JSON.stringify(shipped.topics));
    stale.topics.gradient = [{ offset: 0, color: 'rgba(10,10,10,0.9)' }, { offset: 100, color: 'rgba(0,0,0,0.9)' }];
    stale.theme = 'dark';
    stale.header.title.text = 'STORED TITLE';
    stale.topics.items = [{ text: 'Stored topic one', enabled: true }];
    stale.topics.maxRows = 3;
    delete stale.topics.rowHeight;                   /* a key the saved copy predates */

    const merged = M.apply(shipped, stale);
    check('a saved palette survives the version bump (settings are persistent)',
      merged.panel.background === 'rgba(14,20,32,0.40)', merged.panel.background);
    check('a saved ink survives the version bump', merged.header.title.color === '#ffffff',
      merged.header.title.color);
    check('a saved row gradient survives the version bump',
      merged.topics.gradient[0].color === 'rgba(10,10,10,0.9)', merged.topics.gradient[0].color);
    check('a key the saved copy never had comes from the build',
      merged.topics.rowHeight === shipped.topics.rowHeight, 'rowHeight=' + merged.topics.rowHeight);
    check('stored title and topics survive the migration',
      merged.header.title.text === 'STORED TITLE' && merged.topics.items.length === 1 &&
      merged.topics.items[0].text === 'Stored topic one' && merged.topics.maxRows === 3,
      merged.header.title.text + ' / ' + merged.topics.items.length + ' topic(s)');
    /* a version bump resetting the operator's chosen theme would be a silent,
       confusing regression — `theme` is deliberately content, not look */
    check('stored theme survives the migration', merged.theme === 'dark', merged.theme);
    check('same-version edits are still respected',
      M.apply(shipped, Object.assign(JSON.parse(JSON.stringify(shipped)),
        { topics: Object.assign({}, shipped.topics, { rowHeight: 137 }) })).topics.rowHeight === 137,
      'edit kept');
  }
}

/* ------------------------------------------------------------- structure */
const boundIds = [...ADMIN_JS.matchAll(/bind\(\'[^\']+\',\s*\'([^\']+)\'/g)].map((x) => x[1]);
const missing = boundIds.filter((id) => !elements.has(id));
check('every bound field exists in admin.html', missing.length === 0, missing.join(', ') || boundIds.length + ' fields');
check('form controls present', [...elements.values()].filter((n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName)).length > 40,
  [...elements.values()].filter((n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName)).length + ' controls');
check('status line shows the build version', /v\d+\.\d+\.\d+/.test(elements.get('status').textContent), elements.get('status').textContent);
check('on-air UI is gone', !/btnNext|c_hlColor|onair/.test(HTML), 'no highlight controls');

/* The bug this guards: boot used to push() — which POSTs — so merely opening
   the panel wrote this browser's copy (often the shipped samples) over the
   operator's live config.json. Reading must never write. */
check('opening the panel reads config.json instead of saving it',
  fetches.some((f) => f.url.includes('api/config') && f.method === 'GET') &&
  !fetches.some((f) => f.method === 'POST'),
  fetches.map((f) => f.method + ' ' + f.url).join(', ') || 'no requests');

/* rows built from innerHTML */
const topicRows = elements.get('topicList').children;
const items = global.TP_DEFAULT_CONFIG.topics.items;
check('topic rows built', topicRows.length === items.length, topicRows.length + ' rows / ' + items.length + ' items');
const firstInput = topicRows[0] && topicRows[0].querySelector('input[type="text"]');
check('topic text prefilled', !!(firstInput && firstInput.value === items[0].text), firstInput && firstInput.value);
check('topic row has no on-air button', !!(topicRows[0] && topicRows[0].querySelector('.onair') === null), 'removed');

const stopRows = (elements.get('stops') || { children: [] }).children;
check('gradient stops rendered', stopRows.length >= 2, stopRows.length + ' stops');
check('stop colour is a hex value',
  stopRows.length > 0 && /^#[0-9a-f]{6}$/i.test(stopRows[0].querySelector('input[type="color"]').value),
  stopRows.length ? stopRows[0].querySelector('input[type="color"]').value : '-');

/* A native colour input cannot hold rgba(): it shows black and writes back a
   flat hex, destroying the alpha the glass depends on. The shipped row gradient
   is rgba, so the stop row must expose hex + a separate alpha control. */
const shippedStop = global.TP_DEFAULT_CONFIG.topics.gradient[0].color;
check('shipped row gradient carries alpha', /rgba\(/.test(shippedStop), shippedStop);
check('stop row has a separate alpha input',
  stopRows.length > 0 && stopRows[0].querySelector('input.stop-alpha') !== null,
  stopRows.length ? String(stopRows[0].querySelector('input.stop-alpha').value) : '-');
check('stop alpha input reflects the shipped alpha',
  stopRows.length > 0 &&
  Math.abs(parseFloat(stopRows[0].querySelector('input.stop-alpha').value) - 0.92) < 0.001,
  stopRows.length ? String(stopRows[0].querySelector('input.stop-alpha').value) : '-');

/* Single colour pickers bound to rgba() must show the right hex too — not the
   black a native colour input falls back to when it cannot parse the value. */
const colorBindCheck = [
  ['c_panelBg', global.TP_DEFAULT_CONFIG.panel.background],
  ['c_titleColor', global.TP_DEFAULT_CONFIG.header.title.color],
  ['c_rowColor', global.TP_DEFAULT_CONFIG.topics.text.color],
  ['c_borderColor', global.TP_DEFAULT_CONFIG.panel.borderColor]
].map(([id, shippedVal]) => {
  const n = elements.get(id);
  const hex = (String(shippedVal).match(/^#/) ? String(shippedVal) : null) ||
    (function () {
      const m = String(shippedVal).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map(Number);
      return '#' + p.slice(0, 3).map((v) => ('0' + Math.round(v).toString(16)).slice(-2)).join('');
    })();
  return { id, ok: !!n && n.value === hex, got: n ? n.value : 'missing', want: hex };
});
check('rgba-bound colour pickers show the correct hex, not black',
  colorBindCheck.every((c) => c.ok),
  colorBindCheck.filter((c) => !c.ok).map((c) => c.id + '=' + c.got + ' want ' + c.want).join('; ') ||
  colorBindCheck.length + ' pickers checked');

/* The dark presets were removed when the panel moved to the sky-glass theme:
   one click on "Rollup Dark" would have undone it. */
const presetIds = [...HTML.matchAll(/data-preset="([a-z]+)"/g)].map((m) => m[1]);
check('no dark preset can restore the old theme',
  !presetIds.includes('rollup') && !presetIds.includes('midnight') && !presetIds.includes('navy'),
  presetIds.join(', ') || 'none');
check('light presets are offered', presetIds.includes('sky') && presetIds.length >= 3,
  presetIds.join(', '));
const presetDefs = [...ADMIN_JS.matchAll(/^\s{4}([a-z]+):\s*\{\n\s*panel: \{ background: '([^']+)'/gm)]
  .map((m) => m[1]);
check('every preset button has a definition',
  presetIds.every((id) => presetDefs.includes(id)),
  'buttons: ' + presetIds.join(', ') + ' | defs: ' + presetDefs.join(', '));

/* ------------------------------------------------------------ interaction */
elements.get('c_title').value = 'EVENING BRIEF';
elements.get('c_title').dispatch('input');
const s1 = JSON.parse(store['tp-config-v1'] || '{}');
check('editing the title updates the config', !!(s1.header && s1.header.title.text === 'EVENING BRIEF'), s1.header && s1.header.title.text);

const rowSize = elements.get('c_rowSize');
rowSize.value = '46';
rowSize.dispatch('input');
check('number field coerces', Number(JSON.parse(store['tp-config-v1']).topics.text.size) === 46,
  String(JSON.parse(store['tp-config-v1']).topics.text.size));

check('config is pushed to the preview iframe',
  messages.some((m) => m.type === 'tp:config' && m.config.header.title.text === 'EVENING BRIEF'), messages.length + ' messages');

const before = fetches.length;
elements.get('btnOut').dispatch('click');
check('Hide posts a command to the server',
  fetches.slice(before).some((f) => f.url.includes('api/command') && f.url.includes('out')),
  fetches.slice(before).map((f) => f.url).join(', ') || 'none');

const rowsBefore = topicRows.length;
elements.get('btnAddTopic').dispatch('click');
check('Add topic appends a row', elements.get('topicList').children.length === rowsBefore + 1,
  rowsBefore + ' → ' + elements.get('topicList').children.length);

setTimeout(() => {
  check('Save persists config.json (debounced POST)',
    fetches.some((f) => f.url.includes('api/config') && f.method === 'POST'),
    fetches.filter((f) => f.url.includes('api/config')).length + ' config posts');
  check('tabs and panels line up', tabNodes.length === panelNodes.length,
    tabNodes.length + ' tabs / ' + panelNodes.length + ' panels');

  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  talking points admin — runtime check\n  ' + '-'.repeat(56));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(56));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}, 1400);
