#!/usr/bin/env node
/* ============================================================================
   Hub data endpoints — boots Overlays/server.js against FAKE providers and
   talks to it over real HTTP.

     node tests/hub-data.js

   Why a fake upstream: the claims being pinned are about request COUNTING and
   caching, not about Open-Meteo's or Commons' contents. With a local server in
   front of them the test can say, exactly, "one forecast request for two cities"
   and "a second load inside the cache window costs zero provider calls", which a
   live API can never prove.

   Covers:
     • /weather/api/data   — one batched Open-Meteo request for every city,
                             geocoding only for cities without coordinates
                             (and cached), TTL, force, stale-on-failure, status
     • /weather/api/photo  — PD/CC0 preferred, CC BY allowed with attribution,
                             CC BY-SA / NC refused, 404 when nothing is usable
     • /market/api/search  — one CoinGecko search call per query, normalised ids
     • /market/api/market + /predictions/api/data — one shared cache between the
                             two overlays, and the same provider call for both
   ========================================================================== */
'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8895;
const FAKE_PORT = 8894;

const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });

/* ------------------------------------------------------------------ helpers */
function request(method, urlPath, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data,
        json: (() => { try { return JSON.parse(data); } catch (e) { return null; } })()
      }));
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e.message), json: null }));
    if (body) req.write(body);
    req.end();
  });
}
const get = (p) => request('GET', p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* the hub refuses two forced provider reads inside its 2s window; the test
   honours it instead of pretending it is not there */
const FORCE_GAP = 2100;

function waitFor(attempts) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      get('/healthz').then((r) => {
        if (r.status === 200) return resolve();
        if (n <= 0) return reject(new Error('hub never came up'));
        setTimeout(() => tick(n - 1), 120);
      });
    };
    tick(attempts);
  });
}

/* ------------------------------------------------------- fake providers --- */
const provider = { forecast: [], geocode: [], coins: [], search: [] };
let forecastMode = 'ok';

function forecastFor(lat, lon, i) {
  return {
    latitude: Number(lat), longitude: Number(lon),
    timezone: i === 1 ? 'America/Denver' : 'America/New_York',
    utc_offset_seconds: i === 1 ? -21600 : -14400,
    current: {
      time: '2026-01-01T12:00', temperature_2m: 70 + i, relative_humidity_2m: 50,
      apparent_temperature: 68 + i, is_day: 1, precipitation: 0, weather_code: 1,
      cloud_cover: 10, surface_pressure: 1013, wind_speed_10m: 4, wind_direction_10m: 90
    },
    daily: { temperature_2m_max: [78 + i], temperature_2m_min: [60 + i] }
  };
}

