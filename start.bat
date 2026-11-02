@echo off
rem Agent Quest: open via http://localhost so MetaMask can connect
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
pause
