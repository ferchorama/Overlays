@echo off
rem ===========================================================================
rem  The Rollup overlays hub - installer / updater (Windows)
rem ---------------------------------------------------------------------------
rem    update.bat                  install or update the folder this script is in
rem    update.bat D:\OBS\Overlays  install or update another folder
rem    update.bat --zip            the same, without Git (downloads the branch zip)
rem    update.bat --start          run start.bat when the files are in place
rem
rem  Empty folder  -> git clone            (first install)
rem  Clone         -> git pull --ff-only   (fast-forward only, never rewrites)
rem  Zip copy      -> git init + checkout  (becomes a clone in place)
rem  No Git        -> winget install Git.Git; if winget is not there, the script
rem                   stops and prints the Git for Windows download link.
rem                   --zip needs no Git at all.
rem
rem  Your settings live in {app}/config.json. They are copied aside and put back
rem  after the files are replaced, and a dirty working tree is stashed and
rem  restored rather than thrown away. state.json is never touched.
rem
rem  Nothing here force-pushes or rewrites a commit: an update can only move
rem  forward, and old versions stay downloadable from GitHub.
rem ===========================================================================

setlocal EnableDelayedExpansion
title The Rollup overlays - update

set "REPO_URL=https://github.com/ferchorama/Overlays.git"
set "BRANCH=main"
set "APPS=weather topics market predictions"
set "PF86=%ProgramFiles(x86)%"
if defined OVERLAYS_REPO_URL set "REPO_URL=%OVERLAYS_REPO_URL%"

rem A pull can replace this very file while cmd.exe is still reading it, and a
rem half-read batch file executes garbage. Re-run a copy from %TEMP% instead and
rem hand it the real folder through the environment.
if /i "%~1"=="__relaunched" goto :run
if not defined OVL_SELF_DIR set "OVL_SELF_DIR=%~dp0"
copy /y "%~f0" "%TEMP%\overlays-update.bat" >nul 2>nul
if errorlevel 1 goto :run
call "%TEMP%\overlays-update.bat" __relaunched %*
set "RC=%ERRORLEVEL%"
del "%TEMP%\overlays-update.bat" >nul 2>nul
endlocal & exit /b %RC%

:run
rem ------------------------------------------------------------------- options
set "TARGET=!OVL_SELF_DIR!"
set "DO_START="
set "FORCE_ZIP="

:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="__relaunched" goto :next_arg
if /i "%~1"=="--zip" goto :arg_zip
if /i "%~1"=="--start" goto :arg_start
if /i "%~1"=="--help" goto :help
if /i "%~1"=="-h" goto :help
set "TARGET=%~1"
goto :next_arg
:arg_zip
set "FORCE_ZIP=1"
goto :next_arg
:arg_start
set "DO_START=1"
:next_arg
shift
goto :parse

:parsed
if not defined TARGET set "TARGET=%CD%"
for %%A in ("!TARGET!.") do set "TARGET=%%~fA"
if "!TARGET:~-1!"=="\" set "TARGET=!TARGET:~0,-1!"
if not exist "!TARGET!" (
  mkdir "!TARGET!" >nul 2>nul
  if errorlevel 1 goto :fail_target
)

echo.
echo   The Rollup overlays hub - update
echo   ==========================================================
echo.
echo   Folder
echo         !TARGET!
echo.

rem Do not surprise somebody who double-clicked this in Downloads: only folders
rem that already look like an overlays install go ahead without asking.
if exist "!TARGET!\server.js" goto :known_folder
if exist "!TARGET!\.git" goto :known_folder
set "OTHER="
for /f "delims=" %%f in ('dir /b "!TARGET!" 2^>nul') do if /i not "%%f"=="update.bat" set "OTHER=1"
if not defined OTHER goto :known_folder
echo   That folder already has files in it. The overlays will be added next to
echo   them (no existing file is deleted).
echo.
choice /c YN /n /m "  Continue? [Y/N] "
if errorlevel 2 goto :cancel
:known_folder

