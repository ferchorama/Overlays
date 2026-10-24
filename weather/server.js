#!/usr/bin/env node
/* ============================================================================
   Vertical Weather Overlay — tiny zero-dependency control server
   ----------------------------------------------------------------------------
   node server.js            → http://localhost:8788/admin.html
   PORT=9000 node server.js  → custom port

     • serves the overlay / admin panel over http (OBS prefers http to file://)
     • stores the live config in config.json      (GET/POST /api/config)
     • control API for a Stream Deck / Companion / curl:
         /api/command?action=in|hide|refresh
         /api/state          (polled by the overlay)
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '8788', 10);
const CONFIG_FILE = path.join(ROOT, 'config.json');
const STATE_FILE = path.join(ROOT, 'state.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const ACTIONS = ['in', 'play', 'hide', 'out', 'refresh', 'update'];

let state = { seq: 0, action: 'none', index: -1, ts: Date.now() };

/* Atomic write: the overlay polls config.json every couple of seconds, so a
   half-written file must never be observable. */
function writeAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { return state; }
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/* Resolve a URL path inside this app directory, refusing anything that escapes.
   A plain startsWith() is not enough: '/root/app' would also match
   '/root/app-secret'. Compare against the directory boundary.

   Dot-segments are refused outright. This app vendors a `.skills/` tree of
   third-party reference documents that nothing loads at runtime, and those are
   plain files inside the app directory — so without this rule
   `/.skills/hallmark/SKILL.md` was served like any other asset. Nothing the
   overlay actually requests has a leading dot, so the rule costs nothing. */
function resolveInside(root, urlPath) {
  const clean = urlPath.replace(/^\/+/, '');
  if (clean.split(/[\\/]+/).some((seg) => seg.charAt(0) === '.')) return null;
  const full = path.resolve(root, clean);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(parsed.pathname);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ---------------------------------------------------------- control API */
  if (pathname === '/api/state') {
    state = readState();
    return send(res, 200, JSON.stringify(state));
  }

  if (pathname === '/api/command') {
    const q = parsed.searchParams;
    const requested = q.get('action');
    if (requested && ACTIONS.indexOf(requested) === -1) {
      /* explicit, self-describing error for Stream Deck / Companion debugging */
      return send(res, 400, JSON.stringify({
        ok: false,
        error: 'unknown action "' + requested + '"',
        allowed: ACTIONS
      }));
    }
    const action = requested || 'in';
    state = { seq: (readState().seq || 0) + 1, action, index: -1, ts: Date.now() };
    try { writeAtomic(STATE_FILE, JSON.stringify(state)); } catch (e) { /* overlay still polls memory */ }
    console.log('[command]', action);
    return send(res, 200, JSON.stringify({ ok: true, state }));
  }

  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      let body = '{}';
      try { body = fs.readFileSync(CONFIG_FILE, 'utf8'); } catch (e) { /* none yet */ }
      return send(res, 200, body);
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const parsedCfg = JSON.parse(body);          /* validate before touching disk */
        if (!parsedCfg || typeof parsedCfg !== 'object' || Array.isArray(parsedCfg)) {
          return send(res, 400, JSON.stringify({ ok: false, error: 'config must be a JSON object' }));
        }
        writeAtomic(CONFIG_FILE, JSON.stringify(parsedCfg, null, 2));
        console.log('[config] saved (' + body.length + ' bytes)');
        return send(res, 200, JSON.stringify({ ok: true, keys: Object.keys(parsedCfg).length }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    }
  }

  /* -------------------------------------------------------------- static */
  const file = resolveInside(ROOT, pathname === '/' ? '/index.html' : pathname);
  if (!file) return send(res, 403, 'forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      if (path.basename(file) === 'config.json') return send(res, 200, '{}');
      return send(res, 404, 'not found: ' + pathname, 'text/plain');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Vertical Weather Overlay — control server');
  console.log('  -----------------------------------------');
  console.log('  Admin / control :  http://localhost:' + PORT + '/admin.html');
  console.log('  Overlay (OBS)   :  http://localhost:' + PORT + '/index.html');
  console.log('  Refresh now     :  http://localhost:' + PORT + '/api/command?action=refresh');
  console.log('');
});
