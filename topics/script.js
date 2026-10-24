/* ============================================================================
   Talking Points Panel — overlay engine
   ----------------------------------------------------------------------------
   Responsibilities
     • merge config (defaults ← localStorage ← server config.json ← postMessage)
     • build / theme the panel DOM
     • drive the GSAP intro / outro animations
     • expose a small control API: window.TP.play() / .out() / .next() ...
   ========================================================================== */
(function () {
  'use strict';

  /* Safety net: if GSAP failed to load (fully offline machine) the panel must
     still appear — it just won't animate. */
  if (!window.gsap) {
    window.gsap = {
      timeline: function () {
        var o = {};
        ['from', 'to', 'set', 'play', 'pause', 'delay', 'progress', 'add'].forEach(function (k) { o[k] = function () { return o; }; });
        o.kill = function () {};
        return o;
      },
      set: function (t, v) {
        if (t && t.style && v) {
          if (v.opacity != null) t.style.opacity = v.opacity;
          if (v.y != null && typeof v.y === 'number') t.style.transform = 'translateY(' + v.y + 'px)';
        }
      },
      to: function (t, v) { if (t && t.style && v && v.opacity != null) t.style.opacity = v.opacity; }
    };
  }

  var LS_KEY = 'tp-config-v1';
  var SHIPPED = window.TP_DEFAULT_CONFIG || {};

  /* storage (localStorage / config.json / postMessage) may hold a config from an
     older build — keep the operator's content, take the shipped look */
  function mergeIncoming(base, patch) {
    var M = window.TP_MIGRATE;
    if (M && patch && patch.meta && patch.meta.version && M.versionOf(patch) !== M.versionOf(SHIPPED)) {
      return M.apply(SHIPPED, patch);
    }
    return deepMerge(base, patch);
  }
  var STATE_KEY = 'tp-state-v1';

  /* ------------------------------------------------------------ utilities */
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

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDate(fmt, d) {
    d = d || new Date();
    var M = pad2(d.getMonth() + 1), D = pad2(d.getDate()), Y = d.getFullYear();
    var YY = String(Y).slice(-2);
    var MMM = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
    switch (fmt) {
      case 'DD/MM/YY': return D + '/' + M + '/' + YY;
      case 'MM/DD/YYYY': return M + '/' + D + '/' + Y;
      case 'DD MMM YYYY': return D + ' ' + MMM + ' ' + Y;
      case 'MMM DD, YYYY': return MMM + ' ' + D + ', ' + Y;
      case 'YYYY-MM-DD': return Y + '-' + M + '-' + D;
      default: return M + '/' + D + '/' + YY;
    }
  }

  function gradient(stops, angle) {
    var list = (stops || []).map(function (s) {
      var off = typeof s.offset === 'number' && s.offset <= 1 ? s.offset * 100 : s.offset;
      return s.color + ' ' + off + '%';
    }).join(', ');
    return 'linear-gradient(' + (angle == null ? 180 : angle) + 'deg, ' + list + ')';
  }

  function injectStyle(id, css) {
    var s = document.getElementById(id);
    if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
    s.textContent = css;
    return s;
  }

  function loadFonts(cfg) {
    var families = (cfg.googleFonts || []).slice();
    var needsMontserrat = JSON.stringify(cfg).indexOf('Montserrat') !== -1;
    if (needsMontserrat && !families.join('|').match(/Montserrat/)) {
      families.push('Montserrat:wght@300;400;500;600;700;800');
    }
    if (families.length) {
      injectStyle('tp-google-fonts',
        '@import url("https://fonts.googleapis.com/css2?' +
        families.map(function (f) { return 'family=' + f; }).join('&') + '&display=swap");');
    }
    // custom font stylesheets (e.g. a licensed Proxima Nova hosted on a CDN)
    var urls = [];
    if (cfg.topics && cfg.topics.text && cfg.topics.text.fontUrl) urls.push(cfg.topics.text.fontUrl);
    (cfg.header && cfg.header.title && cfg.header.title.fontUrl ? [cfg.header.title.fontUrl] : []).forEach(function (u) { urls.push(u); });
    (cfg.subtitle && cfg.subtitle.fontUrl ? [cfg.subtitle.fontUrl] : []).forEach(function (u) { urls.push(u); });
    (cfg.fontUrls || []).forEach(function (u) { urls.push(u); });
    injectStyle('tp-custom-fonts', urls.filter(Boolean).map(function (u) {
      return '@import url("' + u + '");';
    }).join('\n'));
  }

  /* ------------------------------------------------------------ the panel */
  function Panel(config) {
    this.cfg = config;
    this.stage = document.getElementById('stage');
    this.panel = null;
    this.tl = null;
    this.state = { playing: false, onAir: false, built: false };
  }

  Panel.prototype.mount = function () {
    var self = this;
    var cfg = this.cfg;

    document.body.classList.toggle('debug', !!(cfg.debug));

    /* ---- stage ---- */
    this.stage.style.setProperty('--stage-w', cfg.stage.width + 'px');
    this.stage.style.setProperty('--stage-h', cfg.stage.height + 'px');
    this.stage.style.setProperty('--stage-bg', cfg.stage.background);
    this.stage.innerHTML = '';

    /* ---- panel ---- */
    var panel = el('div', 'panel', this.stage);
    this.panel = panel;

    var p = cfg.panel;
    var pad = p.borderWidth || 0;
    panel.style.setProperty('--panel-x', p.x + 'px');
    panel.style.setProperty('--panel-w', p.width + 'px');
    panel.style.setProperty('--panel-radius', (p.radius || 0) + 'px');
    panel.style.setProperty('--panel-bg', p.background);
    panel.style.setProperty('--panel-border-w', pad + 'px');
    panel.style.setProperty('--panel-border-c', p.borderColor);
    panel.style.setProperty('--panel-shadow', p.shadow || 'none');
    panel.style.setProperty('--panel-glow', p.glow || '0 0 0 rgba(0,0,0,0)');
    panel.style.setProperty('--panel-opacity', p.opacity == null ? 1 : p.opacity);
    panel.style.setProperty('--panel-blur', (p.blur == null ? 36 : p.blur) + 'px');
    panel.style.setProperty('--panel-sat', (p.saturate == null ? 175 : p.saturate) + '%');
    panel.style.setProperty('--panel-sheen', p.sheen || 'none');
    panel.style.setProperty('--accent-c', p.accentColor || '#0a84ff');

    /* ---- bands ---- */
    var header = el('header', 'band band--header valign-' + (cfg.header.title.valign || 'middle'), panel);
    var headerGloss = el('div', 'band__gloss', header);
    var title = el('h1', 'band__text', header);
    this.header = header; this.title = title; this.headerGloss = headerGloss;

    var subBand = el('div', 'band band--subtitle valign-' + (cfg.subtitle.valign || 'middle'), panel);
    var subGloss = el('div', 'band__gloss', subBand);
    var subtitle = el('div', 'band__text', subBand);
    this.subBand = subBand; this.subtitle = subtitle; this.subGloss = subGloss;

    var rows = el('div', 'rows', panel);
    this.rowsEl = rows;

    var outline = el('div', 'panel__outline', panel);
    this.outline = outline;

    this.apply();
    return this;
  };

  /* Re-theme + rebuild without touching config source */
  Panel.prototype.apply = function () {
    var cfg = this.cfg, self = this;
    loadFonts(cfg);

    var p = cfg.panel, h = cfg.header, s = cfg.subtitle, t = cfg.topics, a = cfg.animation;
    var panel = this.panel;

    /* gloss gradient shared by header / rows — light only, never black */
    panel.style.setProperty('--gloss-gradient',
      'linear-gradient(180deg, rgba(255,255,255,0.50) 0%, rgba(255,255,255,0.14) 26.7%, rgba(255,255,255,0.02) 74.2%, rgba(255,255,255,0.22) 100%)');
    panel.style.setProperty('--rows-gap', (t.gap || 0) + 'px');

    /* header */
    this.header.style.setProperty('--header-h', h.height + 'px');
    this.header.style.setProperty('--header-bg', gradient(h.gradient, 180));
    this.headerGloss.style.display = h.gloss ? 'block' : 'none';
    this.header.classList.toggle('hidden', !h.visible);

    var ht = h.title;
    this.header.style.setProperty('--header-font', ht.fontFamily);
    this.header.style.setProperty('--header-weight', ht.weight);
    this.header.style.setProperty('--header-size', ht.size + 'px');
    this.header.style.setProperty('--header-color', ht.color);
    this.header.style.setProperty('--header-tracking', (ht.letterSpacing || 0) + 'px');
    this.header.style.setProperty('--header-lh', ht.lineHeight || 1.05);
    this.header.style.setProperty('--header-align', ht.align || 'center');
    this.header.style.setProperty('--header-shadow', ht.shadow || 'none');
    this.header.style.setProperty('--header-pad-x', (ht.paddingX == null ? 12 : ht.paddingX) + 'px');
    this.header.style.setProperty('--header-pad-y', (ht.paddingY == null ? 0 : ht.paddingY) + 'px');
    this.title.textContent = ht.uppercase ? String(ht.text || '').toUpperCase() : String(ht.text || '');

    /* subtitle */
    this.subBand.style.setProperty('--subtitle-h', s.height + 'px');
    this.subBand.style.setProperty('--subtitle-bg', gradient(s.gradient, 180));
    this.subGloss.style.display = s.gloss ? 'block' : 'none';
    this.subBand.classList.toggle('hidden', !s.visible);

    this.subBand.style.setProperty('--subtitle-font', s.fontFamily);
    this.subBand.style.setProperty('--subtitle-weight', s.weight);
    this.subBand.style.setProperty('--subtitle-size', s.size + 'px');
    this.subBand.style.setProperty('--subtitle-color', s.color);
    this.subBand.style.setProperty('--subtitle-tracking', (s.letterSpacing || 0) + 'px');
    this.subBand.style.setProperty('--subtitle-lh', s.lineHeight || 1.1);
    this.subBand.style.setProperty('--subtitle-align', s.align || 'center');
    this.subBand.style.setProperty('--subtitle-shadow', s.shadow || 'none');
    this.subBand.style.setProperty('--subtitle-pad-x', (s.paddingX == null ? 12 : s.paddingX) + 'px');
    this.subBand.style.setProperty('--subtitle-pad-y', (s.paddingY == null ? 0 : s.paddingY) + 'px');
    var subText = s.autoDate ? formatDate(s.dateFormat) : s.text;
    this.subtitle.textContent = s.uppercase ? String(subText || '').toUpperCase() : String(subText || '');

    /* rows */
    var items = (t.items || []).filter(function (i) { return i.enabled !== false && String(i.text || '').trim() !== ''; })
      .slice(0, t.maxRows || 99);

    var rowH = t.rowHeight;
    if (p.autoFitHeight) {
      var avail = cfg.stage.height - (p.verticalAnchor === 'top' ? p.y : 0) - 2 * (p.borderWidth || 0) - 20;
      var fixed = (h.visible ? h.height : 0) + (s.visible ? s.height : 0) + (t.gap || 0) * Math.max(0, items.length - 1);
      var maxRowH = items.length ? Math.floor((avail - fixed) / items.length) : rowH;
      rowH = Math.max(30, Math.min(t.rowHeight, maxRowH));
    }

    this.rowsEl.innerHTML = '';
    this.rowEls = [];
    var rowBg = gradient(t.gradient, 180);

    items.forEach(function (item, i) {
      var row = el('div', 'row', self.rowsEl);
      row.style.setProperty('--row-h', rowH + 'px');
      row.style.setProperty('--row-bg', rowBg);

      if (t.gloss) el('div', 'row__gloss', row);

      var txt = el('div', 'row__text', row);
      txt.textContent = t.text.uppercase ? String(item.text).toUpperCase() : String(item.text);

      if (t.separator && t.separator.enabled) {
        var sep = el('div', 'row__sep', row);
        sep.style.setProperty('--row-sep-h', (t.separator.height || 1) + 'px');
        sep.style.setProperty('--row-sep-c', t.separator.color);
      }
      self.rowEls.push({ root: row, text: txt, item: item, index: i });
    });

    this.rowsEl.style.setProperty('--row-font', t.text.fontFamily);
    this.rowsEl.style.setProperty('--row-weight', t.text.weight);
    this.rowsEl.style.setProperty('--row-size', t.text.size + 'px');
    this.rowsEl.style.setProperty('--row-color', t.text.color);
    this.rowsEl.style.setProperty('--row-tracking', (t.text.letterSpacing || 0) + 'px');
    this.rowsEl.style.setProperty('--row-lh', t.text.lineHeight || 1.12);
    this.rowsEl.style.setProperty('--row-align', t.text.align || 'center');
    this.rowsEl.style.setProperty('--row-pad-x', (t.text.paddingX == null ? 14 : t.text.paddingX) + 'px');
    this.rowsEl.style.setProperty('--row-text-shadow', t.text.shadow || 'none');

    /* panel geometry (height follows content) */
    var totalH = 2 * (p.borderWidth || 0) +
      (h.visible ? h.height : 0) + (s.visible ? s.height : 0) +
      items.length * rowH + (t.gap || 0) * Math.max(0, items.length - 1);
    var top = p.y;
    if (p.verticalAnchor === 'middle') top = Math.round((cfg.stage.height - totalH) / 2) + p.y;
    else if (p.verticalAnchor === 'bottom') top = cfg.stage.height - totalH - p.y;
    panel.style.setProperty('--panel-y', top + 'px');
    panel.style.setProperty('--panel-h', totalH + 'px');

    /* text auto-shrink */
    var fitAll = function () {
      self.fitText(self.title, self.header.clientHeight - (ht.paddingY || 0) * 2, ht);
      self.fitText(self.subtitle, self.subBand.clientHeight - (s.paddingY || 0) * 2, s);
      self.rowEls.forEach(function (r) {
        self.fitText(r.text, rowH - 4, {
          size: t.text.size, maxLines: t.text.maxLines, autoShrink: t.text.autoShrink, minSize: t.text.minSize
        });
      });
    };
    fitAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll).catch(function () {});

    this.state.built = true;
  };

  /* Shrink a text node until it fits its box (mimics Singular's auto-fit) */
  Panel.prototype.fitText = function (node, boxH, spec) {
    if (!node || !spec || spec.autoShrink === false) return;
    var max = parseFloat(spec.size) || 40;
    var min = parseFloat(spec.minSize) || 12;
    var maxLines = spec.maxLines || 2;
    node.style.fontSize = max + 'px';
    var size = max, guard = 0;
    /* boxH is a hard limit only when a fixed number of lines is allowed */
    while (guard++ < 40) {
      var lineH = parseFloat(getComputedStyle(node).lineHeight) || size * 1.1;
      var fits = node.scrollHeight <= lineH * maxLines + 2 && node.scrollWidth <= node.clientWidth + 2;
      if (fits && (!boxH || lineH * maxLines <= boxH + 2)) break;
      size -= 1;
      if (size <= min) break;
      node.style.fontSize = size + 'px';
    }
  };

  /* ------------------------------------------------------------ animation */
  Panel.prototype.buildTimeline = function () {
    var cfg = this.cfg, a = cfg.animation, self = this;
    if (this.tl) this.tl.kill();
    this.tl = gsap.timeline({ paused: true, onComplete: function () { self.state.playing = true; } });

    var rowH = this.rowEls.length ? this.rowEls[0].root.offsetHeight : a.rowDistance;
    var dist = a.rowDistance || rowH;

    function fromVars() {
      switch (a.rowFrom) {
        case 'bottom': return { y: dist };
        case 'left': return { x: -dist };
        case 'right': return { x: dist };
        default: return { y: -dist };
      }
    }

    /* header band + texts */
    this.tl.from(this.header, { yPercent: -100, duration: a.headerDuration, ease: a.headerEase }, 0.1);
    this.tl.from(this.outline, { yPercent: -100, duration: a.headerDuration, ease: a.headerEase }, 0);
    this.tl.from([this.title, this.subtitle], {
      opacity: 0, y: -26, duration: a.textDuration, ease: a.textEase
    }, 0.5);

    /* rows, staggered */
    this.rowEls.forEach(function (r, i) {
      var vars = fromVars();
      vars.duration = a.rowDuration;
      vars.ease = a.rowEase;
      if (a.fadeRows) vars.opacity = 0;
      self.tl.from(r.root, vars, a.rowStart + i * a.rowStagger);
    });

    /* NOTE: the outro is deliberately NOT part of this timeline.
       The intro is the only thing that animates automatically — once it has
       played the panel stays on screen until an explicit OUT command. */
    return this.tl;
  };

  Panel.prototype.play = function (delay) {
    if (!this.tl) this.buildTimeline();
    gsap.set(this.panel, { opacity: 1 });
    /* Rewind, set the delay, then start: calling .delay() on an already-playing
       timeline makes GSAP re-begin it (the entrance played twice). */
    this.tl.pause(0);
    this.tl.delay(delay || 0);
    this.tl.play();
    this.state.onAir = true;
    this.state.playing = true;

    /* Safety net. GSAP's .from() applies its invisible start state immediately,
       so if the entrance is ever interrupted — a throttled or paused rAF in a
       hidden OBS browser source, a dropped frame — every row would sit at
       opacity 0 and the panel would stay invisible on air. Force the finished
       state shortly after the timeline should have ended. */
    var self = this;
    clearTimeout(this._safety);
    var span = (typeof this.tl.duration === 'function' ? this.tl.duration() : 0) || 3;
    this._safety = setTimeout(function () {
      if (!self.state.onAir || !self.tl) return;
      if (typeof self.tl.progress === 'function' && self.tl.progress() < 1) {
        console.warn('[topics] entrance did not finish — snapping to the visible state');
        self.tl.progress(1, true).pause();
      }
    }, ((delay || 0) + span + 0.6) * 1000);
  };

  /* Jump straight to the fully-visible state without animating.
     Used when a config change re-renders an already-on-air panel. */
  Panel.prototype.showInstant = function () {
    if (!this.tl) this.buildTimeline();
    clearTimeout(this._safety);
    gsap.set(this.panel, { opacity: 1 });
    this.tl.progress(1, true).pause();
    this.state.onAir = true;
    this.state.playing = true;
  };

  Panel.prototype.hideInstant = function () {
    clearTimeout(this._safety);
    if (this.tl) this.tl.pause(0);
    gsap.set(this.panel, { opacity: 0 });
    this.state.onAir = false;
    this.state.playing = false;
  };

  /* No exit animation: this overlay is meant for OBS, where you simply hide
     the browser source. "out" only takes the panel off air (instantly). */
  Panel.prototype.out = function () {
    this.hideInstant();
  };

  Panel.prototype.replay = function () {
    gsap.set(this.panel, { opacity: 1, x: 0, y: 0 });
    this.buildTimeline();
    this.play();
  };

  /* --------------------------------------------------------------- stage fit */
  function fitStage(cfg) {
    var stage = document.getElementById('stage');
    var w = window.innerWidth, h = window.innerHeight;
    var s = 1;
    switch (cfg.stage.fit) {
      case 'cover': s = Math.max(w / cfg.stage.width, h / cfg.stage.height); break;
      case 'width': s = w / cfg.stage.width; break;
      case 'none': s = 1; break;
      default: s = Math.min(w / cfg.stage.width, h / cfg.stage.height);
    }
    var left = 0;
    if (cfg.stage.fit === 'contain' || cfg.stage.fit === 'none') {
      if (cfg.stage.alignX === 'center') left = (w - cfg.stage.width * s) / 2;
      else if (cfg.stage.alignX === 'right') left = w - cfg.stage.width * s;
    }
    stage.style.setProperty('--stage-scale', s);
    stage.style.transform = 'translate3d(' + left + 'px, 0, 0) scale(' + s + ')';
  }

  /* ------------------------------------------------------------------- boot */
  window.TP = {
    cfg: null,
    panel: null,
    ready: false,
    apply: function (patch, opts) {
      opts = opts || {};
      var wasOnAir = !!(this.panel && this.panel.state.onAir);
      this.cfg = mergeIncoming(this.cfg || {}, patch || {});
      if (this.panel) this.panel.cfg = this.cfg;
      fitStage(this.cfg);
      if (!this.panel) this.panel = new Panel(this.cfg);
      this.panel.mount();
      this.panel.buildTimeline();

      if (opts.animate === true) {
        /* explicit intro: first load, replay, or an admin "play" */
        this.panel.play(this.cfg.animation.autoPlayDelay);
      } else if (opts.animate === 'static') {
        this.panel.showInstant();
      } else if (wasOnAir) {
        /* config edited while on air → stay visible, do NOT replay the intro */
        this.panel.showInstant();
      } else {
        /* off air → stay hidden until an IN command */
        this.panel.hideInstant();
      }
      if (this.cfg.animation.loopPreview && /preview=1/.test(location.search)) this.startLoop();
      return this.cfg;
    },
    play: function () { this.panel && this.panel.play(); },
    out: function () { this.panel && this.panel.out(); },
    replay: function () { this.panel && this.panel.replay(); },
    getConfig: function () { return this.cfg; },
    startLoop: function () {
      var self = this;
      if (this._loop) clearInterval(this._loop);
      var run = function () {
        self.panel.play();
        self._loopT = setTimeout(function () { self.panel.out(); }, (self.cfg.animation.loopHoldIn + self.cfg.animation.rowStart) * 1000);
      };
      run();
      this._loop = setInterval(run, (self.cfg.animation.loopHoldIn + self.cfg.animation.loopHoldOut + 3) * 1000);
    }
  };

  function start() {
    var cfg = deepMerge(SHIPPED, {});
    var qs = new URLSearchParams(location.search);
    var noSync = qs.get('nosync') === '1';

    /* localStorage (shared with the admin panel / OBS on the same origin) */
    try {
      var ls = localStorage.getItem(LS_KEY);
      if (ls) cfg = mergeIncoming(cfg, JSON.parse(ls));
    } catch (e) { /* ignore */ }

    /* ?configUrl=… | ?config=<base64 json> | ?fit=contain|cover|width|none */
    if (qs.get('configUrl')) { cfg.sync = cfg.sync || {}; cfg.sync.serverConfigUrl = qs.get('configUrl'); }
    if (qs.get('config')) {
      try { cfg = deepMerge(cfg, JSON.parse(atob(qs.get('config')))); } catch (e) { /* ignore */ }
    }
    if (qs.get('fit')) cfg.stage.fit = qs.get('fit');

    var booted = false;
    var lastCfgJson = '';
    var lastSeq = -1;

    /* ---- live sync #1: admin panel via postMessage ---- */
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'tp:config') window.TP.apply(resolveTheme(d.config));
      else if (d.type === 'tp:command') handleCommand(d);
    });

    /* ---- live sync #2: another tab on the same origin ---- */
    window.addEventListener('storage', function (ev) {
      if (ev.key === LS_KEY && ev.newValue) {
        try { window.TP.apply(resolveTheme(JSON.parse(ev.newValue))); } catch (e) { /* ignore */ }
      }
      if (ev.key === STATE_KEY && ev.newValue) {
        try { handleCommand(JSON.parse(ev.newValue)); } catch (e) { /* ignore */ }
      }
    });

    window.addEventListener('resize', function () { fitStage(window.TP.cfg); });

    /* keyboard: I plays the entrance */
    window.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'i' || e.key === 'I') window.TP.play();
    });

    /* First paint: give the control server a moment to hand over config.json so
       the entrance animation only ever runs once, with the right content. */
    function boot(serverCfg) {
      if (booted) return;
      booted = true;
      if (serverCfg) {
        cfg = mergeIncoming(cfg, serverCfg);
        lastCfgJson = JSON.stringify(serverCfg);
      }
      cfg = resolveTheme(cfg);
      window.TP.apply(cfg, { animate: cfg.animation.autoPlay ? true : 'static' });
    }

    function fetchConfig() {
      var u = (window.TP.cfg && window.TP.cfg.sync && window.TP.cfg.sync.serverConfigUrl) || 'config.json';
      return fetch(u + (u.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && Object.keys(j).length) ? j : null; })
        .catch(function () { return null; });
    }

    /* ---- live sync #3: server config.json (what the OBS source follows) ---- */
    function pollConfig() {
      if (!booted) return;
      fetchConfig().then(function (j) {
        if (!j) return;
        var s = JSON.stringify(j);
        if (s === lastCfgJson) return;
        lastCfgJson = s;
        window.TP.apply(resolveTheme(j));   /* keeps the on-air state: no intro replay */
      });
    }

    /* ---- commands from the server (Stream Deck / Companion / curl) ---- */
    function pollState() {
      if (!booted) return;
      var s = (window.TP.cfg && window.TP.cfg.sync) || {};
      fetch((s.stateUrl || 'api/state') + '?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (st) {
          if (!st || st.seq == null || st.seq === lastSeq) return;
          lastSeq = st.seq;
          handleCommand(st);
        })
        .catch(function () { /* no server: ignore */ });
    }

    if (noSync) {
      boot(null);
      return;
    }

    var settled = false;
    fetchConfig().then(function (j) { settled = true; boot(j); });
    setTimeout(function () { if (!settled) boot(null); }, 900);

    setInterval(pollConfig, (cfg.sync && cfg.sync.pollMs) || 1500);
    setInterval(pollState, (cfg.sync && cfg.sync.statePollMs) || 700);
    setTimeout(pollState, 400);
  }

  /* Dark is merged over the resolved config so the admin keeps editing the light
     design. ?theme= wins over the saved setting, which is how one browser source
     can be dark while the others stay light.

     Deliberately at module scope: both the `config` branch of handleCommand and
     start()'s own merge path call it, and while it lived inside start() the
     command branch threw a ReferenceError instead of applying a theme. */
  function resolveTheme(config) {
    var forced = (String(location.search).match(/[?&]theme=(dark|light)(?:&|$)/) || [])[1];
    var want = forced || config.theme || 'light';
    if (want !== 'dark' || !window.TP_DARK_PALETTE) return config;
    return deepMerge(config, window.TP_DARK_PALETTE);
  }

  function handleCommand(cmd) {
    if (!cmd) return;
    switch (cmd.action) {
      case 'in': case 'play': window.TP.play(); break;
      case 'out': window.TP.out(); break;
      case 'replay': window.TP.replay(); break;
      case 'config':
        if (cmd.config) window.TP.apply(resolveTheme(cmd.config), { animate: false });
        break;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