rem ==================================================================== 1. Git
echo.
echo   [1/3] Git
if defined FORCE_ZIP goto :git_skipped
where git >nul 2>nul
if not errorlevel 1 goto :git_found
call :find_installed_git
where git >nul 2>nul
if not errorlevel 1 goto :git_found
echo         not on this computer - trying winget
call :install_git
where git >nul 2>nul
if not errorlevel 1 goto :git_found
goto :fail_no_git
:git_skipped
echo         skipped - --zip was given
goto :mode_files

:git_found
set "GIT_OK=1"
for /f "delims=" %%v in ('git --version 2^>nul') do echo         found %%v

rem ================================================================== 2. Files
:mode_files
echo.
echo   [2/3] Files
if not defined GIT_OK goto :do_zip
if exist "!TARGET!\.git" goto :do_pull
if exist "!TARGET!\server.js" goto :do_attach
echo         nothing here yet - cloning from GitHub
call :clone_repo
if errorlevel 1 goto :fail_clone
goto :files_done

:do_pull
echo         clone found - pulling the latest commits
call :pull_repo
if errorlevel 1 goto :fail_pull
goto :files_done

:do_attach
echo         files found, but no Git history - attaching this folder to GitHub
call :attach_repo
if errorlevel 1 goto :fail_attach
goto :files_done

:do_zip
echo         downloading the %BRANCH% zip from GitHub
call :zip_update
if errorlevel 1 goto :fail_zip

:files_done
rem ================================================================== 3. Check
echo.
echo   [3/3] Check
if not exist "!TARGET!\server.js" goto :fail_verify
echo         server.js present
for %%A in (%APPS%) do if not exist "!TARGET!\%%A\index.html" goto :fail_verify
echo         all four overlays present
if not exist "!TARGET!\.git" goto :no_revision
pushd "!TARGET!"
git log -1 --format="         revision %%h  %%s" 2>nul
popd
:no_revision

if defined DO_START (
  echo.
  echo   Starting the hub ...
  echo.
  call "!TARGET!\start.bat"
)

echo.
echo   ==========================================================
if defined GIT_OK (
  echo   Files are up to date.
) else (
  echo   Files are up to date - zip mode, install Git for incremental updates.
)
echo.
echo   Start the overlays:  "!TARGET!\start.bat"
echo.
pause
endlocal
exit /b 0

rem ================================================================ subroutines

:find_installed_git
rem A just-installed Git is not on this shell's PATH yet. Look in the two usual
rem install locations and add whichever exists to PATH for this run only.
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GITBIN=%ProgramFiles%\Git\cmd"
if not defined GITBIN if exist "!PF86!\Git\cmd\git.exe" set "GITBIN=!PF86!\Git\cmd"
if not defined GITBIN if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GITBIN=%LOCALAPPDATA%\Programs\Git\cmd"
if not defined GITBIN exit /b 0
set "PATH=!PATH!;!GITBIN!"
echo         found a Git install - using it for this run
exit /b 0

:install_git
where winget >nul 2>nul
if errorlevel 1 exit /b 0
echo         installing Git with winget
winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
rem A fresh install is not on this shell's PATH yet.
call :find_installed_git
exit /b 0

rem --------------------------------------------------------------- settings
rem config.json is the operator's saved settings. It is tracked in git, but it
rem is local state: an update must never reset it.
:save_settings
set "SETTINGS=%TEMP%\overlays-settings-%RANDOM%%RANDOM%"
mkdir "!SETTINGS!" >nul 2>nul
for %%A in (%APPS%) do (
  if exist "!TARGET!\%%A\config.json" copy /y "!TARGET!\%%A\config.json" "!SETTINGS!\%%A.json" >nul 2>nul
)
exit /b 0

:restore_settings
if not defined SETTINGS exit /b 0
for %%A in (%APPS%) do (
  if exist "!SETTINGS!\%%A.json" copy /y "!SETTINGS!\%%A.json" "!TARGET!\%%A\config.json" >nul 2>nul
)
rmdir /s /q "!SETTINGS!" >nul 2>nul
exit /b 0

