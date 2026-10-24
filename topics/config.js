/* ============================================================================
   Talking Points Panel — default configuration
   ----------------------------------------------------------------------------
   Everything in this file can be overridden at runtime (admin panel, server
   config.json, or localStorage). Values here are the fallback / factory
   defaults and mirror the "Rollup Sky Glass" look — the same light azure glass
   as the Vertical Weather widget: no greys, no blacks anywhere.
   ========================================================================== */

/* Dark is a curated palette merged over whatever config.json holds, so the
   light design stays the thing the admin edits. Selected by `theme`, or forced
   for a single browser source with ?theme=dark on its URL. */
window.TP_DARK_PALETTE = {
  /* Neutral greys — r = g = b throughout, so the panel reads charcoal rather
     than navy. Text sits a step lighter than the surface it lands on. */
  panel: {
    background: 'rgba(26,26,26,0.88)',
    borderColor: 'rgba(255,255,255,0.14)',
    accentColor: '#cfcfcf',
    shadow: '0 26px 60px rgba(0,0,0,0.55)',
    glow: 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(255,255,255,0.05)',
    sheen: 'linear-gradient(148deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 24%, rgba(255,255,255,0) 46%, rgba(255,255,255,0.05) 100%)'
  },
  header: {
    gradient: [
      { offset: 0, color: 'rgba(72,72,72,0.94)' },
      { offset: 100, color: 'rgba(52,52,52,0.92)' }
    ],
    title: { color: '#f2f2f2' }
  },
  subtitle: {
    gradient: [
      { offset: 0, color: 'rgba(48,48,48,0.92)' },
      { offset: 100, color: 'rgba(38,38,38,0.90)' }
    ],
    color: '#c4c4c4'
  },
  topics: {
    gradient: [
      { offset: 0, color: 'rgba(46,46,46,0.92)' },
      { offset: 24, color: 'rgba(40,40,40,0.91)' },
      { offset: 74, color: 'rgba(32,32,32,0.90)' },
      { offset: 100, color: 'rgba(25,25,25,0.89)' }
    ],
    separator: { color: 'rgba(255,255,255,0.16)' },
    text: { color: '#ededed' }
  }
};

