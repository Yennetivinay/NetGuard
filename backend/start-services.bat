@echo off
cd /d "%~dp0"

:: Add cloudflared to PATH
set PATH=%PATH%;C:\Program Files (x86)\cloudflared

echo Starting NetGuard Backend...
start "NetGuard Backend" /min cmd /k "python -m uvicorn main:app --host 0.0.0.0 --port 8000"

timeout /t 5 /nobreak >nul

echo Starting NetGuard Frontend (Local)...
start "NetGuard Frontend" /min cmd /k "cd /d "%~dp0..\frontend" && npm run dev -- --host --port 5173"

timeout /t 3 /nobreak >nul

echo Starting Cloudflare Tunnel (Remote)...
start "NetGuard Tunnel" /min cmd /k "set PATH=%PATH%;C:\Program Files (x86)\cloudflared && cloudflared tunnel --url http://localhost:8000"

echo.
echo -----------------------------------------------
echo  NetGuard is running
echo  Local Frontend  : http://[this-pc-ip]:5173
echo  Local Backend   : http://[this-pc-ip]:8000
echo  Remote Backend  : Check Tunnel window for URL
echo -----------------------------------------------
pause
