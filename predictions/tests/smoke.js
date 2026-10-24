#!/usr/bin/env node
/* ============================================================================
   Prediction Markets — smoke test
   Runs the real config.js + config-merge.js + script.js in a tiny DOM shim and
   asserts what the board actually builds. No browser needed.

     node tests/smoke.js

   Covers the things that would embarrass you on air:
     • every enabled market renders, disabled ones never do
     • the hero is the top-volume market and its number/volume are formatted
     • the list is capped at list.maxRows and marks the hero row
     • the entrance animates through GSAP
     • CHANGING TOPIC IS MANUAL — next()/prev() step it, and nothing on a timer
       ever moves the board on its own (the rotate default must stay off)
     • a topic change animates out then in rather than cutting
   ========================================================================== */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ DOM shim */
function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    children: [],
    dataset: {},
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    textContent: '',
    clientWidth: 420,
    clientHeight: 120,
    scrollWidth: 200,
    scrollHeight: 40,
    offsetHeight: 100,
    offsetWidth: 100,
    firstChild: null,
    _html: '',
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : !!force;
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      }
    },
    appendChild(child) { this.children.push(child); this.firstChild = this.children[0]; return child; },
    append(...c) { c.forEach((x) => this.appendChild(x)); },
    _ls: {},
    addEventListener(type, fn) { (this._ls[type] = this._ls[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type, ev) {
      ev = ev || {};
      if (!ev.preventDefault) ev.preventDefault = function () {};
      (this._ls[type] || []).forEach((fn) => fn(ev));
    },
    /* A real SVGElement reflects the class attribute onto .className; without
       that the shim cannot find SVG nodes by class and every chart assertion
       silently sees an empty list. */
    setAttribute(k, v) { this[k] = v; if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getTotalLength() { return 100; },
    getBoundingClientRect() { return { width: 1920, height: 1080, left: 0, top: 0 }; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; this.firstChild = v ? { nodeType: 1 } : null; }
  };
  return node;
}

const ids = {};
const getEl = (id) => (ids[id] || (ids[id] = Object.assign(makeNode('div'), { id })));

const documentShim = {
  readyState: 'complete',
  head: makeNode('head'),
  body: makeNode('body'),
  documentElement: makeNode('html'),
  createElement: makeNode,
  createElementNS: (ns, tag) => makeNode(tag),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
  getElementById: getEl,
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  fonts: { ready: Promise.resolve() }
};

/* ------------------------------------------------------------------ globals */
const store = {};
global.window = global;
global.document = documentShim;
global.location = { search: '?nosync=1', href: 'http://localhost/', protocol: 'http:', hash: '' };
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.innerWidth = 1920;
global.innerHeight = 1080;
global.addEventListener = () => {};
global.getComputedStyle = () => ({ lineHeight: '20px' });
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
global.URLSearchParams = global.URLSearchParams || require('url').URLSearchParams;
global.document.createElementNS = documentShim.createElementNS;

/* Count every timer the engine arms. Nothing here should ever advance a topic:
   switching is a manual act, so the only legitimate interval is config/state
   polling — and that is disabled by ?nosync=1. */
const timers = [];
const realSetInterval = global.setInterval;
/* a truthy id, like a real timer: the rotation tests have to be able to tell a
   running interval from a stopped one */
global.setInterval = (fn, ms) => { timers.push(ms); return timers.length; };

/* recording GSAP stub — script.js only installs its own shim when window.gsap
   is missing, so this lets the test watch the real choreography */
const gsapLog = [];
/* the vars of every tween, so a test can ask WHAT was animated, not just that some
   tween ran (a clip-path wipe and a stroke-width pulse look identical in gsapLog) */
const gsapVars = [];
function makeTl(opts) {
  /* A real timeline runs over time and then calls onComplete. The stub has to do
     the same or a hero switch can never finish, which would make the manual-topic
     assertions pass or fail for the wrong reason. */
  const tl = { _active: false, _delay: 0, _span: 0, _done: opts && opts.onComplete };
  const finish = () => { if (tl._done) { const d = tl._done; tl._done = null; d(); } };
  ['from', 'to', 'fromTo', 'set', 'progress', 'add', 'kill'].forEach((k) => {
    tl[k] = (...a) => {
      if (k === 'from' || k === 'to' || k === 'fromTo') {
        gsapLog.push(k);
        const vars = a[1] || {};
        gsapVars.push(vars);
        tl._span = Math.max(tl._span, (vars.duration || 0.3) + (vars.stagger || 0) * 4);
      }
      return tl;
    };
  });
  tl.delay = (d) => { gsapLog.push(tl._active ? 'delay:WHILE-PLAYING' : 'delay'); tl._delay = d || 0; return tl; };
  tl.duration = () => tl._span || 0.3;
  tl.play = () => {
    gsapLog.push('play');
    tl._active = true;
    global.setTimeout(finish, (tl._delay + tl._span + 0.02) * 1000);
    return tl;
  };
  tl.pause = () => { tl._active = false; return tl; };
  return tl;
}
global.gsap = {
  /* the repeat option is recorded: the chart's travelling glow is a looping
     timeline, and that is the only way the shim can see it */
  timeline: (opts) => {
    gsapLog.push(opts && opts.repeat === -1 ? 'timeline:repeat' : 'timeline');
    return makeTl(opts);
  },
  /* clearProps is what the two safety nets use to force a settled, visible hero
     without trusting a tween to finish — record it so it can be asserted */
  set: (t, v) => { gsapLog.push('set' + (v && v.clearProps ? ':clearProps' : '')); },
  from: () => { gsapLog.push('from'); },
  to: () => { gsapLog.push('to'); },
  fromTo: (...a) => { gsapLog.push('fromTo'); if (a[3] && a[3].onComplete) a[3].onComplete(); }
};

/* -------------------------------------------------------------------- boot */
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'config-merge.js'));
require(path.join(ROOT, 'script.js'));

