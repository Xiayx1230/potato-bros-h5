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
echo   excel_src  -^>  json_out
echo ========================================
%PY% -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip failed. Is Python installed?
  pause
  exit /b 1
)

%PY% config_convert.py convert
if errorlevel 1 (
  echo [ERROR] convert failed.
  pause
  exit /b 1
)

echo.
echo Next: copy JSON from json_out\ to ..\data\
echo.
pause
endlocal
