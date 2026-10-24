#!/usr/bin/env node
/* ============================================================================
   Prediction Markets — tiny zero-dependency control server
   ----------------------------------------------------------------------------
   node server.js            → http://localhost:8791/admin.html
   PORT=9000 node server.js  → custom port

   This is for running the board ON ITS OWN. Normally you do not need it: the
   shared Overlays/server.js hub serves this app at /predictions/ alongside every
   other overlay, and that is the recommended way.

   What it does
     • serves the overlay / control panel over http (OBS likes http better than file://)
     • stores the live config in config.json  (GET/POST /api/config)
     • exposes a control API for a Stream Deck / Companion / curl:
         /api/command?action=in|out|replay|next|prev
         /api/command?action=show&index=2
         /api/state          (polled by the overlay)

   There is no upstream provider and no API key. Every market on the board is
   typed by hand in the control panel.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '8791', 10);
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
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4'
};

const ACTIONS = ['in', 'out', 'replay', 'next', 'prev', 'show'];

let state = { seq: 0, action: 'none', index: -1, ts: Date.now() };

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

/* Atomic write: temp file then rename, so a poller never reads a half-written
   config. On Windows a rename over a file another process holds open fails with
   EPERM/EBUSY/EACCES — an antivirus scanner, or our own read stream still
   draining a previous poll. Those are transient, so retry with real delays.
   The delay must yield to the event loop: spinning would block the read stream
   holding the lock, and every retry would fail. (This mirrors the shared hub's
   writeAtomic, which learned the same lesson on a Windows box.) */
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'];

async function writeAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);

  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      lastErr = e;
      if (TRANSIENT.indexOf(e.code) === -1) break;
      await sleepMs(30 * (attempt + 1));
    }
  }

  /* Last resort: write in place. A reader could catch a partial file, but on air
     a save that silently does nothing is the worse failure. */
  try {
    fs.writeFileSync(file, text);
    try { fs.unlinkSync(tmp); } catch (e2) { /* already gone */ }
    console.warn('  [config] atomic rename failed (' + (lastErr && lastErr.code) +
      ') — wrote in place instead');
    return true;
  } catch (e3) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* already gone */ }
    throw e3;
  }
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
    const action = ACTIONS.indexOf(requested) !== -1 ? requested : 'in';
    state = {
      seq: (readState().seq || 0) + 1,
      action,
      index: q.get('index') != null ? parseInt(q.get('index'), 10) : -1,
      ts: Date.now()
    };
    try { await writeAtomic(STATE_FILE, JSON.stringify(state)); } catch (e) { /* overlay still polls */ }
    console.log('[command]', state.action, state.index === -1 ? '' : '#' + state.index);
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
        JSON.parse(body); // validate before writing
        await writeAtomic(CONFIG_FILE, body);
        console.log('[config] saved (' + body.length + ' bytes)');
        return send(res, 200, JSON.stringify({ ok: true }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    }
  }

  /* -------------------------------------------------------------- static */
  const file = path.resolve(ROOT, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      /* config.json is optional: the overlay falls back to the shipped defaults */
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

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error('  ! port ' + PORT + ' is already in use — stop the other process, or');
    console.error('    start this one elsewhere:  PORT=9000 node server.js');
    console.error('');
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Prediction Markets control server');
  console.log('  ---------------------------------');
  console.log('  Admin / control :  http://localhost:' + PORT + '/admin.html');
  console.log('  Overlay (OBS)   :  http://localhost:' + PORT + '/index.html');
  console.log('  Next topic      :  http://localhost:' + PORT + '/api/command?action=next');
  console.log('  Previous topic  :  http://localhost:' + PORT + '/api/command?action=prev');
  console.log('');
});

process.on('SIGINT', () => { console.log('\n  shutting down\n'); process.exit(0); });
