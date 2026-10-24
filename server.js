#!/usr/bin/env node
/* ============================================================================
   The Rollup overlays hub — one server for every overlay
   ----------------------------------------------------------------------------
   Start this ONCE and every overlay is live:

     node server.js            → hub at http://localhost:8790
     PORT=9000 node server.js  → custom primary port
     LEGACY=1 node server.js   → also listen on the old per-app ports

   Ports
     8790  (PORT)  the hub. Serves everything under a path prefix:
                     /              hub page — links to every overlay
                     /weather/…     Vertical Weather overlay + admin + API
                     /topics/…      Talking Points overlay + admin + API
                     /market/…      Digital Assets Market overlay + admin + API
                                     + /api/market   (cached CoinGecko proxy)
                      /predictions/… Prediction Markets overlay + admin + API
                                     + /api/polymarket (cached Polymarket proxy)
                     /healthz       JSON status
     (with LEGACY=1 each app is also served at the root of its own port:
      8788 weather · 8787 topics · 8789 market · 8791 predictions — see below)

   The legacy ports (8788 weather, 8787 topics, 8789 market, 8791 predictions) are
   OFF by default. They exist only for an OBS source already pointed at a per-app
   URL before the projects were fused. Nothing in this repo points at them.
   Weather, topics and predictions each still ship a standalone server.js that
   binds their own port, so leaving those legacy listeners on alongside one of
   those invites a clash; the market board has no standalone server and is only
   ever served by this process.

   The Polymarket proxy is hub-only for the same reason: the app servers carry no
   upstream machinery, and the prediction panel says so plainly if it is opened
   from one of them instead.

   Every client URL in each overlay is relative (script.js, api/config,
   config.json), so serving them under a prefix needs no changes to any of them.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = __dirname;
/* Each overlay lives in a subfolder of this one. Keeping them under the server
   rather than beside it means the whole suite is one self-contained folder —
   copy it anywhere and nothing breaks. */


/* ------------------------------------------------------------------- config */
function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  return fallback;
}

const PORT = parseInt(arg('port', process.env.PORT || '8790'), 10);
/* Off by default. The legacy ports existed to avoid re-wiring OBS browser
   sources already pointed at 8787/8788/8789 — but the target machine is a clean
   Windows box whose sources are built from the hub's URLs, and each app still
   ships its own standalone server.js that binds those ports. Two things
   fighting over the same port is a worse default than none. LEGACY=1 opts in. */
const LEGACY = arg('legacy', process.env.LEGACY || '0') !== '0';

/* Each app keeps its own directory, config.json, state.json and action list —
   fusing the servers must not fuse the state of two unrelated overlays. */
/* ---------------------------------------------------------------------------
   Fallback provider for the market board.

   CoinGecko's free tier rate-limits hard (a 429 is easy to hit by hand), so the
   proxy falls back to CoinPaprika, which is also free and key-less. Its ids are
   different — "btc-bitcoin" rather than "bitcoin" — so the mapping is explicit
   rather than guessed from ticker symbols, which collide across exchanges.

   CoinPaprika publishes no logos on this endpoint, so the board degrades to
   ticker initials and loses its sparkline for the duration of an outage. That
   is the honest trade: correct prices with less decoration, not a stale board.
   --------------------------------------------------------------------------- */
const COINPAPRIKA_IDS = {
    "bitcoin": "btc-bitcoin", "ethereum": "eth-ethereum", "solana": "sol-solana",
    "binancecoin": "bnb-binance-coin", "ripple": "xrp-xrp", "dogecoin": "doge-dogecoin",
    "cardano": "ada-cardano", "avalanche-2": "avax-avalanche", "chainlink": "link-chainlink",
    "the-open-network": "ton-tontoken", "near": "near-near-protocol", "fetch-ai": "fetch-ai",
    "render-token": "rndr-render-token", "bittensor": "tao-bittensor", "the-graph": "grt-the-graph",
    "virtual-protocol": "virtual-virtual-protocol", "uniswap": "uni-uniswap", "aave": "aave-new",
    "maker": "mkr-maker", "curve-dao-token": "crv-curve-dao-token", "lido-dao": "ldo-lido-dao",
    "hyperliquid": "hype-hyperliquid", "frax": "frax-frax", "pendle": "pendle-pendle",
    "monero": "xmr-monero", "zcash": "zec-zcash", "dash": "dash-dash",
    "secret": "scrt-secret", "oasis-network": "rose-oasis-network", "zcoin": "firo-firo",
    "litecoin": "ltc-litecoin", "bitcoin-cash": "bch-bitcoin-cash", "ethereum-classic": "etc-ethereum-classic",
    "stellar": "xlm-stellar", "tron": "trx-tron", "neo": "neo-neo",
    "eos": "eos-eos", "iota": "miota-iota", "algorand": "algo-algorand",
    "vechain": "vet-vechain",
    /* coins the board currently ships that CoinPaprika names differently */
    "zama": "zama-zama", "arcium": "arx-arcium", "lighter": "lit-lighter",
    "pump-fun": "pump-pumpfun", "aerodrome-finance": "aero-aerodrome-finance",
    "derive": "drv7-derive", "arbitrum": "arb-arbitrum", "ether-fi": "ethfi-etherfi",
    "akash-network": "akt-akash-network", "pha": "pha-phala-network",
    "sky": "sky-sky", "syrup": "syrup-syrup-token", "morpho": "morpho-morpho"
};

