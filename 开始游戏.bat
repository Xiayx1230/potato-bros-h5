@echo off
cd /d "%~dp0"
set PORT=5173

where python >nul 2>&1
if errorlevel 1 (
  echo [!] Python not found. Please install Python, or open this folder with any static web server.
  echo     Then visit http://127.0.0.1:%PORT%/
  pause
  exit /b 1
)

echo Starting Potian Roguelike on http://127.0.0.1:%PORT%/
echo Close this window to stop the server.
start "" "http://127.0.0.1:%PORT%/"
python -m http.server %PORT%
pause
