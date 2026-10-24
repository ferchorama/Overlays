#!/bin/bash
# ============================================================================
#  The Rollup overlays hub — launcher (macOS)
# ----------------------------------------------------------------------------
#    start.command            check everything, install what is missing, start
#    start.command --check    check only, do not start the server
#
#  This is the macOS counterpart of start.bat. Double-click it in Finder, or
#  run ./start.command from a Terminal.
#
#  The server has NO npm dependencies — plain Node using only http, fs and path
#  from the standard library. The one real requirement is Node.js 18 or newer,
#  because the market proxy uses the global fetch() API added in Node 18.
#
#  Set PORT to override the default, e.g.  PORT=9000 ./start.command
# ============================================================================

set -u
cd "$(dirname "$0")" || exit 1

MIN_NODE=18
SERVER="server.js"
PORT="${PORT:-8790}"
CHECK_ONLY=0
NODE_OK=0
PORT_FREE=0

# ── output helpers ───────────────────────────────────────────────────────────
BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'

step()  { printf '  %s\n' "$1"; }
good()  { printf '        %s%s%s\n' "$GREEN" "$1" "$RESET"; }
warn()  { printf '        %s%s%s\n' "$YELLOW" "$1" "$RESET"; }
bad()   { printf '        %s%s%s\n' "$RED" "$1" "$RESET"; }
det()   { printf '        %s%s%s\n' "$DIM" "$1" "$RESET"; }

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
  esac
done

echo
printf '  %sThe Rollup overlays hub%s\n' "$BOLD" "$RESET"
echo "  =========================================================="
echo

# ── 1. Node.js ───────────────────────────────────────────────────────────────
echo "  [1/4] Node.js"

node_major() {
  command -v node >/dev/null 2>&1 || return 1
  node -p "process.versions.node.split('.')[0]" 2>/dev/null
}

recheck_node() {
  local major
  major="$(node_major)" || return 0
  [ -n "$major" ] || return 0
  if [ "$major" -ge "$MIN_NODE" ]; then
    good "now running v$(node -p 'process.versions.node')"
    NODE_OK=1
  fi
}

install_node() {
  if command -v brew >/dev/null 2>&1; then
    step "installing via Homebrew"
    if brew install node >/dev/null 2>&1; then
      recheck_node
      [ "$NODE_OK" -eq 1 ] && return 0
    fi
    warn "Homebrew route did not complete"
  else
    det "Homebrew not installed, skipping that route"
  fi

  # No Node means no Node to parse JSON with, so the LTS version is scraped
  # with grep/sed rather than a JSON parser. macOS pkg builds are universal,
  # so there is no architecture to pick.
  step "falling back to the official installer"
  local ver
  ver="$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null \
    | tr '}' '\n' \
    | grep -m1 '"lts":"' \
    | sed -n 's/.*"version":"\(v[0-9][0-9.]*\)".*/\1/p')"

  if [ -z "$ver" ]; then
    bad "could not reach nodejs.org"
    return 1
  fi

  local pkg="/tmp/node-$ver.pkg"
  det "downloading node-$ver.pkg"
  if ! curl -fL "https://nodejs.org/dist/$ver/node-$ver.pkg" -o "$pkg" 2>/dev/null; then
    bad "download failed"
    return 1
  fi

  step "installing — this asks for your password"
  if sudo installer -pkg "$pkg" -target / ; then
    rm -f "$pkg"
    recheck_node
    return 0
  fi
  bad "installer returned an error"
  return 1
}

MAJOR="$(node_major || true)"
if [ -z "${MAJOR:-}" ]; then
  step "not found on PATH"
  install_node
elif [ "$MAJOR" -lt "$MIN_NODE" ]; then
  step "found v$(node -p 'process.versions.node')"
  warn "too old — the proxy needs Node $MIN_NODE+ for fetch()"
  install_node
else
  step "found v$(node -p 'process.versions.node')"
  good "OK — version $MIN_NODE or newer as required"
  NODE_OK=1
fi

if [ "$NODE_OK" -ne 1 ]; then
  echo
  echo "  Node.js $MIN_NODE+ is required and could not be installed automatically."
  echo "  Install it from https://nodejs.org/ (LTS), then run this again."
  echo
  read -r -p "  Press Return to close. " _
  exit 1
fi

# ── 2. Server file ───────────────────────────────────────────────────────────
echo
echo "  [2/4] Server file"
if [ -f "$SERVER" ]; then
  step "found $SERVER in $(pwd)"
else
  bad "MISSING — $SERVER is not next to this script"
  echo
  echo "  Put start.command in the same folder as server.js and try again."
  echo
  read -r -p "  Press Return to close. " _
  exit 1
fi

# ── 3. Dependencies ──────────────────────────────────────────────────────────
echo
echo "  [3/4] Dependencies"
if [ -f package.json ]; then
  if grep -q '"dependencies"' package.json 2>/dev/null; then
    step "package.json declares dependencies — installing"
    if command -v npm >/dev/null 2>&1 && npm install --no-audit --no-fund; then
      good "dependencies installed"
    else
      bad "npm install failed"
      read -r -p "  Press Return to close. " _
      exit 1
    fi
  else
    step "package.json declares none"
  fi
else
  step "no package.json — nothing to install"
fi

# Prove the built-ins the server actually uses are present.
if node -e "var ok=true;['http','fs','path'].forEach(function(m){try{require(m)}catch(e){ok=false}});if(typeof fetch === 'undefined'){process.exit(1)}if(ok === false){process.exit(2)}"; then
  good "core modules present: http, fs, path"
  good "global fetch available"
else
  bad "the runtime is missing something the server needs"
  read -r -p "  Press Return to close. " _
  exit 1
fi

# ── 4. Port ──────────────────────────────────────────────────────────────────
echo
echo "  [4/4] Port $PORT"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  warn "already in use"
  det "another overlay server is probably still running"
  det "stop it, or pick another port:  PORT=9000 ./start.command"
else
  good "free"
  PORT_FREE=1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo
  echo "  =========================================================="
  echo "  All checks finished. Nothing was started because of --check."
  echo
  exit 0
fi

if [ "$PORT_FREE" -ne 1 ]; then
  echo
  echo "  Refusing to start while port $PORT is occupied."
  echo
  read -r -p "  Press Return to close. " _
  exit 1
fi

# ── start ────────────────────────────────────────────────────────────────────
echo
echo "  =========================================================="
echo "  Starting the control server on port $PORT"
echo
echo "    Hub      http://localhost:$PORT/"
echo "    Weather  http://localhost:$PORT/weather/index.html"
echo "    Topics   http://localhost:$PORT/topics/index.html"
echo "    Market   http://localhost:$PORT/market/index.html"
echo
echo "  Press Ctrl+C to stop."
echo "  =========================================================="
echo

open "http://localhost:$PORT/" 2>/dev/null || true
node "$SERVER"
EXITCODE=$?

echo
if [ "$EXITCODE" -eq 0 ]; then
  echo "  Server stopped."
else
  echo "  The server exited with code $EXITCODE."
fi
echo
read -r -p "  Press Return to close. " _
exit "$EXITCODE"