/* ----------------------------------------------------------------- helpers */
function walk(node, pred, out) {
  out = out || [];
  if (!node) return out;
  if (pred(node)) out.push(node);
  (node.children || []).forEach((c) => walk(c, pred, out));
  return out;
}
const byClass = (root, cls) => walk(root, (n) => String(n.className).split(/\s+/).indexOf(cls) !== -1);
const textOf = (node) => walk(node, () => true).map((n) => n.textContent).filter(Boolean).join(' ');

setTimeout(async () => {
  const cfg = global.PM_DEFAULT_CONFIG;
  const stage = ids['stage'];
  const PM = global.PM;
  const board = PM.board;

  const results = [];
  const check = (name, pass, info) => results.push({ name, pass, info });
  /* A hero switch runs on a real GSAP timeline, so it lands a moment later. Wait
     for it: asserting synchronously would test the stub's scheduling, not the
     engine's behaviour. */
  /* The hero index moves immediately but the content swaps at the animation's
     handover, so DOM assertions must wait for the visible text — not just state. */
  const heroShown = (topic) => {
    const q = ids['stage'] ? byClass(ids['stage'], 'hero__topic')[0] : null;
    return !!q && q.textContent === topic;
  };
  const waitShown = (topic, ms) => waitFor(() => heroShown(topic), ms || 2500);
  const waitFor = (fn, ms) => new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      if (fn()) return res(true);
      if (Date.now() - t0 > (ms || 1500)) return res(false);
      global.setTimeout(tick, 10);
    };
    tick();
  });

  const enabled = (cfg.markets.items || []).filter((m) => m.enabled !== false && String(m.topic || '').trim());
  const topVolume = enabled.slice().sort((a, b) => b.volume - a.volume)[0];

  /* ---- rendering ---- */
  const rows = byClass(stage, 'row');
  check('a row per market up to maxRows', rows.length === Math.min(cfg.list.maxRows, enabled.length),
    rows.length + ' rows / cap ' + cfg.list.maxRows + ' / ' + enabled.length + ' enabled');
  check('disabled markets are excluded', board.markets.length === enabled.length,
    board.markets.length + ' on board / ' + enabled.length + ' enabled');
  check('disabled topic text never rendered',
    !textOf(stage).includes('US state adopt Bitcoin'),
    'looked for a disabled market');

  /* ---- hero selection ---- */
  const hero = board.heroMarket();
  check('hero is the top-volume market', hero && hero.topic === topVolume.topic,
    hero ? hero.topic.slice(0, 40) : 'none');
  check('hero probability rendered', byClass(stage, 'huge').length === 1,
    byClass(stage, 'huge').map((n) => n.textContent).join(''));
  check('hero eyebrow shows a volume', /volume/i.test(textOf(stage)), 'ok');
  const onRows = byClass(stage, 'row').filter((r) => r.classList.contains('is-on'));
  check('ranked list marks the hero row',
    onRows.length === 1 && textOf(onRows[0]).includes(hero.topic.slice(0, 24)),
    onRows.length + ' marked, hero="' + hero.topic.slice(0, 24) + '"');

  /* ---- formatting ---- */
  const hugeNode = byClass(stage, 'huge')[0];
  const hugeText = hugeNode ? textOf(hugeNode) : '';
  check('probability formatted as a percent',
    hugeText.replace(/\s/g, '').indexOf(String(Math.round(hero.probability))) === 0,
    hugeText);
  const moneyLike = walk(stage, (n) => /\$\d/.test(String(n.textContent))).length;
  check('volumes rendered as money', moneyLike > 0, moneyLike + ' money strings');

  /* ---- animation ---- */
  const froms = gsapLog.filter((c) => c === 'from').length;
  const tos = gsapLog.filter((c) => c === 'to' || c === 'fromTo').length;
  check('entrance animates with gsap (from tweens)', froms > 0, 'from=' + froms + ' to=' + tos);
  check('entrance played once', gsapLog.filter((c) => c === 'play').length === 1,
    'play() calls=' + gsapLog.filter((c) => c === 'play').length);
  check('no delay() applied mid-play', gsapLog.indexOf('delay:WHILE-PLAYING') === -1, gsapLog.join(' → ').slice(0, 60));

  /* ---- manual topic changing ---- */
  check('rotation is OFF by default', cfg.rotate.enabled === false, 'rotate.enabled=' + cfg.rotate.enabled);
  check('no interval armed while nosync + rotate off', timers.length === 0, 'timers=' + JSON.stringify(timers));

  const before = board.heroMarket().topic;
  const beforeIdx = board.heroIdx;
  gsapLog.length = 0;
  PM.next();
  /* The state changes before the animation runs and the content swaps at the
     handover, so wait for both the choreography and the visible topic. */
  await waitFor(() => gsapLog.indexOf('from') > gsapLog.indexOf('to') && gsapLog.indexOf('to') !== -1);
  await waitFor(() => board.heroIdx !== beforeIdx);
  await waitShown(board.heroMarket().topic);
  const after = board.heroMarket().topic;
  check('next() moves the hero to another topic', after !== before, before.slice(0, 30) + ' -> ' + after.slice(0, 30));
  check('next() advances by exactly one', board.heroIdx === (beforeIdx + 1) % board.markets.length,
    'idx ' + beforeIdx + ' -> ' + board.heroIdx);
  var seq = gsapLog.join(' -> ');
  check('topic change animates out then in',
    seq.indexOf('to') !== -1 && seq.indexOf('from') > seq.indexOf('to'),
    seq.slice(0, 80));

  const midIdx = board.heroIdx;
  PM.prev();
  await waitFor(() => board.heroIdx !== midIdx);
  await waitShown(board.heroMarket().topic);
  check('prev() returns to the previous topic', board.heroMarket().topic === before,
    board.heroMarket().topic.slice(0, 30));

  const jIdx = board.heroIdx;
  PM.show(2);
  await waitFor(() => board.heroIdx !== jIdx);
  await waitShown(board.heroMarket().topic);
  check('show(n) jumps to a specific topic', board.heroIdx === 2, 'idx=' + board.heroIdx);

  /* wrapping in both directions */
  PM.show(board.markets.length - 1);
  await waitFor(() => board.heroIdx === board.markets.length - 1);
  await waitShown(board.heroMarket().topic);
  const lastIdx = board.heroIdx;
  PM.next();
  await waitFor(() => board.heroIdx !== lastIdx);
  await waitShown(board.heroMarket().topic);
  check('next() wraps to the first topic', board.heroIdx === 0, 'idx=' + board.heroIdx);

  const zeroIdx = board.heroIdx;
  PM.prev();
  await waitFor(() => board.heroIdx !== zeroIdx);
  await waitShown(board.heroMarket().topic);
  check('prev() wraps to the last topic', board.heroIdx === board.markets.length - 1, 'idx=' + board.heroIdx);

  /* the highlighted list row must follow the hero */
  const backIdx = board.heroIdx;
  PM.show(0);
  await waitFor(() => board.heroIdx === 0);
  await waitShown(board.markets[0].topic);      /* the mark moves at the handover */
  const marked = byClass(stage, 'row').filter((r) => r.classList.contains('is-on'));
  check('list highlight follows the hero', marked.length === 1 && textOf(marked[0]).includes(board.markets[0].topic.slice(0, 24)),
    marked.length + ' marked');

  /* ---- a stalled ticker must still change the topic and settle the hero ---- */
  if (PM.board._switchTl) PM.board._switchTl.kill();
  gsapLog.length = 0;
  PM.board.heroIdx = 0;
  PM.board.renderMarkets();
  var stallFrom = PM.board.heroMarket().topic;
  PM.show(3);
  await waitFor(() => PM.board.heroIdx === 3, 800);
  check('topic changes even if the animation never reports completion',
    PM.board.heroIdx === 3 && PM.board.heroMarket().topic !== stallFrom,
    PM.board.heroMarket().topic.slice(0, 32));

  check('markets carry their asset id through normalising',
    board.markets.filter((m) => m.asset).length > 0,
    board.markets.map((m) => m.asset || '-').join(','));
  check('the leading market names the asset its chart should plot',
    !!board.markets[0].asset,
    'asset=' + board.markets[0].asset);

  /* ---- the 7-day graphic only appears for asset markets ---- */
  const chartOf = () => ids['stage'] ? byClass(ids['stage'], 'chart')[0] : null;
  const chartHidden = () => { const c = chartOf(); return !c || c.style.display === 'none'; };

  // default config: the Ethereum market leads and IS an asset -> chart drawn
  await waitShown(board.markets[0].topic);
  check('asset market shows the 7-day graphic', !chartHidden(), 'hero=' + board.heroMarket().topic.slice(0, 24));

  // the Fed market is not about an asset -> graphic withheld
  const fedIdx = board.markets.map((m) => m.topic).findIndex((t) => /Fed cut/.test(t));
  check('a non-asset market exists to test with', fedIdx > -1, 'index=' + fedIdx);
  if (fedIdx > -1) {
    PM.show(fedIdx);
    await waitShown(board.markets[fedIdx].topic);
    check('non-asset market withholds the graphic', chartHidden(),
      'hero=' + board.heroMarket().topic.slice(0, 26) + ' display=' + (chartOf() && chartOf().style.display));

    // ...unless the operator forces it on
    PM.apply({ hero: { showWhenNotAsset: true } }, { animate: false });
    const fIdx2 = board.markets.map((m) => m.topic).findIndex((t) => /Fed cut/.test(t));
    PM.show(fIdx2, { force: true });
    await waitShown(board.markets[fIdx2].topic);
    check('showWhenNotAsset:true forces the graphic on', !chartHidden(),
      'display=' + (chartOf() && chartOf().style.display));
    PM.apply({ hero: { showWhenNotAsset: false } }, { animate: false });
  }

  /* ---- a real asset series must be plotted as prices, not percentages ---- */
  global.__PM_ASSET_SERIES.ethereum = [2400, 2450, 2430, 2510, 2490, 2460, 2454];
  PM.apply({ hero: { historyMode: 'asset' } }, { animate: false });
  PM.show(0, { force: true });
  await waitShown(board.markets[0].topic);
  const axis = byClass(ids['stage'], 'axis-lbl').map((t) => t.textContent);
  const cap = (byClass(ids['stage'], 'lbl') || []).map((t) => t.textContent)
    .filter((t) => /price/i.test(t))[0];
  check('asset mode plots the real series with price axis labels',
    axis.length === 3 && axis.every((t) => /^\$/.test(t)),
    'n=' + axis.length + ' [' + axis.join(' / ') + '] kind=' + board.chartKind +
    ' mode=' + PM.cfg.hero.historyMode + ' asset=' + board.markets[0].asset +
    ' series=' + JSON.stringify(global.__PM_ASSET_SERIES.ethereum || null));
  check('asset mode labels the chart as a price series', /price/i.test(cap || ''), cap || '(none)');
  check('a price series is never clamped to 100%',
    axis.every((t) => !/%/.test(t)),
    axis.join(' / '));
  delete global.__PM_ASSET_SERIES.ethereum;

  /* ---- the content adapts to the space it is given ---- */
  const fitSize = board.hugeSize;
  check('hero figures were fitted to the column', typeof fitSize === 'number' && fitSize > 0,
    'hugeSize=' + fitSize);
  check('a fitted number never exceeds the configured size', fitSize <= (cfg.hero.probabilitySize || 176),
    fitSize + ' <= ' + cfg.hero.probabilitySize);
  /* a short stage must not leave the hero overflowing */
  PM.apply({ stage: { height: 420 } }, { animate: false });
  board.fitHeroContent();
  check('a short stage does not overflow the hero',
    board.hero.scrollHeight <= board.hero.clientHeight + 2 ||
    board.chart.style.display === 'none' ||
    parseFloat(board.heroTopic.style.fontSize) < (cfg.hero.topicSize || 52),
    'scroll=' + board.hero.scrollHeight + ' client=' + board.hero.clientHeight +
    ' topic=' + board.heroTopic.style.fontSize + ' chart=' + board.chart.style.display);
  PM.apply({ stage: { height: 1080 } }, { animate: false });

  /* ---- the travelling glow on the 7-day line ----
     The same animation the Digital Assets board runs on its trend column: a short
     bright dash sweeps the line, rests, and repeats. */
  gsapLog.length = 0;
  PM.apply({
    hero: { historyMode: 'flat', showWhenNotAsset: true, chartGlow: { enabled: true, length: 150 } }
  }, { animate: false });
  PM.show(0, { force: true });
  await waitShown(board.heroMarket().topic);

  const glowEl = byClass(stage, 'glow')[0];
  const lineEl = byClass(stage, 'line')[0];
  check('the chart draws a travelling glow path', !!glowEl,
    glowEl ? 'dash=' + glowEl.getAttribute('stroke-dasharray') : '(none)');
  check('the glow path uses the line geometry exactly',
    !!glowEl && !!lineEl && glowEl.getAttribute('d') === lineEl.getAttribute('d'),
    'same d=' + (!!glowEl && !!lineEl && glowEl.getAttribute('d') === lineEl.getAttribute('d')));
  const glowDash = String((glowEl && glowEl.getAttribute('stroke-dasharray')) || '');
  const glowDashLen = parseFloat(glowDash.split(' ')[0]);
  const glowGap = parseFloat(glowDash.split(' ')[1]);
  check('the glow dash is the configured length', glowDashLen === 150, glowDash);
  check('the glow dash is shorter than the line it runs along',
    glowGap > glowDashLen && glowGap >= (board.chartLineLen || 0), glowDash + ' line=' + board.chartLineLen);
  check('the glow has a halo', /drop-shadow/.test(String((glowEl && glowEl.style.filter) || '')),
    (glowEl && glowEl.style.filter) || '(none)');
  check('the glow runs on a looping timeline',
    gsapLog.indexOf('timeline:repeat') !== -1,
    gsapLog.filter((c) => String(c).indexOf('timeline') === 0).join(',') || '(none)');
  check('the loop is armed on the board', !!board._glowTl, '_glowTl=' + (board._glowTl ? 'armed' : 'none'));

  PM.apply({ hero: { chartGlow: { enabled: false } } }, { animate: false });
  check('chartGlow.enabled:false removes the glow',
    byClass(stage, 'glow').length === 0, byClass(stage, 'glow').length + ' glow paths');
  check('...and stops the loop', !board._glowTl, '_glowTl=' + String(board._glowTl));
  PM.apply({ hero: { chartGlow: { enabled: true } } }, { animate: false });

  /* ---- click a row to switch topic ---- */
  await waitFor(() => board.heroIdx === 0, 800);
  check('rows are marked clickable',
    byClass(stage, 'row').every((r) => r.classList.contains('is-clickable')),
    byClass(stage, 'row').length + ' rows');

  const targetRow = byClass(stage, 'row')[2];       // third visible row
  const targetMarket = board.rowMarkets[2];
  await waitFor(() => board.heroIdx === 0, 800);
  targetRow.dispatch('click');
  await waitFor(() => board.heroMarket().topic === targetMarket.topic);
  await waitShown(targetMarket.topic);
  check('clicking a row switches the hero to that market',
    board.heroMarket().topic === targetMarket.topic,
    board.heroMarket().topic.slice(0, 34));

  const markedAfter = byClass(stage, 'row').filter((r) => r.classList.contains('is-on'));
  check('clicking a row moves the highlight to that row',
    markedAfter.length === 1 && textOf(markedAfter[0]).includes(targetMarket.topic.slice(0, 20)),
    markedAfter.length + ' marked');

  /* Enter on a focused row is the keyboard equivalent */
  const kbRow = byClass(stage, 'row')[0];
  const kbMarket = board.rowMarkets[0];
  kbRow.dispatch('keydown', { key: 'Enter' });
  await waitFor(() => board.heroMarket().topic === kbMarket.topic);
  await waitShown(kbMarket.topic);
  check('Enter on a row switches the hero too',
    board.heroMarket().topic === kbMarket.topic,
    board.heroMarket().topic.slice(0, 34));

  /* with the flag off the rows must not be interactive */
  PM.apply({ list: { clickToSwitch: false } }, { animate: false });
  check('clickToSwitch:false removes the affordance',
    byClass(ids['stage'], 'row').every((r) => !r.classList.contains('is-clickable')),
    'rows=' + byClass(ids['stage'], 'row').length);
  PM.apply({ list: { clickToSwitch: true } }, { animate: false });

  /* ---- a row opens ACROSS THE WHOLE BOARD, with a way back ---- */
  PM.apply({ hero: { mode: 'volume' } }, { animate: false });
  await waitFor(() => board.heroIdx === 0, 800);

  const openRow = byClass(stage, 'row')[1];
  const openMarket = board.rowMarkets[1];
  openRow.dispatch('click');
  await waitShown(openMarket.topic);

  check('clicking a row opens it across the whole board',
    board.board.classList.contains('is-detail'),
    'detail=' + board.detail);
  check('the opened row is the hero of the detail view',
    board.heroMarket().topic === openMarket.topic,
    board.heroMarket().topic.slice(0, 34));

  const backBtn = byClass(stage, 'back')[0];
  check('a Back button is offered in the detail view',
    !!backBtn && /back/i.test(textOf(backBtn)),
    backBtn ? JSON.stringify(textOf(backBtn)) : '(none)');
  check('Back is in the tab order only while a market is open',
    !!backBtn && backBtn.tabIndex === 0, 'tabIndex=' + (backBtn && backBtn.tabIndex));
  check('the list is hidden from assistive tech while a market is open',
    byClass(stage, 'list')[0].getAttribute('aria-hidden') === 'true',
    'aria-hidden=' + byClass(stage, 'list')[0].getAttribute('aria-hidden'));

  /* "occupy both sides" is a measurable claim: the content is set from a larger
     size than the split view, because it has the split view's width plus the
     list's to fill. */
  check('the opened headline is set larger than in the split view',
    parseFloat(board.heroTopic.style.fontSize) > (cfg.hero.topicSize || 52),
    board.heroTopic.style.fontSize + ' vs ' + cfg.hero.topicSize + 'px');
  check('the opened number is set larger than in the split view',
    board.hugeSize > (cfg.hero.probabilitySize || 176),
    board.hugeSize + ' vs ' + cfg.hero.probabilitySize);

  /* Back */
  backBtn.dispatch('click');
  check('Back returns to the list',
    !board.board.classList.contains('is-detail'), 'detail=' + board.detail);
  check('Back leaves the opened market as the hero',
    board.heroMarket().topic === openMarket.topic,
    board.heroMarket().topic.slice(0, 34));
  check('the list is readable again after Back',
    byClass(stage, 'list')[0].getAttribute('aria-hidden') === 'false',
    'aria-hidden=' + byClass(stage, 'list')[0].getAttribute('aria-hidden'));
  check('Back is out of the tab order once the list is back',
    byClass(stage, 'back')[0].tabIndex === -1,
    'tabIndex=' + byClass(stage, 'back')[0].tabIndex);
  check('the headline returns to the split-view size',
    parseFloat(board.heroTopic.style.fontSize) <= (cfg.hero.topicSize || 52),
    board.heroTopic.style.fontSize);
  check('Back is a no-op when nothing is open', PM.back() === false, 'returned false');

  /* Enter is the keyboard equivalent of the click */
  const kbOpenRow = byClass(stage, 'row')[3];
  const kbOpenMarket = board.rowMarkets[3];
  kbOpenRow.dispatch('keydown', { key: 'Enter' });
  await waitShown(kbOpenMarket.topic);
  check('Enter opens a row across the whole board',
    board.board.classList.contains('is-detail') &&
    board.heroMarket().topic === kbOpenMarket.topic,
    board.heroMarket().topic.slice(0, 34));

  /* next/prev move the opened market; Back lands on whatever is on screen */
  PM.next();
  await waitShown(board.heroMarket().topic);
  check('stepping a topic keeps the detail view open',
    board.board.classList.contains('is-detail'), 'detail=' + board.detail);
  const stepped = board.heroMarket().topic;
  PM.back();
  check('Back after stepping returns to the list on the market on screen',
    !board.board.classList.contains('is-detail') && board.heroMarket().topic === stepped,
    board.heroMarket().topic.slice(0, 34));

  /* the split-view click behaviour is still available from the config */
  PM.apply({ list: { clickOpensDetail: false } }, { animate: false });
  const plainRow = byClass(stage, 'row')[1];
  const plainMarket = board.rowMarkets[1];
  plainRow.dispatch('click');
  await waitShown(plainMarket.topic);
  check('clickOpensDetail:false keeps the click in the split view',
    !board.board.classList.contains('is-detail') &&
    board.heroMarket().topic === plainMarket.topic,
    board.heroMarket().topic.slice(0, 34));
  PM.apply({ list: { clickOpensDetail: true } }, { animate: false });

  /* an edit in the control panel must not close the market being shown */
  const keepRow = byClass(stage, 'row')[2];
  const keepMarket = board.rowMarkets[2];
  keepRow.dispatch('click');
  await waitShown(keepMarket.topic);
  PM.apply({ palette: { ink: '#fdfdfd' } }, { animate: false });
  check('an opened market survives a control-panel edit',
    board.board.classList.contains('is-detail') &&
    board.heroMarket().topic === keepMarket.topic,
    board.heroMarket().topic.slice(0, 34));

  /* ---- opening the market that is ALREADY on screen is a layout change ----
     It must not redraw the chart: a dash-draw over content the operator can already
     see is the "incomplete line that slowly completes" this fixed. */
  PM.back();
  const pathBefore = board.chartPath;
  const glowBefore = board._glowTl;
  PM.open(board.heroIdx);
  check('opening the market already on screen keeps the same chart path',
    !!pathBefore && board.chartPath === pathBefore,
    'same element=' + (board.chartPath === pathBefore));
  check('...and keeps its glow loop instead of restarting it',
    !!glowBefore && board._glowTl === glowBefore,
    'same loop=' + (board._glowTl === glowBefore));
  check('...and the line is never left mid-draw',
    !board.chartPath.style.strokeDashoffset && !board.chartPath.getAttribute('stroke-dasharray'),
    'dashoffset=' + String(board.chartPath.style.strokeDashoffset) +
    ' dasharray=' + String(board.chartPath.getAttribute('stroke-dasharray')));
  PM.back();

  /* opening ANOTHER market is a topic change, but it still must not draw the series
     as a line crawling in across the expanded board */
  PM.open((board.heroIdx + 1) % board.markets.length);
  check('opening another market starts the new line complete, not mid-draw',
    !!board.chartPath && !board.chartPath.style.strokeDashoffset &&
    !board.chartPath.getAttribute('stroke-dasharray'),
    'dashoffset=' + String(board.chartPath.style.strokeDashoffset));
  PM.back();

  /* ---- going full size is a layered reveal, and Back brings the ranking back ---- */
  gsapLog.length = 0;
  gsapVars.length = 0;
  PM.open(board.heroIdx);
  const openTweens = gsapLog.filter((c) => c === 'from' || c === 'fromTo').length;
  check('opening a market plays a layered reveal', openTweens >= 8,
    openTweens + ' tweens: ' + gsapLog.join(','));
  check('the reveal draws an accent rule across the new width',
    byClass(stage, 'sweep').length === 1, byClass(stage, 'sweep').length + ' sweep rules');
  check('the headline is wiped open, not just faded',
    gsapVars.some((v) => 'clipPath' in v), 'vars=' + JSON.stringify(gsapVars.map((v) => Object.keys(v).join('+'))));
  check('the glow acknowledges the expansion without redrawing the line',
    gsapVars.some((v) => '--glow-boost' in v), 'vars=' + JSON.stringify(gsapVars.map((v) => Object.keys(v).join('+'))));
  gsapLog.length = 0;
  PM.back();
  const backTweens = gsapLog.filter((c) => c === 'from').length;
  check('Back brings the ranking back in', backTweens >= 1,
    backTweens + ' row tweens');

  /* ---- the saved-config merge must not invent a truthy value ----
     The regression: `clone(o)` was `JSON.parse(JSON.stringify(o || {}))`, so a
     saved `false` came out of a migration as `{}` — and `{}` is truthy, which
     switched rotation ON and started the board cycling the markets on air. */
  const merged = global.PM_MIGRATE.apply(cfg, {
    meta: { version: '0.9.0' },
    rotate: { enabled: false, ms: 12000 },
    hero: { mode: 'volume', index: 0 },
    markets: { items: [{ topic: 'A kept market', probability: 50, volume: 1000, enabled: true }] },
    palette: { ink: '#ff0000' }
  });
  check('migration keeps a saved false as false, never as {}',
    merged.rotate.enabled === false,
    JSON.stringify(merged.rotate.enabled) + ' (' + typeof merged.rotate.enabled + ')');
  check('migration keeps a saved zero as zero',
    merged.hero.index === 0, JSON.stringify(merged.hero.index) + ' (' + typeof merged.hero.index + ')');
  check('migration keeps the typed markets',
    (merged.markets.items || []).length === 1 && merged.markets.items[0].topic === 'A kept market',
    JSON.stringify((merged.markets.items || []).map((m) => m.topic)));
  check('migration takes the look from the build, not the saved config',
    merged.palette.ink !== '#ff0000', 'ink=' + merged.palette.ink);

  /* and the timer itself refuses a flag that is not a real true */
  const liveRotate = PM.cfg.rotate;
  PM.cfg.rotate = { enabled: {}, ms: 12000 };
  PM.startRotate();
  check('a {} rotate.enabled cannot start rotation', !PM._rot, '_rot=' + String(PM._rot));

  /* an opened market is a selection: rotation must not advance it */
  PM.cfg.rotate = { enabled: true, ms: 12000 };
  PM.startRotate();
  const rotArmed = !!PM._rot;
  PM.open(1);
  check('opening a market parks rotation', rotArmed && !PM._rot, 'armed=' + rotArmed + ' after-open=' + String(PM._rot));
  PM.back();
  check('Back hands rotation back only because it was running', !!PM._rot, '_rot=' + String(PM._rot));
  PM.stopRotate();
  PM.cfg.rotate = liveRotate;

  /* ---- empty board is a real state ---- */
  PM.apply({ markets: { items: [] }, markets2: undefined }, { animate: false });
  check('empty board shows a message instead of nothing',
    byClass(ids['stage'], 'empty').some((n) => /No markets/i.test(textOf(n))),
    'empty state rendered');

  const failed = results.filter((r) => !r.pass).length;
  console.log('\n  prediction markets — smoke test\n  ' + '-'.repeat(56));
  results.forEach((r) => console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : '')));
  console.log('  ' + '-'.repeat(56));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
}, 600);