/* Reshape a CoinPaprika ticker list into CoinGecko's /coins/markets format, so
   the overlay needs no knowledge of which provider answered. */
function normaliseCoinPaprika(raw, params) {
  const wanted = (params.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const byId = {};
  (Array.isArray(raw) ? raw : []).forEach((t) => { byId[t.id] = t; });

  return wanted.map((cgId) => {
    const cpId = COINPAPRIKA_IDS[cgId];
    const t = cpId ? byId[cpId] : null;
    if (!t) return null;
    const q = (t.quotes && t.quotes.USD) || {};
    return {
      id: cgId,                        /* keep the caller's id, not CoinPaprika's */
      symbol: (t.symbol || "").toUpperCase(),
      name: t.name || cgId,
      image: "",                       /* not published on this endpoint */
      market_cap_rank: t.rank || null,
      current_price: q.price != null ? q.price : null,
      price_change_percentage_24h_in_currency:
        q.percent_change_24h != null ? q.percent_change_24h : null,
      price_change_percentage_7d_in_currency:
        q.percent_change_7d != null ? q.percent_change_7d : null,
      sparkline_in_7d: null            /* not published on this endpoint */
    };
  }).filter(Boolean);
}

/* ---------------------------------------------------------------------------
   Polymarket (Gamma API) → the rows the prediction board renders.

   Gamma is two endpoints in one trench coat: /events returns headline entities
   that CONTAIN their markets, /markets returns those markets directly. The two
   also disagree about the sort-key spelling (volume_24hr vs volume24hr), which
   is why the URL builder picks per entity and a config override exists.

   Everything below is deliberately defensive. Only the published documentation
   could be used to write it: the machine this was built on cannot reach
   polymarket.com at all — the local ISP filter resets the TLS handshake, and
   http:// on port 80 answers with a redirect to the national gambling
   regulator — so no live Gamma response has ever been observed. Therefore:
   where a field could plausibly be spelled two ways, both are accepted; where a
   field is absent it is omitted rather than invented; and a payload that yields
   nothing usable is reported as an error rather than rendering an empty board.
   --------------------------------------------------------------------------- */
const POLYMARKET_API_BASE = process.env.POLYMARKET_API_BASE || 'https://gamma-api.polymarket.com';

const POLY_ENTITIES = ['events', 'markets'];
/* Documented spellings, per endpoint — overridable from config for the same
   reason the whole adapter is hedged: it has never been exercised. */
const POLY_SORT_KEY = { events: 'volume_24hr', markets: 'volume24hr' };

function polyNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.eE+-]/g, ''));
  return isFinite(n) ? n : null;
}
function polyFirstNum() {
  for (let i = 0; i < arguments.length; i++) {
    const n = polyNum(arguments[i]);
    if (n !== null) return n;
  }
  return null;
}
/* Gamma returns several arrays as JSON-encoded STRINGS ("[\"Yes\", \"No\"]"),
   but a cached page or a future version may hand back a real array, and a
   comma-joined string is the other plausible shape. Accept all three. */
function polyArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (s.charAt(0) === '[') {
    try { const j = JSON.parse(s); return Array.isArray(j) ? j : null; } catch (e) { return null; }
  }
  return s.indexOf(',') === -1 ? [s] : s.split(',').map((x) => x.trim()).filter(Boolean);
}
function clampInt(raw, lo, hi, fallback) {
  const n = parseInt(raw, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
/* A tag binding is either a numeric id or a slug. Anything else is refused
   rather than interpolated into an upstream URL. */
function polyTagBinding(idRaw, slugRaw) {
  const id = String(idRaw == null ? '' : idRaw).trim();
  if (/^\d+$/.test(id)) return { key: 'tag_id', value: id };
  const slug = String(slugRaw == null ? '' : slugRaw).trim();
  if (/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug)) return { key: 'tag_slug', value: slug };
  return null;
}

/* One event or market → one board row. Returns null for anything unusable. */
function polyItem(raw, entity) {
  if (!raw || typeof raw !== 'object') return null;
  /* the query asks for open markets, but a cached or proxied page can still
     hand back a settled one, and a settled headline is not a headline */
  if (raw.closed === true || raw.closed === 'true') return null;
  if (raw.active === false || raw.active === 'false') return null;

  const title = String(raw.title || raw.question || '').trim();
  if (!title) return null;

  /* A multi-market event carries its own rows. The headline's number belongs to
     the market with the most 24h volume — the one a reader means when they say
     "the odds on this question". */
  const markets = (Array.isArray(raw.markets) ? raw.markets : []).filter((m) => m && typeof m === 'object');
  let lead = null;
  markets.forEach((m) => {
    if (!lead || (polyNum(m.volume24hr) || 0) > (polyNum(lead.volume24hr) || 0)) lead = m;
  });
  const priceSrc = (raw.outcomePrices != null || raw.lastTradePrice != null) ? raw : lead;

  let probability = null;
  if (priceSrc) {
    const prices = polyArray(priceSrc.outcomePrices);
    if (prices && prices.length) probability = polyNum(prices[0]);
    if (probability === null) probability = polyFirstNum(priceSrc.lastTradePrice, priceSrc.bestAsk, priceSrc.bestBid);
  }
  /* For a binary market the YES price IS the probability: 0.68 → 68%. */
  if (probability !== null) probability = Math.round(probability * 1000) / 10;

  /* oneDayPriceChange is a decimal delta, so ×100 turns it into the percentage
     POINTS the board prints (0.042 → 4.2 pts). */
  let change = polyFirstNum(raw.oneDayPriceChange, raw.one_day_price_change,
    priceSrc && polyFirstNum(priceSrc.oneDayPriceChange));
  if (change !== null) change = Math.round(change * 1000) / 10;

  const volume24hr = polyFirstNum(raw.volume24hr, raw.volume_24hr, raw.volume24hrClob, lead && lead.volume24hr);
  const volume = polyFirstNum(raw.volumeNum, raw.volume, lead && polyFirstNum(lead.volumeNum, lead.volume));
  const liquidity = polyFirstNum(raw.liquidityNum, raw.liquidity, lead && polyFirstNum(lead.liquidityNum, lead.liquidity));
  const slug = String(raw.slug || (lead && lead.slug) || '');
  const outcomes = polyArray((priceSrc && priceSrc.outcomes) || raw.outcomes);

  return {
    id: String(raw.id != null ? raw.id : (raw.conditionId || raw.condition_id || slug || title)),
    title: title,
    slug: slug,
    /* the board does not link anywhere, but a slug is what an operator pastes
       into a browser to check a headline, so the URL is built here */
    url: slug ? 'https://polymarket.com/' + (entity === 'events' ? 'event/' : 'market/') + slug : '',
    probability: probability,
    change: change,
    volume24hr: volume24hr,
    volume: volume,
    liquidity: liquidity,
    endDate: String(raw.endDate || raw.end_date || (lead && (lead.endDate || lead.end_date)) || ''),
    image: String(raw.image || raw.icon || (lead && (lead.image || lead.icon)) || ''),
    outcome: outcomes && outcomes.length ? String(outcomes[0]) : '',
    entity: entity
  };
}

/* Reshape a Gamma payload into the one shape the overlay understands, so the
   board needs no knowledge of Gamma's field names. Throws on a payload that
   cannot produce a board — the proxy turns that into a reported error. */
function normalisePolymarket(body, params) {
  const what = params.get('what') || 'top';
  let parsed;
  try { parsed = JSON.parse(body); } catch (e) { throw new Error('Polymarket did not return JSON'); }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
    throw new Error('Polymarket returned an error: ' + JSON.stringify(parsed.error).slice(0, 200));
  }

  if (what === 'tags') {
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.tags) ? parsed.tags : []);
    const tags = list.map((t) => {
      if (!t || typeof t !== 'object') return null;
      const label = String(t.label || t.name || t.tag || '').trim();
      if (!label) return null;
      return { id: String(t.id != null ? t.id : ''), label: label, slug: String(t.slug || '') };
    }).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label));
    if (!tags.length) throw new Error('Polymarket returned an empty tag list');
    /* The full tag list is thousands of entries; the panel only ever searches it,
       so the response is capped to keep it from being a multi-megabyte payload
       handed to a browser. */
    return JSON.stringify({ what: 'tags', total: tags.length, tags: tags.slice(0, 4000) });
  }

  const entity = POLY_ENTITIES.indexOf(params.get('entity')) === -1 ? 'events' : params.get('entity');
  const limit = clampInt(params.get('limit'), 1, 50, 5);
  const list = Array.isArray(parsed) ? parsed : [];
  const items = list.map((r) => polyItem(r, entity)).filter(Boolean);

  /* Rank by 24h volume HERE instead of trusting the upstream to have honoured its
     `order` parameter. "The best 5" is the one guarantee the whole feature rests
     on, and it must not depend on a parameter spelling that could not be
     verified against the live API. Ties keep the upstream's relative order,
     which is why this is a stable sort on a key that is often equal. */
  items.sort((a, b) => {
    const av = a.volume24hr === null || a.volume24hr === undefined ? -1 : a.volume24hr;
    const bv = b.volume24hr === null || b.volume24hr === undefined ? -1 : b.volume24hr;
    return bv - av;
  });
  const top = items.slice(0, limit);

  if (!top.length) {
    throw new Error('Polymarket returned no open ' + entity + ' for tag ' +
      ((polyTagBinding(params.get('tagId'), params.get('tagSlug')) || {}).value || '(none)'));
  }
  return JSON.stringify({
    what: 'top',
    category: String(params.get('category') || ''),
    entity: entity,
    fetchedAt: Date.now(),
    count: top.length,
    items: top
  });
}

