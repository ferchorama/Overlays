/* ============================================================================
   Vertical Weather Overlay — engine
   ----------------------------------------------------------------------------
   • builds the panel from config
   • pulls live weather from Open-Meteo (free, no key) with geocoding + caching
   • GSAP entrance animation (entrance only — OBS hides the source to take it off)
   • ambient icon motion, animated value changes on every refresh
   • live config sync (admin panel / config.json) + HTTP command API
   ========================================================================== */
(function () {
  'use strict';

  /* GSAP safety net (works even if the CDN/local copy is missing) */
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
          if (typeof v.y === 'number') t.style.transform = 'translateY(' + v.y + 'px)';
        }
      },
      to: function (t, v) {
        if (t && v && typeof v.val === 'number' && v.onUpdate) { v.onUpdate(); }
        else if (t && t.style && v && v.opacity != null) t.style.opacity = v.opacity;
      }
    };
  }

  var LS_KEY = 'wx-config-v1';
  var SHIPPED = window.WX_DEFAULT_CONFIG || {};

  /* Anything coming from storage (localStorage, config.json, postMessage) may
     have been written by an older build. If its version differs, keep the
     operator's content and take the shipped look — otherwise a stale saved
     palette silently overrides every theme fix. */
  function mergeIncoming(base, patch) {
    var M = window.WX_MIGRATE;
    if (M && patch && patch.meta && patch.meta.version && M.versionOf(patch) !== M.versionOf(SHIPPED)) {
      return M.apply(SHIPPED, patch);
    }
    return deepMerge(base, patch);
  }

  /* ------------------------------------------------------------ utilities */
  /* Motion preference is honoured in JS as well as CSS: with reduced motion the
     panel appears instantly and the ambient icon loop is switched off. */
  var REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
    if (families.length) {
      injectStyle('wx-google-fonts',
        '@import url("https://fonts.googleapis.com/css2?' +
        families.map(function (f) { return 'family=' + f; }).join('&') + '&display=swap");');
    }
    var urls = [];
    if (cfg.card && cfg.card.body && cfg.card.body.temp && cfg.card.body.temp.fontUrl) urls.push(cfg.card.body.temp.fontUrl);
    (cfg.fontUrls || []).forEach(function (u) { urls.push(u); });
    injectStyle('wx-custom-fonts', urls.filter(Boolean).map(function (u) { return '@import url("' + u + '");'; }).join('\n'));
  }

  function num(v, digits) {
    if (v == null || isNaN(v)) return null;
    var n = Number(v);
    return digits ? n.toFixed(digits) : Math.round(n);
  }

  function compass(deg) {
    if (deg == null || isNaN(deg)) return '';
    var dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(((deg % 360) / 22.5)) % 16];
  }

  function clockFromIso(iso, use24) {
    if (!iso) return '';
    var m = String(iso).match(/T(\d{2}):(\d{2})/);
    if (!m) return '';
    var h = parseInt(m[1], 10), mi = m[2];
    if (use24) return h + ':' + mi;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + mi + ' ' + ap;
  }

  function nowClock(use24) {
    var d = new Date();
    var h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    if (use24) return h + ':' + m;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m + ' ' + ap;
  }

  function unitsFrom(cfg) {
    var sys = (cfg.units && cfg.units.system) || 'imperial';
    var imperial = sys !== 'metric';
    return {
      imperial: imperial,
      temperature: (cfg.units && cfg.units.temperature) || (imperial ? 'fahrenheit' : 'celsius'),
      wind: (cfg.units && cfg.units.wind) || (imperial ? 'mph' : 'kmh'),
      precip: imperial ? 'inch' : 'mm',
      tempLabel: imperial ? 'F' : 'C',
      windLabel: { kmh: 'KM/H', mph: 'MPH', ms: 'M/S', kn: 'KN' }[(cfg.units && cfg.units.wind) || (imperial ? 'mph' : 'kmh')] || 'MPH',
      precipLabel: imperial ? 'IN' : 'MM'
    };
  }

  /* --------------------------------------------------------------- network */
  /* One in-flight request group: starting a new refresh aborts the previous
     one so a stale forecast can never overwrite a newer one. */
  var REQ = { ctrl: null };

  function newRequestGroup() {
    if (REQ.ctrl) { try { REQ.ctrl.abort(); } catch (e) { /* ignore */ } }
    REQ.ctrl = ('AbortController' in window) ? new AbortController() : null;
    return REQ.ctrl;
  }

  function fetchJSON(url, ms) {
    return new Promise(function (resolve, reject) {
      var timeoutCtl = ('AbortController' in window) ? new AbortController() : null;
      var timer = setTimeout(function () { if (timeoutCtl) timeoutCtl.abort(); }, ms || 9000);
      var groupSignal = REQ.ctrl ? REQ.ctrl.signal : null;
      var signal = timeoutCtl ? timeoutCtl.signal : groupSignal;

      var onGroupAbort = function () { if (timeoutCtl) timeoutCtl.abort(); };
      if (groupSignal && groupSignal.addEventListener) groupSignal.addEventListener('abort', onGroupAbort);

      fetch(url, { cache: 'no-store', signal: signal })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) { clearTimeout(timer); resolve(j); })
        .catch(function (e) {
          clearTimeout(timer);
          if (e && e.name === 'AbortError') {
            var aborted = new Error('aborted');
            aborted.aborted = true;
            reject(aborted);
          } else {
            console.warn('[weather] request failed:', url.replace(/&?latitude=.*/, ''), e && e.message);
            reject(e);
          }
        });
    });
  }

  /* The hub owns the provider call now. It fetches every city in one Open-Meteo
     request (multi-location coordinates) and caches the answer, so a reload or a
     scene switch inside the cache window costs no provider request at all, and
     the dashboard's Update button can force exactly one. */
  var DATA_URL = 'api/data';

  function cityKey(c) {
    return (c.lat != null && c.lon != null)
      ? ('ll:' + Number(c.lat).toFixed(4) + ',' + Number(c.lon).toFixed(4))
      : ('q:' + String(c.query || c.label || '').trim().toLowerCase() + '|' + (c.countryCode || ''));
  }

  /* Identity of "what we are fetching" — used to re-fetch only when the city
     list, its coordinates or the units actually change. */
  function citySignature(cfg) {
    return (cfg.cities || []).filter(function (c) { return c.enabled !== false; })
      .map(cityKey).join('~') + '|' + (cfg.units && cfg.units.system) + '|' + (cfg.units && cfg.units.wind);
  }

  function unitsQuery(cfg) {
    var u = unitsFrom(cfg);
    return { temperature: u.temperature, wind: u.wind, precipitation: u.precip };
  }

  /* One hub city → the small view model the renderer uses. Kept identical to
     what the old direct fetch produced, so the panel, the tests and the cache
     format need no changes. */
  function toState(entry) {
    var j = entry && entry.forecast;
    if (!j || !j.current || typeof j.current.temperature_2m !== 'number') return null;
    return {
      key: entry.key || '',
      label: entry.label || '',
      timezone: j.timezone || entry.timezone || '',
      observedAt: j.current.time,
      temp: j.current.temperature_2m,
      feels: j.current.apparent_temperature == null ? null : j.current.apparent_temperature,
      humidity: j.current.relative_humidity_2m == null ? null : j.current.relative_humidity_2m,
      wind: j.current.wind_speed_10m == null ? null : j.current.wind_speed_10m,
      windDir: j.current.wind_direction_10m == null ? null : j.current.wind_direction_10m,
      code: j.current.weather_code == null ? 0 : j.current.weather_code,
      isDay: j.current.is_day !== 0,
      precip: j.current.precipitation == null ? 0 : j.current.precipitation,
      clouds: j.current.cloud_cover == null ? null : j.current.cloud_cover,
      pressure: j.current.surface_pressure == null ? null : j.current.surface_pressure,
      high: (j.daily && j.daily.temperature_2m_max) ? j.daily.temperature_2m_max[0] : null,
      low: (j.daily && j.daily.temperature_2m_min) ? j.daily.temperature_2m_min[0] : null,
      fetchedAt: Date.now(),
      error: null
    };
  }

  function enabledCities(cfg) {
    return (cfg.cities || []).filter(function (c) {
      return c.enabled !== false && (c.query || (c.lat != null && c.lon != null));
    }).slice(0, cfg.maxCities || 2);
  }
  /* ----------------------------------------------------------------- cache */
  function readCache(cfg) {
    try {
      var raw = localStorage.getItem((cfg.data && cfg.data.cacheKey) || 'wx-cache-v1');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeCache(cfg, cities) {
    try {
      localStorage.setItem((cfg.data && cfg.data.cacheKey) || 'wx-cache-v1',
        JSON.stringify({ ts: Date.now(), cities: cities }));
    } catch (e) { /* ignore */ }
  }

  /* ----------------------------------------------------------------- panel */
  function Panel(config) {
    this.cfg = config;
    this.stage = document.getElementById('stage');
    this.state = { onAir: false, built: false, cities: [] };
    this.tl = null;
  }

  /* stat labels live in one place so the loading placeholder and the real
     values can never drift apart */
  var FIELD_LABELS = {
    wind: 'Wind', humidity: 'Humidity', feels: 'Feels like',
    precip: 'Precip', pressure: 'Pressure', clouds: 'Cloud'
  };

  /* config key → the custom property icons.js reads for that shape */
  var ICON_VARS = {
    sun: '--wx-sun', moon: '--wx-moon', cloud: '--wx-cloud', cloudDark: '--wx-cloud-dark',
    rain: '--wx-rain', snow: '--wx-snow', bolt: '--wx-bolt', fog: '--wx-fog'
  };

  /* (Re)build the glass stat cells from [{ label, value }].
     The strip is ONE row up to three fields and TWO rows beyond that: six 36px
     values cannot share a 460px card, and forcing them into one row is exactly
     what made them paint over each other. Two rows give a cell ~150px, and the
     type is scaled so both rows still fit the fixed strip height. */
  Panel.prototype.renderStatCells = function (detailsEl, cells) {
    detailsEl.innerHTML = '';
    var n = cells.length;
    var rows = n > 3 ? 2 : 1;
    var cols = rows === 2 ? Math.ceil(n / 2) : Math.max(1, n);
    var d = (this.cfg.card && this.cfg.card.details) || {};
    detailsEl.style.setProperty('--stat-cols', cols);
    detailsEl.style.setProperty('--stat-value-size',
      Math.round((d.valueSize || 34) * (rows === 2 ? 0.84 : 1)) + 'px');
    detailsEl.style.setProperty('--stat-label-size',
      Math.round((d.labelSize || 13) * (rows === 2 ? 0.8 : 1)) + 'px');
    cells.forEach(function (cell, i) {
      var c = el('div', 'stat', detailsEl);
      /* the hairline belongs BETWEEN columns, so the first cell of each row opts
         out instead of drawing a rule against the card's edge */
      if (i % cols === 0) c.classList.add('is-col-first');
      var v = el('div', 'stat__value', c);
      v.textContent = cell.value;
      v.dataset.testid = 'stat-value';
      var l = el('div', 'stat__label', c);
      l.textContent = cell.label;
      l.dataset.testid = 'stat-label';
    });
  };

  Panel.prototype.mount = function () {
    var self = this, cfg = this.cfg;
    document.body.classList.toggle('debug', !!cfg.debug);

    this.stage.style.setProperty('--stage-w', cfg.stage.width + 'px');
    this.stage.style.setProperty('--stage-h', cfg.stage.height + 'px');
    this.stage.style.setProperty('--stage-bg', cfg.stage.background);
    this.stage.innerHTML = '';

    var p = cfg.panel;
    var g = p.glass || {};
    var panel = el('div', 'panel', this.stage);
    this.panel = panel;
    panel.classList.toggle('no-ambient', !cfg.animation.ambient);
    panel.style.setProperty('--panel-x', p.x + 'px');
    panel.style.setProperty('--panel-w', p.width + 'px');
    panel.style.setProperty('--panel-radius', (p.radius || 0) + 'px');
    panel.style.setProperty('--panel-bg', p.background);
    panel.style.setProperty('--panel-border-w', (p.borderWidth || 0) + 'px');
    panel.style.setProperty('--panel-border-c', p.borderColor);
    panel.style.setProperty('--panel-shadow', p.shadow || 'none');
    panel.style.setProperty('--panel-opacity', p.opacity == null ? 1 : p.opacity);

    /* glass surface tokens */
    panel.style.setProperty('--glass-tint', (p.background && p.background !== 'transparent') ? p.background : 'rgba(255,255,255,0.70)');
    panel.style.setProperty('--glass-blur', (g.blur == null ? 36 : g.blur) + 'px');
    panel.style.setProperty('--glass-sat', (g.saturate == null ? 170 : g.saturate) + '%');
    panel.style.setProperty('--glass-border-w', (g.borderWidth == null ? 1 : g.borderWidth) + 'px');
    panel.style.setProperty('--glass-border', g.borderColor || 'rgba(255,255,255,0.78)');
    panel.style.setProperty('--glass-sheen', g.sheen || 'linear-gradient(148deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.16) 24%, rgba(255,255,255,0) 46%)');
    panel.style.setProperty('--glass-shadow', g.shadow || p.shadow || '0 26px 60px rgba(20,40,80,0.28)');
    panel.style.setProperty('--glass-inner', g.innerHighlight || 'inset 0 1px 0 rgba(255,255,255,0.90)');
    panel.style.setProperty('--accent-c', p.accentColor || '#007aff');
    /* theme-aware hairlines + frosted orb (light and dark presets differ) */
    panel.style.setProperty('--hairline', g.hairline || 'rgba(10,26,48,0.14)');
    panel.style.setProperty('--orb-fill', g.orbFill || 'radial-gradient(circle at 34% 28%, rgba(255,255,255,0.90), rgba(255,255,255,0.42) 46%, rgba(255,255,255,0.06) 72%)');
    panel.style.setProperty('--orb-border', g.orbBorder || 'rgba(255,255,255,0.90)');
    panel.style.setProperty('--icon-shadow', cfg.card.body.iconShadow || '0 10px 26px rgba(20,40,80,0.30)');

    /* Animated-SVG colours. icons.js reads these as var(--wx-*) with its own
       fallbacks, so a missing key still draws — but until these were set, the
       six colour pickers in the control panel wrote config that nothing read and
       every icon silently used the built-in amber/blue. */
    var ic = cfg.iconColors || {};
    Object.keys(ICON_VARS).forEach(function (k) {
      if (ic[k]) panel.style.setProperty(ICON_VARS[k], ic[k]);
    });

    /* card surfaces + divider */
    panel.style.setProperty('--card-bg-day', gradient(cfg.surfaces.day, 180));
    panel.style.setProperty('--card-bg-night', gradient(cfg.surfaces.night, 180));
    panel.style.setProperty('--divider-c', (cfg.card.divider && cfg.card.divider.color) || 'rgba(10,26,48,0.14)');
    panel.style.setProperty('--divider-w', ((cfg.card.divider && cfg.card.divider.width) || 1) + 'px');
    panel.style.setProperty('--gloss-gradient',
      'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.18) 26.7%, rgba(0,0,0,0.22) 74.2%, rgba(0,0,0,0.22) 100%)');

    /* header */
    var h = cfg.header;
    var header = el('header', 'band band--header', panel);
    el('div', 'band__gloss', header).style.display = h.gloss ? 'block' : 'none';
    var headerText = el('div', 'band__text', header);
    headerText.textContent = h.uppercase ? String(h.text || '').toUpperCase() : String(h.text || '');
    header.classList.toggle('hidden', !h.visible);
    header.style.setProperty('--header-h', h.height + 'px');
    header.style.setProperty('--header-bg', gradient(h.gradient, 180));
    header.style.setProperty('--header-font', h.fontFamily);
    header.style.setProperty('--header-weight', h.weight);
    header.style.setProperty('--header-size', h.size + 'px');
    header.style.setProperty('--header-color', h.color);
    header.style.setProperty('--header-tracking', (h.letterSpacing || 0) + 'px');
    header.style.setProperty('--header-align', h.align || 'center');
    header.style.setProperty('--header-shadow', h.shadow || 'none');
    this.header = header;
    this.headerText = headerText;

    /* cards */
    var cards = el('div', 'cards', panel);
    this.cardsEl = cards;
    cards.style.setProperty('--cards-gap', (cfg.card.gap || 0) + 'px');
    this.cardEls = [];

    var items = (cfg.cities || []).filter(function (c) { return c.enabled !== false && (c.query || (c.lat != null && c.lon != null)); })
      .slice(0, cfg.maxCities || 2);

    var cb = cfg.card.cityBand, cbody = cfg.card.body, cdet = cfg.card.details;
    var footerH = cfg.footer.visible ? cfg.footer.height : 0;
    var headerH = cfg.header.visible ? cfg.header.height : 0;

    /* Full-height (1080p) widget: the panel fills the stage and the cards
       divide whatever is left after the header, footer and dividers. */
    var fill = (p.heightMode === 'fill');
    var panelH = fill
      ? Math.max(200, cfg.stage.height - (p.y || 0) * 2)
      : (2 * (p.borderWidth || 0) + headerH +
         items.length * (cb.height + (cbody.height || 220) + cdet.height) +
         (cfg.card.gap || 0) * Math.max(0, items.length - 1) + footerH);

    var bodyH = cbody.height;
    if (fill && items.length) {
      var inner = panelH - headerH - footerH - (cfg.card.gap || 0) * Math.max(0, items.length - 1);
      var perCard = Math.floor(inner / items.length);
      bodyH = Math.max(120, perCard - cb.height - cdet.height);
    } else if (p.autoFitHeight && items.length) {
      var avail = cfg.stage.height - (p.verticalAnchor === 'top' ? p.y : 0) - 2 * (p.borderWidth || 0) - 24 -
        headerH - footerH - (cfg.card.gap || 0) * Math.max(0, items.length - 1);
      var maxBody = Math.floor(avail / items.length) - cb.height - cdet.height;
      bodyH = Math.max(120, Math.min(cbody.height || 220, maxBody));
    }

    items.forEach(function (city, i) {
      var card = el('div', 'card', cards);
      card.dataset.city = String(i);
      card.classList.toggle('card--glow', !!cbody.iconGlow);
      card.classList.toggle('card--orb', !!cbody.orb);
      card.classList.toggle('no-labels', cdet.showLabels === false);

      /* city strip */
      var cityBand = el('div', 'card__city', card);
      cityBand.classList.toggle('card__city--rule', cb.accentRule !== false);
      var cityName = el('div', 'card__city-name', cityBand);
      cityName.textContent = cb.uppercase ? String(city.label || '').toUpperCase() : String(city.label || '');
      var cityTime = el('div', 'card__city-time', cityBand);
      cityTime.style.display = cb.showLocalTime ? 'block' : 'none';
      cityBand.style.setProperty('--city-h', cb.height + 'px');
      cityBand.style.setProperty('--city-bg', gradient(cb.gradient, 180));
      cityBand.style.setProperty('--city-font', cb.fontFamily);
      cityBand.style.setProperty('--city-weight', cb.weight);
      cityBand.style.setProperty('--city-size', cb.size + 'px');
      cityBand.style.setProperty('--city-color', cb.color);
      cityBand.style.setProperty('--city-tracking', (cb.letterSpacing || 0) + 'px');
      cityBand.style.setProperty('--city-transform', cb.uppercase ? 'uppercase' : 'none');
      cityBand.style.setProperty('--city-pad-x', (cb.paddingX == null ? 26 : cb.paddingX) + 'px');
      cityBand.style.setProperty('--city-time-size', (cb.timeSize || 17) + 'px');
      cityBand.style.setProperty('--city-time-color', cb.timeColor);

      /* body */
      var body = el('div', 'card__body', card);
      body.style.setProperty('--body-h', bodyH + 'px');
      body.style.setProperty('--body-bg', gradient(cbody.gradient, 180));
      body.style.setProperty('--icon-size', 'calc(' + (cbody.iconSize || 250) + 'px * var(--icon-scale, 1))');
      body.style.setProperty('--icon-x', (cbody.iconX || 0) + 'px');
      if (cbody.gloss) el('div', 'card__body-gloss', body);

      var icon = el('div', 'card__icon', body);
      var readout = el('div', 'card__readout', body);
      var temp = el('div', 'card__temp', readout);
      var cond = el('div', 'card__cond', readout);
      var range = el('div', 'card__range', readout);
      range.style.display = cbody.range.show ? 'block' : 'none';

      /* stable hooks so tests never bind to styling classes */
      card.dataset.testid = 'city-card';
      cityName.dataset.testid = 'city-name';
      icon.dataset.testid = 'icon';
      temp.dataset.testid = 'temp';
      cond.dataset.testid = 'condition';
      range.dataset.testid = 'range';

      body.style.setProperty('--temp-font', cbody.temp.fontFamily);
      body.style.setProperty('--temp-weight', cbody.temp.weight);
      body.style.setProperty('--temp-size', 'calc(' + cbody.temp.size + 'px * var(--text-scale, 1))');
      body.style.setProperty('--temp-color', cbody.temp.color);
      body.style.setProperty('--temp-shadow', cbody.temp.shadow || 'none');
      body.style.setProperty('--temp-tracking', (cbody.temp.letterSpacing || 0) + 'px');
      body.style.setProperty('--temp-lh', cbody.temp.lineHeight || 1);
      body.style.setProperty('--temp-align', cbody.temp.align || 'center');
      body.style.setProperty('--temp-align-items', cbody.temp.align === 'left' ? 'flex-start' : (cbody.temp.align === 'center' ? 'center' : 'flex-end'));
      body.style.setProperty('--cond-font', cbody.condition.fontFamily);
      body.style.setProperty('--cond-weight', cbody.condition.weight);
      body.style.setProperty('--cond-size', 'calc(' + cbody.condition.size + 'px * var(--text-scale, 1))');
      body.style.setProperty('--cond-color', cbody.condition.color);
      body.style.setProperty('--cond-tracking', (cbody.condition.letterSpacing || 0) + 'px');
      body.style.setProperty('--cond-transform', cbody.condition.uppercase ? 'uppercase' : 'none');
      body.style.setProperty('--range-font', cbody.range.fontFamily);
      body.style.setProperty('--range-weight', cbody.range.weight);
      body.style.setProperty('--range-size', 'calc(' + cbody.range.size + 'px * var(--text-scale, 1))');
      body.style.setProperty('--range-color', cbody.range.color);

      /* glass stat row */
      var details = el('div', 'card__details', card);
      details.dataset.testid = 'details';
      details.style.setProperty('--details-h', cdet.height + 'px');
      details.style.setProperty('--details-bg', gradient(cdet.gradient, 180));
      details.style.setProperty('--details-font', cdet.fontFamily);
      details.style.setProperty('--info-size', cdet.size + 'px');
      details.style.setProperty('--stat-font', cdet.fontFamily);
      details.style.setProperty('--stat-value-size', (cdet.valueSize || 34) + 'px');
      details.style.setProperty('--stat-value-color', cdet.valueColor || '#fff');
      details.style.setProperty('--stat-label-size', (cdet.labelSize || 13) + 'px');
      details.style.setProperty('--stat-label-color', cdet.labelColor || 'rgba(255,255,255,.58)');
      details.style.setProperty('--stat-label-tracking', (cdet.letterSpacing || 0) + 'px');
      details.style.setProperty('--stat-transform', cdet.uppercase ? 'uppercase' : 'none');

      var errBar = el('div', 'card__error', card);
      errBar.style.display = 'none';

      /* Loading state: reserve the layout and show the stat labels before the
         first fetch lands, so the panel is never an empty slab on screen. */
      temp.textContent = '—';
      cond.textContent = '';
      self.renderStatCells(details, (cdet.fields || []).map(function (f) {
        return { label: FIELD_LABELS[f] || f, value: '—' };
      }));

      self.cardEls.push({
        root: card, bodyEl: body, icon: icon, readout: readout, name: cityName, time: cityTime,
        temp: temp, cond: cond, range: range, details: details, errBar: errBar,
        city: city, index: i, shown: { temp: null, cond: null, range: null, details: null, statsSig: '—' }
      });
    });

    /* footer */
    var f = cfg.footer;
    var footer = el('footer', 'band band--footer', panel);
    var footerText = el('div', 'band__text', footer);
    footerText.dataset.testid = 'updated';
    footer.classList.toggle('hidden', !f.visible);
    footer.style.setProperty('--footer-h', f.height + 'px');
    footer.style.setProperty('--footer-bg', gradient(f.gradient, 180));
    footer.style.setProperty('--footer-font', f.fontFamily);
    footer.style.setProperty('--footer-weight', f.weight);
    footer.style.setProperty('--footer-size', f.size + 'px');
    footer.style.setProperty('--footer-color', f.color);
    footer.style.setProperty('--footer-tracking', (f.letterSpacing || 0) + 'px');
    footer.style.setProperty('--footer-align', f.align || 'right');
    footer.style.setProperty('--footer-pad-x', (f.paddingX == null ? 12 : f.paddingX) + 'px');
    this.footer = footer;
    this.footerText = footerText;

    el('div', 'panel__outline', panel);

    /* geometry */
    var totalH = panelH;
    var top = p.y;
    if (p.verticalAnchor === 'middle') top = Math.round((cfg.stage.height - totalH) / 2) + p.y;
    else if (p.verticalAnchor === 'bottom') top = cfg.stage.height - totalH - p.y;
    panel.style.setProperty('--panel-y', Math.max(0, top) + 'px');
    panel.style.setProperty('--panel-h', totalH + 'px');

    /* autoshrink the header text to its band */
    var fit = function () {
      var maxW = header.clientWidth - 20;
      if (headerText.scrollWidth > maxW) {
        var size = h.size;
        while (size > 10 && headerText.scrollWidth > maxW) {
          size -= 1;
          headerText.style.fontSize = size + 'px';
        }
      }
    };
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fit(); self.fitHero(); }).catch(function () {});

    this.fitHero();
    this.state.built = true;
    return this;
  };

  /* Fill the panel with data (called on every refresh) */
  Panel.prototype.applyData = function (states, opts) {
    var self = this, cfg = this.cfg;
    opts = opts || {};
    var u = unitsFrom(cfg);
    var pulse = !opts.silent;

    states.forEach(function (st, i) {
      var c = self.cardEls[i];
      if (!c) return;

      if (!st || st.error) {
        c.root.classList.add('is-error');
        c.errBar.style.display = 'block';
        /* Keep the last good reading on screen; only when there is nothing at
           all do we show an honest placeholder plus what happens next. */
        if (!c.shown.temp) {
          self.setText(c.temp, '– –');
          self.setText(c.cond, 'DATA UNAVAILABLE');
          self.setText(c.range, '');
          if (c.shown.statsSig !== 'error') {
            c.shown.statsSig = 'error';
            self.renderStatCells(c.details, [{ label: 'PRESS R TO RETRY', value: '—' }]);
          }
        }
        return;
      }

      c.root.classList.remove('is-error');
      c.errBar.style.display = 'none';
      c.root.classList.toggle('is-stale', st.fetchedAt && (Date.now() - st.fetchedAt) > (cfg.data.showStaleAfterMinutes || 30) * 60000);

      /* city name / local clock */
      var label = st.label || c.city.label || '';
      if (cfg.card.cityBand.showCountry && st.country) label += ' · ' + st.country;
      self.setText(c.name, cfg.card.cityBand.uppercase ? label.toUpperCase() : label);
      c.time.style.display = cfg.card.cityBand.showLocalTime ? 'block' : 'none';
      self.setText(c.time, clockFromIso(st.observedAt, cfg.units.clock24));

      /* temperature (tweened) */
      var target = num(st.temp);
      var suffix = cfg.card.body.temp.showUnit ? (cfg.card.body.temp.unit || '°') : '';
      if (cfg.animation.tweenValues && c.shown.temp != null && target != null) {
        var proxy = { v: c.shown.temp };
        gsap.to(proxy, {
          v: target, duration: cfg.animation.tweenDuration, ease: 'power2.inOut',
          onUpdate: function () { c.temp.textContent = Math.round(proxy.v) + suffix; }
        });
      } else {
        self.setText(c.temp, target == null ? '—' : target + suffix);
      }
      c.shown.temp = target;

      /* condition + icon */
      var desc = window.WX.describeCode(st.code);
      self.setText(c.cond, cfg.card.body.condition.uppercase ? desc.label.toUpperCase() : desc.label);
      var svg = window.WX.icon(desc.group, st.isDay, desc.label);
      if (c.shown.iconGroup !== desc.group || c.shown.iconDay !== st.isDay) {
        c.shown.iconGroup = desc.group;
        c.shown.iconDay = st.isDay;
        if (c.icon.firstChild) {
          c.icon.innerHTML = svg;
          if (pulse) gsap.from(c.icon, { opacity: 0, scale: 0.9, duration: 1.1, ease: 'power2.out', transformOrigin: '50% 50%' });
        } else {
          c.icon.innerHTML = svg;
        }
      }

      /* high / low */
      var fmt = cfg.card.body.range.format || 'H {h}°   L {l}°';
      var hi = num(st.high), lo = num(st.low);
      self.setText(c.range, fmt.replace('{h}', hi == null ? '—' : hi).replace('{l}', lo == null ? '—' : lo));

      /* day / night surface */
      c.root.classList.toggle('is-night', !st.isDay);

      /* glass stat row: label above value, one cell per field */
      var stats = (cfg.card.details.fields || []).map(function (f) {
        var wind = num(st.wind);
        switch (f) {
          case 'wind':
            return wind == null ? null : { label: 'Wind' + (compass(st.windDir) ? ' ' + compass(st.windDir) : ''), value: wind + ' ' + u.windLabel };
          case 'humidity':
            return st.humidity == null ? null : { label: 'Humidity', value: num(st.humidity) + '%' };
          case 'feels':
            return st.feels == null ? null : { label: 'Feels like', value: num(st.feels) + '°' };
          case 'precip':
            return st.precip == null ? null : { label: 'Precip', value: Number(st.precip).toFixed(u.imperial ? 2 : 1) + ' ' + u.precipLabel };
          case 'pressure':
            return st.pressure == null ? null : { label: 'Pressure', value: num(st.pressure) + ' hPa' };
          case 'clouds':
            return st.clouds == null ? null : { label: 'Cloud', value: num(st.clouds) + '%' };
          default: return null;
        }
      }).filter(Boolean);

      var sig = stats.map(function (s) { return s.label + '=' + s.value; }).join('|');
      if (sig !== c.shown.statsSig) {
        c.shown.statsSig = sig;
        self.renderStatCells(c.details, stats);
        if (pulse && c.details.children.length) {
          gsap.from(c.details.children, { opacity: 0, y: 16, duration: 0.85, ease: 'power2.out', stagger: 0.14 });
        }
      }
      c.detailsText = stats.map(function (s) { return s.label + ' ' + s.value; }).join('   ·   ');
      self.fitStatValues();
      self.fitHero();
    });

    /* footer */
    var f = cfg.footer;
    var bits = [];
    var anyError = states.some(function (s) { return !s || s.error; });
    var anyCached = states.some(function (s) { return s && s.fromCache; });
    var hasLive = states.some(function (s) { return s && !s.error && !s.fromCache; });
    if (f.showUpdated) {
      var newest = states.reduce(function (a, s) { return Math.max(a, (s && s.fetchedAt) || 0); }, 0);
      if (newest) {
        bits.push((f.updatedLabel || 'Updated') + ' ' + nowClock(cfg.units.clock24) + (anyCached && !hasLive ? ' (cached)' : ''));
      }
    }
    if (f.showSource && f.sourceLabel) bits.push(f.sourceLabel);
    this.setText(this.footerText, bits.join('  ·  '));
    this.footerText.classList.toggle('footer-stale', anyError || anyCached);

    /* machine-readable state: ready | stale (cached after a failure) | error */
    this.stage.dataset.state = anyError && !states.some(function (s) { return s && !s.error; })
      ? 'error'
      : ((anyError || anyCached) ? 'stale' : 'ready');
    var live = document.getElementById('wx-live');
    if (live) {
      var spoken = states.map(function (s) {
        if (!s) return 'no data';
        if (s.error) return (s.label || 'city') + ': data unavailable, press R to retry';
        return (s.label || 'city') + ': ' + Math.round(s.temp) + ' degrees, ' + window.WX.describeCode(s.code).label.toLowerCase() +
          ', high ' + Math.round(s.high) + ', low ' + Math.round(s.low);
      }, this).join('. ');
      if (live.textContent !== spoken) live.textContent = spoken;
    }
  };

  Panel.prototype.setText = function (node, text) {
    if (!node) return;
    text = text == null ? '' : String(text);
    if (node.textContent !== text) node.textContent = text;
  };

  /* --------------------------------------------------------------------------
     Hero fitting.

     The hero is one lockup — icon above, then temperature / condition /
     high-low. When two cities share the panel the body is only ~340px tall and
     the lockup does not fit, so it must shrink. The original version scaled the
     icon AND the type by a single factor, which dragged the condition down to
     ~18px and the high/low to ~15px: technically fitting, but unreadable.

     Type legibility outranks icon size, so the two now scale independently:

       --text-scale  falls only as far as TEXT_FLOOR   (the type stays readable)
       --icon-scale  absorbs the rest, down to ICON_FLOOR (it is decorative)

     `computeHeroScales` is pure so the arithmetic can be unit-tested without a
     layout engine; `fitHero` is the DOM half that measures and applies it.
     -------------------------------------------------------------------------- */
  var TEXT_FLOOR = 0.86;       // hero type never scales below 86% of its set size
  var ICON_FLOOR = 0.30;       // the icon may shrink much further
  var HERO_HARD_FLOOR = 0.62;  // last resort, only to avoid clipping
  var HERO_GAP = 6;

  Panel.computeHeroScales = function (avail, iconH, readH) {
    var uniform = (avail - HERO_GAP) / (iconH + readH);
    if (!isFinite(uniform) || uniform >= 1) return { text: 1, icon: 1, fits: true };

    var text = Math.max(TEXT_FLOOR, Math.min(1, uniform));
    var icon = (avail - HERO_GAP - readH * text) / iconH;
    icon = Math.max(ICON_FLOOR, Math.min(1, icon));

    /* If even a floored icon cannot free enough room, the type has to give a
       little after all — clipping is worse than a slightly small caption. */
    if (readH * text + iconH * icon + HERO_GAP > avail) {
      text = Math.max(HERO_HARD_FLOOR, (avail - HERO_GAP - iconH * icon) / readH);
    }

    return {
      text: Math.round(text * 1000) / 1000,
      icon: Math.round(icon * 1000) / 1000,
      fits: readH * text + iconH * icon + HERO_GAP <= avail + 0.5
    };
  };

  Panel.prototype.fitHero = function () {
    this.cardEls.forEach(function (c) {
      var body = c.bodyEl, icon = c.icon, readout = c.readout;
      if (!body || !icon || !readout) return;

      /* measure at full size, then decide */
      body.style.setProperty('--text-scale', 1);
      body.style.setProperty('--icon-scale', 1);

      var avail = body.clientHeight;
      if (!avail) return;

      var s = Panel.computeHeroScales(avail, icon.offsetHeight, readout.offsetHeight);
      if (s.text === 1 && s.icon === 1) return;

      body.style.setProperty('--text-scale', s.text);
      body.style.setProperty('--icon-scale', s.icon);
    });
  };

  /* Long stat values (e.g. a three-letter wind direction) must never be clipped.
     NOTE: this used to be gated on `this.rowsEl`, which is never assigned — so
     the whole routine was dead code and long values silently clipped. */
  Panel.prototype.fitStatValues = function () {
    this.cardEls.forEach(function (c) {
      if (!c.details || !c.details.children) return;
      Array.prototype.forEach.call(c.details.children, function (cell) {
        var v = cell.querySelector ? cell.querySelector('.stat__value') : null;
        if (!v) return;
        /* Clear any inline override first so the configured --stat-value-size is
           read back, instead of a stale px value from a previous pass. */
        v.style.fontSize = '';
        var base = parseFloat(typeof getComputedStyle === 'function' ? getComputedStyle(v).fontSize : '') || 36;
        var size = base;
        v.style.fontSize = size + 'px';
        var guard = 0;
        while (v.scrollWidth > v.clientWidth + 1 && size > 18 && guard++ < 30) {
          size -= 1;
          v.style.fontSize = size + 'px';
        }
      });
    });
  };

  /* ------------------------------------------------------------ animation */
  Panel.prototype.buildTimeline = function () {
    var a = this.cfg.animation;
    if (this.tl) this.tl.kill();
    this.tl = gsap.timeline({ paused: true });

    function fromVars(dist) {
      switch (a.cardFrom) {
        case 'bottom': return { y: dist };
        case 'left': return { x: -dist };
        case 'right': return { x: dist };
        default: return { y: -dist };
      }
    }

    this.tl.from(this.header, { yPercent: -100, duration: a.headerDuration, ease: a.headerEase }, 0.05);
    this.cardEls.forEach(function (c, i) {
      var vars = fromVars(a.cardDistance || 70);
      vars.duration = a.cardDuration;
      vars.ease = a.cardEase;
      if (a.fadeRows) vars.opacity = 0;
      this.tl.from(c.root, vars, a.cardStart + i * a.cardStagger);
    }, this);
    if (this.footer) {
      this.tl.from(this.footer, { opacity: 0, duration: 0.4, ease: 'power1.out' }, a.cardStart + this.cardEls.length * a.cardStagger);
    }
    return this.tl;
  };

  Panel.prototype.play = function (delay) {
    /* Reduced motion: appear immediately, no slide, no stagger, no ambient loop */
    if (REDUCE_MOTION) { this.showInstant(); return; }
    if (!this.tl) this.buildTimeline();
    var self = this;
    gsap.set(this.panel, { opacity: 1 });
    /* Rewind, set the delay and only THEN start. Calling .delay() on a timeline
       that is already playing makes GSAP re-begin it, which played the whole
       entrance twice (once immediately, once after the delay). */
    this.tl.pause(0);
    this.tl.delay(delay || 0);
    this.tl.play();
    this.state.onAir = true;

    /* Safety net: a .from() tween renders its START state immediately, so if the
       entrance is ever interrupted — a throttled/paused rAF in a hidden OBS
       source, a dropped frame — the panel would sit there permanently invisible.
       Force the finished state shortly after the timeline should have ended. */
    clearTimeout(this._safety);
    var span = (typeof this.tl.duration === 'function' ? this.tl.duration() : 0) || 3;
    this._safety = setTimeout(function () {
      if (!self.state.onAir || !self.tl) return;
      if (typeof self.tl.progress === 'function' && self.tl.progress() < 1) {
        console.warn('[weather] entrance did not finish — snapping to the visible state');
        self.tl.progress(1, true).pause();
      }
    }, ((delay || 0) + span + 0.6) * 1000);
  };

  Panel.prototype.showInstant = function () {
    if (!this.tl) this.buildTimeline();
    clearTimeout(this._safety);
    gsap.set(this.panel, { opacity: 1 });
    this.tl.progress(1, true).pause();
    this.state.onAir = true;
  };

  Panel.prototype.hideInstant = function () {
    clearTimeout(this._safety);
    if (this.tl) this.tl.pause(0);
    gsap.set(this.panel, { opacity: 0 });
    this.state.onAir = false;
  };

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
    var left = 0;
    if (cfg.stage.fit === 'contain' || cfg.stage.fit === 'none') {
      if (cfg.stage.alignX === 'center') left = (w - cfg.stage.width * s) / 2;
      else if (cfg.stage.alignX === 'right') left = w - cfg.stage.width * s;
    }
    stage.style.transform = 'translate3d(' + left + 'px, 0, 0) scale(' + s + ')';
  }

  /* ================================================================= engine */
  var Engine = {
    cfg: null,
    panel: null,
    states: [],
    refreshing: false,
    lastLoadedAt: 0,
    dataError: null,

    apply: function (patch, opts) {
      opts = opts || {};
      var wasOnAir = !!(this.panel && this.panel.state.onAir);
      var prevCities = this.cfg ? citySignature(this.cfg) : '';
      this.cfg = mergeIncoming(this.cfg || {}, patch || {});
      if (this.panel) this.panel.cfg = this.cfg;
      fitStage(this.cfg);
      if (!this.panel) this.panel = new Panel(this.cfg);
      this.panel.mount();

      this.panel.buildTimeline();
      this.panel.applyData(this.states, { silent: true });

      if (opts.animate === true) this.panel.play(this.cfg.animation.autoPlayDelay);
      else if (wasOnAir || opts.animate === 'static') this.panel.showInstant();
      else this.panel.hideInstant();

      /* the city list or units changed → fetch now; the hub decides whether that
         costs a provider call or comes from its cache */
      if (citySignature(this.cfg) !== prevCities) this.load({ silent: true });
      if (this.cfg.animation.loopPreview && /preview=1/.test(location.search)) this.startLoop();
      return this.cfg;
    },

    play: function () { if (this.panel) this.panel.play(); },
    hide: function () { if (this.panel) this.panel.hideInstant(); },

    /* `refresh` re-reads the hub's cache so a dashboard-triggered update is one
       provider call, not two. `update` forces the provider read itself (Stream
       Deck / the overlay's own key). */
    refresh: function (force) { return this.load({ manual: true, force: force === true }); },

    /* What boot runs. There is deliberately no timer anywhere in this file now:
       a widget that is left running must not keep asking the provider for data
       nobody asked for. A cached payload younger than cacheTtlSeconds is painted
       and left alone; an older one is painted first and refreshed in the
       background. */
    loadInitial: function () {
      var d = this.cfg.data || {};
      var ttl = Math.max(0, Number(d.cacheTtlSeconds == null ? 120 : d.cacheTtlSeconds)) * 1000;
      var cache = readCache(this.cfg);
      if (cache && cache.ts && ttl > 0 && Date.now() - cache.ts < ttl) {
        return Promise.resolve(this.states);
      }
      return this.load({ silent: true });
    },

    load: function (opts) {
      opts = opts || {};
      var self = this, cfg = this.cfg;
      if (this.refreshing) return Promise.resolve(this.states);
      this.refreshing = true;
      newRequestGroup();   /* a superseded request must not overwrite a newer one */

      var items = enabledCities(cfg);
      if (!items.length) {
        this.refreshing = false;
        this.states = [];
        if (this.panel) this.panel.applyData([], { silent: true });
        return Promise.resolve([]);
      }

      var q = 'cities=' + encodeURIComponent(JSON.stringify(items.map(function (c) {
        return {
          label: c.label || '', query: c.query || '', countryCode: c.countryCode || '',
          lat: c.lat == null ? null : Number(c.lat), lon: c.lon == null ? null : Number(c.lon)
        };
      }))) + '&units=' + encodeURIComponent(JSON.stringify(unitsQuery(cfg)));

      return fetchJSON(DATA_URL + '?' + q + (opts.force ? '&force=1' : ''), cfg.data.timeoutMs)
        .then(function (payload) {
          self.refreshing = false;
          var rows = (payload && payload.cities) || [];
          var next = items.map(function (city, i) {
            var st = toState(rows[i]);
            return st || { key: cityKey(city), label: city.label || '', error: 'unavailable', fetchedAt: 0 };
          });
          var failed = next.some(function (r) { return r.error; });

          /* One bad city must not blank the other: the cache is substituted per
             card, and marked, so the panel can say "last good reading" instead
             of pretending it is live. */
          if (failed && (cfg.data.useCacheOnFailure !== false)) {
            var cache = readCache(cfg);
            if (cache && cache.cities && cache.cities.length === next.length) {
              next = next.map(function (r, i) {
                return r.error
                  ? Object.assign({}, cache.cities[i], { fromCache: true, error: null, cachedAt: cache.ts })
                  : r;
              });
            }
          }
          self.states = next;
          self.lastLoadedAt = Date.now();
          self.dataError = failed ? 'some cities could not be refreshed' : null;
          if (next.some(function (r) { return !r.error && !r.fromCache; })) writeCache(cfg, next);
          if (self.panel) self.panel.applyData(next, { silent: !!opts.silent });
          return next;
        })
        .catch(function (e) {
          self.refreshing = false;
          if (e && e.aborted) return self.states;
          console.warn('[weather] refresh failed:', e && e.message);
          self.dataError = (e && e.message) || 'unavailable';
          /* Keep whatever is on screen — a manual update that fails must not
             blank the widget — and mark it cached so the footer is honest. With
             nothing on screen yet there is no "previous" data, so the cards get
             an explicit error state instead of loading placeholders forever. */
          if (!self.states.length) {
            self.states = enabledCities(cfg).map(function (c) {
              return { key: cityKey(c), label: c.label || '', error: self.dataError, fetchedAt: 0 };
            });
          } else {
            self.states = self.states.map(function (s) {
              return Object.assign({}, s, { fromCache: true, error: null, cachedAt: s.fetchedAt || Date.now() });
            });
          }
          if (self.panel) self.panel.applyData(self.states, { silent: true });
          return self.states;
        });
    },
    startLoop: function () {
      var self = this;
      if (this._loop) clearInterval(this._loop);
      var run = function () {
        self.panel.play();
        setTimeout(function () { self.panel.hideInstant(); },
          ((self.cfg.animation.loopHoldIn || 6) + (self.cfg.animation.cardStart || 0)) * 1000);
      };
      run();
      this._loop = setInterval(run, ((self.cfg.animation.loopHoldIn || 6) + (self.cfg.animation.loopHoldOut || 2) + 3) * 1000);
    }
  };

  window.WX = window.WX || {};
  window.WX.engine = Engine;
  window.WX.play = function () { Engine.play(); };
  window.WX.hide = function () { Engine.hide(); };
  window.WX.refresh = function (force) { return Engine.refresh(force); };
  /* exposed so the command → refresh path is testable without a live state poll */
  window.WX.handleCommand = handleCommand;
  window.WX.getConfig = function () { return Engine.cfg; };
  window.WX.getData = function () { return Engine.states; };
  window.WX.Panel = Panel;   /* hero-fit maths is unit-tested in tests/type.js */

  /* ------------------------------------------------------------------ boot */
  /* Dark is merged over the resolved config, so the admin keeps editing the
     light design and dark cannot drift away from it. `?theme=` wins over the
     saved setting, which is what lets one browser source be dark while the rest
     stay light.

     Deliberately at module scope: both the `config` branch of handleCommand and
     start()'s own merge path call it, and while it lived inside start() the
     command branch threw a ReferenceError instead of applying a theme. */
  function resolveTheme(config) {
    var forced = (String(location.search).match(/[?&]theme=(dark|light)(?:&|$)/) || [])[1];
    var want = forced || config.theme || 'light';
    var merged = (want === 'dark' && window.WX_DARK_PALETTE)
      ? deepMerge(config, window.WX_DARK_PALETTE)
      : config;
    /* expose the RESOLVED theme on the config: a `?theme=light` override on a
       dark saved config used to leave cfg.theme="dark" behind */
    merged.theme = want;
    return merged;
  }

  function handleCommand(cmd) {
    if (!cmd) return;
    switch (cmd.action) {
      case 'in': case 'play': Engine.play(); break;
      case 'out': case 'hide': Engine.hide(); break;
      case 'refresh': Engine.refresh(false); break;
      case 'update': Engine.refresh(true); break;
      case 'config': if (cmd.config) Engine.apply(resolveTheme(cmd.config)); break;
    }
  }

  function start() {
    var cfg = deepMerge(SHIPPED, {});
    var qs = new URLSearchParams(location.search);
    var noSync = qs.get('nosync') === '1';
    /* Captured once, and kept for the life of the page. fetchConfig() runs before
       the first boot() has published Engine.cfg, so reading the override back out
       of Engine.cfg found nothing and the first load always used config.json; and
       once a server config arrived, its own sync.serverConfigUrl overwrote the
       override, so even later polls ignored it. */
    var configUrl = qs.get('configUrl') || '';

    try {
      var ls = localStorage.getItem(LS_KEY);
      if (ls) cfg = mergeIncoming(cfg, JSON.parse(ls));
    } catch (e) { /* ignore */ }

    if (configUrl) { cfg.sync = cfg.sync || {}; cfg.sync.serverConfigUrl = configUrl; }
    if (qs.get('config')) { try { cfg = deepMerge(cfg, JSON.parse(atob(qs.get('config')))); } catch (e) { /* ignore */ } }
    if (qs.get('fit')) cfg.stage.fit = qs.get('fit');
    if (qs.get('units')) cfg.units.system = qs.get('units');

    var booted = false, lastCfgJson = '', lastSeq = -1;

    window.addEventListener('resize', function () { fitStage(Engine.cfg); });

    /* The overlay is often embedded (admin preview iframe, OBS). A window
       resize event does not fire when only the frame changes, which left the
       stage scaled for the old size — so watch the root element too. */
    if (window.ResizeObserver) {
      new ResizeObserver(function () { fitStage(Engine.cfg); if (Engine.panel) { Engine.panel.fitHero(); Engine.panel.fitStatValues(); } }).observe(document.documentElement);
    }

    /* keyboard helpers (overlay window): i = in, h = hide, r = refresh */
    window.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'i' || e.key === 'I') Engine.play();
      else if (e.key === 'h' || e.key === 'H') Engine.hide();
      else if (e.key === 'r' || e.key === 'R') Engine.refresh();
    });

    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'wx:config') Engine.apply(resolveTheme(d.config));
      else if (d.type === 'wx:command') handleCommand(d);
    });

    window.addEventListener('storage', function (ev) {
      if (ev.key === LS_KEY && ev.newValue) {
        try { Engine.apply(resolveTheme(JSON.parse(ev.newValue))); } catch (e) { /* ignore */ }
      }
    });

    /* cache first so the panel has values before the network answers */
    var cache = readCache(cfg);
    if (cache && cache.cities) Engine.states = cache.cities;

    function boot(serverCfg) {
      if (booted) return;
      booted = true;
      if (serverCfg) {
        cfg = mergeIncoming(cfg, serverCfg);
        /* A fetched config carries its own sync.serverConfigUrl; letting it win
           would cancel the override that chose where to fetch from. */
        if (configUrl) { cfg.sync = cfg.sync || {}; cfg.sync.serverConfigUrl = configUrl; }
        lastCfgJson = JSON.stringify(serverCfg);
      }
      cfg = resolveTheme(cfg);
      Engine.apply(cfg, { animate: cfg.animation.autoPlay ? true : 'static' });
      Engine.loadInitial();
    }

    function fetchConfig() {
      var u = configUrl ||
        (Engine.cfg && Engine.cfg.sync && Engine.cfg.sync.serverConfigUrl) || 'config.json';
      return fetch(u + (u.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && Object.keys(j).length) ? j : null; })
        .catch(function () { return null; });
    }

    if (noSync) { boot(null); return; }

    var settled = false;
    fetchConfig().then(function (j) { settled = true; boot(j); });
    setTimeout(function () { if (!settled) boot(null); }, 1200);

    setInterval(function () {
      if (!booted) return;
      fetchConfig().then(function (j) {
        if (!j) return;
        var s = JSON.stringify(j);
        if (s === lastCfgJson) return;
        lastCfgJson = s;
        Engine.apply(resolveTheme(j));
      });
    }, (cfg.sync && cfg.sync.pollMs) || 2000);

    function pollState() {
      if (!booted) return;
      var s = (Engine.cfg && Engine.cfg.sync) || {};
      fetch((s.stateUrl || 'api/state') + '?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (st) {
          if (!st || st.seq == null || st.seq === lastSeq) return;
          lastSeq = st.seq;
          handleCommand(st);
        })
        .catch(function () { /* no server: ignore */ });
    }
    setInterval(pollState, (cfg.sync && cfg.sync.statePollMs) || 700);
    setTimeout(pollState, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
