@echo off
echo Installing NetGuard dependencies (run this once)...
echo.

echo [1/2] Installing backend dependencies...
cd backend && pip install -r requirements.txt && cd ..

echo.
echo [2/2] Installing frontend dependencies...
cd frontend && npm install && cd ..

echo.
echo Setup complete! Run start.bat to launch NetGuard.
pause
