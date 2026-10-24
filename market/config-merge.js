/* ============================================================================
   Digital Assets Market — version-aware config migration
   ----------------------------------------------------------------------------
   The admin, the overlay and the server each keep a copy of the config, and a
   copy written by an older build would otherwise override the current look.
   Same contract as the other widgets:

     same version     → your saved config wins, edits are respected
     different version → your CONTENT is kept, the shipped LOOK is applied

   `data` is split deliberately: refresh cadence and currency are yours, while
   the endpoint URLs always come from the build (a stale proxy path would
   silently break the board).
   ========================================================================== */
(function () {
  'use strict';

  var CONTENT_KEYS = ['categories', 'maxRows', 'font'];
  var CONTENT_DATA_KEYS = ['refreshSeconds', 'currency'];
  var LOOK_KEYS = ['stage', 'panel', 'header', 'tabs', 'columns', 'rows', 'colors', 'animation', 'data'];

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function deepMerge(base, patch) {
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var pv = patch[k], bv = out[k];
      if (isObj(pv)) out[k] = deepMerge(isObj(bv) ? bv : {}, pv);
      else if (Array.isArray(pv)) out[k] = pv.slice();
      else if (pv !== undefined) out[k] = pv;
    }
    return out;
  }

  var migrated = false;
  var lastNote = '';

  var MIGRATE = {
    CONTENT_KEYS: CONTENT_KEYS,
    LOOK_KEYS: LOOK_KEYS,

    deepMerge: deepMerge,

    apply: function (shipped, stored) {
      migrated = false;
      lastNote = '';
      if (!isObj(stored)) return deepMerge(shipped, {});

      var sv = (stored.meta && stored.meta.version) || null;
      var shv = (shipped.meta && shipped.meta.version) || null;

      /* Same build: the saved config is authoritative. */
      if (sv && sv === shv) return deepMerge(shipped, stored);

      /* Older (or unversioned) build: keep what the user typed, take the look. */
      var out = deepMerge(shipped, {});
      CONTENT_KEYS.forEach(function (k) {
        if (stored[k] !== undefined) out[k] = isObj(stored[k]) ? deepMerge(shipped[k] || {}, stored[k]) : stored[k];
      });
      if (isObj(stored.data)) {
        out.data = deepMerge(shipped.data || {}, {});
        CONTENT_DATA_KEYS.forEach(function (k) {
          if (stored.data[k] !== undefined) out.data[k] = stored.data[k];
        });
      }

      migrated = true;
      lastNote = 'look updated to v' + (shv || '?') + (sv ? ' (was v' + sv + ')' : '') +
        ' — your categories were kept';
      out.meta = deepMerge(shipped.meta || {}, { migratedFrom: sv });
      return out;
    },

    get migrated() { return migrated; },
    get lastNote() { return lastNote; }
  };

  window.CM_MIGRATE = MIGRATE;
})();
