# BloodBridge PowerShell Launcher
$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

Write-Host "===================================================" -ForegroundColor Red
Write-Host "    BloodBridge - Emergency Blood Donor Matching    " -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Red
Write-Host ""

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js 20+ from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

# Ensure .env exists
if (-not (Test-Path ".env")) {
    Write-Host "[INFO] Creating .env from .env.example..." -ForegroundColor Cyan
    Copy-Item ".env.example" ".env"
}

Write-Host "[1/3] Generating Prisma client..." -ForegroundColor Cyan
& npx prisma generate

Write-Host "`n[2/3] Checking Database Connection & Migrations..." -ForegroundColor Cyan
& npx prisma migrate deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[NOTICE] Could not connect to PostgreSQL." -ForegroundColor Yellow
    Write-Host "The frontend will still open at http://localhost:3000/hospital" -ForegroundColor Yellow
    Write-Host "To enable full database storage, update DATABASE_URL in .env (see LIVE_INSTRUCTIONS.md)." -ForegroundColor Yellow
} else {
    Write-Host "[SUCCESS] Database connected and migrated." -ForegroundColor Green
    Write-Host "[INFO] Seeding default hospital account..." -ForegroundColor Cyan
    & npm run db:seed
}

Write-Host "`n[3/3] Starting Live Server..." -ForegroundColor Green
Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "  Live Links:" -ForegroundColor White
Write-Host "  - Hospital Portal: http://localhost:3000/hospital" -ForegroundColor Yellow
Write-Host "  - Patient Portal:  http://localhost:3000/patient"  -ForegroundColor Yellow
Write-Host "  - Root URL:        http://localhost:3000/"         -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:3000/hospital"
& npm run dev
