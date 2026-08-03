#Requires -Version 5.1
<#
.SYNOPSIS
    HikStatus Native Manager (PowerShell TUI)
.DESCRIPTION
    Interactive TUI launcher and environment manager for HikStatus using Astral uv.
.EXAMPLE
    .\start.ps1
.EXAMPLE
    .\start.ps1 -Action start -Port 28888
#>

[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [ValidateSet("start", "install", "update", "check", "help", "")]
    [string]$Action = "",

    [Parameter(Position=1)]
    [int]$Port = 28888
)

# تنظیم انکودینگ خروجی ترمینال به UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

function Ensure-Uv {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        return $true
    }
    Write-Host "[HikStatus] ابزار Astral uv یافت نشد. در حال نصب uv..." -ForegroundColor Yellow
    try {
        python -m pip install -q uv 2>$null
        if (Get-Command uv -ErrorAction SilentlyContinue) {
            Write-Host "[OK] uv با موفقیت نصب شد." -ForegroundColor Green
            return $true
        }
    } catch { }
    Write-Host "[WARN] نصب uv ناموفق بود. از pip استفاده خواهد شد." -ForegroundColor Yellow
    return $false
}

function Ensure-Venv {
    $hasUv = Ensure-Uv
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-Host "[HikStatus] در حال ساخت محیط مجازی (.venv)..." -ForegroundColor Cyan
        if ($hasUv) {
            uv venv .venv
        } else {
            python -m venv .venv
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] ساخت محیط مجازی با خطا مواجه شد." -ForegroundColor Red
            return $false
        }
        Write-Host "[OK] محیط مجازی ساخته شد." -ForegroundColor Green
    }
    return $true
}

function Ensure-EnvFiles {
    if (-not (Test-Path "data")) {
        New-Item -ItemType Directory -Path "data" -Force | Out-Null
    }
    if (-not (Test-Path ".env")) {
        if (Test-Path ".env.example") {
            Copy-Item ".env.example" ".env"
            Write-Host "[WARN] فایل .env از روی .env.example ساخته شد. لطفاً آن را ویرایش کنید." -ForegroundColor Yellow
        }
    }
}

function Install-Dependencies {
    $venvOk = Ensure-Venv
    if (-not $venvOk) { return }
    Write-Host "[HikStatus] در حال نصب وابستگی‌ها با uv..." -ForegroundColor Cyan
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv pip install -r requirements.txt --python .venv\Scripts\python.exe
    } else {
        & .venv\Scripts\python.exe -m pip install -q --upgrade pip
        & .venv\Scripts\python.exe -m pip install -q -r requirements.txt
    }
    Ensure-EnvFiles
    Write-Host "[OK] تمامی وابستگی‌ها با موفقیت نصب شدند." -ForegroundColor Green
}

function Update-Dependencies {
    $venvOk = Ensure-Venv
    if (-not $venvOk) { return }
    Write-Host "[HikStatus] در حال بروزرسانی وابستگی‌ها..." -ForegroundColor Cyan
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv pip install --upgrade -r requirements.txt --python .venv\Scripts\python.exe
    } else {
        & .venv\Scripts\python.exe -m pip install -q --upgrade -r requirements.txt
    }
    Write-Host "[OK] بسته‌ها بروزرسانی شدند." -ForegroundColor Green
}

