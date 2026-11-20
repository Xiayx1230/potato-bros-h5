@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  set "PY=py -3"
) else (
  set "PY=python"
)

echo.
echo ========================================
echo   data  -^>  excel_src
echo ========================================
%PY% -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip failed. Is Python installed?
  pause
  exit /b 1
)

%PY% config_convert.py init
if errorlevel 1 (
  echo [ERROR] init failed.
  pause
  exit /b 1
)

echo.
echo Done. Edit xlsx in excel_src\ then run convert.bat
echo.
pause
endlocal
