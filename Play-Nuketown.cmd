@echo off
rem Nuketown 2025 - one-click local launcher.
rem Double-click this file from Explorer. It builds the production bundle,
rem serves it locally, and opens it in your browser. No terminal needed.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [nuketown] Node.js was not found.
  echo [nuketown] Install the LTS release from https://nodejs.org/ and double-click this file again.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo [nuketown] First run - installing dependencies, this takes a minute...
  call npm install
  if errorlevel 1 (
    echo [nuketown] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo [nuketown] Building...
call npm run build
if errorlevel 1 (
  echo [nuketown] Build failed. The error is in the lines above.
  pause
  exit /b 1
)

echo [nuketown] Serving the production build. Opening your browser at http://localhost:4173/
echo [nuketown] Keep this window open while you play. Close it to stop.
call npm run preview -- --open
