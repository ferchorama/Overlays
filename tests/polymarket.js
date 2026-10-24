#!/usr/bin/env node
/* ============================================================================
   Polymarket headlines proxy — over real HTTP

     node tests/polymarket.js

   This machine cannot reach polymarket.com: the TLS handshake is reset by the
   local ISP filter, and http:// on port 80 answers with a redirect to the
   national gambling regulator. So the live API has never been observed, and
   this suite does NOT pretend otherwise.

   What it does instead is shrink the unverifiable part to a single base URL.
   A fake Gamma server — in this process, on 127.0.0.1 — implements the
   PUBLISHED contract (tag_id / tag_slug, the per-endpoint order spelling,
   outcomePrices as a JSON string, nested event markets), and the real hub is
   booted against it with POLYMARKET_API_BASE. Everything the feature rests on
   is then exercised end to end: the URL the hub builds, the ranking, the
   defensive parsing, the error shapes, and the cache.

   The residual risk is exactly one thing, and it is stated in the README: the
   fake encodes the documented field names, so if Gamma's real names differ the
   adapter needs a one-line change. Nothing else about the feature is unproven.
   ========================================================================== */
'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HUB_PORT = 8892;
const FAKE_PORT = 8891;

const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

/* ------------------------------------------------------------- the fake Gamma
   Field names, array-encoding quirks and parameters all follow the published
   documentation. `broken` tag ids drive the failure modes, so the failure paths
   are reachable through the proxy without any test-only back door in the hub. */
const TAGS = [
  { id: 1, label: 'Crypto', slug: 'crypto' },
  { id: 2, label: 'Economy', slug: 'economy' },
  { id: 3, label: 'Finance', slug: 'finance' },
  { id: 4, label: 'Politics', slug: 'politics' }
];

/* Deliberately NOT in volume order, so the ranking has to come from the hub. */
const EVENTS = [
  { id: 'e1', title: 'Will Bitcoin close above $150k this year?', slug: 'btc-150k',
    volume24hr: 1200000, volumeNum: 9000000, liquidityNum: 250000,
    outcomePrices: '["0.68", "0.32"]', outcomes: '["Yes", "No"]',
    oneDayPriceChange: 0.042, endDate: '2026-12-31T00:00:00Z', closed: false, active: true },
  { id: 'e2', title: 'Will the Fed cut rates twice this year?', slug: 'fed-two-cuts',
    volume24hr: 4800000, volumeNum: 20000000, liquidityNum: 900000,
    outcomePrices: ['0.31', '0.69'], outcomes: ['Yes', 'No'],
    oneDayPriceChange: -0.011, closed: false, active: true },
  { id: 'e3', title: 'Will Ethereum flip Bitcoin?', slug: 'eth-flip',
    volume24hr: 900000, closed: false, active: true },
  { id: 'e8', title: 'Will a spot SOL ETF launch?', slug: 'sol-etf',
    volume24hr: 600000, outcomePrices: '["0.22","0.78"]', closed: false, active: true },
  { id: 'e5', title: 'Multi-market headline', slug: 'multi',
    volume24hr: 3000000, closed: false, active: true,
    markets: [{ id: 'm1', volume24hr: 100, outcomePrices: '["0.10","0.90"]' },
              { id: 'm2', volume24hr: 5000, outcomePrices: '["0.55","0.45"]' }] },
  /* must never reach the board */
  { id: 'e4', title: 'SETTLED event', slug: 'settled', volume24hr: 9999999, closed: true },
  { id: 'e7', title: 'Inactive event', slug: 'inactive', volume24hr: 8888888, active: false },
  { id: 'e6', volume24hr: 7777777, closed: false },            /* no title */
  null,                                                         /* not even an object */
  { id: 'e9', title: '   ', slug: 'blank', volume24hr: 6666666 } /* whitespace title */
];

const MARKETS = [
  { id: 'mk1', question: 'Will BTC hit $200k?', slug: 'btc-200k',
    volume24hr: 100, outcomePrices: '["0.12","0.88"]', closed: false },
  { id: 'mk2', question: 'Will CPI come in under 3%?', slug: 'cpi-3',
    volume24hr: 700, outcomePrices: '["0.44","0.56"]', closed: false }
];

const seen = [];      /* every request the fake received: { path, query } */

