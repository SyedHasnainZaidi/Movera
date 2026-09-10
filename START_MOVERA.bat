@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Movera launcher

REM ===========================================================================
REM  Movera - start the whole application.
REM
REM  Double-click this file. It opens three log windows (backend, pose service,
REM  frontend), waits for each to answer a health check, and then opens the app
REM  in your browser.
REM
REM  The database is NOT started here. Movera uses the PostgreSQL 18 Windows
REM  service, which starts with Windows and stays running. The old embedded
REM  database on port 55432 is deliberately not used.
REM ===========================================================================

REM %~dp0 is this file's own folder, with a trailing backslash, so the script
REM works no matter what directory it is launched from.
set "ROOT=%~dp0"
set "BACKEND=%ROOT%apps\backend"
set "POSE=%ROOT%services\pose-service"
set "FRONTEND=%ROOT%apps\frontend"

set "PG_SERVICE=postgresql-x64-18"
set "BACKEND_URL=http://localhost:3000/api/v1/ready"
set "POSE_URL=http://localhost:8000/health"
set "APP_URL=http://localhost:5173"

REM Fully-qualified system tools.
REM
REM Git for Windows puts its own `find.exe` (and other GNU utilities) on PATH,
REM and inside cmd those win over the Windows versions. A bare `find "RUNNING"`
REM then reaches GNU find, which fails with "No such file or directory" and
REM makes a running PostgreSQL look stopped. Naming the System32 binaries
REM removes that dependency on how PATH happens to be ordered.
set "FINDSTR=%SystemRoot%\System32\findstr.exe"
set "TIMEOUT=%SystemRoot%\System32\timeout.exe"

echo.
echo  ==========================================
echo    MOVERA
echo    Rehabilitation monitoring platform
echo  ==========================================
echo.

REM --- 0. Sanity: are we where we think we are? ------------------------------
if not exist "%BACKEND%\package.json" (
  echo  [ERROR] Cannot find apps\backend from "%ROOT%".
  echo          Keep START_MOVERA.bat in the project root folder.
  goto :fail
)
if not exist "%POSE%\.venv\Scripts\python.exe" (
  echo  [ERROR] Python virtual environment missing:
  echo          %POSE%\.venv
  echo          Create it before running Movera; this script never installs packages.
  goto :fail
)

REM --- 1. Database ------------------------------------------------------------
echo  [1/4] Checking PostgreSQL 18 service...
sc query "%PG_SERVICE%" | "%FINDSTR%" /C:"RUNNING" >nul 2>&1
if errorlevel 1 (
  echo        Service "%PG_SERVICE%" is not running. Trying to start it...
  REM Needs Administrator. If it fails, say so plainly rather than failing later
  REM with a confusing database connection error.
  net start "%PG_SERVICE%" >nul 2>&1
  sc query "%PG_SERVICE%" | "%FINDSTR%" /C:"RUNNING" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  [ERROR] PostgreSQL 18 is not running and could not be started.
    echo          Right-click START_MOVERA.bat and "Run as administrator",
    echo          or start the service from services.msc, then try again.
    goto :fail
  )
)
echo        PostgreSQL 18 is running on port 5432.

REM --- 2. Backend -------------------------------------------------------------
echo  [2/4] Building and starting the backend...
REM Compiled here rather than in the log window so a TypeScript error stops the
REM launch with a readable message instead of scrolling past in a window that
REM then closes.
pushd "%BACKEND%"
call npm run build:tsc >"%TEMP%\movera-build.log" 2>&1
if errorlevel 1 (
  popd
  echo.
  echo  [ERROR] The backend failed to compile. Details:
  echo.
  type "%TEMP%\movera-build.log"
  goto :fail
)
popd

start "Movera Backend" cmd /k "cd /d "%BACKEND%" && echo === MOVERA BACKEND (http://localhost:3000) === && node dist/main.js"

REM --- 3. Pose service --------------------------------------------------------
echo  [3/4] Starting the pose service...
start "Movera Pose Service" cmd /k "cd /d "%POSE%" && echo === MOVERA POSE SERVICE (http://localhost:8000) === && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

REM --- 4. Frontend ------------------------------------------------------------
echo  [4/4] Starting the frontend...
start "Movera Frontend" cmd /k "cd /d "%FRONTEND%" && echo === MOVERA FRONTEND (http://localhost:5173) === && npm run dev"

REM --- Health checks ----------------------------------------------------------
echo.
echo  Waiting for services to become ready...
echo.

call :waitfor "Movera Backend"      "%BACKEND_URL%" 60
if errorlevel 1 goto :partial
call :waitfor "Movera Pose Service" "%POSE_URL%"    90
if errorlevel 1 goto :partial
call :waitfor "Movera Frontend"     "%APP_URL%"     60
if errorlevel 1 goto :partial

echo.
echo  ==========================================
echo    All Movera services started.
echo.
echo    Frontend : %APP_URL%
echo    API      : http://localhost:3000/api/v1
echo    API docs : http://localhost:3000/api/docs
echo    Pose     : http://localhost:8000
echo  ==========================================
echo.
echo  Opening %APP_URL% ...
start "" "%APP_URL%"
echo.
echo  Close the three service windows, or run STOP_MOVERA.bat, to shut down.
echo.
pause
exit /b 0

REM ===========================================================================
REM  :waitfor  <label>  <url>  <attempts>
REM  Polls a URL once a second. curl.exe ships with Windows 10 1803 and later.
REM ===========================================================================
:waitfor
set "LABEL=%~1"
set "URL=%~2"
set /a "TRIES=%~3"
set /a "N=0"

:waitloop
set /a "N+=1"
curl.exe --silent --output NUL --max-time 3 "%URL%" >nul 2>&1
if not errorlevel 1 (
  echo    [OK]      %LABEL% started
  exit /b 0
)
if !N! GEQ !TRIES! (
  echo    [TIMEOUT] %LABEL% did not respond at %URL%
  exit /b 1
)
REM `timeout` needs a console; >nul keeps the countdown quiet.
"%TIMEOUT%" /t 1 /nobreak >nul
goto :waitloop

REM ===========================================================================
:partial
echo.
echo  [WARNING] Not every service reported ready in time.
echo            The service windows are still open - check them for errors.
echo            A slow first start is normal: the pose service loads a
echo            MediaPipe model, and Vite may re-optimise dependencies.
echo.
echo  Opening %APP_URL% anyway.
start "" "%APP_URL%"
pause
exit /b 1

REM ===========================================================================
:fail
echo.
pause
exit /b 1
