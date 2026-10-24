/* ============================================================================
   Saved-config migration — Talking Points Panel
   ----------------------------------------------------------------------------
   The control panel and the overlay both keep a full copy of the config
   (localStorage / config.json). Without this, a config saved by an older build
   silently pins the old theme, so the panel flips back the next time it renders.

   Rule: same meta.version → the saved config wins (your edits are yours).
         different version  → keep only what you typed (title, subtitle, topic
         list) and take the whole look from the shipped build.
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

  /* `o || {}` turned a saved `false` into an empty OBJECT, which is truthy — a
     version bump could then switch a saved flag (subtitle.autoDate, for one) back
     on. Copy the value as it is; only undefined has no copy. */
  function clone(o) {
    if (o === undefined) return undefined;
    return JSON.parse(JSON.stringify(o));
  }
  function versionOf(c) { return (c && c.meta && c.meta.version) || '0.0.0'; }

  /* the text the operator owns — everything else is look */
  var CONTENT = [
    /* kept because a version bump resetting the operator's theme back to light
       would be a silent, confusing regression */
    ['theme', 'any'],
    ['header.title.text', 'string'],
    ['subtitle.text', 'string'],
    ['subtitle.autoDate', 'any'],
    ['subtitle.dateFormat', 'any'],
    ['topics.items', 'array'],
    ['topics.maxRows', 'any']
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
    API.lastNote = 'saved settings were from v' + sv + ' — your title, date and topics were kept, the look was updated to v' + nv;
    if (typeof console !== 'undefined') console.info('[talking-points] ' + API.lastNote);
    return out;
  }

  API.apply = apply;
  API.versionOf = versionOf;
  API.deepMerge = deepMerge;
  API.contentPaths = CONTENT.map(function (p) { return p[0]; });

  window.TP_MIGRATE = API;
})();
