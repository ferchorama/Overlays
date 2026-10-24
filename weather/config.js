/* ============================================================================
   Vertical Weather Widget — configuration
   ----------------------------------------------------------------------------
   One-off widget: a single committed palette, no theme switching.
   Light "sky" glass — azure by day, periwinkle by night. Deliberately no greys
   and no blacks: every surface, hairline, shadow and text colour carries hue.

   Legibility: a browser source composites over your video, so the tint alpha
   drives the effective background. 0.74 keeps the slab light even over black
   footage; run `node tests/contrast.js` after changing any colour.
   ========================================================================== */

/* Dark is a curated palette rather than a second set of editable fields. It is
   merged over whatever config.json holds, so the light design stays the thing
   the admin edits and dark cannot drift out of sync with it. Selected by
   `theme`, or forced per browser source with ?theme=dark. */
window.WX_DARK_PALETTE = {
  /* Neutral greys: every surface below is r = g = b, so the dark theme reads as
     charcoal rather than navy. Icon colours are deliberately left alone — a blue
     raindrop or an orange sun is content, not chrome. */
  panel: {
    background: 'rgba(26,26,26,0.86)',
    borderColor: 'rgba(255,255,255,0.14)',
    accentColor: '#cfcfcf',
    shadow: '0 26px 60px rgba(0,0,0,0.55)',
    glass: {
      borderColor: 'rgba(255,255,255,0.12)',
      hairline: 'rgba(255,255,255,0.14)',
      orbBorder: 'rgba(255,255,255,0.20)'
    }
  },
  /* same three-stop structure, drained of hue; day stays lighter than night */
  surfaces: {
    day: [
      { offset: 0, color: 'rgba(68,68,68,0.92)' },
      { offset: 52, color: 'rgba(50,50,50,0.92)' },
      { offset: 100, color: 'rgba(36,36,36,0.92)' }
    ],
    night: [
      { offset: 0, color: 'rgba(46,46,46,0.92)' },
      { offset: 52, color: 'rgba(34,34,34,0.92)' },
      { offset: 100, color: 'rgba(23,23,23,0.92)' }
    ]
  },
  header: {
    gradient: [
      { offset: 0, color: 'rgba(255,255,255,0.08)' },
      { offset: 100, color: 'rgba(255,255,255,0)' }
    ],
    color: '#ededed'
  },
  card: {
    divider: { color: 'rgba(255,255,255,0.12)' },
    cityBand: {
      gradient: [
        { offset: 0, color: 'rgba(255,255,255,0.08)' },
        { offset: 100, color: 'rgba(255,255,255,0)' }
      ],
      color: '#f0f0f0',
      timeColor: '#b0b0b0'
    },
    body: {
      gradient: [
        { offset: 0, color: 'rgba(255,255,255,0.06)' },
        { offset: 100, color: 'rgba(255,255,255,0)' }
      ],
      temp: { color: '#f5f5f5' },
      condition: { color: '#c0c0c0' },
      range: { color: '#b4b4b4' }
    },
    details: {
      gradient: [
        { offset: 0, color: 'rgba(255,255,255,0.08)' },
        { offset: 100, color: 'rgba(255,255,255,0.03)' }
      ],
      color: '#e8e8e8',
      labelColor: '#ababab',
      valueColor: '#ededed'
    }
  },
  footer: {
    gradient: [
      { offset: 0, color: 'rgba(255,255,255,0.09)' },
      { offset: 100, color: 'rgba(255,255,255,0)' }
    ],
    color: '#a8a8a8'
  }
};

