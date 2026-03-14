@echo off
cd /d "%~dp0"

set "NGROK_EXE=ngrok"
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe" (
  set "NGROK_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
)

echo [furni] Starting ngrok tunnel for http://127.0.0.1:8000
"%NGROK_EXE%" http 8000

if errorlevel 1 (
  echo.
  echo [furni] ngrok failed to start.
  pause
)