rem ----------------------------------------------------------------- install
:clone_repo
set "TMPCLONE=%TEMP%\overlays-clone-%RANDOM%%RANDOM%"
if exist "!TMPCLONE!" rmdir /s /q "!TMPCLONE!"
git clone --quiet "%REPO_URL%" "!TMPCLONE!"
if errorlevel 1 goto :clone_fail
call :save_settings
call :copy_tree "!TMPCLONE!" "!TARGET!"
if errorlevel 1 (
  call :restore_settings
  rmdir /s /q "!TMPCLONE!" >nul 2>nul
  exit /b 1
)
call :restore_settings
rmdir /s /q "!TMPCLONE!" >nul 2>nul
exit /b 0
:clone_fail
rmdir /s /q "!TMPCLONE!" >nul 2>nul
exit /b 1

rem A folder that came from a zip has the files but no history. Make it a real
rem clone in place: init, point it at GitHub, then check the upstream tree out.
:attach_repo
pushd "!TARGET!"
call :save_settings
git init --quiet
if errorlevel 1 goto :attach_fail
git remote remove origin >nul 2>nul
git remote add origin "%REPO_URL%"
if errorlevel 1 goto :attach_fail
git fetch --quiet origin
if errorlevel 1 goto :attach_fail
git checkout --quiet -f -B %BRANCH% origin/%BRANCH%
if errorlevel 1 goto :attach_fail
call :restore_settings
popd
exit /b 0
:attach_fail
call :restore_settings
popd
exit /b 1

rem -------------------------------------------------------------------- pull
:pull_repo
pushd "!TARGET!"
call :save_settings
for /f "delims=" %%h in ('git rev-parse --short HEAD 2^>nul') do set "OLDHEAD=%%h"
git fetch --prune origin
if errorlevel 1 goto :pull_fail

rem This folder should be on %BRANCH%. A rollback may have detached HEAD, and a
rem pull on a detached head refuses to run, so put it back on the branch first.
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CURRENT=%%b"
if /i "!CURRENT!"=="%BRANCH%" goto :pull_merge
echo         this folder is on "!CURRENT!" - switching back to %BRANCH%
git checkout %BRANCH% >nul 2>nul
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CURRENT=%%b"
if /i not "!CURRENT!"=="%BRANCH%" goto :pull_fail

:pull_merge
git merge --ff-only origin/%BRANCH% >nul 2>nul
if not errorlevel 1 goto :pull_ok

rem A panel may have saved settings since the last update, and those edits are
rem legitimate local changes. Set them aside, take the update, put them back.
set "LOCAL_DIRTY="
for /f "usebackq delims=" %%l in (`git status --porcelain`) do set "LOCAL_DIRTY=1"
if not defined LOCAL_DIRTY goto :pull_fail
echo         keeping your local changes aside for the pull
git stash push -m "update.bat: local changes before pull" >nul 2>nul
if errorlevel 1 goto :pull_fail
git merge --ff-only origin/%BRANCH% >nul 2>nul
if errorlevel 1 (
  git stash pop >nul 2>nul
  goto :pull_fail
)
git stash pop >nul 2>nul
if errorlevel 1 (
  echo.
  echo         WARNING: the update and your local changes touch the same file.
  echo         Nothing was thrown away: they are kept in `git stash list`, and
  echo         the saved settings have been put back on disk.
  git reset --quiet >nul 2>nul
  call :restore_settings
)

:pull_ok
call :restore_settings
for /f "delims=" %%h in ('git rev-parse --short HEAD 2^>nul') do set "NEWHEAD=%%h"
if /i "!OLDHEAD!"=="!NEWHEAD!" (
  echo         already up to date
) else (
  for /f "delims=" %%c in ('git rev-list --count !OLDHEAD!..HEAD 2^>nul') do echo         updated: %%c new commits, now at !NEWHEAD!
)
popd
exit /b 0

:pull_fail
call :restore_settings
popd
exit /b 1

