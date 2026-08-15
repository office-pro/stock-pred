@echo off
REM Build all services - Windows batch version
REM Usage: build-all.bat [--test] [--clean]

setlocal enabledelayedexpansion

set TEST_ENABLED=false
set CLEAN_BUILD=false

:parse_args
if "%1"=="" goto start_build
if "%1"=="--test" set TEST_ENABLED=true
if "%1"=="--clean" set CLEAN_BUILD=true
shift
goto parse_args

:start_build
cls
echo.
echo === StockPred Build System ===
echo TEST: %TEST_ENABLED% ^| CLEAN: %CLEAN_BUILD%
echo.

if "%CLEAN_BUILD%"=="true" (
  echo Cleaning build artifacts...
  for /d /r %%i in (dist) do @rd /s /q "%%i" 2>nul || true
  echo.
)

echo STEP 1: Building packages
call npm run build:packages
if errorlevel 1 goto build_failed
echo.

echo STEP 2: Building apps
call npm run build:apps
if errorlevel 1 goto build_failed
echo.

echo STEP 3: Running linting
call npm run lint
echo.

if "%TEST_ENABLED%"=="true" (
  echo STEP 4: Running tests
  call npm run test
  if errorlevel 1 goto build_failed
  echo.
)

echo.
echo === Build Complete ===
echo.
echo Services built:
echo   [OK] api-gateway
echo   [OK] auth-service
echo   [OK] market-data-service
echo   [OK] signal-engine
echo   [OK] pattern-engine
echo   [OK] backtest-service
echo   [OK] auto-trader
echo   [OK] notification-service
echo   [OK] frontend-react
echo.
echo Next steps:
echo   npm run start:all      - Start Docker platform
echo   npm run stop:all       - Stop Docker platform
echo   npm run restart:all    - Restart services
echo.
goto end

:build_failed
echo.
echo [ERROR] Build failed!
exit /b 1

:end
endlocal
