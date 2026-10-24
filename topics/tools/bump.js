#!/usr/bin/env node
/* ============================================================================
   Cache-buster — bump the page version
   ----------------------------------------------------------------------------
   OBS (and every browser) caches whatever the browser source loaded, so a
   changed style.css / script.js can keep running the old code. Every local
   asset is therefore referenced with ?v=<version>; this script raises that
   version everywhere at once.

     node tools/bump.js            # patch  (3.0.1 → 3.0.2)  — the usual one
     node tools/bump.js minor      # 3.0.2 → 3.1.0
     node tools/bump.js major      # 3.1.0 → 4.0.0
     node tools/bump.js sync       # re-stamp with the current version (no bump)
     node tools/bump.js --check    # report only, change nothing

   It also ADDS ?v= to any local href/src (.css / .js / .html — including the
   admin preview iframe) that is missing one, and preserves other query
   parameters, so the HTML heals itself when a file is added by hand.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config.js');
const PAGES = ['index.html', 'admin.html'];
const ARG = (process.argv[2] || 'patch').replace(/^--/, '');
const CHECK = process.argv.includes('--check');
const SYNC = ARG === 'sync';

function readVersion() {
  const src = fs.readFileSync(CONFIG, 'utf8');
  const m = src.match(/version:\s*'(\d+)\.(\d+)\.(\d+)'/);
  if (!m) throw new Error('no version: "x.y.z" found in config.js (meta.version)');
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] };
}

function nextVersion(v, kind) {
  if (kind === 'major') return { major: v.major + 1, minor: 0, patch: 0 };
  if (kind === 'minor') return { major: v.major, minor: v.minor + 1, patch: 0 };
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}

/* a local asset = relative path, no scheme, no //host, no #anchor */
const isLocalAsset = (url) => url && !/^([a-z]+:|\/\/|#|data:|mailto:)/i.test(url);

function stamp(html, version) {
  const touches = [];
  const out = html.replace(/(\b(?:href|src)=")([^"]+)(")/g, (full, pre, url, post) => {
    if (!isLocalAsset(url)) return full;
    const hashAt = url.indexOf('#');
    const hash = hashAt === -1 ? '' : url.slice(hashAt);
    const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt);
    const qAt = withoutHash.indexOf('?');
    const file = qAt === -1 ? withoutHash : withoutHash.slice(0, qAt);
    const query = qAt === -1 ? '' : withoutHash.slice(qAt + 1);

    /* only pages and asset files, not arbitrary links */
    if (!/\.(css|js|html)$/i.test(file)) return full;

    const params = new URLSearchParams(query);
    const had = params.has('v');
    const oldV = params.get('v');
    params.set('v', version);
    const next = file + '?' + params.toString() + hash;

    if (url !== next) {
      touches.push((had ? 'bumped  ' : 'added   ') + file + (oldV ? ' ' + oldV + '→' + version : ''));
    }
    return pre + next + post;
  });
  return { out, touches };
}

function main() {
  const current = readVersion();
  const next = (CHECK || SYNC) ? current : nextVersion(current, ARG);
  const version = [next.major, next.minor, next.patch].join('.');
  const was = [current.major, current.minor, current.patch].join('.');

  console.log('\n  cache-buster');
  console.log('  ' + '-'.repeat(56));
  console.log('  version: ' + was +
    (CHECK ? '   (--check: nothing written)' : SYNC ? '   (sync: re-stamping only)' : '  →  ' + version));

  if (!CHECK && !SYNC) {
    const src = fs.readFileSync(CONFIG, 'utf8');
    fs.writeFileSync(CONFIG, src.replace(current.raw, "version: '" + version + "'"));
  }

  PAGES.forEach((page) => {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) return;
    const html = fs.readFileSync(file, 'utf8');
    const { out, touches } = stamp(html, version);
    if (!CHECK && out !== html) fs.writeFileSync(file, out);
    console.log('  ' + page.padEnd(13) + (touches.length ? touches.join(', ') : 'already up to date'));
  });

  console.log('  ' + '-'.repeat(56));
  console.log('  reload the OBS browser source (or enable "Refresh browser when scene becomes active")\n');
}

main();
