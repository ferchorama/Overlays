#!/usr/bin/env node
/* ============================================================================
   Package the suite for the Windows machine.

     node tools/package.js                  clean zip, no dev-only material
     node tools/package.js --with-skills    include the .skills reference docs
     node tools/package.js --out D:\x.zip   choose the output path

   Why this exists rather than "right-click, Compress": a zip made on macOS
   carries things that are junk or actively harmful on Windows —

     __MACOSX/ and ._*   AppleDouble resource forks. They appear as mystery
                         files beside every real one.
     .DS_Store           Finder metadata.
     extended attributes Without `zip -X`, per-file xattrs are stored, which is
                         what spawns the ._* files on extraction.

   The archive is built from the PARENT directory so it contains a single
   top-level folder. Extracting it cannot scatter files across the desktop.

   state.json is deliberately excluded: it holds the last command issued to an
   overlay, and shipping a stale one means a source can animate the moment it
   is added. config.json IS included — that is your saved settings.

   The 1080p crypto wallpaper is also excluded. It was a concept test and is not
   used by the Windows OBS setup, and at 1.8 MB it was the bulk of the archive.
   It stays on disk here because the test scene still references it.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');           // .../Overlays
const PARENT = path.dirname(ROOT);
const NAME = path.basename(ROOT);
const argv = process.argv.slice(2);
const WITH_SKILLS = argv.includes('--with-skills');
const outIdx = argv.indexOf('--out');
const OUT = outIdx !== -1 && argv[outIdx + 1]
  ? path.resolve(argv[outIdx + 1])
  : path.join(PARENT, NAME + '-windows.zip');

/* ------------------------------------------------------------------ checks */
function fail(msg) { console.error('\n  ' + msg + '\n'); process.exit(1); }

if (!fs.existsSync(path.join(ROOT, 'server.js'))) fail('server.js not found — run this from the project');
if (process.platform === 'win32') {
  fail('Build the archive on macOS or Linux. PowerShell\'s Compress-Archive does not\n' +
       '  understand the exclusion list below and will happily add the junk back.');
}
if (!fs.existsSync('/usr/bin/zip')) fail('the `zip` command is not available');

console.log('\n  packaging ' + NAME + ' for Windows\n  ' + '-'.repeat(58));
console.log('  output: ' + OUT);

/* -------------------------------------------------------------- exclusions
   -X keeps extended attributes out, which is what stops ._* files appearing. */
const EXCLUDE = [
  '*.DS_Store',
  '.DS_Store',
  '__MACOSX/*',
  '*/__MACOSX/*',
  '._*',
  '*/._*',
  '*.tmp',
  '*.bak',
  '*.orig',
  '*/state.json',            // stale command state — see the header
  '*/node_modules/*',
  'node_modules/*',
  '*-windows.zip',
  // concept test, not part of the Windows setup — see the header
  '*/assets/crypto-wallpaper-1080p.png'
];
if (!WITH_SKILLS) EXCLUDE.push('.skills/*', '*/.skills/*');

function sh(cmd, args, opts) {
  return execFileSync(cmd, args, Object.assign({ encoding: 'utf8', maxBuffer: 1 << 28 }, opts || {}));
}

/* ------------------------------------------------------------------- build */
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

const zipArgs = ['-r', '-X', '-q', OUT, NAME];
EXCLUDE.forEach((p) => { zipArgs.push('-x'); zipArgs.push(p); });

try {
  sh('zip', zipArgs, { cwd: PARENT });
} catch (e) {
  fail('zip failed: ' + (e.stderr || e.message));
}

/* ------------------------------------------------------------------ verify */
const listing = sh('unzip', ['-Z1', OUT]).split('\n').filter(Boolean);
const junk = listing.filter((f) =>
  /(^|\/)__MACOSX\//.test(f) || /(^|\/)\._/.test(f) || /\.DS_Store$/.test(f) ||
  /\.tmp$/.test(f) || /\.bak$/.test(f) || /state\.json$/.test(f));
const hasServer = listing.indexOf(NAME + '/server.js') !== -1;
const hasBat = listing.indexOf(NAME + '/start.bat') !== -1;
const hasCmd = listing.indexOf(NAME + '/start.command') !== -1;
const skills = listing.filter((f) => f.indexOf('/.skills/') !== -1).length;

/* the .bat must still carry CRLF inside the archive, or cmd.exe chokes */
let batEnding = 'n/a';
if (hasBat) {
  const buf = execFileSync('unzip', ['-p', OUT, NAME + '/start.bat'], { maxBuffer: 1 << 26 });
  const crlf = (buf.toString('latin1').match(/\r\n/g) || []).length;
  const stray = (buf.toString('latin1').match(/\r(?!\n)/g) || []).length;
  batEnding = stray === 0 && crlf > 200 ? 'CRLF, ' + crlf + ' lines, 0 stray CR' : 'BROKEN';
}

const size = fs.statSync(OUT).size;
const checks = [
  ['single top-level folder', hasServer, hasServer ? NAME + '/' : 'server.js not at the root'],
  ['start.bat present', hasBat, hasBat ? batEnding : 'missing'],
  ['start.command present', hasCmd, hasCmd ? 'ok' : 'missing'],
  ['no macOS junk inside the archive', junk.length === 0,
    junk.length ? junk.slice(0, 5).join(', ') : 'none'],
  ['no stale state.json', listing.every((f) => !/state\.json$/.test(f)), 'excluded'],
  [WITH_SKILLS ? '.skills included' : '.skills excluded', WITH_SKILLS ? skills > 0 : skills === 0,
    skills + ' files'],
  ['wallpaper excluded', listing.every((f) => f.indexOf('crypto-wallpaper') === -1), 'concept test'],
  ['size', true, (size / 1048576).toFixed(2) + ' MB, ' + listing.length + ' entries']
];

console.log('\n  entries: ' + listing.length + '\n');
let bad = 0;
checks.forEach(([name, pass, info]) => {
  if (!pass) bad++;
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name.padEnd(36) + (info || ''));
});
console.log('  ' + '-'.repeat(58));
console.log('  ' + (bad ? bad + ' problem(s) — do not ship this archive' : 'archive is clean') + '\n');
process.exit(bad ? 1 : 0);