const APPS = [
  {
    id: 'weather',
    name: 'Vertical Weather',
    tagline: 'Full-height 1080p glass widget · live Open-Meteo data',
    dir: path.join(BASE, 'weather'),
    legacyPort: 8788,
    actions: ['in', 'play', 'hide', 'out', 'refresh', 'update'],
    /* the weather server answers an unknown action with a 400 + `allowed`,
       which is what makes a Stream Deck key debuggable */
    strictActions: true,
    supportsIndex: false
  },
  {
    id: 'topics',
    name: 'Talking Points',
    tagline: 'Animated talking-points panel · entrance-only for OBS',
    dir: path.join(BASE, 'topics'),
    legacyPort: 8787,
    actions: ['in', 'out', 'replay'],
    strictActions: false,
    supportsIndex: true
  },
  {
    id: 'market',
    name: 'Digital Assets Market',
    tagline: 'Live crypto board · category tabs · seven-day trends',
    dir: path.join(BASE, 'market'),
    legacyPort: 8789,
    actions: ['in', 'hide', 'refresh', 'next', 'prev'],
    strictActions: false,
    supportsIndex: false,
    /* Cached upstream: CoinGecko's free tier rate-limits aggressively, so every
       browser source shares one call per window instead of polling the API. */
    upstream: {
      path: '/api/market',
      ttlMs: 60000,
      staleMs: 900000,
      timeoutMs: 12000,
      retries: 3,
      userAgent: 'obs-overlays/1.0 (digital assets board)',
      build: function (params) {
        var ids = params.get('ids') || '';
        var currency = params.get('currency') || 'usd';
        var changes = params.get('changes') || '24h,7d';
        var spark = params.get('sparkline') === '0' ? 'false' : 'true';
        return 'https://api.coingecko.com/api/v3/coins/markets' +
          '?vs_currency=' + encodeURIComponent(currency) +
          '&ids=' + encodeURIComponent(ids) +
          '&price_change_percentage=' + encodeURIComponent(changes) +
          '&sparkline=' + spark +
          '&order=market_cap_desc&per_page=250&page=1';
      },
      source: 'coingecko',
      /* Hold a fallback response a little longer than a primary one: CoinPaprika's
         bulk payload is ~1.6 MB, so re-pulling it every 60s through a long outage
         is wasteful. Kept short enough that a brief CoinGecko 429 still recovers
         within a minute and a half. */
      fallbackTtlMs: 90000,
      forceFallbackEnv: 'MARKET_FORCE_FALLBACK',
      /* used only when CoinGecko is down or rate-limiting us */
      fallback: {
        name: 'CoinPaprika',
        timeoutMs: 15000,
        retries: 1,
        /* The bulk list stops at the top ~2000 coins by rank, which covers most
           of the board but not all of it — Zama sits around rank 6300 and is
           simply absent from this payload. Anything the bulk list misses is
           therefore fetched one coin at a time below; without that, mapping such
           a coin had no effect and its row quietly emptied during an outage. */
        build: function () {
          return 'https://api.coinpaprika.com/v1/tickers?quotes=USD';
        },
        detail: {
          build: function (cpId) {
            return 'https://api.coinpaprika.com/v1/tickers/' + encodeURIComponent(cpId) + '?quotes=USD';
          },
          /* a bound, so a config full of obscure coins cannot turn one degraded
             refresh into a burst of requests */
          max: 6
        },
        normalise: normaliseCoinPaprika
      }
    }
  },
  {
    id: 'predictions',
    name: 'Prediction Markets',
    tagline: 'Polymarket headlines by category · or a hand-typed board · manual topic changes',
    dir: path.join(BASE, 'predictions'),
    legacyPort: 8791,
    /* next/prev step the hero market by hand — there is deliberately no timer
       and no auto-advance, so the board never changes under the operator */
    actions: ['in', 'out', 'replay', 'next', 'prev', 'show'],
    strictActions: false,
    supportsIndex: true,
    /* Polymarket headlines. The overlay never touches this: the CONTROL PANEL
       calls it when the operator presses Update, and writes what comes back
       into config.json, which the overlay already polls. So the fetch is
       operator-triggered by construction — there is no code path that could
       refresh the board on a timer. */
    upstream: {
      path: '/api/polymarket',
      ttlMs: 120000,
      staleMs: 900000,
      timeoutMs: 15000,
      retries: 2,
      userAgent: 'obs-overlays/1.0 (prediction headlines)',
      source: 'polymarket',
      missingBindingMessage: 'this category needs a Polymarket tag id or slug before it can be fetched',
      build: function (params) {
        var what = params.get('what') || 'top';
        if (what === 'tags') return POLYMARKET_API_BASE + '/tags';

        var entity = POLY_ENTITIES.indexOf(params.get('entity')) === -1 ? 'events' : params.get('entity');
        var bind = polyTagBinding(params.get('tagId'), params.get('tagSlug'));
        if (!bind) return null;      /* → 400 missing_query_binding, not a global top */

        var q = new URLSearchParams();
        q.set('limit', String(clampInt(params.get('limit'), 1, 50, 5)));
        q.set('offset', '0');
        q.set('active', 'true');
        q.set('closed', 'false');
        /* The two endpoints document different sort-key spellings, so the right
           one is picked per entity; config may override it verbatim. */
        var sortRaw = String(params.get('sortKey') || '');
        q.set('order', /^[a-z0-9_]{1,24}$/i.test(sortRaw) ? sortRaw : POLY_SORT_KEY[entity]);
        q.set('ascending', 'false');
        q.set(bind.key, bind.value);
        return POLYMARKET_API_BASE + '/' + entity + '?' + q.toString();
      },
      shape: normalisePolymarket
    }
  }
];