window.TP_DEFAULT_CONFIG = {
  /* 'light' | 'dark' — see TP_DARK_PALETTE above */
  theme: 'light',
  meta: {
    name: 'Talking Points Panel',
    version: '1.1.4'
  },

  /* ---------------- Stage (design canvas) ---------------- */
  stage: {
    width: 1920,
    height: 1080,
    fit: 'contain',            // contain | cover | width | none
    alignX: 'left',            // left | center | right   (where the panel sits)
    background: 'transparent'  // transparent for OBS
  },

  /* ---------------- Panel shell ---------------- */
  panel: {
    x: 38,                     // px inside the 1920x1080 stage
    y: 178,
    width: 538,
    verticalAnchor: 'top',     // top | middle | bottom  (how y is interpreted)
    radius: 34,
    background: 'rgba(216,242,255,0.88)',      // bright sky tint — stays light over dark video
    borderWidth: 1,
    borderColor: 'rgba(212,240,255,0.85)',
    shadow: '0 26px 60px rgba(18,72,140,0.30)', // blue shadow, never black
    glow: 'inset 0 1px 0 rgba(255,255,255,0.92), inset 0 -1px 0 rgba(190,225,255,0.45)',
    accentColor: '#0a84ff',                     // thin iOS-blue edge, as on the weather slab
    blur: 36,
    saturate: 175,
    sheen: 'linear-gradient(148deg, rgba(255,255,255,0.58) 0%, rgba(190,230,255,0.20) 24%, rgba(255,255,255,0) 46%, rgba(200,235,255,0.26) 100%)',
    opacity: 1,
    autoFitHeight: true        // shrink row height if the panel is taller than the stage
  },

  /* ---------------- Title band ---------------- */
  header: {
    visible: true,
    height: 65,
    gradient: [
      { offset: 0, color: 'rgba(74,190,255,0.96)' },
      { offset: 100, color: 'rgba(126,214,255,0.92)' }
    ],
    gloss: true,
    title: {
      text: "TODAY'S TOPICS",
      fontFamily: "'Montserrat', 'Figtree', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
      weight: 700,
      size: 40,
      color: '#06294f',        // deep navy ink on azure (7.1:1)
      uppercase: true,
      letterSpacing: 0,
      lineHeight: 1.05,
      align: 'center',         // left | center | right
      valign: 'bottom',        // top | middle | bottom
      paddingX: 12,
      paddingY: 0,
      shadow: 'none',
      autoShrink: true
    }
  },

  /* ---------------- Subtitle band ---------------- */
  subtitle: {
    visible: true,
    height: 111,
    gradient: [
      { offset: 0, color: 'rgba(158,224,255,0.94)' },
      { offset: 100, color: 'rgba(206,240,255,0.90)' }
    ],
    gloss: false,
    text: '09/23/26',
    autoDate: false,           // if true the text is generated from the date below
    dateFormat: 'MM/DD/YY',    // MM/DD/YY | DD/MM/YY | MM/DD/YYYY | DD MMM YYYY | YYYY-MM-DD
    fontFamily: "'Montserrat', 'Figtree', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    weight: 600,
    size: 40,
    color: '#0a3a72',        // deep azure (7.8:1)
    uppercase: false,
    letterSpacing: 0,
    lineHeight: 1.1,
    align: 'center',
    valign: 'middle',
    paddingX: 12,
    paddingY: 0,
    shadow: 'none',
    autoShrink: true
  },

  /* ---------------- Topic rows ---------------- */
  topics: {
    maxRows: 8,
    rowHeight: 105,
    gap: 0,
    gradient: [
      { offset: 0, color: 'rgba(124,208,255,0.92)' },
      { offset: 24, color: 'rgba(160,224,255,0.90)' },
      { offset: 74, color: 'rgba(196,236,255,0.88)' },
      { offset: 100, color: 'rgba(214,242,255,0.86)' }
    ],
    gloss: false,
    separator: { enabled: true, height: 1, color: 'rgba(255,255,255,0.55)' },
    text: {
      fontFamily: "'Proxima Nova', 'ProximaNovaA', 'Figtree', 'Montserrat', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
      fontUrl: 'https://account-fonts.singular.live/a493e8c7-b53c-4d9f-91c0-ecdbdd3c5f98/ProximaNovaA.css',
      weight: 600,
      size: 40,
      color: '#0b2a5b',        // deep indigo — never pure black
      uppercase: false,
      letterSpacing: 0,
      lineHeight: 1.12,
      align: 'center',
      paddingX: 14,
      maxLines: 2,
      autoShrink: true,
      minSize: 18,
      shadow: '0 2px 6px rgba(24,86,160,0.16)'
    },
    items: [
      { text: 'Welcome to The Rollup', enabled: true },
      { text: 'Market and Weather Live From FL', enabled: true },
      { text: 'WSJ Highlights Kalshi Trading Patterns', enabled: true },
      { text: 'Daily Equity', enabled: true },
      { text: 'Topic Five', enabled: false },
      { text: 'Topic Six', enabled: false },
      { text: 'Topic Seven', enabled: false },
      { text: 'Topic Eight', enabled: false }
    ]
  },

  /* ---------------- Fonts loaded from Google Fonts ---------------- */
  googleFonts: ['Montserrat:wght@300;400;500;600;700;800', 'Figtree:wght@300;400;500;600;700;800'],

  /* ---------------- Animation (entrance only) ----------------
     This overlay is made for OBS: there is deliberately NO exit animation.
     You animate the panel IN, it then stays on screen until the browser
     source is hidden / the panel is taken off air.                        */
  animation: {
    autoPlay: true,            // play the entrance automatically when the page loads
    autoPlayDelay: 0.2,
    headerDuration: 0.5,
    headerEase: 'power1.out',
    textDuration: 0.35,
    textEase: 'power1.out',
    rowDuration: 1.0,
    rowEase: 'power3.out',
    rowStagger: 0.1,
    rowStart: 0.3,
    rowFrom: 'top',            // top | bottom | left | right  (entry direction)
    rowDistance: 105,          // px of travel
    fadeRows: true,
    loopPreview: false,        // preview window only: replay the entrance on a loop
    loopHoldIn: 4,
    loopHoldOut: 1.5
  },

  /* ---------------- Data / sync ---------------- */
  sync: {
    serverConfigUrl: 'config.json',   // GET endpoint polled by the overlay
    pollMs: 1500,
    stateUrl: 'api/state',            // GET endpoint polled for commands
    statePollMs: 700,
    useLocalStorage: true             // share config with the admin panel on the same origin
  }
};
