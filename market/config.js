/* ============================================================================
   Digital Assets Market — default configuration
   ----------------------------------------------------------------------------
   A dark trading-terminal board. Four columns (asset / price / 24h / 7d) and
   category tabs that can auto-rotate, so one panel covers the whole market
   without a scrollbar.

   Everything here can be overridden at runtime (admin panel, server
   config.json, or localStorage). Prices come from CoinGecko's free API via a
   cached server proxy — see `data` at the bottom.
   ========================================================================== */

/* Faces the control panel can switch to. The files live in fonts/ and are
   registered by fonts/fonts.css. `system` is Segoe UI, which Windows already
   has, so it ships no file. The family is quoted first in the stack: on
   Windows a later "Segoe UI" would otherwise win and the bundled file would
   never be used. Figtree stays first — it is the shipped default. */
window.CM_FONTS = [
  { id: 'figtree', name: 'Figtree', family: 'Figtree' },
  { id: 'segoe', name: 'Segoe UI', family: 'Segoe UI Variable Text', system: true },
  { id: 'albert-sans', name: 'Albert Sans', family: 'Albert Sans' },
  { id: 'archivo', name: 'Archivo', family: 'Archivo' },
  { id: 'archivo-narrow', name: 'Archivo Narrow', family: 'Archivo Narrow' },
  { id: 'atkinson-hyperlegible', name: 'Atkinson Hyperlegible', family: 'Atkinson Hyperlegible' },
  { id: 'barlow', name: 'Barlow', family: 'Barlow' },
  { id: 'barlow-condensed', name: 'Barlow Condensed', family: 'Barlow Condensed' },
  { id: 'be-vietnam-pro', name: 'Be Vietnam Pro', family: 'Be Vietnam Pro' },
  { id: 'bricolage-grotesque', name: 'Bricolage Grotesque', family: 'Bricolage Grotesque' },
  { id: 'chivo', name: 'Chivo', family: 'Chivo' },
  { id: 'commissioner', name: 'Commissioner', family: 'Commissioner' },
  { id: 'crimson-pro', name: 'Crimson Pro', family: 'Crimson Pro' },
  { id: 'dm-mono', name: 'DM Mono', family: 'DM Mono' },
  { id: 'dm-sans', name: 'DM Sans', family: 'DM Sans' },
  { id: 'exo-2', name: 'Exo 2', family: 'Exo 2' },
  { id: 'familjen-grotesk', name: 'Familjen Grotesk', family: 'Familjen Grotesk' },
  { id: 'fira-code', name: 'Fira Code', family: 'Fira Code' },
  { id: 'fira-sans', name: 'Fira Sans', family: 'Fira Sans' },
  { id: 'fraunces', name: 'Fraunces', family: 'Fraunces' },
  { id: 'gabarito', name: 'Gabarito', family: 'Gabarito' },
  { id: 'geist', name: 'Geist', family: 'Geist' },
  { id: 'geologica', name: 'Geologica', family: 'Geologica' },
  { id: 'hanken-grotesk', name: 'Hanken Grotesk', family: 'Hanken Grotesk' },
  { id: 'heebo', name: 'Heebo', family: 'Heebo' },
  { id: 'host-grotesk', name: 'Host Grotesk', family: 'Host Grotesk' },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', family: 'IBM Plex Mono' },
  { id: 'ibm-plex-sans', name: 'IBM Plex Sans', family: 'IBM Plex Sans' },
  { id: 'instrument-sans', name: 'Instrument Sans', family: 'Instrument Sans' },
  { id: 'inter', name: 'Inter', family: 'Inter' },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', family: 'JetBrains Mono' },
  { id: 'josefin-sans', name: 'Josefin Sans', family: 'Josefin Sans' },
  { id: 'karla', name: 'Karla', family: 'Karla' },
  { id: 'lexend', name: 'Lexend', family: 'Lexend' },
  { id: 'libre-franklin', name: 'Libre Franklin', family: 'Libre Franklin' },
  { id: 'literata', name: 'Literata', family: 'Literata' },
  { id: 'lora', name: 'Lora', family: 'Lora' },
  { id: 'manrope', name: 'Manrope', family: 'Manrope' },
  { id: 'merriweather', name: 'Merriweather', family: 'Merriweather' },
  { id: 'mona-sans', name: 'Mona Sans', family: 'Mona Sans' },
  { id: 'montserrat', name: 'Montserrat', family: 'Montserrat' },
  { id: 'mulish', name: 'Mulish', family: 'Mulish' },
  { id: 'newsreader', name: 'Newsreader', family: 'Newsreader' },
  { id: 'noto-sans', name: 'Noto Sans', family: 'Noto Sans' },
  { id: 'nunito', name: 'Nunito', family: 'Nunito' },
  { id: 'nunito-sans', name: 'Nunito Sans', family: 'Nunito Sans' },
  { id: 'onest', name: 'Onest', family: 'Onest' },
  { id: 'open-sans', name: 'Open Sans', family: 'Open Sans' },
  { id: 'oswald', name: 'Oswald', family: 'Oswald' },
  { id: 'outfit', name: 'Outfit', family: 'Outfit' },
  { id: 'overpass', name: 'Overpass', family: 'Overpass' },
  { id: 'playfair-display', name: 'Playfair Display', family: 'Playfair Display' },
  { id: 'plus-jakarta-sans', name: 'Plus Jakarta Sans', family: 'Plus Jakarta Sans' },
  { id: 'poppins', name: 'Poppins', family: 'Poppins' },
  { id: 'public-sans', name: 'Public Sans', family: 'Public Sans' },
  { id: 'quicksand', name: 'Quicksand', family: 'Quicksand' },
  { id: 'raleway', name: 'Raleway', family: 'Raleway' },
  { id: 'red-hat-display', name: 'Red Hat Display', family: 'Red Hat Display' },
  { id: 'reddit-sans', name: 'Reddit Sans', family: 'Reddit Sans' },
  { id: 'roboto', name: 'Roboto', family: 'Roboto' },
  { id: 'roboto-condensed', name: 'Roboto Condensed', family: 'Roboto Condensed' },
  { id: 'roboto-mono', name: 'Roboto Mono', family: 'Roboto Mono' },
  { id: 'rubik', name: 'Rubik', family: 'Rubik' },
  { id: 'schibsted-grotesk', name: 'Schibsted Grotesk', family: 'Schibsted Grotesk' },
  { id: 'sora', name: 'Sora', family: 'Sora' },
  { id: 'source-sans-3', name: 'Source Sans 3', family: 'Source Sans 3' },
  { id: 'source-serif-4', name: 'Source Serif 4', family: 'Source Serif 4' },
  { id: 'space-grotesk', name: 'Space Grotesk', family: 'Space Grotesk' },
  { id: 'teko', name: 'Teko', family: 'Teko' },
  { id: 'urbanist', name: 'Urbanist', family: 'Urbanist' },
  { id: 'work-sans', name: 'Work Sans', family: 'Work Sans' }
];