const fake = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  seen.push({ path: parsed.pathname, query: parsed.search, params: parsed.searchParams });

  const tag = parsed.searchParams.get('tag_id') || '';
  const sendJson = (code, body) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  };

  if (parsed.pathname === '/tags') return sendJson(200, TAGS);

  /* failure modes, reachable through the proxy by tag id */
  if (tag === '999') return sendJson(404, { error: 'no such tag' });
  if (tag === '997') return sendJson(200, []);
  if (tag === '996') return sendJson(200, { error: 'maintenance' });
  if (tag === '995') return sendJson(500, { error: 'boom' });

  if (parsed.pathname === '/events') return sendJson(200, EVENTS);
  if (parsed.pathname === '/markets') return sendJson(200, MARKETS);
  return sendJson(404, { error: 'unknown path' });
});

/* ------------------------------------------------------------------ helpers */
function get(urlPath, port) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: port || HUB_PORT, path: urlPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e.message) }));
    req.end();
  });
}
const json = (r) => { try { return JSON.parse(r.body); } catch (e) { return null; } };
const lastQueryFor = (p) => {
  for (let i = seen.length - 1; i >= 0; i--) if (seen[i].path === p) return seen[i];
  return null;
};

/* --------------------------------------------------------------------- run */
let hubLog = '';
let hub = null;

