@echo off
rem Double-click this before installing. It checks the installers and backs up the 1.3 data
rem to this USB stick. It changes nothing on the PC. See START-HERE.html, steps 7 and 9.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-and-backup.ps1"
echo.
pause
