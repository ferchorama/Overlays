#!/usr/bin/env node
/* ============================================================================
   Smoke test — runs the real overlay code in Node with a tiny DOM shim and a
   stubbed Open-Meteo, then asserts what actually renders.

     node tests/smoke.js            happy path (2 cities)
     node tests/smoke.js --fail     API failure → cached / retry state
     node tests/smoke.js --no-cache API failure with nothing cached

   This exists because the browser source cannot be screenshotted in every
   environment — it proves the fetch → normalise → render path end to end.
   ========================================================================== */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const MODE = process.argv.includes('--fail') ? 'fail'
  : process.argv.includes('--no-cache') ? 'no-cache' : 'ok';

/* ------------------------------------------------------------------ DOM shim */
function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    children: [],
    dataset: {},
    style: {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; }
    },
    textContent: '',
    clientWidth: 420,
    clientHeight: 120,
    scrollWidth: 200,
    scrollHeight: 60,
    offsetHeight: 120,
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
function getEl(id) {
  if (!ids[id]) { ids[id] = makeNode('div'); ids[id].id = id; }
  return ids[id];
}

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

/* Recording GSAP stub ------------------------------------------------------
   script.js only installs its own no-op shim when window.gsap is missing, so
   defining this first lets the test observe the timeline choreography.
   It records the call order and flags .delay() calls that happen while the
   timeline is already playing — that combination re-begins a GSAP timeline and
   was what made the entrance animation play twice. */
const gsapLog = [];
global.gsap = {
  timeline() {
    const tl = { _active: false };
    ['from', 'to', 'set', 'add', 'kill'].forEach((k) => { tl[k] = () => tl; });
    tl.progress = () => 1;
    tl.duration = () => 3.3;
    tl.play = () => { gsapLog.push('play'); tl._active = true; return tl; };
    tl.pause = () => { gsapLog.push('pause'); tl._active = false; return tl; };
    tl.delay = () => { gsapLog.push(tl._active ? 'delay:WHILE-PLAYING' : 'delay'); return tl; };
    return tl;
  },
  set: () => {},
  from: () => {},
  to: (target, vars) => {
    /* the temperature tween drives its own onUpdate */
    if (vars && typeof vars.val === 'number' && vars.onUpdate) vars.onUpdate();
  }
};

if (MODE !== 'ok' && MODE !== 'no-cache') { /* unreachable */ }

/* canned API -------------------------------------------------------------- */
const FORECAST_OK = {
  latitude: 25.77, longitude: -80.19, timezone: 'America/New_York',
  current: {
    time: '2026-09-24T13:00', interval: 900,
    temperature_2m: 84.4, relative_humidity_2m: 75, apparent_temperature: 93.2,
    is_day: 1, precipitation: 0, weather_code: 2, cloud_cover: 25,
    surface_pressure: 1012.3, wind_speed_10m: 5.4, wind_direction_10m: 140
  },
  daily: { temperature_2m_max: [88.1], temperature_2m_min: [78.6] }
};
const GEO_OK = {
  results: [{
    name: 'Miami', latitude: 25.77427, longitude: -80.19366,
    country_code: 'US', admin1: 'Florida', timezone: 'America/New_York'
  }]
};

/* The overlay no longer talks to Open-Meteo: it asks the hub for every city in
   one payload. The payload shape below is exactly what /weather/api/data
   returns (see server.js createWeatherData). */
function hubPayload() {
  return {
    fetchedAt: Date.now(),
    source: 'open-meteo',
    cities: [
      { key: 'll:40.7128,-74.0060', label: 'New York', lat: 40.7128, lon: -74.006,
        timezone: 'America/New_York', forecast: FORECAST_OK },
      { key: 'll:25.7617,-80.1918', label: 'Miami', lat: 25.7617, lon: -80.1918,
        timezone: 'America/New_York', forecast: FORECAST_OK }
    ]
  };
}