/* Ports are overridable so the test suite can run hermetically without
   fighting a already-running studio server for 8787/8788. */
APPS.forEach((a) => {
  a.prefix = '/' + a.id;
  const override = process.env['LEGACY_PORT_' + a.id.toUpperCase()];
  if (override) a.legacyPort = parseInt(override, 10);
});

/* --------------------------------------------------------------- utilities */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    /* lets the overlay read whether the proxy answered from cache or upstream */
    'Access-Control-Expose-Headers': 'X-Cache, X-Cache-Age, X-Upstream-Error, X-Source, X-Degraded, Retry-After',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function json(res, code, obj) {
  return send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/* Atomic write: the overlays poll their config file every couple of seconds, so
   a half-written config must never be observable. */
/* Atomic write: temp file then rename, so a poller never reads a half-written
   config. On Windows a rename over a file that another process holds open fails
   with EPERM/EBUSY/EACCES — an antivirus scanner, or our own read stream still
   draining a previous poll. Those are transient, so retry with real delays.
   The delay must yield to the event loop: spinning would block the read stream
   that is holding the lock, and every retry would fail. */
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'];

async function writeAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);

  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      lastErr = e;
      if (TRANSIENT.indexOf(e.code) === -1) break;
      await sleepMs(30 * (attempt + 1));
    }
  }

  /* Last resort: write in place. A reader could catch a partial file, but on
     air a save that silently does nothing is the worse failure. */
  try {
    fs.writeFileSync(file, text);
    try { fs.unlinkSync(tmp); } catch (e2) { /* already gone */ }
    console.warn('  [config] atomic rename failed (' + (lastErr && lastErr.code) +
      ') — wrote in place instead');
    return true;
  } catch (e3) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* already gone */ }
    throw e3;
  }
}

/* Resolve a URL path inside an app directory, refusing anything that escapes.
   A plain startsWith() is not enough: '/root/app' would also match
   '/root/app-secret'. Compare against the directory boundary.

   Dot-segments are refused outright. Each overlay vendors a `.skills/` tree of
   third-party reference documents that nothing loads at runtime, and these are
   plain files inside the app directory — so without this rule
   `/weather/.skills/hallmark/SKILL.md` was served like any other asset. Nothing
   an overlay actually requests has a leading dot, so the rule costs nothing. */
