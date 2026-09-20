@echo off
setlocal
REM Launch from this file (or a shortcut to it). Do not copy the .cmd into
REM the Startup folder — %~dp0 would then be wrong.
cd /d "%~dp0..\.."

if not exist "package.json" (
  echo Could not find the CodeFriends repo root from scripts\windows.
  echo Clone https://github.com/1ststepai/codefriends and run this script from that clone.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on PATH. Install Node 20 LTS from https://nodejs.org and open a new terminal.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo node_modules is missing. From the repo root run:  npm install
  pause
  exit /b 1
)

if not exist "apps\popout\dist\index.html" (
  echo Popout build missing. From the repo root run:
  echo   npm run build -w @codefriends/popout
  echo The API serves that folder as static files on the same port.
  pause
  exit /b 1
)

title CodeFriends server
echo API + static popout on http://127.0.0.1:8787
echo SQLite path and DEV login come from the repo-root .env — see docs\self-host-windows.md
call npm run start -w @codefriends/server
echo.
echo Server exited.
pause
