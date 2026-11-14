/* ============================================================================
   X Posts — control panel
   ----------------------------------------------------------------------------
   Same panel language as the prediction board: the preview is the object, the
   tabs are Content / Look / Layout / Animation, and every field is bound by its
   `data-cfg` path so the config object stays the single source of truth.

   Paste flow: URLs are resolved by the hub (it talks to X's public syndication
   payload — the panel never does), then the normalised post is written into
   config.json, which is exactly what the overlay reads.
   ========================================================================== */
(function () {
  'use strict';

  var SHIPPED = window.XP_DEFAULT_CONFIG || {};
  var LS_KEY = 'xp-config-v1';
  var cfg = JSON.parse(JSON.stringify(SHIPPED));
  var saveTimer = null;

  function $(id) { return document.getElementById(id); }
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

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) {
      return (o && typeof o === 'object') ? o[k] : undefined;
    }, obj);
  }
  function setPath(obj, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var cur = obj;
    keys.forEach(function (k) {
      if (!isObj(cur[k])) cur[k] = {};
      cur = cur[k];
    });
    cur[last] = value;
  }

  function status(msg, kind) {
    var s = $('status');
    if (!s) return;
    s.textContent = msg || '';
    s.style.color = kind === 'err' ? '#e8806e' : kind === 'ok' ? '#7fcf9b' : '';
  }

  /* ------------------------------------------------------------------ state */
  function items() { return (cfg.posts && Array.isArray(cfg.posts.items)) ? cfg.posts.items : []; }

  function save(now) {
    cfg.posts = cfg.posts || { items: [] };
    cfg.posts.updatedAt = Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    pushPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      fetch('api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      }).then(function (r) {
        status(r.ok ? 'saved · live in OBS' : 'server said ' + r.status, r.ok ? 'ok' : 'err');
      }).catch(function () { status('local only — server unreachable', 'err'); });
    }, now ? 0 : 350);
  }

  function pushPreview() {
    var f = $('preview');
    try {
      if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'xp:config', config: cfg }, '*');
    } catch (e) { /* not ready */ }
  }

  /* ------------------------------------------------------------------ fields */
  function readInput(input, path) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'color') return input.value;
    if (input.dataset.kind === 'number') {
      var n = parseFloat(input.value);
      return isFinite(n) ? n : getPath(cfg, path);
    }
    return input.value;
  }

  function paintInput(input, path) {
    var v = getPath(cfg, path);
    if (input.type === 'checkbox') input.checked = v !== false && !!v;
    else if (input.type === 'color') input.value = v || '#000000';
    else input.value = v == null ? '' : v;
  }

  function bindFields() {
    document.querySelectorAll('[data-cfg]').forEach(function (input) {
      var path = input.dataset.cfg;
      paintInput(input, path);

      input.addEventListener('input', function () {
        setPath(cfg, path, readInput(input, path));
        pushPreview();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { save(); }, 350);
      });
      input.addEventListener('change', function () {
        setPath(cfg, path, readInput(input, path));
        save(true);
      });
    });
  }

  function refreshFields() {
    document.querySelectorAll('[data-cfg]').forEach(function (input) {
      paintInput(input, input.dataset.cfg);
    });
  }

  /* -------------------------------------------------------------- paste flow */
  function urlsFrom(text) {
    var seen = {}, out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var raw = line.trim();
      if (!raw) return;
      var m = raw.match(/(?:x\.com|twitter\.com)\/[^/\s]+\/status(?:es)?\/(\d{6,25})/i);
      var id = m ? m[1] : (/^\d{6,25}$/.test(raw) ? raw : '');
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({ id: id, url: raw });
    });
    return out;
  }

  function refreshHint() {
    var ta = $('pasteIn'), hint = $('pasteCountHint');
    if (!ta || !hint) return;
    hint.textContent = String(urlsFrom(ta.value).length);
  }

  function addPosts() {
    var ta = $('pasteIn');
    var btn = $('btnPasteAppend');
    var list = urlsFrom(ta ? ta.value : '');
    if (!list.length) { status('paste an x.com/…/status/… link first', 'err'); return; }
    var label = btn.innerHTML;
    btn.disabled = true;
    var added = 0, missed = 0, i = 0;

    function step() {
      if (i >= list.length) return Promise.resolve();
      var u = list[i++];
      btn.textContent = 'Resolving ' + i + '/' + list.length + '…';
      return fetch('api/x/post?url=' + encodeURIComponent(u.url), { cache: 'no-store' })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (body) {
          var it = body && body.items && body.items[0];
          if (!it) { missed++; return step(); }
          var all = items();
          var at = -1;
          for (var k = 0; k < all.length; k++) if (String(all[k].id) === String(it.id)) { at = k; break; }
          if (at === -1) { all.push(it); added++; } else { all[at] = it; }
          return step();
        })
        .catch(function () { missed++; return step(); });
    }

    step().then(function () {
      cfg.posts = cfg.posts || {};
      cfg.posts.items = items().filter(Boolean);
      if (ta) ta.value = '';
      refreshHint();
      btn.disabled = false;
      btn.innerHTML = label;
      save(true);
      renderPasted();
      status(added + ' added' + (missed ? ' · ' + missed + ' not found' : ''), missed ? 'err' : 'ok');
    });
  }

  /* ------------------------------------------------------------ pasted list */
  function renderPasted() {
    var host = $('pastedList'), count = $('pastedCount');
    if (!host) return;
    var list = items();
    if (count) count.textContent = list.length + (list.length === 1 ? ' post on the board' : ' posts on the board');
    host.innerHTML = '';

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'pasted__empty';
      empty.textContent = 'Nothing on the board yet — paste X status links above.';
      host.appendChild(empty);
      return;
    }

    list.forEach(function (p, i) {
      var row = document.createElement('div');
      row.className = 'pasted__row';

      var idx = document.createElement('span');
      idx.className = 'pasted__idx';
      idx.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);

      var title = document.createElement('span');
      title.className = 'pasted__title';
      var a = document.createElement('a');
      a.href = p.url || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '@' + (p.handle || '') + ' — ' + String(p.text || '').replace(/\s+/g, ' ').slice(0, 88);
      a.style.color = 'inherit';
      a.style.textDecoration = 'none';
      title.appendChild(a);

      var meta = document.createElement('span');
      meta.className = 'pasted__pct';
      meta.textContent = (p.likes != null ? Number(p.likes).toLocaleString() : '0') + ' ♥';

      var acts = document.createElement('span');
      acts.className = 'pasted__acts';

      function move(step) {
        var all = items();
        var at = all.indexOf(p), to = at + step;
        if (at === -1 || to < 0 || to >= all.length) return;
        all.splice(at, 1);
        all.splice(to, 0, p);
        save(true);
        renderPasted();
      }

      var up = document.createElement('button');
      up.type = 'button'; up.textContent = '↑'; up.title = 'Move up'; up.disabled = i === 0;
      up.addEventListener('click', function () { move(-1); });

      var down = document.createElement('button');
      down.type = 'button'; down.textContent = '↓'; down.title = 'Move down'; down.disabled = i === list.length - 1;
      down.addEventListener('click', function () { move(1); });

      var del = document.createElement('button');
      del.type = 'button'; del.textContent = '✕'; del.title = 'Remove';
      del.addEventListener('click', function () {
        cfg.posts.items = items().filter(function (x) { return String(x.id) !== String(p.id); });
        save(true);
        renderPasted();
        status('removed', 'ok');
      });

      acts.appendChild(up); acts.appendChild(down); acts.appendChild(del);
      row.appendChild(idx); row.appendChild(title); row.appendChild(meta); row.appendChild(acts);
      host.appendChild(row);
    });
  }

  /* ------------------------------------------------------------- preview box */
  function fitPreview() {
    var stage = $('previewStage'), frame = $('preview');
    if (!stage || !frame) return;
    var zoom = ($('selZoom') && $('selZoom').value) || 'fit';
    var s = zoom === 'fit' ? (stage.clientWidth / 1920) : parseFloat(zoom);
    /* the stage keeps its 16/9 box; the iframe is the full 1920×1080 canvas
       scaled from the top-left corner, which is how the other panels do it */
    frame.style.setProperty('--pv-scale', String(s));
  }

  function sendCommand(action) {
    var f = $('preview');
    try {
      if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'xp:command', action: action }, '*');
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- binding */
  function bind() {
    var ta = $('pasteIn');
    if (ta) ta.addEventListener('input', refreshHint);

    var add = $('btnPasteAppend');
    if (add) add.addEventListener('click', addPosts);

    var clear = $('btnPasteClear');
    if (clear) clear.addEventListener('click', function () { if (ta) ta.value = ''; refreshHint(); });

    var wipe = $('btnPastedClear');
    if (wipe) wipe.addEventListener('click', function () {
      cfg.posts = cfg.posts || {};
      cfg.posts.items = [];
      save(true);
      renderPasted();
      status('board cleared', 'ok');
    });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (x) {
          x.classList.toggle('is-active', x === t);
          x.setAttribute('aria-selected', x === t ? 'true' : 'false');
        });
        document.querySelectorAll('.panel-body').forEach(function (p) {
          p.classList.toggle('is-active', p.dataset.panel === t.dataset.tab);
        });
      });
    });

    var themeBtn = $('btnTheme');
    if (themeBtn) themeBtn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('obs-overlays-theme', next); } catch (e) { /* ignore */ }
    });

    var zoom = $('selZoom');
    if (zoom) zoom.addEventListener('change', fitPreview);

    var play = $('btnIn');
    if (play) play.addEventListener('click', function () { sendCommand('replay'); });
    var prev = $('btnPrev');
    if (prev) prev.addEventListener('click', function () { sendCommand('prev'); });
    var next = $('btnNext');
    if (next) next.addEventListener('click', function () { sendCommand('next'); });

    var reset = $('btnReset');
    if (reset) reset.addEventListener('click', function () {
      cfg = JSON.parse(JSON.stringify(SHIPPED));
      cfg.posts = { items: [], updatedAt: Date.now() };
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
      refreshFields();
      renderPasted();
      save(true);
      status('reset to shipped defaults', 'ok');
    });

    window.addEventListener('resize', fitPreview);
    var frame = $('preview');
    if (frame) frame.addEventListener('load', function () { fitPreview(); pushPreview(); });
  }

  /* ------------------------------------------------------------------- boot */
  function loadFromServer() {
    fetch('api/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (remote && Object.keys(remote).length) cfg = deepMerge(cfg, remote);
        refreshFields();
        renderPasted();
        pushPreview();
        status(remote && Object.keys(remote).length ? 'mirrors what is on air' : 'ready · nothing saved yet');
      })
      .catch(function () {
        refreshFields();
        renderPasted();
        status('local only — open this page over HTTP', 'err');
      });
  }

  bind();
  refreshHint();
  bindFields();
  renderPasted();
  fitPreview();
  loadFromServer();
})();