window.CM_FONT_ROLES = [
  'header.fontFamily',
  'tabs.fontFamily',
  'columns.fontFamily',
  'rows.asset.fontFamily',
  'rows.price.fontFamily',
  'rows.change.fontFamily'
];

window.CM_fontStack = function (face) {
  if (!face) return 'sans-serif';
  if (face.system) return "'Segoe UI Variable Text', 'Segoe UI', sans-serif";
  return "'" + face.family + "', 'Segoe UI Variable Text', 'Segoe UI', sans-serif";
};

/* A chosen id owns every role. An empty id leaves the per-role stacks alone,
   which is how a hand-edited family survives. */
window.CM_applyFont = function (cfg) {
  if (!cfg || !cfg.font || !cfg.font.id) return cfg;
  var aliases = { space: 'space-grotesk', plex: 'ibm-plex-sans', dm: 'dm-sans' };
  var want = aliases[cfg.font.id] || cfg.font.id;
  var face = null;
  var fonts = window.CM_FONTS || [];
  for (var i = 0; i < fonts.length; i++) {
    if (fonts[i].id === want) { face = fonts[i]; break; }
  }
  if (!face) return cfg;
  var stack = window.CM_fontStack(face);
  (window.CM_FONT_ROLES || []).forEach(function (path) {
    var parts = path.split('.');
    var o = cfg;
    for (var n = 0; n < parts.length - 1; n++) {
      if (!o[parts[n]] || typeof o[parts[n]] !== 'object') o[parts[n]] = {};
      o = o[parts[n]];
    }
    o[parts[parts.length - 1]] = stack;
  });
  return cfg;
};

var CM_FACE = window.CM_fontStack(window.CM_FONTS[0]);