let fetchCount = 0;
let dataFetches = 0;
global.fetch = (url) => {
  fetchCount++;
  const u = String(url);
  if (u.indexOf('config.json') !== -1) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }
  if (u.indexOf('api/data') !== -1) {
    dataFetches++;
    if (MODE === 'fail' || MODE === 'no-cache') {
      return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(hubPayload()) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
};

/* seed a cache for the --fail case ---------------------------------------- */
if (MODE === 'fail') {
  /* use the key the shipped config actually reads, and one entry per city so
     the "same shape" fallback rule applies */
  const cfgModule = require(path.join(ROOT, 'config.js'));
  require(path.join(ROOT, 'config-merge.js'));
  const key = (global.window.WX_DEFAULT_CONFIG.data || {}).cacheKey || 'wx-cache-v1';
  const cityCount = (global.window.WX_DEFAULT_CONFIG.cities || []).filter((c) => c.enabled !== false).length;
  const cached = (label, temp) => ({
    label, temp, feels: temp + 8, humidity: 70, wind: 4.1, windDir: 90,
    code: 1, isDay: true, precip: 0, clouds: 10, pressure: 1010,
    high: temp + 6, low: temp - 4, observedAt: '2026-09-24T12:00',
    fetchedAt: Date.now() - 60000, error: null
  });
  store[key] = JSON.stringify({
    ts: Date.now() - 10 * 60 * 1000,   /* older than cacheTtlSeconds */
    cities: [cached('New York', 80.2), cached('Miami', 84.2)].slice(0, cityCount)
  });
}

/* ------------------------------------------------------------------- boot */
require(path.join(ROOT, 'icons.js'));
require(path.join(ROOT, 'config.js'));
/* loaded in every mode: the migration check below runs whatever the fetch mode */
require(path.join(ROOT, 'config-merge.js'));
require(path.join(ROOT, 'script.js'));

/* ---------------------------------------------------------------- helpers */
function textOf(node, testid) {
  const walk = (n) => {
    if (!n) return null;
    if (n.dataset && n.dataset.testid === testid) return n.textContent;
    for (const c of n.children || []) { const hit = walk(c); if (hit != null) return hit; }
    return null;
  };
  return walk(node);
}
function collect(node, testid, out) {
  out = out || [];
  if (!node) return out;
  if (node.dataset && node.dataset.testid === testid) out.push(node.textContent);
  (node.children || []).forEach((c) => collect(c, testid, out));
  return out;
}

setTimeout(() => {
  const stage = ids['stage'];
  const state = stage && stage.dataset.state;
  const cards = collect(stage, 'city-card');
  const temps = collect(stage, 'temp');
  const conds = collect(stage, 'condition');
  const ranges = collect(stage, 'range');
  const statValues = collect(stage, 'stat-value');
  const statLabels = collect(stage, 'stat-label');
  const updated = textOf(stage, 'updated');
  const live = ids['wx-live'] ? ids['wx-live'].textContent : '';

  const results = [];
  const check = (name, pass, info) => results.push({ name, pass, info });
  const tlPlays = () => gsapLog.filter((c) => c === 'play').length;

  /* the saved-config merge must not turn a saved falsy value into a truthy `{}`
     (that is what a `JSON.parse(JSON.stringify(o || {}))` clone did) */
  {
    const merged = global.WX_MIGRATE.apply(global.WX_DEFAULT_CONFIG, {
      meta: { version: '0.0.9' },
      maxCities: 0,
      theme: '',
      cities: [{ label: 'Kept', query: 'Kept', enabled: true }]
    });
    check('migration keeps a saved 0 as 0, never {}',
      merged.maxCities === 0, JSON.stringify(merged.maxCities) + ' (' + typeof merged.maxCities + ')');
    check('migration keeps a saved empty string as a string',
      merged.theme === '', JSON.stringify(merged.theme) + ' (' + typeof merged.theme + ')');
    check('migration keeps the saved cities', (merged.cities || []).length === 1,
      JSON.stringify((merged.cities || []).map((c) => c.label)));
  }

  if (MODE === 'ok') {
    check('panel built (2 cards)', cards.length === 2, 'cards=' + cards.length);
    check('temperature rendered', /^\d+°$/.test(temps[0] || ''), temps[0]);
    check('condition rendered', /Mainly clear|Partly cloudy/i.test(conds[0] || ''), conds[0]);
    check('high/low rendered', /H 88°/.test(ranges[0] || '') && /L 79°/.test(ranges[0] || ''), ranges[0]);
    check('stat values rendered', /5 MPH/.test(statValues[0] || '') && /75%/.test(statValues[1] || ''), statValues.join(' | '));
    check('stat labels rendered', /Wind/i.test(statLabels[0] || '') && /Humidity/i.test(statLabels[1] || ''), statLabels.join(' | '));
    check('footer timestamp', /Updated/i.test(updated || ''), updated);
    check('state = ready', state === 'ready', state);
    check('aria-live announced', /84 degrees/.test(live), live.slice(0, 60));
    check('one hub data request on load', dataFetches === 1, dataFetches + ' api/data request(s)');
    /* shapes must not rely on the SVG default fill (black) */
    var sunSvg = global.WX.icon('clear', true, 'Clear');
    check('sun disc carries a fill', /<circle class="wx-sun" fill=/.test(sunSvg),
      (sunSvg.match(/<circle[^>]*>/) || [''])[0].slice(0, 64));
    /* icons.js paints from var(--wx-*), so the panel has to publish the
       configured colours — otherwise the colour pickers in the control panel
       write config that nothing ever reads and every icon falls back to amber */
    var panelNode = (stage.children || [])[0];
    var iconCfg = global.WX.getConfig().iconColors || {};
    check('icon colours reach the CSS variables',
      !!panelNode && panelNode.style['--wx-sun'] === iconCfg.sun &&
      panelNode.style['--wx-fog'] === iconCfg.fog,
      panelNode ? panelNode.style['--wx-sun'] + ' / ' + panelNode.style['--wx-fog'] : 'no panel');
    /* entrance choreography regression: one start, and never a delay() applied
       to a timeline that is already running (that re-begins it) */
    check('entrance started exactly once', tlPlays() === 1, 'play() calls=' + tlPlays());
    check('no delay() while playing', gsapLog.indexOf('delay:WHILE-PLAYING') === -1, gsapLog.join(' → '));

    /* -------------------------------------------------- stat strip layout
       With all six optional fields selected the strip used to squeeze six 36px
       values into one 460px row and they painted over each other. The cell count
       now decides the shape: one row up to three fields, two rows beyond that,
       and the type scales so both rows fit the fixed strip height. */
    const panelInst = global.WX.engine.panel;
    const dEl = panelInst.cardEls[0].details;
    const six = ['Wind NNE', 'Humidity', 'Feels like', 'Precip', 'Pressure', 'Cloud']
      .map((l) => ({ label: l, value: '1012 hPa' }));
    panelInst.renderStatCells(dEl, six);
    check('six fields lay out as two rows of three', Number(dEl.style['--stat-cols']) === 3,
      'cols=' + dEl.style['--stat-cols']);
    check('six fields render six cells', dEl.children.length === 6, dEl.children.length + ' cells');
    check('every row starts a new column group',
      dEl.children[0].classList.contains('is-col-first') &&
      dEl.children[3].classList.contains('is-col-first') &&
      !dEl.children[1].classList.contains('is-col-first'), 'row starts marked');
    const sixSize = parseFloat(dEl.style['--stat-value-size']);
    check('two rows shrink the value type to fit the strip',
      sixSize < global.WX_DEFAULT_CONFIG.card.details.valueSize && sixSize >= 26,
      sixSize + 'px vs configured');

    const four = ['a', 'b', 'c', 'd'].map((l) => ({ label: l, value: '1' }));
    panelInst.renderStatCells(dEl, four);
    check('four fields lay out as two rows of two',
      Number(dEl.style['--stat-cols']) === 2 && dEl.children.length === 4,
      'cols=' + dEl.style['--stat-cols'] + ' cells=' + dEl.children.length);

    panelInst.renderStatCells(dEl, [{ label: 'Wind', value: '5 MPH' }]);
    check('a single field spans the row at the configured type size',
      Number(dEl.style['--stat-cols']) === 1 &&
      parseFloat(dEl.style['--stat-value-size']) === global.WX_DEFAULT_CONFIG.card.details.valueSize,
      'cols=' + dEl.style['--stat-cols'] + ' size=' + dEl.style['--stat-value-size']);
  } else {
    check('cached value kept on failure', MODE === 'fail' ? /^80°$/.test(temps[0] || '') : true, temps[0]);
    check('honest placeholder without cache', MODE === 'no-cache' ? /– –/.test(temps[0] || '') : true, temps[0]);
    check('no-data cells say how to retry', MODE === 'no-cache' ? /PRESS R TO RETRY/i.test(statLabels[0] || '') : true, statLabels[0]);
    check('state reported honestly', MODE === 'fail' ? state === 'stale' : state === 'error', state);
    check('cached run is marked in the footer', MODE === 'fail' ? /cached/i.test(updated || '') : true, updated);
  }

  /* "No periodic refresh" is a timing claim, so it gets a timing assertion:
     let the config/state pollers run for a couple of seconds and require that
     the provider-facing request count has not moved. */
  setTimeout(function () {
    check('nothing polls the provider while idle', dataFetches === 1,
      dataFetches + ' api/data request(s) after ~2.2s');

    /* The dashboard's Update now bumps the `refresh` command; the overlay's
       command handler must re-read the hub. The HTTP + state-file half of that
       chain is covered by tests/server.js and tests/datasync.js. */
    global.WX.handleCommand({ action: 'refresh', seq: 999 });
    setTimeout(function () {
      check('the refresh command re-reads the hub', dataFetches === 2,
        dataFetches + ' api/data request(s) after the command');

      let failed = 0;
    console.log('\n  weather overlay smoke test — mode: ' + MODE + '\n  ' + '-'.repeat(46));
    results.forEach((r) => {
      if (!r.pass) failed++;
      console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : ''));
    });
    console.log('  ' + '-'.repeat(46));
      console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
      process.exit(failed ? 1 : 0);
    }, 200);
  }, 2200);
}, 700);
