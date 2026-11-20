@echo off
cd /d "%~dp0.."
for /d %%D in (*) do (
  if exist "%%D\convert.bat" if exist "%%D\config_convert.py" (
    call "%%D\convert.bat"
    exit /b
  )
)
echo [ERROR] config folder not found.
pause
