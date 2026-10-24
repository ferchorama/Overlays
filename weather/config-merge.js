/* ============================================================================
   Saved-config migration
   ----------------------------------------------------------------------------
   A config saved by an older build must never pin an outdated theme: the
   browser (localStorage) and the server (config.json) both hold a full copy of
   the config, so a stale one silently overrode every palette fix.

   Rule: while meta.version is unchanged, the saved config wins (your edits are
   yours). When the version changes, the saved config keeps only its CONTENT and
   the new build supplies the whole look.

     node tests/admin.js   # covers this: stored v-old config → new palette, cities kept
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

  function versionOf(c) {
    return (c && c.meta && c.meta.version) || '0.0.0';
  }

  /* shipped = config.js defaults, stored = localStorage / config.json / postMessage */
  function apply(shipped, stored) {
    if (!isObj(stored)) return clone(shipped);

    var sv = versionOf(stored), nv = versionOf(shipped);
    if (sv === nv) return deepMerge(clone(shipped), stored);

    var out = deepMerge(clone(shipped), {});
    CONTENT_KEYS.forEach(function (k) {
      if (stored[k] !== undefined) out[k] = clone(stored[k]);
    });
    out.meta = Object.assign({}, shipped.meta, { migratedFrom: sv });

    var note = 'saved settings were from v' + sv + ' — your cities and units were kept, the look was updated to v' + nv;
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
    migrated: false,
    migratedFrom: '',
    lastNote: ''
  };

  window.WX_MIGRATE = API;
})();
