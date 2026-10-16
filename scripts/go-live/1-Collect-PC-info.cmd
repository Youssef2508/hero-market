@echo off
rem HeroMarket visit 1: double-click. It collects information about this PC, its printers,
rem scanner and current POS program into a folder on this USB stick. It changes nothing.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\collect-info.ps1"
echo.
pause
