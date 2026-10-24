/* ============================================================================
   Vertical Weather — control panel logic
   Live-edits the config, previews it instantly and (with server.js running)
   writes config.json so the OBS browser source follows along.
   ========================================================================== */
(function () {
  'use strict';

  var LS_KEY = 'wx-config-v1';
  var preview = document.getElementById('preview');
  var SHIPPED = window.WX_DEFAULT_CONFIG || {};
  var APP_V = (SHIPPED.meta && SHIPPED.meta.version) || '?';
  var cfg = clone(SHIPPED);
  /* a stored config from an older build must not pin an outdated theme */
  function mergeIncoming(base, patch) {
    var M = window.WX_MIGRATE;
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
  function status(msg, kind) { var s = $('status'); s.textContent = msg; s.className = kind || ''; }

  /* ------------------------------------------------------------ load / save */
  try {
    var ls = localStorage.getItem(LS_KEY);
    if (ls) cfg = mergeIncoming(cfg, JSON.parse(ls));
  } catch (e) { /* ignore */ }

  /* Send the current config to the preview iframe. This is how the panel shows
     what is on air; it is NOT a save, so the load path may call it freely. */
  function postPreview() {
    if (preview && preview.contentWindow) {
      preview.contentWindow.postMessage({ type: 'wx:config', config: cfg }, '*');
    }
  }

  function push() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    postPreview();
    $('rawJson').value = JSON.stringify(cfg, null, 2);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToServer, 500);
    status('updated (live)', 'ok');
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

    var ev = (node.type === 'checkbox' || node.tagName === 'SELECT') ? 'change' : 'input';
    node.addEventListener(ev, function () {
      var v;
      if (node.type === 'checkbox') v = node.checked;
      else if (node.type === 'number') { v = node.value === '' ? '' : parseFloat(node.value); if (isNaN(v)) v = ''; }
      else v = node.value;

      /* <input type="color"> has no alpha channel: keep the alpha the config
         value already had instead of silently flattening the glass. */
      if (node.type === 'color') {
        var prev = parseColor(get());
        if (prev && prev.a < 1) v = withAlpha(v, prev.a);
      }
      if (opts.transform) v = opts.transform(v, cfg);
      set(v);
      if (opts.after) opts.after(v);
      push();
    });
    if (opts.side) opts.side(val, node);
  }

  /* -------------------------------------------------------------- colours --
     #rgb / #rrggbb / rgb() / rgba() → { r, g, b, a, hex } and back, so the
     pickers edit hue while the alpha survives.                              */
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

  /* details-strip field checkboxes ---------------------------------------- */
  var FIELD_IDS = {
    wind: 'c_fWind', humidity: 'c_fHum', feels: 'c_fFeels',
    precip: 'c_fPrecip', pressure: 'c_fPressure', clouds: 'c_fClouds'
  };
  function isImperial() { return (cfg.units && cfg.units.system) !== 'metric'; }
  function renderFields() {
    var list = cfg.card.details.fields || [];
    Object.keys(FIELD_IDS).forEach(function (f) {
      var n = $(FIELD_IDS[f]);
      if (n) n.checked = list.indexOf(f) !== -1;
    });
  }
  Object.keys(FIELD_IDS).forEach(function (f) {
    var n = $(FIELD_IDS[f]);
    if (!n) return;
    n.addEventListener('change', function () {
      var list = cfg.card.details.fields || [];
      var i = list.indexOf(f);
      if (n.checked && i === -1) list.push(f);
      if (!n.checked && i !== -1) list.splice(i, 1);
      /* keep a stable, sensible order */
      var order = ['wind', 'humidity', 'feels', 'precip', 'pressure', 'clouds'];
      list.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      cfg.card.details.fields = list;
      push();
    });
  });

  function syncUI() {
    /* cities / units */
    bind('theme', 'c_theme');
    bind('units.system', 'c_units', { after: function () { pushUnits(); } });
    bind('units.wind', 'c_wind');
    bind('units.clock24', 'c_clock24');
    bind('units.locale', 'c_locale');
    bind('card.cityBand.showCountry', 'c_showCountry');
    bind('card.cityBand.showLocalTime', 'c_showLocalTime');
    bind('card.body.range.show', 'c_showRange');

    /* data */
    bind('data.timeoutMs', 'c_timeout');
    bind('data.showStaleAfterMinutes', 'c_stale');
    bind('data.useCacheOnFailure', 'c_useCache');
    bind('footer.showUpdated', 'c_showUpdated');
    bind('footer.showSource', 'c_showSource');
    bind('footer.sourceLabel', 'c_sourceLabel');
    bind('animation.tweenValues', 'c_tweenValues');
    bind('animation.tweenDuration', 'c_tweenDuration');

    /* look */
    bind('header.text', 'c_headerText');
    bind('header.color', 'c_headerColor');
    bind('header.gradient.0.color', 'c_headerGradA');
    bind('header.gradient.1.color', 'c_headerGradB');
    bind('card.cityBand.gradient.0.color', 'c_cityGradA');
    bind('card.cityBand.gradient.1.color', 'c_cityGradB');
    bind('card.cityBand.color', 'c_cityColor');
    bind('card.cityBand.size', 'c_citySize');
    bind('card.cityBand.timeSize', 'c_cityTimeSize');
    bind('card.body.temp.color', 'c_tempColor');
    bind('card.body.temp.size', 'c_tempSize');
    bind('card.body.condition.color', 'c_condColor');
    bind('card.body.condition.size', 'c_condSize');
    bind('card.body.range.color', 'c_rangeColor');
    bind('card.body.range.size', 'c_rangeSize');
    bind('card.body.range.format', 'c_rangeFormat');
    bind('card.details.gradient.0.color', 'c_detailsBg', { after: function (v) { cfg.card.details.gradient[1].color = v; refreshStopsOnly(); } });
    bind('card.details.labelColor', 'c_statLabelColor');
    bind('card.details.valueColor', 'c_statValueColor');
    bind('card.details.labelSize', 'c_statLabelSize');
    bind('card.details.valueSize', 'c_statValueSize');
    bind('panel.background', 'c_panelBg');
    bind('panel.accentColor', 'c_accent');
    bind('panel.glass.blur', 'c_glassBlur');
    bind('panel.borderColor', 'c_borderColor');
    bind('panel.borderWidth', 'c_borderWidth');
    bind('panel.radius', 'c_radius');
    bind('panel.shadow', 'c_panelShadow');
    bind('header.gloss', 'c_headerGloss');
    bind('card.body.gloss', 'c_bodyGloss');

    /* icon colours — all eight the icon set reads; the overlay writes each one
       to its --wx-* custom property on the panel */
    bind('iconColors.sun', 'c_icSun');
    bind('iconColors.moon', 'c_icMoon');
    bind('iconColors.cloud', 'c_icCloud');
    bind('iconColors.cloudDark', 'c_icCloudDark');
    bind('iconColors.rain', 'c_icRain');
    bind('iconColors.snow', 'c_icSnow');
    bind('iconColors.bolt', 'c_icBolt');
    bind('iconColors.fog', 'c_icFog');

    /* fonts */
    bind('googleFonts', 'c_googleFonts', { transform: function (v) { return String(v).split('\n').map(function (s) { return s.trim(); }).filter(Boolean); } });
    $('c_googleFonts').value = (cfg.googleFonts || []).join('\n');
    bind('header.fontFamily', 'c_headFont');
    bind('header.weight', 'c_headWeight');
    bind('header.uppercase', 'c_headerUpper');
    bind('card.cityBand.weight', 'c_cityWeight');
    bind('card.cityBand.letterSpacing', 'c_cityTracking');
    bind('card.body.temp.fontFamily', 'c_tempFont');
    bind('card.body.temp.weight', 'c_tempWeight');
    bind('card.body.temp.fontUrl', 'c_tempFontUrl');
    bind('card.body.temp.showUnit', 'c_tempUnit');
    bind('card.body.temp.unit', 'c_tempUnitChar');
    bind('card.body.condition.weight', 'c_condWeight');
    bind('card.body.condition.uppercase', 'c_condUpper');
    bind('card.body.range.weight', 'c_rangeWeight');
    bind('card.details.weight', 'c_detailsWeight');
    bind('card.details.uppercase', 'c_detailsUpper');
    bind('footer.color', 'c_footerColor');
    bind('footer.size', 'c_footerSize');
    bind('footer.align', 'c_footerAlign');
    bind('footer.visible', 'c_footerVisible');

    /* layout */
    bind('stage.width', 'c_stageW', { after: syncPreviewRatio });
    bind('stage.height', 'c_stageH', { after: syncPreviewRatio });
    bind('stage.fit', 'c_fit');
    bind('stage.alignX', 'c_alignX');
    bind('panel.x', 'c_panelX');
    bind('panel.y', 'c_panelY');
    bind('panel.width', 'c_panelW');
    bind('panel.verticalAnchor', 'c_vAnchor');
    bind('panel.heightMode', 'c_heightMode');
    bind('header.height', 'c_headerH');
    bind('footer.height', 'c_footerH');
    bind('card.cityBand.height', 'c_cityH');
    bind('card.body.height', 'c_bodyH');
    bind('card.details.height', 'c_detailsH');
    bind('card.gap', 'c_cardGap');
    bind('card.body.iconSize', 'c_iconSize');
    bind('card.body.iconX', 'c_iconX');
    bind('card.body.temp.align', 'c_tempAlign');

    /* animation */
    bind('animation.autoPlay', 'c_autoPlay');
    bind('animation.ambient', 'c_ambient');
    bind('animation.cardFrom', 'c_cardFrom');
    bind('animation.cardDistance', 'c_cardDistance');
    bind('animation.cardDuration', 'c_cardDuration');
    bind('animation.cardStagger', 'c_cardStagger');
    bind('animation.cardStart', 'c_cardStart');
    bind('animation.cardEase', 'c_cardEase');
    bind('animation.headerDuration', 'c_headerDuration');
    bind('animation.headerEase', 'c_headerEase');
    bind('animation.fadeRows', 'c_fadeRows');
  }

  function pushUnits() {
    /* keep wind unit in step with the unit system unless the user overrode it */
    var imp = isImperial();
    cfg.units.wind = imp ? 'mph' : 'kmh';
    if ($('c_wind')) $('c_wind').value = cfg.units.wind;
  }

  /* ------------------------------------------------------------ city cards
     A city carries TWO names and they are not the same thing:
       query — the place to look up (Open-Meteo geocoding)
       label — the title printed in the card's header, on air
     A city used to be created with the literal label "New City". That value was
     a truthy title that nothing ever replaced, so a freshly added city kept the
     placeholder whatever you typed into Search name — and because the overlay
     falls back with `label || resolvedGeoName`, a truthy placeholder also
     prevented the real place name from ever appearing. */
  var PLACEHOLDER_LABEL = 'New City';

  /* True while the label is not a title the operator chose: blank, or the old
     injected placeholder. Both mean "this city has no name of its own yet". */
  function isUnsetLabel(v) {
    var s = String(v == null ? '' : v).trim();
    return s === '' || s === PLACEHOLDER_LABEL;
  }

  /* Repair a config saved by a build that wrote the placeholder. The search name
     is the only name the operator ever actually typed, so that becomes the
     title. A real label is never touched. Runs once at boot, before the rows are
     built, so both the panel and the air show the repaired title immediately. */
  function healCityLabels() {
    var healed = 0;
    (cfg.cities || []).forEach(function (c) {
      if (!c || String(c.label == null ? '' : c.label).trim() !== PLACEHOLDER_LABEL) return;
      c.label = String(c.query || '').trim();
      healed++;
    });
    return healed;
  }

  /* ------------------------------------------------------- city lookup
     A name like "Springfield" matches dozens of places in different states, and
     the geocoder answers a plain query with whichever one it ranks first — so
     typing could never say WHICH Springfield was meant. Typing now offers the
     matches (each with its state and country), and choosing one pins its exact
     latitude/longitude, which is the thing that actually disambiguates: the
     overlay skips geocoding entirely once both coordinates are set.

     The list is debounced and aborts a superseded request, so holding a key down
     does not spray requests at Open-Meteo. */
  var GEO_MIN_CHARS = 2;
  var GEO_DEBOUNCE_MS = 250;
  var GEO_CACHE_MS = 5 * 60 * 1000;
  var GEO_COUNT = 10;
  var geoResultCache = {};   /* "query|country" -> { at, results } */

  /* Wire one row's search-name box to its dropdown. The mechanics (debounce,
     abort, keyboard, ARIA, cache) live in the shared combobox, so the market
     asset picker behaves identically; this function only knows what a CITY is. */
  function attachCityLookup(o) {
    var city = o.city, input = o.query, list = o.list;

    function searchUrl(q) {
      var u = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) +
        '&count=' + GEO_COUNT +
        '&language=' + encodeURIComponent((cfg.units && cfg.units.locale) || 'en') +
        '&format=json';
      if (city.countryCode) u += '&countryCode=' + encodeURIComponent(String(city.countryCode).toUpperCase());
      return u;
    }

    return window.createCombobox({
      input: input,
      list: list,
      minChars: GEO_MIN_CHARS,
      debounceMs: GEO_DEBOUNCE_MS,
      cacheMs: GEO_CACHE_MS,
      itemClass: 'geo-item',
      nameClass: 'geo-item__name',
      whereClass: 'geo-item__where',
      emptyText: 'no matching places',
      cacheKey: function (q) {
        return q.toLowerCase() + '|' + String(city.countryCode || '').toUpperCase();
      },
      itemKey: function (r) { return String(r.id || r.name || ''); },
      optionAttrs: function (r) { return { 'data-lat': r.latitude, 'data-lon': r.longitude }; },
      fetchResults: function (q, signal) {
        return fetch(searchUrl(q), signal ? { signal: signal } : {})
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            return ((j && j.results) || []).filter(function (x) {
              return x && x.latitude != null && x.longitude != null && x.name;
            });
          });
      },
      renderOption: function (r) {
        return {
          label: r.name,
          note: [r.admin1, r.country].filter(Boolean).join(', '),
          data: r
        };
      },
      onPick: function (r) {
        var lat = Math.round(Number(r.latitude) * 1e6) / 1e6;
        var lon = Math.round(Number(r.longitude) * 1e6) / 1e6;
        if (!isFinite(lat) || !isFinite(lon)) return;

        city.lat = lat;
        city.lon = lon;
        city.query = String(r.name || input.value);
        input.value = city.query;
        o.lat.value = lat;
        o.lon.value = lon;
        /* Choosing a place IS the rename: this is the only thing that changes the
           card's title, which is why typing alone must not touch it. */
        city.label = String(r.name || input.value);
        o.label.value = city.label;
        o.enable();
        push();
        status('pinned ' + [r.name, r.admin1, r.country].filter(Boolean).join(', ') +
          ' \u2014 ' + lat + ', ' + lon, 'ok');
      }
    });
  }
  function renderCities() {
    var list = $('cityList');
    list.innerHTML = '';
    cfg.cities.forEach(function (city, i) {
      var row = document.createElement('div');
      row.className = 'city' + (city.enabled === false ? ' is-off' : '');
      row.innerHTML =
        '<div class="city__head">' +
        '  <span class="grip">⠿</span>' +
        '  <input type="text" class="label" value="" placeholder="City label" />' +
        '  <button class="ic on is-on" title="show / hide">●</button>' +
        '  <button class="ic del" title="remove">✕</button>' +
        '</div>' +
        '<div class="city__grid">' +
        '  <div class="city__search">' +
        '    <label>Search name</label>' +
        '    <input type="text" class="query" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" />' +
        '    <ul class="geo-list" role="listbox" hidden></ul>' +
        '  </div>' +
        '  <div><label>Latitude</label><input type="text" class="lat" placeholder="auto" /></div>' +
        '  <div><label>Longitude</label><input type="text" class="lon" placeholder="auto" /></div>' +
        '</div>';

      var label = row.querySelector('.label');
      var query = row.querySelector('.query');
      var lat = row.querySelector('.lat');
      var lon = row.querySelector('.lon');
      var geoList = row.querySelector('.geo-list');
      geoList.id = 'geo-list-' + i;
      geoList.hidden = true;
      label.value = city.label || '';
      query.value = city.query || '';
      lat.value = city.lat == null ? '' : city.lat;
      lon.value = city.lon == null ? '' : city.lon;

      /* typing in a greyed-out city switches it on */
      function enable() {
        if (city.enabled === false) {
          city.enabled = true;
          row.classList.remove('is-off');
          status('city ' + (i + 1) + ' enabled', 'ok');
        }
      }
      label.addEventListener('input', function () { city.label = label.value; enable(); push(); });

      var lookup = attachCityLookup({
        city: city, query: query, list: geoList, label: label,
        lat: lat, lon: lon, enable: enable
      });

      query.addEventListener('input', function () {
        /* Typing is a LOOKUP, not a rename. The card keeps whatever title it has
           until a place is actually chosen from the list — renaming on every
           keystroke put "Spr" on air mid-word, and left the title disagreeing
           with the place whose weather was being fetched. */
        city.query = query.value;
        /* A pinned coordinate WINS over the name in the overlay, so editing the
           name has to release it — otherwise the new name would have no effect at
           all and the card would keep showing the previously picked city. */
        if (city.lat != null || city.lon != null) {
          city.lat = null;
          city.lon = null;
          lat.value = '';
          lon.value = '';
        }
        enable(); push();
        lookup.schedule();
      });
      lat.addEventListener('input', function () {
        city.lat = lat.value.trim() === '' ? null : parseFloat(lat.value);
        if (isNaN(city.lat)) city.lat = null;
        enable(); push();
      });
      lon.addEventListener('input', function () {
        city.lon = lon.value.trim() === '' ? null : parseFloat(lon.value);
        if (isNaN(city.lon)) city.lon = null;
        enable(); push();
      });

      row.querySelector('.on').addEventListener('click', function () {
        city.enabled = city.enabled === false;
        row.classList.toggle('is-off', city.enabled === false);
        push();
      });
      row.querySelector('.del').addEventListener('click', function () {
        if (cfg.cities.length <= 1) return;
        cfg.cities.splice(i, 1);
        renderCities(); push();
      });

      /* drag & drop order = on-screen order */
      row.draggable = true;
      row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        var moved = cfg.cities.splice(from, 1)[0];
        cfg.cities.splice(i, 0, moved);
        renderCities(); push();
      });

      list.appendChild(row);
    });
  }

  $('btnAddCity').addEventListener('click', function () {
    if (cfg.cities.length >= (cfg.maxCities || 2)) {
      status('max ' + (cfg.maxCities || 2) + ' cities — raise "maxCities" in the JSON to add more', 'warn');
      return;
    }
    /* No invented title: the label stays empty until the search name fills it,
       so nothing fake can reach config.json or the card. The row's own input
       still shows a "City label" placeholder, which is a hint rather than data. */
    cfg.cities.push({ label: '', query: '', countryCode: '', lat: null, lon: null, enabled: true });
    renderCities(); push();
  });

  $('btnGeocode').addEventListener('click', function () {
    var city = cfg.cities[0];
    if (!city) return;
    var q = (city.query || city.label || '').trim();
    if (!q) { $('geoMsg').textContent = 'type a city name first'; return; }
    $('geoMsg').textContent = 'looking up "' + q + '"…';
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var res = j && j.results && j.results[0];
        if (!res) { $('geoMsg').innerHTML = '<span class="err">no match for "' + q + '"</span>'; return; }
        $('geoMsg').textContent = res.name + ', ' + (res.admin1 ? res.admin1 + ', ' : '') + (res.country || '') +
          '  →  ' + res.latitude.toFixed(3) + ', ' + res.longitude.toFixed(3) + '  (' + (res.timezone || '') + ')';
      })
      .catch(function (e) { $('geoMsg').innerHTML = '<span class="err">lookup failed: ' + e.message + '</span>'; });
  });

  /* --------------------------------------------------------- body gradient */
  function renderStops() {
    var wrap = $('bodyStops');
    wrap.innerHTML = '';
    cfg.card.body.gradient.forEach(function (stop, i) {
      var colour = parseColor(stop.color) || { hex: '#ffffff', a: 1 };
      /* a colour input carries no alpha, so edit them separately */
      var apply = function () {
        stop.color = withAlpha(colour.hex, colour.a);
        push();
      };
      var row = document.createElement('div');
      row.className = 'stop';
      row.innerHTML = '<input type="range" min="0" max="100" value="' + stop.offset + '" />' +
        '<input type="color" value="' + colour.hex + '" />' +
        '<input type="number" min="0" max="1" step="0.05" value="' + colour.a + '" title="alpha (0–1)" />' +
        '<button class="ic del" title="remove">✕</button>';
      row.querySelector('input[type="range"]').addEventListener('input', function () { stop.offset = parseFloat(this.value); push(); });
      row.querySelector('input[type="color"]').addEventListener('input', function () { colour.hex = this.value; apply(); });
      row.querySelector('input[type="number"]').addEventListener('input', function () {
        var a = parseFloat(this.value);
        colour.a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
        apply();
      });
      row.querySelector('.del').addEventListener('click', function () {
        if (cfg.card.body.gradient.length <= 2) return;
        cfg.card.body.gradient.splice(i, 1); renderStops(); push();
      });
      wrap.appendChild(row);
    });
  }
  function refreshStopsOnly() { /* colours only — ranges unchanged */ }

  /* Re-read every bound control from cfg WITHOUT re-running syncUI(): bind()
     adds one listener per control, so a second syncUI() would double-bind every
     edit. Used when config.json replaces the config under the panel. */
  function refreshBoundValues() {
    runBinders.getValue.forEach(function (b) { b(); });
    /* googleFonts is set directly in syncUI, not through bind() */
    $('c_googleFonts').value = (cfg.googleFonts || []).join('\n');
  }

  /* Re-sync every input with the current config (used by import/reset) */
  function refreshAll() {
    renderCities();
    renderStops();
    renderFields();
    refreshBoundValues();
    push();
  }

  /* Small helper so refreshAll can re-read values into the inputs */
  var runBinders = { getValue: [] };

  /* wrap bind() so every binding can be re-read later */
  var _bind = bind;
  bind = function (path, id, opts) {
    _bind(path, id, opts);
    runBinders.getValue.push(function () {
      var node = $(id);
      if (!node) return;
      var parts = path.split('.');
      var v = cfg;
      parts.forEach(function (p) { v = v && v[p]; });
      if (node.type === 'checkbox') node.checked = !!v;
      else if (node.type === 'color') node.value = toHex(v) || '#000000';
      else node.value = v == null ? '' : v;
    });
  };

  /* ----------------------------------------------------------- topbar tools */
  $('btnIn').addEventListener('click', function () { command({ type: 'wx:command', action: 'in' }); });
  $('btnHide').addEventListener('click', function () { command({ type: 'wx:command', action: 'hide' }); });
  $('btnRefresh').addEventListener('click', function () {
    command({ type: 'wx:command', action: 'refresh' });
    status('refresh requested…', 'warn');
  });
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
    cfg = clone(window.WX_DEFAULT_CONFIG || {});
    /* push() rewrites localStorage, re-posts to the overlay and schedules the
       server save. Without it the reset lived only in this tab: the next reload
       pulled the old config.json back and the button looked like a no-op. */
    refreshAll();
    push();
    status('reset to factory defaults', 'ok');
  });
  $('btnApplyRaw').addEventListener('click', function () {
    try { cfg = mergeIncoming(cfg, JSON.parse($('rawJson').value)); refreshAll(); status('json applied', 'ok'); }
    catch (err) { status('invalid json: ' + err.message, 'err'); }
  });
  $('btnCopyRaw').addEventListener('click', function () {
    $('rawJson').select(); document.execCommand('copy'); status('json copied', 'ok');
  });

  $('optGrid').addEventListener('change', function () {
    $('previewStage').classList.toggle('guides', this.checked);
  });
  /* preview frame follows the configured stage size (portrait widget) */
  function syncPreviewRatio() {
    var st = cfg.stage || { width: 460, height: 1080 };
    document.documentElement.style.setProperty('--stage-ratio', st.width + ' / ' + st.height);
  }
  syncPreviewRatio();

  $('selZoom').addEventListener('change', function () {
    var scale = this.value === 'fit' ? 1 : parseFloat(this.value);
    preview.style.transform = scale === 1 ? 'none' : 'scale(' + scale + ')';
    preview.style.transformOrigin = 'center center';
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('is-active'); });
      document.querySelectorAll('.panel-body').forEach(function (x) { x.classList.remove('is-active'); });
      t.classList.add('is-active');
      document.querySelector('[data-panel="' + t.dataset.tab + '"]').classList.add('is-active');
    });
  });

  /* ------------------------------------------------- live status from the overlay */
  function pollData() {
    try {
      var w = preview.contentWindow;
      var data = w && w.WX && w.WX.getData ? w.WX.getData() : null;
      if (data && data.length) {
        var msg = data.map(function (d, i) {
          if (!d) return 'city ' + (i + 1) + ': —';
          if (d.error) return (d.label || 'city ' + (i + 1)) + ': ' + d.error;
          return (d.label || 'city ' + (i + 1)) + ': ' + Math.round(d.temp) + '° · ' +
            (window.WX && w.WX ? '' : '') + 'updated ' + new Date(d.fetchedAt).toLocaleTimeString();
        }).join('   |   ');
        $('dataMsg').textContent = msg;
        $('dataMsg').className = 'msg' + (data.some(function (d) { return d && d.error; }) ? ' err' : '');
      }
    } catch (e) { /* cross-origin (file://) — ignore */ }
  }
  setInterval(pollData, 2000);

  /* --------------------------------------------------- adopt config.json
     config.json is what the OBS source actually renders; this browser's
     localStorage is only a cache of the last edit made here. Opening the panel
     on a fresh profile used to POST the shipped samples back over the operator's
     live cities and settings. So the server copy is the source of truth: GET it,
     merge it OVER the local copy with the same migration the overlay uses, then
     re-render the panel from it. Reading must never write: no push(), no POST. */
  function loadServerConfig() {
    fetch('api/config', { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      /* no file yet (the hub answers "{}") or not a config — keep the local copy */
      if (!isObj(j) || !Object.keys(j).length) {
        status('ready · v' + APP_V + ' · no config.json on the server — using this browser\'s copy', 'warn');
        return;
      }
      cfg = mergeIncoming(cfg, j);
      /* the server copy may still carry an old placeholder title */
      var healed = healCityLabels();
      /* render functions, not syncUI(): the bindings are already installed */
      renderCities();
      renderStops();
      renderFields();
      refreshBoundValues();
      syncPreviewRatio();
      $('rawJson').value = JSON.stringify(cfg, null, 2);
      postPreview();
      var note = 'config.json loaded · v' + APP_V;
      if (migratedAtBoot) {
        note += ' · settings upgraded to v' + APP_V + ' (was v' + window.WX_MIGRATE.migratedFrom + ') — your settings were kept';
      }
      if (healed) note += ' · repaired ' + healed + ' placeholder city title' + (healed === 1 ? '' : 's');
      status(note, healed ? 'warn' : 'ok');
    }).catch(function () {
      status('ready · v' + APP_V + ' · could not read config.json — using this browser\'s copy', 'err');
    });
  }

  /* ------------------------------------------------------------------- boot */
  syncUI();
  /* Repair placeholder titles BEFORE the rows are built, so the panel and the
     board agree from the first paint. The repair is persisted by the next edit;
     boot itself never writes. */
  var healedCities = healCityLabels();
  renderCities();
  renderStops();
  renderFields();
  $('rawJson').value = JSON.stringify(cfg, null, 2);
  /* Where OBS should point. Over http this page's sibling is the overlay (the
     hub path comes for free). Opened from disk there is no origin to build a
     URL from, so recommend the hub. */
  $('obsUrl').textContent = location.protocol === 'file:'
    ? 'index.html or http://localhost:8790/weather/index.html (recommended — run the hub with node server.js)'
    : location.origin + location.pathname.replace(/admin\.html$/, 'index.html');
  preview.addEventListener('load', function () { postPreview(); }, { once: true });
  /* Keep the preview in step even if its load event fired before this script
     attached. A postMessage is not a save, so boot still writes no config. */
  setTimeout(postPreview, 400);
  status('ready · v' + APP_V + (healedCities
    ? ' · repaired ' + healedCities + ' placeholder city title' + (healedCities === 1 ? '' : 's')
    : ''), healedCities ? 'warn' : '');
  var migratedAtBoot = !!(window.WX_MIGRATE && window.WX_MIGRATE.migrated);
  if (migratedAtBoot) {
    status('settings upgraded to v' + APP_V + ' (was v' + window.WX_MIGRATE.migratedFrom + ') — your settings were kept', 'warn');
  }
  loadServerConfig();

  /* ---------------------------------------------------------- manual update
     One provider read per press. The hub does the fetching — it is the only
     context a normal browser and an OBS browser source share — then the overlay
     is told to re-read the now-fresh cache. See shared/datasync.js. */
  function unitsForDataUrl() {
    var sys = (cfg.units && cfg.units.system) || 'imperial';
    var imperial = sys !== 'metric';
    return {
      temperature: (cfg.units && cfg.units.temperature) || (imperial ? 'fahrenheit' : 'celsius'),
      wind: (cfg.units && cfg.units.wind) || (imperial ? 'mph' : 'kmh'),
      precipitation: imperial ? 'inch' : 'mm'
    };
  }
  function dataUrl(force) {
    var cities = (cfg.cities || []).filter(function (c) {
      return c.enabled !== false && (c.query || (c.lat != null && c.lon != null));
    }).slice(0, cfg.maxCities || 2).map(function (c) {
      return {
        label: c.label || '', query: c.query || '', countryCode: c.countryCode || '',
        lat: c.lat == null ? null : Number(c.lat), lon: c.lon == null ? null : Number(c.lon)
      };
    });
    if (!cities.length) throw new Error('no cities are enabled — turn one on in Cities');
    var q = 'cities=' + encodeURIComponent(JSON.stringify(cities)) +
      '&units=' + encodeURIComponent(JSON.stringify(unitsForDataUrl()));
    return 'api/data?' + q + (force ? '&force=1' : '');
  }
  if (window.DataSync && $('btnDataUpdate') && $('dataStatus')) {
    window.DataSync.mount({
      app: 'weather',
      button: $('btnDataUpdate'),
      status: $('dataStatus'),
      buildUrl: dataUrl,
      commandUrl: 'api/command?action=refresh',
      cooldownMs: 8000
    });
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

})();
