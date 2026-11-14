/* ============================================================================
   X Posts — shipped defaults
   ----------------------------------------------------------------------------
   The board shows one post on air and the next few queued below it. Everything
   an operator can change from the panel lives here first, so a fresh clone
   renders without a saved config.
   ========================================================================== */
window.XP_DEFAULT_CONFIG = {
  meta: { version: '1.0.0' },

  stage: {
    width: 1920,
    height: 1080,
    background: '#0b0b0c'
  },

  header: {
    visible: true,
    logo: { enabled: true, src: 'assets/rollup-logo.png', height: 80 },
    rule: true,
    kicker: { text: 'Live from New York', size: 22, tracking: 0.18, uppercase: true },
    title: { text: 'X Posts', size: 62, weight: 700, tracking: -0.02 },
    right: { text: 'In the feed', sub: '', size: 22, tracking: 0.14, uppercase: true }
  },

  hero: {
    /* the hero post's body copy is fitted to the space it has */
    textSize: 52,
    minTextSize: 30,
    maxTextHeight: 520,
    showMetrics: true,
    showMedia: true,
    /* a single image is capped so a tall screenshot cannot swallow the queue */
    mediaMaxHeight: 430
  },

  queue: {
    visible: true,
    rows: 3,                 /* how many upcoming posts to list under the hero */
    showMetrics: true
  },

  nav: { visible: true },

  animation: {
    wipeMs: 480,
    rowMs: 360,
    stagger: 0.045
  },

  palette: {
    stage: '#0b0b0c',
    ink: '#f8f3e8',
    inkSoft: '#eee6d6',
    dim: '#c2b9a6',
    dimmer: '#a9a08d',
    line: '#38332a',
    lineSoft: '#262119',
    brass: '#d8b45f',
    link: '#7fcf9b'
  },

  /* pasted posts, newest addition last */
  posts: {
    items: [],
    updatedAt: 0
  }
};
