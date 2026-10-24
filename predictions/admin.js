/* ============================================================================
   Prediction Markets — control panel logic
   ----------------------------------------------------------------------------
   Types the board by hand: every market is a row in the Content tab, edited
   inline and pushed to the preview without a re-render, so the caret survives
   a keystroke. The config lives in localStorage, reaches OBS through
   `api/config` when server.js is running, and never depends on a network call
   to draw a panel.
   ========================================================================== */
(function () {
  'use strict';

  var LS_KEY = 'pm-config-v1';        /* config */
  var LS_STATE = 'pm-state-v1';       /* last command, so a late OBS source can pick it up */
  var preview = document.getElementById('preview');
  var SHIPPED = window.PM_DEFAULT_CONFIG || {};
  var cfg = clone(SHIPPED);
  var autoSaveTimer = null;

  /* The Polymarket tag list is thousands of entries and is only ever used to
     turn a name into an id, so it stays in this page's memory: the overlay has
     no use for it, and config.json is polled by every open browser source, so
     writing it there would hand each of them a multi-hundred-kilobyte file.
     Binding a tag writes the ID into the config — that is the part that has to
     survive a reload. */
  var polyTags = null;
  var polyBusy = false;

  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
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
  /* A config saved by an older build must not pin the old palette, but the
     hand-typed board inside it is the one thing that cannot be regenerated —
     PM_MIGRATE keeps the markets and takes the look from this build. */
  function mergeIncoming(base, patch) {
    var M = window.PM_MIGRATE;
    if (M && patch && patch.meta && patch.meta.version && M.versionOf(patch) !== M.versionOf(SHIPPED)) {
      return M.apply(SHIPPED, patch);
    }
    return deepMerge(base, patch);
  }
  function $(id) { return document.getElementById(id); }
  function status(msg, kind) {
    var s = $('status');
    if (!s) return;
    s.textContent = msg;
    s.className = kind || '';
  }

  /* The board's odds are hand-typed, so there is no venue to attribute them
     to. A config saved by an older build may still name one; it is dropped
     here as well as in the overlay, or the panel would load it, show it in the
     Left source field, and autosave it straight back to config.json.

     The strip is conditional, exactly as it is in the overlay: once
     `source: 'polymarket'` is selected the number genuinely does come from
     Polymarket, so naming it is honest and removing it would be the lie. Both
     halves of the app test `cfg.source` the same way, so they can never end up
     disagreeing about what is on air. */
  var DROPPED_SOURCES = ['polymarket'];

  function scrubSource(c) {
    try {
      if (c && c.source === 'polymarket') return c;
      var l = c && c.footer && c.footer.left;
      if (l && DROPPED_SOURCES.indexOf(String(l.source || '').trim().toLowerCase()) !== -1) {
        l.source = '';
      }
    } catch (e) { /* unexpected shape: leave it alone */ }
    return c;
  }

  try {
    var ls = localStorage.getItem(LS_KEY);
    if (ls) cfg = scrubSource(mergeIncoming(cfg, JSON.parse(ls)));
  } catch (e) { /* no storage, no problem — the panel still works */ }

  /* ------------------------------------------------------------ load / save */
  function getPath(path) {
    return String(path).split('.').reduce(function (o, k) { return o && o[k]; }, cfg);
  }
  function setPath(path, v) {
    var parts = String(path).split('.');
    var o = cfg;
    for (var i = 0; i < parts.length - 1; i++) { if (!isObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = v;
  }

  function push(opts) {
    opts = opts || {};
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    try {
      if (preview && preview.contentWindow) {
        preview.contentWindow.postMessage({ type: 'pm:config', config: cfg }, '*');
      }
    } catch (e) { /* no iframe yet */ }
    var raw = $('rawJson');
    if (raw && opts.raw !== false) raw.value = JSON.stringify(cfg, null, 2);
    if (opts.server !== false) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(saveToServer, 500);
    }
    updateCount();
    status(opts.msg || 'updated (live)', 'ok');
  }

  function saveToServer() {
    fetch('api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    }).then(function (r) {
      if (r.ok) status('saved to config.json', 'ok');
      else status('local only (server said ' + r.status + ')', 'err');
    }).catch(function () {
      status('local only — run "node server.js" to sync with OBS', 'err');
    });
  }

  /* ------------------------------------------------------- load what is on air
     This panel autosaves the WHOLE config on every edit, so whatever it holds
     when you touch a control is what replaces config.json. Building that from
     SHIPPED + this browser's localStorage was a data-loss bug: on a machine
     whose localStorage is empty or stale, the first keystroke (or one Presets
     click) rewrote the live file with the shipped sample markets and silently
     deleted every key that only existed in the file.

     So the file is read on load and merged OVER the local copy — it is the
     thing that is actually on air, and the overlay has been rendering it all
     along. Loading must never write, so this path does not push: a push here
     would POST the merged config straight back and a read-only visit to the
     panel would count as an edit. And it must not call syncUI() again either —
     syncUI binds every listener and is meant to run exactly once, so a second
     call would double-bind every control and fire each edit twice. */
  var mirrored = false;

  function adoptServerConfig(remote) {
    /* scrubSource after the merge, not before: whether the venue name is a lie
       depends on `source`, which may only exist in the file being merged in. */
    cfg = scrubSource(mergeIncoming(cfg, remote));
    refreshFields();
    renderMarkets();
    renderCategories();
    paintAllHex();
    var rawEl = $('rawJson');
    if (rawEl) rawEl.value = JSON.stringify(cfg, null, 2);
    updateCount();
  }

  function loadFromServer() {
    fetch('api/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (!remote || !isObj(remote) || !Object.keys(remote).length) {
          status('ready · v' + APP_V + ' (no stored config yet — using defaults)', 'warn');
          return;
        }
        adoptServerConfig(remote);
        mirrored = true;
        status('mirrors what is on air · config.json v' + ((cfg.meta && cfg.meta.version) || APP_V), 'ok');
      })
      .catch(function () {
        status('ready · v' + APP_V + ' (local only — serve over HTTP to sync)', 'warn');
      });
  }

  /* The delayed boot push and the load handler both report the same thing, and
     whichever lands last wins the status line — so they use one wording. */
  function readyNote() {
    return mirrored
      ? 'mirrors what is on air · v' + APP_V
      : 'ready · v' + APP_V;
  }

  /* Commands go to the preview iframe always, and to the hub when there is one:
     the iframe is what you see here, `api/command` is what a real OBS source
     polls. Neither failing may throw — the panel is usable with no server. */
  function command(action) {
    var msg = { type: 'pm:command', action: action };
    try {
      if (preview && preview.contentWindow) preview.contentWindow.postMessage(msg, '*');
    } catch (e) { /* ignore */ }
    try { localStorage.setItem(LS_STATE, JSON.stringify({ action: action, ts: Date.now() })); } catch (e) { /* ignore */ }
    if (location.protocol !== 'file:') {
      fetch('api/command?action=' + encodeURIComponent(action))
        .catch(function () { /* no server, fine */ });
    }
    status('command: ' + action, 'ok');
  }

  /* --------------------------------------------------------------- bindings */
  var BOUND = [];
  function setField(node, val) {
    if (!node) return;
    if (node.type === 'checkbox') node.checked = !!val;
    else if (node.type === 'color') node.value = toHex(val) || '#000000';
    else node.value = val == null ? '' : val;
  }

  function bind(path, id, opts) {
    opts = opts || {};
    var node = $(id);
    if (!node) return;
    var ev = (node.type === 'checkbox' || node.tagName === 'SELECT') ? 'change' : 'input';
    setField(node, getPath(path));
    node.addEventListener(ev, function () {
      var v;
      if (node.type === 'checkbox') v = node.checked;
      else if (node.type === 'number') { v = node.value === '' ? '' : parseFloat(node.value); if (isNaN(v)) v = ''; }
      else v = node.value;
      if (opts.transform) v = opts.transform(v, cfg);
      setPath(path, v);
      if (opts.after) opts.after(v);
      push();
    });
    if (opts.mirror) {
      /* two inputs, one config value (max rows and row height appear in both
         Content and Layout) — keep the twin honest while typing */
      var twin = $(opts.mirror);
      if (twin) {
        node.addEventListener('input', function () {
          if (twin.type === 'checkbox') twin.checked = node.checked;
          else if (twin.value !== node.value) twin.value = node.value;
        });
        BOUND.push({ node: twin, path: path });
      }
    }
    BOUND.push({ node: node, path: path });
  }

  /* A native colour input paints the colour and prints nothing, so a swatch
     raised the question "which blue is this?" and could only be answered by
     opening the OS picker. Mirror the value into the .hexval beside it. */
  function paintHex(input) {
    if (!input || !input.parentElement) return;
    var out = input.parentElement.querySelector('.hexval');
    if (out) out.textContent = String(input.value || '').toUpperCase();
  }
  function paintAllHex() {
    Array.prototype.forEach.call(document.querySelectorAll('input[type="color"]'), paintHex);
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.type === 'color') paintHex(e.target);
  }, true);

  function refreshFields() {
    BOUND.forEach(function (b) { setField(b.node, getPath(b.path)); });
    paintAllHex();
  }

  function syncUI() {
    /* ---- content: markets first, it is the whole point of this panel ---- */
    renderMarkets();
    bind('markets.sort', 'c_marketSort');

    bind('header.kicker.text', 'c_kicker');
    bind('header.title.text', 'c_title');
    bind('header.right.text', 'c_right');
    bind('header.right.sub', 'c_rightSub');
    bind('header.logo.src', 'c_logo');
    bind('header.logo.height', 'c_logoHeight');
    bind('header.logo.enabled', 'c_logoOn');
    bind('header.banner.enabled', 'c_bannerOn');
    bind('header.banner.src', 'c_bannerSrc');
    bind('header.banner.opacity', 'c_bannerOpacity');

    bind('hero.mode', 'c_heroMode');
    bind('hero.index', 'c_heroIndex');
    bind('hero.eyebrowLabel', 'c_heroEyebrow');
    bind('hero.showHistory', 'c_heroHistory');
    bind('hero.historyMode', 'c_historyMode');
    bind('hero.historyVolatility', 'c_historyVolatility');
    bind('hero.showWhenNotAsset', 'c_showWhenNotAsset');
    /* the Digital Assets board's travelling glow, on this board's line */
    bind('hero.chartGlow.enabled', 'c_chartGlow');
    bind('hero.chartGlow.color', 'c_chartGlowColor');
    bind('data.proxyUrl', 'c_dataProxy');
    bind('data.enabled', 'c_dataEnabled');
    bind('data.directUrl', 'c_dataDirect');
    /* An array field. bind() writes values straight into node.value, which
       stringifies an array into "a,b,c" — exactly the comma-separated form the
       textarea should show — so only the reading direction needs a transform. */
    bind('hero.assetKeywords', 'c_assetKeywords', {
      transform: function (raw) {
        return String(raw).split(',').map(function (w) { return w.trim(); }).filter(Boolean);
      }
    });

    bind('list.maxRows', 'c_maxRows', { mirror: 'c_maxRows2' });
    bind('list.rowHeight', 'c_rowHeight2', { mirror: 'c_rowHeight' });
    bind('list.showVolume', 'c_showVolume');
    bind('list.showChange', 'c_showChange');
    bind('list.showCategory', 'c_showCategory');

    bind('footer.left.text', 'c_footLeft');
    bind('footer.left.source', 'c_footSource');
    bind('footer.right.text', 'c_footRight');

    /* ---- look ---- */
    bind('palette.stage', 'c_palStage', { after: function () { } });
    bind('palette.ink', 'c_palInk');
    bind('palette.inkSoft', 'c_palInkSoft');
    bind('palette.dim', 'c_palDim');
    bind('palette.dimmer', 'c_palDimmer');
    bind('palette.line', 'c_palLine');
    bind('palette.lineSoft', 'c_palLineSoft');
    bind('palette.up', 'c_palUp');
    bind('palette.down', 'c_palDown');
    bind('palette.flat', 'c_palFlat');
    bind('stage.background', 'c_stageBg');
    bind('hero.probabilitySize', 'c_probSize');
    bind('hero.topicSize', 'c_topicSize');
    bind('footer.size', 'c_footSize');

    /* ---- layout ---- */
    bind('stage.width', 'c_stageW');
    bind('stage.height', 'c_stageH');
    bind('stage.fit', 'c_fit');
    bind('stage.alignX', 'c_alignX');
    bind('layout.safe', 'c_safe');
    bind('layout.safeX', 'c_safeX');
    bind('layout.heroWidth', 'c_heroWidth');
    bind('layout.gap', 'c_gap');

    /* ---- animation ---- */
    bind('animation.autoPlay', 'c_autoPlay');
    bind('animation.autoPlayDelay', 'c_autoPlayDelay');
    bind('animation.fadeDuration', 'c_fadeDuration');
    bind('animation.fadeDistance', 'c_fadeDistance');
    bind('animation.stagger', 'c_stagger');
    bind('animation.rowDuration', 'c_rowDuration');
    bind('animation.rowEase', 'c_rowEase');
    bind('rotate.enabled', 'c_rotateOn');
    bind('rotate.ms', 'c_rotateMs');

    /* ---- polymarket headlines ----
       `source` decides what goes on air, so changing it re-scrubs the venue
       name and rebuilds the category blocks; `fetched` changes how many
       headlines are on offer, so the per-category count selectors are rebuilt
       to match. Neither may write on its own — the binds autosave, the render
       only reads. */
    renderCategories();
    bind('source', 'c_source', {
      after: function () {
        scrubSource(cfg);
        refreshFields();
        renderCategories();
      }
    });
    bind('polymarket.entity', 'c_polyEntity');
    bind('polymarket.fetched', 'c_polyFetched', { after: function () { renderCategories(); } });
    bind('polymarket.sortKey', 'c_polySortKey');
  }

  /* ---------------------------------------------------------- markets editor
     The centrepiece: one row per market, every field inline, nothing rebuilt
     while you type. The row is created with createElement + textContent only —
     a question containing `<` is data here, never markup. */
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function mkNumInput(value, step) {
    var input = document.createElement('input');
    input.type = 'number';
    input.step = step || '1';
    input.className = 'mk-num';
    input.value = (value == null || value === '') ? '' : String(value);
    return input;
  }

  function fieldFor(item, key, el, conv) {
    el.addEventListener('input', function () {
      var v = conv ? conv(el.value) : el.value;
      item[key] = v;
      push();
    });
    return el;
  }

  function updateCount() {
    var list = $('marketList'), out = $('marketCount');
    if (!out) return;
    var items = (cfg.markets && cfg.markets.items) || [];
    var on = 0;
    items.forEach(function (it) { if (it.enabled !== false) on++; });
    out.textContent = Math.max(items.length, list ? list.children.length : 0) + ' market' +
      (items.length === 1 ? '' : 's') + ' · ' + on + ' enabled';
  }

  function renderMarkets() {
    var list = $('marketList');
    if (!list) return;
    list.innerHTML = '';
    cfg.markets = cfg.markets || { items: [], sort: 'manual' };
    var items = cfg.markets.items || (cfg.markets.items = []);
    var sorted = (cfg.markets.sort || 'manual') !== 'manual';

    items.forEach(function (item, i) {
      var row = document.createElement('div');
      row.className = 'market' + (item.enabled === false ? ' is-off' : '');
      row.draggable = !sorted;
      row.dataset.index = i;

      var grip = document.createElement('span');
      grip.className = 'grip';
      grip.textContent = '\u283F';
      grip.title = sorted ? 'sorting by ' + cfg.markets.sort + ' — switch Sort to manual to drag' : 'drag to reorder';
      grip.addEventListener('click', function () {
        /* the grip doubles as the on/off switch, same as the topics list */
        item.enabled = item.enabled === false;
        row.classList.toggle('is-off', item.enabled === false);
        push();
      });

      var topic = document.createElement('input');
      topic.type = 'text';
      topic.className = 'mk-topic';
      topic.placeholder = 'Market question';
      topic.value = item.topic || '';
      topic.title = item.topic || '';
      var wasOff = item.enabled === false;
      topic.addEventListener('input', function () {
        item.topic = topic.value;
        topic.title = topic.value;
        /* typing into a disabled market switches it on — no re-render, so the
           caret never jumps */
        if (item.enabled === false && String(topic.value).trim() !== '') {
          item.enabled = true;
          row.classList.remove('is-off');
          if (wasOff) { wasOff = false; status('market ' + (i + 1) + ' enabled', 'ok'); }
        }
        push();
      });
      topic.addEventListener('blur', function () {
        if (String(topic.value).trim() === '' && item.enabled !== false) {
          item.enabled = false;
          row.classList.add('is-off');
          push();
        }
      });
      topic.addEventListener('keydown', function (e) { if (e.key === 'Enter') topic.blur(); });

      /* value | step, in the order the overlay prints them */
      /* The asset this market is about, as a CoinGecko id. Feeds the real
         7-day price series when the history mode is 'asset'. */
      var asset = document.createElement('input');
      asset.type = 'text';
      asset.className = 'mk-asset';
      asset.placeholder = 'asset';
      asset.value = item.asset || '';
      asset.title = 'CoinGecko asset id, e.g. bitcoin or ethereum — used for the real 7-day price line';
      fieldFor(item, 'asset', asset);

      var probability = fieldFor(item, 'probability', mkNumInput(item.probability, '1'));
      probability.min = '0'; probability.max = '100'; probability.title = 'probability % (0–100)';
      var volume = fieldFor(item, 'volume', mkNumInput(item.volume, '1000'));
      volume.min = '0'; volume.title = '7-day volume in dollars';
      var change = fieldFor(item, 'change', mkNumInput(item.change, '0.1'));
      change.title = 'move in percentage points (may be negative)';

      var category = document.createElement('input');
      category.type = 'text';
      category.placeholder = 'Category';
      category.value = item.category || '';
      fieldFor(item, 'category', category);

      var ends = document.createElement('input');
      ends.type = 'date';
      ends.className = 'mk-date';
      ends.value = item.ends || '';
      fieldFor(item, 'ends', ends);

      var on = document.createElement('input');
      on.type = 'checkbox';
      on.title = 'render this market';
      on.checked = item.enabled !== false;
      on.addEventListener('change', function () {
        item.enabled = on.checked;
        row.classList.toggle('is-off', !on.checked);
        push();
      });

      /* Fetch proposes the asset's real numbers for approval. It never writes to
         the config itself: this panel autosaves on every change, so a direct
         write would reach the live OBS board immediately. */
      var fetchBtn = document.createElement('button');
      fetchBtn.type = 'button';
      fetchBtn.className = 'ic fetch';
      fetchBtn.title = item.asset
        ? 'fetch live numbers for ' + item.asset
        : 'set an asset id first (e.g. bitcoin)';
      /* Drawn rather than typed: U+21BB (↻) has no glyph in the UI font's
         coverage here, so it was falling back to a Greek upsilon. */
      fetchBtn.innerHTML =
        '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
        '<path d="M13.4 8A5.4 5.4 0 1 1 11.8 4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
        '<path d="M13.5 2.1v3.3h-3.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
      fetchBtn.disabled = !item.asset;
      fetchBtn.addEventListener('click', function () { beginFetch(i, fetchBtn); });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ic del';
      del.title = 'remove market';
      del.textContent = '\u2715';
      del.addEventListener('click', function () {
        cfg.markets.items.splice(i, 1);
        renderMarkets();
        push();
      });

      row.appendChild(grip);
      row.appendChild(topic);
      row.appendChild(asset);
      row.appendChild(probability);
      row.appendChild(volume);
      row.appendChild(change);
      row.appendChild(category);
      row.appendChild(ends);
      row.appendChild(on);
      row.appendChild(fetchBtn);
      row.appendChild(del);

      /* drag & drop reorder, same approach as the topics list */
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', String(i));
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        if (sorted) { status('reordering needs Sort = manual', 'warn'); return; }
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        var moved = cfg.markets.items.splice(from, 1)[0];
        cfg.markets.items.splice(i, 0, moved);
        renderMarkets();
        push();
      });

      list.appendChild(row);
    });
    updateCount();
  }

  var addBtn = $('btnAddMarket');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      cfg.markets = cfg.markets || {};
      if (!Array.isArray(cfg.markets.items)) cfg.markets.items = [];
      cfg.markets.items.push({ topic: '', probability: 50, volume: 0, change: 0, category: '', ends: '', enabled: true });
      if ((cfg.markets.sort || 'manual') !== 'manual') cfg.markets.sort = 'manual';
      refreshFields();
      renderMarkets();
      var rows = $('marketList').children;
      var last = rows[rows.length - 1];
      if (last) { var t = last.querySelector('.mk-topic'); if (t) t.focus(); }
      push({ msg: 'market added', raw: false });
    });
  }

  /* ------------------------------------------------------------ paste list
     topic | probability | volume | change — trailing fields optional. `%`, `$`,
     commas and a leading `+` are stripped so an operator can paste straight out
     of a spreadsheet. One bad line is reported, never silently swallowed. */
  function money(s) {
    var t = String(s).toLowerCase().replace(/[^0-9.\-kmb]/g, '');
    var mult = /b$/.test(t) ? 1e9 : /m$/.test(t) ? 1e6 : /k$/.test(t) ? 1e3 : 1;
    var v = parseFloat(t.replace(/[kmb]$/, ''));
    if (isNaN(v)) return null;
    return v * mult;
  }
  /* A topic may contain the delimiter (`Will Ethereum close above $6,000?`) and
     may be quoted for that reason, so the split is quote-aware rather than a
     plain `.split()`, and the delimiter is whichever of `|` / `,` actually
     yields numeric fields — a lone question, commas and all, stays whole. */
  function splitOn(line, ch) {
    var s = String(line);
    var out = [], cur = '', q = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"') { q = !q; cur += c; }
      else if (c === ch && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return String(x).replace(/^\s*"|"\s*$/g, '').trim(); });
  }
  function looksNumeric(s) {
    return /^[+-]?\s*[$€£]?\s*[\d,]+(\.\d+)?\s*[%kmb]?$/i.test(String(s).trim());
  }
  function scoreParts(p) {
    if (p.length < 2 || p[0] === '') return -1;
    var n = 0;
    for (var i = 1; i < Math.min(p.length, 4); i++) {
      if (p[i] !== '' && looksNumeric(p[i])) n++;
    }
    return n;
  }
  function splitLine(line) {
    var pipe = splitOn(line, '|');
    var comma = splitOn(line, ',');
    /* no pipe at all → the line is either one whole question or a CSV row */
    if (scoreParts(pipe) <= 0) return scoreParts(comma) > 0 ? comma : [String(line).trim()];
    return pipe;
  }
  function parsePaste(text) {
    var out = [], bad = 0;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (String(line).replace(/[\s|,\-"']/g, '') === '') return;   /* blank / separator noise */
      var parts = splitLine(line);
      var topic = parts[0];
      /* no topic → the line is a separator or a stray value row, not a market;
         it is counted as bad so the operator is told, never silently dropped */
      if (!topic) { bad++; return; }
      var p = money(parts[1]);
      var v = money(parts[2]);
      var c = money(parts[3]);
      out.push({
        topic: topic,
        probability: p == null ? 50 : Math.max(0, Math.min(100, p)),
        volume: v == null ? 0 : v,
        change: c == null ? 0 : c,
        category: (parts[4] || '').trim(),
        ends: (parts[5] || '').trim(),
        enabled: true
      });
    });
    return { items: out, bad: bad };
  }
  var pasteIn = $('pasteIn');
  var pasteHint = $('pasteCountHint');
  function refreshPasteHint() {
    if (!pasteIn || !pasteHint) return;
    var n = parsePaste(pasteIn.value).items.length;
    pasteHint.textContent = n + (n === 1 ? ' row' : ' rows');
  }
  if (pasteIn) pasteIn.addEventListener('input', refreshPasteHint);

  var pasteBtn = $('btnPasteAppend');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', function () {
      var parsed = parsePaste(pasteIn ? pasteIn.value : '');
      if (!parsed.items.length) {
        status('nothing to paste — one market per line', 'err');
        return;
      }
      cfg.markets = cfg.markets || {};
      if (!Array.isArray(cfg.markets.items)) cfg.markets.items = [];
      parsed.items.forEach(function (m) { cfg.markets.items.push(m); });
      if (pasteIn) pasteIn.value = '';
      refreshPasteHint();
      refreshFields();
      renderMarkets();
      status('added ' + parsed.items.length + ' market' + (parsed.items.length === 1 ? '' : 's') +
        (parsed.bad ? ' · skipped ' + parsed.bad + ' bad line' + (parsed.bad === 1 ? '' : 's') : ''),
        parsed.bad ? 'warn' : 'ok');
      push({ raw: false, msg: 'markets added', server: true });
    });
  }
  var pasteClear = $('btnPasteClear');
  if (pasteClear) {
    pasteClear.addEventListener('click', function () {
      if (pasteIn) pasteIn.value = '';
      refreshPasteHint();
    });
  }

  /* ------------------------------------------------- polymarket headline board
     The only network path in this panel, and it is fired by one button press —
     there is deliberately no timer, so the board can never change under the
     operator mid-sentence. The panel never talks to Polymarket itself: it asks
     the shared hub (which caches, retries and holds the one upstream
     connection) and writes the answer into this config, which is what the
     overlay already renders. A failed fetch leaves the previous headlines
     exactly where they were; a category that is already on air is never blanked
     by a network hiccup. */
  function polyItems(cat) { return (cat && Array.isArray(cat.items)) ? cat.items : []; }
  function polySelection(cat) { return (cat && Array.isArray(cat.selection)) ? cat.selection.map(String) : []; }
  function polyLabel(cat) { return String((cat && (cat.label || cat.id)) || 'category'); }

  /* The proxy lives in Overlays/server.js, the shared hub. predictions/server.js
     — the standalone server on 8791 — has no such route and answers a plain HTML
     404. That is the single likeliest way this panel fails in the real world and
     it is not an upstream problem, so it gets a message that names the fix
     instead of a status code. */
  var POLY_PROXY_HINT = 'the Polymarket proxy is served by Overlays/server.js — start the hub ' +
    '(node server.js) and open the panel from http://localhost:8790/predictions/admin.html';

  function clampFetched(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = 5;
    return Math.max(1, Math.min(20, n));
  }

  /* "2m ago" rather than a clock time: on air what matters is how stale the
     headlines are, not the moment they were pulled. */
  function agoText(ms) {
    var n = parseInt(ms, 10);
    if (!isFinite(n) || n <= 0) return 'never';
    var s = Math.max(0, Math.round((Date.now() - n) / 1000));
    if (s < 45) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 36) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  /* A fetched market that has not traded has NO price. Printing 0% would invent
     a number, and on an odds board a viewer reads that as information — so it
     prints an em dash, exactly as the overlay does. */
  function polyProb(v) {
    if (v === null || v === undefined || v === '') return '\u2014';
    var n = parseFloat(v);
    if (!isFinite(n)) return '\u2014';
    return (Math.round(n * 10) / 10) + '%';
  }
  function polyVol(v) {
    if (v === null || v === undefined || v === '') return '\u2014';
    var n = parseFloat(v);
    if (!isFinite(n)) return '\u2014';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  /* Which category block is which, and what its binding currently is. The tag
     list is searched slug-first, then by label, because a slug is what the
     upstream keys on and a label is what a human types into a config by hand. */
  function findTag(text) {
    var want = String(text == null ? '' : text).trim().toLowerCase();
    if (!want || !polyTags || !polyTags.length) return null;
    var i;
    for (i = 0; i < polyTags.length; i++) {
      if (String(polyTags[i].slug || '').toLowerCase() === want) return polyTags[i];
    }
    for (i = 0; i < polyTags.length; i++) {
      if (String(polyTags[i].label || '').toLowerCase() === want) return polyTags[i];
    }
    return null;
  }

  /* The resolution order is deliberate, and the slug is NOT preferred over the
     list even when it looks legal. `/events` documents only `tag_id`; an
     ignored filter does not fail — it returns the GLOBAL top, which would put
     the same five headlines in all three columns and look like a design choice
     rather than a bug. So a slug is resolved against the loaded tag list first
     and sent as an id wherever possible.

     `tag_slug` is documented for `/markets`, so an unresolved slug is a safe
     fallback there and only there. For `events` an unresolved slug is refused,
     which is what makes the "press Load tags" message appear instead of a board
     that is quietly wrong. */
  function resolveTagBinding(cat) {
    var id = String(cat.tagId == null ? '' : cat.tagId).trim();
    if (/^[0-9]+$/.test(id)) return { tagId: id };

    var slug = String(cat.tagSlug == null ? '' : cat.tagSlug).trim();
    var hit = findTag(slug);
    if (hit && String(hit.id == null ? '' : hit.id) !== '') {
      cat.tagId = String(hit.id);
      return { tagId: String(hit.id) };
    }

    var legalSlug = /^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug);
    var entity = String((cfg.polymarket || {}).entity || 'events');
    if (legalSlug && entity === 'markets') return { tagSlug: slug };
    return null;
  }

  /* Empty parameters are omitted rather than sent blank: the hub treats
     `tagId=` as no binding at all, and an empty `sortKey` as "derive it". */
  function polyTopUrl(cat, bind, limit) {
    var p = cfg.polymarket || {};
    var parts = [
      'what=top',
      'category=' + encodeURIComponent(String(cat.id || '')),
      'entity=' + encodeURIComponent(String(p.entity || 'events')),
      'limit=' + encodeURIComponent(String(limit))
    ];
    if (bind.tagId) parts.push('tagId=' + encodeURIComponent(bind.tagId));
    if (bind.tagSlug) parts.push('tagSlug=' + encodeURIComponent(bind.tagSlug));
    if (p.sortKey) parts.push('sortKey=' + encodeURIComponent(String(p.sortKey)));
    return String(p.endpoint || 'api/polymarket') + '?' + parts.join('&');
  }

  /* The fetched top N replaces `items` wholesale, and every fetched id becomes
     selected — that way `count` alone is enough for the common case and the
     selection list never starts empty. Anything the operator had already ticked
     that survived the reshuffle stays ticked, so an Update cannot silently
     un-tick a choice. Ids that are gone with the old list are dropped: they no
     longer name a headline, and keeping them would only mislead the overlay.
     Stored in ITEM order, because a hand-made selection never reorders the
     board — it only filters the fetched ranking. */
  function adoptItems(cat, items) {
    var prev = polySelection(cat);
    cat.items = items;
    var ids = items.map(function (it) { return String(it && it.id != null ? it.id : ''); });
    var wanted = ids.slice();
    prev.forEach(function (id) { if (ids.indexOf(id) !== -1 && wanted.indexOf(id) === -1) wanted.push(id); });
    cat.selection = ids.filter(function (id) { return wanted.indexOf(id) !== -1; });
  }

  function polyToggle(cat, id, on) {
    var ids = polyItems(cat).map(function (it) { return String(it && it.id != null ? it.id : ''); });
    var cur = polySelection(cat);
    if (!cur.length) cur = ids.slice();                 /* empty means "all" */
    if (on) { if (cur.indexOf(id) === -1) cur.push(id); }
    else cur = cur.filter(function (x) { return x !== id; });
    cat.selection = ids.filter(function (x) { return cur.indexOf(x) !== -1; });
    push();
  }

  function polyProgress(text, isErr) {
    var n = $('polyProgress');
    if (!n) return;
    n.textContent = text || '';
    n.className = 'muted polytick' + (isErr ? ' err' : '');
  }

  /* The board-wide line under the group head: when the last Update ran, how
     many headlines are held, and the last failure when there was one. */
  function renderBoardStatus() {
    var node = $('polyBoardStatus');
    if (!node) return;
    var p = cfg.polymarket || {};
    var cats = Array.isArray(p.categories) ? p.categories : [];
    var held = 0;
    cats.forEach(function (c) { held += polyItems(c).length; });
    var bits = [];
    bits.push(p.updatedAt ? 'updated ' + agoText(p.updatedAt) : 'never updated');
    bits.push(held + (held === 1 ? ' headline' : ' headlines') + ' held');
    bits.push(polyTags && polyTags.length ? polyTags.length + ' tags loaded' : 'tags not loaded');
    if (p.lastError) bits.push(p.lastError);
    node.textContent = bits.join(' \u00b7 ');
    node.className = 'group__meta' + (p.lastError ? ' err' : '');
  }

  /* One block per category, in config order. Everything is createElement +
     textContent: a headline is data here, never markup — one containing "<"
     must not be able to rewrite the panel. */
  function polyCategoryBlock(cat) {
    var p = cfg.polymarket || {};
    var block = document.createElement('div');
    block.className = 'polycat';

    var head = document.createElement('div');
    head.className = 'polycat__head';
    var name = document.createElement('strong');
    name.className = 'polycat__name';
    name.textContent = polyLabel(cat);
    var stat = document.createElement('span');
    var when = agoText(p.updatedAt);
    if (cat.error) {
      stat.className = 'polycat__status err';
      stat.textContent = cat.error;
    } else {
      var n = polyItems(cat).length;
      stat.className = 'polycat__status';
      stat.textContent = n + (n === 1 ? ' headline' : ' headlines') + ' held \u00b7 fetched ' + when;
    }
    head.appendChild(name);
    head.appendChild(stat);
    block.appendChild(head);

    /* --- the tag this category fetches --- */
    var bindRow = document.createElement('div');
    bindRow.className = 'polyrow';
    var pick;
    if (polyTags && polyTags.length) {
      pick = document.createElement('select');
      pick.className = 'poly-tag';
      pick.title = 'the Polymarket tag this category fetches';
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'tag\u2026';
      pick.appendChild(blank);
      polyTags.forEach(function (t) {
        var o = document.createElement('option');
        o.value = String(t.id);
        o.textContent = String(t.label || t.slug || t.id) + '  \u00b7  ' + t.id;
        pick.appendChild(o);
      });
      pick.value = /^[0-9]+$/.test(String(cat.tagId == null ? '' : cat.tagId)) ? String(cat.tagId) : '';
      pick.addEventListener('change', function () {
        cat.tagId = pick.value;
        push({ msg: polyLabel(cat) + ' bound to tag ' + (pick.value || '(none)') });
      });
    } else {
      pick = document.createElement('input');
      pick.type = 'text';
      pick.className = 'poly-tagid';
      pick.placeholder = 'tag id';
      pick.title = 'the Polymarket tag id — press Load tags to pick from the live list';
      pick.value = cat.tagId == null ? '' : String(cat.tagId);
      pick.addEventListener('input', function () {
        cat.tagId = String(pick.value).trim();
        push();
      });
    }
    bindRow.appendChild(pick);

    var slug = document.createElement('input');
    slug.type = 'text';
    slug.className = 'poly-slug';
    slug.placeholder = 'tag slug';
    slug.title = 'used to find the id on Update, and as the filter when there is no id';
    slug.value = cat.tagSlug == null ? '' : String(cat.tagSlug);
    slug.addEventListener('input', function () {
      cat.tagSlug = String(slug.value).trim();
      push();
    });
    bindRow.appendChild(slug);
    block.appendChild(bindRow);

    if (!(polyTags && polyTags.length)) {
      var hint = document.createElement('p');
      hint.className = 'hint polytagid';
      hint.textContent = 'No tag list loaded — press Load tags to pick a real tag id, or Update will try this slug.';
      block.appendChild(hint);
    }

    /* --- how many headlines this category renders (0 = hidden) --- */
    var countRow = document.createElement('div');
    countRow.className = 'polyrow';
    var cl = document.createElement('span');
    cl.className = 'polylbl';
    cl.textContent = 'Render';
    var count = document.createElement('select');
    count.className = 'poly-count';
    count.title = 'how many headlines go on air for this category';
    var top = clampFetched(p.fetched);
    for (var k = 0; k <= top; k++) {
      var opt = document.createElement('option');
      opt.value = String(k);
      opt.textContent = k === 0 ? 'hide' : String(k);
      count.appendChild(opt);
    }
    var shown = parseInt(cat.count, 10);
    if (!isFinite(shown)) shown = Math.min(3, top);
    count.value = String(Math.max(0, Math.min(top, shown)));
    count.addEventListener('change', function () {
      var v = parseInt(count.value, 10);
      cat.count = isFinite(v) ? Math.max(0, v) : 0;
      push({ msg: polyLabel(cat) + ': ' + (cat.count === 0 ? 'hidden' : cat.count + ' headline(s)') });
    });
    countRow.appendChild(cl);
    countRow.appendChild(count);
    /* the count is only meaningful against what was actually fetched */
    var heldNote = document.createElement('span');
    heldNote.className = 'muted tiny';
    heldNote.textContent = polyItems(cat).length + ' fetched';
    countRow.appendChild(heldNote);
    block.appendChild(countRow);

    /* --- which of the fetched headlines render --- */
    var list = document.createElement('div');
    list.className = 'polyitems';
    var items = polyItems(cat);
    if (!items.length) {
      var none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'No headlines yet — press Update.';
      list.appendChild(none);
    } else {
      var sel = polySelection(cat);
      items.forEach(function (it) {
        var id = String(it && it.id != null ? it.id : '');
        var row = document.createElement('label');
        row.className = 'polyitem';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'poly-pick';
        cb.dataset.id = id;
        cb.checked = !sel.length || sel.indexOf(id) !== -1;   /* empty selection = all */
        cb.addEventListener('change', function () { polyToggle(cat, id, cb.checked); });
        var title = document.createElement('span');
        title.className = 'polyitem__title';
        title.textContent = String(it.title || '(untitled)');
        title.title = String(it.url || it.title || '');
        var meta = document.createElement('span');
        meta.className = 'polyitem__meta';
        meta.textContent = polyProb(it.probability) + ' \u00b7 ' + polyVol(it.volume24hr) + ' 24h';
        row.appendChild(cb);
        row.appendChild(title);
        row.appendChild(meta);
        list.appendChild(row);
      });
    }
    block.appendChild(list);
    return block;
  }

  function renderCategories() {
    var host = $('polyCategories');
    if (!host) return;
    host.innerHTML = '';
    cfg.polymarket = cfg.polymarket || {};
    var p = cfg.polymarket;
    if (!Array.isArray(p.categories)) p.categories = [];
    p.categories.forEach(function (cat) { host.appendChild(polyCategoryBlock(cat)); });
    renderBoardStatus();
  }

  /* The tag list is fetched, never shipped: ids are the only stable handle on a
     tag, and guessing them from a slug is what `tagSlug` exists to fall back
     to. It lives in memory only — see the top of this file.

     Returns its promise so Update can wait for the list before it resolves a
     slug: the first Update on a fresh config needs the ids, and making the
     operator find the Load tags button first would be a puzzle, not a step. */
  function loadTags() {
    var p = cfg.polymarket = cfg.polymarket || {};
    var btn = $('btnPolyTags');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
    polyProgress('loading the tag list\u2026');
    return fetch(String(p.endpoint || 'api/polymarket') + '?what=tags', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        var tags = (body && Array.isArray(body.tags)) ? body.tags : [];
        if (!tags.length) {
          polyProgress('no tags came back', true);
          status('no tags came back — is the hub running?', 'err');
          return;
        }
        polyTags = tags;
        renderCategories();
        polyProgress(tags.length + ' tags loaded — pick one per category', false);
        status(tags.length + ' Polymarket tags loaded', 'ok');
      })
      .catch(function () {
        polyProgress('the tag list failed to load', true);
        status('the tag list failed to load', 'err');
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Load tags'; }
        renderBoardStatus();
      });
  }

  /* One GET squashed into a shape the loop can branch on. A non-JSON reply or a
     dead socket is reported, never thrown, because every category must get its
     turn. */
  function fetchTop(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      return r.json().then(
        function (body) { return { ok: !!r.ok, status: r.status, body: body }; },
        /* An unparseable body is never a board: the hub always answers JSON, so
           this is a different server talking, not an empty set of headlines. */
        function () { return { ok: false, status: r.status, body: null, notJson: true }; }
      );
    }, function (e) {
      return { ok: false, status: 0, body: null, why: (e && e.message) || 'the hub did not answer' };
    }).then(function (res) {
      if (res.ok) return res;
      var m = res.body && res.body.error && res.body.error.message;
      /* A 404, or any reply that is not JSON, almost always means this panel was
         opened from predictions/server.js (port 8791) instead of the shared hub:
         the /api/polymarket proxy lives in Overlays/server.js only, and the
         standalone server answers that path with a plain HTML 404. "HTTP 404"
         would send the operator looking at Polymarket when the problem is the
         server they opened the panel from. A real upstream 404 still arrives as
         JSON with a message, so it keeps its own wording. */
      if (!m && (res.status === 404 || res.notJson)) m = POLY_PROXY_HINT;
      if (!m) m = res.status ? ('HTTP ' + res.status) : res.why;
      res.message = String(m || 'the fetch failed');
      return res;
    });
  }

  /* The whole Update. Categories are resolved, fetched and committed one at a
     time, in config order, and a category that fails never stops the ones after
     it: one dead tag must not cost the operator the other two headlines. */
  function updateHeadlines() {
    if (polyBusy) return;
    var p = cfg.polymarket = cfg.polymarket || {};
    if (!Array.isArray(p.categories)) p.categories = [];
    var cats = p.categories;
    var limit = clampFetched(p.fetched);
    var btn = $('btnPolyUpdate');
    var failed = [];
    var held = 0;
    var i = 0;

    polyBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Updating\u2026'; }

    function step() {
      if (i >= cats.length) return Promise.resolve();
      var cat = cats[i++];
      var label = polyLabel(cat);
      polyProgress('fetching ' + label + '\u2026');
      var bind = resolveTagBinding(cat);
      if (!bind) {
        cat.error = 'no Polymarket tag binding for "' + String(cat.tagSlug || cat.id || '') +
          '" \u2014 press Load tags and pick one';
        failed.push(cat);
        renderCategories();
        return step();
      }
      return fetchTop(polyTopUrl(cat, bind, limit)).then(function (res) {
        if (res.ok) {
          var items = (res.body && Array.isArray(res.body.items)) ? res.body.items : [];
          adoptItems(cat, items);
          cat.error = '';
          held += items.length;
        } else {
          /* the previous headlines stay untouched: a category already on air is
             never blanked by a failed fetch */
          cat.error = res.message;
          failed.push(cat);
        }
        renderCategories();
        return step();
      });
    }

    function finish() {
      polyBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Update headlines'; }
      p.updatedAt = Date.now();
      p.lastError = failed.length ? 'failed: ' + failed.map(polyLabel).join(', ') : '';
      renderCategories();
      var msg = held + (held === 1 ? ' headline' : ' headlines') + ' fetched' +
        (failed.length ? ' \u00b7 ' + failed.length + ' failed (' + failed.map(polyLabel).join(', ') + ')' : '');
      polyProgress(msg, failed.length > 0);
      push({ msg: msg });
    }

    /* One tag-list load, and only when some category still needs resolving.
       `/events` wants a numeric tag id, and `tagSlug` alone cannot supply one,
       so the first Update against a fresh config must look the slugs up before
       it can fetch anything. Doing it here rather than making it a manual
       prerequisite means the shipped crypto/economy/finance slugs work on the
       first press. */
    var needsTags = cats.some(function (c) {
      return !/^[0-9]+$/.test(String(c.tagId == null ? '' : c.tagId).trim());
    });
    var pre = (needsTags && !(polyTags && polyTags.length)) ? loadTags() : Promise.resolve();
    pre.then(function () { return step(); }).then(finish, finish);
  }

  var polyUpdateBtn = $('btnPolyUpdate');
  if (polyUpdateBtn) polyUpdateBtn.addEventListener('click', updateHeadlines);
  var polyTagsBtn = $('btnPolyTags');
  if (polyTagsBtn) polyTagsBtn.addEventListener('click', loadTags);

  /* ------------------------------------------------------------ colour utils
     A native <input type="color"> only speaks #rrggbb, so a palette value in
     another notation is reduced to its hex for editing. The palette is the only
     place this overlay stores colour as plain hex. */
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
      return { r: r, g: g, b: b, a: p.length > 3 ? p[3] : 1, hex: rgbToHex(r, g, b) };
    }
    return null;
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
    }).join('');
  }
  function toHex(c) { var p = parseColor(c); return p ? p.hex : (typeof c === 'string' ? c : null); }

  /* ---------------------------------------------------------------- presets
     Every preset is a tasteful DARK editorial board. Graphite is the shipped
     look and the others are close relatives, so switching one never turns the
     board into a different product. */
  var PRESETS = {
    graphite: {
      stage: { background: '#0f1013' },
      palette: { name: 'graphite', stage: '#0f1013', ink: '#f4f4f6', inkSoft: '#e8e9ec', dim: '#7d828c',
                 dimmer: '#5d626b', line: '#2a2d33', lineSoft: '#22252b', up: '#4cc38a', down: '#e5605e', flat: '#9a9fa9' }
    },
    terminal: {
      stage: { background: '#05070a' },
      palette: { name: 'terminal', stage: '#05070a', ink: '#eaf7ee', inkSoft: '#d8ecdf', dim: '#6f8a79',
                 dimmer: '#4d6155', line: '#1b2620', lineSoft: '#141d18', up: '#3ddc84', down: '#ff6b6b', flat: '#84998c' }
    },
    blueprint: {
      stage: { background: '#0a1424' },
      palette: { name: 'blueprint', stage: '#0a1424', ink: '#eef5ff', inkSoft: '#dce8f7', dim: '#7f97b8',
                 dimmer: '#5b7290', line: '#1e2f4a', lineSoft: '#16243a', up: '#4aa3ff', down: '#ff7a7a', flat: '#93a6c0' }
    },
    broadcast: {
      stage: { background: '#000000' },
      palette: { name: 'broadcast', stage: '#000000', ink: '#ffffff', inkSoft: '#f0f0f0', dim: '#a8a8a8',
                 dimmer: '#7a7a7a', line: '#2b2b2b', lineSoft: '#1f1f1f', up: '#34d17e', down: '#ff5747', flat: '#c8c8c8' }
    }
  };

  Array.prototype.forEach.call(document.querySelectorAll('.preset'), function (b) {
    b.addEventListener('click', function () { applyPreset(b.dataset.preset); });
  });

  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    cfg = deepMerge(cfg, clone(p));
    refreshFields();
    renderMarkets();
    push({ msg: 'preset: ' + name });
  }

  var palReset = $('btnPaletteReset');
  if (palReset) {
    palReset.addEventListener('click', function () {
      var g = (window.PM_PALETTES && window.PM_PALETTES.graphite) || PRESETS.graphite.palette;
      cfg.palette = Object.assign({}, cfg.palette, clone(g));
      cfg.stage = Object.assign({}, cfg.stage, { background: g.stage });
      refreshFields();
      push({ msg: 'palette reset to graphite' });
    });
  }

  /* ------------------------------------------------------------ fetch & review
     One explicit click looks up a market's asset and proposes the genuinely
     external numbers. Nothing is written until Apply, because this panel
     autosaves into config.json and the OBS source follows it within ~1.5s.

     Deliberately NOT fetched: `probability`. That is the operator's editorial
     call and cannot be read off a price feed; overwriting it with the 24h move
     would quietly change what the market claims. */
  var fetchCache = {};       /* asset id -> { row, at, source } */
  var pendingFetch = null;   /* { index, props } awaiting Apply or Discard */
  var FETCH_TTL = 120000;

  function beginFetch(index, btn) {
    var item = (cfg.markets.items || [])[index];
    if (!item || !item.asset) { status('set an asset id first', 'err'); return; }
    var asset = String(item.asset).trim().toLowerCase();

    var cached = fetchCache[asset];
    if (cached && Date.now() - cached.at < FETCH_TTL) {
      showFetchReview(index, cached.row, cached.source + ' (cached)');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '\u2026'; }
    status('fetching ' + asset + '\u2026');

    var urls = dataUrls(asset);
    var settled = false;

    function finish(row, source) {
      settled = true;
      if (btn) { btn.disabled = false; btn.textContent = '\u21BB'; }
      if (row) {
        fetchCache[asset] = { row: row, at: Date.now(), source: source };
        showFetchReview(index, row, source);
      } else {
        status('fetch failed for ' + asset, 'err');
      }
    }

    /* Hub proxy first — it is already cached upstream and serves every overlay —
       then the public endpoint. Both only on an explicit click, so the free
       tier's rate limit is not a risk here. */
    function attempt(i) {
      if (i >= urls.length) { finish(null); return; }
      fetch(urls[i].url, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (rows) {
          var row = pickRow(rows, asset);
          if (!row) { attempt(i + 1); return; }
          finish(row, urls[i].label);
        })
        .catch(function () { attempt(i + 1); });
    }
    attempt(0);
  }

  function dataUrls(asset) {
    var d = cfg.data || {};
    var cur = encodeURIComponent(d.currency || 'usd');
    var out = [];
    if (d.enabled !== false && d.proxyUrl) {
      out.push({
        url: d.proxyUrl + '?ids=' + encodeURIComponent(asset) + '&currency=' + cur + '&sparkline=1',
        label: 'hub proxy'
      });
    }
    if (d.directUrl) {
      out.push({
        url: d.directUrl + '?vs_currency=' + cur + '&ids=' + encodeURIComponent(asset) +
             '&price_change_percentage=7d',
        label: 'CoinGecko'
      });
    }
    return out;
  }

  function pickRow(rows, asset) {
    if (!Array.isArray(rows)) return null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      if (r.id === asset) return r;
      if (String(r.symbol || '').toLowerCase() === asset) return r;
    }
    return rows[0] || null;
  }

  function asNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(String(v).replace(/[^0-9.eE+-]/g, ''));
    return isFinite(n) ? n : null;
  }

  function moneyShort(v) {
    var n = asNum(v);
    if (n === null) return '\u2014';
    if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (Math.abs(n) >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  }

  /* Which external numbers this response can supply. `volume` uses CoinGecko's
     24-hour dollar volume: there is no 7-day volume on this endpoint, and the
     panel labels it honestly rather than passing it off as a 7-day figure. */
  function proposals(row) {
    var out = [];
    var chg = asNum(row.price_change_percentage_7d_in_currency);
    if (chg === null) chg = asNum(row.price_change_percentage_7d);
    if (chg === null) chg = asNum(row.priceChangePercent);          /* Binance shape */
    if (chg !== null) {
      out.push({ field: 'change', label: '7-day move', value: Math.round(chg * 100) / 100, unit: ' pts' });
    }
    var vol = asNum(row.total_volume);
    if (vol === null) vol = asNum(row.quoteVolume);
    if (vol !== null) {
      out.push({ field: 'volume', label: '24h volume', value: Math.round(vol), unit: '' });
    }
    return out;
  }

  /* Show the fetched numbers beside what is on the board. Every line is ticked
     by default but individually droppable, so a fetch can be partially taken. */
  function showFetchReview(index, row, source) {
    var item = (cfg.markets.items || [])[index];
    var panel = $('fetchPanel'), rowsEl = $('fetchRows');
    if (!panel || !rowsEl || !item) return;

    var title = $('fetchTitle');
    if (title) {
      title.textContent = 'Fetched: ' + (row.name || item.asset || '') +
        (row.symbol ? ' (' + String(row.symbol).toUpperCase() + ')' : '');
    }
    var srcEl = $('fetchSource');
    if (srcEl) {
      srcEl.textContent = source +
        (row.current_price != null ? '  \u00b7  now ' + moneyShort(row.current_price) : '');
    }

    rowsEl.innerHTML = '';
    var props = proposals(row);
    if (!props.length) {
      var none = document.createElement('div');
      none.className = 'hint';
      none.textContent = 'That response carried no 7-day change or volume to propose.';
      rowsEl.appendChild(none);
      pendingFetch = null;
      panel.hidden = false;
      return;
    }
    pendingFetch = { index: index, props: props };

    props.forEach(function (p) {
      var line = document.createElement('label');
      line.className = 'fetchrow';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.field = p.field;

      var label = document.createElement('span');
      label.className = 'fl';
      label.textContent = p.label;

      var was = document.createElement('span');
      was.className = 'fo';
      var cur = item[p.field];
      was.textContent = (cur === undefined || cur === null || cur === '')
        ? '(empty)' : (cur + p.unit);

      var now = document.createElement('span');
      now.className = 'fw';
      now.textContent = p.value + p.unit;

      line.appendChild(cb);
      line.appendChild(label);
      line.appendChild(was);
      line.appendChild(now);
      rowsEl.appendChild(line);
    });

    var note = $('fetchNote');
    if (note) {
      note.textContent = 'Probability is not fetched \u2014 it is your editorial call. ' +
        'Volume is CoinGecko\u2019s 24-hour dollar volume, shown as such.';
    }
    panel.hidden = false;
    status('reviewing fetched values for market ' + (index + 1), 'ok');
  }

  function applyFetch() {
    if (!pendingFetch) { discardFetch(); return; }
    var index = pendingFetch.index;
    var item = (cfg.markets.items || [])[index];
    if (!item) { discardFetch(); return; }

    var applied = [];
    var boxes = $('fetchRows') ? $('fetchRows').querySelectorAll('input[type="checkbox"]') : [];
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].checked) continue;
      var field = boxes[i].dataset.field;
      for (var j = 0; j < pendingFetch.props.length; j++) {
        if (pendingFetch.props[j].field === field) {
          item[field] = pendingFetch.props[j].value;
          applied.push(pendingFetch.props[j].label);
          break;
        }
      }
    }
    discardFetch();
    if (!applied.length) { status('nothing was ticked to apply', 'err'); return; }
    refreshFields();
    renderMarkets();
    push({ msg: 'applied ' + applied.join(' + ') + ' to market ' + (index + 1) });
  }

  function discardFetch() {
    pendingFetch = null;
    var panel = $('fetchPanel');
    if (panel) panel.hidden = true;
  }

  /* ----------------------------------------------------------- topbar tools */
  var btnIn = $('btnIn'); if (btnIn) btnIn.addEventListener('click', function () { command('in'); });
  var btnOut = $('btnOut'); if (btnOut) btnOut.addEventListener('click', function () { command('out'); });


  var btnFetchApply = $('btnFetchApply');
  if (btnFetchApply) btnFetchApply.addEventListener('click', applyFetch);
  var btnFetchDiscard = $('btnFetchDiscard');
  if (btnFetchDiscard) btnFetchDiscard.addEventListener('click', discardFetch);

  /* The save is debounced, so closing the tab inside that window used to drop
     it — the other half of "my settings did not stick". sendBeacon is the one
     request the browser promises to finish during unload. */
  window.addEventListener('pagehide', function () {
    if (!autoSaveTimer || !navigator.sendBeacon) return;
    try { navigator.sendBeacon('api/config', new Blob([JSON.stringify(cfg)], { type: 'application/json' })); }
    catch (e) { /* nothing else we can do during unload */ }
  });

  var btnReset = $('btnReset');
  if (btnReset) {
    btnReset.addEventListener('click', function () {
      if (!confirm('Reset everything to the factory defaults?')) return;
      cfg = clone(SHIPPED);
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
      refreshFields();
      renderMarkets();
      /* the whole config was just replaced, so the category blocks are stale —
         they hold references to the OLD category objects and would keep
         autosaving edits into a config that no longer exists */
      renderCategories();
      push({ msg: 'reset to defaults' });
    });
  }

  var btnApplyRaw = $('btnApplyRaw');
  if (btnApplyRaw) {
    btnApplyRaw.addEventListener('click', function () {
      try {
        cfg = mergeIncoming(cfg, JSON.parse($('rawJson').value));
        refreshFields();
        renderMarkets();
        renderCategories();
        push({ msg: 'json applied' });
      } catch (err) { status('invalid json: ' + err.message, 'err'); }
    });
  }
  var btnCopyRaw = $('btnCopyRaw');
  if (btnCopyRaw) {
    btnCopyRaw.addEventListener('click', function () {
      $('rawJson').select();
      document.execCommand('copy');
      status('json copied', 'ok');
    });
  }

  var optGrid = $('optGrid');
  if (optGrid) {
    optGrid.addEventListener('change', function () {
      var stage = $('previewStage');
      if (stage) stage.classList.toggle('guides', optGrid.checked);
    });
  }
  var selZoom = $('selZoom');
  if (selZoom) {
    selZoom.addEventListener('change', function () {
      var scale = selZoom.value === 'fit' ? 1 : parseFloat(selZoom.value);
      preview.style.transform = scale === 1 ? 'none' : 'scale(' + scale + ')';
      preview.style.transformOrigin = 'top left';
      preview.style.width = scale === 1 ? '100%' : (100 / scale) + '%';
      preview.style.height = scale === 1 ? '100%' : (100 / scale) + '%';
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
        x.classList.remove('is-active');
        x.setAttribute('aria-selected', 'false');
      });
      Array.prototype.forEach.call(document.querySelectorAll('.panel-body'), function (x) { x.classList.remove('is-active'); });
      t.classList.add('is-active');
      t.setAttribute('aria-selected', 'true');
      var panel = document.querySelector('[data-panel="' + t.dataset.tab + '"]');
      if (panel) panel.classList.add('is-active');
    });
  });

  /* ------------------------------------------------------------------- boot */
  syncUI();
  paintAllHex();
  refreshPasteHint();
  var raw = $('rawJson');
  if (raw) raw.value = JSON.stringify(cfg, null, 2);
  var obs = $('obsUrl');
  if (obs) {
    obs.textContent = location.protocol === 'file:'
      ? 'index.html (or http://localhost:8790/predictions/index.html with Overlays/server.js)'
      : location.origin + location.pathname.replace(/admin\.html$/, 'index.html');
  }
  /* the iframe needs a moment before it accepts messages */
  if (preview) {
    preview.addEventListener('load', function () { push({ server: false, raw: false, msg: readyNote() }); }, { once: true });
  }
  setTimeout(function () { push({ server: false, raw: false, msg: readyNote() }); }, 400);
  var APP_V = (SHIPPED.meta && SHIPPED.meta.version) || '?';
  status(readyNote());
  if (window.PM_MIGRATE && window.PM_MIGRATE.migrated) {
    status('look updated to v' + APP_V + ' (was v' + window.PM_MIGRATE.migratedFrom + ') — your markets were kept', 'warn');
  }
  /* last, and after the first status: reading config.json is what makes this a
     faithful mirror of what is on air, and it must not overwrite the migration
     notice that tells the operator their markets were kept. */
  loadFromServer();

  /* --------------------------------------------------------------- chrome
     The tab strip sticks directly under the topbar. How tall that bar is
     depends on the platform's font metrics (it is taller on Windows than on
     macOS at the same font size), so measuring it beats a hard-coded offset
     that quietly slides the tabs underneath it. */
  (function () {
    var bar = document.querySelector('.topbar');
    if (!bar) return;
    function sync() {
      document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px');
    }
    sync();
    if (window.ResizeObserver) new ResizeObserver(sync).observe(bar);
    window.addEventListener('resize', sync);
  })();

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
       tab that made it — that is what makes the hub and every open panel follow
       the toggle live instead of only on next load. */
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      if (e.newValue === 'dark' || e.newValue === 'light') apply(e.newValue);
      else apply(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    });
  })();

})();
