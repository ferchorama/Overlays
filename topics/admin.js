/* ============================================================================
   Talking Points Panel — control panel logic
   Live-edits the config, previews it instantly and (when server.js is running)
   writes config.json so the OBS browser source follows along.
   ========================================================================== */
(function () {
  'use strict';

  var LS_KEY = 'tp-config-v1';
  var preview = document.getElementById('preview');
  var SHIPPED = window.TP_DEFAULT_CONFIG || {};
  var cfg = deepMerge(clone(SHIPPED), {});
  function mergeIncoming(base, patch) {
    var M = window.TP_MIGRATE;
    if (M && patch && patch.meta && patch.meta.version && M.versionOf(patch) !== M.versionOf(SHIPPED)) {
      return M.apply(SHIPPED, patch);
    }
    return deepMerge(base, patch);
  }
  var saveTimer = null;

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
  function status(msg, kind) {
    var s = $('status');
    s.textContent = msg;
    s.className = kind || '';
  }

  /* ------------------------------------------------------------ load / save */
  try {
    var ls = localStorage.getItem(LS_KEY);
    if (ls) cfg = mergeIncoming(cfg, JSON.parse(ls));
  } catch (e) { /* ignore */ }

  // #preset=navy etc. for quick theming
  var m = location.hash.match(/preset=([a-z]+)/);

  function push(animate) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    if (preview && preview.contentWindow) {
      preview.contentWindow.postMessage({ type: 'tp:config', config: cfg }, '*');
    }
    $('rawJson').value = JSON.stringify(cfg, null, 2);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToServer, 500);
    status(animate === false ? 'updated' : 'updated (live)', 'ok');
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

  function command(cmd) {
    if (preview && preview.contentWindow) preview.contentWindow.postMessage(cmd, '*');
    var q = Object.keys(cmd).filter(function (k) { return k !== 'type'; })
      .map(function (k) { return k + '=' + encodeURIComponent(cmd[k]); }).join('&');
    fetch('api/command?' + q).catch(function () { /* no server, fine */ });
  }

  /* --------------------------------------------------------------- bindings */
  /* ---------------------------------------------------------- colour utils
     A native <input type="color"> only speaks #rrggbb: handing it an rgba()
     value shows BLACK and writes back a flat hex, silently destroying the alpha
     that the glass surfaces depend on. So colours are split into a hex input
     plus a separate alpha input, and reassembled on the way back. */
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
  function alphaOf(c) { var p = parseColor(c); return p ? p.a : 1; }
  function withAlpha(hex, a) {
    var p = parseColor(hex);
    if (!p) return hex;
    if (a >= 1) return p.hex;
    return 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + Math.round(a * 100) / 100 + ')';
  }

  function bind(path, id, opts) {
    opts = opts || {};
    var node = $(id);
    if (!node) return;
    var parts = path.split('.');
    var get = function () { var o = cfg; parts.forEach(function (p) { o = o && o[p]; }); return o; };
    var set = function (v) {
      var o = cfg;
      for (var i = 0; i < parts.length - 1; i++) { if (!isObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
      o[parts[parts.length - 1]] = v;
    };

    var val = get();
    if (node.type === 'checkbox') node.checked = !!val;
    else if (node.type === 'color') node.value = toHex(val) || '#000000';
    else node.value = val == null ? '' : val;

    /* a colour bound to an rgba() keeps its alpha; the hex input only edits RGB */
    var isColor = node.type === 'color';

    var ev = (node.type === 'checkbox' || node.tagName === 'SELECT') ? 'change' : 'input';
    var handler = function () {
      var v;
      if (node.type === 'checkbox') v = node.checked;
      else if (node.type === 'number') { v = node.value === '' ? '' : parseFloat(node.value); if (isNaN(v)) v = ''; }
      else if (isColor) v = withAlpha(node.value, alphaOf(get()));
      else v = node.value;
      if (opts.transform) v = opts.transform(v, cfg);
      set(v);
      if (opts.after) opts.after(v);
      push();
      if (opts.side) opts.side(v);
    };
    node.addEventListener(ev, handler);
    if (opts.side) opts.side(val);
  }

  function syncUI() {
    bind('header.title.text', 'c_title');
    bind('subtitle.text', 'c_subtitle');
    bind('subtitle.autoDate', 'c_autoDate');
    bind('subtitle.dateFormat', 'c_dateFormat');
    bind('header.visible', 'c_headerVisible');
    bind('subtitle.visible', 'c_subVisible');
    bind('topics.maxRows', 'c_maxRows');

    bind('header.gradient.0.color', 'c_headerGradA');
    bind('header.gradient.1.color', 'c_headerGradB');
    bind('header.title.color', 'c_titleColor');
    bind('header.title.size', 'c_titleSize');
    bind('subtitle.gradient.0.color', 'c_subGradA');
    bind('subtitle.gradient.1.color', 'c_subGradB');
    bind('subtitle.color', 'c_subColor');
    bind('subtitle.size', 'c_subSize');
    bind('topics.text.color', 'c_rowColor');
    bind('topics.text.size', 'c_rowSize');
    bind('topics.text.shadow', 'c_rowShadow');
    bind('topics.rowHeight', 'c_rowHeight');
    bind('theme', 'c_theme');
    bind('panel.background', 'c_panelBg');
    bind('panel.borderColor', 'c_borderColor');
    bind('panel.borderWidth', 'c_borderWidth');
    bind('panel.radius', 'c_radius');
    bind('panel.shadow', 'c_panelShadow');
    bind('header.gloss', 'c_glossHeader');
    bind('topics.gloss', 'c_glossRows');

    bind('googleFonts', 'c_googleFonts', { transform: function (v) { return String(v).split('\n').map(function (s) { return s.trim(); }).filter(Boolean); } });
    $('c_googleFonts').value = (cfg.googleFonts || []).join('\n');
    bind('header.title.fontFamily', 'c_titleFont');
    bind('header.title.weight', 'c_titleWeight');
    bind('header.title.letterSpacing', 'c_titleTracking');
    bind('header.title.uppercase', 'c_titleUpper');
    bind('subtitle.fontFamily', 'c_subFont');
    bind('subtitle.weight', 'c_subWeight');
    bind('subtitle.letterSpacing', 'c_subTracking');
    bind('subtitle.uppercase', 'c_subUpper');
    bind('topics.text.fontFamily', 'c_rowFont');
    bind('topics.text.weight', 'c_rowWeight');
    bind('topics.text.fontUrl', 'c_rowFontUrl');
    bind('topics.text.letterSpacing', 'c_rowTracking');
    bind('topics.text.uppercase', 'c_rowUpper');
    bind('topics.text.maxLines', 'c_rowMaxLines');
    bind('topics.text.autoShrink', 'c_rowAutoShrink');

    bind('stage.width', 'c_stageW');
    bind('stage.height', 'c_stageH');
    bind('stage.fit', 'c_fit');
    bind('stage.alignX', 'c_alignX');
    bind('panel.x', 'c_panelX');
    bind('panel.y', 'c_panelY');
    bind('panel.width', 'c_panelW');
    bind('panel.verticalAnchor', 'c_vAnchor');
    bind('panel.autoFitHeight', 'c_autoFit');
    bind('header.height', 'c_headerH');
    bind('subtitle.height', 'c_subH');
    bind('topics.gap', 'c_rowGap');
    bind('topics.separator.enabled', 'c_sepOn');
    bind('topics.separator.color', 'c_sepColor');
    bind('topics.separator.height', 'c_sepH');

    bind('animation.autoPlay', 'c_autoPlay');
    bind('animation.loopPreview', 'c_loopPreview');
    bind('animation.rowFrom', 'c_rowFrom');
    bind('animation.rowDistance', 'c_rowDistance');
    bind('animation.rowDuration', 'c_rowDuration');
    bind('animation.rowStagger', 'c_rowStagger');
    bind('animation.rowStart', 'c_rowStart');
    bind('animation.rowEase', 'c_rowEase');
    bind('animation.headerDuration', 'c_headerDuration');
    bind('animation.headerEase', 'c_headerEase');
    bind('animation.fadeRows', 'c_fadeRows');
  }

  /* ------------------------------------------------------------ topic list */
  function renderTopics() {
    var list = $('topicList');
    list.innerHTML = '';
    cfg.topics.items.forEach(function (item, i) {
      var row = document.createElement('div');
      row.className = 'topic' + (item.enabled === false ? ' is-off' : '');
      row.draggable = true;
      row.dataset.index = i;
      row.innerHTML =
        '<span class="grip">⠿</span>' +
        '<input type="text" value="" />' +
        '<button class="ic del" title="remove">✕</button>';

      var input = row.querySelector('input[type="text"]');
      input.value = item.text || '';
      var wasOff = item.enabled === false;
      /* typing into a disabled topic switches it on (no re-render → keeps focus) */
      input.addEventListener('input', function () {
        item.text = input.value;
        if (item.enabled === false && String(input.value).trim() !== '') {
          item.enabled = true;
          row.classList.remove('is-off');
          if (wasOff) { wasOff = false; status('topic ' + (i + 1) + ' enabled', 'ok'); }
        }
        push();
      });
      /* empty a row and leave the field to switch it back off */
      input.addEventListener('blur', function () {
        if (String(input.value).trim() === '' && item.enabled !== false) {
          item.enabled = false;
          row.classList.add('is-off');
          push();
        }
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') input.blur();
      });

     row.querySelector('.del').addEventListener('click', function () {
        cfg.topics.items.splice(i, 1);
        renderTopics(); push();
      });
      /* click the row body toggles enabled */
      row.querySelector('.grip').addEventListener('click', function () {
        item.enabled = item.enabled === false;
        renderTopics(); push();
      });

      /* drag & drop reorder */
      row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        var moved = cfg.topics.items.splice(from, 1)[0];
        cfg.topics.items.splice(i, 0, moved);
        renderTopics(); push();
      });

      list.appendChild(row);
    });
  }

  $('btnAddTopic').addEventListener('click', function () {
    cfg.topics.items.push({ text: 'New topic', enabled: true });
    renderTopics(); push();
  });

  /* --------------------------------------------------------- gradient stops */
  function renderStops() {
    var wrap = $('stops');
    wrap.innerHTML = '';
    cfg.topics.gradient.forEach(function (stop, i) {
      var row = document.createElement('div');
      row.className = 'stop';
      var alpha = alphaOf(stop.color);
      row.innerHTML =
        '<input type="range" min="0" max="100" value="' + stop.offset + '" />' +
        '<input type="color" value="' + toHex(stop.color) + '" />' +
        '<input type="number" class="stop-alpha" min="0" max="1" step="0.01" value="' + alpha + '" />' +
        '<button class="ic del" title="remove">✕</button>';
      var hexIn = row.querySelector('input[type="color"]');
      var alphaIn = row.querySelector('.stop-alpha');
      row.querySelector('input[type="range"]').addEventListener('input', function () {
        stop.offset = parseFloat(this.value); push();
      });
      hexIn.addEventListener('input', function () {
        stop.color = withAlpha(this.value, alphaOf(stop.color)); push();
      });
      alphaIn.addEventListener('input', function () {
        var a = parseFloat(this.value);
        if (isNaN(a)) return;
        a = Math.max(0, Math.min(1, a));
        stop.color = withAlpha(stop.color, a); push();
      });
      row.querySelector('.del').addEventListener('click', function () {
        if (cfg.topics.gradient.length <= 2) return;
        cfg.topics.gradient.splice(i, 1); renderStops(); push();
      });
      wrap.appendChild(row);
    });
    cfg.topics.gradient.sort(function (a, b) { return a.offset - b.offset; });
  }
  $('btnAddStop').addEventListener('click', function () {
    cfg.topics.gradient.push({ offset: 50, color: '#808080' });
    cfg.topics.gradient.sort(function (a, b) { return a.offset - b.offset; });
    renderStops(); push();
  });

  /* ---------------------------------------------------------------- presets */
  /* Every preset is LIGHT. The dark/grey originals were replaced when this
     overlay moved to the weather widget's sky-glass theme: a preset that
     restored greys and blacks would undo the look in one click. */
  var PRESETS = {
    sky: {
      panel: { background: 'rgba(216,242,255,0.88)', borderColor: 'rgba(212,240,255,0.85)',
               shadow: '0 26px 60px rgba(18,72,140,0.30)', radius: 34, borderWidth: 1 },
      header: { gradient: [{ offset: 0, color: 'rgba(74,190,255,0.96)' }, { offset: 100, color: 'rgba(126,214,255,0.92)' }], title: { color: '#06294f' } },
      subtitle: { gradient: [{ offset: 0, color: 'rgba(158,224,255,0.94)' }, { offset: 100, color: 'rgba(206,240,255,0.90)' }], color: '#0a3a72' },
      topics: {
        gradient: [
          { offset: 0, color: 'rgba(124,208,255,0.92)' }, { offset: 24, color: 'rgba(160,224,255,0.90)' },
          { offset: 74, color: 'rgba(196,236,255,0.88)' }, { offset: 100, color: 'rgba(214,242,255,0.86)' }
        ],
        text: { color: '#0b2a5b', shadow: '0 2px 6px rgba(24,86,160,0.16)' }
      }
    },
    dusk: {
      panel: { background: 'rgba(226,232,255,0.90)', borderColor: 'rgba(214,222,255,0.88)',
               shadow: '0 26px 60px rgba(40,50,140,0.30)', radius: 34, borderWidth: 1 },
      header: { gradient: [{ offset: 0, color: 'rgba(128,158,255,0.95)' }, { offset: 100, color: 'rgba(168,190,255,0.91)' }], title: { color: '#111f63' } },
      subtitle: { gradient: [{ offset: 0, color: 'rgba(186,202,255,0.94)' }, { offset: 100, color: 'rgba(220,228,255,0.90)' }], color: '#1b2a72' },
      topics: {
        gradient: [
          { offset: 0, color: 'rgba(150,176,255,0.92)' }, { offset: 24, color: 'rgba(178,198,255,0.90)' },
          { offset: 74, color: 'rgba(210,220,255,0.88)' }, { offset: 100, color: 'rgba(226,234,255,0.86)' }
        ],
        text: { color: '#141f5e', shadow: '0 2px 6px rgba(50,66,168,0.18)' }
      }
    },
    lagoon: {
      panel: { background: 'rgba(214,250,246,0.88)', borderColor: 'rgba(200,244,238,0.86)',
               shadow: '0 26px 60px rgba(16,120,110,0.28)', radius: 34, borderWidth: 1 },
      header: { gradient: [{ offset: 0, color: 'rgba(64,206,196,0.95)' }, { offset: 100, color: 'rgba(120,224,212,0.91)' }], title: { color: '#04403a' } },
      subtitle: { gradient: [{ offset: 0, color: 'rgba(158,236,226,0.94)' }, { offset: 100, color: 'rgba(206,246,240,0.90)' }], color: '#075249' },
      topics: {
        gradient: [
          { offset: 0, color: 'rgba(126,222,210,0.92)' }, { offset: 24, color: 'rgba(162,232,222,0.90)' },
          { offset: 74, color: 'rgba(196,242,236,0.88)' }, { offset: 100, color: 'rgba(216,248,244,0.86)' }
        ],
        text: { color: '#06453e', shadow: '0 2px 6px rgba(16,120,110,0.16)' }
      }
    },
    sunrise: {
      panel: { background: 'rgba(255,240,222,0.90)', borderColor: 'rgba(255,228,198,0.88)',
               shadow: '0 26px 60px rgba(170,90,20,0.26)', radius: 34, borderWidth: 1 },
      header: { gradient: [{ offset: 0, color: 'rgba(255,186,102,0.95)' }, { offset: 100, color: 'rgba(255,212,150,0.91)' }], title: { color: '#5a2c00' } },
      subtitle: { gradient: [{ offset: 0, color: 'rgba(255,224,180,0.94)' }, { offset: 100, color: 'rgba(255,240,214,0.90)' }], color: '#6b3608' },
      topics: {
        gradient: [
          { offset: 0, color: 'rgba(255,206,150,0.92)' }, { offset: 24, color: 'rgba(255,222,180,0.90)' },
          { offset: 74, color: 'rgba(255,236,208,0.88)' }, { offset: 100, color: 'rgba(255,244,226,0.86)' }
        ],
        text: { color: '#5c2f06', shadow: '0 2px 6px rgba(170,90,20,0.16)' }
      }
    }
  };

  Array.prototype.forEach.call(document.querySelectorAll('.preset'), function (b) {
    b.addEventListener('click', function () { applyPreset(b.dataset.preset); });
  });

  function applyPreset(name) {
    if (!PRESETS[name]) return;
    cfg = deepMerge(cfg, clone(PRESETS[name]));
    refreshAll();
    status('preset: ' + name, 'ok');
  }

  function refreshAll() {
    // rebind values without duplicating listeners: simplest is a page-level refresh
    document.querySelectorAll('input, select, textarea').forEach(function () { /* no-op keeps DOM */ });
    location.hash = '';
    renderTopics();
    renderStops();
    push();
    // update field values in place
    var map = [
      ['c_title', cfg.header.title.text], ['c_subtitle', cfg.subtitle.text],
      ['c_headerGradA', cfg.header.gradient[0].color], ['c_headerGradB', cfg.header.gradient[1].color],
      ['c_titleColor', cfg.header.title.color], ['c_titleSize', cfg.header.title.size],
      ['c_subGradA', cfg.subtitle.gradient[0].color], ['c_subGradB', cfg.subtitle.gradient[1].color],
      ['c_subColor', cfg.subtitle.color], ['c_subSize', cfg.subtitle.size],
      ['c_rowColor', cfg.topics.text.color], ['c_rowSize', cfg.topics.text.size],
      ['c_rowShadow', cfg.topics.text.shadow], ['c_rowHeight', cfg.topics.rowHeight],
      ['c_panelBg', cfg.panel.background], ['c_borderColor', cfg.panel.borderColor],
      ['c_borderWidth', cfg.panel.borderWidth], ['c_radius', cfg.panel.radius],
      ['c_panelShadow', cfg.panel.shadow]
    ];
    map.forEach(function (p) {
      var n = $(p[0]);
      if (!n) return;
      n.value = (n.type === 'color') ? (toHex(p[1]) || '#000000') : p[1];
    });
    $('c_googleFonts').value = (cfg.googleFonts || []).join('\n');
  }

  /* ----------------------------------------------------------- topbar tools */
  $('btnIn').addEventListener('click', function () { command({ type: 'tp:command', action: 'in' }); });
  $('btnOut').addEventListener('click', function () { command({ type: 'tp:command', action: 'out' }); });
  /* The save is debounced, so closing the tab inside that window used to drop
     it — the other half of "my settings did not stick". sendBeacon is the one
     request the browser promises to finish during unload. */
  window.addEventListener('pagehide', function () {
    if (!saveTimer || !navigator.sendBeacon) return;
    try { navigator.sendBeacon('api/config', new Blob([JSON.stringify(cfg)], { type: 'application/json' })); }
    catch (e) { /* nothing else we can do during unload */ }
  });

  $('btnReset').addEventListener('click', function () {
    if (!confirm('Reset every setting to the factory defaults?\n\n' +
                 'This also overwrites the saved config on the server, so it cannot be undone.')) return;
    cfg = clone(window.TP_DEFAULT_CONFIG || {});
    /* push() rewrites localStorage, re-posts to the overlay and schedules the
       server save. Without it the reset lived only in this tab: the next reload
       pulled the old config.json back and the button looked like a no-op. */
    refreshAll();
    push();
    status('reset to factory defaults', 'ok');
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
    document.execCommand('copy');
    status('json copied', 'ok');
  });

  $('optGrid').addEventListener('change', function () {
    $('previewStage').classList.toggle('guides', this.checked);
  });
  $('selZoom').addEventListener('change', function () {
    var scale = this.value === 'fit' ? 1 : parseFloat(this.value);
    preview.style.transform = scale === 1 ? 'none' : 'scale(' + scale + ')';
    preview.style.transformOrigin = 'top left';
    preview.style.width = scale === 1 ? '100%' : (100 / scale) + '%';
    preview.style.height = scale === 1 ? '100%' : (100 / scale) + '%';
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('is-active'); });
      document.querySelectorAll('.panel-body').forEach(function (x) { x.classList.remove('is-active'); });
      t.classList.add('is-active');
      document.querySelector('[data-panel="' + t.dataset.tab + '"]').classList.add('is-active');
    });
  });

  /* ------------------------------------------------------------------- boot */
  syncUI();
  renderTopics();
  renderStops();
  $('rawJson').value = JSON.stringify(cfg, null, 2);
  $('obsUrl').textContent = location.protocol === 'file:'
    ? 'index.html (or http://localhost:8790/topics/index.html with Overlays/server.js)'
    : location.origin + location.pathname.replace(/admin\.html$/, 'index.html');
  if (m) applyPreset(m[1]);
  // the iframe needs a moment before it accepts messages
  preview.addEventListener('load', function () { push(); }, { once: true });
  setTimeout(function () { push(); }, 400);
  var APP_V = (window.TP_DEFAULT_CONFIG && window.TP_DEFAULT_CONFIG.meta && window.TP_DEFAULT_CONFIG.meta.version) || '?';
  status('ready · v' + APP_V);
  if (window.TP_MIGRATE && window.TP_MIGRATE.migrated) {
    status('look updated to v' + APP_V + ' (was v' + window.TP_MIGRATE.migratedFrom + ') — your topics were kept', 'warn');
  }

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

  /* ---------------------------------------------------------- set to today
     Writes today's date into the subtitle. Uses the overlay's own formatter so
     the button and `autoDate` can never produce different strings for the same
     format. */
  (function () {
    var btn = $('btnSetToday');
    if (!btn) return;
    var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(fmt, d) {
      var M = pad2(d.getMonth() + 1), D = pad2(d.getDate()), Y = d.getFullYear();
      var YY = String(Y).slice(-2), MMM = MONTHS[d.getMonth()];
      switch (fmt) {
        case 'DD/MM/YY': return D + '/' + M + '/' + YY;
        case 'MM/DD/YYYY': return M + '/' + D + '/' + Y;
        case 'DD MMM YYYY': return D + ' ' + MMM + ' ' + Y;
        case 'MMM DD, YYYY': return MMM + ' ' + D + ', ' + Y;
        case 'YYYY-MM-DD': return Y + '-' + M + '-' + D;
        default: return M + '/' + D + '/' + YY;
      }
    }
    btn.addEventListener('click', function () {
      var fmtEl = $('c_dateFormat');
      var text = formatDate(fmtEl ? fmtEl.value : 'MM/DD/YY', new Date());
      cfg.subtitle.text = text;
      /* auto-date would immediately overwrite what was just set, so the button
         takes manual control — which is what pressing it is asking for */
      cfg.subtitle.autoDate = false;
      var auto = $('c_autoDate'); if (auto) auto.checked = false;
      var field = $('c_subtitle'); if (field) field.value = text;
      push();
    });
  })();

})();
