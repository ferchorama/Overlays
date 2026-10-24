/* ============================================================================
   Prediction Markets — overlay engine
   ----------------------------------------------------------------------------
   Responsibilities
     • merge config (defaults ← localStorage ← server config.json ← postMessage)
     • normalise, sort and filter the hand-entered markets
     • build the board DOM (header · hero · ranked list · footer)
     • drive every transition with GSAP
     • expose a small control API: window.PM.in() / .out() / .next() / .prev()

   Topic changes are MANUAL by design. There is no timer and no auto-advance:
   the board shows the hero market you (or a Stream Deck key) choose, and moving
   on is always an explicit `next` / `prev` / `#n` command. That keeps an
   editorial board under the operator's control instead of changing under them
   mid-sentence.
   ========================================================================== */
(function () {
  'use strict';

  /* If GSAP failed to load (fully offline machine, blocked CDN) the board must
     still appear — it just cuts between topics instead of animating. */
  var HAS_GSAP = !!window.gsap;
  /* The travelling glow is decoration that never stops moving, so it is the one
     thing an operator with motion sensitivity gets to switch off at the OS level. */
  var REDUCE_MOTION = (function () {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  })();
  if (!HAS_GSAP) {
    window.gsap = {
      timeline: function () {
        var o = {};
        ['from', 'to', 'fromTo', 'set', 'play', 'pause', 'delay', 'progress', 'add', 'call'].forEach(function (k) {
          o[k] = function () { return o; };
        });
        o.kill = function () {};
        o.duration = function () { return 0; };
        return o;
      },
      set: function () {},
      to: function () {},
      fromTo: function () {}
    };
  }

  /* This board's odds are hand-typed: there is no upstream feed, so there is no
     venue to attribute them to. An older saved config (or a ?config= URL) may
     still carry the venue name that used to ship here, so it is stripped rather
     than trusted — a stale config must not be able to put a claim about where the
     numbers came from back on air. */
  var DROPPED_SOURCES = ['polymarket', 'coingecko', 'coinpaprika', 'open-meteo', 'openmeteo', 'gamma'];

  function scrubSource(cfg) {
    try {
      var l = cfg && cfg.footer && cfg.footer.left;
      /* The venue name was a lie while every odd on this board was hand-typed,
         which is why it is dropped. Once the Polymarket headline source is
         selected the number genuinely does come from Polymarket — so naming it
         is honest, and hiding it would be the dishonest choice. */
      if (l && DROPPED_SOURCES.indexOf(String(l.source || '').trim().toLowerCase()) !== -1) {
        l.source = '';
      }
    } catch (e) { /* unexpected shape: leave it alone */ }
    return cfg;
  }

  var LS_KEY = 'pm-config-v1';
  var HERO_KEY = 'pm-hero-v1';
  var SHIPPED = window.PM_DEFAULT_CONFIG || {};

  /* A config that came through an OLDER config-merge build can hold `{}` where a
     saved boolean belongs (that build copied falsy values as objects, and `{}` is
     truthy). Coerce the flag that arms a timer, so a stale copy — in config.json,
     in localStorage, or pushed from a panel — cannot switch rotation back on. */
  function saneFlags(cfg) {
    if (cfg && isObj(cfg.rotate)) cfg.rotate.enabled = cfg.rotate.enabled === true;
    return cfg;
  }

  /* ------------------------------------------------------------------ utils */
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function deepMerge(base, patch) {
    if (!isObj(patch)) return base;
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(patch).forEach(function (k) {
      var pv = patch[k], bv = out[k];
      if (Array.isArray(pv)) out[k] = pv.slice();
      else if (isObj(pv) && isObj(bv)) out[k] = deepMerge(bv, pv);
      else if (pv !== undefined && pv !== null) out[k] = pv;
    });
    return out;
  }

  /* storage may hold a config from an older build — keep the operator's
     markets, take the shipped look */
  function mergeIncoming(base, patch) {
    var M = window.PM_MIGRATE;
    if (M && patch && patch.meta && patch.meta.version && M.versionOf(patch) !== M.versionOf(SHIPPED)) {
      return M.apply(SHIPPED, patch);
    }
    return deepMerge(base, patch);
  }

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function setVar(node, name, value) {
    if (value !== undefined && value !== null) node.style.setProperty(name, String(value));
  }

  /* markets are typed by hand, so every numeric field has to survive being
     blank, "$4,820,000", "68%" or a stray space */
  function num(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = parseFloat(String(v).replace(/[^0-9.eE+-]/g, ''));
    return isFinite(n) ? n : fallback;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function money(n) {
    n = num(n, 0);
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'K';
    return '$' + Math.round(n);
  }

  /* Full prices rather than the reference's 0-1 dollar probabilities: eight
     decimals would make a $4,820,000 market unreadable. */
  function priceText(v) {
    var n = num(v, 0);
    var a = Math.abs(n);
    if (a >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (a >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  }

  function moveText(v) {
    var n = num(v, 0);
    if (n > 0) return '+' + n.toFixed(1);
    if (n < 0) return n.toFixed(1);
    return '0.0';
  }

  function moveClass(v) {
    var n = num(v, 0);
    if (n > 0.049) return 'up';
    if (n < -0.049) return 'down';
    return 'flat';
  }

  function pctText(v) {
    var n = num(v, 0);
    /* keep integers clean ("68") but show one decimal when the operator typed one */
    return (Math.round(n * 10) / 10) % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
  }

  function formatEnds(s) {
    if (!s) return '';
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(s);
    var MMM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return MMM[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
  }

  /* -------------------------------------------------- fetched headline selection
     Which of a category's fetched headlines actually render:
       - `selection` (item ids) narrows the fetched top N; EMPTY means "all of
         them", so the count control alone is enough for the common case
       - `count` then caps how many are shown; 0 hides the category outright
       - the order is always the FETCHED order — i.e. by 24-hour volume — so a
         hand-made selection cannot quietly reorder the board
     An id in `selection` that is no longer in `items` is simply dropped, and
     that is the whole reason a selection survives an Update that reshuffles the
     top 5: the ids that are still there keep showing, the rest fall away. */
  function categoryHeadlines(cat) {
    var items = (cat && Array.isArray(cat.items)) ? cat.items.slice() : [];
    var sel = (cat && Array.isArray(cat.selection)) ? cat.selection.map(String) : [];
    if (sel.length) {
      items = items.filter(function (it) { return it && sel.indexOf(String(it.id)) !== -1; });
    }
    var count = Math.round(num(cat && cat.count, items.length));
    if (!isFinite(count) || count < 0) count = 0;
    return items.slice(0, count);
  }

  /* "2m ago" rather than a clock time: on air what matters is how stale the
     numbers are, not the moment they were pulled. */
  function agoText(ms) {
    var s = Math.max(0, Math.round(num(ms, 0) / 1000));
    if (s < 45) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 36) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  /* A fetched market that has not traded yet has NO price. Printing 0% for it
     would invent a number, and on an odds board that is the one thing a viewer
     would read as information — so it prints an em dash. */
  function probText(v) {
    if (v === null || v === undefined || v === '') return '\u2014';
    return pctText(v) + '%';
  }

  /* Is this market about an asset? A probability line only means something for a
     traded thing — a price history for "will the Fed cut rates" is fiction, so the
     graphic is withheld for those unless the operator forces it on. Matched on the
     topic text (and the category when one is set), because the category alone is
     unreliable: "Crypto" is sometimes left on a policy question. */
  function isAssetMarket(market, cfg) {
    var h = cfg.hero || {};
    var words = h.assetKeywords;
    if (!words || !words.length) return true;          /* nothing configured: show it */
    var hay = String(market.topic || '') + ' ' + String(market.category || '');
    hay = hay.toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var w = String(words[i] || '').trim().toLowerCase();
      if (w && hay.indexOf(w) !== -1) return true;
    }
    return false;
  }

  /* deterministic small hash, so a topic's auto history is stable across reloads
     instead of twitching every poll */
  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  function injectStyle(id, css) {
    var s = document.getElementById(id);
    if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
    s.textContent = css;
    return s;
  }

  function loadFonts(cfg) {
    var families = (cfg.googleFonts || []).slice();
    if (families.length) {
      injectStyle('pm-google-fonts',
        '@import url("https://fonts.googleapis.com/css2?' +
        families.map(function (f) { return 'family=' + f; }).join('&') + '&display=swap");');
    }
    var urls = (cfg.fontUrls || []).filter(Boolean);
    injectStyle('pm-custom-fonts', urls.map(function (u) { return '@import url("' + u + '");'; }).join('\n'));
  }

  /* ------------------------------------------------------- market normalising */
  function normaliseMarkets(cfg) {
    var items = (cfg.markets && cfg.markets.items) || [];
    var out = [];
    items.forEach(function (item, i) {
      if (!isObj(item)) return;
      var topic = String(item.topic == null ? '' : item.topic).trim();
      if (!topic) return;                       /* a blank question is not a market */
      if (item.enabled === false) return;       /* switched off in the panel */
      out.push({
        index: i,
        topic: topic,
        probability: clamp(num(item.probability, 0), 0, 100),
        volume: num(item.volume, 0),
        change: num(item.change, 0),
        category: String(item.category == null ? '' : item.category),
        ends: String(item.ends == null ? '' : item.ends),
        thumb: String(item.thumb == null ? '' : item.thumb),
        /* the asset id feeds the real 7-day price series — dropped here it
           silently disabled the whole asset-history path */
        asset: String(item.asset == null ? '' : item.asset).trim(),
        history: Array.isArray(item.history) ? item.history.slice() : null
      });
    });

    var sort = (cfg.markets && cfg.markets.sort) || 'manual';
    if (sort === 'volume') out.sort(function (a, b) { return b.volume - a.volume; });
    else if (sort === 'probability') out.sort(function (a, b) { return b.probability - a.probability; });
    else if (sort === 'change') out.sort(function (a, b) { return b.change - a.change; });
    else if (sort === 'topic') out.sort(function (a, b) { return a.topic.localeCompare(b.topic); });
    /* 'manual' keeps the order the operator arranged */

    out.forEach(function (m, i) { m.rank = i + 1; });
    return out;
  }

  /* The reference board shows a probability line. There is no upstream here, so
     when the operator has not typed history we synthesise a stable random walk
     that ENDS on their number — the line then reads as "how it got here" rather
     than contradicting the figure next to it. */
  function historyFor(market, cfg) {
    var mode = (cfg.hero && cfg.hero.historyMode) || 'auto';

    /* Real price series wins when one has been fetched for this market's asset.
       This is what makes the graphic mean something: a line drawn from the
       operator's typed odds is decoration, whereas the asset's actual 7-day price
       is the thing the market is about. */
    if (mode === 'asset' && market.asset && assetSeries[market.asset] && assetSeries[market.asset].length > 1) {
      return { values: assetSeries[market.asset].slice(), kind: 'price' };
    }
    if (market.history && market.history.length > 1) {
      return { values: market.history.map(function (v) { return clamp(num(v, 0), 0, 100); }), kind: 'prob' };
    }
    if (mode === 'asset') {
      return null;                 /* asset asked for but not loaded: say so */
    }
    var points = clamp(Math.round(num(cfg.hero && cfg.hero.historyPoints, 24)), 4, 120);
    if (market.history && market.history.length > 1) {
      return market.history.map(function (v) { return clamp(num(v, 0), 0, 100); });
    }
    if (mode === 'flat') {
      var flat = [];
      for (var f = 0; f < points; f++) flat.push(market.probability);
      return { values: flat, kind: 'prob' };
    }
    var vol = clamp(num(cfg.hero && cfg.hero.historyVolatility, 0.22), 0, 1);
    var seed = hash32(market.topic);
    var rand = function () {           /* xorshift, seeded per market */
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    };
    var series = [];
    var walk = 0;
    for (var i = 0; i < points; i++) {
      walk += (rand() - 0.5) * vol * 26;
      walk *= 0.86;                    /* mean-reverting, so it never runs away */
      series.push(walk);
    }
    /* shift the series so its last point is exactly the operator's number, then
       keep every point inside 0..100 */
    var last = series[series.length - 1] || 0;
    var base = market.probability - last;
    return { values: series.map(function (v) { return clamp(base + v, 1, 99); }), kind: 'prob' };
  }

  /* ------------------------------------------------------------ asset series
     The 7-day graphic for an asset market is the asset's real price history. It
     comes from the assets board's own cached proxy on the shared hub, so one
     CoinGecko call serves both overlays — the free tier rate-limits hard enough
     that a second polling consumer would be the thing that broke it. */
  var assetSeries = {};    /* asset id -> [prices] */
  /* exposed for the test suite: the price path must be verifiable without a
     network, and this is the seam the fetch writes into */
  window.__PM_ASSET_SERIES = assetSeries;
  var assetAskedAt = {};   /* asset id -> ms, so a failure is not retried in a loop */

  /* Last good series, so a reload or a scene switch paints the charts before the
     network answers. The hub also caches, so an in-TTL load costs one local
     request and no provider call at all. */
  var SERIES_CACHE_KEY = 'pm-asset-cache-v1';
  function readSeriesCache() {
    try {
      var raw = localStorage.getItem(SERIES_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeSeriesCache() {
    try {
      localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify({ ts: Date.now(), series: assetSeries }));
    } catch (e) { /* quota / private mode */ }
  }

  function fetchAssetSeries(ids, cfg, onNew, force) {
    var d = cfg.data || {};
    if (d.enabled === false || !window.fetch) return;
    var want = ids.filter(function (id) { return id; });
    if (!want.length) return;
    want.forEach(function (id) { assetAskedAt[id] = Date.now(); });
    /* relative by default; PM_hubUrl is still applied so a config saved by an
       older build (with an absolute path) keeps working */
    var proxy = d.proxyUrl || 'api/data';
    if (window.PM_hubUrl) proxy = window.PM_hubUrl(proxy);
    var url = proxy +
      '?ids=' + encodeURIComponent(want.join(',')) +
      '&currency=' + encodeURIComponent(d.currency || 'usd') +
      '&changes=24h,7d&sparkline=1' + (force ? '&force=1' : '');
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        var got = false;
        rows.forEach(function (row) {
          var sp = row && row.sparkline_in_7d;
          var pts = sp && sp.price;
          if (row && row.id && Array.isArray(pts) && pts.length > 1) {
            assetSeries[row.id] = pts;
            got = true;
          }
        });
        if (got) {
          console.info('[prediction-markets] asset history loaded for ' + Object.keys(assetSeries).join(', '));
          writeSeriesCache();
          if (onNew) onNew();
        }
      })
      .catch(function () { /* offline: the chart falls back to its placeholder */ });
  }

  /* ------------------------------------------------------------------- board */
  function Board(config) {
    this.cfg = config;
    this.stage = document.getElementById('stage');
    this.markets = [];
    this.heroIdx = 0;          /* index into this.markets, not into cfg.items */
    this.state = { onAir: false, built: false };
    this._tl = null;
    this._switchTl = null;
  }

  Board.prototype.mount = function () {
    var cfg = this.cfg;
    var self = this;

    document.body.classList.toggle('debug', !!cfg.debug);
    document.body.classList.toggle('no-gsap', !HAS_GSAP);

    setVar(this.stage, '--stage-w', cfg.stage.width + 'px');
    setVar(this.stage, '--stage-h', cfg.stage.height + 'px');
    setVar(this.stage, '--stage-bg', cfg.stage.background);
    this.stage.innerHTML = '';

    /* ---- optional banner band ---- */
    if (cfg.header.banner && cfg.header.banner.enabled && cfg.header.banner.src) {
      var sky = el('div', 'skyline', this.stage);
      if (cfg.header.banner.grayscale !== false) sky.classList.add('is-mono');
      setVar(sky, '--banner-src', 'url("' + cfg.header.banner.src + '")');
      setVar(sky, '--banner-op', cfg.header.banner.opacity);
      setVar(sky, '--banner-h', cfg.header.banner.height + 'px');
      this.sky = sky;
    }

    /* ---- safe area ---- */
    var board = el('div', 'board', this.stage);
    this.board = board;
    setVar(board, '--safe', cfg.layout.safe + 'px');
    setVar(board, '--safe-x', cfg.layout.safeX + 'px');

    /* ---- header ---- */
    var header = el('header', 'board__header', board);
    this.header = header;

    var brand = el('div', 'brand', header);
    var lg = cfg.header.logo || {};
    if (lg.enabled !== false && lg.src) {
      var img = el('img', 'brand__logo', brand);
      img.src = lg.src;
      img.alt = lg.alt || '';
      setVar(brand, '--logo-h', (lg.height || 80) + 'px');
      /* a wrong path is better seen than silently hidden, but it must not shift
         the layout once it fails — collapse it so the headline stays put */
      img.addEventListener('error', function () {
        img.style.visibility = 'hidden';
        setVar(brand, '--logo-h', '0px');
        console.warn('[prediction-markets] logo failed to load: ' + lg.src);
      });
      this.logo = img;
    }
    if (cfg.header.rule !== false && lg.enabled !== false && lg.src) {
      this.rule = el('div', 'brand__rule', brand);
    }

    var titles = el('div', 'brand__titles', brand);
    this.titles = titles;
    var kicker = el('div', 'kicker', titles);
    this.kicker = kicker;
    var h1 = el('h1', 'headline', titles);
    this.headline = h1;

    var right = el('div', 'header-right', header);
    this.headerRight = right;
    var rightTop = el('div', null, right);
    var rightSub = el('span', null, right);
    this.rightTop = rightTop;
    this.rightSub = rightSub;

    /* ---- main: hero + list ---- */
    var main = el('div', 'board__main', board);
    this.main = main;
    setVar(main, '--hero-w', cfg.layout.heroWidth + 'px');

    var hero = el('div', 'hero', main);
    this.hero = hero;
    setVar(hero, '--hero-pad-top', cfg.layout.heroPadTop + 'px');
    setVar(hero, '--hero-pad-right', cfg.layout.heroPadRight + 'px');

    /* ---- the way back out of the detail view ----
       Lives at the top of the hero column and is only revealed while a market is
       opened across the whole board, so the split board on air never carries a
       button. Hidden from the tab order too, or keyboard focus would land on an
       invisible control in the normal layout. */
    var backrow = el('div', 'backrow', hero);
    this.backrow = backrow;
    var back = el('button', 'back', backrow);
    this.backBtn = back;
    back.type = 'button';
    back.tabIndex = -1;
    back.setAttribute('aria-label', 'Back to the market list');
    back.textContent = '\u2190 Back to list';
    back.addEventListener('click', function () {
      /* the handler is on the button, so Enter/Space on it works for free */
      self.closeDetail();
    });

    this.heroBody = el('div', 'hero__body', hero);

    /* ---- the accent hairline drawn when a market opens full width ---- */
    this.sweep = el('div', 'sweep', hero);

    var chart = el('div', 'chart', hero);
    this.chart = chart;

    var list = el('div', 'list', main);
    this.list = list;
    setVar(list, '--list-pad-top', cfg.layout.listPadTop + 'px');
    setVar(list, '--list-pad-left', cfg.layout.listPadLeft + 'px');

    /* ---- the Polymarket headline board ----
       The other board layout, and mutually exclusive with the hand-typed one:
       a hero plus a ranked list has nothing to rank when every row is a fetched
       headline. Built here, filled by renderGroups(), and shown only when
       `source` selects it — so switching source cannot leave half of each board
       on screen. */
    var groups = el('div', 'groups', board);
    groups.style.display = 'none';
    this.groups = groups;

    /* ---- footer ---- */
    var footer = el('footer', 'board__footer', board);
    this.footer = footer;
    /* No progress/loading bar: topics are switched by hand, so a timed bar
       implied an auto-advance that deliberately does not exist. There is no
       element left to leave showing at 0% or animating forever. */
    this.prog = null;
    var ftxt = el('div', 'ftxt', footer);
    this.ftxt = ftxt;
    var left = el('div', null, ftxt);
    this.footLeft = left;
    var rightF = el('div', null, ftxt);
    this.footRight = rightF;

    /* ---- empty state (no enabled markets at all) ---- */
    var empty = el('div', 'empty', main);
    this.empty = empty;
    var eh = el('h2', null, empty);
    eh.textContent = 'No markets';
    var ep = el('p', null, empty);
    ep.textContent = 'Add topics in the control panel';
    empty.style.display = 'none';

    this.apply();
    return this;
  };

  /* Re-theme and rebuild from this.cfg. Preserves the current hero where it
     still exists, so an edit in the panel does not yank the board to market #1. */
  Board.prototype.apply = function () {
    var cfg = this.cfg;
    loadFonts(cfg);

    var p = cfg.palette || {};
    var st = this.stage;
    setVar(st, '--ink', p.ink);
    setVar(st, '--ink-soft', p.inkSoft);
    setVar(st, '--ink-mid', '#b9bdc5');
    setVar(st, '--dim', p.dim);
    setVar(st, '--dimmer', p.dimmer);
    setVar(st, '--line', p.line);
    setVar(st, '--line-2', '#3a3e46');
    setVar(st, '--line-soft', p.lineSoft);
    setVar(st, '--up', p.up);
    setVar(st, '--down', p.down);
    setVar(st, '--flat', p.flat);
    setVar(st, '--stage-bg', cfg.stage.background);

    /* header */
    var h = cfg.header;
    this.header.style.display = h.visible === false ? 'none' : 'flex';
    if (h.visible === false) this.header.classList.add('is-bare');
    setVar(this.kicker, '--kick-size', h.kicker.size + 'px');
    setVar(this.kicker, '--kick-track', h.kicker.tracking + 'em');
    setVar(this.kicker, '--kick-color', h.kicker.color);
    this.kicker.textContent = h.kicker.text || '';
    this.kicker.classList.toggle('is-plain', h.kicker.uppercase === false);

    setVar(this.headline, '--title-font', h.title.fontFamily);
    setVar(this.headline, '--title-size', h.title.size + 'px');
    setVar(this.headline, '--title-weight', h.title.weight);
    setVar(this.headline, '--title-track', h.title.tracking + 'px');
    setVar(this.headline, '--title-color', h.title.color);
    this.headline.textContent = h.title.text || '';
    this.headline.classList.toggle('is-upper', !!h.title.uppercase);

    this.rightTop.textContent = h.right.text || '';
    this.rightSub.textContent = h.right.sub || '';
    setVar(this.headerRight, '--right-size', h.right.size + 'px');
    setVar(this.headerRight, '--right-track', h.right.tracking + 'em');
    setVar(this.headerRight, '--right-color', h.right.color);
    setVar(this.headerRight, '--right-sub', h.right.subColor);
    setVar(this.headerRight, '--right-align', h.right.align || 'right');
    this.headerRight.classList.toggle('is-plain', h.right.uppercase === false);

    /* list geometry */
    var l = cfg.list;
    setVar(this.list, '--row-h', l.rowHeight + 'px');
    var cols = [];
    if (l.showThumb) cols.push('44px');
    if (l.showRank) cols.push('44px');
    cols.push('1fr');
    cols.push('auto');
    setVar(this.list, '--row-cols', cols.join(' '));

    /* hero geometry */
    setVar(this.hero, '--hero-topic-size', cfg.hero.topicSize + 'px');
    setVar(this.hero, '--hero-topic-lines', cfg.hero.topicMaxLines);
    setVar(this.hero, '--prob-size', cfg.hero.probabilitySize + 'px');
    setVar(this.chart, '--chart-h', cfg.hero.historyHeight + 'px');
    /* the opening sweep borrows the glow's accent, so the two animations on the
       chart read as one system rather than two different colours */
    if (this.sweep) {
      setVar(this.sweep, '--sweep-c', (cfg.hero.chartGlow && cfg.hero.chartGlow.color) || '#7fe6ff');
    }

    /* footer */
    var f = cfg.footer;
    this.footer.style.display = f.visible === false ? 'none' : 'flex';
    setVar(this.ftxt, '--foot-size', f.size + 'px');
    setVar(this.ftxt, '--foot-track', f.tracking + 'em');
    setVar(this.ftxt, '--foot-color', f.color);
    setVar(this.ftxt, '--dot-color', f.left.dotColor);
    this.ftxt.classList.toggle('is-plain', f.uppercase === false);

    this.footLeft.innerHTML = '';
    if (f.left.showDot !== false) el('i', 'dot', this.footLeft);
    var lt = el('span', null, this.footLeft);
    lt.textContent = f.left.source ? (f.left.text ? f.left.text + ' · ' : '') + f.left.source : (f.left.text || '');
    this.footRight.textContent = f.right.text || '';

    this.renderMarkets();
    /* which of the two boards is on screen is decided AFTER the hand-typed one
       has been built, so switching back to 'manual' finds it already correct */
    this.renderSource();
    /* ...and which VIEW of that board: an opened market survives a panel edit,
       the same way the chosen hero does, instead of snapping back to the list
       mid-show because a colour was changed. */
    this.applyDetail();
    this.state.built = true;
  };

  /* Rebuild the market list + hero shell. Called on every config change. */
  Board.prototype.renderMarkets = function () {
    var cfg = this.cfg, self = this;

    this.markets = normaliseMarkets(cfg);

    /* choose the hero */
    var mode = (cfg.hero && cfg.hero.mode) || 'volume';
    if (mode === 'first') this.heroIdx = 0;
    else if (mode === 'index') this.heroIdx = clamp(Math.round(num(cfg.hero.index, 0)), 0, Math.max(0, this.markets.length - 1));
    /* 'volume' is already the sort order when markets.sort = 'volume'; for any
       other sort the top-volume market is still what the reference leads with */
    else {
      var best = 0;
      this.markets.forEach(function (m, i) { if (m.volume > self.markets[best].volume) best = i; });
      this.heroIdx = best;
    }
    this.heroIdx = clamp(this.heroIdx, 0, Math.max(0, this.markets.length - 1));

    /* an empty board is a real state and must say so rather than render blank */
    if (!this.markets.length) {
      this.empty.style.display = '';
      this.hero.style.display = 'none';
      this.list.style.display = 'none';
      this.chart.style.display = 'none';
      return;
    }
    this.empty.style.display = 'none';
    this.hero.style.display = '';
    this.list.style.display = '';

    this.renderHero(this.markets[this.heroIdx]);
    this.renderList();
    this.loadAssetData();
  };

  /* ------------------------------------------------------------ headline source
     Which board is on screen. 'manual' is the hand-typed hero + ranked list;
     'polymarket' is the fetched headlines grouped by category. The two never
     share the stage — a half-built board is worse than either one. */
  Board.prototype.renderSource = function () {
    var poly = this.cfg.source === 'polymarket';
    if (this.groups) this.groups.style.display = poly ? '' : 'none';
    if (!poly) {
      if (this.main) this.main.style.display = '';
      return;
    }
    /* the headline board takes the whole main area: a hero and a ranked list
       have nothing to rank when every row is a fetched headline */
    if (this.main) this.main.style.display = 'none';
    if (this.empty) this.empty.style.display = 'none';
    this.renderGroups();
  };

  /* One section per category, each showing `count` of the selected headlines.
     Everything here is rendered from config, which the control panel writes on
     Update — the board itself never fetches, so nothing on this page can move a
     headline on a timer. */
  Board.prototype.renderGroups = function () {
    var cfg = this.cfg, self = this;
    var p = cfg.polymarket || {};
    var cats = Array.isArray(p.categories) ? p.categories : [];
    this.groups.innerHTML = '';
    this.groupEls = [];

    var anyShown = cats.some(function (c) { return categoryHeadlines(c).length; });

    /* Provenance, in the same spirit as the assets board's "updated 2m ago".
       Naming Polymarket is honest here in a way the hand-typed board's footer
       source could never be — nothing about these headlines is editorial. */
    var stamp = el('div', 'groups__stamp', this.groups);
    if (anyShown) {
      stamp.textContent = 'updated ' +
        (p.updatedAt ? agoText(Date.now() - num(p.updatedAt, 0)) : 'never');
    } else {
      stamp.textContent = p.lastError || 'No headlines yet \u2014 press Update in the control panel';
      stamp.classList.add('is-empty');
    }
    this.groupEls.push(stamp);

    var grid = el('div', 'groups__grid', this.groups);
    this.groupEls.push(grid);
    /* one column per VISIBLE category, so hiding one on a two-category board
       fills the width instead of leaving a third of the stage empty */
    var planned = cats.filter(function (c) { return Math.round(num(c && c.count, 0)) > 0; }).length;
    setVar(grid, '--group-cols', Math.max(1, Math.min(3, planned)));

    var visible = 0;
    cats.forEach(function (cat) {
      /* 0 is a real answer: it hides the category rather than showing an empty
         section with a heading and nothing under it */
      var count = Math.round(num(cat && cat.count, 0));
      if (count <= 0) return;
      visible++;

      var rows = categoryHeadlines(cat);
      var held = (cat && Array.isArray(cat.items)) ? cat.items.length : 0;

      var g = el('section', 'group', grid);
      self.groupEls.push(g);

      var head = el('div', 'group__head', g);
      var label = el('h2', 'group__label', head);
      label.textContent = cat.label || cat.id || '';
      var meta = el('span', 'group__meta', head);
      /* "3 of 5 · 24h volume" reads as a statement about the data; a bare "3"
         would leave the operator guessing whether more existed */
      meta.textContent = cat.error ? 'unavailable' : rows.length + ' of ' + held + ' \u00b7 24h volume';

      var body = el('div', 'group__rows', g);
      if (!rows.length) {
        var none = el('div', 'group__none', body);
        none.textContent = cat.error ? cat.error : 'No headlines held \u2014 press Update';
      }
      rows.forEach(function (it) {
        var row = el('div', 'grow', body);
        var q = el('div', 'grow__topic', row);
        q.textContent = String(it && it.title ? it.title : '');
        var figs = el('div', 'grow__figs', row);
        var pc = el('span', 'grow__pct num', figs);
        pc.textContent = probText(it && it.probability);
        var mv = el('span', 'grow__mv', figs);
        var hasChange = !!it && it.change !== null && it.change !== undefined;
        /* "pts" and "24h" are not decoration: one is a probability move in
           percentage points and the other is a 24-hour dollar volume, and
           mislabelling either would put a wrong claim on air */
        if (hasChange) {
          var ch = el('span', null, mv);
          ch.textContent = moveText(it.change) + ' pts';
          if (!cfg.list || cfg.list.changeColors !== false) ch.className = moveClass(it.change);
        }
        if (it && it.volume24hr !== null && it.volume24hr !== undefined) {
          if (hasChange) mv.appendChild(document.createTextNode('  '));
          var vol = el('em', null, mv);
          vol.textContent = money(it.volume24hr) + ' 24h';
        }
      });
    });

    if (!visible) {
      var zeros = el('div', 'groups__none', grid);
      zeros.textContent = 'Every category is set to 0 headlines.';
    }
  };

  /* Ask for the price history of every asset the enabled markets reference. The
     request is shared through the hub's cache, so this costs one upstream call for
     the whole board however many markets name an asset.

     opts.force is the manual "Update now": it ignores the local freshness check
     and asks the hub for a fresh provider read. */
  Board.prototype.loadAssetData = function (opts) {
    opts = opts || {};
    var force = opts.force === true;
    var cfg = this.cfg;
    if (!cfg.data || cfg.data.enabled === false) return;

    /* hydrate once from the last good series, so a reload paints the charts
       immediately instead of waiting on the network */
    if (!this._seriesHydrated) {
      this._seriesHydrated = true;
      var cached = readSeriesCache();
      if (cached && cached.series) {
        Object.keys(cached.series).forEach(function (id) {
          if (!assetSeries[id]) assetSeries[id] = cached.series[id];
        });
      }
    }

    var ttl = Math.max(30, num(cfg.data.refreshSeconds, 300)) * 1000;
    var now = Date.now();
    var want = [];
    this.markets.forEach(function (m) {
      if (!m.asset) return;
      if (force) delete assetAskedAt[m.asset];
      var seen = assetAskedAt[m.asset];
      if (!force && seen && now - seen < ttl) return;   /* fresh enough already */
      if (want.indexOf(m.asset) === -1) want.push(m.asset);
    });
    if (!want.length) return;
    var self = this;
    fetchAssetSeries(want, cfg, function () {
      /* Redraw in place. animateHeroIn() is deliberately not called: a data
         arrival is not a topic change, and replaying the entrance when a fetch
         resolves would make the board twitch on its own. */
      self.renderHero(self.heroMarket());
    }, force);
  };

  Board.prototype.renderList = function () {
    var cfg = this.cfg, self = this, l = cfg.list;
    this.list.innerHTML = '';
    this.rowEls = [];
    /* the market each rendered row shows, so a click and the highlight both map
       straight to a market instead of re-deriving it from a slice */
    this.rowMarkets = [];

    /* the hero market is shown in the list too, marked, exactly like the
       reference — so the ranking reads as complete */
    /* `i` is the POSITION in this.markets, and that is what switchTo() takes.
       It is emphatically not m.index: that is the row's index in
       cfg.markets.items, which stops matching the position the moment the
       markets are sorted (sort != manual) or a disabled/blank market is
       filtered out. Passing it put a different market on air than the row the
       operator clicked, under every sort but the one the tests happened to use. */
    this.markets.slice(0, Math.max(0, l.maxRows || 6)).forEach(function (m, i) {
      var row = el('div', 'row', self.list);
      if (m.index === self.heroMarket().index) row.classList.add('is-on');

      /* Click a row to OPEN it: the market takes the whole board — both columns —
         with a Back button to return to the list. Opening is also a topic change,
         so the row you clicked is the hero you come back to. */
      if (l.clickToSwitch !== false) {
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.classList.add('is-clickable');
        row.setAttribute('aria-label', 'Open ' + m.topic + ' full width');
        row.addEventListener('click', function () {
          if (l.clickOpensDetail === false) self.switchTo(i);
          else self.openDetail(i);
        });
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            /* preventDefault stops the page scrolling on space. The window
               handler below ALSO looks at space, so it must stand down once a
               focused row has taken the key — otherwise the row's market is
               selected and then immediately skipped past, and the board lands
               on the NEXT one. */
            e.preventDefault();
            if (l.clickOpensDetail === false) self.switchTo(i);
            else self.openDetail(i);
          }
        });
      }

      if (l.showThumb) {
        var th = el('img', 'row__thumb', row);
        th.alt = '';
        if (m.thumb) th.src = m.thumb;
      }
      if (l.showRank) {
        var rk = el('div', 'row__rank', row);
        rk.textContent = String(m.rank);
      }
      var q = el('div', 'row__topic', row);
      q.textContent = m.topic;

      var right = el('div', 'row__right', row);
      if (l.showProbability) {
        var pc = el('div', 'row__pct num', right);
        pc.textContent = pctText(m.probability) + '%';
      }
      if (l.showChange || l.showVolume) {
        var mv = el('div', 'row__mv', right);
        if (l.showChange) {
          var cs = el('span', null, mv);
          cs.textContent = moveText(m.change);
          if (l.changeColors !== false) cs.className = moveClass(m.change);
          if (l.showVolume) mv.appendChild(document.createTextNode(' '));
        }
        if (l.showVolume) {
          var vs = el('em', null, mv);
          vs.textContent = money(m.volume);
        }
      }
      self.rowEls.push(row);
      self.rowMarkets.push(m);
    });
  };

  Board.prototype.heroMarket = function () {
    return this.markets[this.heroIdx] || null;
  };

  /* ------------------------------------------------------------- detail view
     One market across the WHOLE board: the list steps aside and the hero — the
     same content the operator was already looking at — is given both columns.
     Nothing is rendered twice and there is no second layout to keep in sync; the
     view is a class on .board plus this.detail, which is what the fit functions
     read to scale the headline, the number and the chart up for the wider room. */
  Board.prototype.openDetail = function (idx) {
    if (!this.markets.length) return false;
    /* the headline board has no list, so there is nothing to open full width */
    if (this.cfg.source === 'polymarket') return false;

    var n = this.markets.length;
    var next = ((Math.round(num(idx, 0)) % n) + n) % n;
    var m = this.markets[next];
    var opening = !this.detail;
    /* Opening the market that is ALREADY on screen is a layout change, not a topic
       change: its hero, its chart and its glow are already correct, so nothing is
       re-rendered and the chart is not drawn again. Redrawing it here was the
       "incomplete line that slowly completes" — the expanded board replayed a
       1.15s dash-draw over content the operator could already see. */
    var cur = this.heroMarket();
    var same = !!(cur && cur.index === m.index && this.heroBody && this.heroBody.children.length);

    this.detail = true;
    this.detailTopic = m.topic;
    /* opening is also a topic change when it is another row: that row becomes the
       hero, so Back returns to the list with that market marked */
    this.heroIdx = next;
    rememberHero(m);
    /* An opened market is a deliberate selection: nothing may advance it while it
       is on screen. Rotation is parked here and picked up again by Back, so the
       operator's choice survives until they make another one. */
    this.rotationPaused = !!(window.PM && window.PM._rot);
    if (this.rotationPaused && window.PM.stopRotate) window.PM.stopRotate();

    /* class FIRST: the hero must be measured at the width it is about to have */
    this.applyDetail();
    if (!same) this.renderHero(m);
    this.markHeroInList(m);
    this.fitHeroContent();
    if (opening) this.animateDetailIn();
    return true;
  };

  Board.prototype.closeDetail = function () {
    if (!this.detail) return false;
    var was = this.heroMarket();
    this.detail = false;
    this.detailTopic = null;
    this.applyDetail();
    this.fitHeroContent();
    /* A reveal that is still running would keep clipping the headline in the list
       view, so it is stopped and settled before the list comes back. */
    this.settleDetailReveal();
    /* the layout collapses in one frame; the ranking then slides back in rather
       than appearing mid-sentence */
    this.animateDetailOut();
    /* hand rotation back to the board only if it was actually running */
    if (this.rotationPaused && window.PM && window.PM.startRotate) window.PM.startRotate();
    this.rotationPaused = false;

    /* focus back to the row that was opened, so a keyboard operator lands where
       they left instead of at the top of the document */
    var at = -1;
    (this.rowMarkets || []).forEach(function (mk, i) {
      if (was && mk.index === was.index) at = i;
    });
    var row = (at > -1 && this.rowEls) ? this.rowEls[at] : null;
    if (row && typeof row.focus === 'function') { try { row.focus(); } catch (e) { /* shim */ } }
    return true;
  };

  /* Apply this.detail to the DOM. Called after every rebuild, so an edit in the
     control panel cannot knock the board out of the view the operator chose. */
  Board.prototype.applyDetail = function () {
    var on = !!this.detail && this.cfg.source !== 'polymarket' && this.markets.length > 0;
    this.detail = on;

    var i = -1, self = this, moved = false;
    if (on) {
      /* find the opened market again — a config edit rebuilds the market list,
         and the index it had is not necessarily where it sits now */
      if (this.detailTopic) {
        this.markets.forEach(function (m, k) { if (m.topic === self.detailTopic) i = k; });
      }
      if (i < 0) {
        on = this.detail = false;
        this.detailTopic = null;
      } else {
        var cur = this.heroMarket();
        moved = !cur || cur.topic !== this.detailTopic;
        this.heroIdx = i;
      }
    }

    if (this.board) this.board.classList.toggle('is-detail', on);
    if (this.backBtn) {
      this.backBtn.tabIndex = on ? 0 : -1;
      this.backBtn.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    /* the list is still in the DOM (so the highlight survives), it is just out of
       the way — say so to assistive tech rather than leaving hidden rows readable */
    if (this.list) this.list.setAttribute('aria-hidden', on ? 'true' : 'false');

    if (on && i > -1 && moved && this.markets[i]) {
      this.renderHero(this.markets[i]);
      this.markHeroInList(this.markets[i]);
    }
    return on;
  };

  /* Stop a half-finished reveal and write every start value back to its settled
     one. Safe to call at any time: closing the detail view mid-transition, or a
     config edit that re-renders the hero under it, both need this. */
  Board.prototype.settleDetailReveal = function () {
    if (this._switchTl) {
      try { this._switchTl.kill(); } catch (e) { /* offline shim */ }
      this._switchTl = null;
    }
    var parts = [this.eyebrow, this.heroTopic, this.figs, this.backrow, this.chart].filter(Boolean);
    if (!HAS_GSAP || !parts.length) return;
    try {
      gsap.set(parts, { clearProps: 'opacity,transform,clipPath' });
      if (this.chartDot) gsap.set(this.chartDot, { clearProps: 'transform,opacity' });
      if (this.chartGlowPath) gsap.set(this.chartGlowPath, { '--glow-boost': 1 });
      if (this.sweep) gsap.set(this.sweep, { opacity: 0, scaleX: 1 });
    } catch (e) { /* offline shim */ }
  };

  /* The reveal for an opening detail: a layout change, so the block arrives in
     beats — the way out, an accent rule across the new width, then eyebrow, headline,
     figures and the number — while the chart is only revealed, never redrawn.
     The board gets wider in one frame (the grid column changes), and replaying the
     dash-draw at that moment was what looked wrong: the line vanished, crawled back
     in over a second, and only then did the glow start. Here the chart keeps the
     geometry it already had, and the glow loop is left running. */
  Board.prototype.animateDetailIn = function () {
    if (!HAS_GSAP || !this.heroBody) return null;
    var self = this;
    var parts = [this.eyebrow, this.heroTopic, this.figs].filter(Boolean);
    var extra = [this.backrow, this.sweep, this.chart].filter(Boolean);
    var all = parts.concat(extra);

    /* clear anything a stalled earlier tween left inline, so .from() starts clean */
    for (var i = 0; i < all.length; i++) {
      try { gsap.set(all[i], { clearProps: 'opacity,transform' }); } catch (e) { /* offline shim */ }
    }
    settleChartLine(this.chartPath);
    if (REDUCE_MOTION) return null;      /* the layout still changes; nothing moves */

    var a = this.cfg.animation;
    var tl = gsap.timeline();

    /* 1. the way out arrives first — it is the only thing on the new board that
          was not there before */
    if (this.backrow) {
      tl.from(this.backrow, { opacity: 0, x: 18, duration: 0.34, ease: a.rowEase }, 0);
    }

    /* 2. an accent hairline draws itself across the widened hero, then steps back
          so it never becomes decoration on air */
    if (this.sweep) {
      tl.fromTo(this.sweep, { scaleX: 0, opacity: 0 },
        { scaleX: 1, opacity: 0.9, duration: 0.55, ease: 'power2.out' }, 0.02);
      tl.to(this.sweep, { opacity: 0, duration: 0.4, ease: 'power1.out' }, 0.62);
    }

    /* 3. one beat per block: eyebrow, headline, figures. The headline is wiped
          open from its own box (clip-path), so it arrives as a reveal rather than a
          slide; that reads as a bigger move than another fade and costs no layout. */
    if (this.eyebrow) tl.from(this.eyebrow, { opacity: 0, y: 14, duration: 0.38, ease: a.rowEase }, 0.06);
    if (this.heroTopic) {
      tl.from(this.heroTopic, {
        opacity: 0, y: 26,
        clipPath: 'inset(0% 0% 100% 0%)',
        duration: 0.55, ease: 'power3.out'
      }, 0.14);
    }
    if (this.figs) tl.from(this.figs, { opacity: 0, y: 18, duration: 0.46, ease: a.rowEase }, 0.25);

    /* 4. the number lands with a little weight, and the key/values follow it
          across the width in a stagger */
    if (this.hugeNum) {
      tl.from(this.hugeNum, {
        scale: 0.92, transformOrigin: 'left bottom',
        duration: 0.55, ease: 'back.out(1.5)'
      }, 0.30);
    }
    if (this.side && this.side.children) {
      tl.from(this.side.children, {
        opacity: 0, y: 12, duration: 0.36, ease: a.rowEase, stagger: 0.05
      }, 0.32);
    }

    /* 5. the chart is revealed, never redrawn: the series, its grid and its glow
          are already correct and stay exactly as they were. Two accents acknowledge
          the expansion — the glow thickens once and the end marker pops — but not a
          single point of the line is re-plotted. */
    if (this.chart && this.chart.style.display !== 'none') {
      tl.from(this.chart, { opacity: 0, duration: a.fadeDuration * 0.8, ease: 'power1.out' }, 0.20);
      if (this.chartGlowPath) {
        /* a one-off flare: the travelling dash thickens as the board opens, so the
           glow acknowledges the change without a single point of the line moving */
        tl.to(this.chartGlowPath, { '--glow-boost': 1.5, duration: 0.28, ease: 'power2.out' }, 0.24);
        tl.to(this.chartGlowPath, { '--glow-boost': 1, duration: 0.5, ease: 'power2.inOut' }, 0.52);
      }
      if (this.chartDot) {
        tl.from(this.chartDot, {
          scale: 0.2, transformOrigin: 'center center',
          opacity: 0.2, duration: 0.45, ease: 'back.out(2.2)'
        }, 0.34);
      }
    }

    this._switchTl = tl;
    this._armSwitch(tl, function () {
      var settle = parts.concat([self.backrow, self.sweep, self.chart].filter(Boolean));
      gsap.set(settle, { clearProps: 'opacity,transform,clipPath' });
      if (self.sweep) gsap.set(self.sweep, { opacity: 0 });   /* never left showing */
      /* the flare is animation state, not configuration: put the boost back to 1 */
      if (self.chartGlowPath) gsap.set(self.chartGlowPath, { '--glow-boost': 1 });
      if (self.chartDot) gsap.set(self.chartDot, { clearProps: 'transform,opacity' });
    });
    tl.play();
    return tl;
  };

  /* Back: the layout collapses in one frame, then the ranking slides back in. The
     rows are already in the DOM — this is a reveal, not a rebuild. */
  Board.prototype.animateDetailOut = function () {
    if (!HAS_GSAP || REDUCE_MOTION) return null;
    var targets = (this.rowEls || []).slice();
    if (!targets.length) return null;
    try { gsap.set(targets, { clearProps: 'opacity,transform' }); } catch (e) { /* offline shim */ }
    var tl = gsap.timeline();
    tl.from(targets, {
      opacity: 0, x: 22, duration: 0.34, ease: 'power2.out', stagger: 0.03
    });
    this._switchTl = tl;
    this._armSwitch(tl, function () {
      gsap.set(targets, { clearProps: 'opacity,transform' });
    });
    tl.play();
    return tl;
  };

  /* Build the hero's inner content for one market. Text only — the animation
     layer treats this whole block as the thing that swaps. */
  Board.prototype.renderHero = function (m) {
    var cfg = this.cfg, h = cfg.hero, self = this;
    this.heroBody.innerHTML = '';
    if (!m) return;

    if (h.showEyebrow) {
      var eb = el('div', 'eyebrow', this.heroBody);
      var lab = el('div', null, eb);
      lab.textContent = h.eyebrowLabel || '';
      if (h.showEyebrowVolume) {
        el('i', null, eb);
        var vol = el('b', null, eb);
        vol.textContent = money(m.volume) + ' volume';
      }
      this.eyebrow = eb;
    }

    var q = el('h2', 'hero__topic', this.heroBody);
    q.textContent = m.topic;
    this.heroTopic = q;

    if (h.showProbability || h.showStats) {
      var figs = el('div', 'figs', this.heroBody);
      this.figs = figs;
      if (h.showProbability) {
        var pw = el('div', 'figs__prob', figs);
        var pl = el('div', 'lbl', pw);
        pl.textContent = 'Probability';
        var big = el('div', 'num huge', pw);
        big.appendChild(document.createTextNode(pctText(m.probability)));
        if (h.probabilitySuffix !== false) {
          var sm = el('small', null, big);
          sm.textContent = '%';
        }
        this.hugeNum = big;
      }
      if (h.showStats) {
        /* Collect the figures first, then decide the layout from how many there
           are. Four of them beside a 176px number is wider than the hero column,
           so the row would otherwise crush into several wrapped lines. */
        var stats = [];
        if (h.showChange) stats.push(['7-day move', moveText(m.change) + ' pts', [moveClass(m.change)]]);
        if (h.showVolume) stats.push(['7-day volume', money(m.volume), []]);
        if (h.showCategory && m.category) stats.push(['Category', m.category, []]);
        if (h.showEnds && m.ends) stats.push(['Ends', formatEnds(m.ends), []]);

        var cols = stats.length >= 4 ? 2 : stats.length;
        var side = el('div', 'side side--' + (cols >= 3 ? 'grid' : 'row'), figs);
        if (cols >= 3) setVar(side, '--stat-cols', cols);
        stats.forEach(function (s) {
          var kv = el('div', 'kv', side);
          var kl = el('div', 'lbl', kv);
          kl.textContent = s[0];
          var v = el('div', 'v' + (s[2][0] ? ' ' + s[2][0] : ''), kv);
          v.textContent = s[1];
        });
        this.side = side;
      }
    }

    /* The 7-day graphic only appears when the market is about an asset, so a
       macro or policy question is not given a made-up price history. */
    if (this.chart) this.chart.style.height = '';
    var wantChart = h.showHistory !== false && (h.showWhenNotAsset === true || isAssetMarket(m, cfg));
    if (wantChart) { this.chart.style.display = ''; this.renderChart(m); }
    else this.chart.style.display = 'none';
    /* marks a hero with no graphic, so the topic can use the freed room */
    if (this.hero) this.hero.classList.toggle('is-bare', !wantChart);

    /* measure once the fonts have settled, otherwise the shrunk size is decided
       against a fallback font and the row overflows again after the webfont lands */
    var self2 = this;
    this.fitHeroContent();
    /* At first paint the hero can still measure 0 tall, and the height fit needs a
       real number. Re-run once the layout has settled, and again when the webfont
       lands (measuring against a fallback font picks the wrong size). */
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () { self2.fitHeroContent(); });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { self2.fitHeroContent(); });
    }
  };

  /* Fit the hero to the space it has.
     Two independent axes, in order of what matters visually: the figures row must
     not run off the column (fitHeroFigures), and the block must not run off the
     bottom. Height pressure is relieved by shrinking the topic first — a headline
     may give up a few points — and only then the chart, which is decoration beside
     the numbers. Sizes always start from the configured values so repeated calls
     cannot ratchet the layout smaller and smaller. */
  /* The opened market gets both columns, so its content is started from a larger
     size instead of being laid into the slope of the old hero column. These are
     multipliers on the configured values, not new sizes: the panel still owns the
     scale, and the fit loop still shrinks from here when a topic is long. */
  var DETAIL_TOPIC_SCALE = 1.42;
  var DETAIL_PROB_SCALE = 1.16;

  Board.prototype.fitHeroContent = function () {
    if (!this.hero) return;
    var h = this.cfg.hero;
    var topicBase = (h.topicSize || 52) * (this.detail ? DETAIL_TOPIC_SCALE : 1);

    /* --- width --- */
    this.fitHeroFigures();

    /* --- height --- */
    var avail = this.hero.clientHeight;
    if (!avail) return;                       /* not laid out yet */

    if (this.heroTopic) this.heroTopic.style.fontSize = topicBase + 'px';
    if (this.chart) this.chart.style.height = '';

    var fits = function () { return this.hero.scrollHeight <= avail + 2; }.bind(this);
    if (fits()) return;

    /* the headline gives ground first */
    var size = topicBase;
    var minTopic = Math.max(24, Math.round(topicBase * 0.6));
    var guard = 0;
    while (!fits() && size > minTopic && guard++ < 40) {
      size -= 2;
      this.heroTopic.style.fontSize = size + 'px';
    }
    if (fits()) return;

    /* then the graphic, down to a readable floor, and finally out of the way */
    if (this.chart && this.chart.style.display !== 'none') {
      var ch = h.historyHeight || 64;
      var minCh = 34;
      while (!fits() && ch > minCh && guard++ < 80) {
        ch -= 4;
        this.chart.style.height = ch + 'px';
      }
      if (!fits()) this.chart.style.display = 'none';
    }
    this.fitHeroFigures();                    /* height changes can reflow the row */
  };

  /* Fit the figures row to the hero column.
     The big number is the thing that must dominate, so it is only shrunk within
     a range that still reads as the hero (config size down to a floor). If the
     stats cannot fit on one row even then, they switch to a 2x2 grid and the
     number keeps its size — shrinking a 176px figure to 72px to win a single row
     would make the board look broken in a different way. */
  Board.prototype.fitHeroFigures = function () {
    if (!this.hugeNum || !this.heroBody) return;
    var cfg = this.cfg.hero;
    var scale = this.detail ? DETAIL_PROB_SCALE : 1;
    var max = (parseFloat(cfg.probabilitySize) || 176) * scale;
    var floor = Math.min(max, 110 * scale);
    var avail = this.heroBody.clientWidth;
    /* `hugeSize` always records the size actually applied, including the common
       case where the configured size already fits — otherwise the field only ever
       held a value on the shrinking path and the layout looked unmeasured. */
    if (!avail) { this.hugeSize = max; return; }   /* not laid out yet */

    var gap = 44;
    var width = function () {
      var w = this.hugeNum.offsetWidth;
      if (this.side) w += gap + this.side.offsetWidth;
      return w;
    }.bind(this);

    /* one pass at full size decides whether it can ever fit on a single row */
    this.setStatsGrid(false);
    this.hugeNum.style.fontSize = max + 'px';

    if (width() > avail) {
      this.setStatsGrid(true);
      if (width() <= avail) { this.hugeSize = max; return; }  /* grid was enough */
    } else {
      this.hugeSize = max;
      return;                                                  /* already fits */
    }

    /* still too wide with the grid — shrink the number, but not past the floor */
    var size = max;
    var guard = 0;
    while (guard++ < 24) {
      size -= 4;
      if (size < floor) { size = floor; break; }
      this.hugeNum.style.fontSize = size + 'px';
      if (width() <= avail + 2) break;
    }
    this.hugeSize = size;
  };

  /* four stats sit 2x2, two or three sit on one row */
  Board.prototype.setStatsGrid = function (asGrid) {
    if (!this.side) return;
    var grid = asGrid && this.side.children.length >= 4;
    this.side.classList.toggle('side--grid', grid);
    this.side.classList.toggle('side--row', !grid);
    if (grid) setVar(this.side, '--stat-cols', 2);
  };

  /* The 7-day probability chart. Drawn inline as SVG — no charting dependency —
     and deliberately faithful to the reference board's own implementation:

       - the y-range is padded 20% past the series' high/low (min 1%) so the line
         actually reads as a shape instead of pinning to the top or bottom edge
       - three horizontal gridlines at 0% / 50% / 100% of that range, the middle one
         dashed (2 6), matching the reference exactly
       - a percentage label beside each gridline, in a 70px gutter to the right
       - a hollow pulsing ring plus a solid dot at the latest point
     The whole path is then drawn on with a stroke-dashoffset tween by animateHeroIn. */
  Board.prototype.renderChart = function (m, quiet) {
    var cfg = this.cfg, h = cfg.hero;
    if (!quiet) this.chart.innerHTML = '';
    var resolved = historyFor(m, cfg);
    var values = resolved && resolved.values;
    var kind = (resolved && resolved.kind) || 'prob';

    if (!values || values.length < 2) {
      /* No series. The wording differs by cause: an asset whose feed has not
         answered is "waiting", whereas a market with no series at all has none. */
      if (!quiet) {
        var nod = el('div', 'nodata', this.chart);
        nod.textContent = (h.historyMode === 'asset' && m.asset)
          ? 'Loading ' + m.asset + ' price history'
          : 'Price history unavailable';
        setVar(nod, '--nodata-h', (h.historyHeight || 64) + 'px');
      }
      this.chart.style.display = '';
      return;
    }

    this.chart.style.display = '';
    var series = values;
    var isPrice = kind === 'price';
    this.chartKind = kind;

    var lab;
    if (quiet) {
      lab = this.chart.querySelector('.lbl');
    } else {
      lab = el('div', 'lbl', this.chart);
    }
    if (lab) {
      lab.textContent = isPrice ? (h.historyLabelAsset || '7-day price') : (h.historyLabel || '');
    }

    var W = 1000, H = h.historyHeight || 64, GUTTER = 70;

    /* --- y-range with the reference's 20% padding --- */
    var lo = Math.min.apply(null, series), hi = Math.max.apply(null, series);
    /* a price series is not a percentage: pad relatively and never clamp to 100 */
    var pad = isPrice ? Math.max((hi - lo) * 0.2, Math.abs(hi) * 0.002, 1e-9)
                      : Math.max((hi - lo) * 0.2, 1);
    var yMin = isPrice ? lo - pad : Math.max(0, lo - pad);
    var yMax = isPrice ? hi + pad : Math.min(100, hi + pad);
    var span = (yMax - yMin) || 1;

    var xAt = function (i) { return (i / (series.length - 1)) * W; };
    var yAt = function (v) { return H - ((v - yMin) / span) * H; };

    var d = series.map(function (v, i) {
      return (i ? 'L' : 'M') + xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1);
    }).join(' ');

    /* the SVG and its parts are rebuilt, but on a quiet refresh only the geometry
       is replaced — the entrance animation must not replay for a data update */
    var svg;
    if (quiet && this.chartSvg) {
      svg = this.chartSvg;
      svg.innerHTML = '';
    } else {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 ' + (W + GUTTER) + ' ' + H);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('width', W + GUTTER);
      svg.setAttribute('height', H);
      svg.style.width = 'calc(100% - ' + GUTTER + 'px)';
    }

    function lineEl(x1, x2, y, cls) {
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', x1); ln.setAttribute('x2', x2);
      ln.setAttribute('y1', y); ln.setAttribute('y2', y);
      ln.setAttribute('class', cls);
      ln.setAttribute('vector-effect', 'non-scaling-stroke');
      if (cls === 'grid-line') ln.setAttribute('stroke-dasharray', '2 6');
      return ln;
    }

    /* --- area fill, drawn BEFORE the grid so it cannot cover it --- */
    var area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('class', 'area');
    area.setAttribute('d', d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z');
    svg.appendChild(area);

    /* --- gridlines + labels at 0 / 50 / 100% of the range --- */
    var gridEls = [];
    [0, 0.5, 1].forEach(function (frac, i) {
      var value = yMin + span * frac;
      var y = yAt(value);
      var gl = lineEl(0, W, y, i === 0 ? 'grid-base' : 'grid-line');
      svg.appendChild(gl);
      gridEls.push(gl);

      var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', W + 14);
      txt.setAttribute('y', y + 7);
      txt.setAttribute('class', 'axis-lbl');
      txt.textContent = isPrice ? priceText(value) : (Math.round(value) + '%');
      svg.appendChild(txt);
      gridEls.push(txt);
    });

    /* --- the series --- */
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', 'line');
    line.setAttribute('d', d);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);

    /* --- the travelling glow: the Digital Assets board's animation ---------
       A second path with identical geometry, drawn as one short dash that runs
       the length of the line and then rests on a loop — it makes the chart read
       as live rather than as a still. The length is summed from the points, not
       read from getTotalLength(), which returns 0 in a hidden OBS source and
       would leave a dash of the wrong size. */
    var lineLen = 0;
    for (var li = 1; li < series.length; li++) {
      var gdx = xAt(li) - xAt(li - 1);
      var gdy = yAt(series[li]) - yAt(series[li - 1]);
      lineLen += Math.sqrt(gdx * gdx + gdy * gdy);
    }
    this.chartLineLen = lineLen;

    var glowCfg = h.chartGlow || {};
    var glowPath = null, glowLen = 0;
    if (glowCfg.enabled !== false && !REDUCE_MOTION) {
      glowLen = Math.max(4, num(glowCfg.length, 150));
      if (lineLen > glowLen) {
        var glowColour = glowCfg.color || '#7fe6ff';
        glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        glowPath.setAttribute('class', 'glow');
        glowPath.setAttribute('d', d);
        glowPath.setAttribute('stroke', glowColour);
        glowPath.setAttribute('stroke-width', num(glowCfg.width, 3.4));
        /* the width is driven from a custom property so the detail view can flare it
           for a moment without GSAP rounding the configured 3.4px to 3px */
        glowPath.style.setProperty('--glow-w', num(glowCfg.width, 3.4) + 'px');
        glowPath.style.setProperty('--glow-boost', '1');
        glowPath.setAttribute('stroke-linejoin', 'round');
        glowPath.setAttribute('stroke-linecap', 'round');
        glowPath.setAttribute('vector-effect', 'non-scaling-stroke');
        glowPath.setAttribute('stroke-dasharray', glowLen + ' ' + (lineLen + glowLen));
        glowPath.setAttribute('opacity', '0');
        /* the bloom. drop-shadow rather than an SVG filter: one line, no defs to
           thread through. */
        var halo = num(glowCfg.halo, 8);
        if (halo > 0) glowPath.style.filter = 'drop-shadow(0 0 ' + halo + 'px ' + glowColour + ')';
        svg.appendChild(glowPath);
      }
    }
    this.chartGlowPath = glowPath;
    this.chartGlowInfo = glowPath ? { total: lineLen, len: glowLen, cfg: glowCfg } : null;

    /* --- latest point --- */
    var lx = xAt(series.length - 1), ly = yAt(series[series.length - 1]);
    var ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('class', 'ring');
    ring.setAttribute('cx', lx); ring.setAttribute('cy', ly); ring.setAttribute('r', 7);
    svg.appendChild(ring);

    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('cx', lx); dot.setAttribute('cy', ly); dot.setAttribute('r', 3.5);
    svg.appendChild(dot);

    if (!quiet || !this.chartSvg) this.chart.appendChild(svg);
    this.chartSvg = svg;
    this.chartPath = line;
    this.chartArea = area;
    this.chartDot = dot;
    this.chartGrid = gridEls;
    /* every rebuild has its own glow path, so the loop is re-armed here — a data
       refresh must not leave the previous timeline sweeping a path that is gone */
    this.armChartGlow();
  };

  /* The travelling glow's loop: cross the line, rest, repeat. `rest` is what makes
     it read as "every few seconds" rather than as a continuous sweep. */
  Board.prototype.armChartGlow = function () {
    if (this._glowTl) {
      try { this._glowTl.kill(); } catch (e) { /* offline shim */ }
      this._glowTl = null;
    }
    var gp = this.chartGlowPath, info = this.chartGlowInfo;
    if (!gp || !info || !HAS_GSAP) return null;

    var g = info.cfg || {};
    var travel = Math.max(0.3, num(g.duration, 3));
    var rest = Math.max(0, num(g.rest, 2.5));
    var op = num(g.opacity, 0.95);
    var fade = Math.min(0.28, travel * 0.25);

    var tl = gsap.timeline({ repeat: -1, repeatDelay: rest });
    tl.set(gp, { strokeDashoffset: info.total + info.len, opacity: 0 })
      .to(gp, { opacity: op, duration: fade })
      .to(gp, { strokeDashoffset: -info.len, duration: travel, ease: 'none' }, 0)
      .to(gp, { opacity: 0, duration: fade }, travel - fade);
    this._glowTl = tl;
    return tl;
  };

  /* ---------------------------------------------------------- topic switching
     MANUAL ONLY. `switchTo` is called by next / prev / #n / a click, never by a
     timer. The hero block animates out, its text is replaced, and it animates
     back in — so the operator drives every change on air. */
  Board.prototype.switchTo = function (idx, opts) {
    opts = opts || {};
    var self = this;
    if (!this.markets.length) return this.heroIdx;

    var next = ((idx % this.markets.length) + this.markets.length) % this.markets.length;
    if (next === this.heroIdx && !opts.force) return this.heroIdx;

    var m = this.markets[next];

    /* The hero INDEX changes now, but the hero CONTENT does not swap yet.
       That ordering matters in both directions:

       - The index must move immediately, or a stalled GSAP ticker (a throttled
         requestAnimationFrame in a hidden OBS browser source) would leave the
         topic silently unchanged on air — which is exactly what driving the swap
         from onComplete used to do. Same for the remembered topic.
       - The content must NOT re-render yet. Painting the new market immediately
         showed it at full opacity, then faded it out with the out-tween before
         animating it back in: the topic flashed, vanished and reappeared. The
         outgoing hero now stays on screen for the fade-out, and the swap happens
         at the handover — one clean out-in, nothing rendered twice. */
    this.heroIdx = next;
    rememberHero(m);
    /* in the detail view, next/prev moves the opened market too — Back must
       return to the list showing whatever is on screen, not the one first opened */
    if (this.detail) this.detailTopic = m.topic;

    var bits = this.heroBody ? [].slice.call(this.heroBody.children) : [];
    var chart = (this.chart && this.chart.style.display !== 'none') ? this.chart : null;

    /* the handover: replace the content, re-mark the list, restart the progress bar */
    function swap() {
      if (self._switchSeq && self._switchSeq !== mySeq) return;   /* superseded */
      self.renderHero(m);
      self.markHeroInList(m);
      self.restartProgress();
      /* re-render cleared any inline opacity from a previous pass, so the
         element we are about to animate in is the one just built */
      newBits = self.heroBody ? [].slice.call(self.heroBody.children) : [];
      newChart = (self.chart && self.chart.style.display !== 'none') ? self.chart : null;
      return true;
    }

    var mySeq = (this._switchSeq = (this._switchSeq || 0) + 1);
    var newBits = [], newChart = null;

    /* Nothing on screen to fade out, or no animation wanted/available: swap now.
       Any inline fade left on the outgoing elements must not survive into the new
       content, hence the clearProps. */
    if (opts.instant || !HAS_GSAP || !this.heroBody || !bits.length) {
      if (HAS_GSAP) this._settleHero(bits, chart);
      swap();
      if (HAS_GSAP) this._settleHero(newBits, newChart);
      return next;
    }

    this.animateHeroOut(bits, chart, function () {
      if (!swap()) return;
      self.animateHeroIn(null, newBits);
    });
    return next;
  };

  /* The series is revealed with a stroke-dashoffset tween, so a ticker that stops
     half way leaves the line looking broken on air — the one animation artefact
     that survives in a still frame. GSAP's clearProps runs through the engine that
     stalled; removing the two properties straight from the element's style cannot
     stall, so the chart always ends complete. */
  function settleChartLine(path) {
    if (!path || !path.style || typeof path.style.removeProperty !== 'function') return;
    path.style.removeProperty('stroke-dasharray');
    path.style.removeProperty('stroke-dashoffset');
  }

  /* Guarantee the hero is actually visible once the switch should be over. */
  Board.prototype._settleHero = function (bits, chart) {
    if (!HAS_GSAP) return;
    gsap.set(bits || [], { clearProps: 'opacity,transform' });
    if (chart) gsap.set(chart, { clearProps: 'opacity' });
    settleChartLine(this.chartPath);
  };

  /* Safety net for ONE topic switch, independent of the entrance's own net.
     If the out-timeline never completes we still settle the hero, otherwise a
     stall would leave it mid-fade or invisible. */
  Board.prototype._armSwitch = function (tl, settle) {
    var self = this;
    clearTimeout(this._switchSafety);
    var span = (tl && typeof tl.duration === 'function' ? tl.duration() : 0) || 0.8;
    this._switchSafety = setTimeout(function () {
      var done = (typeof tl.progress === 'function') ? tl.progress() >= 1 : true;
      if (done) return;
      console.warn('[prediction-markets] topic animation did not finish — settling the hero');
      try { tl.progress(1, true).pause(); } catch (e) { /* offline shim */ }
      /* On the handover timeline this swaps the content in and then settles it
         visible, so a completely stalled ticker still ends with the right market
         on screen rather than the outgoing one frozen mid-fade. */
      if (settle) settle();
    }, (span + 1.0) * 1000);
  };

  Board.prototype.next = function () { return this.switchTo(this.heroIdx + 1); };
  Board.prototype.prev = function () { return this.switchTo(this.heroIdx - 1); };

  Board.prototype.markHeroInList = function (m) {
    var self = this;
    (this.rowEls || []).forEach(function (row, i) {
      /* rowMarkets is the authoritative mapping — indexing into this.markets
         would silently mark the wrong row whenever the list is not a 1:1 slice
         of the sorted markets */
      var mk = (self.rowMarkets || [])[i];
      if (!mk) return;
      row.classList.toggle('is-on', mk.index === m.index);
    });
  };

  /* --------------------------------------------------------------- animation */
  Board.prototype.animateHeroIn = function (done, bits) {
    if (!HAS_GSAP || !this.heroBody) { if (done) done(); return null; }
    var a = this.cfg.animation;
    /* `bits` is passed back in when the safety net replays this after a stalled
       ticker: by then heroBody has already been re-rendered, so re-reading its
       children would animate the WRONG elements */
    bits = bits || [].slice.call(this.heroBody.children);
    var tl = gsap.timeline({ onComplete: function () { if (done) done(); } });

    /* --- the hero text --- */
    if (bits.length) {
      tl.from(bits, {
        opacity: 0, y: 14,
        duration: a.rowDuration, ease: a.rowEase, stagger: a.stagger
      }, 0);
    }

    /* --- the 7-day graphic, drawn rather than faded in ---
       Order matters: the grid and its labels establish the axes, then the series
       is drawn on left-to-right, then the end marker arrives. Animating the whole
       SVG's opacity instead said nothing about the shape, which is the one thing
       the chart is for. */
    if (this.chart && this.chart.style.display !== 'none') {
      var chartTl = 0.08;
      tl.from(this.chart, { opacity: 0, duration: a.fadeDuration * 0.6, ease: 'power1.out' }, chartTl);

      var grid = this.chartGrid || [];
      if (grid.length) {
        tl.from(grid, { opacity: 0, duration: 0.4, ease: 'power1.out', stagger: 0.05 }, chartTl + 0.05);
      }
      /* the area fades in as the line passes over it */
      if (this.chartArea) {
        tl.from(this.chartArea, { opacity: 0, duration: 0.7, ease: 'power1.out' }, chartTl + 0.22);
      }
      /* the series itself draws from left to right via stroke-dashoffset. The
         length comes from the rendered geometry (chartLineLen) because
         getTotalLength() returns 0 in a hidden OBS browser source, where the
         element has no layout. */
      if (this.chartPath) {
        var len = this.chartLineLen || 0;
        if (!len) {
          try { len = this.chartPath.getTotalLength ? this.chartPath.getTotalLength() : 0; } catch (e) { len = 0; }
        }
        if (len) {
          gsap.set(this.chartPath, { strokeDasharray: len, strokeDashoffset: len });
          tl.to(this.chartPath, { strokeDashoffset: 0, duration: 1.15, ease: 'power2.out' }, chartTl + 0.18);
        }
      }
      /* the end marker lands once the line reaches it */
      if (this.chartDot) {
        tl.from(this.chartDot, { scale: 0, transformOrigin: 'center center', duration: 0.45, ease: 'back.out(2)' }, chartTl + 1.1);
      }
    }

    this._switchTl = tl;
    this._armSwitch(tl, function () {
      /* The entrance of the new topic must never be able to leave the hero
         invisible. GSAP's .from() applies its invisible start state at once, so a
         timeline that never ticks would strand the board blank — clear the
         properties instead of trusting the tween to finish. */
      gsap.set(bits, { clearProps: 'opacity,transform' });
      if (this.chart) gsap.set(this.chart, { clearProps: 'opacity' });
      var extra = [this.chartArea, this.chartDot].concat(this.chartGrid || []).filter(Boolean);
      if (extra.length) gsap.set(extra, { clearProps: 'opacity,transform' });
      if (this.chartPath) gsap.set(this.chartPath, { clearProps: 'strokeDasharray,strokeDashoffset' });
      settleChartLine(this.chartPath);
    });
    tl.play();
    /* A second, tween-free net for the line: once the draw window has passed the
       dash properties are removed outright. If the engine ran, this is a no-op on
       a completed path; if it stalled, it is what stops the series sitting
       half-drawn. */
    var selfLine = this;
    clearTimeout(this._lineNet);
    this._lineNet = setTimeout(function () { settleChartLine(selfLine.chartPath); },
      ((typeof tl.duration === 'function' ? tl.duration() : 1.5) + 0.8) * 1000);
    return tl;
  };

  /* Fade out the elements that were on screen BEFORE the swap. They are passed
     in rather than read from the DOM because the DOM already holds the new
     topic by the time this runs. */
  Board.prototype.animateHeroOut = function (bits, chart, done) {
    var a = this.cfg.animation;
    if (!HAS_GSAP || !bits || !bits.length) { if (done) done(); return null; }
    if (this._switchTl) this._switchTl.kill();
    var fired = false;
    var once = function () { if (fired) return; fired = true; if (done) done(); };
    var tl = gsap.timeline({ onComplete: once });
    tl.to(bits, { opacity: 0, y: -10, duration: a.rowDuration * 0.6, ease: 'power1.in', stagger: 0.03 }, 0);
    if (chart) tl.to(chart, { opacity: 0, duration: a.rowDuration * 0.5 }, 0);
    this._switchTl = tl;
    tl.play();
    /* The fade-OUT needs the safety net as much as the fade-in does: it owns the
       handover, so a stalled ticker here would freeze the outgoing topic on screen
       and the new one would never arrive. `once` keeps a stall from double-firing
       the handover if the timeline also completes normally. */
    this._armSwitch(tl, once);
    return tl;
  };

  /* A config edit re-renders the board: the hero text changes under the
     operator. Fade the whole block rather than re-running the entrance. */
  Board.prototype.animateSoftRefresh = function () {
    if (!HAS_GSAP) return;
    var a = this.cfg.animation;
    var targets = [this.heroBody, this.list, this.header].filter(Boolean);
    gsap.fromTo(targets, { opacity: 0.35 }, { opacity: 1, duration: a.fadeDuration * 0.5, ease: 'power1.out' });
  };

  /* The entrance: header and footer settle, hero rises, list rows stagger in.
     Entrance only — there is no out animation; OBS hides the source. */
  Board.prototype.buildTimeline = function () {
    var a = this.cfg.animation, self = this;
    if (this._tl) this._tl.kill();
    var tl = gsap.timeline({ paused: true });
    /* remembered so _armSafety can settle these by hand if the ticker stalls */
    var settle = [];
    this._entranceTargets = settle;

    if (this.sky) { tl.from(this.sky, { opacity: 0, duration: a.fadeDuration * 1.2, ease: 'power1.out' }, 0); settle.push(this.sky); }
    tl.from(this.header, { opacity: 0, y: -a.fadeDistance * 2, duration: a.fadeDuration, ease: 'power2.out' }, 0);
    settle.push(this.header);
    if (this.heroBody) {
      tl.from(this.heroBody.children, {
        opacity: 0, y: a.fadeDistance * 2, duration: a.fadeDuration, ease: a.rowEase, stagger: a.stagger
      }, 0.1);
      settle.push(this.heroBody);
    }
    if (this.chart && this.chart.style.display !== 'none') {
      tl.from(this.chart, { opacity: 0, duration: a.fadeDuration, ease: 'power1.out' }, 0.35);
      settle.push(this.chart);
    }
    (this.rowEls || []).forEach(function (row) {
      tl.from(row, { opacity: 0, x: 18, duration: a.rowDuration, ease: a.rowEase }, 0.2);
    });
    /* the headline board animates as whole groups: staggering three sections
       reads as one arrival, where staggering fifteen rows reads as noise */
    (this.groupEls || []).forEach(function (g) {
      tl.from(g, { opacity: 0, y: 18, duration: a.rowDuration, ease: a.rowEase }, 0.15);
    });
    if (this.footer) { tl.from(this.footer, { opacity: 0, duration: a.fadeDuration, ease: 'power1.out' }, 0.3); settle.push(this.footer); }

    this._tl = tl;
    return tl;
  };

  Board.prototype.in = function (delay) {
    var self = this;
    this.stage.classList.add('is-ready');
    if (!HAS_GSAP) { this.state.onAir = true; return; }
    if (!this._tl) this.buildTimeline();
    gsap.set([this.board], { opacity: 1 });
    this._tl.pause(0);
    this._tl.delay(delay || 0);
    this._tl.play();
    this.state.onAir = true;
    this.restartProgress();
    this._armSafety(this._tl);
  };

  /* GSAP's .from() applies its invisible start state immediately, so an
     interrupted entrance (a throttled rAF in a hidden OBS source) would leave
     the board blank on air. Snap to the finished state if that happens. */
  Board.prototype._armSafety = function (tl) {
    var self = this;
    clearTimeout(this._safety);
    var span = (tl && typeof tl.duration === 'function' ? tl.duration() : 0) || 3;
    this._safety = setTimeout(function () {
      if (!self.state.onAir || !tl) return;
      if (typeof tl.progress === 'function' && tl.progress() < 1) {
        console.warn('[prediction-markets] entrance did not finish — snapping to the visible state');
        try { tl.progress(1, true).pause(); } catch (e) { /* offline shim */ }
        /* Snapping the timeline is not enough on its own: a stalled ticker can
           also leave the .from() start values — opacity: 0 — applied to the DOM
           with nothing animating them away, which is how a board ends up on air
           at 17% opacity. Clear the inline values outright. */
        self._settleEntrance();
      }
    }, (span + 0.8) * 1000);
  };

  /* Force every entrance target back to its natural (fully visible) state. */
  Board.prototype._settleEntrance = function () {
    if (!HAS_GSAP) return;
    var targets = this._entranceTargets || [];
    if (this.heroBody) targets = targets.concat(this.heroBody.children, [this.heroBody]);
    if (this.header) targets.push(this.header);
    if (this.footer) targets.push(this.footer);
    if (this.chart) targets.push(this.chart);
    if (this.rowEls) targets = targets.concat(this.rowEls);
    if (this.groupEls) targets = targets.concat(this.groupEls);
    try { gsap.set(targets, { clearProps: 'opacity,transform' }); } catch (e) { /* offline shim */ }
    settleChartLine(this.chartPath);
  };

  Board.prototype.showInstant = function () {
    this.stage.classList.add('is-ready');
    if (this._tl) { clearTimeout(this._safety); try { this._tl.progress(1, true).pause(); } catch (e) { /* offline shim */ } }
    this._settleEntrance();
    this.state.onAir = true;
  };

  Board.prototype.out = function () {
    clearTimeout(this._safety);
    if (this._tl) this._tl.pause(0);
    if (HAS_GSAP) gsap.set([this.board], { opacity: 0 });
    this.state.onAir = false;
  };

  Board.prototype.replay = function () {
    this.showInstant();
    if (HAS_GSAP) gsap.set([this.board], { opacity: 1 });
    this.buildTimeline();
    this.in();
  };

  /* The capture-window bar restarts whenever the visible topic changes, so it
     always reads as "time on this market" rather than a free-running clock. */
  /* Kept as a no-op: the board has no timed element any more. switchTo() still
     calls it, so leaving the name in place keeps that flow readable. */
  Board.prototype.restartProgress = function () {};

  /* ------------------------------------------------------------- hero memory
     The chosen topic survives a reload of the browser source, so refreshing OBS
     does not silently drop the board back to market #1 mid-show. */
  function rememberHero(m) {
    try { localStorage.setItem(HERO_KEY, m.topic); } catch (e) { /* private mode */ }
  }
  function recallHero() {
    try { return localStorage.getItem(HERO_KEY); } catch (e) { return null; }
  }

  /* --------------------------------------------------------------- stage fit */
  function fitStage(cfg) {
    var stage = document.getElementById('stage');
    var w = window.innerWidth, h = window.innerHeight;
    var s = 1;
    switch (cfg.stage.fit) {
      case 'cover': s = Math.max(w / cfg.stage.width, h / cfg.stage.height); break;
      case 'width': s = w / cfg.stage.width; break;
      case 'none': s = 1; break;
      default: s = Math.min(w / cfg.stage.width, h / cfg.stage.height);
    }
    var left = 0, top = 0;
    if (cfg.stage.fit === 'contain' || cfg.stage.fit === 'none') {
      if (cfg.stage.alignX === 'center') left = (w - cfg.stage.width * s) / 2;
      else if (cfg.stage.alignX === 'right') left = w - cfg.stage.width * s;
      if (cfg.stage.fit === 'contain') top = (h - cfg.stage.height * s) / 2;
    }
    stage.style.transform = 'translate3d(' + left + 'px, ' + top + 'px, 0) scale(' + s + ')';
  }

  /* ------------------------------------------------------------------- boot */
  window.PM = {
    cfg: null,
    board: null,
    ready: false,
    apply: function (patch, opts) {
      opts = opts || {};
      var wasOnAir = !!(this.board && this.board.state.onAir);
      var hadBoard = !!this.board;
      this.cfg = saneFlags(scrubSource(mergeIncoming(this.cfg || {}, patch || {})));
      fitStage(this.cfg);
      if (!this.board) this.board = new Board(this.cfg);
      this.board.cfg = this.cfg;
      this.board.mount();

      /* restore the remembered topic on first mount */
      if (!hadBoard) {
        var want = recallHero();
        if (want) {
          var i = this.board.markets.map(function (m) { return m.topic; }).indexOf(want);
          if (i > -1) this.board.switchTo(i, { instant: true, force: true });
        }
      }

      if (opts.animate === true) {
        this.board.in(this.cfg.animation.autoPlayDelay);
      } else if (opts.animate === 'static') {
        this.board.showInstant();
      } else if (wasOnAir) {
        /* edited while on air → stay visible, do not replay the entrance */
        this.board.showInstant();
        this.board.animateSoftRefresh();
      } else {
        this.board.out();
      }
      this.ready = true;
      return this.cfg;
    },
    in: function () { this.board && this.board.in(); },
    out: function () { this.board && this.board.out(); },
    replay: function () { this.board && this.board.replay(); },
    next: function () { this.board && this.board.next(); },
    prev: function () { this.board && this.board.prev(); },
    show: function (i) { this.board && this.board.switchTo(i); },
    /* open one market across the whole board, and step back to the list */
    open: function (i) { return this.board ? this.board.openDetail(i) : false; },
    back: function () { return this.board ? this.board.closeDetail() : false; },
    /* Manual asset-data update. `force` asks the hub for a fresh provider read;
       the dashboard forces once and then sends the `refresh` command, so the
       overlay itself normally re-reads the warm cache. */
    refreshAssets: function (force) {
      if (this.board) this.board.loadAssetData({ force: force === true });
    },
    getConfig: function () { return this.cfg; },
    /* Exposed for the test suite: which headlines a category renders is pure
       config arithmetic, and asserting it directly beats inferring it from the
       rendered DOM — the selection/count interaction is where an off-by-one
       would hide. */
    /* exposed so the command → asset-update path is testable without a state poll */
    handleCommand: handleCommand,
    headlinesFor: categoryHeadlines,
    agoText: agoText,
    /* rotation is opt-in and OFF by default: switching topics is a manual act */
    startRotate: function () {
      var self = this;
      this.stopRotate();
      /* `=== true`, not truthy. A config that went through an older migration can
         carry `{}` where the saved boolean belongs, and `{}` is truthy — that is
         how a board with rotation switched OFF started cycling the markets on its
         own. Only a real `true` may start the timer. */
      if (!this.cfg.rotate || this.cfg.rotate.enabled !== true) return;
      this._rot = setInterval(function () { self.next(); }, Math.max(2000, num(self.cfg.rotate.ms, 12000)));
    },
    stopRotate: function () { if (this._rot) { clearInterval(this._rot); this._rot = null; } },
    startLoop: function () {
      var self = this;
      this.stopRotate();
      if (this._loop) clearInterval(this._loop);
      var run = function () { self.board.in(); };
      run();
      this._loop = setInterval(run, (self.cfg.animation.loopHoldIn + self.cfg.animation.loopHoldOut) * 1000);
    }
  };

  function start() {
    var cfg = deepMerge(SHIPPED, {});
    var qs = new URLSearchParams(location.search);
    var noSync = qs.get('nosync') === '1';


    try {
      var ls = localStorage.getItem(LS_KEY);
      if (ls) cfg = mergeIncoming(cfg, JSON.parse(ls));
    } catch (e) { /* ignore */ }

    if (qs.get('configUrl')) { cfg.sync = cfg.sync || {}; cfg.sync.serverConfigUrl = qs.get('configUrl'); }
    if (qs.get('config')) {
      try { cfg = deepMerge(cfg, JSON.parse(atob(qs.get('config')))); } catch (e) { /* ignore */ }
    }
    if (qs.get('fit')) cfg.stage.fit = qs.get('fit');
    if (qs.get('market') != null) { cfg.hero = cfg.hero || {}; cfg.hero.mode = 'index'; cfg.hero.index = parseInt(qs.get('market'), 10) || 0; }

    var booted = false, lastCfgJson = '', lastSeq = -1;

    /* ---- live sync #1: control panel via postMessage ---- */
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'pm:config') window.PM.apply(d.config);
      else if (d.type === 'pm:command') handleCommand(d);
    });

    /* ---- live sync #2: another tab on the same origin ---- */
    window.addEventListener('storage', function (ev) {
      if (ev.key === LS_KEY && ev.newValue) {
        try { window.PM.apply(JSON.parse(ev.newValue)); } catch (e) { /* ignore */ }
      }
    });

    window.addEventListener('resize', function () { if (window.PM.cfg) fitStage(window.PM.cfg); });

    /* keyboard: space/→ next, ← previous, i entrance, o out. Handy when the
       overlay is being driven from the operator's own screen. */
    window.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      /* A focused list row handles Enter/space itself and marks the event
         handled. Acting on it here too fired two topic changes for one key
         press, so the board skipped past the market the operator picked. */
      if (e.defaultPrevented) return;
      if (e.key === 'i' || e.key === 'I') window.PM.in();
      else if (e.key === 'o' || e.key === 'O') window.PM.out();
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); window.PM.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); window.PM.prev(); }
      /* Escape closes an opened market. Only claimed when there IS one open, so
         the key stays free for the browser/OBS otherwise. */
      else if (e.key === 'Escape' || e.key === 'Esc') { if (window.PM.back()) e.preventDefault(); }
      else if (/^[1-9]$/.test(e.key)) window.PM.show(parseInt(e.key, 10) - 1);
    });

    /* a #3 in the URL selects the third market, which is how a Stream Deck or a
       scene can jump straight to a topic */
    function hashMarket() {
      var m = String(location.hash || '').match(/^#(\d+)$/);
      if (m && window.PM.board) window.PM.board.switchTo(parseInt(m[1], 10) - 1, { instant: true, force: true });
    }
    window.addEventListener('hashchange', hashMarket);

    function boot(serverCfg) {
      if (booted) return;
      booted = true;
      if (serverCfg) { cfg = mergeIncoming(cfg, serverCfg); lastCfgJson = JSON.stringify(serverCfg); }
      window.PM.apply(cfg, { animate: cfg.animation.autoPlay ? true : 'static' });
      hashMarket();
      if (cfg.rotate && cfg.rotate.enabled) window.PM.startRotate();
      if (cfg.animation.loopPreview && /preview=1/.test(location.search)) window.PM.startLoop();
    }

    function fetchConfig() {
      var u = (window.PM.cfg && window.PM.cfg.sync && window.PM.cfg.sync.serverConfigUrl) || 'config.json';
      return fetch(u + (u.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && Object.keys(j).length) ? j : null; })
        .catch(function () { return null; });
    }

    function pollConfig() {
      if (!booted) return;
      fetchConfig().then(function (j) {
        if (!j) return;
        var s = JSON.stringify(j);
        if (s === lastCfgJson) return;
        lastCfgJson = s;
        window.PM.apply(j);            /* keeps the on-air state: no intro replay */
      });
    }

    function pollState() {
      if (!booted) return;
      var s = (window.PM.cfg && window.PM.cfg.sync) || {};
      fetch((s.stateUrl || 'api/state') + '?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (st) {
          if (!st || st.seq == null || st.seq === lastSeq) return;
          lastSeq = st.seq;
          handleCommand(st);
        })
        .catch(function () { /* no server: ignore */ });
    }

    if (noSync) { boot(null); return; }

    var settled = false;
    fetchConfig().then(function (j) { settled = true; boot(j); });
    setTimeout(function () { if (!settled) boot(null); }, 900);

    setInterval(pollConfig, (cfg.sync && cfg.sync.pollMs) || 1500);
    setInterval(pollState, (cfg.sync && cfg.sync.statePollMs) || 700);
    setTimeout(pollState, 400);
  }

  function handleCommand(cmd) {
    if (!cmd) return;
    switch (cmd.action) {
      case 'in': case 'play': window.PM.in(); break;
      case 'out': case 'hide': window.PM.out(); break;
      case 'replay': window.PM.replay(); break;
      case 'next': window.PM.next(); break;
      case 'prev': window.PM.prev(); break;
      case 'show': if (cmd.index != null) window.PM.show(cmd.index); break;
      case 'refresh': window.PM.refreshAssets(false); break;
      case 'update': window.PM.refreshAssets(true); break;
      /* the detail view, for a Stream Deck button: open index N, or go back */
      case 'open': if (cmd.index != null) window.PM.open(cmd.index); break;
      case 'back': case 'list': window.PM.back(); break;
      case 'config': if (cmd.config) window.PM.apply(cmd.config, { animate: false }); break;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();


