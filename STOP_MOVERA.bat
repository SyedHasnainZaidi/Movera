@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Movera - stop

REM ===========================================================================
REM  Movera - stop the application.
REM
REM  Stops the three Movera services and NOTHING else.
REM
REM  It works by finding the process listening on each of Movera's own ports and
REM  ending that process tree. It deliberately does NOT run something like
REM  "taskkill /IM node.exe", which would kill every Node process on the machine
REM  - including unrelated editors, tooling and other projects.
REM
REM  PostgreSQL is never touched. The database is a Windows service shared with
REM  anything else on this machine, and stopping it is not this script's job.
REM ===========================================================================

REM Fully-qualified system tools. Git for Windows puts GNU utilities of the same
REM names on PATH, and inside cmd those win - a bare `netstat`/`findstr` can
REM therefore resolve to something that does not understand these switches.
set "NETSTAT=%SystemRoot%\System32\netstat.exe"
set "FINDSTR=%SystemRoot%\System32\findstr.exe"
set "TASKKILL=%SystemRoot%\System32\taskkill.exe"

echo.
echo  ==========================================
echo    MOVERA - shutting down
echo  ==========================================
echo.

call :killport 3000 "Backend"
call :killport 8000 "Pose Service"
call :killport 5173 "Frontend"

REM Close any leftover console windows opened by START_MOVERA.bat. If the
REM process inside already exited, the window can linger.
for %%W in ("Movera Backend" "Movera Pose Service" "Movera Frontend") do (
  "%TASKKILL%" /FI "WINDOWTITLE eq %%~W" /T /F >nul 2>&1
)

echo.
echo  Movera services stopped.
echo  PostgreSQL 18 was left running, as intended.
echo.
pause
exit /b 0

REM ===========================================================================
REM  :killport <port> <label>
REM  Ends the process tree owning the LISTENING socket on <port>.
REM ===========================================================================
:killport
set "PORT=%~1"
set "LABEL=%~2"
set "FOUND="

REM Column 5 of a netstat -ano LISTENING line is the owning PID. The trailing
REM space in ":%PORT% " stops :3000 from also matching :30000.
for /f "tokens=5" %%P in ('"%NETSTAT%" -ano ^| "%FINDSTR%" /r /c:"LISTENING" ^| "%FINDSTR%" /c:":%PORT% "') do (
  if not "%%P"=="0" (
    set "FOUND=1"
    "%TASKKILL%" /PID %%P /T /F >nul 2>&1
    if errorlevel 1 (
      echo    [!] %LABEL% ^(port %PORT%, PID %%P^) could not be stopped.
    ) else (
      echo    [OK] %LABEL% stopped ^(port %PORT%, PID %%P^)
    )
  )
)

if not defined FOUND echo    [--] %LABEL% was not running ^(nothing on port %PORT%^)
exit /b 0
