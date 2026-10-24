/* ============================================================================
   Digital Assets Market — overlay engine
   ----------------------------------------------------------------------------
     • fetches CoinGecko through our own cached proxy, then direct, then cache
     • renders a four-column board: asset / price / 24h / 7d
     • category tabs (PRIVACY · REVENUE · AI · DINO COINS · DEFI), switched by hand:
        click, arrow keys, or the next/prev commands. Deliberately no
        auto-rotate — on air the board holds the category you chose.
     • GSAP everywhere: entrance, tab swaps, sliding pill, price ticks

   The entrance plays once — this is an OBS browser source, so there is no
   outro; the source is simply hidden. Everything else (tab changes, live price
   updates) animates every time.
   ========================================================================== */
(function () {
  'use strict';

  var REDUCE_MOTION = false;
  try {
    REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* older browsers */ }

  /* GSAP is vendored, with a CDN fallback in index.html. If both are missing the
     board must still render — a static overlay beats a blank one. */
  var HAS_GSAP = !!(window.gsap && window.gsap.timeline);
  if (!HAS_GSAP) {
    var noop = function () { return this; };
    var stub = { from: noop, to: noop, set: noop, kill: noop, progress: function () { return 1; },
                 pause: noop, play: noop, delay: noop, duration: function () { return 0; } };
    window.gsap = {
      timeline: function () { return Object.create(stub); },
      from: noop, to: noop, set: noop,
      fromTo: function (t, f, to) { if (to && to.onUpdate) to.onUpdate(); }
    };
  }
  var gsap = window.gsap;

  var SHIPPED = window.CM_DEFAULT_CONFIG || {};

  /* ------------------------------------------------------------ config merge */
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

  /* Anything from storage may predate the current build. Same contract as the
     other widgets: a matching version keeps your edits, a different version
     keeps your CONTENT and takes the shipped LOOK. */
  var CONTENT_KEYS = ['categories', 'maxRows', 'data'];
  var LOOK_KEYS = ['stage', 'panel', 'header', 'tabs', 'columns', 'rows', 'colors', 'animation'];

  /* A signature of everything the board actually renders — `meta` excluded.
     Migrating a saved config stamps `meta.migratedFrom` onto it, which is
     bookkeeping the board never shows, yet comparing the whole JSON made the
     first config poll tear the board down and rebuild it. Exported so the test
     suite can pin the rule without waiting on a timer. */
  function boardSignature(c) {
    var copy = deepMerge(c, {});
    delete copy.meta;
    return JSON.stringify(copy);
  }

  /* Only a genuinely OLDER build triggers the content-only migration.
     CM_MIGRATE.apply() reads a missing `meta.version` as "unknown old build" and
     keeps only CONTENT_KEYS — so calling it unconditionally silently discarded
     every look key in a patch that carried no version. That made ?config= a
     no-op for anything but categories/currency, and would do the same to any
     partial push or an unversioned config.json. */
  function mergeIncoming(base, incoming) {
    if (!isObj(incoming)) return base;
    var M = window.CM_MIGRATE;
    var sv = incoming.meta && incoming.meta.version;
    var bv = base.meta && base.meta.version;
    if (M && typeof M.apply === 'function' && sv && sv !== bv) {
      var out = M.apply(base, incoming);
      if (M.lastNote) console.info('[market] ' + M.lastNote);
      return out;
    }
    /* same version (your edits win) or an unversioned patch (merge it) */
    return deepMerge(base, incoming);
  }

  /* A column's flex value. With fitWidth the three numbers grow in proportion
     to the configured width, so the set always fills whatever the panel is —
     the header and the rows call this, so they cannot drift apart. Fixed basis
     keeps the column sane when the row is narrower than the total; the grow
     term spends any surplus in proportion rather than dumping it in one gap. */
  function colFlex(cfg, key, fallback) {
    var w = (cfg.columns.widths && cfg.columns.widths[key]) || fallback;
    return (cfg.columns.fitWidth === false)
      ? '0 0 ' + w + 'px'
      : w + ' 1 ' + w + 'px';
  }

  /* ---------------------------------------------------------------- helpers */
  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function setText(node, text) {
    if (!node) return;
    text = text == null ? '' : String(text);
    if (node.textContent !== text) node.textContent = text;
  }

  /* Price formatting. Coin prices span twelve orders of magnitude, so a fixed
     decimal count is wrong at one end or the other:
       $83,968.00   >= 1     → 2 decimals
       $0.303       >= 0.01  → 3 decimals (matches the reference board)
       $0.00001234  below    → significant digits, so it never renders $0.000 */
  function formatPrice(value, cfg) {
    if (value == null || !isFinite(value)) return '—';
    var p = cfg.price || {};
    var prefix = p.prefix == null ? '$' : p.prefix;
    var abs = Math.abs(value);
    var out;
    if (p.format === 'compact') {
      out = compact(value);
    } else if (abs >= 1) {
      out = value.toLocaleString('en-US', {
        minimumFractionDigits: p.decimals == null ? 2 : p.decimals,
        maximumFractionDigits: p.decimals == null ? 2 : p.decimals
      });
    } else if (abs >= 0.01) {
      var d = p.smallDecimals == null ? 3 : p.smallDecimals;
      out = value.toFixed(d);
    } else if (abs === 0) {
      out = '0.00';
    } else {
      /* 4 significant digits, then trim to at most 8 decimals */
      out = value.toPrecision(4);
      if (out.indexOf('e') !== -1) out = value.toFixed(8);
      out = out.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    }
    return prefix + out;
  }

  function compact(value) {
    var abs = Math.abs(value);
    var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i++) {
      if (abs >= units[i][0]) {
        var n = value / units[i][0];
        return (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '')) + units[i][1];
      }
    }
    return value.toFixed(abs >= 1 ? 2 : 4);
  }

  function formatChange(value, cfg) {
    if (value == null || !isFinite(value)) return '—';
    var c = cfg.change || {};
    var d = c.decimals == null ? 2 : c.decimals;
    var sign = value > 0 ? '+' : (value < 0 ? '-' : '');
    if (!c.showSign) sign = value < 0 ? '-' : '';
    return sign + Math.abs(value).toFixed(d) + '%';
  }

  /* direction is carried by colour AND a sign, never colour alone */
  function dirClass(value) {
    if (value == null || !isFinite(value) || value === 0) return 'is-flat';
    return value > 0 ? 'is-up' : 'is-down';
  }

  /* ---------------------------------------------------------------- fonts
     The faces are files in fonts/, registered by fonts/fonts.css. index.html
     links that stylesheet; this adds it if a page loaded the engine without
     the tag. No remote stylesheet — the Windows OBS machine must not depend
     on a font CDN. */
  function loadFonts() {
    var head = document.head || document.documentElement;
    if (!head || !document.createElement) return;
    if (document.querySelector && document.querySelector('link[data-cm-fonts]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'fonts/fonts.css';
    link.setAttribute('data-cm-fonts', '1');
    head.appendChild(link);
  }

  /* ------------------------------------------------------------ stage fit */
  function fitStage(cfg) {
    var stage = document.getElementById('stage');
    if (!stage) return;
    var w = window.innerWidth, h = window.innerHeight, s = 1;
    switch (cfg.stage.fit) {
      case 'cover': s = Math.max(w / cfg.stage.width, h / cfg.stage.height); break;
      case 'width': s = w / cfg.stage.width; break;
      case 'none': s = 1; break;
      default: s = Math.min(w / cfg.stage.width, h / cfg.stage.height);
    }
    stage.style.setProperty('--stage-scale', s);
  }

  function alignOffset(align, outer, inner) {
    if (align === 'center' || align === 'middle') return Math.round((outer - inner) / 2);
    if (align === 'right' || align === 'bottom') return outer - inner;
    return 0;
  }

  /* ============================================================== the board */
  function Board(cfg, stage) {
    this.cfg = cfg;
    this.stage = stage;
    this.data = {};          /* id -> coin record */
    this.state = { loaded: false, error: null, fromCache: false, fetchedAt: 0, onAir: false };
    this.activeIndex = 0;
    this.rowEls = [];
    this.tl = null;
    this._safety = null;
  }

  Board.prototype.mount = function () {
    var self = this, cfg = this.cfg;
    loadFonts();
    document.body.classList.toggle('debug', !!cfg.debug);

    /* ?category=<id> resolves to an index before the build, so the very first
       render is the requested category — and the tab marker and the rows can
       never disagree. */
    if (cfg.__startIndex) this.activeIndex = cfg.__startIndex;

    this.stage.style.setProperty('--stage-w', cfg.stage.width + 'px');
    this.stage.style.setProperty('--stage-h', cfg.stage.height + 'px');
    this.stage.style.setProperty('--stage-bg', cfg.stage.background);
    this.stage.innerHTML = '';

    var p = cfg.panel;
    var panel = el('div', 'panel', this.stage);
    panel.style.setProperty('--panel-w', p.width + 'px');
    panel.style.setProperty('--panel-radius', (p.radius || 0) + 'px');
    panel.style.setProperty('--panel-bg', p.background);
    panel.style.setProperty('--panel-border-w', (p.borderWidth || 1) + 'px');
    panel.style.setProperty('--panel-border-c', p.borderColor);
    panel.style.setProperty('--panel-shadow', p.shadow || 'none');
    panel.style.setProperty('--panel-opacity', p.opacity == null ? 1 : p.opacity);
    /* grows from the centre, so the board stays centred at any zoom */
    panel.style.setProperty('--panel-zoom', (p.zoom == null ? 1 : p.zoom));
    panel.style.setProperty('--panel-pad-x', (p.paddingX || 26) + 'px');
    panel.style.setProperty('--panel-pad-top', (p.paddingTop || 22) + 'px');
    panel.style.setProperty('--panel-pad-bottom', (p.paddingBottom || 18) + 'px');
    var g = p.glass || {};
    panel.style.setProperty('--panel-blur', (g.blur == null ? 26 : g.blur) + 'px');
    panel.style.setProperty('--panel-sat', (g.saturate == null ? 140 : g.saturate) + '%');
    panel.style.setProperty('--panel-inner', g.innerHighlight || 'none');
    panel.style.setProperty('--panel-sheen', g.sheen || 'none');
    this.panel = panel;

    /* ---- title ---- */
    var h = cfg.header;
    var title = el('div', 'board-title', panel);
    title.dataset.testid = 'title';
    title.textContent = h.text || '';
    title.classList.toggle('hidden', !h.visible);
    title.classList.toggle('board-title--rule', !!h.rule);
    title.style.setProperty('--title-font', h.fontFamily);
    title.style.setProperty('--title-weight', h.weight);
    title.style.setProperty('--title-size', h.size + 'px');
    title.style.setProperty('--title-color', h.color);
    title.style.setProperty('--title-tracking', (h.letterSpacing || 0) + 'px');
    title.style.setProperty('--title-align', h.align || 'left');
    title.style.setProperty('--title-transform', h.uppercase ? 'uppercase' : 'none');
    title.style.setProperty('--title-pad-bottom', (h.paddingBottom || 0) + 'px');
    title.style.setProperty('--title-rule-w', (h.ruleWidth || 1) + 'px');
    title.style.setProperty('--title-rule-c', h.ruleColor || 'transparent');
    title.style.setProperty('--title-shadow', h.shadow || 'none');
    this.title = title;

    /* ---- tabs ---- */
    this.buildTabs();

    /* ---- column headers ---- */
    this.buildColumns();

    /* ---- rows container ---- */
    this.rowsEl = el('div', 'rows', panel);

    /* ---- footer note (updated / cached / retrying) ---- */
    var note = el('div', 'board-note', panel);
    note.dataset.testid = 'note';
    this.note = note;

    this.applyPalette();
    /* No layout() here: the panel is sized by its content, so placing it before
       the rows exist centres a panel that has no rows yet. renderRows() ends by
       placing it — see the note there. */
    this.renderRows();
    /* Mark the active tab before anything animates. On load there is no switch
       to trigger it, so without this the board came up with NO tab highlighted
       and every tab reporting aria-pressed="false" — the indicator only appeared
       once the operator clicked a tab or sent next/prev. */
    this.movePill(true);
    return this;
  };

  Board.prototype.applyPalette = function () {
    var c = this.cfg.colors, r = this.cfg.rows, col = this.cfg.columns, panel = this.panel;

    /* A base face for anything that does not set its own. Two bugs of the same
       shape have now shipped here — `--rank-font` was referenced but never
       assigned, and `--cols-font` was assigned somewhere the note under the rows
       could not inherit it — and each time the symptom was the browser's default
       serif, because nothing sets a font on html or body either. */
    panel.style.setProperty('--board-font', r.price.fontFamily);

    /* Column-header typography is published on the PANEL rather than on the
       header row that uses it first. The note below the rows reads
       --cols-font/--cols-color too, and a custom property set on a sibling is
       not inherited by it: the note's `font-family: var(--cols-font)` had
       nothing to resolve against, which is invalid at computed-value time and
       dropped that text to the default serif while every other row kept the
       right face. */
    panel.style.setProperty('--cols-font', col.fontFamily);
    panel.style.setProperty('--cols-weight', col.weight);
    panel.style.setProperty('--cols-size', col.size + 'px');
    panel.style.setProperty('--cols-color', col.color);
    panel.style.setProperty('--cols-tracking', (col.letterSpacing || 0) + 'px');
    panel.style.setProperty('--cols-transform', col.uppercase ? 'uppercase' : 'none');

    panel.style.setProperty('--up', c.up);
    panel.style.setProperty('--down', c.down);
    panel.style.setProperty('--flat', c.flat);
    panel.style.setProperty('--rank-color', c.rankColor);
    /* --rank-font was referenced by the stylesheet but never assigned, so the
       browser fell back to its default serif for the rank numerals. */
    panel.style.setProperty('--rank-font', r.price.fontFamily);
    panel.style.setProperty('--rank-size', (r.rankSize || 15) + 'px');
    panel.style.setProperty('--spark-h', ((r.sparkline && r.sparkline.height) || 26) + 'px');

    var a = r.asset;
    panel.style.setProperty('--asset-font', a.fontFamily);
    panel.style.setProperty('--asset-name-size', a.nameSize + 'px');
    panel.style.setProperty('--asset-name-weight', a.nameWeight);
    panel.style.setProperty('--asset-name-c', a.nameColor);
    panel.style.setProperty('--asset-ticker-size', a.tickerSize + 'px');
    panel.style.setProperty('--asset-ticker-weight', a.tickerWeight);
    panel.style.setProperty('--asset-ticker-c', a.tickerColor);
    panel.style.setProperty('--asset-ticker-tracking', (a.tickerLetterSpacing || 0) + 'px');
    panel.style.setProperty('--asset-gap', (a.gap || 3) + 'px');

    panel.style.setProperty('--logo-size', r.logo.size + 'px');
    panel.style.setProperty('--logo-fallback-bg', r.logo.fallbackBackground);
    panel.style.setProperty('--logo-fallback-c', r.logo.fallbackColor);

    panel.style.setProperty('--num-font', r.price.fontFamily);
    panel.style.setProperty('--price-size', r.price.size + 'px');
    panel.style.setProperty('--price-weight', r.price.weight);
    panel.style.setProperty('--price-c', r.price.color);
    panel.style.setProperty('--change-size', r.change.size + 'px');
    panel.style.setProperty('--change-weight', r.change.weight);

    panel.style.setProperty('--row-h', r.height + 'px');
    panel.style.setProperty('--rows-gap', (r.gap || 0) + 'px');
    panel.style.setProperty('--row-radius', (r.radius || 0) + 'px');
    panel.style.setProperty('--row-pad-x', (r.padX == null ? 10 : r.padX) + 'px');
    panel.style.setProperty('--row-div-c', r.divider && r.divider.enabled ? r.divider.color : 'transparent');
    panel.style.setProperty('--row-div-w', ((r.divider && r.divider.width) || 1) + 'px');
    panel.style.setProperty('--row-zebra-c', r.zebraColor);
    panel.style.setProperty('--row-flash-c', r.tickFlash);
  };

  /* Column headers are built from `columns.order`, so a column can be reordered
     or dropped without touching the render code. */
  Board.prototype.buildColumns = function () {
    var cfg = this.cfg, col = cfg.columns;
    var node = el('div', 'cols', this.panel);
    node.dataset.testid = 'cols';
    node.classList.toggle('hidden', !col.visible);
    node.classList.toggle('cols--rule', !!col.rule);
    node.style.setProperty('--cols-h', col.height + 'px');
    /* only what belongs to this strip: the typography it shares with the note
       under the rows is published on the panel (see applyPalette) */
    node.style.setProperty('--cols-rule-c', col.ruleColor);
    node.innerHTML = '';

    col.order.forEach(function (key) {
      var c = el('div', 'col', node);
      c.dataset.col = key;
      var label = (col.labels && col.labels[key]) || key;
      c.textContent = label;
      if (key === 'asset') {
        c.classList.add('col--asset');
        /* A SHARED fixed basis, not max-width. Sizing to content let the header
           ('ASSET', ~57px) and the cell (logo + name, ~154px) resolve to different
           widths — which is exactly what drifted the labels off their data. */
        c.style.flex = colFlex({ columns: col }, 'asset', 300);
        c.style.minWidth = '0';
      } else if (key === 'sparkline') {
        c.style.flex = colFlex({ columns: col }, key, 160);
        c.style.textAlign = 'left';
        c.classList.add('col--spark');
      } else {
        c.style.flex = colFlex({ columns: col }, key, 160);
        c.style.textAlign = (col.align && col.align[key]) || 'right';
        c.classList.add(key === 'rank' ? 'col--rank' : 'col--num');
      }
    });
    this.colsEl = node;
  };

  Board.prototype.buildTabs = function () {
    var cfg = this.cfg, t = cfg.tabs;
    var wrap = el('div', 'tabs', this.panel);
    wrap.dataset.testid = 'tabs';
    wrap.classList.toggle('hidden', !t.visible);
    wrap.style.setProperty('--tabs-gap', (t.gap || 10) + 'px');
    wrap.style.setProperty('--tabs-h', (t.height || 34) + 'px');
    wrap.style.setProperty('--tabs-pad-x', (t.paddingX || 15) + 'px');
    wrap.style.setProperty('--tabs-radius', (t.radius || 999) + 'px');
    wrap.style.setProperty('--tabs-font', t.fontFamily);
    wrap.style.setProperty('--tabs-weight', t.weight);
    wrap.style.setProperty('--tabs-size', t.size + 'px');
    wrap.style.setProperty('--tabs-tracking', (t.letterSpacing || 0) + 'px');
    wrap.style.setProperty('--tabs-transform', t.uppercase ? 'uppercase' : 'none');
    wrap.style.setProperty('--tabs-color', t.color);
    wrap.style.setProperty('--tabs-bg', t.background);
    wrap.style.setProperty('--tabs-border-c', t.borderColor);
    wrap.style.setProperty('--tabs-active-color', t.activeColor);
    wrap.style.setProperty('--tabs-active-bg', t.activeBackground);
    wrap.style.setProperty('--tabs-active-border', t.activeBorderColor);
    wrap.style.setProperty('--tabs-justify',
      t.align === 'center' ? 'center' : (t.align === 'right' ? 'flex-end' : 'flex-start'));
    wrap.style.setProperty('--tabs-mt', (t.marginTop || 0) + 'px');
    wrap.style.setProperty('--tabs-mb', (t.marginBottom == null ? 16 : t.marginBottom) + 'px');

    var self = this;
    this.tabEls = [];
    var pill = el('div', 'tab-pill', wrap);
    this.tabPill = pill;

    cfg.categories.forEach(function (cat, i) {
      var b = el('button', 'tab', wrap);
      b.type = 'button';
      b.dataset.testid = 'tab';
      b.dataset.category = cat.id;
      b.textContent = cat.label || cat.id;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { self.setCategory(i); });
      self.tabEls.push(b);
    });

    /* move the strip above the title when the config asks for it */
    if (t.position === 'above-title') this.panel.insertBefore(wrap, this.title);
    this.tabsEl = wrap;
    return wrap;
  };

  /* ------------------------------------------------------------- geometry */
  Board.prototype.layout = function () {
    var cfg = this.cfg, p = cfg.panel;
    if (p.heightMode === 'fill') {
      this.panel.style.setProperty('--panel-h', cfg.stage.height + 'px');
    } else {
      this.panel.style.setProperty('--panel-h', 'auto');
    }
    /* measured after the browser has laid the panel out */
    var w = this.panel.offsetWidth || p.width;
    var hgt = this.panel.offsetHeight || 0;
    var x, y;
    if (p.heightMode === 'fill') {
      x = p.x != null && p.x !== 0 ? p.x : alignOffset(cfg.stage.alignX, cfg.stage.width, w);
      y = p.y != null && p.y !== 0 ? p.y : 0;
    } else {
      x = alignOffset(cfg.stage.alignX, cfg.stage.width, w);
      y = alignOffset(cfg.stage.alignY, cfg.stage.height, hgt);
      if (p.x) x = p.x;
      if (p.y) y = p.y;
    }
    this.panel.style.setProperty('--panel-x', Math.round(x) + 'px');
    this.panel.style.setProperty('--panel-y', Math.round(y) + 'px');
  };

  /* ---------------------------------------------------------------- rows */
  Board.prototype.activeCategory = function () {
    var cats = this.cfg.categories || [];
    return cats[this.activeIndex] || cats[0] || { coins: [] };
  };

  Board.prototype.activeCoins = function () {
    var cat = this.activeCategory();
    return (cat.coins || []).slice(0, this.cfg.maxRows || 11);
  };

  function shortName(name, max) {
    if (!name) return '';
    if (!max || name.length <= max) return name;
    return name.slice(0, max - 1).trim() + '…';
  }

  Board.prototype.renderRows = function () {
    var self = this, cfg = this.cfg;
    var host = this.rowsEl;
    host.innerHTML = '';
    this.rowEls = [];
    /* the old rows are about to be discarded; their glow timelines target nodes
       that will be detached, so they have to be stopped explicitly or they keep
       ticking against nothing for the life of the page */
    (this._glowTweens || []).forEach(function (t) { try { t.kill(); } catch (e) { /* already gone */ } });
    this._glowTweens = [];
    this._sparkLines = [];

    var ids = this.activeCoins();
    ids.forEach(function (id, i) {
      var rec = self.data[id] || null;
      var row = el('div', 'row', host);
      row.dataset.testid = 'row';
      row.dataset.coin = id;
      if (cfg.rows.divider && cfg.rows.divider.enabled && i > 0) row.classList.add('row--divider');
      if (cfg.rows.zebra && i % 2 === 1) row.classList.add('zebra');
      if (!rec) row.classList.add('is-loading');

      el('div', 'row__flash', row);

      var shown = {};
      cfg.columns.order.forEach(function (key) {
        if (key === 'rank') {
          var rk = el('div', 'cell-rank', row);
          rk.style.flex = colFlex(cfg, 'rank', 46);
          setText(rk, rec && rec.rank ? String(rec.rank) : '\u2014');
          shown.rank = rk;
        } else if (key === 'asset') {
          var cell = el('div', 'cell-asset', row);
          /* same proportional flex as the header column above it */
          cell.style.flex = colFlex(cfg, 'asset', 300);
          cell.style.minWidth = '0';
          var logo = el('div', 'logo logo--' + (cfg.rows.logo.radius || 'circle'), cell);
          logo.dataset.testid = 'logo';
          self.setLogo(logo, rec);
          var names = el('div', 'asset-names', cell);
          var nm = el('div', 'asset-name', names);
          nm.dataset.testid = 'name';
          setText(nm, rec ? shortName(rec.name, cfg.rows.asset.nameMaxChars) : id);
          var tk = el('div', 'asset-ticker', names);
          tk.dataset.testid = 'ticker';
          setText(tk, rec ? rec.symbol : '\u2014');
          shown.asset = cell;
        } else if (key === 'sparkline') {
          var sp = el('div', 'cell-spark', row);
          sp.dataset.testid = 'sparkline';
          sp.style.flex = colFlex(cfg, 'sparkline', 108);
          self.drawSparkline(sp, rec);
          shown.sparkline = sp;
        } else if (key === 'price') {
          var pc = el('div', 'cell-price', row);
          pc.dataset.testid = 'price';
          pc.style.flex = colFlex(cfg, 'price', 190);
          setText(pc, rec ? formatPrice(rec.price, cfg.rows) : '\u2014');
          shown.price = pc;
        } else if (key === 'change24h' || key === 'change7d') {
          var cc = el('div', 'cell-change ' + dirClass(rec ? (key === 'change24h' ? rec.change24h : rec.change7d) : null), row);
          cc.dataset.testid = key;
          cc.style.flex = colFlex(cfg, key, 165);
          var v = rec ? (key === 'change24h' ? rec.change24h : rec.change7d) : null;
          setText(cc, rec ? formatChange(v, cfg.rows) : '\u2014');
          shown[key] = cc;
        }
      });

      self.rowEls.push({ root: row, coin: id, cells: shown });
    });

    this.updateNote();

    /* Place the panel LAST, once its content exists. The panel is sized by its
       rows (`heightMode: 'fit'`), so layout() can only centre it after they are
       built — running it first measured an empty panel and centred that, leaving
       the board roughly 250px too low with its last row off the bottom of the
       stage. It looked correct on a first load only because the ResizeObserver's
       initial callback happened to re-run layout() afterwards; every config poll
       rebuilds the board, and on those the offset stayed wrong. Tying the
       placement to the row build covers mount, a refresh and a category switch. */
    this.layout();
  };

  /* 7d trend. The line is grey on purpose (honest-dataviz: colour is spent on
     data, and the number already carries magnitude); only the endpoint dot takes
     the semantic colour, which is what makes direction readable at a glance
     without turning the table into a christmas tree. */
  Board.prototype.drawSparkline = function (host, rec) {
    var cfg = this.cfg.rows.sparkline || {};
    var pts = rec && rec.spark7d;
    host.innerHTML = '';
    if (!pts || pts.length < 2) return;

    var w = cfg.width || 96, h = cfg.height || 26;
    var pad = 3;
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var span = (max - min) || 1;
    var stepX = (w - pad * 2) / (pts.length - 1);
    var coords = pts.map(function (v, i) {
      var x = pad + i * stepX;
      var y = pad + (h - pad * 2) * (1 - (v - min) / span);
      return [x, y];
    });

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = '7 day trend';
    svg.appendChild(title);

    var up = (rec.change7d || 0) >= 0;
    var lineColour = cfg.colourLine ? (up ? this.cfg.colors.up : this.cfg.colors.down) : cfg.strokeColor;
    var d = coords.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(2) + ' ' + c[1].toFixed(2); }).join(' ');

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', lineColour);
    path.setAttribute('stroke-width', cfg.strokeWidth || 1.6);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(path);

    /* ---- travelling glow ----
       A second path with the same geometry, drawn as one short dash and animated
       along the line, then left to rest. The shape is a polyline, so its length is
       summed directly rather than via getTotalLength() — that returns 0 when the
       element has no layout, which is exactly a hidden OBS browser source. */
    var glowPath = null, glowTotal = 0, glowLen = 0;
    var glow = cfg.glow || {};
    if (glow.enabled !== false && !REDUCE_MOTION) {
      var gnum = function (v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; };
      glowLen = Math.max(4, gnum(glow.length, 30));
      for (var gi = 1; gi < coords.length; gi++) {
        var gdx = coords[gi][0] - coords[gi - 1][0];
        var gdy = coords[gi][1] - coords[gi - 1][1];
        glowTotal += Math.sqrt(gdx * gdx + gdy * gdy);
      }
      if (glowTotal > glowLen) {
        glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        glowPath.setAttribute('d', d);
        glowPath.setAttribute('fill', 'none');
        glowPath.setAttribute('stroke', glow.color || '#7fe6ff');
        glowPath.setAttribute('stroke-width', gnum(glow.width, 3.4));
        glowPath.setAttribute('stroke-linejoin', 'round');
        glowPath.setAttribute('stroke-linecap', 'round');
        glowPath.setAttribute('vector-effect', 'non-scaling-stroke');
        glowPath.setAttribute('stroke-dasharray', glowLen + ' ' + (glowTotal + glowLen));
        glowPath.setAttribute('opacity', '0');
        /* the bloom. drop-shadow rather than an SVG filter: one line, no defs to
           thread through six separate svg documents. */
        var halo = gnum(glow.halo, 7);
        if (halo > 0) {
          glowPath.style.filter = 'drop-shadow(0 0 ' + halo +
            'px ' + (glow.color || '#7fe6ff') + ')';
        }
        svg.appendChild(glowPath);
      }
    }

    var last = coords[coords.length - 1];
    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', last[0].toFixed(2));
    dot.setAttribute('cy', last[1].toFixed(2));
    dot.setAttribute('r', cfg.endpointRadius || 2.6);
    dot.setAttribute('fill', up ? this.cfg.colors.up : this.cfg.colors.down);
    svg.appendChild(dot);

    host.appendChild(svg);
    this._sparkLines = this._sparkLines || [];
    this._sparkLines.push(path);
    if (glowPath) this._armSparkGlow(glowPath, glowTotal, glowLen, glow);
  };

  /* One looping timeline per trend line: travel the line, rest, repeat.
     repeatDelay is what makes it "every few seconds" rather than continuous —
     a CSS animation can only express a travel/rest split as fixed percentages. */
  Board.prototype._armSparkGlow = function (path, total, len, g) {
    if (!window.gsap || !window.gsap.timeline) return;
    var gnum = function (v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; };
    var travel = Math.max(0.3, gnum(g.duration, 1.5));
    var rest = Math.max(0, gnum(g.rest, 2.5));
    var op = gnum(g.opacity, 0.95);
    var fade = Math.min(0.28, travel * 0.25);
    /* rows are armed in order, so the count gives each a small offset and they
       do not all flash in unison */
    this._glowTweens = this._glowTweens || [];
    var tl = window.gsap.timeline({
      repeat: -1,
      repeatDelay: rest,
      delay: gnum(g.stagger, 0.45) * this._glowTweens.length
    });
    tl.set(path, { strokeDashoffset: total + len, opacity: 0 })
      .to(path, { opacity: op, duration: fade })
      .to(path, { strokeDashoffset: -len, duration: travel, ease: 'none' }, 0)
      .to(path, { opacity: 0, duration: fade }, travel - fade);
    this._glowTweens.push(tl);
  };

  /* Coins arrive with a logo URL. If the image 404s the cell falls back to the
     ticker initials so a row never shows an empty hole. */
  Board.prototype.drawSparklines = function () {
    var a = this.cfg.animation;
    var lines = this._sparkLines || [];
    if (REDUCE_MOTION || !lines.length || !a.sparklineDraw) return;
    lines.forEach(function (p) {
      var len = 0;
      try { len = p.getTotalLength(); } catch (e) { return; }
      if (!len) return;
      gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len },
        { strokeDashoffset: 0, duration: a.sparklineDraw, ease: 'power2.out', clearProps: 'strokeDasharray,strokeDashoffset' });
    });
  };

  Board.prototype.setLogo = function (node, rec) {
    node.innerHTML = '';
    var initials = rec && rec.symbol ? rec.symbol.slice(0, 3).toUpperCase() : '?';
    var span = el('span', null, node);
    span.textContent = initials;
    if (rec && rec.image) {
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'eager';
      /* Coin marks are frequently not square — a diamond, a wordmark, a shape
         with transparent padding. The initials layer would show through those
         gaps, so it is dropped the moment a real logo paints, and kept if the
         image 404s. */
      img.addEventListener('load', function () { span.style.display = 'none'; });
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      img.src = rec.image;
      node.appendChild(img);
    }
  };

  Board.prototype.updateNote = function () {
    var st = this.state, cfg = this.cfg;
    /* The footer doubles as the board's status line (cached / error / degraded),
       so an operator switching it off is choosing a clean face over the
       diagnostics. Clearing the text is enough: the stylesheet hides an empty
       .board-note, so there is no leftover padding under the last row. */
    if (cfg.footer && cfg.footer.enabled === false) {
      setText(this.note, '');
      return;
    }
    var parts = [];
    if (st.fetchedAt) {
      var mins = Math.max(0, Math.round((Date.now() - st.fetchedAt) / 60000));
      parts.push('Updated ' + (mins === 0 ? 'just now' : mins + 'm ago'));
    }
    if (st.fromCache) parts.push('cached');
    if (st.error) parts.push(st.error);
    parts.push(st.source || 'CoinGecko');
    /* the fallback carries no 7d series, so say the trend column is empty
       rather than letting it look like a rendering fault */
    if (st.degraded) parts.push('no trend data');
    setText(this.note, parts.join('  ·  '));
  };

  /* ---------------------------------------------------------------- data */
  Board.prototype.buildIds = function () {
    var seen = {}, ids = [];
    (this.cfg.categories || []).forEach(function (c) {
      (c.coins || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; ids.push(id); } });
    });
    return ids;
  };

  /* 168 hourly points is far more resolution than a 96px sparkline can show,
     and honest-dataviz asks for ~12-28 points. */
  function downsample(points, target) {
    if (!points || points.length <= target) return points || [];
    var out = [], step = points.length / target;
    for (var i = 0; i < target; i++) out.push(points[Math.floor(i * step)]);
    out.push(points[points.length - 1]);   // always keep the latest price
    return out;
  }

  function normalise(list) {
    var out = {};
    (list || []).forEach(function (c) {
      var spark = c.sparkline_in_7d && c.sparkline_in_7d.price;
      out[c.id] = {
        spark7d: spark ? downsample(spark, 24) : null,
        id: c.id,
        symbol: (c.symbol || '').toUpperCase(),
        name: c.name || c.id,
        image: c.image || '',
        rank: c.market_cap_rank,
        price: c.current_price,
        change24h: c.price_change_percentage_24h_in_currency != null
          ? c.price_change_percentage_24h_in_currency : c.price_change_percentage_24h,
        change7d: c.price_change_percentage_7d_in_currency
      };
    });
    return out;
  }

  function fetchJson(url, ms) {
    var ctrl = null, timer = null;
    var opts = { cache: 'no-store' };
    try {
      ctrl = new AbortController();
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, ms);
    } catch (e) { /* no AbortController: fall back to a plain fetch */ }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      /* our proxy reports whether it answered from cache; the browser can only
         read it because the server sends Access-Control-Expose-Headers */
      var cache = 'MISS', source = '', degraded = false;
      try {
        cache = r.headers.get('x-cache') || 'MISS';
        source = r.headers.get('x-source') || '';
        degraded = r.headers.get('x-degraded') === '1';
      } catch (e) { /* opaque response */ }
      return r.json().then(function (json) {
        return { json: json, cache: cache, source: source, degraded: degraded };
      });
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  /* Proxy first (one upstream call serves every browser source), then the API
     directly, then the last good response. `fromCache` marks stale data so the
     board never pretends old prices are live. */
  Board.prototype.fetchData = function () {
    var self = this, d = this.cfg.data;
    var ids = this.buildIds().join(',');
    var q = 'ids=' + encodeURIComponent(ids) +
            '&currency=' + encodeURIComponent(d.currency) +
            '&changes=24h,7d' +
            (d.sparkline === false ? '' : '&sparkline=1');
    var direct = d.directUrl +
      '?vs_currency=' + encodeURIComponent(d.currency) +
      '&ids=' + encodeURIComponent(ids) +
      '&price_change_percentage=24h,7d&order=market_cap_desc' +
      '&sparkline=' + (d.sparkline === false ? 'false' : 'true');

    function fromCache(note) {
      if (!d.useCacheOnFailure) throw new Error(note);
      var raw = null;
      try { raw = localStorage.getItem(d.cacheKey); } catch (e) { /* private mode */ }
      if (!raw) throw new Error(note);
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.coins) throw new Error(note);
      self.data = parsed.coins;
      self.state.fetchedAt = parsed.ts || 0;
      self.state.fromCache = true;
      self.state.error = note;
      return true;
    }

    /* Identity we have already seen for a coin. The fallback provider publishes
       no logos and its display names are sometimes poor — it calls
       `the-open-network` "TONToken" — so anything we already know from the
       primary is kept rather than letting a degraded source redefine the row. */
    function knownIdentity() {
      var out = {};
      function absorb(coins) {
        Object.keys(coins || {}).forEach(function (id) {
          var c = coins[id];
          if (!c) return;
          var e = out[id] || (out[id] = {});
          if (c.image && !e.image) e.image = c.image;
          if (c.name && !e.name) e.name = c.name;
          if (c.symbol && !e.symbol) e.symbol = c.symbol;
        });
      }
      absorb(self.data);
      try {
        var raw = localStorage.getItem(d.cacheKey);
        var cached = raw ? JSON.parse(raw) : null;
        if (cached && cached.coins) absorb(cached.coins);
      } catch (e) { /* private mode */ }
      return out;
    }

    function ok(list, preferKnown) {
      var next = normalise(list);
      var known = knownIdentity();
      Object.keys(next).forEach(function (id) {
        var k = known[id];
        if (!k) return;
        if (!next[id].image && k.image) next[id].image = k.image;
        /* A degraded provider still returns *a* name, so this is not a case of
           filling a blank — when we already know the coin, the primary's naming
           wins outright. Otherwise CoinPaprika's "TONToken" would relabel a row
           for the length of an outage. */
        if (k.name && (preferKnown || !next[id].name)) next[id].name = k.name;
        if (k.symbol && (preferKnown || !next[id].symbol)) next[id].symbol = k.symbol;
      });
      self.data = next;
      self.state.fetchedAt = Date.now();
      self.state.fromCache = false;
      self.state.error = null;
      try {
        localStorage.setItem(d.cacheKey, JSON.stringify({ ts: self.state.fetchedAt, coins: self.data }));
      } catch (e) { /* quota / private mode */ }
      return true;
    }

    return fetchJson(d.proxyUrl + '?' + q, d.timeoutMs)
      .then(function (r) {
        var payload = r.json;
        var list = Array.isArray(payload) ? payload : (payload && payload.coins);
        if (!list) throw new Error('bad proxy payload');
        ok(list, !!r.degraded);
        /* The proxy serves stale data rather than an empty table, but says so.
           Never let the board pass that off as a live quote. */
        self.state.source = r.source || '';
        self.state.degraded = !!r.degraded;
        if (r.cache === 'STALE') {
          self.state.fromCache = true;
          self.state.error = 'cached (upstream unavailable)';
        }
        return true;
      })
      .catch(function () {
        return fetchJson(direct, d.timeoutMs).then(function (r) { return ok(r.json); });
      })
      .catch(function () {
        return fromCache('offline');
      });
  };

  Board.prototype.refresh = function () {
    var self = this;
    this.stage.dataset.state = 'loading';
    return this.fetchData().then(function () {
      self.state.loaded = true;
      self.stage.dataset.state = self.state.error ? 'stale' : 'ready';
      self.renderRows();
      self.animateRowsIn();
      self.announce();
      return true;
    }).catch(function (e) {
      self.state.loaded = true;
      self.state.error = String((e && e.message) || e);
      self.stage.dataset.state = 'error';
      self.renderRows();
      self.updateNote();
      return false;
    });
  };

  /* ------------------------------------------------------------- a11y text */
  Board.prototype.announce = function () {
    var live = document.getElementById('cm-live');
    if (!live) return;
    var cat = this.activeCategory();
    var bits = this.activeCoins().map(function (id) {
      var r = this.data[id];
      if (!r) return null;
      return r.name + ' ' + formatPrice(r.price, this.cfg.rows) + ', ' +
        formatChange(r.change24h, this.cfg.rows) + ' over 24 hours';
    }, this).filter(Boolean);
    setText(live, (cat.label || cat.id) + ': ' + bits.join('. '));
  };

  /* ------------------------------------------------------------ animation */
  Board.prototype.buildTimeline = function () {
    var a = this.cfg.animation, self = this;
    if (this.tl) this.tl.kill();
    this.tl = gsap.timeline({ paused: true });

    this.tl.from(this.title, {
      y: -(a.headerFrom || 26), opacity: 0,
      duration: a.headerDuration, ease: a.headerEase
    }, 0);

    if (this.tabsEl && this.cfg.tabs.visible) {
      this.tl.from(this.tabsEl, {
        y: -12, opacity: 0, duration: a.tabsDuration, ease: a.headerEase
      }, '>-0.35');
    }
    if (this.colsEl) {
      this.tl.from(this.colsEl, { opacity: 0, duration: 0.4, ease: 'power1.out' }, '>-0.25');
    }
    this.tl.from(this.rowEls.map(function (r) { return r.root; }), {
      y: a.rowFrom || 22,
      opacity: a.fadeRows === false ? 1 : 0,
      duration: a.rowDuration,
      ease: a.rowEase,
      stagger: a.rowStagger
    }, a.rowStart);
    this.tl.add(function () { self.drawSparklines(); }, a.rowStart + 0.1);
    return this.tl;
  };

  Board.prototype.play = function (delay) {
    var self = this;
    if (REDUCE_MOTION) { this.showInstant(); return; }
    if (!this.tl) this.buildTimeline();
    gsap.set(this.panel, { opacity: 1 });
    this.tl.pause(0);
    this.tl.delay(delay || 0);
    this.tl.play();
    this.state.onAir = true;

    /* Safety net: gsap.from() applies its invisible start state immediately, so
       an interrupted entrance (throttled rAF in a hidden OBS source) would leave
       the board blank on air. Force the finished state just after it should end. */
    clearTimeout(this._safety);
    var span = (typeof this.tl.duration === 'function' ? this.tl.duration() : 0) || 3;
    this._safety = setTimeout(function () {
      if (!self.state.onAir || !self.tl) return;
      if (typeof self.tl.progress === 'function' && self.tl.progress() < 1) {
        console.warn('[market] entrance did not finish — snapping to the visible state');
        self.tl.progress(1, true).pause();
      }
      self._entranceDone = true;
      self.settle();
    }, ((delay || 0) + span + 0.6) * 1000);
  };

  Board.prototype.showInstant = function () {
    if (!this.tl) this.buildTimeline();
    clearTimeout(this._safety);
    gsap.set(this.panel, { opacity: 1 });
    this.tl.progress(1, true).pause();
    this.state.onAir = true;
    this._entranceDone = true;
    this.settle();
  };

  /* Strip any inline opacity/transform GSAP left behind. A from() tween renders
     its invisible start state immediately, so an interrupted entrance would
     otherwise leave the board permanently blank on air. */
  Board.prototype.settle = function () {
    var nodes = this.rowEls.map(function (r) { return r.root; });
    var rest = [this.title, this.tabsEl, this.colsEl].filter(Boolean);
    try {
      gsap.set(nodes.concat(rest), { clearProps: 'opacity,transform' });
    } catch (e) { /* older GSAP without clearProps on set */ }
  };

  Board.prototype.hideInstant = function () {
    clearTimeout(this._safety);
    if (this.tl) this.tl.pause(0);
    /* Take the board off air for real. This used to only flip `onAir`, so the
       hide command — and the admin's Hide button — left the board on screen.
       The entrance reveals the panel through GSAP opacity, so hide has to undo
       that rather than merely stop the timeline. */
    if (this.panel) gsap.set(this.panel, { opacity: 0 });
    this.state.onAir = false;
  };

  /* Rows animate in after any re-render (tab switch, refresh). */
  Board.prototype.animateRowsIn = function (opts) {
    var a = this.cfg.animation;
    var nodes = this.rowEls.map(function (r) { return r.root; });
    if (REDUCE_MOTION || !nodes.length) return;
    if (opts && opts.instant) return;
    /* Never animate rows that the entrance timeline has not revealed yet. */
    if (!this._entranceDone) return;
    gsap.from(nodes, {
      y: (opts && opts.from != null) ? opts.from : (a.rowFrom || 22),
      opacity: a.fadeRows === false ? 1 : 0,
      duration: (opts && opts.duration) || a.rowDuration,
      ease: (opts && opts.ease) || a.rowEase,
      stagger: (opts && opts.stagger) || a.rowStagger,
      clearProps: 'transform'
    });
  };

  /* The pill is measured from the live DOM, so it stays correct for any font,
     padding or tab count. */
  /* `instant` skips the tween: used for the first paint, where an indicator
     sliding in from width 0 is noise rather than choreography. */
  Board.prototype.movePill = function (instant) {
    var pill = this.tabPill;
    if (!pill || !this.tabEls.length) return;
    var idx = this.activeIndex % this.tabEls.length;
    var node = this.tabEls[idx];
    if (!node) return;
    var x = node.offsetLeft, w = node.offsetWidth;
    this.tabEls.forEach(function (t, i) {
      var on = i === idx;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var a = this.cfg.animation;
    if (instant || REDUCE_MOTION || !a.tabSwitch) {
      pill.style.transform = 'translateX(' + x + 'px)';
      pill.style.width = w + 'px';
      return;
    }
    gsap.to(pill, {
      x: x, width: w,
      duration: a.pillDuration || 0.25,     // indicator: 250ms, ease-in-out
      ease: a.tabEase || 'power2.inOut'
    });
  };

  /* --------------------------------------------------------- tab switching */
  Board.prototype.setCategory = function (index) {
    var self = this, a = this.cfg.animation;
    var n = this.cfg.categories.length;
    if (!n) return;
    this.activeIndex = ((index % n) + n) % n;
    this.movePill();

    var finish = function () {
      self.renderRows();
      self.animateRowsIn({
        from: 14,
        duration: a.tabSwitchDuration || 0.2,
        stagger: a.tabSwitchStagger || 0.04,
        ease: a.tabInEase || 'power2.out'
      });
      self.drawSparklines();
      clearTimeout(self._rowSafety);
      self._rowSafety = setTimeout(function () {
        if (REDUCE_MOTION) return;
        self.settle();
      }, ((a.tabSwitchDuration || 0.2) + (a.tabSwitchStagger || 0.04) * 12 + 0.5) * 1000);
      self.layout();
      self.announce();
    };

    var old = this.rowEls.map(function (r) { return r.root; });
    if (REDUCE_MOTION || !a.tabSwitch || !old.length) { finish(); return; }

    gsap.to(old, {
      y: -12, opacity: 0,
      duration: a.tabOutDuration || 0.15,   // exits are faster and ease-in
      ease: 'power2.in',
      stagger: { each: 0.012, from: 'end' },
      onComplete: finish
    });
  };

  Board.prototype.next = function () { this.setCategory(this.activeIndex + 1); };
  Board.prototype.prev = function () { this.setCategory(this.activeIndex - 1); };

  /* ================================================================ engine */
  var Engine = {
    cfg: null,
    board: null,
    timer: null,
    /* Set by a hide command and honoured across a config rebuild, so saving an
       edit in the control panel cannot put a hidden board back on air. */
    hidden: false,

    schedule: function () {
      var self = this, d = this.cfg.data;
      clearInterval(this.timer);
      var secs = Math.max(15, d.refreshSeconds || 120);
      this.timer = setInterval(function () {
        if (self.board) self.board.refresh();
      }, secs * 1000);
    },

    refresh: function () {
      return this.board ? this.board.refresh() : Promise.resolve(false);
    },

    play: function () {
      this.hidden = false;
      if (this.board) this.board.play(this.cfg.animation.autoPlayDelay || 0);
    },
    hide: function () {
      this.hidden = true;
      if (this.board) this.board.hideInstant();
    },
    setCategory: function (i) { if (this.board) this.board.setCategory(i); },
    next: function () { if (this.board) this.board.next(); },
    prev: function () { if (this.board) this.board.prev(); },
    applyConfig: function (cfg) {
      this.cfg = cfg;
      var wasOnAir = !!(this.board && this.board.state.onAir);
      /* Carry the current data and freshness into the rebuild. A new board starts
         empty, so every row would render '—' until the fetch lands — the other
         half of the flash. Seeding before mount() means the rows paint the last
         known prices immediately and the refresh then updates them in place, so
         even a genuine config change cannot blank the board on air. */
      var prev = this.board || null;
      fitStage(cfg);
      var next = new Board(cfg, document.getElementById('stage'));
      if (prev) {
        next.data = prev.data;
        next.state = Object.assign({}, next.state, {
          loaded: prev.state.loaded,
          fetchedAt: prev.state.fetchedAt,
          source: prev.state.source,
          fromCache: prev.state.fromCache,
          error: prev.state.error,
          degraded: prev.state.degraded
        });
      }
      this.board = next.mount();
      /* mount() has already honoured cfg.__startIndex for both the first render
         and the tab marker — see Board.prototype.mount. */
      this.board.refresh().then(function () {
        if (wasOnAir) this.board.showInstant();
        else if (this.hidden) this.board.hideInstant();
        else if (cfg.animation.autoPlay) this.board.play(cfg.animation.autoPlayDelay || 0);
        else this.board.showInstant();
      }.bind(this));
      this.schedule();
      return this.board;
    }
  };

  /* Commands reach the board the same way they reach the other two overlays:
     /api/command bumps a sequence number in state.json and the board polls
     /api/state. The admin panel's buttons take the postMessage path instead, and
     both land here so the two can never drift apart. */
  function handleCommand(cmd) {
    if (!cmd) return;
    switch (cmd.action) {
      case 'in': case 'play': Engine.play(); break;
      case 'out': case 'hide': Engine.hide(); break;
      case 'refresh': case 'update': Engine.refresh(); break;
      case 'next': case 'advance': Engine.next(); break;
      case 'prev': case 'back': Engine.prev(); break;
      case 'category':
        if (cmd.index != null && cmd.index >= 0) Engine.setCategory(cmd.index);
        break;
    }
  }

  /* ------------------------------------------------------------------ boot */

  /* The board keeps the config in two places: localStorage (written the instant
     the operator touches a control) and config.json on the server (written when
     the panel's POST lands). Without a way to order them, the poll below rebuilt
     from SHIPPED + config.json and silently dropped a local edit whose POST had
     not arrived — so settings reverted a couple of seconds after load. Each save
     now carries meta.savedAt and the newer copy is applied last. */
  function savedAt(c) {
    return (c && c.meta && Number(c.meta.savedAt)) || 0;
  }
  function localCopy() {
    try {
      var raw = localStorage.getItem('cm-config-v1');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  /* server copy and local copy, older first so the newer one wins; the ?config=
     patch is a deliberate override and always goes on top */
  function resolveConfig(remote, urlPatch) {
    var a = remote || null, b = localCopy();
    if (savedAt(a) > savedAt(b)) { var t = a; a = b; b = t; }
    var out = deepMerge(SHIPPED, {});
    if (a) out = mergeIncoming(out, a);
    if (b) out = mergeIncoming(out, b);
    if (urlPatch) out = mergeIncoming(out, urlPatch);
    return out;
  }

  function boot() {
    var qs = new URLSearchParams(location.search);
    var urlPatch = null;
    if (qs.get('config')) {
      try { urlPatch = JSON.parse(atob(qs.get('config'))); } catch (e) { urlPatch = null; }
    }
    var cfg = resolveConfig(null, urlPatch);
    if (qs.get('category')) {
      var want = qs.get('category');
      var idx = (cfg.categories || []).findIndex(function (c) { return c.id === want; });
      if (idx > -1) cfg.__startIndex = idx;
    }
    if (qs.get('refresh')) cfg.data.refreshSeconds = parseInt(qs.get('refresh'), 10) || cfg.data.refreshSeconds;
    if (qs.get('fit')) cfg.stage.fit = qs.get('fit');

    /* Skip re-applying an unchanged config: the poll fires every couple of
       seconds, and a rebuild is a full teardown — it blanks every price for a
       data round trip and would replay the entrance over and over. The signature
       ignores `meta`, so the version migration's `migratedFrom` stamp no longer
       counts as a change: that alone used to make the board flash ~2s after load
       even though nothing visible had changed. */
    var lastSig = '';
    function apply(c) {
      if (window.CM_applyFont) window.CM_applyFont(c);
      var sig = boardSignature(c);
      if (sig === lastSig) return;
      lastSig = sig;
      Engine.applyConfig(c);
    }

    apply(cfg);

    /* live sync: server config.json, then a postMessage from the admin.
       ?nosync=1 turns both off, which is what a screenshot or a test wants. */
    var noSync = qs.get('nosync') === '1';
    var sync = cfg.sync || {};

    if (!noSync) setInterval(function () {
      var url = (Engine.cfg && Engine.cfg.sync && Engine.cfg.sync.serverConfigUrl) || 'config.json';
      fetch(url + '?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (remote) {
          if (!remote || !Object.keys(remote).length) return;
          apply(resolveConfig(remote, urlPatch));
        })
        .catch(function () { /* no server, fine */ });
    }, (sync.pollMs || 2000));

    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      /* same resolver as boot and the poll, so all three agree on precedence */
      if (d.type === 'cm:config' && d.config) apply(resolveConfig(d.config, urlPatch));
      else if (d.type === 'cm:command') handleCommand(d);
    });

    /* An edit in the admin panel lands in localStorage first, and the storage
       event fires in every OTHER tab of this origin — which is precisely the
       overlay's situation. Without this the change waited up to two seconds for
       the config poll, and if that POST had not landed it never arrived at all. */
    window.addEventListener('storage', function (ev) {
      if (ev.key !== null && ev.key !== 'cm-config-v1') return;
      apply(resolveConfig(null, urlPatch));
    });

    /* Commands from the server (Stream Deck / Companion / curl). Weather and
       topics have always polled this; the board did not, so every command URL
       the hub printed for it was inert. */
    var stateUrl = sync.stateUrl || 'api/state';
    var lastSeq = -1;

    function pollState() {
      fetch(stateUrl + '?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (st) {
          if (!st || st.seq == null || st.seq === lastSeq) return;
          lastSeq = st.seq;
          handleCommand(st);
        })
        .catch(function () { /* no server, fine */ });
    }

    if (!noSync) {
      setInterval(pollState, sync.statePollMs || 700);
      setTimeout(pollState, 400);
    }

    window.addEventListener('resize', function () { fitStage(Engine.cfg); if (Engine.board) Engine.board.layout(); });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        fitStage(Engine.cfg);
        if (Engine.board) Engine.board.layout();
      }).observe(document.documentElement);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') Engine.next();
      else if (e.key === 'ArrowLeft') Engine.prev();
      else if (e.key === ' ') { e.preventDefault(); Engine.play(); }
    });
  }

  window.CM = window.CM || {};
  window.CM.engine = Engine;
  window.CM.Board = Board;
  window.CM.play = function () { Engine.play(); };
  window.CM.hide = function () { Engine.hide(); };
  window.CM.refresh = function () { return Engine.refresh(); };
  window.CM.next = function () { Engine.next(); };
  window.CM.prev = function () { Engine.prev(); };
  window.CM.setCategory = function (i) { Engine.setCategory(i); };
  window.CM.getConfig = function () { return Engine.cfg; };
  window.CM.getData = function () { return Engine.board ? Engine.board.data : {}; };
  window.CM.formatPrice = formatPrice;
  window.CM.formatChange = formatChange;
  window.CM.configSignature = boardSignature;   /* what counts as a visible change */
  window.CM.mergeIncoming = mergeIncoming;      /* exposed so the version-gate can be tested */

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
