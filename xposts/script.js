/* ============================================================================
   X Posts — overlay engine
   ----------------------------------------------------------------------------
   One post on air at a time, manual cycling only: no timer, the operator decides
   when the feed moves, exactly like the prediction board.

   Data comes from config.json (api/config), which the control panel writes after
   resolving each pasted X URL through the hub. The overlay never calls X.
   ========================================================================== */
(function () {
  'use strict';

  var HAS_GSAP = !!window.gsap;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function compact(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function when(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    return new Date(t).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------------ state */
  var cfg = Object.assign({}, window.XP_DEFAULT_CONFIG || {});
  var posts = [];
  var index = 0;
  var dir = 1;
  var stage = $('stage');
  var board = $('board');
  var heroBody = $('heroBody');
  var navCount = $('navCount');

  function applyPalette() {
    var p = cfg.palette || {};
    var root = document.documentElement.style;
    if (p.stage) root.setProperty('--stage', p.stage);
    if (p.ink) root.setProperty('--ink', p.ink);
    if (p.inkSoft) root.setProperty('--ink-soft', p.inkSoft);
    if (p.dim) root.setProperty('--dim', p.dim);
    if (p.dimmer) root.setProperty('--dimmer', p.dimmer);
    if (p.line) root.setProperty('--line', p.line);
    if (p.lineSoft) root.setProperty('--line-soft', p.lineSoft);
    if (p.brass) root.setProperty('--brass', p.brass);
    if (p.link) root.setProperty('--link', p.link);
  }

  function applyChrome() {
    var h = cfg.header || {};
    var logo = $('logo');
    if (logo) {
      logo.style.display = h.logo && h.logo.enabled === false ? 'none' : '';
      if (h.logo && h.logo.src) logo.src = h.logo.src;
      if (h.logo && h.logo.height) logo.style.height = h.logo.height + 'px';
    }
    var k = $('kicker');
    if (k) {
      k.textContent = (h.kicker && h.kicker.text) || '';
      if (h.kicker) {
        k.style.fontSize = (h.kicker.size || 22) + 'px';
        k.style.letterSpacing = (h.kicker.tracking || 0.18) + 'em';
      }
      k.style.display = (h.kicker && h.kicker.text) ? '' : 'none';
    }
    var t = $('headline');
    if (t) {
      t.textContent = (h.title && h.title.text) || 'X Posts';
      if (h.title) {
        t.style.fontSize = (h.title.size || 62) + 'px';
        t.style.fontWeight = h.title.weight || 700;
        t.style.letterSpacing = (h.title.tracking || 0) + 'em';
      }
    }
    var right = $('headerRight');
    var rt = $('rightTop');
    var rs = $('rightSub');
    if (right) {
      var hasRight = !!(h.right && (h.right.text || h.right.sub));
      right.style.display = hasRight ? '' : 'none';
      if (rt) rt.textContent = (h.right && h.right.text) || '';
      if (rs) {
        rs.textContent = (h.right && h.right.sub) || '';
        rs.style.display = (h.right && h.right.sub) ? '' : 'none';
      }
      if (h.right) right.style.fontSize = (h.right.size || 22) + 'px';
    }
    var nav = $('nav');
    if (nav) nav.style.display = (cfg.nav && cfg.nav.visible === false) ? 'none' : '';
  }

  /* ------------------------------------------------------------------ render */
  function postNode(p, hero) {
    var wrap = el('article', 'post');
    wrap.dataset.id = p.id;

    var author = el('div', 'post__author', wrap);
    if (p.avatar) {
      var av = el('img', 'post__avatar', author);
      av.src = p.avatar;
      av.alt = '';
      av.addEventListener('error', function () { av.style.display = 'none'; });
    }
    var who = el('div', 'post__who', author);
    var name = el('div', 'post__name', who);
    var nameText = el('span', null, name);
    nameText.textContent = p.name || p.handle || '';
    if (p.verified) {
      var badge = el('span', 'post__badge', name);
      badge.textContent = 'verified';
    }
    var handle = el('div', 'post__handle', who);
    var link = el('a', null, handle);
    link.href = p.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '@' + (p.handle || '');
    if (p.created) {
      var dot = el('span', null, handle);
      dot.textContent = '  ·  ' + when(p.created);
    }

    var text = el('p', 'post__text', wrap);
    /* X truncates the display text; entities carry the real links, but the
       plain text is what belongs on air */
    text.textContent = p.text || '';

    var media = (p.photos || []).slice(0, 2);
    if (hero && cfg.hero && cfg.hero.showMedia !== false && media.length) {
      var box = el('div', 'post__media ' + (media.length > 1 ? 'is-many' : 'is-one'), wrap);
      box.style.setProperty('--media-max', (cfg.hero.mediaMaxHeight || 430) + 'px');
      media.forEach(function (ph, k) {
        var img = el('img', null, box);
        img.src = ph.url;
        img.alt = '';
        img.title = 'Click to enlarge';
        img.addEventListener('error', function () { img.style.display = 'none'; });
        if (cfg.imageZoom && cfg.imageZoom.clickToOpen !== false) {
          img.addEventListener('click', function (ev) {
            ev.stopPropagation();
            openZoom(p, k);
          });
        }
      });
    }

    if (hero && cfg.hero && cfg.hero.showMetrics !== false) {
      var m = el('div', 'post__metrics', wrap);
      var like = el('span', null, m);
      var lb = el('b', null, like); lb.textContent = compact(p.likes);
      like.appendChild(document.createTextNode(' likes'));
      var rep = el('span', null, m);
      var rb = el('b', null, rep); rb.textContent = compact(p.replies);
      rep.appendChild(document.createTextNode(' replies'));
      /* no outbound link on air: the board is read, not clicked */
    }
    return wrap;
  }

  /* One post per frame: the queue that used to list what was next is retired,
     so everything below the hero belongs to the copy and the images. */
  function renderQueue() {}

  function overflowing() {
    return board.scrollHeight - board.clientHeight > 2;
  }

  /* One measured pass instead of nudging: images and text reflow asynchronously,
     so stepping sizes until scrollHeight stops moving chases its own tail. Take
     the hero's height with the media out of the flow, subtract it from the space
     the frame actually has, and give the remainder to the images. Text steps down
     only if that remainder would fall under a readable plate. */
  function fitFrame() {
    var h = cfg.hero || {};
    var t = heroBody.querySelector('.post__text');
    var media = heroBody.querySelector('.post__media');
    var cs = getComputedStyle(board);
    var head = board.querySelector('.board__header');
    var avail = board.clientHeight
      - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      - (head ? head.offsetHeight : 0);

    var minSize = h.minTextSize || 40;
    var cap = h.mediaMaxHeight || 560;
    var maxText = t ? (media ? 96 : 128) : 0;

    /* Images are the thing that can be enlarged on click, so they take a modest
       plate and the copy gets the rest of the frame. Type then grows until it
       fills what is left instead of being set to a guessed size. */
    if (media) {
      var plate = Math.max(320, Math.min(cap, Math.round(avail * 0.34)));
      media.style.setProperty('--media-max', plate + 'px');
    }

    if (!t) return;
    var size = maxText;
    t.style.fontSize = size + 'px';
    var guard = 0;
    while (overflowing() && size > minSize && guard++ < 60) {
      size -= 2;
      t.style.fontSize = size + 'px';
    }
  }

  function renderNav() {
    if (!navCount) return;
    var n = posts.length;
    navCount.textContent = n ? pad(index + 1) + ' / ' + pad(n) : '';
  }

  function renderHero() {
    if (!heroBody) return;
    heroBody.innerHTML = '';
    var p = posts[index];
    if (!p) {
      var e = el('div', 'empty', stage);
      e.innerHTML = 'No posts yet<small>paste X links in the control panel</small>';
      e.id = 'emptyNote';
      return;
    }
    var note = $('emptyNote');
    if (note) note.remove();
    heroBody.appendChild(postNode(p, true));
    fitFrame();
  }

  function render() {
    applyPalette();
    applyChrome();
    renderHero();
    renderQueue();
    renderNav();
    fitFrame();
  }

  /* --------------------------------------------------------------- animation */
  function switchTo(i, opts) {
    opts = opts || {};
    if (!posts.length) return index;
    var n = posts.length;
    var next = ((i % n) + n) % n;
    if (next === index && !opts.force) return index;
    var fwd = (next - index + n) % n;
    var back = (index - next + n) % n;
    dir = opts.dir || (fwd <= back ? 1 : -1);
    index = next;

    if (!HAS_GSAP || opts.instant) {
      render();
      if (HAS_GSAP) window.gsap.set(heroBody, { clearProps: 'opacity,transform,clipPath' });
      return index;
    }

    var clipOut = dir > 0 ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)';
    var clipIn = dir > 0 ? 'inset(100% 0% 0% 0%)' : 'inset(0% 0% 100% 0%)';
    var a = cfg.animation || {};
    var outMs = num(a.wipeMs, 480) / 1000 * 0.55;

    var tl = window.gsap.timeline();
    tl.to(heroBody, { clipPath: clipOut, y: dir * -18, opacity: 0.25, duration: outMs, ease: 'power2.in' }, 0);
    tl.call(function () {
      render();
      window.gsap.set(heroBody, { clipPath: clipIn, y: dir * 26, opacity: 0.3 });
    });
    tl.to(heroBody, {
      clipPath: 'inset(0% 0% 0% 0%)', y: 0, opacity: 1,
      duration: num(a.wipeMs, 480) / 1000, ease: 'power3.out'
    });
    tl.set(heroBody, { clearProps: 'clipPath,transform' });
  }

  /* OBS never sees a "hide" flag on the source, so the panel drives visibility
     with the same fade the other boards use. */
  function hideBoard() {
    if (!HAS_GSAP) { board.style.display = 'none'; return; }
    window.gsap.to(board, { opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: function () { board.style.visibility = 'hidden'; } });
  }
  function showBoard() {
    board.style.visibility = '';
    if (!HAS_GSAP) { board.style.display = ''; board.style.opacity = 1; return; }
    window.gsap.fromTo(board, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
  }

  function next() { return switchTo(index + 1, { dir: 1 }); }
  function prev() { return switchTo(index - 1, { dir: -1 }); }

  /* ------------------------------------------------------------- image zoom */
  var zoomLayer = null;
  var zoomIndex = 0;

  function zoomPhotos(p) { return (p && p.photos) ? p.photos.slice(0, 4) : []; }

  function closeZoom() {
    if (!zoomLayer) return;
    var layer = zoomLayer;
    zoomLayer = null;
    if (HAS_GSAP) {
      window.gsap.to(layer, {
        opacity: 0, duration: 0.22, ease: 'power2.in',
        onComplete: function () { layer.remove(); }
      });
    } else {
      layer.remove();
    }
  }

  function openZoom(p, i) {
    var photos = zoomPhotos(p);
    if (!photos.length) return;
    if (zoomLayer) closeZoom();
    zoomIndex = Math.max(0, Math.min(i || 0, photos.length - 1));

    var layer = el('div', 'zoom', stage);
    layer.id = 'zoomLayer';
    var shade = el('div', 'zoom__shade', layer);
    if (cfg.imageZoom && cfg.imageZoom.backdrop) {
      shade.style.background = 'rgba(6, 6, 7, ' + cfg.imageZoom.backdrop + ')';
    }

    var fig = el('figure', 'zoom__fig', layer);
    var img = el('img', 'zoom__img', fig);
    img.src = photos[zoomIndex].url;
    img.alt = '';

    var cap = el('figcaption', 'zoom__cap', fig);
    function paintCap() {
      cap.textContent = '@' + (p.handle || '') + (photos.length > 1 ? '  ·  ' + (zoomIndex + 1) + ' / ' + photos.length : '');
    }
    paintCap();

    /* a full-bleed image leaves nothing to click "outside", so the corner
       control is the guaranteed way back to the post */
    var close = el('button', 'zoom__close', layer);
    close.type = 'button';
    close.innerHTML = '&#10005;';
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close image');
    close.addEventListener('click', function (ev) { ev.stopPropagation(); closeZoom(); });

    var hint = el('div', 'zoom__hint', layer);
    hint.textContent = photos.length > 1 ? 'esc to close · click for next' : 'esc to close';

    if (photos.length > 1) {
      var prevBtn = el('button', 'zoom__nav zoom__nav--prev', layer);
      prevBtn.type = 'button';
      prevBtn.innerHTML = '&lsaquo;';
      prevBtn.setAttribute('aria-label', 'Previous image');
      prevBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        zoomIndex = (zoomIndex - 1 + photos.length) % photos.length;
        img.src = photos[zoomIndex].url; paintCap();
      });

      var nextBtn = el('button', 'zoom__nav zoom__nav--next', layer);
      nextBtn.type = 'button';
      nextBtn.innerHTML = '&rsaquo;';
      nextBtn.setAttribute('aria-label', 'Next image');
      nextBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        zoomIndex = (zoomIndex + 1) % photos.length;
        img.src = photos[zoomIndex].url; paintCap();
      });
    }

    /* clicking the picture or the backdrop closes it: the frame is the picture,
       so that is the gesture people reach for */
    layer.addEventListener('click', function () { closeZoom(); });

    if (HAS_GSAP) {
      window.gsap.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.24, ease: 'power2.out' });
      window.gsap.fromTo(img, { scale: 0.98 }, { scale: 1, duration: 0.4, ease: 'power3.out' });
    }
    zoomLayer = layer;
    return layer;
  }

  function toggleZoom() {
    if (zoomLayer) return closeZoom();
    return openZoom(posts[index], 0);
  }

  /* --------------------------------------------------------------------- io */
  function adopt(remote) {
    if (!remote || typeof remote !== 'object') return;
    cfg = Object.assign({}, cfg, remote);
    posts = (cfg.posts && Array.isArray(cfg.posts.items)) ? cfg.posts.items.slice() : [];
    if (index >= posts.length) index = 0;
    render();
  }

  function load() {
    fetch('api/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) { if (remote && Object.keys(remote).length) adopt(remote); else { posts = []; render(); } })
      .catch(function () { posts = []; render(); });
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'xp:config' && d.config) adopt(d.config);
    if (d.type === 'xp:command' || d.type === 'pm:command') {
      var a = d.action;
      if (a === 'next') next();
      else if (a === 'prev') prev();
      else if (a === 'out') hideBoard();
      else if (a === 'zoom') toggleZoom();
      else if (a === 'in' || a === 'show' || a === 'replay') showBoard();
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeZoom(); return; }
    if (ev.key === 'ArrowRight') { next(); ev.preventDefault(); }
    if (ev.key === 'ArrowLeft') { prev(); ev.preventDefault(); }
    if (ev.key === 'z' || ev.key === 'Z') { toggleZoom(); ev.preventDefault(); }
  });

  var nextBtn = $('next');
  var prevBtn = $('prev');
  if (nextBtn) nextBtn.addEventListener('click', next);
  if (prevBtn) prevBtn.addEventListener('click', prev);

  window.XP = {
    get index() { return index; },
    get posts() { return posts; },
    get config() { return cfg; },
    switchTo: switchTo,
    next: next,
    prev: prev,
    zoom: toggleZoom,
    closeZoom: closeZoom,
    get zoomed() { return !!zoomLayer; },
    render: render
  };

  load();
  setInterval(load, 4000);      /* picks up panel edits without a reload */
})();
