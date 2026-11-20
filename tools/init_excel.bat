@echo off
cd /d "%~dp0.."
for /d %%D in (*) do (
  if exist "%%D\init_excel.bat" if exist "%%D\config_convert.py" (
    call "%%D\init_excel.bat"
    exit /b
  )
)
echo [ERROR] config folder not found.
pause
