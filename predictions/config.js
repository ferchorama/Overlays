/* ============================================================================
   Prediction Markets — default configuration
   ----------------------------------------------------------------------------
   Everything in this file can be overridden at runtime (control panel, server
   config.json, or localStorage). Values here are the factory defaults and mirror
   the reference board at rollup-prediction-markets.vercel.app: a dark graphite
   stage, a serif headline, one hero market and a ranked list of the rest.

   The board is MANUALLY driven. There is no upstream provider and no API key:
   `markets.items` is typed by hand in the control panel, which is the whole
   point — odds, volumes and movement are editorial judgements, not a feed.
   ========================================================================== */

/* The reference look, and the only shipped theme: a near-black stage, off-white
   ink and a muted grey for labels. Kept as a named palette so the control panel
   can offer it as a one-click reset. */
window.PM_PALETTES = {
  graphite: {
    stage: '#0f1013',
    ink: '#f4f4f6',
    inkSoft: '#e8e9ec',
    dim: '#7d828c',
    dimmer: '#5d626b',
    line: '#2a2d33',
    lineSoft: '#22252b',
    up: '#4cc38a',
    down: '#e5605e',
    flat: '#9a9fa9'
  }
};

window.PM_DEFAULT_CONFIG = {
  meta: {
    name: 'Prediction Markets',
    version: '1.3.0'
  },

  /* ---------------- Design stage ----------------
     The overlay designs on a fixed 1920x1080 canvas and scales it to whatever
     size the OBS browser source is, so a 1280x720 source still lines up. */
  stage: {
    width: 1920,
    height: 1080,
    fit: 'contain',            /* contain | cover | width | none */
    alignX: 'left',            /* left | center | right */
    background: '#0f1013'
  },

  /* ---------------- Header ---------------- */
  header: {
    visible: true,
    logo: {
      enabled: true,
      src: 'assets/rollup-logo.png',   /* relative to this app, so the hub prefix works */
      height: 80,
      alt: 'The Rollup'
    },
    rule: true,                 /* the thin vertical divider beside the logo */
    kicker: {
      text: 'Live from New York',
      size: 17,
      color: '#9a9fa9',
      tracking: 0.32,           /* em */
      uppercase: true
    },
    title: {
      text: 'Prediction Markets',
      fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif",
      weight: 600,
      size: 58,
      color: '#f4f4f6',
      tracking: 0,
      uppercase: false
    },
    right: {
      text: 'Top markets',
      sub: 'by 7-day volume',
      size: 19,
      color: '#c9ccd3',
      subColor: '#7d828c',
      tracking: 0.28,
      uppercase: true,
      align: 'right'
    },
    /* Optional washed-out image band behind the header, as on the reference.
       Empty = nothing drawn. Any URL works; a NYC skyline ships as the example. */
    banner: {
      enabled: false,
      src: 'assets/nyc-banner.jpg',
      opacity: 0.2,
      grayscale: true,
      height: 200
    }
  },

  /* ---------------- Main: hero + list ---------------- */
  layout: {
    /* the hero column is a fixed width, the list takes what is left */
    heroWidth: 1040,
    gap: 48,
    safe: 54,                  /* inset from the stage edge, top/bottom */
    safeX: 96,                 /* inset left/right */
    heroPadTop: 40,
    heroPadRight: 64,
    listPadTop: 20,
    listPadLeft: 48
  },

  hero: {
    /* 'volume' = the biggest 7-day volume takes the hero; 'first' = item order */
    mode: 'volume',            /* volume | first | index */
    index: 0,                  /* used when mode = 'index' */
    showEyebrow: true,
    eyebrowLabel: '#1 by volume',
    showEyebrowVolume: true,
    topicSize: 52,
    topicMaxLines: 2,
    showProbability: true,
    probabilitySize: 176,
    probabilitySuffix: '%',
    showStats: true,
    showHistory: true,         /* the probability line under the figures */
    /* The 7-day line only makes sense for a traded asset. When the topic is not
       about one — a rate decision, an election, a policy question — the graphic is
       withheld rather than inventing a price history for it. Matching is a plain
       case-insensitive keyword test against the topic and category. */
    showWhenNotAsset: false,   /* true = always draw it, whatever the topic */
    assetKeywords: [
      'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'xrp', 'ripple',
      'bnb', 'binance', 'cardano', 'ada', 'avalanche', 'avax', 'dogecoin', 'doge',
      'chainlink', 'link', 'polkadot', 'dot', 'polygon', 'matic', 'arbitrum', 'arb',
      'optimism', 'op', 'base', 'sui', 'aptos', 'ton', 'hyperliquid', 'hype',
      'uniswap', 'uni', 'aave', 'maker', 'mkr', 'pendle', 'morpho', 'aerodrome',
      'crypto', 'token', 'coin', 'altcoin', 'stablecoin', 'usdc', 'usdt', 'defi',
      'etf', 'price', 'market cap', 'dominance', 'halving', 'staking', 'yield',
      'nasdaq', 's&p', 'sp500', 'gold', 'silver', 'oil', 'treasury', 'equity'
    ],
    historyHeight: 64,
    historyLabel: '7-day probability',
    /* auto | asset | manual | flat
       'asset' plots the real 7-day price series for `markets[].asset`; the other
       modes draw a probability walk. Manual keeps a half-typed series working. */
    historyMode: 'asset',
    historyLabelAsset: '7-day price',
    historyPoints: 24,
    historyVolatility: 0.22,   /* 0.05 calm … 0.6 wild — how much auto wobbles */
    /* A short bright dash runs the length of the 7-day line, then rests, on a
       loop — the same travelling glow the Digital Assets board puts on its 7-day
       trend column, so the two overlays animate the same way. Length is in viewBox
       units (the chart is 1000 wide, so 150 is ~15% of the line), which means it
       scales with the chart instead of needing a new value at each width. */
    chartGlow: {
      enabled: true,
      color: '#7fe6ff',
      length: 150,          /* the travelling dash, viewBox units */
      width: 3.4,           /* its stroke width */
      duration: 3.0,        /* seconds to cross the line */
      rest: 2.5,            /* seconds of quiet before the next pass */
      opacity: 0.95,
      halo: 8               /* px blur around the dash — this is the glow */
    },
    showVolume: true,
    showChange: true,
    showCategory: true,
    showEnds: true
  },

  list: {
    maxRows: 6,
    rowHeight: 124,
    showRank: true,
    showProbability: true,
    showChange: true,
    showVolume: true,
    /* a row can carry its own thumbnail like the reference's logo slot; off by
       default because most editorial topics have no image */
    showThumb: false,
    thumbSize: 44,
    changeColors: true,
    /* click (or Enter on a focused row) makes that market the hero — the manual
       way to change topic from a screen the operator can reach.
       clickOpensDetail: true = the hero opens ACROSS THE WHOLE BOARD (both
       columns, with a Back button to return to the list). false = the row only
       swaps the hero in the left column and the list stays put. */
    clickToSwitch: true,
    clickOpensDetail: true
  },

  /* ---------------- Footer ---------------- */
  footer: {
    visible: true,
    /* No progress bar. Switching topics is manual, so a bar that filled on a
       timer would advertise an auto-advance that does not exist. */
    progress: false,
    left: {
      text: 'Live',
      /* No venue is named. These odds are typed by the operator, so naming a
         prediction market here would claim a provenance the overlay does
         not have. Empty renders just "LIVE". */
      source: '',
      showDot: true,
      dotColor: '#4cc38a'
    },
    right: {
      text: 'Not financial advice'
    },
    size: 16,
    tracking: 0.24,
    color: '#7d828c',
    uppercase: true
  },

  /* ---------------- Palette ----------------
     Any value above may reference these with palette(ink) / palette(up) etc.
     Editing one swatch here re-themes the whole board. */
  palette: {
    name: 'graphite',
    stage: '#0f1013',
    ink: '#f4f4f6',
    inkSoft: '#e8e9ec',
    dim: '#7d828c',
    dimmer: '#5d626b',
    line: '#2a2d33',
    lineSoft: '#22252b',
    up: '#4cc38a',
    down: '#e5605e',
    flat: '#9a9fa9'
  },

  /* ---------------- Markets (the operator's content) ----------------
     Add, edit, reorder and enable these in the control panel. Each one is a
     single question with a probability. Everything is optional except `topic`. */
  markets: {
    items: [
      {
        topic: 'Will Ethereum trade above $3,000 this quarter?',
        /* Optional CoinGecko asset id. When set and the history mode is 'asset',
           the 7-day line plots this asset's REAL price series from the assets
           board's own data feed instead of a synthesised probability walk. */
        asset: 'ethereum',
        probability: 68,
        volume: 4820000,
        change: 4.2,
        category: 'Crypto',
        ends: '2026-12-31',
        enabled: true
      },
      {
        topic: 'Will the Fed cut rates at the December meeting?',
        probability: 74,
        volume: 3960000,
        change: 1.8,
        category: 'Macro',
        ends: '2026-12-10',
        enabled: true
      },
      {
        topic: 'Will a spot Solana ETF trade in the US this year?',
        asset: 'solana',
        probability: 41,
        volume: 2710000,
        change: -6.1,
        category: 'Crypto',
        ends: '2026-12-31',
        enabled: true
      },
      {
        topic: 'Will Arbitrum retake $1.00 this year?',
        asset: 'arbitrum',
        probability: 33,
        volume: 1840000,
        change: 2.4,
        category: 'Infra',
        ends: '2027-06-30',
        enabled: true
      },
      {
        topic: 'Will the S&P 500 finish the year above 7,000?',
        probability: 57,
        volume: 1520000,
        change: 0.6,
        category: 'Markets',
        ends: '2026-12-31',
        enabled: true
      },
      {
        topic: 'Will Bitcoin hold above $75,000 through March?',
        asset: 'bitcoin',
        probability: 29,
        volume: 1180000,
        change: -3.3,
        category: 'Crypto',
        ends: '2027-03-31',
        enabled: true
      },
      {
        topic: 'Will a US state adopt Bitcoin as a reserve asset?',
        probability: 22,
        volume: 940000,
        change: 5.7,
        category: 'Policy',
        ends: '2027-01-31',
        enabled: false
      },
      {
        topic: 'Will AI agents control more than 5% of on-chain volume?',
        probability: 18,
        volume: 610000,
        change: 1.1,
        category: 'AI',
        ends: '2027-06-30',
        enabled: false
      }
    ],
    /* ordering applied to the enabled list before anything else */
    sort: 'volume'             /* manual | volume | probability | change | topic */
  },

  /* ---------------- Headline source ----------------
     'manual'     — the hand-typed board above is what goes on air (default).
     'polymarket' — the board renders the fetched top headlines, grouped by
                    category. Nothing is fetched unless the operator presses
                    Update in the control panel, because this overlay must never
                    change on air under the operator. */
  source: 'manual',

  /* ---------------- Polymarket headlines ----------------
     The board NEVER talks to Polymarket itself. The control panel asks the
     shared hub, which caches and retries, and writes the result into this
     config; the overlay just renders what it is given. That keeps one process
     holding the upstream credentials-free connection, and keeps the overlay
     free of any network path that could fire on a timer.

     The `items` arrays below are the FETCHED BOARD, not something you type.
     They are replaced wholesale on every Update. `selection` is yours and
     survives an update only for ids that are still in the new top 5. */
  polymarket: {
    /* Hub path. Relative, so the /predictions/ prefix works on the hub. */
    endpoint: 'api/polymarket',

    /* 'events' is the headline entity: one event = one headline question, and it
       carries its own markets. 'markets' fetches the sub-questions directly.
       The Gamma API documents different sort-key spellings for the two, so the
       hub picks the right one — see sortKey to override by hand. */
    entity: 'events',          /* events | markets */

    /* How many entries to pull per category. 5 = "the best 5", which is what
       the panel shows to choose from. */
    fetched: 5,

    /* '' = let the hub derive the sort key from `entity`
       (events → volume_24hr, markets → volume24hr). Set it if the upstream ever
       rejects the derived spelling; it is sent verbatim. */
    sortKey: '',

    /* One entry per on-screen category, in rendering order.
         tagId    — the Gamma tag id. Empty means "resolve from tagSlug on the
                    next Update" (the panel does it via the hub's /tags proxy).
         tagSlug  — used to find the id, and as the filter when tagId is absent.
         count    — how many headlines to render for this category (1..fetched).
         selection— item ids to render from. Empty = take the first `count`.
         items    — the fetched top N. Written by Update, never by hand. */
    categories: [
      { id: 'crypto',  label: 'Crypto',  tagId: '', tagSlug: 'crypto',  count: 3, selection: [], items: [], error: '' },
      { id: 'economy', label: 'Economy', tagId: '', tagSlug: 'economy', count: 3, selection: [], items: [], error: '' },
      { id: 'finance', label: 'Finance', tagId: '', tagSlug: 'finance', count: 3, selection: [], items: [], error: '' }
    ],

    updatedAt: 0,              /* ms of the last successful Update */
    lastError: ''              /* the last failure, verbatim, for the panel */
  },

  /* ---------------- Motion ----------------
     Entrance only. This overlay is built for OBS: it animates IN and then stays
     on screen until the browser source is hidden. */
  animation: {
    autoPlay: true,
    autoPlayDelay: 0.2,
    fadeDuration: 0.7,
    fadeDistance: 8,
    stagger: 0.06,
    rowDuration: 0.5,
    rowEase: 'power2.out',
    loopPreview: false,
    loopHoldIn: 6,
    loopHoldOut: 1
  },

  /* Auto-advance the hero through the markets so a long show keeps moving.
     0 = off (the hero stays on the top market). */
  rotate: {
    enabled: false,
    ms: 12000,
    pauseOnCommand: true
  },

  /* ---------------- Asset data ----------------
     Real price series for the 7-day graphic. The default points at the assets
     board's own cached proxy on the shared hub: one server-side CoinGecko call
     serves every overlay, which matters because the free tier rate-limits hard
     (measured: 10 of 12 rapid calls returned 429). */
  data: {
    proxyUrl: '/market/api/market',
    /* Used by the dashboard's Fetch button when the hub proxy is not reachable
       (e.g. the panel opened straight from disk). CoinGecko's free tier is
       rate-limited, so this is only ever hit on an explicit click, never on a
       timer. */
    directUrl: 'https://api.coingecko.com/api/v3/coins/markets',
    currency: 'usd',
    refreshSeconds: 300,
    enabled: true
  },

  /* ---------------- Data / sync ---------------- */
  sync: {
    serverConfigUrl: 'config.json',
    pollMs: 1500,
    stateUrl: 'api/state',
    statePollMs: 700,
    useLocalStorage: true
  },

  /* ---------------- Fonts ---------------- */
  googleFonts: [
    'Playfair+Display:wght@500;600;700',
    'Inter:wght@400;500;600;700',
    'IBM+Plex+Mono:wght@500'
  ],
  fontUrls: []
};
