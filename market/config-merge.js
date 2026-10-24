/* ============================================================================
   Digital Assets Market — version-aware config migration + asset sanitising
   ----------------------------------------------------------------------------
   The admin, the overlay and the server each keep a copy of the config. Settings
   are PERSISTENT: a build update may add new options, but it never resets what
   the operator saved. A shipped default is not a reason to undo an hour of
   tuning.

     same version + schema → your saved config wins
     anything else         → every saved value the build still knows wins; the
                             build fills in new keys, upgrades the asset schema,
                             and keeps ownership of the endpoint URLs

   `data` is split deliberately: your currency/policy values are kept, while the
   endpoint URLs always come from the build (a stale proxy path would otherwise
   silently break the board on a version bump).

   `meta.schema` is the ASSET FORMAT, not the build number, and it is what makes
   "store assets by provider id" enforceable:
     • schema 2 → each category's `coins` is a list of UNIQUE CoinGecko ids.
   A schema-1 file is upgraded on load: the ids are kept, blanks and duplicates
   are dropped, and an empty section stays empty (the board draws an explicit
   empty state rather than inventing a coin). No ticker is ever written.
   ========================================================================== */
(function () {
  'use strict';

  var CONTENT_KEYS = ['categories', 'maxRows', 'font'];
  var CONTENT_DATA_KEYS = ['currency'];
  var LOOK_KEYS = ['stage', 'panel', 'header', 'tabs', 'columns', 'rows', 'colors', 'animation', 'data'];

  /* CoinGecko ids: lower-case slugs (bitcoin, avalanche-2, the-open-network).
     A ticker like "BTC" or "AVAX" is refused on purpose — it is ambiguous across
     exchanges, and the provider's price endpoint does not take it. */
  var ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  var TICKER_RE = /^[A-Z0-9]{2,10}$/;

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  /* Copy every value the shipped build still knows about (arrays whole, objects
     key-by-key so retired settings cannot come back, `meta` handled outside). */
  function mergeKnown(base, patch) {
    if (!isObj(patch)) return deepMerge(base, {});
    var out = deepMerge(base, {});
    Object.keys(patch).forEach(function (k) {
      if (k === 'meta' || !(k in base)) return;
      var pv = patch[k], bv = base[k];
      if (Array.isArray(pv)) out[k] = JSON.parse(JSON.stringify(pv));
      else if (isObj(pv) && isObj(bv)) out[k] = mergeKnown(bv, pv);
      else if (pv !== undefined) out[k] = pv;
    });
    return out;
  }

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

  function cleanId(raw) {
    var id = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!id) return '';
    /* a bare ticker is not an id; leave it out rather than guessing a mapping */
    if (TICKER_RE.test(String(raw).trim())) return '';
    return ID_RE.test(id) ? id : '';
  }

  /* One category → one safe category. Extra keys the panel added (label, id)
     are preserved; anything unrecognised is dropped so a hand-edited JSON
     cannot smuggle a script tag into a rendered tab. */
  function cleanCategory(cat, index, usedIds) {
    var out = {};
    var baseId = String(cat && cat.id != null ? cat.id : 'category-' + (index + 1));
    var id = baseId.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '') || ('category-' + (index + 1));
    var candidate = id, n = 2;
    while (usedIds[candidate]) candidate = id + '-' + (n++);
    usedIds[candidate] = true;
    out.id = candidate;
    out.label = String((cat && cat.label) || candidate).slice(0, 60);
    out.coins = [];
    var seen = {};
    var list = Array.isArray(cat && cat.coins) ? cat.coins : [];
    list.forEach(function (raw) {
      var cid = cleanId(raw);
      if (!cid || seen[cid]) return;
      seen[cid] = true;
      out.coins.push(cid);
    });
    return out;
  }

  /* In-place dedupe for the dashboard: it must keep each `coins` ARRAY's
     identity, because the asset-row buttons hold a reference to that array (a
     replaced array made a move/delete edit the detached copy). Returns how many
     entries were removed, so the panel can say so. This is what guarantees the
     operator cannot add the same asset twice: every save passes through it. */
  function cleanInPlace(categories) {
    var dropped = 0;
    (Array.isArray(categories) ? categories : []).forEach(function (cat) {
      if (!isObj(cat)) return;
      var arr = Array.isArray(cat.coins) ? cat.coins : (cat.coins = []);
      var seen = {}, keep = [];
      arr.forEach(function (raw) {
        var id = cleanId(raw);
        if (!id || seen[id]) { dropped++; return; }
        seen[id] = true;
        keep.push(id);
      });
      arr.length = 0;
      for (var i = 0; i < keep.length; i++) arr.push(keep[i]);
    });
    return dropped;
  }

  /* The single door assets pass through on load, on save and on restore. */
  function cleanCategories(list) {
    var input = Array.isArray(list) ? list : [];
    var used = {};
    return input.filter(function (c) { return isObj(c); })
      .map(function (c, i) { return cleanCategory(c, i, used); });
  }

  var migrated = false;
  var lastNote = '';

  var MIGRATE = {
    CONTENT_KEYS: CONTENT_KEYS,
    LOOK_KEYS: LOOK_KEYS,
    cleanCategories: cleanCategories,
    cleanInPlace: cleanInPlace,
    cleanId: cleanId,
    mergeKnown: mergeKnown,
    deepMerge: deepMerge,

    apply: function (shipped, stored) {
      migrated = false;
      lastNote = '';
      if (!isObj(stored)) return deepMerge(shipped, {});

      var sv = (stored.meta && stored.meta.version) || null;
      var shv = (shipped.meta && shipped.meta.version) || null;
      var ss = (stored.meta && stored.meta.schema) || 0;
      var shs = (shipped.meta && shipped.meta.schema) || 0;

      /* Same build AND same asset format: the saved config is authoritative. */
      if (sv && sv === shv && ss === shs) {
        var same = deepMerge(shipped, stored);
        same.categories = cleanCategories(same.categories);
        same.meta = deepMerge(same.meta || {}, { schema: shs });
        return same;
      }

      /* Older build or older asset format: keep the saved settings, add the new
         build's options, upgrade the asset format, and keep the endpoint URLs
         owned by the build. */
      var out = mergeKnown(shipped, stored);
      out.categories = cleanCategories(out.categories);
      out.data = mergeKnown(shipped.data || {}, stored.data || {});
      /* the provider endpoints are build-owned, never operator-saved */
      out.data.proxyUrl = shipped.data.proxyUrl;
      out.data.directUrl = shipped.data.directUrl;
      out.meta = deepMerge(shipped.meta || {}, { migratedFrom: sv });

      migrated = true;
      lastNote = 'settings were from v' + (sv || '?') + ' — kept as saved, new options from v' + (shv || '?') +
        ' applied';
      return out;
    },

    get migrated() { return migrated; },
    get lastNote() { return lastNote; }
  };

  window.CM_MIGRATE = MIGRATE;
})();
