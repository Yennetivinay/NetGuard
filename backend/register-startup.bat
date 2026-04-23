@echo off
schtasks /create /tn "NetSentry" /tr "%~dp0start-services.bat" /sc onlogon /ru "%USERNAME%" /f
echo.
echo NetSentry registered to auto-start on login.
pause
