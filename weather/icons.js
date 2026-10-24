/* ============================================================================
   Weather icons — inline animated SVG (no icon font, no network)
   Colours come from CSS variables so the admin panel can theme them:
     --wx-sun --wx-moon --wx-cloud --wx-cloud-dark --wx-rain --wx-snow
     --wx-bolt --wx-fog --wx-accent
   ========================================================================== */
(function () {
  'use strict';

  var S = 'var(--wx-sun,#ffd447)';
  var M = 'var(--wx-moon,#dfe6f5)';
  var C = 'var(--wx-cloud,#eef2f8)';
  var CD = 'var(--wx-cloud-dark,#b9c2d0)';
  var R = 'var(--wx-rain,#4aa3ff)';
  var SN = 'var(--wx-snow,#ffffff)';
  var BO = 'var(--wx-bolt,#ffd447)';
  var FG = 'var(--wx-fog,#c9d2de)';

  function rays(cx, cy, r1, r2, w, color) {
    var s = '<g class="wx-rays" stroke="' + (color || S) + '" stroke-width="' + w + '" stroke-linecap="round">';
    for (var i = 0; i < 8; i++) {
      var a = (i * Math.PI) / 4;
      s += '<line x1="' + (cx + Math.cos(a) * r1).toFixed(1) + '" y1="' + (cy + Math.sin(a) * r1).toFixed(1) +
        '" x2="' + (cx + Math.cos(a) * r2).toFixed(1) + '" y2="' + (cy + Math.sin(a) * r2).toFixed(1) + '"/>';
    }
    return s + '</g>';
  }

  function sun(cx, cy, r) {
    return rays(cx, cy, r + 7, r + 16, 6) +
      /* the disc needs its own fill — with no fill it falls back to the SVG
         default (black) and the sun renders as a black hole */
      '<circle class="wx-sun" fill="' + S + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>';
  }

  function moon(cx, cy, r) {
    return '<path class="wx-moon" fill="' + M + '" d="M' + (cx + 6) + ' ' + (cy - r) +
      'a' + r + ' ' + r + ' 0 1 0 ' + (r * 0.62) + ' ' + (r * 1.72) +
      ' ' + (r * 0.86) + ' ' + (r * 0.86) + ' 0 0 1 ' + (-r * 0.62) + ' ' + (-r * 1.72) + 'z"/>';
  }

  /* a cloud built from overlapping primitives (reliable at any size) */
  function cloud(cx, cy, scale, fill) {
    var f = fill || C;
    return '<g class="wx-cloud" fill="' + f + '" transform="translate(' + cx + ' ' + cy + ') scale(' + scale + ') translate(-50 -60)">' +
      '<circle cx="36" cy="58" r="15"/><circle cx="54" cy="46" r="21"/><circle cx="72" cy="58" r="14"/>' +
      '<rect x="20" y="58" width="66" height="18" rx="9"/></g>';
  }

  function drops(n, color, y) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var x = 34 + i * 16;
      out += '<g class="wx-drop" style="animation-delay:' + (i * 0.22).toFixed(2) + 's">' +
        '<rect x="' + x + '" y="' + (y || 72) + '" width="6" height="15" rx="3" fill="' + (color || R) + '"/></g>';
    }
    return out;
  }

  function flakes(n, y) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<g class="wx-flake" style="animation-delay:' + (i * 0.35).toFixed(2) + 's">' +
        '<circle cx="' + (32 + i * 18) + '" cy="' + (y || 78) + '" r="5" fill="' + SN + '"/></g>';
    }
    return out;
  }

  function bolt(y) {
    return '<path class="wx-bolt" fill="' + BO + '" d="M56 ' + (y || 66) + 'l-16 22h12l-5 18 20-26H55l8-14z"/>';
  }

  function fogLines(y) {
    return '<g class="wx-fog" stroke="' + FG + '" stroke-width="6" stroke-linecap="round">' +
      '<line x1="26" y1="' + y + '" x2="74" y2="' + y + '"/>' +
      '<line x1="32" y1="' + (y + 12) + '" x2="80" y2="' + (y + 12) + '"/>' +
      '<line x1="24" y1="' + (y + 24) + '" x2="66" y2="' + (y + 24) + '"/></g>';
  }

  var BUILDERS = {
    clear: function (day) {
      return day ? sun(50, 50, 22) : moon(48, 50, 24);
    },
    'mainly-clear': function (day) {
      return (day ? sun(40, 38, 17) : moon(38, 38, 19)) + cloud(62, 66, 0.72);
    },
    'partly-cloudy': function (day) {
      return (day ? sun(38, 36, 16) : moon(36, 36, 18)) + cloud(60, 62, 0.92);
    },
    overcast: function () {
      return cloud(44, 52, 0.78, CD) + cloud(56, 62, 0.95);
    },
    fog: function () {
      return cloud(50, 44, 0.8, CD) + fogLines(72);
    },
    drizzle: function () {
      return cloud(50, 46, 0.95) + drops(3, R, 70);
    },
    rain: function () {
      return cloud(50, 44, 1) + drops(3, R, 70);
    },
    showers: function (day) {
      return (day ? sun(30, 30, 13) : moon(30, 30, 15)) + cloud(58, 48, 0.95) + drops(3, R, 72);
    },
    'freezing-rain': function () {
      return cloud(50, 44, 1) + drops(3, R, 70) +
        '<circle class="wx-sun" cx="30" cy="82" r="4" fill="' + SN + '"/>' +
        '<circle class="wx-sun" cx="70" cy="86" r="4" fill="' + SN + '"/>';
    },
    snow: function () {
      return cloud(50, 44, 1) + flakes(3, 76);
    },
    'snow-showers': function (day) {
      return (day ? sun(30, 30, 13) : moon(30, 30, 15)) + cloud(58, 46, 0.95) + flakes(3, 78);
    },
    thunder: function () {
      return cloud(50, 42, 1, CD) + bolt(62);
    },
    'thunder-hail': function () {
      return cloud(50, 42, 1, CD) + bolt(62) + drops(2, R, 78);
    },
    unknown: function () {
      return cloud(50, 52, 0.95, CD);
    }
  };

  /* WMO weather interpretation codes → group + label */
  var CODES = {
    0: ['clear', 'Clear'],
    1: ['mainly-clear', 'Mainly Clear'],
    2: ['partly-cloudy', 'Partly Cloudy'],
    3: ['overcast', 'Overcast'],
    45: ['fog', 'Fog'],
    48: ['fog', 'Freezing Fog'],
    51: ['drizzle', 'Light Drizzle'],
    53: ['drizzle', 'Drizzle'],
    55: ['drizzle', 'Heavy Drizzle'],
    56: ['freezing-rain', 'Freezing Drizzle'],
    57: ['freezing-rain', 'Freezing Drizzle'],
    61: ['rain', 'Light Rain'],
    63: ['rain', 'Rain'],
    65: ['rain', 'Heavy Rain'],
    66: ['freezing-rain', 'Freezing Rain'],
    67: ['freezing-rain', 'Freezing Rain'],
    71: ['snow', 'Light Snow'],
    73: ['snow', 'Snow'],
    75: ['snow', 'Heavy Snow'],
    77: ['snow', 'Snow Grains'],
    80: ['showers', 'Light Showers'],
    81: ['showers', 'Showers'],
    82: ['showers', 'Heavy Showers'],
    85: ['snow-showers', 'Snow Showers'],
    86: ['snow-showers', 'Snow Showers'],
    95: ['thunder', 'Thunderstorm'],
    96: ['thunder-hail', 'Storm + Hail'],
    99: ['thunder-hail', 'Storm + Hail']
  };

  /* Bind to the global object explicitly so this file also loads under a test
     harness (node) or any non-window scope, not just a browser. */
  var WX = (typeof window !== 'undefined' ? window : globalThis);
  WX.WX = WX.WX || {};
  WX = WX.WX;

  WX.describeCode = function (code) {
    var hit = CODES[code];
    return hit ? { group: hit[0], label: hit[1] } : { group: 'unknown', label: '—' };
  };

  /* Group name → numeric code (handy for "manual/override" icon in the admin) */
  WX.groupCodes = (function () {
    var out = {};
    Object.keys(CODES).forEach(function (c) { out[CODES[c][0]] = parseInt(c, 10); });
    return out;
  })();

  /* Icons carry meaning here (fastest read of conditions), so they are exposed
     to assistive tech as a labelled image — never as pure decoration. */
  WX.icon = function (group, isDay, label) {
    var build = BUILDERS[group] || BUILDERS.unknown;
    var name = label || group;
    return '<svg class="wx-svg' + (isDay ? ' is-day' : ' is-night') + '" viewBox="0 0 100 100" ' +
      'role="img" aria-label="' + name + '" focusable="false" preserveAspectRatio="xMidYMid meet">' +
      '<title>' + name + '</title>' +
      build(isDay !== false) + '</svg>';
  };
})();
