#!/usr/bin/env node
/* ============================================================================
   Shared "Update now" control — behaviour test

     node tests/datasync.js

   The button is the only path by which an operator can force a provider read, so
   its guards are the thing worth testing:
     • one request per press (in-flight guard)
     • a cooldown after success, so a double-click is not two provider calls
     • the command the overlay polls is bumped ONLY on success
     • a failure keeps the previous "last updated" and says so (the overlay is
       left alone, so its data stays on screen)
     • busy / cooldown states disable the button
   ========================================================================== */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ shim */
function el(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    textContent: '',
    className: '',
    dataset: {},
    disabled: false,
    _handlers: {},
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(k, fn) { (this._handlers[k] = this._handlers[k] || []).push(fn); },
    fire(k) { (this._handlers[k] || []).forEach((fn) => fn({ preventDefault() {} })); }
  };
}
const head = el('head');
global.document = { createElement: (t) => el(t), getElementById: () => null, head };
global.window = global;

global.fetch = () => Promise.reject(new Error('fetch stub not primed'));

require(path.join(ROOT, 'shared', 'datasync.js'));

/* ----------------------------------------------------------------- tests */
const results = [];
const check = (name, pass, info) => results.push({ name, pass, info });
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));

function reply(body, opts) {
  opts = opts || {};
  return Promise.resolve({
    ok: opts.ok !== false,
    status: opts.status || 200,
    headers: { get: (h) => (h.toLowerCase() === 'x-fetched-at' ? String(opts.at || 0) : null) },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body)
  });
}

function mount(opts) {
  const button = el('button');
  const status = el('span');
  const calls = { data: 0, command: 0, status: 0 };
  const urls = [];
  let mode = 'ok';
  let gate = null;

  global.fetch = (url, init) => {
    const u = String(url);
    urls.push(u);
    if (u.indexOf('api/status') !== -1) {
      calls.status++;
      return reply({ ok: true, fetchedAt: 5000, hasData: true });
    }
    if (u.indexOf('api/command') !== -1) {
      calls.command++;
      return reply({ ok: true });
    }
    if (u.indexOf('api/data') !== -1) {
      calls.data++;
      if (gate) return gate;
      if (mode === 'fail') {
        return reply({ error: { code: 'upstream_rate_limited', message: 'upstream HTTP 429' } }, { ok: false, status: 502 });
      }
      return reply([], { at: 9000 });
    }
    return reply({});
  };

  const handle = window.DataSync.mount(Object.assign({
    button, status,
    buildUrl: (force) => 'api/data?force=' + (force ? '1' : '0'),
    commandUrl: 'api/command?action=refresh',
    cooldownMs: 400,
    timeoutMs: 2000
  }, opts));

  return {
    button, status, calls, urls, handle,
    setMode(m) { mode = m; },
    setGate(p) { gate = p; }
  };
}

(async function main() {
  /* ------------------------------------------------ happy path + cooldown */
  const a = mount();
  await wait(10);
  check('boot asks the hub for the last-updated time', a.calls.status === 1, a.calls.status + ' status request(s)');
  check('boot shows a last-updated line', /last updated \d\d:\d\d:\d\d/.test(a.status.textContent),
    a.status.textContent);

  a.button.fire('click');
  check('pressing update marks the control busy', a.button.disabled === true && /Updating/.test(a.button.textContent),
    a.button.textContent);

  await wait(10);
  check('one press makes exactly one data request', a.calls.data === 1, a.calls.data + ' request(s)');
  check('the request is a forced read', /force=1/.test(a.urls.filter((u) => u.indexOf('api/data') !== -1).pop() || ''),
    a.urls.filter((u) => u.indexOf('api/data') !== -1).pop());
  check('success bumps the command the overlay polls', a.calls.command === 1, a.calls.command + ' command(s)');
  check('success shows when it happened', /updated \d\d:\d\d:\d\d/.test(a.status.textContent), a.status.textContent);
  check('the cooldown disables the button', a.button.disabled === true && /Update now \(\d+\)/.test(a.button.textContent),
    a.button.textContent);

  a.button.fire('click');
  await wait(10);
  check('a click during the cooldown does nothing', a.calls.data === 1, a.calls.data + ' request(s)');

  /* cooldown expires → button back */
  await wait(650);
  check('the button comes back after the cooldown',
    a.button.disabled === false && a.button.textContent === 'Update now', a.button.textContent);

  /* -------------------------------------------------------------- failure */
  const b = mount({ cooldownMs: 0 });
  await wait(10);
  const lastAtBefore = b.status.textContent;
  b.setMode('fail');
  b.button.fire('click');
  await wait(20);
  check('a failure is reported with the upstream reason', /update failed — upstream HTTP 429/.test(b.status.textContent),
    b.status.textContent);
  check('a failure says the previous data is still on air', /Still on air/.test(b.status.textContent),
    b.status.textContent);
  check('a failure does not bump the command', b.calls.command === 0, b.calls.command + ' command(s)');
  check('a failure keeps the previous timestamp', /last updated|updated \d\d:\d\d:\d\d/.test(lastAtBefore),
    lastAtBefore);

  /* ------------------------------------------------------- in-flight guard */
  const c = mount({ cooldownMs: 0 });
  await wait(10);
  let release;
  c.setGate(new Promise((resolve) => {
    release = () => resolve(reply([], { at: 9100 }));
  }));
  c.button.fire('click');
  c.button.fire('click');
  await wait(10);
  check('two clicks while a request is in flight make one request', c.calls.data === 1,
    c.calls.data + ' request(s)');
  release();
  await wait(20);
  check('the guard clears after the response', c.button.disabled === false, 'disabled=' + c.button.disabled);
  check('only one command was sent', c.calls.command === 1, c.calls.command + ' command(s)');

  /* --------------------------------------------------------------- report */
  let failed = 0;
  console.log('\n  dashboard "Update now"\n  ' + '-'.repeat(58));
  results.forEach((r) => {
    if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.info ? '   [' + r.info + ']' : ''));
  });
  console.log('  ' + '-'.repeat(58));
  console.log('  ' + (results.length - failed) + '/' + results.length + ' checks passed\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('\n  datasync test crashed: ' + (e && e.stack) + '\n');
  process.exit(1);
});
