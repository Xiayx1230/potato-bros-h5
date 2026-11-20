@echo off
cd /d "%~dp0"

echo.
echo  ========================================
echo   Potian Roguelike launcher
echo   Do NOT open index.html directly.
echo   Keep this window open while playing.
echo  ========================================
echo.

where powershell >nul 2>&1
if errorlevel 1 goto TRY_PYTHON

echo [1] Starting with PowerShell...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" -Port 5173
if errorlevel 1 goto TRY_PYTHON
goto END

:TRY_PYTHON
echo [2] Trying Python...
where python >nul 2>&1
if errorlevel 1 goto FAIL

start "" "http://127.0.0.1:5173/"
python -m http.server 5173
goto END

:FAIL
echo.
echo [!] Launch failed.
echo     Do not double-click index.html.
echo     Install Python and check "Add Python to PATH":
echo     https://www.python.org/downloads/
echo.
pause
exit /b 1

:END
echo.
pause