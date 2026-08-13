@echo off
setlocal
rem The companion lives in the apps\companion npm workspace; its dependencies
rem are hoisted into the repo-root node_modules, so everything runs from root.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current Node.js LTS release, then run this file again.
  pause
  exit /b 1
)

set "JARVIS_COMPANION_INSTALL=0"
if not exist "node_modules\.bin\electron.cmd" set "JARVIS_COMPANION_INSTALL=1"
if not exist "node_modules\@jitsi\robotjs\package.json" set "JARVIS_COMPANION_INSTALL=1"
if "%JARVIS_COMPANION_INSTALL%"=="1" (
  echo Jarvis Companion dependencies are missing. Installing them now...
  call npm install --include=dev
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting Jarvis Companion...
echo Look for the Jarvis icon in the Windows notification area. Keep this window open.
call npm run companion
if errorlevel 1 pause