rem --------------------------------------------------------------------- zip
rem The last resort for a locked-down machine: no Git, no administrator, just
rem PowerShell downloading the branch archive and the files being copied in.
:zip_update
set "ZTMP=%TEMP%\overlays-zip-%RANDOM%%RANDOM%"
set "ZIPURL=https://codeload.github.com/ferchorama/Overlays/zip/refs/heads/%BRANCH%"
if defined OVERLAYS_ZIP_URL set "ZIPURL=%OVERLAYS_ZIP_URL%"
mkdir "!ZTMP!" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; $u='!ZIPURL!'; $o='!ZTMP!\repo.zip'; if ($u -match '^[A-Za-z][A-Za-z0-9+.-]*://') { Invoke-WebRequest -Uri $u -OutFile $o } else { Copy-Item -LiteralPath $u -Destination $o }; Expand-Archive -LiteralPath $o -DestinationPath '!ZTMP!\x' -Force"
if errorlevel 1 goto :zip_fail
set "SRC="
for /d %%d in ("!ZTMP!\x\*") do set "SRC=%%~fd"
if not defined SRC goto :zip_fail
if not exist "!SRC!\server.js" goto :zip_fail
call :save_settings
call :copy_tree "!SRC!" "!TARGET!"
if errorlevel 1 (
  call :restore_settings
  goto :zip_fail
)
call :restore_settings
rmdir /s /q "!ZTMP!" >nul 2>nul
exit /b 0
:zip_fail
rmdir /s /q "!ZTMP!" >nul 2>nul
exit /b 1

:copy_tree
xcopy "%~1" "%~2\" /E /I /Y /H /Q >nul
if errorlevel 1 exit /b 1
exit /b 0

rem ================================================================== failures

:fail_target
echo.
echo   Could not create the folder:
echo     !TARGET!
echo.
echo   Pick a folder you are allowed to write to, then run update.bat again.
pause
endlocal
exit /b 1

:fail_no_git
echo.
echo   Git is required to download the overlays, and it is not installed.
echo.
echo   Install Git for Windows from:
echo.
echo       https://git-scm.com/download/win
echo.
echo   Accept the default options, close this window, then run update.bat
echo   again. If winget was available it was already tried and did not work.
echo.
echo   No permission to install anything? Run update.bat --zip instead: it
echo   downloads the same files without Git.
echo.
pause
endlocal
exit /b 1

:fail_clone
echo.
echo   Could not clone from GitHub:
echo     %REPO_URL%
echo.
echo   Check the internet connection and that the repository is reachable.
echo   Nothing was changed in this folder.
pause
endlocal
exit /b 1

:fail_attach
echo.
echo   Could not attach this folder to GitHub.
echo.
echo   Nothing was lost. Run update.bat again, or install the files by hand:
echo     git clone %REPO_URL%
pause
endlocal
exit /b 1

:fail_pull
echo.
echo   The update could not be applied.
echo.
echo   This means the folder has local commits or edits that conflict with it.
echo   Nothing was thrown away. See what is going on with:
echo     cd /d "!TARGET!"
echo     git status
echo     git stash list
pause
endlocal
exit /b 1

:fail_zip
echo.
echo   Could not download the repository zip from GitHub.
echo.
echo   Check the internet connection. Nothing was changed in this folder.
pause
endlocal
exit /b 1

:fail_verify
echo.
echo   The update finished, but the expected files are not there:
echo     !TARGET!
echo.
echo   Run update.bat again with --zip, or clone by hand:
echo     git clone %REPO_URL%
pause
endlocal
exit /b 1

:cancel
echo.
echo   Cancelled. Nothing was changed.
pause
endlocal
exit /b 1

:help
echo.
echo   update.bat - install or update the overlays from GitHub
echo.
echo     update.bat                  install or update this folder
echo     update.bat D:\OBS\Overlays  install or update another folder
echo     update.bat --zip            download the branch zip instead of using Git
echo     update.bat --start          run start.bat when the update is done
echo.
echo   First run clones the repository. Later runs only pull new commits.
echo   Your settings (config.json) are kept; state.json is never touched.
echo.
pause
endlocal
exit /b 0