function resolveInside(root, urlPath) {
  const clean = urlPath.replace(/^\/+/, '');
  if (clean.split(/[\\/]+/).some((seg) => seg.charAt(0) === '.')) return null;
  const full = path.resolve(root, clean);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function appFiles(app) {
  return {
    config: path.join(app.dir, 'config.json'),
    state: path.join(app.dir, 'state.json')
  };
}

function readState(app, fallback) {
  try { return JSON.parse(fs.readFileSync(appFiles(app).state, 'utf8')); }
  catch (e) { return fallback; }
}

/* Shipped version straight out of the project's config.js — the hub shows it so
   you can tell at a glance whether a browser source is running a stale build. */
function shippedVersion(app) {
  try {
    const src = fs.readFileSync(path.join(app.dir, 'config.js'), 'utf8');
    const m = src.match(/version\s*:\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

function appStatus(app) {
  const files = appFiles(app);
  let savedVersion = null;
  try { savedVersion = (JSON.parse(fs.readFileSync(files.config, 'utf8')).meta || {}).version || null; }
  catch (e) { /* no saved config yet */ }
  return {
    id: app.id,
    name: app.name,
    tagline: app.tagline,
    shippedVersion: shippedVersion(app) || app.version || null,
    savedVersion,
    hasSavedConfig: fs.existsSync(files.config),
    actions: app.actions,
    prefix: app.prefix,
    command: app.prefix + '/api/command?action=' + app.actions[0],
    overlay: app.prefix + '/index.html',
    admin: app.hasAdmin === false ? null : app.prefix + '/admin.html',
    legacyPort: LEGACY ? app.legacyPort : null
  };
}

/* ---------------------------------------------------------------- upstream
   Cached, resilient proxy built from the api-integration skill. Every rule
   here came from a real 429 hit while developing this board:

     - retry 5xx / timeouts / 429 only, never 4xx (it fails identically)
     - exponential backoff WITH jitter, so a recovering upstream is not stampeded
     - honour Retry-After on 429 instead of guessing a delay
     - explicit timeout on every outbound call
     - one upstream call per window serves every browser source
     - stale-but-marked data beats an empty table on air
   ------------------------------------------------------------------------ */
function createUpstream(spec) {
  const cache = new Map();      /* query string -> { ts, body, source } */
  const inflight = new Map();   /* de-dupes a thundering herd of identical calls */

  function jitteredBackoff(attempt) {
    const base = Math.min(30000, 1000 * Math.pow(2, attempt));
    return Math.round(base / 2 + Math.random() * (base / 2));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function retryAfterMs(header) {
    if (!header) return null;
    const secs = parseFloat(header);
    if (isFinite(secs)) return Math.min(30000, Math.max(0, secs * 1000));
    const when = Date.parse(header);
    if (!isNaN(when)) return Math.min(30000, Math.max(0, when - Date.now()));
    return null;
  }

  function request(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json", "User-Agent": spec.userAgent || "obs-overlays/1.0" }
      }).then((r) => r.text().then((body) => ({
        status: r.status, body, retryAfter: r.headers.get("retry-after")
      }))).then(
        (out) => { clearTimeout(timer); resolve(out); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  async function load(url, retries, timeoutMs) {
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await request(url, timeoutMs);
        if (res.status === 200) return { ok: true, body: res.body };

        /* A 4xx that is not 429 is a client error. Retrying burns quota and
           hides the bug, so fail fast and say exactly what happened. */
        if (res.status !== 429 && res.status < 500) {
          return {
            ok: false, status: res.status === 404 ? 404 : 400,
            code: "upstream_client_error",
            message: "upstream rejected the request (HTTP " + res.status + ")"
          };
        }

        last = {
          code: res.status === 429 ? "upstream_rate_limited" : "upstream_error",
          message: "upstream HTTP " + res.status
        };
        if (attempt < retries) {
          const wait = retryAfterMs(res.retryAfter);
          await sleep(wait != null ? wait : jitteredBackoff(attempt));
        }
      } catch (e) {
        last = { code: "upstream_unreachable", message: "network/timeout: " + (e && e.message) };
        if (attempt < retries) await sleep(jitteredBackoff(attempt));
      }
    }
    return Object.assign({ ok: false, status: 502 },
      last || { code: "upstream_error", message: "upstream failed" });
  }

  /* Primary provider first, then the fallback. The fallback is reshaped into the
     primary's response format, so the client cannot tell the difference beyond
     the X-Source header — one less thing to keep in step. */
  /* The TTL depends on who answered: a degraded provider rarely changes fast
     enough to justify the same cadence, and its payloads can be far larger. */
  function ttlFor(entry) {
    const isFallback = entry && entry.source && entry.source !== (spec.source || "primary");
    return isFallback ? (spec.fallbackTtlMs || spec.ttlMs) : spec.ttlMs;
  }

  async function fetchData(params) {
    /* An env switch lets the fallback be exercised on demand, without editing
       the primary out. Set MARKET_FORCE_FALLBACK=1 to prove the whole path. */
    const forced = spec.forceFallbackEnv && process.env[spec.forceFallbackEnv] === "1";
    const url = forced ? null : spec.build(params);

    /* A provider whose URL depends on the request can refuse it (a category with
       no tag binding, say). Saying so beats fetching the wrong thing: without a
       tag filter the upstream would happily return its GLOBAL top, and every
       category would quietly render the same headlines. */
    if (!forced && !url) {
      return {
        ok: false, status: 400, code: "missing_query_binding",
        message: spec.missingBindingMessage || "the request is missing a filter the upstream requires"
      };
    }

    const primary = forced
      ? { ok: false, code: "forced_fallback",
          message: "primary skipped (" + spec.forceFallbackEnv + "=1)" }
      : await load(url, spec.retries, spec.timeoutMs);

    /* A 200 is not automatically usable. An optional shape() turns the provider's
       payload into what the client actually renders; a payload it cannot shape is
       a failure the caller must see, not a blank board. */
    if (primary.ok) {
      if (typeof spec.shape !== "function") return { ok: true, body: primary.body, source: spec.source || "primary" };
      try {
        return { ok: true, body: spec.shape(primary.body, params), source: spec.source || "primary" };
      } catch (e) {
        return {
          ok: false, status: 502, code: "upstream_bad_payload",
          message: (e && e.message) || "the upstream payload could not be read"
        };
      }
    }

    const fb = spec.fallback;
    if (!fb) return primary;

    console.log("  [upstream] " + (spec.source || "primary") + " failed (" +
      (primary.code || "error") + ") — trying " + fb.name);

    const alt = await load(fb.build(params),
      fb.retries == null ? 1 : fb.retries, fb.timeoutMs || spec.timeoutMs);

    if (!alt.ok) {
      /* Both are down. Report it as one condition with per-provider detail, so
         a caller can tell a rate-limit from a dead endpoint without parsing
         prose — the shape the api-integration guidance asks for. */
      return {
        ok: false,
        status: primary.status || 502,
        code: "providers_unavailable",
        message: "every market provider failed",
        details: [
          { provider: spec.source || "primary", code: primary.code || "error", message: primary.message },
          { provider: fb.name, code: alt.code || "error", message: alt.message }
        ]
      };
    }
    try {
      const parsed = JSON.parse(alt.body);
      const bulk = Array.isArray(parsed) ? parsed : [];
      let shaped = fb.normalise(bulk, params);

      /* Fill in whatever the bulk payload did not cover. CoinPaprika's list
         endpoint stops at the top ~2000 by rank, so a lower-ranked coin we ship
         would otherwise disappear from the board for the length of an outage —
         a silent hole in a category that nobody would attribute to the provider.
         One small request per missing coin, capped. */
      if (fb.detail) {
        const wantedIds = (params.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
        const got = {};
        shaped.forEach((c) => { got[c.id] = true; });
        const missing = wantedIds.filter((id) => !got[id] && COINPAPRIKA_IDS[id])
          .slice(0, fb.detail.max == null ? 5 : fb.detail.max);

        if (missing.length) {
          const extra = (await Promise.all(missing.map(function (id) {
            return load(fb.detail.build(COINPAPRIKA_IDS[id]),
              fb.retries == null ? 1 : fb.retries, fb.timeoutMs || spec.timeoutMs);
          }))).filter(function (r) { return r && r.ok; }).map(function (r) {
            try { return JSON.parse(r.body); } catch (e) { return null; }
          }).filter(Boolean);

          if (extra.length) {
            shaped = fb.normalise(bulk.concat(extra), params);
            console.log("  [upstream] " + fb.name + " bulk list missed " + missing.length +
              " coin(s) — filled " + extra.length + " individually (" + missing.join(", ") + ")");
          }
        }
      }

      if (!shaped.length) throw new Error("fallback returned no matching coins");
      return { ok: true, body: JSON.stringify(shaped), source: fb.name, degraded: true };
    } catch (e) {
      return Object.assign({}, primary, {
        code: "fallback_bad_payload",
        message: "fallback " + fb.name + " returned an unusable payload: " + (e && e.message)
      });
    }
  }

  return async function upstreamHandler(req, res, parsed) {
    const key = parsed.search || "";
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttlFor(hit)) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Cache-Age", Math.round((Date.now() - hit.ts) / 1000) + "s");
      res.setHeader("X-Source", hit.source || "primary");
      return send(res, 200, hit.body, "application/json; charset=utf-8");
    }

    if (!inflight.has(key)) inflight.set(key, fetchData(parsed.searchParams));
    const out = await inflight.get(key);
    inflight.delete(key);

    if (out.ok) {
      cache.set(key, { ts: Date.now(), body: out.body, source: out.source });
      res.setHeader("X-Cache", "MISS");
      res.setHeader("X-Source", out.source || "primary");
      if (out.degraded) {
        res.setHeader("X-Degraded", "1");
        console.log("  [upstream] served by fallback (" + out.source + "), cached for " +
          Math.round(ttlFor({ source: out.source }) / 1000) + "s");
      }
      return send(res, 200, out.body, "application/json; charset=utf-8");
    }

    /* Stale beats broken: a board showing prices a minute old with a "cached"
       badge is far more useful on air than an empty table. */
    if (hit && Date.now() - hit.ts < spec.staleMs) {
      res.setHeader("X-Cache", "STALE");
      res.setHeader("X-Source", hit.source || "primary");
      res.setHeader("X-Upstream-Error", out.code);
      return send(res, 200, hit.body, "application/json; charset=utf-8");
    }

    res.setHeader("Retry-After", "30");
    return send(res, out.status || 502, JSON.stringify({
      error: {
        code: out.code || "upstream_error",
        message: out.message,
        details: out.details || []
      }
    }), "application/json; charset=utf-8");
  };
}

/* --------------------------------------------------------------- app router */
async function handleApp(app, req, res, sub, parsed) {
  const files = appFiles(app);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ------------------------------------------------------------ control API */
  if (sub === '/api/state') {
    return json(res, 200, readState(app, { seq: 0, action: 'none', index: -1, ts: Date.now() }));
  }

  if (sub === '/api/command') {
    const q = parsed.searchParams;
    const requested = q.get('action');

    if (app.strictActions && requested && app.actions.indexOf(requested) === -1) {
      /* self-describing error for Stream Deck / Companion debugging */
      return json(res, 400, {
        ok: false,
        app: app.id,
        error: 'unknown action "' + requested + '"',
        allowed: app.actions
      });
    }

    const action = app.actions.indexOf(requested) !== -1 ? requested : app.actions[0];
    const index = app.supportsIndex && q.get('index') != null ? parseInt(q.get('index'), 10) : -1;
    const state = { seq: (readState(app, {}).seq || 0) + 1, action, index, ts: Date.now() };
    try { await writeAtomic(files.state, JSON.stringify(state)); } catch (e) { /* overlay still polls */ }
    console.log('  [' + app.id + '] command → ' + action + (index === -1 ? '' : ' #' + index));
    return json(res, 200, { ok: true, app: app.id, state });
  }

  if (app.upstream && sub === app.upstream.path) {
    if (!app.__upstream) app.__upstream = createUpstream(app.upstream);
    return app.__upstream(req, res, parsed);
  }

  if (sub === '/api/config') {
    if (req.method === 'GET') {
      let body = '{}';
      try { body = fs.readFileSync(files.config, 'utf8'); } catch (e) { /* none saved yet */ }
      return send(res, 200, body, 'application/json; charset=utf-8');
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const cfg = JSON.parse(body);
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
          return json(res, 400, { ok: false, error: 'config must be a JSON object' });
        }
        await writeAtomic(files.config, JSON.stringify(cfg, null, 2));
        console.log('  [' + app.id + '] config saved (' + body.length + ' bytes)');
        return json(res, 200, { ok: true, app: app.id, keys: Object.keys(cfg).length });
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e.message || e) });
      }
    }
  }

  /* ---------------------------------------------------------------- static */
  const file = resolveInside(app.dir, sub === '/' ? '/index.html' : sub);
  if (!file) return send(res, 403, 'forbidden', 'text/plain');

  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      /* an unsaved config is normal: the overlay falls back to its defaults */
      if (path.basename(file) === 'config.json') return send(res, 200, '{}', 'application/json; charset=utf-8');
      return send(res, 404, 'not found: ' + app.prefix + sub, 'text/plain');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* Route a request to an app given the mount prefix ('' = mounted at the root,
   which is how the legacy ports work). Returns false if the prefix misses. */
