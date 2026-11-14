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

  /* A face only downloads when something uses it, so the first selection of a new
     typeface would land a beat late. Warm every family in the catalogue in the
     background instead: by the time the operator picks one, it is already here. */
  var warmedFonts = false;
  function warmFonts() {
    if (warmedFonts || !document.fonts || !document.fonts.load) return;
    warmedFonts = true;
    (window.XP_FONTS || []).forEach(function (f, i) {
      var family = String(f.stack || '').split(',')[0].replace(/['"]/g, '').trim();
      if (!family || family === 'neue-haas-grotesk-display') return;
      setTimeout(function () {
        try {
          document.fonts.load('600 64px "' + family + '"');
          document.fonts.load('500 40px "' + family + '"');
        } catch (e) { /* ignore */ }
      }, 400 + i * 180);
    });
  }

  function fontStack(id) {
    var list = window.XP_FONTS || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].stack;
    return id || "'neue-haas-grotesk-display', sans-serif";
  }

  function applyFonts() {
    var t = cfg.type || {};
    var root = document.documentElement.style;
    root.setProperty('--font-display', fontStack(t.display));
    root.setProperty('--font-text', fontStack(t.text || t.display));
  }

  function applyBackdrop() {
    var bd = $('bd'), img = $('bdImg'), tint = $('bdTint');
    if (!bd || !img) return;
    var b = cfg.backdrop || {};
    var on = b.enabled !== false && !!b.image;
    bd.style.display = on ? '' : 'none';
    if (!on) return;
    img.style.setProperty('--bd-src', 'url("' + b.image + '")');
    img.style.setProperty('--bd-op', b.opacity == null ? 0.95 : b.opacity);
    img.style.setProperty('--bd-blur', (b.blur || 0) + 'px');
    img.style.setProperty('--bd-pan', (b.panSeconds || 25) + 's');
    if (tint) tint.style.setProperty('--bd-tint', b.tint || 'rgba(8, 8, 9, 0.80)');
  }

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
    /* The pager is how an operator drives the board, so it is always on. */
    var nav = $('nav');
    if (nav) nav.style.display = '';
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
        /* X reports the real pixel size with every photo. Setting it as the
           intrinsic size means the browser reserves the exact box on the first
           paint: nothing reflows when the file lands, which is what used to make
           a switch settle a second late on air. */
        if (ph.w && ph.h) {
          img.width = ph.w;
          img.height = ph.h;
          img.style.aspectRatio = ph.w + ' / ' + ph.h;
        }
        img.src = ph.url;
        img.alt = '';
        img.title = 'Click to enlarge';
        img.addEventListener('error', function () { img.style.display = 'none'; });
        /* every image on the board is enlargeable — no flag decides it */
        img.addEventListener('click', function (ev) {
          ev.stopPropagation();
          openZoom(p, k, img);
        });
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
  function availableHeight() {
    var cs = getComputedStyle(board);
    var head = board.querySelector('.board__header');
    return board.clientHeight
      - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      - (head ? head.offsetHeight : 0);
  }

  /* ------------------------------------------------------------------------
     Layout is measured once per post, off screen, and remembered. Cycling then
     applies two numbers instead of re-running a measure/shrink loop in front of
     the audience — which is what made a switch look like it settled late.
     ---------------------------------------------------------------------- */
  var layoutCache = {};
  var layoutSig = '';
  var probe = null;

  function signature() {
    var h = cfg.hero || {};
    return [
      board.clientWidth, availableHeight(),
      h.textSize, h.minTextSize, h.mediaMaxHeight,
      (cfg.type || {}).display, (cfg.type || {}).text,
      posts.map(function (x) { return x && x.id; }).join(',')
    ].join('|');
  }

  function measurePost(p) {
    if (!probe) {
      probe = el('div', 'probe', stage);
      probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;z-index:-1';
    }
    probe.style.width = heroBody.clientWidth + 'px';
    probe.innerHTML = '';
    var body = el('div', 'hero__body', probe);
    body.appendChild(postNode(p, true));

    var t = body.querySelector('.post__text');
    var media = body.querySelector('.post__media');
    var h = cfg.hero || {};
    var avail = availableHeight();
    var plate = media ? Math.max(320, Math.min(h.mediaMaxHeight || 560, Math.round(avail * 0.34))) : 0;
    if (media) media.style.setProperty('--media-max', plate + 'px');

    var size = t ? (media ? 96 : 128) : 0;
    var min = h.minTextSize || 40;
    if (t) {
      t.style.fontSize = size + 'px';
      var guard = 0;
      while (body.scrollHeight > avail && size > min && guard++ < 60) {
        size -= 2;
        t.style.fontSize = size + 'px';
      }
    }
    return { size: size, plate: plate };
  }

  function precompute() {
    var sig = signature();
    if (sig === layoutSig) return;
    layoutSig = sig;
    layoutCache = {};
    posts.forEach(function (p) {
      if (!p) return;
      try { layoutCache[p.id] = measurePost(p); } catch (e) { /* keep the fallback */ }
    });
    if (probe) probe.innerHTML = '';
  }

  function applyLayout(p) {
    var t = heroBody.querySelector('.post__text');
    var media = heroBody.querySelector('.post__media');
    var hit = layoutCache[p && p.id];
    if (hit) {
      if (t && hit.size) t.style.fontSize = hit.size + 'px';
      if (media && hit.plate) media.style.setProperty('--media-max', hit.plate + 'px');
      return true;
    }
    return false;
  }

  /* Fallback for the very first paint of a post that has not been measured yet:
     same maths as the probe, run in place once, then cached. */
  function fitFrame() {
    var p = posts[index];
    if (!p) return;
    if (applyLayout(p)) return;
    layoutCache[p.id] = measurePost(p);
    layoutSig = signature();
    applyLayout(p);
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

    /* The empty state lives inside the hero body, which is cleared at the top of
       every render. Appending it to the stage instead meant one copy per repaint
       — the wall of "No posts yet" that appeared after the board was cleared. */
    if (!p) {
      var e = el('div', 'empty', heroBody);
      e.innerHTML = 'No posts yet<small>paste X links in the control panel</small>';
      var nav = $('nav');
      if (nav) nav.style.display = 'none';
      return;
    }
    var navEl = $('nav');
    if (navEl) navEl.style.display = '';
    heroBody.appendChild(postNode(p, true));
    applyLayout(p) || fitFrame();

    var imgs = heroBody.querySelectorAll('.post__media img');
    if (imgs.length && imgs[0].decode) {
      Promise.all(Array.prototype.map.call(imgs, function (im) {
        return im.decode().catch(function () { /* broken file */ });
      })).then(function () {
        if (posts[index] === p) fitFrame();
      });
    }
  }

  /* Keep the neighbour posts' pictures in the browser cache: the operator moves
     forward and back constantly, and a cold image is a visible hitch. */
  var warmed = {};
  function warm() {
    if (!posts.length) return;
    [index + 1, index + 2, index - 1].forEach(function (k) {
      var p = posts[((k % posts.length) + posts.length) % posts.length];
      if (!p) return;
      (p.photos || []).forEach(function (ph) {
        if (!ph.url || warmed[ph.url]) return;
        warmed[ph.url] = 1;
        var im = new Image();
        im.src = ph.url;
        if (im.decode) im.decode().catch(function () { /* ignore */ });
      });
    });
  }

  function render() {
    applyFonts();
    applyBackdrop();
    applyPalette();
    applyChrome();
    renderHero();
    renderQueue();
    renderNav();
    warm();
    warmFonts();
    requestAnimationFrame(precompute);
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

  /* Geometry of the enlarged picture: contain into the frame, then report both
     the box and where the thumbnail it grows out of sits. */
  function zoomBox(nat) {
    var st = stage.getBoundingClientRect();
    var r = (nat && nat[0] && nat[1]) ? nat[0] / nat[1] : 16 / 9;
    var fw = st.width, fh = st.height;
    var w = Math.min(fw, fh * r);
    var h = w / r;
    return { x: (fw - w) / 2, y: (fh - h) / 2, w: w, h: h, cw: fw, ch: fh };
  }

  function thumbRect(el) {
    if (!el) return null;
    var st = stage.getBoundingClientRect();
    var b = el.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    return { x: b.left - st.left, y: b.top - st.top, w: b.width, h: b.height };
  }

  function closeZoom() {
    if (!zoomLayer) return;
    var layer = zoomLayer;
    var frame = layer.querySelector('.zoom__frame');
    zoomLayer = null;
    var back = layer.__fromThumb;
    if (HAS_GSAP && frame && back) {
      window.gsap.to(frame, {
        x: back.x, y: back.y, width: back.w, height: back.h, borderRadius: 18,
        duration: 0.34, ease: 'power3.inOut'
      });
      var shade = layer.querySelector('.zoom__shade');
      if (shade) {
        var cur = parseFloat(getComputedStyle(shade).getPropertyValue('--zoom-blur')) || 13;
        var curDim = parseFloat(getComputedStyle(shade).getPropertyValue('--zoom-dim')) || 0.42;
        var back2 = { b: cur, d: curDim };
        window.gsap.to(back2, {
          b: 0, d: 0, duration: 0.34, ease: 'power2.in',
          onUpdate: function () {
            shade.style.setProperty('--zoom-blur', back2.b.toFixed(2) + 'px');
            shade.style.setProperty('--zoom-dim', back2.d.toFixed(3));
          }
        });
      }
      window.gsap.to(layer.querySelectorAll('.zoom__close, .zoom__nav, .zoom__cap, .zoom__hint'),
        { opacity: 0, duration: 0.18 });
      window.gsap.to(layer, { opacity: 0, duration: 0.3, delay: 0.06, onComplete: function () { layer.remove(); } });
    } else if (HAS_GSAP) {
      window.gsap.to(layer, { opacity: 0, duration: 0.22, onComplete: function () { layer.remove(); } });
    } else {
      layer.remove();
    }
  }

  function openZoom(p, i, thumbEl) {
    var photos = zoomPhotos(p);
    if (!photos.length) return;
    if (zoomLayer) closeZoom();
    zoomIndex = Math.max(0, Math.min(i || 0, photos.length - 1));

    var layer = el('div', 'zoom', stage);
    layer.id = 'zoomLayer';
    var shade = el('div', 'zoom__shade', layer);
    shade.style.setProperty('--zoom-blur', '0px');
    shade.style.setProperty('--zoom-dim', '0');

    var frame = el('div', 'zoom__frame', layer);
    var img = el('img', null, frame);
    img.src = photos[zoomIndex].url;
    img.alt = '';

    var cap = el('figcaption', 'zoom__cap', layer);
    function paintCap() {
      cap.textContent = '@' + (p.handle || '') + (photos.length > 1 ? '  ·  ' + (zoomIndex + 1) + ' / ' + photos.length : '');
    }
    paintCap();

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
        swap();
      });

      var nextBtn = el('button', 'zoom__nav zoom__nav--next', layer);
      nextBtn.type = 'button';
      nextBtn.innerHTML = '&rsaquo;';
      nextBtn.setAttribute('aria-label', 'Next image');
      nextBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        zoomIndex = (zoomIndex + 1) % photos.length;
        swap();
      });
    }

    /* stepping keeps the frame where it is and re-cuts the box to the new ratio */
    function swap() {
      img.src = photos[zoomIndex].url;
      paintCap();
      img.onload = function () {
        var b = zoomBox([img.naturalWidth, img.naturalHeight]);
        if (HAS_GSAP) window.gsap.to(frame, { x: b.x, y: b.y, width: b.w, height: b.h, duration: 0.3, ease: 'power3.out' });
        else { frame.style.transform = 'translate(' + b.x + 'px,' + b.y + 'px)'; frame.style.width = b.w + 'px'; frame.style.height = b.h + 'px'; }
      };
    }

    layer.addEventListener('click', function () { closeZoom(); });

    /* measure once the picture knows its own size, then grow it out of the
       thumbnail: the zoom reads as the image lifting off the board */
    function place() {
      var b = zoomBox([img.naturalWidth, img.naturalHeight]);
      var from = thumbRect(thumbEl);
      layer.__fromThumb = from;

      frame.style.width = b.w + 'px';
      frame.style.height = b.h + 'px';

      var g = window.gsap;
      if (!HAS_GSAP) {
        frame.style.transform = 'translate(' + b.x + 'px,' + b.y + 'px)';
        return;
      }
      if (from) {
        g.set(frame, { x: from.x, y: from.y, width: from.w, height: from.h, borderRadius: 18, transformOrigin: '0 0' });
        g.to(frame, { x: b.x, y: b.y, width: b.w, height: b.h, borderRadius: 0, duration: 0.46, ease: 'power3.inOut' });
        /* the blur arrives with the picture instead of being switched on */
        var st = { b: 0, d: 0 };
        g.to(st, {
          b: 13, d: 0.42, duration: 0.46, ease: 'power2.out',
          onUpdate: function () {
            shade.style.setProperty('--zoom-blur', st.b.toFixed(2) + 'px');
            shade.style.setProperty('--zoom-dim', st.d.toFixed(3));
          }
        });
      } else {
        g.fromTo(frame, { scale: 0.9, opacity: 0, transformOrigin: '50% 50%' },
          { scale: 1, opacity: 1, duration: 0.4, ease: 'power3.out' });
        g.set(frame, { x: b.x, y: b.y });
      }
      g.fromTo(layer.querySelectorAll('.zoom__close, .zoom__nav, .zoom__cap, .zoom__hint'),
        { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, delay: 0.18, stagger: 0.03 });
    }

    if (img.complete && img.naturalWidth) place();
    else img.addEventListener('load', place);

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

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { layoutSig = ''; precompute(); });
  }
  window.addEventListener('resize', function () { layoutSig = ''; precompute(); });

  load();
  setInterval(load, 4000);      /* picks up panel edits without a reload */
})();
