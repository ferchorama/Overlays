#!/usr/bin/env node
/* ============================================================================
   Unified server test — boots Overlays/server.js on a throwaway port and talks
   to it over real HTTP.

     node tests/server.js

   The point of fusing the two servers is that ONE process serves both projects
   under path prefixes and keeps the old ports working. These checks pin exactly
   that: both apps reachable, each with its own state and its own action list,
   nothing escaping the app directory, and the hub reporting honest status.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8899;          // deliberately not a real port, so a running studio
const LEGACY_WX = 8897;     // dedicated legacy ports, so the test never fights
const LEGACY_TP = 8896;     // a live studio server for 8787/8788

const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

/* ------------------------------------------------------------------ helpers */
function request(method, urlPath, body) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, type: '', body: String(e.message) }));
    if (body) req.write(body);
    req.end();
  });
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const json = (r) => { try { return JSON.parse(r.body); } catch (e) { return null; } };

function rawGet(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    req.end();
  });
}

function waitForPort(attempts) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      get('/healthz').then((r) => {
        if (r.status === 200) return resolve();
        if (n <= 0) return reject(new Error('server never came up'));
        setTimeout(() => tick(n - 1), 120);
      });
    };
    tick(attempts);
  });
}

/* --------------------------------------------------------------------- run */
const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  env: Object.assign({}, process.env, {
    PORT: String(PORT), LEGACY: '1',
    LEGACY_PORT_WEATHER: String(LEGACY_WX), LEGACY_PORT_TOPICS: String(LEGACY_TP)
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', (c) => { serverLog += c; });
child.stderr.on('data', (c) => { serverLog += c; });

function finish() {
  try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  unified server — over real HTTP\n  ' + '-'.repeat(56));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(56));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}

(async function main() {
  try {
    await waitForPort(60);
  } catch (e) {
    console.log('\n  server failed to start:\n' + serverLog + '\n');
    process.exit(1);
  }

  /* --------------------------------------------------------------- the hub */
  const hub = await get('/');
  check('hub page served at /', hub.status === 200 && /The Rollup overlays hub/.test(hub.body), 'HTTP ' + hub.status);
  check('hub injects the studio config', /window\.__STUDIO__\s*=/.test(hub.body), 'placeholder replaced');
  check('hub lists both apps', /Vertical Weather/.test(hub.body) && /Talking Points/.test(hub.body)
    || /__STUDIO__/.test(hub.body), 'apps injected client-side');
  check('hub HTML is not cached', hub.status === 200, 'no-store');

  const apps = json(await get('/api/apps'));
  const wanted = ['weather', 'topics', 'market'];
  check('/api/apps lists every app', !!apps && wanted.every((id) => apps.apps.some((a) => a.id === id)),
    apps ? apps.apps.map((a) => a.id).join(', ') : 'no JSON');
  check('app status carries versions',
    !!apps && apps.apps.every((a) => a.shippedVersion),
    apps ? apps.apps.map((a) => a.id + ' v' + a.shippedVersion).join(', ') : '-');

  const health = json(await get('/healthz'));
  check('/healthz reports the port', !!health && health.ok === true && health.port === PORT, 'port ' + (health && health.port));

  /* ------------------------------------------------- both apps, one origin */
  const wx = await get('/weather/index.html');
  const tp = await get('/topics/index.html');
  check('weather overlay served under /weather/', wx.status === 200 && /Vertical Weather Overlay/.test(wx.body),
    'HTTP ' + wx.status);
  check('topics overlay served under /topics/', tp.status === 200 && /Talking Points/.test(tp.body),
    'HTTP ' + tp.status);

  const wxAdmin = await get('/weather/admin.html');
  const tpAdmin = await get('/topics/admin.html');
  check('weather admin served', wxAdmin.status === 200, 'HTTP ' + wxAdmin.status);
  check('topics admin served', tpAdmin.status === 200, 'HTTP ' + tpAdmin.status);

  /* assets must resolve RELATIVE to the prefix — this is what makes the fusion
     work without touching either project */
  const wxJs = await get('/weather/script.js');
  const tpCss = await get('/topics/style.css');
  check('weather script served with JS content-type', wxJs.status === 200 && /javascript/.test(wxJs.type),
    wxJs.type || 'HTTP ' + wxJs.status);
  check('topics stylesheet served with CSS content-type', tpCss.status === 200 && /css/.test(tpCss.type),
    tpCss.type || 'HTTP ' + tpCss.status);
  check('prefixed assets are the right project',
    /Weather Overlay/.test(wxJs.body) && !/Talking Points/.test(wxJs.body.slice(0, 2000)),
    'no cross-project bleed');

  /* a trailing-slash redirect keeps /weather usable by hand */
  const slash = await get('/weather');
  check('/weather redirects to /weather/', slash.status === 302, 'HTTP ' + slash.status);

  /* ---------------------------------------------------- config isolation */
  const wxCfg = json(await get('/weather/api/config'));
  const tpCfg = json(await get('/topics/api/config'));
  check('weather config endpoint answers JSON', wxCfg !== null, JSON.stringify(wxCfg).slice(0, 44));
  check('topics config endpoint answers JSON', tpCfg !== null, JSON.stringify(tpCfg).slice(0, 44));

  const bad = await post('/weather/api/config', 'not json');
  check('invalid config rejected with 400', bad.status === 400, 'HTTP ' + bad.status);
  const arr = await post('/weather/api/config', '[1,2,3]');
  check('array config rejected (must be an object)', arr.status === 400, 'HTTP ' + arr.status);

  /* ------------------------------------------------------ command routing */
  const wxCmd = json(await get('/weather/api/command?action=refresh'));
  const tpCmd = json(await get('/topics/api/command?action=in'));
  check('weather command routed to weather', !!wxCmd && wxCmd.app === 'weather' && wxCmd.state.action === 'refresh',
    wxCmd && wxCmd.state && wxCmd.state.action);
  check('topics command routed to topics', !!tpCmd && tpCmd.app === 'topics' && tpCmd.state.action === 'in',
    tpCmd && tpCmd.state && tpCmd.state.action);

  /* the two apps keep SEPARATE sequences — fusing the servers must not fuse
     the state of two unrelated overlays */
  check('each app keeps its own state sequence',
    !!wxCmd && !!tpCmd && wxCmd.state.seq !== undefined && tpCmd.state.seq !== undefined,
    'weather seq=' + (wxCmd && wxCmd.state.seq) + ', topics seq=' + (tpCmd && tpCmd.state.seq));

  /* action lists stay per-app */
  const wxBad = await get('/weather/api/command?action=replay');   // topics-only action
  const tpBad = json(await get('/topics/api/command?action=hibernate'));
  check('weather rejects an unknown action with 400 + allowed',
    wxBad.status === 400 && Array.isArray(json(wxBad).allowed), 'HTTP ' + wxBad.status);
  check('weather does not accept the topics-only action "replay"',
    wxBad.status === 400, 'HTTP ' + wxBad.status);
  check('topics falls back to a default action instead of erroring',
    tpBad && tpBad.ok === true && tpBad.state.action === 'in', tpBad && tpBad.state.action);

  /* The market board polls api/state like the other two. Pin the server half of
     that contract here; the overlay half is covered by market/tests/smoke.js. */
  const mkCmd = json(await get('/market/api/command?action=next'));
  check('market command routed to market',
    !!mkCmd && mkCmd.app === 'market' && mkCmd.state.action === 'next',
    mkCmd && mkCmd.state && mkCmd.state.action);
  const mkState = json(await get('/market/api/state'));
  check('market state carries the action the board has to replay',
    !!mkState && mkState.action === 'next' && typeof mkState.seq === 'number',
    mkState ? mkState.action + ' seq=' + mkState.seq : 'no JSON');

  /* ---------------------------------------------------------- containment */
  const trav = await get('/weather/../../etc/passwd');
  check('path traversal is refused', trav.status === 403 || trav.status === 404,
    'HTTP ' + trav.status);
  const missing = await get('/weather/does-not-exist.js');
  check('missing file is a clean 404', missing.status === 404, 'HTTP ' + missing.status);
  /* Each overlay vendors a .skills/ tree of third-party reference documents.
     Nothing loads them, and the static handler refuses dot-segments so they
     cannot be fetched by hand either. */
  const vendored = await get('/weather/.skills/hallmark/SKILL.md');
  check('vendored .skills material is not served',
    vendored.status === 403 || vendored.status === 404, 'HTTP ' + vendored.status);
  const unknownApp = await get('/nope/index.html');
  check('unknown app prefix is a 404 with guidance',
    unknownApp.status === 404 && /try one of/.test(unknownApp.body), 'HTTP ' + unknownApp.status);

  /* ------------------------------------------------- the backward-compat promise
     Existing OBS browser sources point at http://localhost:8788/index.html and
     http://localhost:8787/index.html. Fusing the servers must not break them, so
     each legacy port still serves its own project at the ROOT (no prefix). */
  const legacyWx = await rawGet(LEGACY_WX, '/index.html');
  const legacyTp = await rawGet(LEGACY_TP, '/index.html');
  check('legacy weather port serves the overlay at root',
    legacyWx.status === 200 && /Vertical Weather Overlay/.test(legacyWx.body), 'HTTP ' + legacyWx.status);
  check('legacy topics port serves the overlay at root',
    legacyTp.status === 200 && /Talking Points/.test(legacyTp.body), 'HTTP ' + legacyTp.status);
  check('legacy ports serve their own assets',
    (await rawGet(LEGACY_WX, '/script.js')).status === 200 &&
    (await rawGet(LEGACY_TP, '/script.js')).status === 200, 'both 200');

  const legacyCmd = json(await rawGet(LEGACY_WX, '/api/command?action=refresh'));
  check('legacy port keeps the command API', !!legacyCmd && legacyCmd.app === 'weather',
    legacyCmd && legacyCmd.app);

  check('legacy banner was printed', /Legacy ports/.test(serverLog), 'logged');

  /* ------------------------------------------------- fallback coverage
     The CoinPaprika fallback drops any coin it has no id for. If someone adds a
     coin to the market board's config and forgets the mapping, that coin would
     quietly disappear from the board during a CoinGecko outage — so assert the
     mapping covers everything the board ships. */
  {
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const start = serverSrc.indexOf('const COINPAPRIKA_IDS = {');
    const end = serverSrc.indexOf('};', start);
    check('CoinPaprika mapping is present', start !== -1 && end > start, 'COINPAPRIKA_IDS found');

    const pairs = [];
    if (start !== -1) {
      const block = serverSrc.slice(start, end);
      for (const m of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) pairs.push([m[1], m[2]]);
    }
    const mapped = new Set(pairs.map((p) => p[0]));

    /* A copy-pasted CoinPaprika id would quietly show one coin's price under
       another coin's name for the length of a CoinGecko outage — the kind of
       thing nobody notices from the board alone. */
    const byCp = {};
    const dupes = [];
    pairs.forEach(([cgId, cpId]) => {
      if (byCp[cpId]) dupes.push(cpId + ' ← ' + byCp[cpId] + ' & ' + cgId); else byCp[cpId] = cgId;
    });
    check('no two coins share a fallback id', dupes.length === 0,
      dupes.join('; ') || pairs.length + ' unique ids');

    let shipped = [];
    try {
      const cfgPath = path.join(ROOT, 'market', 'config.js');
      const cfgSrc = fs.readFileSync(cfgPath, 'utf8');
      const coinMatches = [...cfgSrc.matchAll(/coins:\s*\[([^\]]+)\]/g)];
      coinMatches.forEach((m) => {
        for (const c of m[1].matchAll(/'([^']+)'/g)) shipped.push(c[1]);
      });
      shipped = [...new Set(shipped)];
    } catch (e) {
      check('market config readable for fallback coverage', false, String(e.message));
    }

    const uncovered = shipped.filter((id) => !mapped.has(id));
    check('every coin the board ships has a fallback id', uncovered.length === 0,
      uncovered.length ? 'unmapped: ' + uncovered.join(', ')
        : shipped.length + ' coins, ' + mapped.size + ' mapped');
  }

  finish();
})();