function Test-HealthCheck {
    Write-Host "`n=== پایش سلامت سیستم (Health Check) ===" -ForegroundColor Cyan
    
    # Python
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) {
        $pyVer = & python --version 2>&1
        Write-Host " [OK] پایتون: $pyVer" -ForegroundColor Green
    } else {
        Write-Host " [ERROR] پایتون: نصب نیست!" -ForegroundColor Red
    }

    # uv
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        $uvVer = & uv --version 2>&1
        Write-Host " [OK] ابزار uv: $uvVer" -ForegroundColor Green
    } else {
        Write-Host " [WARN] ابزار uv: نصب نیست (استفاده از pip)" -ForegroundColor Yellow
    }

    # .venv
    if (Test-Path ".venv\Scripts\python.exe") {
        Write-Host " [OK] محیط مجازی (.venv): آماده است" -ForegroundColor Green
    } else {
        Write-Host " [ERROR] محیط مجازی (.venv): موجود نیست" -ForegroundColor Red
    }

    # ffmpeg
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Write-Host " [OK] ffmpeg (استریم RTSP): نصب است" -ForegroundColor Green
    } else {
        Write-Host " [WARN] ffmpeg (استریم RTSP): یافت نشد! استریم ویدیو کار نخواهد کرد." -ForegroundColor Yellow
    }

    # .env
    if (Test-Path ".env") {
        Write-Host " [OK] فایل پیکربندی (.env): موجود است" -ForegroundColor Green
    } else {
        Write-Host " [WARN] فایل پیکربندی (.env): ساخته نشده است" -ForegroundColor Yellow
    }

    # data/
    if (Test-Path "data") {
        Write-Host " [OK] دایرکتوری داده (data/): موجود است" -ForegroundColor Green
    } else {
        Write-Host " [WARN] دایرکتوری داده (data/): ساخته نشده است" -ForegroundColor Yellow
    }
    Write-Host ""
}

function Start-Server {
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-Host "[WARN] محیط مجازی یافته نشد. ابتدا فرایند نصب انجام می‌شود..." -ForegroundColor Yellow
        Install-Dependencies
    }
    Ensure-EnvFiles

    Write-Host "`n====================================================" -ForegroundColor Green
    Write-Host "  HikStatus در حال اجراست..." -ForegroundColor Green
    Write-Host "  آدرس پنل: http://localhost:$Port" -ForegroundColor Cyan
    Write-Host "  برای توقف کلید Ctrl+C را فشار دهید." -ForegroundColor Yellow
    Write-Host "====================================================`n" -ForegroundColor Green

    & .venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port $Port
}

function Show-Menu {
    while ($true) {
        Clear-Host
        Write-Host "====================================================" -ForegroundColor DarkCyan
        Write-Host "             HikStatus Manager (Native TUI)         " -ForegroundColor Cyan
        Write-Host "====================================================" -ForegroundColor DarkCyan
        Write-Host "  1) 🚀 راه اندازی برنامه (Start Server)" -ForegroundColor White
        Write-Host "  2) 📦 نصب و پیکربندی اولیه (Full Setup & Install)" -ForegroundColor White
        Write-Host "  3) 🔄 به‌روزرسانی وابستگی‌ها (Update Packages)" -ForegroundColor White
        Write-Host "  4) 🔍 بررسی سلامت سیستم (Health Check)" -ForegroundColor White
        Write-Host "  5) 🚪 خروج (Exit)" -ForegroundColor White
        Write-Host "====================================================" -ForegroundColor DarkCyan
        
        $choice = Read-Host "لطفاً گزینه مورد نظر را انتخاب کنید [1-5]"

        switch ($choice) {
            "1" { Start-Server; break }
            "2" { Install-Dependencies; Read-Host "جهت بازگشت کلید Enter را بزنید..."; break }
            "3" { Update-Dependencies; Read-Host "جهت بازگشت کلید Enter را بزنید..."; break }
            "4" { Test-HealthCheck; Read-Host "جهت بازگشت کلید Enter را بزنید..."; break }
            "5" { Write-Host "خداحافظ!" -ForegroundColor Green; return }
            default { Write-Host "گزینه نامعتبر است." -ForegroundColor Red; Start-Sleep -Seconds 1 }
        }
    }
}

# اجرای اکشن در صورت ارسال آرگومان، در غیر این صورت نمایش منو
switch ($Action.ToLower()) {
    "start"   { Start-Server }
    "install" { Install-Dependencies }
    "update"  { Update-Dependencies }
    "check"   { Test-HealthCheck }
    "help"    {
        Write-Host "راهنمای اسکریپت HikStatus:"
        Write-Host "  .\start.ps1                     اجرای منوی تعاملی TUI"
        Write-Host "  .\start.ps1 -Action start -Port 28888"
        Write-Host "  .\start.ps1 -Action install"
        Write-Host "  .\start.ps1 -Action update"
        Write-Host "  .\start.ps1 -Action check"
    }
    default   { Show-Menu }
}