function routeToApp(app, mount, req, res, parsed) {
  let pathname = decodeURIComponent(parsed.pathname);

  if (mount) {
    if (pathname === mount) {
      res.writeHead(302, { Location: mount + '/' });
      res.end();
      return true;
    }
    if (!pathname.startsWith(mount + '/')) return false;
    pathname = pathname.slice(mount.length);
  }

  handleApp(app, req, res, pathname || '/', parsed).catch((e) => {
    console.error('  [' + app.id + '] handler error:', e && e.message);
    try { json(res, 500, { ok: false, error: String(e && e.message) }); } catch (e2) { /* already sent */ }
  });
  return true;
}

/* ------------------------------------------------------------------ the hub */
function hubPage(origin) {
  try {
    const tpl = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
    const apps = APPS.map((a) => appStatus(a));
    return tpl.replace('/*__STUDIO__*/', 'window.__STUDIO__ = ' + JSON.stringify({
      origin, port: PORT, apps, legacy: LEGACY
    }) + ';');
  } catch (e) {
    return '<!doctype html><meta charset="utf-8"><h1>The Rollup overlays hub</h1>' +
      '<p>Hub page missing. Overlays are still served:</p><ul>' +
      APPS.map((a) => '<li><a href="' + a.prefix + '/index.html">' + a.name + '</a> — ' +
        '<a href="' + a.prefix + '/admin.html">control panel</a></li>').join('') +
      '</ul>';
  }
}

