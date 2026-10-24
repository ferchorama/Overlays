/* ============================================================================
   Saved-config migration — Prediction Markets
   ----------------------------------------------------------------------------
   The control panel and the overlay each keep a full copy of the config
   (localStorage / config.json). Without this, a config saved by an older build
   silently pins the old palette, so the board flips back the next time it
   renders — a theme fix would appear to undo itself.

   Rule: same meta.version → the saved config wins (your edits are yours).
         different version  → keep only what you typed (the markets, the titles)
         and take the whole look from the shipped build.
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

    var out = deepMerge(clone(shipped), {});
    CONTENT.forEach(function (pair) {
      var v = getPath(stored, pair[0]);
      if (v === undefined || v === null) return;
      if (pair[1] === 'array' && !Array.isArray(v)) return;
      if (pair[1] === 'string' && typeof v !== 'string') return;
      setPath(out, pair[0], clone(v));
    });
    out.meta = Object.assign({}, shipped.meta, { migratedFrom: sv });

    API.migrated = true;
    API.migratedFrom = sv;
    API.lastNote = 'saved markets were from v' + sv + ' — your topics were kept, the look was updated to v' + nv;
    if (typeof console !== 'undefined') console.info('[prediction-markets] ' + API.lastNote);
    return out;
  }

  API.apply = apply;
  API.versionOf = versionOf;
  API.deepMerge = deepMerge;
  API.contentPaths = CONTENT.map(function (p) { return p[0]; });

  window.PM_MIGRATE = API;
})();
