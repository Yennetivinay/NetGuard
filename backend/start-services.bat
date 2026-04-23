@echo off
cd /d "%~dp0"

:: Start backend
start "NetSentry Backend" /min cmd /k "python -m uvicorn main:app --host 127.0.0.1 --port 8000"

:: Wait for backend to be ready
timeout /t 5 /nobreak >nul

:: Start cloudflare tunnel
start "NetSentry Tunnel" /min cmd /k "cloudflared tunnel --url http://localhost:8000"
