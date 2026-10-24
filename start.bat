@echo off
rem ===========================================================================
rem  The Rollup overlays hub - launcher (Windows)
rem ---------------------------------------------------------------------------
rem    start.bat              check everything, install what is missing, start
rem    start.bat --check      check only, do not start the server
rem
rem  The server has NO npm dependencies. It is plain Node using only http, fs
rem  and path from the standard library. The single real requirement is
rem  Node.js 18 or newer, because the market proxy uses the global fetch() API
rem  that was added in Node 18.
rem
rem  Set PORT to override the default port, e.g.  set PORT=9000 ^&^& start.bat
rem ===========================================================================

setlocal EnableDelayedExpansion
title The Rollup overlays hub
cd /d "%~dp0"

set "MIN_NODE=18"
set "SERVER=server.js"
set "CHECK_ONLY="
set "NODE_OK="
set "PORT_FREE="
if not defined PORT set "PORT=8790"

for %%A in (%*) do (
  if /i "%%A"=="--check" set "CHECK_ONLY=1"
)

echo.
echo   The Rollup overlays hub
echo   ==========================================================
echo.

rem =============================================================== 1. Node.js
echo   [1/4] Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo         not found on PATH
  call :install_node
) else (
  for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VER=%%v"
  if defined NODE_VER (
    for /f "tokens=1 delims=." %%m in ("!NODE_VER!") do set "NODE_MAJOR=%%m"
    echo         found v!NODE_VER!
    if !NODE_MAJOR! LSS %MIN_NODE% (
      echo         too old - the proxy needs Node %MIN_NODE% or newer for fetch
      call :install_node
    ) else (
      echo         OK - version %MIN_NODE% or newer as required
      set "NODE_OK=1"
    )
  )
)
if not defined NODE_OK call :recheck_node
if not defined NODE_OK goto :fail_node

rem ========================================================== 2. Server file
echo.
echo   [2/4] Server file
if exist "%SERVER%" (
  echo         found %SERVER% in %CD%
) else (
  echo         MISSING - %SERVER% is not next to this script
  goto :fail_server
)

rem =========================================================== 3. Dependencies
echo.
echo   [3/4] Dependencies
if exist "package.json" (
  findstr /c:"\"dependencies\"" package.json >nul 2>nul
  if not errorlevel 1 (
    echo         package.json declares dependencies - installing
    where npm >nul 2>nul
    if errorlevel 1 goto :fail_deps
    call npm install --no-audit --no-fund
    if errorlevel 1 goto :fail_deps
    echo         dependencies installed
  ) else (
    echo         package.json declares none
  )
) else (
  echo         no package.json - nothing to install
)

rem Prove the built-ins the server actually uses are present. This string
rem contains no "!" on purpose - delayed expansion would swallow it.
node -e "var ok=true;['http','fs','path'].forEach(function(m){try{require(m)}catch(e){ok=false}});if(typeof fetch === 'undefined'){console.log('         FAIL - global fetch missing, Node 18+ required');process.exit(1)}if(ok === false){console.log('         FAIL - a core module is missing');process.exit(1)}console.log('         core modules present: http, fs, path');console.log('         global fetch available')"
if errorlevel 1 goto :fail_deps

rem ================================================================= 4. Port
echo.
echo   [4/4] Port %PORT%
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction Stop) { exit 1 } } catch { exit 0 }" >nul 2>nul
if errorlevel 1 (
  echo         already in use
  echo         another overlay server is probably still running.
  echo         Stop it, or pick another port:  set PORT=9000
) else (
  echo         free
  set "PORT_FREE=1"
)

if defined CHECK_ONLY (
  echo.
  echo   ==========================================================
  echo   All checks finished. Nothing was started because of --check.
  echo.
  endlocal
  exit /b 0
)

if not defined PORT_FREE (
  echo.
  echo   Refusing to start while port %PORT% is occupied.
  echo.
  pause
  endlocal
  exit /b 1
)

rem ==================================================================== start
echo.
echo   ==========================================================
echo   Starting the control server on port %PORT%
echo.
echo     Hub      http://localhost:%PORT%/
echo     Weather  http://localhost:%PORT%/weather/index.html
echo     Topics   http://localhost:%PORT%/topics/index.html
echo     Market   http://localhost:%PORT%/market/index.html
echo     Predictions http://localhost:%PORT%/predictions/index.html
echo.
echo   Press Ctrl+C to stop.
echo   ==========================================================
echo.

start "" "http://localhost:%PORT%/"
node "%SERVER%"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo   Server stopped.
) else (
  echo   The server exited with code %EXITCODE%.
)
echo.
pause
endlocal
exit /b %EXITCODE%

rem ============================================================== subroutines

:install_node
echo         attempting to install Node.js LTS
where winget >nul 2>nul
if errorlevel 1 goto :try_choco
echo         trying winget
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
if not errorlevel 1 (
  rem a brand new install is not on this shell's PATH yet
  set "PATH=!PATH!;C:\Program Files\nodejs"
  call :recheck_node
  if defined NODE_OK exit /b 0
)
echo         winget route did not complete

:try_choco
where choco >nul 2>nul
if errorlevel 1 goto :try_msi
echo         trying chocolatey
choco install nodejs-lts -y
if not errorlevel 1 (
  set "PATH=!PATH!;C:\Program Files\nodejs"
  call :recheck_node
  if defined NODE_OK exit /b 0
)
echo         chocolatey route did not complete

:try_msi
echo         falling back to the official installer
call :install_node_msi
exit /b 0

:recheck_node
where node >nul 2>nul
if errorlevel 1 exit /b 0
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VER=%%v"
if not defined NODE_VER exit /b 0
for /f "tokens=1 delims=." %%m in ("!NODE_VER!") do set "NODE_MAJOR=%%m"
if !NODE_MAJOR! GEQ %MIN_NODE% (
  echo         now running v!NODE_VER!
  set "NODE_OK=1"
)
exit /b 0

rem One PowerShell call does the whole job - resolve the newest LTS, download it
rem and run the installer. A single command avoids the nested-quote and
rem pipe-escaping traps a for /f around PowerShell would create.
:install_node_msi
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $arch = 'x64'; if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }; $rel = Invoke-RestMethod 'https://nodejs.org/dist/index.json'; $lts = $null; foreach ($r in $rel) { if ($r.lts) { $lts = $r; break } }; if (-not $lts) { Write-Host '         could not determine the current LTS'; exit 1 }; $url = 'https://nodejs.org/dist/' + $lts.version + '/node-' + $lts.version + '-' + $arch + '.msi'; $out = Join-Path $env:TEMP 'node-lts.msi'; Write-Host ('         downloading ' + $url); Invoke-WebRequest $url -OutFile $out; Write-Host '         installing - needs administrator rights and may prompt'; Start-Process msiexec -ArgumentList '/i', $out, '/qn', '/norestart' -Wait"
if errorlevel 1 (
  echo         installer route failed
  exit /b 1
)
set "PATH=!PATH!;C:\Program Files\nodejs"
call :recheck_node
exit /b 0

rem ================================================================== failures

:fail_node
echo.
echo   Node.js %MIN_NODE%+ is required and could not be installed automatically.
echo.
echo   Install it by hand from  https://nodejs.org/  using the LTS build, then
echo   close this window and run start.bat again.
echo.
pause
endlocal
exit /b 1

:fail_server
echo.
echo   %SERVER% was not found next to this script.
echo   Put start.bat in the same folder as server.js and try again.
echo.
pause
endlocal
exit /b 1

:fail_deps
echo.
echo   Dependencies could not be satisfied. See the messages above.
echo.
pause
endlocal
exit /b 1
