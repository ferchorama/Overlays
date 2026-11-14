/* ============================================================================
   X Posts — shipped defaults
   ----------------------------------------------------------------------------
   One post on air per frame, cycled by hand. Everything an operator can change
   from the panel lives here first, so a fresh clone renders without a saved
   config.
   ========================================================================== */
/* Corporate typefaces offered in the panel. Every one is loaded up front in
   index.html; the browser only downloads the face that is actually used, so
   switching in the panel is instant and survives a reload because the choice
   lives in config.json. */
window.XP_FONTS = [
  { id: 'neue-haas',   label: 'Neue Haas Grotesk (house)', stack: "'neue-haas-grotesk-display', 'neue-haas-grotesk-text', 'Inter', sans-serif" },
  { id: 'inter',       label: 'Inter',            stack: "'Inter', system-ui, sans-serif" },
  { id: 'plex',        label: 'IBM Plex Sans',    stack: "'IBM Plex Sans', system-ui, sans-serif" },
  { id: 'source-sans', label: 'Source Sans 3',    stack: "'Source Sans 3', system-ui, sans-serif" },
  { id: 'work-sans',   label: 'Work Sans',        stack: "'Work Sans', system-ui, sans-serif" },
  { id: 'manrope',     label: 'Manrope',          stack: "'Manrope', system-ui, sans-serif" },
  { id: 'archivo',     label: 'Archivo',          stack: "'Archivo', system-ui, sans-serif" },
  { id: 'franklin',    label: 'Libre Franklin',   stack: "'Libre Franklin', system-ui, sans-serif" },
  { id: 'public',      label: 'Public Sans',      stack: "'Public Sans', system-ui, sans-serif" },
  { id: 'dm-sans',     label: 'DM Sans',          stack: "'DM Sans', system-ui, sans-serif" },
  { id: 'figtree',     label: 'Figtree',          stack: "'Figtree', system-ui, sans-serif" },
  { id: 'instrument',  label: 'Instrument Sans',  stack: "'Instrument Sans', system-ui, sans-serif" },
  { id: 'roboto',      label: 'Roboto',           stack: "'Roboto', system-ui, sans-serif" },
  { id: 'open-sans',   label: 'Open Sans',        stack: "'Open Sans', system-ui, sans-serif" },
  { id: 'lato',        label: 'Lato',             stack: "'Lato', system-ui, sans-serif" }
];

window.XP_DEFAULT_CONFIG = {
  meta: { version: '1.0.0' },

  stage: {
    width: 1920,
    height: 1080,
    background: '#0b0b0c'
  },

  /* Headline and body typefaces, by id from XP_FONTS. */
  type: {
    display: 'neue-haas',
    text: 'neue-haas'
  },

  /* Same drifting plate and tint as the prediction board. `image` is a path
     relative to this app (or an absolute one if it contains a slash). */
  backdrop: {
    enabled: true,
    image: 'backdrops/rain.webp',
    opacity: 0.95,
    blur: 0,
    panSeconds: 25,
    tint: 'rgba(8, 8, 9, 0.80)'
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
    /* With the queue off the frame belongs to one post: the copy is set large
       and only steps down when the images need the room. */
    textSize: 66,
    minTextSize: 40,
    maxTextHeight: 760,
    showMetrics: true,
    showMedia: true,
    mediaMaxHeight: 560
  },

  /* Clicking any image opens it across the whole frame — the overlay is captured
     at 1080p but streamed inside a smaller box, so an image has to be able to
     take the screen on demand. Always on, never a preference. */
  imageZoom: {
    backdrop: 0.975
  },

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
