/* ============================================================================
   Saved-config migration — Prediction Markets
   ----------------------------------------------------------------------------
   The control panel and the overlay each keep a full copy of the config
   (localStorage / config.json). Settings are PERSISTENT: a build update adds new
   options but never resets what the operator saved — the dashboard's promise is
   "save once, it stays saved".

   Rule: same meta.version → the saved config wins.
         different version  → every saved value the build still knows wins, the
         build fills in new keys and keeps ownership of the endpoint URLs.
   ========================================================================== */
(function () {
  'use strict';

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

  /* `o || {}` here turned every falsy CONTENT value into an empty OBJECT: a saved
     `rotate.enabled: false` came back as `{}`, which is truthy — so a version
     bump silently switched rotation ON and the board started cycling through the
     markets on air. Copy the value as it is; only undefined has no copy. */
  function clone(o) {
    if (o === undefined) return undefined;
    return JSON.parse(JSON.stringify(o));
  }
  /* Copy every value the shipped build still knows about. Arrays (markets, the
     Polymarket category list) are taken whole; objects are walked key-by-key so
     retired settings cannot come back; meta is handled separately. */
  function mergeKnown(base, patch) {
    if (!isObj(patch)) return clone(base);
    var out = clone(base);
    Object.keys(patch).forEach(function (k) {
      if (k === 'meta' || !(k in base)) return;
      var pv = patch[k], bv = base[k];
      if (Array.isArray(pv)) out[k] = clone(pv);
      else if (isObj(pv) && isObj(bv)) out[k] = mergeKnown(bv, pv);
      else if (pv !== undefined) out[k] = clone(pv);
    });
    return out;
  }

  function versionOf(c) { return (c && c.meta && c.meta.version) || '0.0.0'; }

  /* The text the operator owns — everything else is look. Note `markets.items`
     is the whole point of this overlay: a version bump must never discard a
     hand-typed board, which is the one thing that cannot be regenerated. */
  var CONTENT = [
    ['markets.items', 'array'],
    ['markets.sort', 'any'],
    ['header.kicker.text', 'string'],
    ['header.title.text', 'string'],
    ['header.right.text', 'string'],
    ['header.right.sub', 'string'],
    ['header.logo.src', 'string'],
    ['header.banner.src', 'string'],
    ['footer.left.text', 'string'],
    ['footer.left.source', 'string'],
    ['footer.right.text', 'string'],
    ['hero.mode', 'any'],
    ['hero.index', 'any'],
    ['hero.eyebrowLabel', 'any'],
    /* Which series the hero graphic plots is CONTENT, not look: the markets the
       operator typed decide whether a real price line exists for them. Treating
       it as look meant a version bump silently switched a hand-typed board from
       'auto' to the shipped 'asset' — and because those markets carry no asset
       id, every chart then read "Price history unavailable" on air. */
    ['hero.historyMode', 'any'],
    ['list.maxRows', 'any'],
    ['rotate.enabled', 'any'],
    ['rotate.ms', 'any'],
    /* The Polymarket headline board. The fetched `items` ride along with the
       operator's choices on purpose: re-fetching is one button press, whereas
       losing the category/tag/count/selection setup would have to be redone by
       hand. */
    ['source', 'any'],
    ['polymarket.entity', 'any'],
    ['polymarket.fetched', 'any'],
    ['polymarket.sortKey', 'any'],
    ['polymarket.categories', 'array'],
    ['polymarket.updatedAt', 'any']
  ];

  function getPath(o, path) {
    return path.split('.').reduce(function (a, k) { return a && a[k]; }, o);
  }
  function setPath(o, path, v) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length - 1; i++) { if (!isObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = v;
  }

  var API = { migrated: false, migratedFrom: '', lastNote: '' };

  function apply(shipped, stored) {
    if (!isObj(stored)) return clone(shipped);

    var sv = versionOf(stored), nv = versionOf(shipped);
    if (sv === nv) return deepMerge(clone(shipped), stored);

    /* Persistence: keep the saved settings, add the new build's options. Endpoint
       paths stay build-owned — a stale proxy URL would silently break the chart
       after an update. */
    var out = mergeKnown(shipped, stored);
    if (isObj(out.data)) {
      out.data.proxyUrl = shipped.data.proxyUrl;
      out.data.directUrl = shipped.data.directUrl;
    }
    out.meta = Object.assign({}, shipped.meta, { migratedFrom: sv });

    API.migrated = true;
    API.migratedFrom = sv;
    API.lastNote = 'settings were from v' + sv + ' — kept as saved, new options from v' + nv + ' applied';
    if (typeof console !== 'undefined') console.info('[prediction-markets] ' + API.lastNote);
    return out;
  }

  API.apply = apply;
  API.versionOf = versionOf;
  API.deepMerge = deepMerge;
  API.contentPaths = CONTENT.map(function (p) { return p[0]; });

  window.PM_MIGRATE = API;

  /* ------------------------------------------------------- hub-relative URLs
     The asset chart is served by the ASSETS board's proxy, not this app's, so
     its default is a root-absolute path ('/market/api/market'). That path is
     only correct while the hub is mounted at the server root. Behind a base
     path ('/studio/predictions/index.html') the leading slash silently points
     at the wrong place, and the chart sits on its placeholder forever with no
     error to explain why.

     The page cannot know the hub root from a leading slash, but it can read the
     mount it was served from: this panel always lives one directory under the
     hub root, so strip the file name and that one directory. Served from disk
     there is no hub at all, so the value is returned untouched and the direct
     endpoint is the fallback. */
  window.PM_hubUrl = function (url) {
    if (typeof url !== 'string' || url.charAt(0) !== '/') return url;
    if (typeof location === 'undefined' || !location || typeof location.pathname !== 'string') return url;
    if (location.protocol === 'file:') return url;
    /* '/predictions/index.html' → '/predictions/' → ''      (hub at the root)
       '/studio/predictions/admin.html' → '/studio/'          (hub under a base) */
    var dir = location.pathname.replace(/[^/]*$/, '');
    var root = dir.replace(/[^/]+\/$/, '');
    return root.replace(/\/+$/, '') + url;
  };
})();
