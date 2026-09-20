@echo off
setlocal
title CodeFriends Cloudflare named tunnel
echo Named tunnel "codefriends" — expected public host: https://codefriends.1ststep.ai
echo This script does not contain credentials. You must already have run:
echo   cloudflared tunnel login
echo   cloudflared tunnel create codefriends
echo   (config.yml + DNS CNAME — docs\self-host-windows.md)
echo.
echo If you used a different tunnel name, edit the run command below.
echo.

where cloudflared >nul 2>&1
if errorlevel 1 (
  echo cloudflared is not on PATH.
  echo Install:  winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)

cloudflared tunnel run codefriends
echo.
echo Tunnel exited.
pause
