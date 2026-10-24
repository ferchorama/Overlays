/* ============================================================================
   Data sync — the dashboard's "Update now" control
   ----------------------------------------------------------------------------
   Why this talks HTTP and nothing else: the dashboard runs in a normal browser
   and the overlay runs inside OBS (its own Chromium profile, its own storage
   partition). BroadcastChannel only reaches same-agent-cluster contexts and a
   localStorage `storage` event only fires in other documents of the SAME
   storage partition — neither crosses into OBS. The hub is the one thing both
   contexts share, so an update is: force the hub to re-read the provider, then
   bump the command sequence the overlay already polls. No new transport, no
   permissions, works while the dashboard is on another machine.

   One fetch per press, guarded three ways:
     • in-flight  — the button is disabled until the request settles
     • cooldown   — a few seconds after a success, so a double-click cannot
                    become two provider calls
     • server     — the hub joins concurrent forced reads and refuses two
                    inside its own short window
   A failure never clears anything: the overlay keeps the data it has, and this
   line says so explicitly.
   ========================================================================== */
(function () {
  'use strict';

  var CSS = [
    '.ds-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 2px}',
    '.ds-status{font:inherit;font-size:12.5px;opacity:.72;line-height:1.4}',
    '.ds-status[data-state="error"]{opacity:1;font-weight:600}',
    '.ds-status[data-state="busy"]{opacity:.9}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('ds-css')) return;
    var s = document.createElement('style');
    s.id = 'ds-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function clockOf(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function mount(opts) {
    injectCss();
    var button = opts.button, statusEl = opts.status;
    if (!button || !statusEl) return null;

    var busy = false;
    var cooldownUntil = 0;
    var lastAt = 0;
    var lastError = '';
    var ticker = null;

    function setStatus(text, state) {
      statusEl.textContent = text;
      statusEl.dataset.state = state || '';
    }

    function cooldownLeft() { return Math.max(0, cooldownUntil - Date.now()); }

    function render() {
      var left = cooldownLeft();
      button.disabled = busy || left > 0;
      if (busy) {
        button.textContent = 'Updating…';
        setStatus('asking the hub for a fresh reading…', 'busy');
        return;
      }
      button.textContent = left > 0 ? 'Update now (' + Math.ceil(left / 1000) + ')' : 'Update now';
      if (left > 0 && !lastError) {
        setStatus('updated ' + clockOf(lastAt) + ' — next update in ' + Math.ceil(left / 1000) + 's', 'ok');
        return;
      }
      if (lastError) {
        setStatus('update failed — ' + lastError + (lastAt
          ? '. Still on air: the data from ' + clockOf(lastAt) + '.'
          : '. Nothing has been fetched yet.'), 'error');
        return;
      }
      setStatus(lastAt ? 'last updated ' + clockOf(lastAt) : 'no data fetched yet', lastAt ? 'ok' : '');
    }

    function startTicker() {
      if (ticker) return;
      ticker = setInterval(function () {
        if (cooldownLeft() <= 0) { clearInterval(ticker); ticker = null; }
        render();
      }, 250);
    }

    function bumpCommand() {
      /* same command the overlay already polls; an action it knows */
      var cmd = opts.commandUrl || 'api/command?action=refresh';
      fetch(cmd + (cmd.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now(), { cache: 'no-store' })
        .catch(function () { /* the overlay also re-reads on its next scene load */ });
    }

    function readServerStatus(cb) {
      fetch('api/status?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.fetchedAt) { lastAt = Math.max(lastAt, j.fetchedAt); } cb && cb(); })
        .catch(function () { cb && cb(); });
    }

    function update() {
      if (busy || cooldownLeft() > 0) return;
      busy = true;
      lastError = '';
      render();

      var url;
      try { url = opts.buildUrl(true); } catch (e) {
        busy = false;
        lastError = (e && e.message) || 'nothing to update';
        render();
        return;
      }

      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 20000) : null;

      fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          return r.text().then(function (body) {
            var json = null;
            try { json = JSON.parse(body); } catch (e) { /* not JSON */ }
            if (!r.ok) {
              var msg = (json && json.error && json.error.message) || ('the hub answered HTTP ' + r.status);
              var err = new Error(msg);
              err.retryAfter = r.headers.get('retry-after');
              throw err;
            }
            var stamped = parseInt(r.headers.get('x-fetched-at') || '', 10);
            return { at: isFinite(stamped) && stamped > 0 ? stamped : Date.now(), cache: r.headers.get('x-cache') || '' };
          });
        })
        .then(function (out) {
          if (timer) clearTimeout(timer);
          busy = false;
          lastAt = out.at;
          lastError = '';
          cooldownUntil = Date.now() + (opts.cooldownMs == null ? 6000 : opts.cooldownMs);
          bumpCommand();
          render();
          startTicker();
          if (opts.onUpdated) opts.onUpdated(out);
        })
        .catch(function (e) {
          if (timer) clearTimeout(timer);
          busy = false;
          lastError = (e && e.name === 'AbortError') ? 'the hub did not answer in time'
            : String((e && e.message) || e);
          cooldownUntil = Date.now() + 2000;   /* short pause even on failure */
          render();
          startTicker();
        });
    }

    button.addEventListener('click', update);
    render();
    /* "last updated" should reflect data the overlay loaded before this page was
       opened, so ask the hub once. This is a local request, not a provider call. */
    readServerStatus(function () { render(); });

    return {
      update: update,
      state: function () { return { busy: busy, lastAt: lastAt, lastError: lastError, cooldown: cooldownLeft() }; }
    };
  }

  window.DataSync = { mount: mount };
})();
