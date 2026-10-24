/* ============================================================================
   Shared search combobox
   ----------------------------------------------------------------------------
   One implementation of "type a name, pick from the matches" for every control
   panel: the weather city picker and the market asset picker must behave the
   same way — debounced, abortable, keyboard-operable, cached — and it was worth
   extracting rather than writing a second, subtly different one.

   Used as a classic script (no modules): window.createCombobox(opts).

   opts:
     input, list          the <input> and the <ul role="listbox">
     fetchResults(q, signal) → Promise<Array>      the caller does the fetching
     renderOption(item)   → { label, note, data }  one row
     onPick(item, api)    called with the chosen item
     itemKey(item)        stable key for repainting check / option ids
     optionAttrs(item)    → { name: value } extra attributes on <li>
     minChars (default 2), debounceMs (250), cacheMs (5 min)
     emptyText ('no matches'), itemClass, nameClass, whereClass
     onError(err)         called when the lookup fails (the list closes)

   The list is rebuilt from `fetchResults` only; nothing here knows what a city
   or a coin is.
   ========================================================================== */
(function () {
  'use strict';

  var DEFAULTS = {
    minChars: 2,
    debounceMs: 250,
    cacheMs: 5 * 60 * 1000,
    emptyText: 'no matches',
    itemClass: 'combo-item',
    nameClass: 'combo-item__name',
    whereClass: 'combo-item__where'
  };

  function createCombobox(opts) {
    var o = Object.assign({}, opts);
    Object.keys(DEFAULTS).forEach(function (k) { if (o[k] == null) o[k] = DEFAULTS[k]; });

    var input = o.input, list = o.list;
    var items = [], active = -1, timer = null, ctrl = null, reqId = 0, lastPaint = '';
    var cache = {};

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      if (input.removeAttribute) input.removeAttribute('aria-activedescendant');
      items = [];
      active = -1;
    }

    function attrs(el, map) {
      if (!map) return;
      Object.keys(map).forEach(function (k) { el.setAttribute(k, String(map[k])); });
    }

    function paint(results) {
      list.innerHTML = '';
      items = [];
      active = -1;
      lastPaint = results.length ? results.map(o.itemKey || function (r) { return String(r); }).join(',') : 'none';

      results.forEach(function (row, n) {
        var view = o.renderOption(row) || {};
        var el = document.createElement('li');
        el.className = o.itemClass;
        el.id = list.id + '-opt-' + n;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', 'false');
        attrs(el, o.optionAttrs ? o.optionAttrs(row) : null);

        var name = document.createElement('span');
        name.className = o.nameClass;
        name.textContent = String(view.label == null ? '' : view.label);
        el.appendChild(name);

        if (view.note) {
          var where = document.createElement('span');
          where.className = o.whereClass;
          where.textContent = String(view.note);
          el.appendChild(where);
        }

        /* keep focus in the input so the click is not eaten by the blur handler */
        el.addEventListener('mousedown', function (e) { if (e && e.preventDefault) e.preventDefault(); });
        el.addEventListener('click', function () { pick(row, view); });

        list.appendChild(el);
        items.push({ el: el, data: row, view: view });
      });

      if (!items.length) {
        var none = document.createElement('li');
        none.className = o.itemClass + ' ' + o.itemClass + '--none';
        none.setAttribute('role', 'presentation');
        none.textContent = o.emptyText;
        list.appendChild(none);
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function pick(row, view) {
      close();
      if (o.onPick) o.onPick(row, { view: view, close: close, api: api });
    }

    function setActive(n) {
      if (!items.length) return;
      active = ((n % items.length) + items.length) % items.length;
      items.forEach(function (it, k) {
        var on = k === active;
        it.el.setAttribute('aria-selected', on ? 'true' : 'false');
        it.el.classList.toggle('is-active', on);
        if (on) input.setAttribute('aria-activedescendant', it.el.id);
      });
      if (items[active].el.scrollIntoView) {
        try { items[active].el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older browsers */ }
      }
    }

    function search() {
      var q = String(input.value || '').trim();
      if (q.length < o.minChars) { close(); return; }
      var key = o.cacheKey ? o.cacheKey(q) : q.toLowerCase();
      var now = Date.now();
      var hit = cache[key];
      if (hit && now - hit.at < o.cacheMs) { paint(hit.results); return; }

      var my = ++reqId;
      if (ctrl && ctrl.abort) { try { ctrl.abort(); } catch (e) { /* already done */ } }
      ctrl = (typeof AbortController === 'function') ? new AbortController() : null;

      Promise.resolve(o.fetchResults(q, ctrl ? ctrl.signal : null))
        .then(function (results) {
          if (my !== reqId) return;                     /* a newer query won */
          var list2 = Array.isArray(results) ? results : [];
          cache[key] = { at: Date.now(), results: list2 };
          paint(list2);
        })
        .catch(function (e) {
          if (my !== reqId) return;
          close();
          if (o.onError) o.onError(e);
        });
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(search, o.debounceMs);
    }

    var api = {
      schedule: schedule,
      search: search,
      close: close,
      isOpen: function () { return !list.hidden; },
      lastPaint: function () { return lastPaint; },
      isActive: function () { return active; }
    };

    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.addEventListener('focus', function () {
      if (String(input.value || '').trim().length >= o.minChars) search();
    });
    input.addEventListener('blur', function () {
      /* after the browser has had a chance to deliver the option's click */
      setTimeout(close, 120);
    });
    input.addEventListener('keydown', function (e) {
      var k = e && e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (list.hidden) { search(); return; }
        if (e.preventDefault) e.preventDefault();
        setActive(active + (k === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (k === 'Enter') {
        if (!list.hidden && active >= 0 && items[active]) {
          if (e.preventDefault) e.preventDefault();
          pick(items[active].data, items[active].view);
        }
        return;
      }
      if (k === 'Escape') { if (!list.hidden) { if (e.preventDefault) e.preventDefault(); close(); } return; }
      if (k === 'Tab') close();
    });

    return api;
  }

  window.createCombobox = createCombobox;
})();
