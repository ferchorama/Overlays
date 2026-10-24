/* ============================================================================
   Digital Assets Market — control panel logic
   ----------------------------------------------------------------------------
   Live-edits the config, previews it instantly over postMessage and (with a
   control server running) writes it to api/config so the OBS browser source
   follows along. Zero build, zero dependencies — same shape as the other
   widget admins.
   ========================================================================== */
(function () {
  'use strict';

  var LS_KEY = 'cm-config-v1';
  var preview = document.getElementById('preview');
  var SHIPPED = window.CM_DEFAULT_CONFIG || {};
  var APP_V = (SHIPPED.meta && SHIPPED.meta.version) || '1.0.0';
  var cfg = clone(SHIPPED);
  var saveTimer = null;
  var pushTimer = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
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
  function $(id) { return document.getElementById(id); }
  function status(msg, kind) { var s = $('status'); s.textContent = msg; s.className = 'status ' + (kind || ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* a stored config from an older build must not pin an outdated theme:
     matching version keeps every edit, a different version keeps CONTENT and
     takes the shipped LOOK (config-merge.js owns that decision). */
  function mergeIncoming(base, patch) {
    var M = window.CM_MIGRATE;
    var out = (M && typeof M.apply === 'function' && patch && patch.meta && patch.meta.version)
      ? M.apply(SHIPPED, patch)
      : deepMerge(base, patch);
    /* one door for assets, whatever route the config arrived by: a raw-JSON
       Apply cannot introduce a duplicate, a blank or a ticker */
    if (M && typeof M.cleanCategories === 'function') out.categories = M.cleanCategories(out.categories);
    if (window.CM_applyFont) window.CM_applyFont(out);
    return out;
  }

  function getPath(path) {
    var parts = path.split('.'), o = cfg;
    for (var i = 0; i < parts.length; i++) { o = o && o[parts[i]]; }
    return o;
  }
  function setPath(path, v) {
    var parts = path.split('.'), o = cfg;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (!isObj(o[k]) && !Array.isArray(o[k])) o[k] = {};
      o = o[k];
    }
    o[parts[parts.length - 1]] = v;
  }

  /* ------------------------------------------------------------ load / save */
  try {
    var ls = localStorage.getItem(LS_KEY);
    if (ls) cfg = mergeIncoming(cfg, JSON.parse(ls));
  } catch (e) { /* ignore */ }

  function syncVersion() {
    var v = (cfg.meta && cfg.meta.version) || APP_V;
    $('appVersion').textContent = v;
    $('versionMsg').textContent = 'build v' + v + ' · ' + (cfg.categories || []).length + ' categories · ' +
      'shipped baseline v' + APP_V;
  }

  /* Every save carries its own timestamp. The overlay keeps two copies of the
     config — one in localStorage, one in config.json on the server — and with no
     stamp it had no way to tell which was written last, so a local edit whose
     POST had not landed was replaced by the older server copy on the next poll.
     Last write wins, on the evidence. */
  function stamp() {
    cfg.meta = cfg.meta || {};
    cfg.meta.savedAt = Date.now();
  }

  var pendingSave = false;

  /* Message the live preview without saving. Boot and server-config adoption use
     this: opening the panel (or adopting the file that is on air) must never
     write config.json. */
  function postPreview() {
    if (preview && preview.contentWindow) {
      preview.contentWindow.postMessage({ type: 'cm:config', config: cfg }, '*');
    }
  }

  function push() {
    stamp();
    /* Record the asset format, not just the list: schema 2 = unique provider ids.
       The arrays themselves are NOT replaced here — the row buttons hold a
       reference to `cat.coins`, and swapping the array out from under them made
       a move/delete edit a detached copy (the click looked like a no-op). */
    cfg.meta.schema = (window.CM_MIGRATE && SHIPPED.meta && SHIPPED.meta.schema) || 2;
    /* one asset id per section, always: every save and every live push passes
       through this, so no path can store the same asset twice */
    var dupes = (window.CM_MIGRATE && CM_MIGRATE.cleanInPlace)
      ? CM_MIGRATE.cleanInPlace(cfg.categories) : 0;
    pendingSave = true;
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    $('rawJson').value = JSON.stringify(cfg, null, 2);
    syncVersion();
    /* the overlay rebuilds on every config message, so coalesce keystrokes */
    clearTimeout(pushTimer);
    pushTimer = setTimeout(postPreview, 120);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToServer, 600);
    if (dupes) status(dupes + ' duplicate asset entr' + (dupes === 1 ? 'y' : 'ies') + ' removed', 'warn');
    else status('updated (live)', 'ok');
  }

  /* What is written to disk is cleaned (duplicates, blanks, tickers) on a copy,
     so the editor keeps the exact arrays its handlers point at. */
  function cleanForSave(config) {
    var out = JSON.parse(JSON.stringify(config));
    if (window.CM_MIGRATE && CM_MIGRATE.cleanCategories) out.categories = CM_MIGRATE.cleanCategories(out.categories);
    out.meta = out.meta || {};
    out.meta.schema = (window.CM_MIGRATE && SHIPPED.meta && SHIPPED.meta.schema) || 2;
    return out;
  }

  function saveToServer() {
    stamp();
    var body = JSON.stringify(cleanForSave(cfg));
    return fetch('api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (r) {
      if (r.ok) { pendingSave = false; status('saved', 'ok'); }
      else status('local only (server said ' + r.status + ')', 'err');
    }).catch(function () {
      status('local only — serve this folder over HTTP to sync with OBS', 'err');
    });
  }

  /* The save is debounced, so closing the tab inside that window used to drop it
     — which is the other half of "my settings did not stick". sendBeacon is the
     one request the browser promises to finish during unload. */
  window.addEventListener('pagehide', function () {
    if (!pendingSave || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon('api/config', new Blob([JSON.stringify(cfg)], { type: 'application/json' }));
    } catch (e) { /* nothing else we can do during unload */ }
  });

  function command(cmd) {
    if (preview && preview.contentWindow) preview.contentWindow.postMessage(cmd, '*');
    var q = Object.keys(cmd).filter(function (k) { return k !== 'type'; })
      .map(function (k) { return k + '=' + encodeURIComponent(cmd[k]); }).join('&');
    fetch('api/command?' + q).catch(function () { /* no server, fine */ });
  }

  /* -------------------------------------------------------------- colours --
     #rgb / #rrggbb / rgb() / rgba() → { r, g, b, a, hex } and back. An
     <input type="color"> has no alpha channel, so the pickers edit hue while
     the alpha the config already had survives the round-trip.               */
  function parseColor(c) {
    if (typeof c !== 'string') return null;
    var s = c.trim();
    var m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1, hex: '#' + h.toLowerCase() };
    }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      var r = Math.round(p[0]), g = Math.round(p[1]), b = Math.round(p[2]);
      var a = p.length > 3 ? p[3] : 1;
      return { r: r, g: g, b: b, a: a, hex: rgbToHex(r, g, b) };
    }
    return null;
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
    }).join('');
  }
  function toHex(c) { var p = parseColor(c); return p ? p.hex : (typeof c === 'string' ? c : null); }
  function withAlpha(hex, a) {
    var p = parseColor(hex);
    if (!p) return hex;
    if (a >= 1) return p.hex;
    return 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + Math.round(a * 100) / 100 + ')';
  }
  function alphaOf(c) { var p = parseColor(c); return p ? p.a : 1; }

  /* --------------------------------------------------------------- bindings */
  /* Every bound control registers a reader so import / reset / raw-apply can
     pour the config back into the DOM without re-wiring listeners. */
  var REG = [];                 /* permanent bindings */
  var DYN = { cols: [], cats: [] };  /* rebuilt with their dynamic lists */

  function allEntries() { return REG.concat(DYN.cols, DYN.cats); }

  function applyEntry(e) {
    var node = e.node;
    if (!node) return;
    var v = getPath(e.path);
    if (e.kind === 'alpha') {
      node.value = Math.round(alphaOf(v) * 100) / 100;
      return;
    }
    if (node.type === 'checkbox') node.checked = !!v;
    else if (node.type === 'color') node.value = toHex(v) || '#000000';
    else node.value = v == null ? '' : v;
  }

  /* mirrored controls (Look ↔ Fonts, Content ↔ Columns) stay in step */
  function syncPath(path, exceptNode) {
    allEntries().forEach(function (e) {
      if (e.path === path && e.node !== exceptNode) applyEntry(e);
    });
  }

  function register(path, node, kind) {
    var e = { path: path, node: node, kind: kind || 'plain' };
    if (kind === 'dynCat') DYN.cats.push(e);
    else if (kind === 'dynCol') DYN.cols.push(e);
    else REG.push(e);
    return e;
  }

  function bind(path, id, opts) {
    opts = opts || {};
    var node = $(id);
    if (!node) return null;
    register(path, node);
    applyEntry({ path: path, node: node });

    var ev = (node.type === 'checkbox' || node.tagName === 'SELECT') ? 'change' : 'input';
    node.addEventListener(ev, function () {
      var v;
      if (node.type === 'checkbox') v = node.checked;
      else if (node.type === 'number') { v = node.value === '' ? '' : parseFloat(node.value); if (isNaN(v)) v = ''; }
      else v = node.value;

      /* keep the alpha the live config already had — a colour input cannot
         carry it, and reading it at EDIT time also picks up raw-JSON edits. */
      if (node.type === 'color') v = withAlpha(node.value, alphaOf(getPath(path)));

      if (opts.transform) v = opts.transform(v, cfg);
      setPath(path, v);
      syncPath(path, node);
      if (opts.after) opts.after(v);
      push();
    });
    return node;
  }

  /* a colour picker plus its own alpha field (min 0 / max 1 / step 0.01) */
  function bindAlpha(path, id) {
    var node = $(id);
    if (!node) return null;
    register(path, node, 'alpha');
    applyEntry({ path: path, node: node });
    node.addEventListener('input', function () {
      var a = parseFloat(node.value);
      if (isNaN(a)) a = 1;
      a = Math.max(0, Math.min(1, a));
      setPath(path, withAlpha(toHex(getPath(path)) || '#000000', a));
      syncPath(path, node);
      push();
    });
    return node;
  }

  /* ============================================================== categories */
  function renderCategoryLabels() {
    DYN.cats = DYN.cats.filter(function (e) { return e.path.indexOf('categories.') !== 0; });
    var wrap = $('categoryLabels');
    wrap.innerHTML = '';
    (cfg.categories || []).forEach(function (cat, i) {
      var field = document.createElement('div');
      field.className = 'field';
      var lab = document.createElement('label');
      lab.textContent = 'Tab ' + (i + 1) + ' label';
      var input = document.createElement('input');
      input.type = 'text';
      input.value = cat.label || '';
      input.addEventListener('input', function () {
        cat.label = input.value;
        renderCategories();          /* the full editor lives in another tab */
        push();
      });
      field.appendChild(lab);
      field.appendChild(input);
      wrap.appendChild(field);
      register('categories.' + i + '.label', input, 'dynCat');
    });
    if (!(cfg.categories || []).length) {
      wrap.innerHTML = '<p class="hint">No categories yet — add one in the Categories tab.</p>';
    }
  }

  /* ================================================================ assets
     The list of assets inside one section. Stored and edited as PROVIDER IDS:
     typing searches CoinGecko by name through the hub and only the picked
     result's id is saved, so a ticker can never become the stored value.
     Duplicates are refused in the section that already holds them; an empty
     section is a valid state (the board renders an explicit empty message). */
  var ASSET_META_KEY = 'cm-asset-meta-v1';
  var assetMeta = {};
  try { assetMeta = JSON.parse(localStorage.getItem(ASSET_META_KEY) || '{}') || {}; } catch (e) { assetMeta = {}; }
  var metaAskedAt = {};

  function saveAssetMeta() {
    try { localStorage.setItem(ASSET_META_KEY, JSON.stringify(assetMeta)); } catch (e) { /* quota */ }
  }
  function rememberCoins(list) {
    (list || []).forEach(function (c) {
      if (!c || !c.id) return;
      var prev = assetMeta[c.id] || {};
      assetMeta[c.id] = {
        name: c.name || prev.name || c.id,
        symbol: c.symbol || prev.symbol || ''
      };
    });
    saveAssetMeta();
  }
  function labelOf(id) { var m = assetMeta[id]; return (m && m.name) ? m.name : id; }
  function symbolOf(id) { var m = assetMeta[id]; return (m && m.symbol) ? m.symbol : ''; }

  /* names for ids the operator has not searched for yet (a shipped list, a
     config typed by hand). Reads the hub's cache — no provider call unless the
     cache is cold — and then repaints just the names. */
  function ensureAssetMeta(ids, done) {
    var now = Date.now(), want = [];
    (ids || []).forEach(function (id) {
      if (!id || assetMeta[id]) return;
      if (metaAskedAt[id] && now - metaAskedAt[id] < 600000) return;
      if (want.indexOf(id) === -1) want.push(id);
    });
    if (!want.length) { if (done) done(); return; }
    want.forEach(function (id) { metaAskedAt[id] = now; });
    fetch('api/market?ids=' + encodeURIComponent(want.join(',')) + '&sparkline=0&changes=24h', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { if (Array.isArray(rows)) rememberCoins(rows); })
      .catch(function () { /* the id is still a usable label */ })
      .then(function () { if (done) done(); });
  }

  function iconBtn(text, title, fn, extra) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ic' + (extra ? ' ' + extra : '');
    b.title = title;
    b.innerHTML = text;
    b.addEventListener('click', fn);
    return b;
  }

  function createAssetCombo(input, list, onPick) {
    return window.createCombobox({
      input: input,
      list: list,
      minChars: 1,
      debounceMs: 220,
      cacheMs: 5 * 60 * 1000,
      itemClass: 'asset-opt',
      nameClass: 'asset-opt__name',
      whereClass: 'asset-opt__where',
      emptyText: 'no matching assets',
      fetchResults: function (q, signal) {
        return fetch('api/search?q=' + encodeURIComponent(q), signal ? { signal: signal } : {})
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { return (j && j.coins) || []; });
      },
      itemKey: function (c) { return c.id; },
      optionAttrs: function (c) { return { 'data-id': c.id }; },
      renderOption: function (c) {
        return { label: c.name, note: (c.symbol ? c.symbol + ' · ' : '') + c.id, data: c };
      },
      onPick: function (c) {
        rememberCoins([c]);
        onPick(c);
      },
      onError: function () { status('asset search unavailable — is the hub running?', 'err'); }
    });
  }

  function renderAssets(cat, host, emptyEl, countEl) {
    host.innerHTML = '';
    var coins = cat.coins || (cat.coins = []);
    emptyEl.style.display = coins.length ? 'none' : 'block';
    countEl.textContent = coins.length + ' asset' + (coins.length === 1 ? '' : 's');

    coins.forEach(function (id, idx) {
      var row = document.createElement('div');
      row.className = 'asset';
      row.dataset.id = id;

      var main = document.createElement('div');
      main.className = 'asset__main';
      var nm = document.createElement('span');
      nm.className = 'asset__name';
      nm.textContent = labelOf(id);
      var sym = document.createElement('span');
      sym.className = 'asset__sym';
      sym.textContent = symbolOf(id);
      var idEl = document.createElement('span');
      idEl.className = 'asset__id';
      idEl.textContent = id;
      main.appendChild(nm);
      main.appendChild(sym);
      main.appendChild(idEl);
      row.appendChild(main);

      row.appendChild(iconBtn('&#8593;', 'move up', function () {
        if (idx === 0) return;
        coins.splice(idx - 1, 0, coins.splice(idx, 1)[0]);
        push(); renderCategories();
      }, 'up'));
      row.appendChild(iconBtn('&#8595;', 'move down', function () {
        if (idx === coins.length - 1) return;
        coins.splice(idx + 1, 0, coins.splice(idx, 1)[0]);
        push(); renderCategories();
      }, 'down'));
      row.appendChild(iconBtn('Change', 'replace this asset', function () {
        openAssetReplace(row, cat, idx, coins);
      }, 'change ic--wide'));
      row.appendChild(iconBtn('&#10005;', 'remove this asset', function () {
        coins.splice(idx, 1);
        push(); renderCategories();
      }, 'del'));

      host.appendChild(row);
    });

    /* names arrive later; repaint the labels only, so a focus ring inside the
       section is not thrown away */
    ensureAssetMeta(coins, function () {
      host.querySelectorAll('.asset').forEach(function (row) {
        var id = row.dataset.id;
        var nm = row.querySelector('.asset__name');
        var sym = row.querySelector('.asset__sym');
        if (nm) nm.textContent = labelOf(id);
        if (sym) sym.textContent = symbolOf(id);
      });
    });
  }

  /* An asset the provider cannot price would render as an empty row forever, so
     ask the hub before committing it to the board. A failed/absent answer is not
     a refusal: only a definite "no record for this id" blocks the add. */
  function withMarketData(coin, onYes, onNo) {
    fetch('api/market?ids=' + encodeURIComponent(coin.id) + '&sparkline=0&changes=24h', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!Array.isArray(rows)) return onYes();
        if (rows.some(function (c) { return c && c.id === coin.id; })) return onYes();
        onNo();
      })
      .catch(function () { onYes(); });
  }
  /* "Change asset": the row turns into a search box; picking a match replaces
     the id IN PLACE, so order is preserved. */
  function openAssetReplace(row, cat, idx, coins) {
    var original = coins[idx];
    row.classList.add('is-editing');
    row.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'asset-add';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'asset-search';
    input.placeholder = 'search a replacement by name…';
    input.autocomplete = 'off';
    var list = document.createElement('ul');
    list.className = 'asset-list';
    list.id = 'asset-replace-' + idx + '-' + Math.random().toString(36).slice(2, 7);
    list.hidden = true;
    wrap.appendChild(input);
    wrap.appendChild(list);

    var cancel = iconBtn('&#10005;', 'cancel', function () { renderCategories(); });
    row.appendChild(wrap);
    row.appendChild(cancel);

    createAssetCombo(input, list, function (coin) {
      if (coin.id === original) { renderCategories(); return; }
      if (coins.indexOf(coin.id) !== -1) {
        status('"' + coin.name + '" is already in ' + (cat.label || 'this section'), 'warn');
        renderCategories();
        return;
      }
      withMarketData(coin, function () {
        if (coins.indexOf(coin.id) !== -1) {
          status('"' + coin.name + '" is already in ' + (cat.label || 'this section'), 'warn');
          renderCategories();
          return;
        }
        coins[idx] = coin.id;
        push();
        renderCategories();
        status('replaced ' + original + ' with ' + coin.name + ' (' + coin.id + ')', 'ok');
      }, function () {
        renderCategories();
        status('no market data for "' + (coin.name || coin.id) + '" — pick another asset', 'err');
      });
    });

    input.focus();
  }

  /* Add-to-section search box below the list. */
  function mountAssetSearch(host, cat, catIndex, assetsEl, emptyEl, countEl) {
    host.innerHTML = '';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'asset-search';
    input.placeholder = 'add an asset by name…';
    input.autocomplete = 'off';
    var list = document.createElement('ul');
    list.className = 'asset-list';
    list.id = 'asset-add-' + catIndex;
    list.hidden = true;
    host.appendChild(input);
    host.appendChild(list);

    var combo = createAssetCombo(input, list, function (coin) {
      if ((cat.coins || []).indexOf(coin.id) !== -1) {
        status('"' + coin.name + '" is already in ' + (cat.label || 'this section'), 'warn');
        return;
      }
      withMarketData(coin, function () {
        /* the validation is async, so re-check the section before appending */
        if ((cat.coins || []).indexOf(coin.id) !== -1) {
          status('"' + coin.name + '" is already in ' + (cat.label || 'this section'), 'warn');
          return;
        }
        cat.coins = cat.coins || [];
        cat.coins.push(coin.id);
        push();
        renderCategories();
        status('added ' + coin.name + ' (' + coin.id + ')', 'ok');
      }, function () {
        status('no market data for "' + (coin.name || coin.id) + '" — pick another asset', 'err');
      });
    });

    input.addEventListener('input', combo.schedule);
    ensureAssetMeta(cat.coins, function () { renderAssets(cat, assetsEl, emptyEl, countEl); });
  }
  function renderCategories() {
    var list = $('categoryList');
    list.innerHTML = '';
    (cfg.categories || []).forEach(function (cat, i) {
      var row = document.createElement('div');
      row.className = 'cat';
      row.draggable = true;

      var head = document.createElement('div');
      head.className = 'cat__head';
      head.innerHTML = '<span class="grip" title="drag to reorder">&#10287;</span>';

      var idIn = document.createElement('input');
      idIn.type = 'text';
      idIn.className = 'id';
      idIn.value = cat.id || '';
      idIn.title = 'category id (used by ?category= in the URL)';
      idIn.addEventListener('input', function () { cat.id = idIn.value.trim(); push(); });

      var labelIn = document.createElement('input');
      labelIn.type = 'text';
      labelIn.className = 'label';
      labelIn.value = cat.label || '';
      labelIn.placeholder = 'Tab label';
      labelIn.addEventListener('input', function () {
        cat.label = labelIn.value;
        renderCategoryLabels();
        push();
      });

      var up = document.createElement('button');
      up.className = 'ic up';
      up.type = 'button';
      up.title = 'move up';
      up.innerHTML = '&#8593;';
      up.addEventListener('click', function () { move(cfg.categories, i, -1); afterReorder(); });

      var down = document.createElement('button');
      down.className = 'ic down';
      down.type = 'button';
      down.title = 'move down';
      down.innerHTML = '&#8595;';
      down.addEventListener('click', function () { move(cfg.categories, i, 1); afterReorder(); });

      var del = document.createElement('button');
      del.className = 'ic del';
      del.type = 'button';
      del.title = 'remove category';
      del.innerHTML = '&#10005;';
      del.addEventListener('click', function () {
        if ((cfg.categories || []).length <= 1) { status('at least one category is required', 'warn'); return; }
        cfg.categories.splice(i, 1);
        afterReorder();
      });

      head.appendChild(idIn);
      head.appendChild(labelIn);
      head.appendChild(up);
      head.appendChild(down);
      head.appendChild(del);

      var meta = document.createElement('div');
      meta.className = 'cat__meta';
      var count = document.createElement('span');
      count.className = 'count';
      count.textContent = (cat.coins || []).length + ' asset' + ((cat.coins || []).length === 1 ? '' : 's');
      meta.appendChild(count);

      var assets = document.createElement('div');
      assets.className = 'assets';
      var empty = document.createElement('p');
      empty.className = 'assets__empty';
      empty.textContent = 'No assets in this section — the board says so on air.';
      var add = document.createElement('div');
      add.className = 'asset-add';

      row.appendChild(head);
      row.appendChild(assets);
      row.appendChild(empty);
      row.appendChild(add);
      row.appendChild(meta);

      renderAssets(cat, assets, empty, count);
      mountAssetSearch(add, cat, i, assets, empty, count);

      row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        var moved = cfg.categories.splice(from, 1)[0];
        cfg.categories.splice(i, 0, moved);
        afterReorder();
      });

      list.appendChild(row);
    });
  }

  function move(arr, i, dir) {
    var j = i + dir;
    if (j < 0 || j >= arr.length) return false;
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
    return true;
  }

  function afterReorder() {
    renderCategoryLabels();
    renderCategories();
    push();
  }

  function addCategory() {
    var n = (cfg.categories || []).length + 1;
    cfg.categories = cfg.categories || [];
    cfg.categories.push({ id: 'category-' + n, label: 'CATEGORY ' + n, coins: [] });
    afterReorder();
    status('added category ' + n, 'ok');
  }

  function trimCoins() {
    var before = 0;
    (cfg.categories || []).forEach(function (cat) { before += (cat.coins || []).length; });
    if (window.CM_MIGRATE && CM_MIGRATE.cleanCategories) cfg.categories = CM_MIGRATE.cleanCategories(cfg.categories);
    var after = 0;
    (cfg.categories || []).forEach(function (cat) { after += (cat.coins || []).length; });
    afterReorder();
    status(before > after
      ? 'removed ' + (before - after) + ' blank / duplicate / invalid id(s)'
      : 'no duplicates or invalid ids', 'ok');
  }

  /* Restore the hardcoded assets per section. This is a per-section reset of the
     list only — labels, order and the whole look are the operator's and stay. */
  function restoreDefaultAssets() {
    if (!confirm('Restore every section\'s asset list to the shipped defaults?\n\n' +
                 'Labels, order and look are kept; only the assets inside each section change.')) return;
    var defaults = (SHIPPED.categories || []);
    var byId = {};
    defaults.forEach(function (d) { byId[d.id] = d; });
    var changed = 0;
    (cfg.categories || []).forEach(function (cat) {
      var d = byId[cat.id] || defaults[0];
      cat.coins = d ? (d.coins || []).slice() : [];
      changed++;
    });
    if (window.CM_MIGRATE && CM_MIGRATE.cleanCategories) cfg.categories = CM_MIGRATE.cleanCategories(cfg.categories);
    afterReorder();
    status('restored the default asset lists in ' + changed + ' section(s)', 'ok');
  }

  $('btnAddCategory').addEventListener('click', addCategory);
  $('btnAddCategory2').addEventListener('click', addCategory);
  $('btnSortCoins').addEventListener('click', trimCoins);
  $('btnRestoreAssets').addEventListener('click', restoreDefaultAssets);
  $('btnGoCategories').addEventListener('click', function () { showTab('categories'); });

  /* ================================================================= columns */
  var COLS = ['rank', 'asset', 'sparkline', 'price', 'change24h', 'change7d'];
  var COL_LABEL = {
    rank: 'Rank (#)', asset: 'Asset', sparkline: 'Trend (7d)',
    price: 'Price', change24h: '24h change', change7d: '7d change'
  };

  function colOrder() {
    if (!isObj(cfg.columns)) cfg.columns = {};
    if (!Array.isArray(cfg.columns.order)) cfg.columns.order = COLS.slice();
    return cfg.columns.order.filter(function (k) { return COLS.indexOf(k) !== -1; });
  }

  function renderColumns() {
    DYN.cols = DYN.cols.filter(function (e) { return e.path.indexOf('columns.labels.') !== 0; });
    var list = $('columnList');
    var addWrap = $('columnAdd');
    list.innerHTML = '';
    addWrap.innerHTML = '';
    var order = colOrder();

    order.forEach(function (key, i) {
      var row = document.createElement('div');
      row.className = 'col';
      row.draggable = true;

      var grip = document.createElement('span');
      grip.className = 'grip';
      grip.title = 'drag to reorder';
      grip.innerHTML = '&#10287;';

      var on = document.createElement('input');
      on.type = 'checkbox';
      on.className = 'on';
      on.checked = true;
      on.title = 'show this column';
      on.addEventListener('change', function () {
        if (!on.checked) {
          cfg.columns.order = order.filter(function (k) { return k !== key; });
          renderColumns(); rebuildOrderToolbar(); push();
        }
      });

      var label = document.createElement('input');
      label.type = 'text';
      label.className = 'label';
      label.value = (cfg.columns.labels && cfg.columns.labels[key]) || '';
      label.title = COL_LABEL[key] + ' header label';
      label.addEventListener('input', function () {
        cfg.columns.labels = cfg.columns.labels || {};
        cfg.columns.labels[key] = label.value;
        syncPath('columns.labels.' + key, label);
        push();
      });
      register('columns.labels.' + key, label, 'dynCol');

      var width = document.createElement('input');
      width.type = 'number';
      width.className = 'w';
      width.min = 20;
      width.max = 900;
      {
        /* The asset column used to be the flexible one and its width box was
           disabled. It is now a fixed width like the rest, so it is editable
           here with the others — size it for the longest asset name you show. */
        width.value = (cfg.columns.widths && cfg.columns.widths[key] != null) ? cfg.columns.widths[key] : '';
        width.title = 'width in px';
        width.addEventListener('input', function () {
          cfg.columns.widths = cfg.columns.widths || {};
          var w = parseFloat(width.value);
          cfg.columns.widths[key] = isNaN(w) ? 0 : w;
          push();
        });
      }

      var up = document.createElement('button');
      up.className = 'ic up';
      up.type = 'button';
      up.title = 'move left';
      up.innerHTML = '&#8593;';
      up.addEventListener('click', function () { if (move(cfg.columns.order, i, -1)) { renderColumns(); push(); } });

      var down = document.createElement('button');
      down.className = 'ic down';
      down.type = 'button';
      down.title = 'move right';
      down.innerHTML = '&#8595;';
      down.addEventListener('click', function () { if (move(cfg.columns.order, i, 1)) { renderColumns(); push(); } });

      row.appendChild(grip);
      row.appendChild(on);
      row.appendChild(label);
      row.appendChild(width);
      row.appendChild(up);
      row.appendChild(down);

      row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        var arr = cfg.columns.order;
        var moved = arr.splice(from, 1)[0];
        arr.splice(i, 0, moved);
        renderColumns(); push();
      });

      list.appendChild(row);
    });

    /* hidden columns get an "+ add" chip so they are never unreachable */
    COLS.filter(function (k) { return order.indexOf(k) === -1; }).forEach(function (key) {
      var b = document.createElement('button');
      b.className = 'btn btn--ghost chip';
      b.type = 'button';
      b.textContent = '+ ' + COL_LABEL[key];
      b.addEventListener('click', function () {
        cfg.columns.order = colOrder().concat([key]);
        renderColumns(); rebuildOrderToolbar(); push();
      });
      addWrap.appendChild(b);
    });
    if (!addWrap.children.length) {
      addWrap.innerHTML = '<span class="hint">All columns shown.</span>';
    }
  }

  function rebuildOrderToolbar() { /* chip list is rebuilt with the list itself */ }

  /* -------------------------------------------------------------- typeface */
  function paintFontPicker() {
    var host = $('fontPicker');
    if (!host) return;
    var current = (cfg.font && cfg.font.id) || '';
    host.innerHTML = '';
    (window.CM_FONTS || []).forEach(function (face) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'font-choice' + (face.id === current ? ' is-on' : '');
      btn.setAttribute('data-font', face.id);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', face.id === current ? 'true' : 'false');
      btn.style.fontFamily = window.CM_fontStack(face);
      var name = document.createElement('span');
      name.className = 'font-choice__name';
      name.textContent = face.name;
      var sample = document.createElement('span');
      sample.className = 'font-choice__sample';
      sample.textContent = 'BTC   64,230.18   +2.40%';
      btn.appendChild(name);
      if (face.system) {
        var meta = document.createElement('span');
        meta.className = 'font-choice__meta';
        meta.textContent = 'Installed on Windows';
        btn.appendChild(meta);
      }
      btn.appendChild(sample);
      btn.addEventListener('click', function () { chooseFont(face.id); });
      host.appendChild(btn);
    });
  }

  function chooseFont(id) {
    cfg.font = cfg.font || {};
    cfg.font.id = id;
    if (window.CM_applyFont) window.CM_applyFont(cfg);
    paintFontPicker();
    push();
  }

  /* ============================================================ refresh all */
  function refreshAll() {
    renderCategoryLabels();
    renderCategories();
    renderColumns();
    allEntries().forEach(applyEntry);
    paintFontPicker();
    $('rawJson').value = JSON.stringify(cfg, null, 2);
    syncPreviewRatio();
    syncVersion();
    push();
  }

  /* ================================================================ bindings */
  function syncUI() {
    /* ---- Content ---- */
    bind('header.text', 'c_headerText');
    bind('header.visible', 'c_headerVisible');
    bind('columns.visible', 'c_columnsVisible');
    bind('footer.enabled', 'c_footerOn');
    bind('columns.labels.rank', 'c_lbl_rank');
    bind('columns.labels.asset', 'c_lbl_asset');
    bind('columns.labels.sparkline', 'c_lbl_sparkline');
    bind('columns.labels.price', 'c_lbl_price');
    bind('columns.labels.change24h', 'c_lbl_change24h');
    bind('columns.labels.change7d', 'c_lbl_change7d');
    bind('maxRows', 'c_maxRows');

    /* ---- Look · panel ---- */
    bind('panel.background', 'c_panelBg');
    bindAlpha('panel.background', 'c_panelBgA');
    bind('panel.borderColor', 'c_panelBorderC');
    bindAlpha('panel.borderColor', 'c_panelBorderCA');
    bind('panel.radius', 'c_panelRadius');
    bind('panel.borderWidth', 'c_panelBorderW');
    bind('panel.opacity', 'c_panelOpacity');
    bind('panel.paddingX', 'c_panelPadX');
    bind('panel.paddingTop', 'c_panelPadTop');
    bind('panel.paddingBottom', 'c_panelPadBottom');
    bind('panel.shadow', 'c_panelShadow');
    bind('panel.width', 'c_panelW');
    bind('panel.glass.blur', 'c_glassBlur');
    bind('panel.glass.saturate', 'c_glassSat');
    bind('panel.glass.innerHighlight', 'c_glassInner');
    bind('panel.glass.sheen', 'c_glassSheen');

    /* ---- Look · title ---- */
    bind('header.align', 'c_titleAlign');
    bind('header.color', 'c_titleColor');
    bindAlpha('header.color', 'c_titleColorA');
    bind('header.letterSpacing', 'c_titleTracking');
    bind('header.ruleColor', 'c_titleRuleC');
    bindAlpha('header.ruleColor', 'c_titleRuleCA');
    bind('header.ruleWidth', 'c_titleRuleW');
    bind('header.paddingBottom', 'c_titlePadBottom');
    bind('header.rule', 'c_titleRule');
    bind('header.uppercase', 'c_titleUpper');
    bind('header.shadow', 'c_titleShadow');

    /* ---- Look · tabs ---- */
    bind('tabs.visible', 'c_tabsVisible');
    bind('tabs.position', 'c_tabsPos');
    bind('tabs.align', 'c_tabsAlign');
    bind('tabs.gap', 'c_tabsGap');
    bind('tabs.height', 'c_tabsH');
    bind('tabs.paddingX', 'c_tabsPadX');
    bind('tabs.radius', 'c_tabsRadius');
    bind('tabs.color', 'c_tabsColor');
    bindAlpha('tabs.color', 'c_tabsColorA');
    bind('tabs.activeColor', 'c_tabsActiveColor');
    bindAlpha('tabs.activeColor', 'c_tabsActiveColorA');
    bind('tabs.background', 'c_tabsBg');
    bindAlpha('tabs.background', 'c_tabsBgA');
    bind('tabs.activeBackground', 'c_tabsActiveBg');
    bindAlpha('tabs.activeBackground', 'c_tabsActiveBgA');
    bind('tabs.borderColor', 'c_tabsBorderC');
    bindAlpha('tabs.borderColor', 'c_tabsBorderCA');
    bind('tabs.activeBorderColor', 'c_tabsActiveBorderC');
    bindAlpha('tabs.activeBorderColor', 'c_tabsActiveBorderCA');
    bind('tabs.letterSpacing', 'c_tabsTracking');
    bind('tabs.marginTop', 'c_tabsMarginTop');
    bind('tabs.marginBottom', 'c_tabsMarginBottom');

    /* ---- Look · rows ---- */
    bind('rows.height', 'c_rowH');
    bind('rows.gap', 'c_rowGap');
    bind('rows.radius', 'c_rowRadius');
    bind('rows.padX', 'c_rowPadX');
    bind('rows.divider.color', 'c_divColor');
    bindAlpha('rows.divider.color', 'c_divColorA');
    bind('rows.divider.width', 'c_divW');
    bind('rows.zebraColor', 'c_zebraColor');
    bindAlpha('rows.zebraColor', 'c_zebraColorA');
    bind('rows.divider.enabled', 'c_divOn');
    bind('rows.zebra', 'c_zebra');

    /* ---- Look · logo ---- */
    bind('rows.logo.size', 'c_logoSize');
    bind('rows.logo.radius', 'c_logoRadius');
    bind('rows.logo.fallbackBackground', 'c_logoFallbackBg');
    bindAlpha('rows.logo.fallbackBackground', 'c_logoFallbackBgA');
    bind('rows.logo.fallbackColor', 'c_logoFallbackC');
    bindAlpha('rows.logo.fallbackColor', 'c_logoFallbackCA');

    /* ---- Look · text colours + palette ---- */
    bind('rows.asset.nameColor', 'c_assetNameC');
    bindAlpha('rows.asset.nameColor', 'c_assetNameCA');
    bind('rows.asset.tickerColor', 'c_assetTickerC');
    bindAlpha('rows.asset.tickerColor', 'c_assetTickerCA');
    bind('rows.price.color', 'c_priceC');
    bindAlpha('rows.price.color', 'c_priceCA');
    bind('colors.up', 'c_colUp');
    bind('colors.down', 'c_colDown');
    bind('colors.flat', 'c_colFlat');
    bind('colors.rankColor', 'c_colRank');

    /* ---- Columns ---- */
    bind('columns.height', 'c_colsH');
    bind('columns.color', 'c_colsColor');
    bindAlpha('columns.color', 'c_colsColorA');
    bind('columns.letterSpacing', 'c_colsTracking');
    bind('columns.ruleColor', 'c_colsRuleC');
    bindAlpha('columns.ruleColor', 'c_colsRuleCA');
    bind('columns.rule', 'c_colsRule');
    bind('data.sparkline', 'c_sparkLine');
    bind('rows.sparkline.colourLine', 'c_sparkColourLine');
    bind('rows.sparkline.width', 'c_sparkW');
    bind('rows.sparkline.height', 'c_sparkHeight');
    bind('rows.sparkline.strokeWidth', 'c_sparkStrokeW');
    bind('rows.sparkline.strokeColor', 'c_sparkStrokeC');
    bindAlpha('rows.sparkline.strokeColor', 'c_sparkStrokeCA');
    bind('rows.sparkline.endpointRadius', 'c_sparkEndR');
    bind('rows.sparkline.fill', 'c_sparkFill');

    /* ---- Fonts ---- */
    bind('header.size', 'c_f_titleSize');
    bind('tabs.size', 'c_f_tabsSize');
    bind('columns.size', 'c_f_colsSize');
    bind('rows.asset.nameSize', 'c_f_assetNameSize');
    bind('rows.asset.tickerSize', 'c_f_assetTickerSize');
    bind('rows.price.size', 'c_f_priceSize');
    bind('rows.change.size', 'c_f_changeSize');
    bind('rows.rankSize', 'c_f_rankSize');
    bind('rows.asset.gap', 'c_assetGap');

    bind('header.weight', 'c_f_titleWeight');
    bind('tabs.weight', 'c_f_tabsWeight');
    bind('columns.weight', 'c_f_colsWeight');
    bind('rows.asset.nameWeight', 'c_f_assetNameWeight');
    bind('rows.asset.tickerWeight', 'c_f_assetTickerWeight');
    bind('rows.price.weight', 'c_f_priceWeight');
    bind('rows.change.weight', 'c_f_changeWeight');
    bind('rows.asset.tickerLetterSpacing', 'c_assetTickerTrack');
    bind('rows.asset.nameMaxChars', 'c_assetNameMax');
    bind('tabs.uppercase', 'c_tabsUpper2');
    bind('columns.uppercase', 'c_colsUpper2');

    bind('rows.price.format', 'c_priceFormat');
    bind('rows.price.prefix', 'c_pricePrefix');
    bind('rows.price.decimals', 'c_priceDecimals');
    bind('rows.price.smallDecimals', 'c_priceSmallDec');
    bind('rows.change.showSign', 'c_changeSign');
    bind('rows.change.showArrow', 'c_changeArrow');
    bind('rows.change.decimals', 'c_changeDecimals');

    /* ---- Animation ---- */
    bind('animation.autoPlay', 'c_autoPlay');
    bind('animation.autoPlayDelay', 'c_autoPlayDelay');

    bind('animation.headerDuration', 'c_headerDuration');
    bind('animation.headerFrom', 'c_headerFrom');
    bind('animation.headerEase', 'c_headerEase');
    bind('animation.tabsDuration', 'c_tabsDuration');
    bind('animation.rowDuration', 'c_rowDuration');
    bind('animation.rowEase', 'c_rowEase');
    bind('animation.rowStagger', 'c_rowStagger');
    bind('animation.rowStart', 'c_rowStart');
    bind('animation.rowFrom', 'c_rowFrom');
    bind('animation.newRowDuration', 'c_newRowDuration');
    bind('animation.newRowFrom', 'c_newRowFrom');
    bind('animation.newRowEase', 'c_newRowEase');
    bind('animation.removeRowDuration', 'c_removeRowDuration');
    bind('animation.removeRowEase', 'c_removeRowEase');
    bind('animation.sparklineDraw', 'c_sparkDraw');

    /* trend line glow — travel, rest, repeat */
    bind('rows.sparkline.glow.enabled', 'c_glowOn');
    bind('rows.sparkline.glow.color', 'c_glowColor');
    bind('rows.sparkline.glow.length', 'c_glowLen');
    bind('rows.sparkline.glow.width', 'c_glowWidth');
    bind('rows.sparkline.glow.halo', 'c_glowHalo');
    bind('rows.sparkline.glow.opacity', 'c_glowOpacity');
    bind('rows.sparkline.glow.duration', 'c_glowDur');
    bind('rows.sparkline.glow.rest', 'c_glowRest');
    bind('rows.sparkline.glow.stagger', 'c_glowStagger');
    bind('animation.fadeRows', 'c_fadeRows');

    bind('animation.tabSwitch', 'c_tabSwitch');
    bind('animation.pillDuration', 'c_pillDuration');
    bind('animation.tabOutDuration', 'c_tabOutDuration');
    bind('animation.tabSwitchDuration', 'c_tabSwitchDuration');
    bind('animation.tabSwitchStagger', 'c_tabSwitchStagger');
    bind('animation.tabEase', 'c_tabEase');
    bind('animation.tabInEase', 'c_tabInEase');

    /* ---- Data ---- */
    bind('data.currency', 'c_currency');
    bind('data.sparkline', 'c_sparkData');
    bind('data.timeoutMs', 'c_timeout');
    bind('data.cacheKey', 'c_cacheKey');
    bind('data.useCacheOnFailure', 'c_useCache');

    /* ---- Advanced · stage ---- */
    bind('stage.width', 'c_stageW', { after: syncPreviewRatio });
    bind('stage.height', 'c_stageH', { after: syncPreviewRatio });
    bind('stage.fit', 'c_stageFit');
    bind('stage.alignX', 'c_stageAlignX');
    bind('stage.alignY', 'c_stageAlignY');
    bind('stage.background', 'c_stageBg');
  }

  /* ============================================================ topbar tools */
  $('btnIn').addEventListener('click', function () { command({ type: 'cm:command', action: 'in' }); status('entrance requested…', 'warn'); });
  $('btnHide').addEventListener('click', function () { command({ type: 'cm:command', action: 'hide' }); status('hide requested…', 'warn'); });
  $('btnPrev').addEventListener('click', function () { command({ type: 'cm:command', action: 'prev' }); });
  $('btnNext').addEventListener('click', function () { command({ type: 'cm:command', action: 'next' }); });

  /* ---------------------------------------------------------- manual update
     Force the hub to re-read CoinGecko, then bump the command the board already
     polls so it renders the fresh cache. The board has no timer of its own. */
  function dataUrl(force) {
    var ids = [];
    (cfg.categories || []).forEach(function (cat) {
      (cat.coins || []).forEach(function (id) {
        if (ids.indexOf(id) === -1) ids.push(id);
      });
    });
    if (!ids.length) throw new Error('this board has no assets yet — add one in the Categories tab');
    var q = 'ids=' + encodeURIComponent(ids.join(',')) +
      '&currency=' + encodeURIComponent((cfg.data && cfg.data.currency) || 'usd') +
      '&changes=24h,7d' +
      '&sparkline=' + ((cfg.data && cfg.data.sparkline === false) ? '0' : '1');
    return 'api/market?' + q + (force ? '&force=1' : '');
  }
  if (window.DataSync && $('btnRefresh') && $('dataStatus')) {
    window.DataSync.mount({
      app: 'market',
      button: $('btnRefresh'),
      status: $('dataStatus'),
      buildUrl: dataUrl,
      commandUrl: 'api/command?action=refresh',
      cooldownMs: 8000
    });
  }

  $('btnReset').addEventListener('click', function () {
    if (!confirm('Reset every setting to the factory defaults?\n\n' +
                 'This also overwrites the saved config on the server, so it cannot be undone.')) return;
    cfg = clone(SHIPPED);
    /* push() rewrites localStorage and re-posts to the overlay; saveToServer()
       then overwrites config.json. Without that POST the reset lived only in
       memory — the next reload pulled the old config.json back and it looked as
       though the button had done nothing. */
    refreshAll();
    push();
    clearTimeout(saveTimer);
    saveToServer().then(function () { status('reset to factory defaults', 'ok'); });
  });

  $('btnApplyRaw').addEventListener('click', function () {
    try {
      cfg = mergeIncoming(cfg, JSON.parse($('rawJson').value));
      refreshAll();
      status('json applied', 'ok');
    } catch (err) { status('invalid json: ' + err.message, 'err'); }
  });
  $('btnCopyRaw').addEventListener('click', function () {
    $('rawJson').select();
    try { document.execCommand('copy'); status('json copied', 'ok'); }
    catch (e) { status('copy failed — select and copy manually', 'err'); }
  });

  /* ================================================================= preview */
  function syncPreviewRatio() {
    var st = cfg.stage || {};
    var w = st.width || 1920, h = st.height || 1080;
    document.documentElement.style.setProperty('--stage-ratio', w + ' / ' + h);
  }
  syncPreviewRatio();

  $('optGuides').addEventListener('change', function () {
    $('previewStage').classList.toggle('guides', this.checked);
  });
  $('selZoom').addEventListener('change', function () {
    var scale = this.value === 'fit' ? 1 : parseFloat(this.value);
    preview.style.transform = scale === 1 ? 'none' : 'scale(' + scale + ')';
    preview.style.transformOrigin = 'center center';
  });

  /* ==================================================================== tabs */
  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('is-active', t.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel-body'), function (p) {
      p.classList.toggle('is-active', p.dataset.panel === name);
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { showTab(t.dataset.tab); });
  });

  /* ------------------------------------------- live status from the overlay */
  function pollData() {
    try {
      var w = preview.contentWindow;
      var CM = w && w.CM;
      if (!CM || !CM.engine || !CM.engine.board) return;
      var board = CM.engine.board;
      var st = board.state || {};
      var data = CM.getData ? CM.getData() : {};
      var ids = Object.keys(data || {});
      var want = 0;
      (cfg.categories || []).forEach(function (c) { want += (c.coins || []).length; });

      var c = cfg.colors || {};
      var html = '';
      if (st.fetchedAt) {
        html += 'updated ' + esc(new Date(st.fetchedAt).toLocaleTimeString()) +
          (st.fromCache ? ' <span class="warn">(cached)</span>' : '') + ' · ';
      }
      html += ids.length + '/' + want + ' coins loaded';
      if (st.error) html = '<span class="err">' + esc(st.error) + '</span> · ' + html;

      var cat = (cfg.categories || [])[board.activeIndex || 0];
      if (cat && data) {
        var shown = (cat.coins || []).slice(0, cfg.maxRows || 11).map(function (id) {
          var d = data[id];
          var name = d && d.symbol ? d.symbol.toUpperCase() : id;
          if (!d) return '<span style="color:' + esc(c.flat || '#8ea3c0') + '">' + esc(name) + ' —</span>';
          var v = d.change24h;
          /* direction is colour-coded from the live palette */
          var col = v > 0 ? (c.up || '#3ddc84') : (v < 0 ? (c.down || '#ff5b6e') : (c.flat || '#8ea3c0'));
          var txt = (v == null || isNaN(v)) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
          return '<span style="color:' + esc(col) + '">' + esc(name) + ' ' + txt + '</span>';
        });
        if (shown.length) html += ' · <strong>' + esc(cat.label || cat.id || '') + '</strong> ' + shown.join(' ');
      }
      $('dataMsg').innerHTML = html;
      $('dataMsg').className = 'msg' + (st.error ? ' err' : '');
    } catch (e) { /* cross-origin (file://) — ignore */ }
  }
  setInterval(pollData, 2000);

  /* ==================================================================== boot */
  function loadFromServer() {
    fetch('api/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (!remote || !isObj(remote) || !Object.keys(remote).length) {
          status('ready · v' + APP_V + ' (no stored config — defaults)', 'ok');
          return;
        }
        cfg = mergeIncoming(cfg, remote);
        refreshAll();
        status('loaded config from api/config · v' + ((cfg.meta && cfg.meta.version) || APP_V), 'ok');
      })
      .catch(function () {
        status('ready · v' + APP_V + ' (local only — serve over HTTP to sync)', 'warn');
      });
  }

  syncUI();
  paintFontPicker();
  renderCategoryLabels();
  renderCategories();
  renderColumns();
  allEntries().forEach(applyEntry);
  $('rawJson').value = JSON.stringify(cfg, null, 2);
  syncPreviewRatio();
  syncVersion();

  $('obsUrl').textContent = location.protocol === 'file:'
    ? 'index.html (or http://localhost:8790/market/index.html via Overlays/server.js)'
    : location.origin + location.pathname.replace(/admin\.html$/, 'index.html');

  /* Opening the panel must not write over config.json: read-first adoption below
     is what decides what is on air. */
  preview.addEventListener('load', function () {
    postPreview();
    status('ready · v' + ((cfg.meta && cfg.meta.version) || APP_V), 'ok');
  }, { once: true });
  setTimeout(postPreview, 400);
  status('ready · v' + APP_V);
  loadFromServer();

  /* ---------------------------------------------------------------- theme
     Shares the hub's key, so the panel and the hub can never disagree. */
  (function () {
    var KEY = 'obs-overlays-theme';
    var btn = document.getElementById('btnTheme');
    if (!btn) return;
    function active() { return document.documentElement.getAttribute('data-theme') || 'light'; }
    function label() {
      var next = active() === 'dark' ? 'Light' : 'Dark';
      btn.textContent = next;
      btn.setAttribute('aria-label', 'Switch to ' + next.toLowerCase() + ' theme');
      btn.title = 'Switch to ' + next.toLowerCase() + ' theme';
    }
    label();

    function apply(next) {
      document.documentElement.setAttribute('data-theme', next);
      label();
    }

    btn.addEventListener('click', function () {
      var next = active() === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
    });

    /* A localStorage write in another tab fires `storage` here but never in the
       tab that made it. That is what makes the hub and every open panel follow
       the toggle live instead of only on next load. */
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      if (e.newValue === 'dark' || e.newValue === 'light') apply(e.newValue);
      else apply(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    });
  })();

})();