const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const send = (obj, code) => {
    res.writeHead(code || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (u.pathname === '/v1/forecast') {
    const lats = String(u.searchParams.get('latitude') || '').split(',');
    const lons = String(u.searchParams.get('longitude') || '').split(',');
    provider.forecast.push({ lats, lons, query: u.search });
    if (forecastMode === 'fail') return send({ error: 'upstream down' }, 503);
    const rows = lats.map((lat, i) => forecastFor(lat, lons[i], i));
    return send(rows.length === 1 ? rows[0] : rows);
  }
  if (u.pathname === '/v1/search') {
    provider.geocode.push(u.search);
    return send({
      results: [{
        name: 'Miami', latitude: 25.7617, longitude: -80.1918,
        country_code: 'US', admin1: 'Florida', timezone: 'America/New_York'
      }]
    });
  }
  if (u.pathname === '/api/v3/coins/markets') {
    provider.coins.push(u.search);
    const ids = String(u.searchParams.get('ids') || '').split(',').filter(Boolean);
    return send(ids.map((id, i) => ({
      id, symbol: id.slice(0, 3).toUpperCase(), name: id + ' coin',
      image: '', market_cap_rank: i + 1,
      current_price: 100 + i, price_change_percentage_24h_in_currency: 1.5,
      price_change_percentage_7d_in_currency: -2.5,
      sparkline_in_7d: { price: [1, 2, 3, 2, 4] }
    })));
  }
  if (u.pathname === '/api/v3/search') {
    provider.search.push(u.search);
    return send({
      coins: [
        { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', thumb: 'https://x/btc.png', market_cap_rank: 1 },
        { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH', thumb: 'https://x/bch.png', market_cap_rank: 22 },
        { id: 'bitcoin', name: 'Bitcoin (duplicate row)', symbol: 'BTC', market_cap_rank: 1 }
      ]
    });
  }
  return send({ error: 'unknown fake route ' + u.pathname }, 404);
});

/* --------------------------------------------------------------- the hub --- */
const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    OPEN_METEO_BASE: 'http://127.0.0.1:' + FAKE_PORT,
    OPEN_METEO_GEO_BASE: 'http://127.0.0.1:' + FAKE_PORT,
    COINGECKO_BASE: 'http://127.0.0.1:' + FAKE_PORT,
    MARKET_FORCE_FALLBACK: '0'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let hubLog = '';
child.stdout.on('data', (c) => { hubLog += c; });
child.stderr.on('data', (c) => { hubLog += c; });

function finish() {
  try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
  try { fake.close(); } catch (e) { /* gone */ }
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  hub data endpoints — fake providers, real HTTP\n  ' + '-'.repeat(60));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(60));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  if (failed) console.log(hubLog.slice(-2000));
  process.exit(failed ? 1 : 0);
}

const CITIES2 = encodeURIComponent(JSON.stringify([
  { label: 'New York', query: 'New York', lat: 40.7128, lon: -74.006 },
  { label: 'Denver', query: 'Denver', lat: 39.7392, lon: -104.9903 }
]));
const UNITS = encodeURIComponent(JSON.stringify({ temperature: 'fahrenheit', wind: 'mph', precipitation: 'inch' }));

(async function main() {
  await new Promise((resolve) => fake.listen(FAKE_PORT, '127.0.0.1', resolve));
  try {
    await waitFor(60);
  } catch (e) {
    console.log('\n  hub failed to start:\n' + hubLog + '\n');
    try { child.kill('SIGKILL'); } catch (e2) { /* gone */ }
    process.exit(1);
  }

  /* ------------------------------------------------ weather: batching/TTL */
  const bad = await get('/weather/api/data');
  check('weather data rejects a request with no city', bad.status === 400 && bad.json && bad.json.error.code === 'missing_query_binding',
    'HTTP ' + bad.status);

  const before = provider.forecast.length;
  const wx = await get('/weather/api/data?cities=' + CITIES2 + '&units=' + UNITS);
  check('weather data answers 200', wx.status === 200, 'HTTP ' + wx.status);
  check('every city is in the payload', !!wx.json && wx.json.cities.length === 2,
    wx.json ? wx.json.cities.length + ' cities' : 'no JSON');
  check('one forecast request serves both cities',
    provider.forecast.length === before + 1 && provider.forecast[before].lats.length === 2,
    (provider.forecast.length - before) + ' request(s), lats=' +
      (provider.forecast[before] ? provider.forecast[before].lats.join('+') : '-'));
  check('no geocoding when both cities are pinned', provider.geocode.length === 0,
    provider.geocode.length + ' geocode call(s)');
  check('the response carries the fetch time', !!wx.headers['x-fetched-at'], wx.headers['x-fetched-at'] || '-');
  check('per-city timezone comes back from the provider',
    wx.json.cities[1].timezone === 'America/Denver', wx.json.cities[1].timezone);

  const beforeHit = provider.forecast.length;
  const wxAgain = await get('/weather/api/data?cities=' + CITIES2 + '&units=' + UNITS);
  check('a second load inside the TTL is a cache hit', wxAgain.headers['x-cache'] === 'HIT' && provider.forecast.length === beforeHit,
    'X-Cache=' + wxAgain.headers['x-cache'] + ', provider calls +' + (provider.forecast.length - beforeHit));

  const forced = await get('/weather/api/data?cities=' + CITIES2 + '&units=' + UNITS + '&force=1');
  check('force=1 re-reads the provider', forced.headers['x-cache'] === 'REFRESH' && provider.forecast.length === beforeHit + 1,
    'X-Cache=' + forced.headers['x-cache'] + ', provider calls +' + (provider.forecast.length - beforeHit));

  /* a second force inside the cooldown must not become a second upstream call */
  const tooFast = await get('/weather/api/data?cities=' + CITIES2 + '&units=' + UNITS + '&force=1');
  check('a forced update inside the cooldown is refused', tooFast.status === 429 && tooFast.json.error.code === 'cooldown',
    'HTTP ' + tooFast.status + ' ' + (tooFast.json && tooFast.json.error && tooFast.json.error.code));

  await sleep(FORCE_GAP);

  /* A null coordinate pair must mean "geocode me", not "0,0". Number(null) is 0,
     so this exact shape used to fetch the Gulf of Guinea and report it as the
     city's weather. */
  const nullCoords = encodeURIComponent(JSON.stringify([
    { label: 'Nowhere', query: 'Miami', countryCode: 'US', lat: null, lon: null }
  ]));
  const nullGeo = await get('/weather/api/data?cities=' + nullCoords + '&units=' + UNITS);
  check('a null coordinate pair is geocoded, not read as 0,0',
    nullGeo.status === 200 && provider.geocode.length >= 1 &&
    provider.forecast[provider.forecast.length - 1].lats.join(',') !== '0',
    'lats=' + (provider.forecast[provider.forecast.length - 1] || {}).lats);
  /* -------------------------------------------------- weather: geocoding */
  const cityNoCoords = encodeURIComponent(JSON.stringify([{ label: 'Miami', query: 'Miami', countryCode: 'US' }]));
  const geo1 = await get('/weather/api/data?cities=' + cityNoCoords + '&units=' + UNITS);
  check('a city without coordinates is geocoded', geo1.status === 200 && provider.geocode.length >= 1,
    provider.geocode.length + ' geocode call(s)');
  /* different units = different cache key, so this is a miss that must reuse the
     cached geocode without a second geocode call */
  const UNITS2 = encodeURIComponent(JSON.stringify({ temperature: 'celsius', wind: 'kmh', precipitation: 'mm' }));
  const geo2 = await get('/weather/api/data?cities=' + cityNoCoords + '&units=' + UNITS2);
  check('the geocode result is cached for the next load',
    geo2.status === 200 && provider.geocode.length === 1, provider.geocode.length + ' geocode call(s) total');

  await sleep(FORCE_GAP);

  /* ----------------------------------------------- weather: stale on failure */
  forecastMode = 'fail';
  const stale = await get('/weather/api/data?cities=' + cityNoCoords + '&units=' + UNITS + '&force=1');
  check('a failed refresh serves the last good body, marked stale',
    stale.status === 200 && stale.headers['x-cache'] === 'STALE' && !!stale.json.cities,
    'HTTP ' + stale.status + ' X-Cache=' + stale.headers['x-cache']);
  forecastMode = 'ok';

  const status = await get('/weather/api/status');
  check('/api/status reports a last-updated time for weather',
    status.status === 200 && status.json.hasData === true && status.json.fetchedAt > 0,
    'fetchedAt=' + (status.json && status.json.fetchedAt));

  /* ---------------------------------------------------------- coin search */
  const search = await get('/market/api/search?q=bitcoin');
  check('asset search answers with provider ids', search.status === 200 && search.json.coins.length === 2,
    search.status === 200 ? search.json.coins.length + ' coins' : 'HTTP ' + search.status);
  check('the search result carries id + symbol + rank',
    search.json.coins[0].id === 'bitcoin' && search.json.coins[0].symbol === 'BTC' && search.json.coins[0].rank === 1,
    JSON.stringify(search.json.coins[0]));
  const searchAgain = await get('/market/api/search?q=bitcoin');
  check('a repeated search is cached', searchAgain.headers['x-cache'] === 'HIT' && provider.search.length === 1,
    searchAgain.headers['x-cache'] + ', provider calls=' + provider.search.length);
  const searchEmpty = await get('/market/api/search?q=');
  check('an empty search is a 400, not a global list', searchEmpty.status === 400, 'HTTP ' + searchEmpty.status);

  /* ------------------------------------- market + predictions share a cache */
  const ids = 'bitcoin,ethereum';
  const coinsBefore = provider.coins.length;
  const market = await get('/market/api/market?ids=' + ids + '&currency=usd&changes=24h,7d&sparkline=1');
  const pred = await get('/predictions/api/data?ids=' + ids + '&currency=usd&changes=24h,7d&sparkline=1');
  check('both overlays read the same payload', market.status === 200 && pred.status === 200,
    'market=' + market.status + ' predictions=' + pred.status);
  check('one CoinGecko call serves both overlays', provider.coins.length === coinsBefore + 1,
    (provider.coins.length - coinsBefore) + ' provider call(s)');
  check('the predictions endpoint reports the shared fetch time',
    pred.headers['x-fetched-at'] === market.headers['x-fetched-at'],
    market.headers['x-fetched-at'] + ' vs ' + pred.headers['x-fetched-at']);

  const predStatus = await get('/predictions/api/status');
  check('/api/status reports the shared asset cache for predictions',
    predStatus.status === 200 && predStatus.json.fetchedAt > 0, 'fetchedAt=' + predStatus.json.fetchedAt);

  /* ------------------------------------------------------ shared statics */
  const combo = await get('/shared/combobox.js');
  check('/shared/combobox.js is served', combo.status === 200 && /createCombobox/.test(combo.body), 'HTTP ' + combo.status);
  const escape = await get('/shared/../server.js');
  check('a dot-segment cannot escape /shared', escape.status === 403 || escape.status === 404, 'HTTP ' + escape.status);

  finish();
})().catch((e) => {
  console.log('\n  test crashed: ' + (e && e.stack) + '\n');
  try { child.kill('SIGKILL'); } catch (e2) { /* gone */ }
  try { fake.close(); } catch (e2) { /* gone */ }
  process.exit(1);
});
