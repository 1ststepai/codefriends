@echo off
setlocal
title CodeFriends Cloudflare quick tunnel
echo Quick tunnel: Cloudflare prints a https://*.trycloudflare.com URL.
echo That URL CHANGES every time you restart this window.
echo For a stable hostname (codefriends.1ststep.ai) use start-tunnel-named.cmd
echo after you create a named tunnel on this PC — see docs\self-host-windows.md
echo.
echo Target: http://127.0.0.1:8787  (start the Node server first)
echo.

where cloudflared >nul 2>&1
if errorlevel 1 (
  echo cloudflared is not on PATH.
  echo Install:  winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)

cloudflared tunnel --url http://127.0.0.1:8787
echo.
echo Tunnel exited.
pause