window.WX_DEFAULT_CONFIG = {
  /* 'light' | 'dark' — see WX_DARK_PALETTE above */
  theme: 'light',
  meta: { name: 'Vertical Weather Widget', version: '3.1.8' },

  /* ---------------- Stage = the widget (portrait 1080p) ---------------- */
  stage: {
    /* 1080 tall, 460 wide — never 1920 wide. Add it to OBS as a 460x1080
       browser source and it maps 1:1; on a 1920x1080 canvas `contain` keeps it
       at 100% on the left. Change `width` to make the strip wider/narrower. */
    width: 460,
    height: 1080,
    fit: 'contain',
    alignX: 'left',
    background: 'transparent'
  },

  /* ---------------- Panel shell (the sky-glass slab) ---------------- */
  panel: {
    x: 0,
    y: 0,
    width: 460,
    heightMode: 'fill',        // fill = spans the full 1080p height
    radius: 34,
    background: 'rgba(216,242,255,0.88)',   // bright sky tint — stays light over dark video
    borderWidth: 1,
    borderColor: 'rgba(212,240,255,0.85)',
    accentColor: '#0a84ff',
    shadow: '0 26px 60px rgba(18,72,140,0.30)',   // blue shadow, never black
    opacity: 1,

    glass: {
      blur: 36,
      saturate: 175,
      borderWidth: 1,
      borderColor: 'rgba(214,241,255,0.88)',
      innerHighlight: 'inset 0 1px 0 rgba(255,255,255,0.92), inset 0 -1px 0 rgba(190,225,255,0.45)',
      sheen: 'linear-gradient(148deg, rgba(255,255,255,0.58) 0%, rgba(190,230,255,0.20) 24%, rgba(255,255,255,0) 46%, rgba(200,235,255,0.26) 100%)',
      shadow: '0 26px 60px rgba(18,72,140,0.30)',
      hairline: 'rgba(16,96,180,0.26)',       // blue hairline, never grey
      orbFill: 'radial-gradient(circle at 34% 28%, rgba(255,255,255,0.98), rgba(224,246,255,0.62) 46%, rgba(200,236,255,0.12) 72%)',
      orbBorder: 'rgba(255,255,255,0.94)'
    }
  },

  /* ---------------- Card surfaces: azure day, periwinkle night ---------------- */
  surfaces: {
    day: [
      { offset: 0, color: 'rgba(92,198,255,0.94)' },
      { offset: 52, color: 'rgba(152,222,255,0.92)' },
      { offset: 100, color: 'rgba(210,240,255,0.90)' }
    ],
    night: [
      { offset: 0, color: 'rgba(128,158,255,0.92)' },
      { offset: 52, color: 'rgba(168,190,255,0.90)' },
      { offset: 100, color: 'rgba(214,224,255,0.88)' }
    ]
  },

  /* ---------------- Header (off — the city row is the title) ---------------- */
  header: {
    visible: false,
    height: 0,
    gradient: [{ offset: 0, color: 'rgba(180,225,255,0.40)' }, { offset: 100, color: 'rgba(180,225,255,0)' }],
    gloss: false,
    text: 'WEATHER',
    fontFamily: "-apple-system, 'SF Pro Display', 'Segoe UI Variable Text', 'Segoe UI', 'Figtree', sans-serif",
    weight: 600,
    size: 30,
    color: '#0b2a5b',
    uppercase: true,
    letterSpacing: 4,
    align: 'center',
    valign: 'middle',
    shadow: 'none',
    autoShrink: true
  },

  /* ---------------- City cards ---------------- */
  card: {
    gap: 0,
    divider: { enabled: true, color: 'rgba(20,96,168,0.18)', width: 1 },

    cityBand: {
      height: 72,
      gradient: [{ offset: 0, color: 'rgba(255,255,255,0.34)' }, { offset: 100, color: 'rgba(255,255,255,0)' }],
      fontFamily: "-apple-system, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Figtree', sans-serif",
      weight: 600,
      size: 30,
      color: '#0b2a5b',        // deep indigo — never pure black
      uppercase: false,
      letterSpacing: 0.5,
      align: 'left',
      paddingX: 26,
      showCountry: true,
      showLocalTime: true,
      timeSize: 26,
      timeColor: '#0a4179',    // deep azure (5.6:1 on the slab)
      accentRule: true
    },

    body: {
      height: 0,               // computed from the panel height
      gradient: [{ offset: 0, color: 'rgba(255,255,255,0.24)' }, { offset: 100, color: 'rgba(200,235,255,0)' }],
      gloss: false,
      iconSize: 250,
      iconX: 0,
      iconGlow: true,
      /* blue shadow so a white cloud still reads on the light azure slab */
      iconShadow: '0 12px 30px rgba(12,74,150,0.42)',
      orb: true,
      temp: {
        fontFamily: "-apple-system, 'SF Pro Display', 'Segoe UI Variable Text', 'Segoe UI', 'Figtree', sans-serif",
        fontUrl: '',
        weight: 600,
        size: 160,
        color: '#0a3566',
        unit: '°',
        showUnit: true,
        letterSpacing: -6,
        lineHeight: 0.96,
        shadow: '0 6px 18px rgba(24,86,160,0.18)',
        align: 'center'
      },
      condition: {
        fontFamily: "-apple-system, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Figtree', sans-serif",
        weight: 500,
        size: 30,
        color: '#12507f',
        uppercase: false,
        letterSpacing: 0.5,
        maxLines: 2
      },
      range: {
        show: true,
        fontFamily: "-apple-system, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Figtree', sans-serif",
        weight: 500,
        size: 25,
        color: '#154c7a',
        format: 'H {h}°      L {l}°'
      }
    },

    details: {
      /* 106 (was 122): the row only needs ~56px of content, so the surplus now
         goes to the hero, which is what actually wanted the height. */
      height: 106,
      gradient: [{ offset: 0, color: 'rgba(255,255,255,0.46)' }, { offset: 100, color: 'rgba(198,234,255,0.24)' }],
      fontFamily: "-apple-system, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Figtree', sans-serif",
      weight: 500,
      size: 15,
      color: '#0b2a5b',
      uppercase: false,
      letterSpacing: 0.5,
      labelSize: 15,
      labelColor: '#124a70',   // steel-azure label (4.9:1)
      valueSize: 36,
      valueColor: '#0b2a5b',
      showLabels: true,
      fields: ['wind', 'humidity', 'feels']
    }
  },

  /* ---------------- Footer ---------------- */
  footer: {
    visible: true,
    height: 50,
    gradient: [{ offset: 0, color: 'rgba(180,225,255,0.34)' }, { offset: 100, color: 'rgba(180,225,255,0)' }],
    fontFamily: "-apple-system, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Figtree', sans-serif",
    weight: 500,
    size: 16,
    color: '#0f4c78',
    align: 'center',
    letterSpacing: 0.5,
    paddingX: 16,
    showUpdated: true,
    updatedLabel: 'Updated',
    showSource: true,
    sourceLabel: 'Open-Meteo'
  },

  /* ---------------- Cities ---------------- */
  maxCities: 2,
  cities: [
    { label: 'New York', query: 'New York', countryCode: 'US', lat: null, lon: null, enabled: true },
    { label: 'Miami', query: 'Miami', countryCode: 'US', lat: null, lon: null, enabled: true }
  ],

  /* ---------------- Units / locale ---------------- */
  units: {
    system: 'imperial',
    temperature: 'fahrenheit',
    wind: 'mph',
    locale: 'en-US',
    clock24: false
  },

  /* ---------------- Data fetching ---------------- */
  data: {
    refreshMinutes: 10,
    timeoutMs: 9000,
    retryOnFailSeconds: 60,
    showStaleAfterMinutes: 30,
    forecastDays: 1,
    useCacheOnFailure: true,
    cacheKey: 'wx-cache-v2'
  },

  /* ---------------- Fonts (Apple stack + Figtree fallback) ---------------- */
  googleFonts: ['Figtree:wght@400;500;600;700'],

  /* ---------------- Animated SVG colours (full-colour, no greys) ---------- */
  iconColors: {
    sun: '#ff9500',
    moon: '#4f5fe8',
    cloud: '#ffffff',
    cloudDark: '#6fa8e0',
    rain: '#0a5fd0',
    snow: '#ffffff',
    bolt: '#ffb300',
    fog: '#4f93c9'
  },

  /* ---------------- Animation (entrance only — OBS hides the source) ------- */
  animation: {
    autoPlay: true,
    autoPlayDelay: 0.4,
    headerDuration: 0.9,
    headerEase: 'power3.out',
    cardDuration: 1.8,
    cardEase: 'power3.out',
    cardStagger: 0.5,
    cardStart: 0.55,
    cardFrom: 'bottom',
    cardDistance: 150,
    fadeRows: true,
    ambient: true,
    tweenValues: true,
    tweenDuration: 1.4,
    loopPreview: false,
    loopHoldIn: 6,
    loopHoldOut: 2
  },

  /* ---------------- Sync ---------------- */
  sync: {
    serverConfigUrl: 'config.json',
    pollMs: 2000,
    stateUrl: 'api/state',
    statePollMs: 700
  }
};
