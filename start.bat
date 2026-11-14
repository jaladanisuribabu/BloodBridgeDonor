@echo off
title BloodBridge - Emergency Blood Donor Coordination
cd /d "%~dp0"

echo ===================================================
echo     BloodBridge - Emergency Blood Donor Coordination
echo ===================================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js 20+ from https://nodejs.org/
    pause
    exit /b 1
)

:: Check for .env
if not exist ".env" (
    echo [INFO] .env not found. Copying from .env.example...
    copy ".env.example" ".env" >nul
)

echo [1/3] Generating Prisma database client...
call npx prisma generate

echo.
echo [2/3] Checking Database Connection & Migrations...
call npx prisma migrate deploy
if %ERRORLEVEL% neq 0 (
    echo.
    echo [WARNING] Database migration could not connect to PostgreSQL.
    echo If your database is not running yet, the frontend will still load
    echo at http://localhost:3000/hospital, but database features require PostgreSQL.
    echo See LIVE_INSTRUCTIONS.md for quick free cloud database setup (e.g., Neon or Supabase).
    echo.
) else (
    echo [INFO] Database connected and migrated successfully!
    echo [INFO] Seeding initial hospital account...
    call npm run db:seed
)

echo.
echo [3/3] Starting BloodBridge Live Server on port 3000...
echo.
echo ===================================================
echo   Live Web Application Links:
echo   - Hospital Portal: http://localhost:3000/hospital
echo   - Patient Portal:  http://localhost:3000/patient
echo   - Main Entrance:   http://localhost:3000/
echo ===================================================
echo.

:: Open browser automatically after 2 seconds in background
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000/hospital"

:: Start the Next.js server
call npm run dev
pause
