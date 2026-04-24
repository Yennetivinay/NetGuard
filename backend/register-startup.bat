@echo off
schtasks /create /tn "NetGuard" /tr "%~dp0start-services.bat" /sc onlogon /ru "%USERNAME%" /f
echo.
echo NetGuard registered to auto-start on login.
echo Run start-services.bat manually to start now.
pause