window.CM_DEFAULT_CONFIG = {
  meta: { name: 'Digital Assets Market', version: '1.0.13' },

  /* Which bundled face the board is set in. The Type tab writes this; the
     per-role stacks below are derived from it. */
  font: { id: 'figtree' },

  /* ---------------- Stage (design canvas) ---------------- */
  stage: {
    width: 1920,
    height: 1080,
    fit: 'contain',            // contain | cover | width | none
    alignX: 'center',          // where the board sits on the canvas
    alignY: 'middle',
    background: 'transparent'  // transparent for OBS
  },

  /* ---------------- Panel shell ---------------- */
  panel: {
    width: 1470,                  // fills the 1920 frame (was 1110 = 58%)
    heightMode: 'fit',         // fit = sized by its content
    x: 0,                      // ignored when alignX/alignY centre it
    y: 0,
    radius: 22,
    /* Extra scale on top of the stage fit, for eyeballing size without a
       rebuild. The board is centred, so it grows from the middle. */
    zoom: 1,
    background: 'rgba(8,12,22,0.80)',   // 20% transparent
    borderWidth: 1,
    borderColor: 'rgba(96,130,180,0.28)',
    shadow: '0 30px 80px rgba(0,0,0,0.60)',
    opacity: 1,
    paddingX: 36,
    paddingTop: 30,
    paddingBottom: 24,

    glass: {
      blur: 26,
      saturate: 140,
      innerHighlight: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      sheen: 'linear-gradient(148deg, rgba(255,255,255,0.05) 0%, rgba(120,170,255,0.03) 30%, rgba(255,255,255,0) 60%)'
    }
  },

  /* ---------------- Title ---------------- */
  header: {
    visible: true,
    text: 'DIGITAL ASSETS MARKET',
    fontFamily: CM_FACE,
    weight: 700,
    size: 92,
    color: '#f2f6fc',
    uppercase: true,
    letterSpacing: -0.5,
    align: 'left',             // left | center | right
    paddingBottom: 18,
    rule: true,                // the hairline under the title
    ruleColor: 'rgba(150,178,214,0.34)',
    ruleWidth: 1,
    shadow: 'none',
    autoShrink: true
  },

  /* ---------------- Category tabs ---------------- */
  tabs: {
    visible: true,
    position: 'below-title',   // below-title | above-title | hidden
    align: 'left',
    gap: 13,
    height: 44,
    paddingX: 20,
    radius: 999,
    fontFamily: CM_FACE,
    weight: 600,
    size: 22,
    letterSpacing: 1.1,
    uppercase: true,
    color: '#8ea3c0',
    activeColor: '#06131f',
    background: 'rgba(255,255,255,0.05)',
    activeBackground: '#4cc9f0',        // chrome accent — never the up/down pair
    borderColor: 'rgba(150,178,214,0.22)',
    activeBorderColor: '#4cc9f0',
    /* 16, not 0: the title above ends in a full-width hairline (header.rule), and
       the tabs are 44px pills rounded at 999px. At margin 0 the strip starts on
       the rule's own pixel, so that line runs along the top edge of every pill
       and reads as if it is cutting through them. The rule now has the title's
       18px padding above it and this below it. */
    marginTop: 16,
    marginBottom: 20
    /* Categories are switched BY HAND only — click a tab (or use the arrow
       keys / the next & prev commands). There is deliberately no auto-rotate:
       on air you want the board to show the category YOU chose, for as long as
       you want it, rather than moving on mid-sentence. */
  },

  /* ---------------- Column headers ---------------- */
  columns: {
    visible: true,
    height: 40,
    fontFamily: CM_FACE,
    weight: 600,
    size: 19,                  // tier 3 (micro)
    color: '#9aa8bd',
    uppercase: true,
    letterSpacing: 1.2,
    rule: true,
    ruleColor: 'rgba(150,178,214,0.20)',
    /* flexible order: any of rank | asset | price | change24h | change7d */
    order: ['rank', 'asset', 'sparkline', 'price', 'change24h', 'change7d'],
    labels: {
      rank: '#',
      asset: 'ASSET',
      sparkline: '7D',
      price: 'PRICE (USD)',
      change24h: '24H CHANGE',
      change7d: '7D CHANGE'
    },
    /* column widths, left to right; `asset` absorbs the leftover space */
    widths: { asset: 470, rank: 60, sparkline: 190, price: 240, change24h: 200, change7d: 200 },
    align: { rank: 'left', sparkline: 'left', price: 'right', change24h: 'right', change7d: 'right' },
    /* the asset column takes the leftover space, but never more than this — a
       wider board then grows the trend chart instead of opening a gutter */
    assetMaxWidth: 560,
    /* When true each column grows in proportion to its configured width, so
       widening the panel spreads the content out to fill it instead of leaving
       a pool of empty space on the right. Turn it off to pin exact pixel
       widths, which is what you want when matching a fixed layout. */
    fitWidth: true
  },

  /* ---------------- Footer ---------------- */
  /* The status line under the rows: "Updated just now · CoinGecko". Turn it off
     for a clean broadcast face. Note that it is also where the board reports a
     cached response, a fetch error and a degraded (no trend data) state, so
     switching it off hides those too. */
  footer: {
    enabled: true
  },

  /* ---------------- Rows ---------------- */
  rows: {
    height: 78,
    rankSize: 26,              // the "#" column, one step below the row type
    gap: 0,
    padX: 10,                  // horizontal padding shared by the header and rows
    divider: { enabled: true, color: 'rgba(150,178,214,0.11)', width: 1 },
    zebra: false,
    zebraColor: 'rgba(255,255,255,0.018)',
    /* a soft wash behind a row the moment its price ticks */
    tickFlash: 'rgba(92,225,166,0.13)',
    tickFlashMs: 900,
    radius: 10,

    logo: {
      show: true,
      size: 58,
      radius: 'circle',        // circle | rounded
      fallbackBackground: 'rgba(255,255,255,0.08)',
      fallbackColor: '#cfe0f5'
    },

    asset: {
      fontFamily: CM_FACE,
      nameSize: 42,            // tier 2 (primary)
      nameWeight: 600,
      nameColor: '#eef4ff',
      tickerSize: 22,          // tier 3 (micro)
      tickerWeight: 600,
      tickerColor: '#9aa8bd',
      tickerLetterSpacing: 1.3,
      gap: 6,
      nameMaxChars: 19
    },

    price: {
      fontFamily: CM_FACE,
      size: 42,
      weight: 600,
      color: '#eef4ff',
      /* compact = $83.9K / $1.2M, plain = $83,968.00 */
      format: 'plain',         // plain | compact
      prefix: '$',
      decimals: 2,             // used when the price is >= 1
      /* 3 decimals below $1 (matches the reference board); below $0.01 the
         formatter switches to significant digits so nothing renders $0.000 */
      smallDecimals: 3
    },

    /* The 7d trend column. Per honest-dataviz the line is deliberately recessive
       and only the ENDPOINT carries colour, so the eye reads direction without
       the chart competing with the numbers. */
    sparkline: {
      width: 200,
      height: 42,
      strokeWidth: 2,
      strokeColor: 'rgba(160,186,214,0.55)',
      /* when true the whole line takes the semantic colour instead of grey */
      colourLine: false,
      endpointRadius: 3.4,
      fill: false,
      /* A short bright dash runs the length of the line, then rests, on a loop.
         It makes the trend column read as live rather than a static spark. The
         dash length is in viewBox units, so it scales with the chart. */
      glow: {
        enabled: true,
        color: '#7fe6ff',
        length: 30,            /* the travelling dash, viewBox units */
        width: 3.4,            /* its stroke width */
        duration: 1.5,         /* seconds to cross the line */
        rest: 2.5,             /* seconds of quiet before the next pass */
        opacity: 0.95,
        halo: 7,               /* px blur around the dash — this is the glow */
        stagger: 0.45          /* per-row offset so they do not flash together */
      }
    },

    change: {
      fontFamily: CM_FACE,
      /* tier 2 again — a 4th size (18px) was pure noise. The change column sits
         one weight below the price instead, per "pull the weights back". */
      size: 42,
      weight: 500,
      /* Direction is carried by a SIGN, not colour alone. A green/red pair is
         not separable for deuteranopia (deutan ΔE ≈ 5, safe is ≥ 8), so the
         glyph is what actually communicates polarity — tests/contrast.js
         asserts BOTH the separation and the presence of this secondary cue. */
      showArrow: false,
      showSign: true,
      decimals: 2
    }
  },

  /* ---------------- Palette ---------------- */
  colors: {
    up: '#3ddc84',             // gain
    down: '#ff5b6e',           // loss
    flat: '#8ea3c0',           // no move / no data
    rankColor: '#9aa8bd',          // muted tier — 4.55:1 over bright video
    sparkUp: '#3ddc84',
    sparkDown: '#ff5b6e'
  },

  /* ---------------- Categories ----------------
     `id` is the CoinGecko coin id, so a list is just data — no name mapping to
     maintain. Names, tickers and logos all come back from the API.

     Every id below was checked against the live /coins/markets endpoint, because
     a ticker is not an id and several tickers are ambiguous on CoinGecko: LIT is
     `lighter` (not litentry), ARX is `arcium` (not arcs), PUMP is `pump-fun`, and
     Phala's id is `pha`. A wrong id renders a permanently empty row.
     NEAR appears under both PRIVACY and AI on purpose — the fetch de-dupes. */
  categories: [
    {
      id: 'privacy',
      label: 'PRIVACY',
      coins: ['zcash', 'near', 'zama', 'monero', 'arcium', 'dash']
    },
    {
      id: 'revenue',
      label: 'REVENUE',
      coins: ['hyperliquid', 'lighter', 'pump-fun', 'aerodrome-finance',
              'derive', 'arbitrum', 'ether-fi']
    },
    {
      id: 'ai',
      label: 'AI',
      coins: ['near', 'akash-network', 'pha', 'bittensor']
    },
    {
      id: 'dino',
      label: 'DINO COINS',
      coins: ['litecoin', 'ripple', 'stellar', 'bitcoin-cash', 'dogecoin']
    },
    {
      id: 'defi',
      label: 'DEFI',
      coins: ['ethereum', 'chainlink', 'sky', 'syrup', 'uniswap', 'aave', 'morpho']
    }
  ],

  /* how many rows a category shows before it is cut off */
  maxRows: 11,

  /* ---------------- Data ---------------- */
  data: {
    /* The overlay asks our own server first (/api/market). The server caches the
       upstream response, so ten OBS sources still cost one CoinGecko call — the
       free tier is rate-limited hard enough that this matters. If the proxy is
       missing (opened straight from disk) the overlay falls back to CoinGecko
       directly, and then to the last good response in localStorage. */
    proxyUrl: 'api/market',
    directUrl: 'https://api.coingecko.com/api/v3/coins/markets',
    currency: 'usd',
    sparkline: true,           // 7d series for the trend column — same request
    refreshSeconds: 120,
    timeoutMs: 12000,
    retryOnFailSeconds: 45,
    showStaleAfterSeconds: 600,
    useCacheOnFailure: true,
    cacheKey: 'cm-cache-v1'
  },

  /* ---------------- Fonts ----------------
     The face itself is `font.id` above, drawn from the files in fonts/.
     Figtree ships with the board. Segoe UI is the fallback already installed
     on Windows if a file fails to decode. Nothing is requested from a CDN. */

  /* ---------------- Animation (GSAP) ----------------
     Entrance plays once (OBS hides the source rather than animating out). Tab
     changes and price ticks animate every time. */
  animation: {
    autoPlay: true,
    autoPlayDelay: 0.25,

    /* entrance */
    headerDuration: 0.7,
    headerEase: 'power3.out',  // entrance = ease-out
    headerFrom: 26,
    tabsDuration: 0.6,
    rowDuration: 0.6,          // dramatic reveal band (600-1200ms)
    rowEase: 'power3.out',
    rowStagger: 0.06,
    rowStart: 0.26,
    rowFrom: 20,               // "slide up 20px + fade"
    fadeRows: true,
    sparklineDraw: 0.9,        // stroke-draw for the 7d trend line

    /* tab switching — the skill's Tab Switch recipe at 0 / 100 / 150ms */
    tabSwitch: true,
    pillDuration: 0.25,        // indicator slides, ease-in-out
    tabOutDuration: 0.15,      // old content fades, ease-in
    tabSwitchDuration: 0.2,    // new content in, ease-out
    tabSwitchStagger: 0.04,
    tabEase: 'power2.inOut',
    tabInEase: 'power2.out',

    /* live values */
    tweenValues: true,
    tweenDuration: 0.9,
    tweenEase: 'power2.out',
    flashOnTick: true
  },

  /* ---------------- Sync / control server ----------------
     The board is served by the shared hub (Overlays/server.js). That process
     caches the CoinGecko call so every browser source shares one upstream
     request, stores config.json, and exposes the command API the board polls —
     the same contract weather and topics use. */
  sync: {
    serverConfigUrl: 'config.json',   // GET endpoint polled by the overlay
    pollMs: 2000,
    stateUrl: 'api/state',            // GET endpoint polled for commands
    statePollMs: 700
  }
};
