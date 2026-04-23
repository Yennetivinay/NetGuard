@echo off
echo Stopping anything on ports 8000 and 5173...

for /f "tokens=5" %%a in ('netstat -aon ^| find ":8000 " 2^>nul') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173 " 2^>nul') do taskkill /F /PID %%a >nul 2>&1

timeout /t 1 /nobreak >nul

echo Starting NetGuard...

start "NetGuard Backend" cmd /k "cd backend && python -m uvicorn main:app --reload --port 8000"

timeout /t 3 /nobreak >nul

start "NetGuard Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo NetGuard is running:
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5173