/* ------------------------------------------------------------ primary server */
const primary = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(parsed.pathname);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (pathname === '/healthz') {
    return json(res, 200, { ok: true, port: PORT, apps: APPS.map((a) => appStatus(a)) });
  }
  if (pathname === '/api/apps') {
    return json(res, 200, { apps: APPS.map((a) => appStatus(a)) });
  }
  if (pathname === '/' || pathname === '/index.html') {
    return send(res, 200, hubPage('http://localhost:' + PORT), 'text/html; charset=utf-8');
  }

  for (const app of APPS) {
    if (routeToApp(app, app.prefix, req, res, parsed)) return;
  }
  return send(res, 404, 'not found: ' + pathname +
    '\n\ntry one of:\n' + APPS.map((a) => '  ' + a.prefix + '/  (' + a.name + ')').join('\n') + '\n', 'text/plain');
});

/* The hub port is not optional: without it there is no board to serve, so a
   clash is reported plainly instead of dumping a stack trace. */
primary.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error('  ! port ' + PORT + ' is already in use.');
    console.error('    Another studio server is probably still running — stop it, or');
    console.error('    start this one elsewhere:  PORT=9000 node server.js');
    console.error('');
    process.exit(1);
  }
  throw e;
});

primary.listen(PORT, () => {
  console.log('');
  console.log('  The Rollup overlays hub');
  console.log('  ' + '-'.repeat(52));
  console.log('  Hub            http://localhost:' + PORT + '/');
  console.log('');
  APPS.forEach((a) => {
    console.log('  ' + a.name);
    console.log('    overlay        http://localhost:' + PORT + a.prefix + '/index.html');
    if (a.hasAdmin !== false) console.log('    control panel  http://localhost:' + PORT + a.prefix + '/admin.html');
  });
  if (LEGACY) {
    console.log('');
    console.log('  Legacy ports (existing OBS sources keep working):');
    APPS.forEach((a) => console.log('    ' + a.legacyPort + '  →  ' + a.name));
  }
  console.log('');
});

/* ------------------------------------------------------------- legacy ports */
if (LEGACY) {
  APPS.forEach((app) => {
    const srv = http.createServer((req, res) => {
      const parsed = new URL(req.url, 'http://localhost');
      routeToApp(app, '', req, res, parsed);
    });
    srv.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.log('  ! port ' + app.legacyPort + ' is already in use — ' + app.name +
          ' is still available at http://localhost:' + PORT + app.prefix + '/');
      } else {
        console.log('  ! legacy listener for ' + app.id + ' failed: ' + e.message);
      }
    });
    srv.listen(app.legacyPort);
  });
}

process.on('SIGINT', () => {
  console.log('\n  shutting down\n');
  process.exit(0);
});