function finish() {
  try { if (hub) hub.kill('SIGKILL'); } catch (e) { /* already gone */ }
  try { fake.close(); } catch (e) { /* already closed */ }
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  polymarket proxy — over real HTTP, against a fake Gamma\n  ' + '-'.repeat(70));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(70));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}

function waitForHub(n) {
  return new Promise((resolve, reject) => {
    const tick = (left) => {
      get('/healthz').then((r) => {
        if (r.status === 200) return resolve();
        if (left <= 0) return reject(new Error('hub never came up:\n' + hubLog));
        setTimeout(() => tick(left - 1), 120);
      });
    };
    tick(n);
  });
}

(async function main() {
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));

  hub = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(HUB_PORT),
      LEGACY: '0',
      POLYMARKET_API_BASE: 'http://127.0.0.1:' + FAKE_PORT
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  hub.stdout.on('data', (c) => { hubLog += c; });
  hub.stderr.on('data', (c) => { hubLog += c; });

  try { await waitForHub(60); } catch (e) { console.log('\n' + e.message + '\n'); finish(); }

  const TOP = '/predictions/api/polymarket?what=top&category=crypto&entity=events&tagId=1&limit=5';

  /* ------------------------------------------------------ the happy path */
  const r1 = await get(TOP);
  const b1 = json(r1);
  check('the proxy answers 200', r1.status === 200, 'HTTP ' + r1.status + ' ' + r1.body.slice(0, 90));
  check('the response declares its source', r1.headers['x-source'] === 'polymarket', 'X-Source=' + r1.headers['x-source']);
  check('the envelope names the category and entity',
    !!b1 && b1.what === 'top' && b1.category === 'crypto' && b1.entity === 'events',
    b1 ? b1.what + '/' + b1.category + '/' + b1.entity : 'no JSON');

  const titles = (b1 && b1.items ? b1.items.map((i) => i.id) : []).join(',');
  check('rows are ranked by 24h volume, not by upstream order',
    titles === 'e2,e5,e1,e3,e8', 'order=' + titles);
  check('the ranking really is 24h volume',
    !!b1 && b1.items.every((it, i, a) => i === 0 || a[i - 1].volume24hr >= it.volume24hr),
    b1 ? b1.items.map((i) => i.volume24hr).join(' >= ') : '-');
  check('limit is honoured', !!b1 && b1.items.length === 5 && b1.count === 5,
    b1 ? b1.items.length + ' rows' : '-');

  /* ------------------------------------------------- the URL that was built */
  const q1 = lastQueryFor('/events');
  check('sort key for /events is the documented volume_24hr',
    !!q1 && q1.params.get('order') === 'volume_24hr', q1 ? q1.query : 'never called');
  check('the request asks only for open, active markets',
    !!q1 && q1.params.get('closed') === 'false' && q1.params.get('active') === 'true',
    q1 ? q1.query : '-');
  check('the tag id is passed through',
    !!q1 && q1.params.get('tag_id') === '1' && q1.params.get('tag_slug') === null,
    q1 ? q1.query : '-');
  check('the limit is passed through', !!q1 && q1.params.get('limit') === '5', q1 ? q1.query : '-');

  /* --------------------------------------------------- defensive parsing */
  const byId = {};
  (b1 && b1.items ? b1.items : []).forEach((i) => { byId[i.id] = i; });
  check('a JSON-string outcomePrices becomes a percentage',
    byId.e1 && byId.e1.probability === 68, byId.e1 ? String(byId.e1.probability) : 'missing');
  check('a real array outcomePrices is accepted too',
    byId.e2 && byId.e2.probability === 31, byId.e2 ? String(byId.e2.probability) : 'missing');
  check('a decimal 24h change becomes percentage points',
    byId.e1 && byId.e1.change === 4.2, byId.e1 ? String(byId.e1.change) : 'missing');
  check('a negative change survives',
    byId.e2 && byId.e2.change === -1.1, byId.e2 ? String(byId.e2.change) : 'missing');
  check('an event needs no price: probability is null, not a fabricated 0',
    byId.e3 && byId.e3.probability === null, byId.e3 ? String(byId.e3.probability) : 'missing');
  check('a multi-market event takes its number from the busiest sub-market',
    byId.e5 && byId.e5.probability === 55, byId.e5 ? String(byId.e5.probability) : 'missing');
  check('the outcome label is carried for the panel',
    byId.e1 && byId.e1.outcome === 'Yes', byId.e1 ? byId.e1.outcome : 'missing');
  check('a browser-checkable URL is built from the slug',
    byId.e1 && byId.e1.url === 'https://polymarket.com/event/btc-150k', byId.e1 ? byId.e1.url : 'missing');
  check('lifetime volume and liquidity are carried separately from 24h volume',
    byId.e1 && byId.e1.volume === 9000000 && byId.e1.liquidity === 250000,
    byId.e1 ? byId.e1.volume + '/' + byId.e1.liquidity : 'missing');

  /* ------------------------------------------------------ rows that must go */
  const goneIds = (b1 && b1.items ? b1.items.map((i) => i.id) : []);
  check('a settled row is excluded', goneIds.indexOf('e4') === -1, 'closed event');
  check('an inactive row is excluded', goneIds.indexOf('e7') === -1, 'active:false event');
  check('a row with no title is excluded', goneIds.indexOf('e6') === -1, 'titleless event');
  check('a whitespace-only title is excluded', goneIds.indexOf('e9') === -1, 'blank title');
  check('a null row does not break the batch', goneIds.length === 5, goneIds.join(','));

  /* ------------------------------------------------------- entity=markets */
  const r2 = await get('/predictions/api/polymarket?what=top&category=crypto&entity=markets&tagId=1&limit=5');
  const b2 = json(r2);
  check('entity=markets is served', r2.status === 200 && !!b2, 'HTTP ' + r2.status + ' ' + r2.body.slice(0, 80));
  check('rows come from `question` when fetching markets',
    !!b2 && b2.items[0] && b2.items[0].title === 'Will CPI come in under 3%?',
    b2 && b2.items[0] ? b2.items[0].title : '-');
  check('entity=markets ranks by 24h volume',
    !!b2 && b2.items.map((i) => i.id).join(',') === 'mk2,mk1',
    b2 ? b2.items.map((i) => i.id).join(',') : '-');
  const q2 = lastQueryFor('/markets');
  check('sort key for /markets is the OTHER documented spelling',
    !!q2 && q2.params.get('order') === 'volume24hr', q2 ? q2.query : 'never called');

  /* ------------------------------------------------------ slug, sortKey */
  await get('/predictions/api/polymarket?what=top&category=economy&entity=markets&tagSlug=economy&limit=2');
  const q3 = lastQueryFor('/markets');
  check('a slug binding is used when no tag id is known',
    !!q3 && q3.params.get('tag_slug') === 'economy' && q3.params.get('tag_id') === null,
    q3 ? q3.query : '-');
  check('a small limit is passed through', !!q3 && q3.params.get('limit') === '2', q3 ? q3.query : '-');

  await get('/predictions/api/polymarket?what=top&category=economy&entity=markets&tagSlug=economy&limit=999');
  const q3b = lastQueryFor('/markets');
  check('an absurd limit is clamped to 50', !!q3b && q3b.params.get('limit') === '50', q3b ? q3b.query : '-');

  await get('/predictions/api/polymarket?what=top&category=economy&entity=markets&tagSlug=economy&limit=0');
  const q3c = lastQueryFor('/markets');
  check('a zero limit is clamped to 1', !!q3c && q3c.params.get('limit') === '1', q3c ? q3c.query : '-');

  await get('/predictions/api/polymarket?what=top&category=finance&entity=events&tagId=1&limit=5&sortKey=liquidity');
  const q4 = lastQueryFor('/events');
  check('a configured sortKey overrides the derived spelling',
    !!q4 && q4.params.get('order') === 'liquidity', q4 ? q4.query : '-');

  /* ------------------------------------------- bindings refuse to be wrong */
  const rNoTag = await get('/predictions/api/polymarket?what=top&category=crypto&entity=events&limit=5');
  const bNoTag = json(rNoTag);
  check('a category with no tag binding is refused, not fetched as a global top',
    rNoTag.status === 400 && !!bNoTag && bNoTag.error.code === 'missing_query_binding',
    'HTTP ' + rNoTag.status + ' ' + (bNoTag && bNoTag.error ? bNoTag.error.code : rNoTag.body.slice(0, 60)));

  for (const bad of ['1%20OR%201%3D1', '../../../etc/passwd', 'https://evil.example', 'x'.repeat(200)]) {
    const r = await get('/predictions/api/polymarket?what=top&category=crypto&entity=events&tagId=' + bad + '&limit=5');
    check('an unusable tag binding is refused: ' + bad.slice(0, 22),
      r.status === 400, 'HTTP ' + r.status);
  }
  const rBadEntity = await get('/predictions/api/polymarket?what=top&category=crypto&entity=../secret&tagId=1&limit=5');
  const qBadEntity = lastQueryFor('/events');
  check('an unknown entity falls back to events instead of reaching the URL',
    rBadEntity.status === 200 && !!qBadEntity, 'HTTP ' + rBadEntity.status);

  /* -------------------------------------------------------------- failures */
  const r404 = await get('/predictions/api/polymarket?what=top&category=crypto&entity=events&tagId=999&limit=5');
  const b404 = json(r404);
  /* a 404 is preserved rather than flattened to 400: "this tag does not exist"
     is a different thing to tell an operator than "your request was malformed" */
  check('an upstream 404 is reported as a 404, not retried or blanked',
    r404.status === 404 && !!b404 && b404.error.code === 'upstream_client_error',
    'HTTP ' + r404.status + ' ' + (b404 && b404.error ? b404.error.code : ''));
  const rEmpty = await get('/predictions/api/polymarket?what=top&category=crypto&entity=events&tagId=997&limit=5');
  const bEmpty = json(rEmpty);
  check('an empty upstream payload is an error, not a silently empty board',
    rEmpty.status === 502 && !!bEmpty && bEmpty.error.code === 'upstream_bad_payload' &&
    /no open events/.test(bEmpty.error.message),
    'HTTP ' + rEmpty.status + ' ' + (bEmpty && bEmpty.error ? bEmpty.error.message : ''));
  const rErr = await get('/predictions/api/polymarket?what=top&category=crypto&entity=events&tagId=996&limit=5');
  const bErr = json(rErr);
  check('an upstream error object is surfaced verbatim',
    rErr.status === 502 && !!bErr && /maintenance/.test(bErr.error.message),
    'HTTP ' + rErr.status + ' ' + (bErr && bErr.error ? bErr.error.message : ''));
  check('a failed fetch says when to retry', r404.headers['retry-after'] === '30',
    'Retry-After=' + r404.headers['retry-after']);

  /* ------------------------------------------------------------- the cache */
  const c1 = await get(TOP);
  check('a repeat request is served from cache', c1.headers['x-cache'] === 'HIT',
    'X-Cache=' + c1.headers['x-cache'] + ' age=' + c1.headers['x-cache-age']);
  check('the cached body is identical', c1.body === r1.body, c1.body.length + ' bytes');

  /* ------------------------------------------------------------------ tags */
  const rTags = await get('/predictions/api/polymarket?what=tags');
  const bTags = json(rTags);
  check('the tag list is proxied', rTags.status === 200 && !!bTags && bTags.what === 'tags',
    'HTTP ' + rTags.status + ' ' + rTags.body.slice(0, 70));
  check('tags are normalised to id/label/slug and sorted',
    !!bTags && bTags.tags.length === 4 && bTags.tags[0].label === 'Crypto' &&
    bTags.tags.map((t) => t.label).join(',') === 'Crypto,Economy,Finance,Politics',
    bTags ? bTags.tags.map((t) => t.label).join(',') : '-');
  check('the tag ids are strings, so they survive a config round-trip',
    !!bTags && bTags.tags.every((t) => typeof t.id === 'string'), 'e.g. ' + (bTags ? JSON.stringify(bTags.tags[0]) : '-'));

  /* ------------------------------------------------- the overlay still works */
  const page = await get('/predictions/index.html');
  check('the overlay is still served alongside the proxy', page.status === 200 && /Prediction Markets/.test(page.body),
    'HTTP ' + page.status);

  finish();
})();
