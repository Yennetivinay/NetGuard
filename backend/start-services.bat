@echo off
cd /d "%~dp0"

:: Start backend — listen on all interfaces so local network can reach it
start "NetSentry Backend" /min cmd /k "python -m uvicorn main:app --host 0.0.0.0 --port 8000"

:: Wait for backend to start
timeout /t 5 /nobreak >nul

:: Start frontend dev server — accessible on local network
start "NetSentry Frontend" /min cmd /k "cd /d "%~dp0..\frontend" && npm run dev -- --host --port 5173"

:: Start cloudflare tunnel for remote (Vercel) access
start "NetSentry Tunnel" /min cmd /k "cloudflared tunnel --url http://localhost:8000"
