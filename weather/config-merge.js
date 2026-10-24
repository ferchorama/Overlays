/* ============================================================================
   Saved-config migration — SETTINGS ARE PERSISTENT
   ----------------------------------------------------------------------------
   The browser (localStorage) and the server (config.json) both hold a full copy
   of the config. When a build update changes `meta.version`, the operator's
   saved settings must survive it: a shipped default is not a reason to undo an
   hour of tuning. This is the promise the dashboard makes — "save once, it stays
   saved" — and it is what the migration tests now guard.

   Rule: the shipped build supplies new keys and any value the saved config does
   not define; every value the operator saved wins, including `false`, `0` and
   `''`. Keys the build no longer knows (retired settings) are dropped instead of
   being resurrected.

     node tests/admin.js   # covers this: custom palette survives a version bump
   ========================================================================== */
(function () {
  'use strict';

  /* everything the operator actually typed / chose about *what* to show */
  var CONTENT_KEYS = ['cities', 'maxCities', 'units', 'data', 'sync', 'googleFonts', 'theme'];
  /* everything that is *how* it looks — always taken from the shipped build */
  var LOOK_KEYS = ['stage', 'panel', 'surfaces', 'header', 'card', 'footer', 'iconColors', 'animation'];

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

  /* `o || {}` turned a saved `false` (or 0, or '') into an empty OBJECT, which is
     truthy — a version bump could then switch a saved flag on. Copy the value
     as it is; only undefined has no copy. */
  function clone(o) {
    if (o === undefined) return undefined;
    return JSON.parse(JSON.stringify(o));
  }

  /* Copy every value the shipped build still knows about. Arrays (cities, font
     lists) are taken whole; objects are walked key-by-key so a retired setting
     cannot sneak back in; `meta` is handled separately. */
  function mergeKnown(base, patch) {
    if (!isObj(patch)) return clone(base);
    var out = clone(base);
    Object.keys(patch).forEach(function (k) {
      if (k === 'meta') return;
      if (!(k in base)) return;                 /* retired key: drop it */
      var pv = patch[k], bv = base[k];
      if (Array.isArray(pv)) out[k] = clone(pv);
      else if (isObj(pv) && isObj(bv)) out[k] = mergeKnown(bv, pv);
      else if (pv !== undefined) out[k] = clone(pv);
    });
    return out;
  }

  function versionOf(c) {
    return (c && c.meta && c.meta.version) || '0.0.0';
  }

  /* shipped = config.js defaults, stored = localStorage / config.json / postMessage */
  function apply(shipped, stored) {
    if (!isObj(stored)) return clone(shipped);

    var sv = versionOf(stored), nv = versionOf(shipped);
    if (sv === nv) return deepMerge(clone(shipped), stored);

    /* A version bump is not permission to reset the look: keep every saved value
       the build still understands, and let the build fill in what is new. */
    var out = mergeKnown(clone(shipped), stored);
    out.meta = Object.assign({}, shipped.meta, { migratedFrom: sv });

    var note = 'settings were from v' + sv + ' — kept as saved, new options from v' + nv + ' applied';
    API.migrated = true;
    API.migratedFrom = sv;
    API.lastNote = note;
    if (typeof console !== 'undefined') console.info('[weather] ' + note);
    return out;
  }

  var API = {
    apply: apply,
    versionOf: versionOf,
    contentKeys: CONTENT_KEYS,
    lookKeys: LOOK_KEYS,
    deepMerge: deepMerge,
    mergeKnown: mergeKnown,
    migrated: false,
    migratedFrom: '',
    lastNote: ''
  };

  window.WX_MIGRATE = API;
})();
