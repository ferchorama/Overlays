#!/usr/bin/env node
/* ============================================================================
   Talking Points Panel — tiny zero-dependency control server
   ----------------------------------------------------------------------------
   node server.js            → http://localhost:8787/admin.html
   PORT=9000 node server.js  → custom port

   What it does
     • serves the overlay / admin panel over http (OBS likes http better than file://)
     • stores the live config in config.json  (GET/POST /api/config)
     • exposes a control API for a Stream Deck / Companion / curl:
         /api/command?action=in|out|replay
         /api/state          (polled by the overlay)
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '8787', 10);
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
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4'
};

const ACTIONS = ['in', 'out', 'replay'];

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
    state = {
      seq: (readState().seq || 0) + 1,
      action: ACTIONS.indexOf(q.get('action')) !== -1 ? q.get('action') : 'in',
      index: q.get('index') != null ? parseInt(q.get('index'), 10) : -1,
      ts: Date.now()
    };
    fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});
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
        JSON.parse(body); // validate
        fs.writeFileSync(CONFIG_FILE, body);
        console.log('[config] saved (' + body.length + ' bytes)');
        return send(res, 200, JSON.stringify({ ok: true }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    }
  }

  /* -------------------------------------------------------------- static */
  let file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      // config.json is optional: fall back to the shipped defaults
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
  console.log('  Talking Points Panel control server');
  console.log('  ----------------------------------');
  console.log('  Admin / control :  http://localhost:' + PORT + '/admin.html');
  console.log('  Overlay (OBS)   :  http://localhost:' + PORT + '/index.html');
  console.log('  Command API     :  http://localhost:' + PORT + '/api/command?action=in');
  console.log('');
});
