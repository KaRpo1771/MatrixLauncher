@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20+ from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 goto err
call npm run dist
if errorlevel 1 goto err
echo.
echo Done! The .exe files are in the dist folder.
explorer dist
pause
exit /b 0
:err
echo Build failed - see the messages above.
pause
exit /b 1
