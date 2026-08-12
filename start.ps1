#Requires -Version 5.1
<#
.SYNOPSIS
    HikStatus Native Manager (PowerShell TUI - Clean and Dual Language)
.DESCRIPTION
    Interactive TUI launcher and environment manager for HikStatus using Astral uv.
    Supports Persian and English dual-language output with clean layout alignment.
.EXAMPLE
    .\start.ps1
.EXAMPLE
    .\start.ps1 -Action start -Port 28888
#>

[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [ValidateSet("start", "start-bg", "stop", "status", "enable-startup", "disable-startup", "install", "update", "check", "help", "")]
    [string]$Action = "",

    [Parameter(Position=1)]
    [int]$Port = 28888,

    [switch]$NoBrowser
)

# تنظیم انکودینگ خروجی ترمینال به UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir
# مسیرهای ذخیره PID برای سرویس وب و زمان‌بند به صورت جداگانه
$WebPidFile = Join-Path $ScriptDir "data\hikstatus_web.pid"
$SchedPidFile = Join-Path $ScriptDir "data\hikstatus_scheduler.pid"
$LegacyPidFile = Join-Path $ScriptDir "data\hikstatus.pid"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupShortcut = Join-Path $StartupFolder "HikStatus.lnk"

# توابع چاپ دو زبانه و شکیل با همترازی تمیز
function Write-LogInfo ($label, $en, $fa) {
    Write-Host "  [$label] " -NoNewline -ForegroundColor Cyan
    Write-Host "$en " -NoNewline -ForegroundColor White
    Write-Host "| $fa" -ForegroundColor Gray
}

function Write-LogOk ($label, $en, $fa) {
    Write-Host "  [OK] " -NoNewline -ForegroundColor Green
    Write-Host "${label}: " -NoNewline -ForegroundColor White
    Write-Host "$en " -NoNewline -ForegroundColor White
    Write-Host "| $fa" -ForegroundColor Gray
}

function Write-LogWarn ($label, $en, $fa) {
    Write-Host "  [WARN] " -NoNewline -ForegroundColor Yellow
    Write-Host "${label}: " -NoNewline -ForegroundColor White
    Write-Host "$en " -NoNewline -ForegroundColor White
    Write-Host "| $fa" -ForegroundColor Gray
}

function Write-LogErr ($label, $en, $fa) {
    Write-Host "  [ERROR] " -NoNewline -ForegroundColor Red
    Write-Host "${label}: " -NoNewline -ForegroundColor White
    Write-Host "$en " -NoNewline -ForegroundColor White
    Write-Host "| $fa" -ForegroundColor Gray
}

# باز کردن خودکار مرورگر در صورت عدم غیرفعال بودن (مانند حالت استارتآپ)
function Open-BrowserUrl ($url) {
    if (-not $NoBrowser) {
        Write-LogInfo "Browser" "Opening browser at $url..." "در حال باز کردن مرورگر..."
        try {
            Start-Process $url
        } catch {
            Write-LogWarn "Browser" "Failed to open browser automatically." "خطا در باز کردن خودکار مرورگر."
        }
    }
}

function Ensure-Uv {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        return $true
    }
    Write-LogWarn "Astral uv" "Astral uv tool not found. Installing..." "ابزار uv یافت نشد. در حال نصب..."
    try {
        python -m pip install -q uv 2>$null
        if (Get-Command uv -ErrorAction SilentlyContinue) {
            Write-LogOk "Astral uv" "Installed successfully." "با موفقیت نصب شد."
            return $true
        }
    } catch { }
    Write-LogWarn "Astral uv" "Installation failed. Falling back to pip." "نصب uv ناموفق بود؛ استفاده از pip."
    return $false
}

function Ensure-Venv {
    $hasUv = Ensure-Uv
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-LogInfo "SETUP" "Creating virtual environment (.venv)..." "در حال ساخت محیط مجازی (.venv)..."
        if ($hasUv) {
            uv venv .venv
        } else {
            python -m venv .venv
        }
        if ($LASTEXITCODE -ne 0) {
            Write-LogErr "VENV" "Failed to create virtual environment." "ساخت محیط مجازی با خطا مواجه شد."
            return $false
        }
        Write-LogOk "VENV" "Virtual environment created." "محیط مجازی ساخته شد."
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
            Write-LogWarn ".env" "Created from .env.example. Please review." "فایل .env از نمونه ساخته شد."
        }
    }
}

function Install-Dependencies {
    $venvOk = Ensure-Venv
    if (-not $venvOk) { return }
    Write-LogInfo "PACKAGES" "Installing dependencies..." "در حال نصب وابستگیها..."
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv pip install -r requirements.txt --python .venv\Scripts\python.exe
    } else {
        & .venv\Scripts\python.exe -m pip install -q --upgrade pip
        & .venv\Scripts\python.exe -m pip install -q -r requirements.txt
    }
    Ensure-EnvFiles
    Write-LogOk "PACKAGES" "All dependencies installed successfully." "تمامی وابستگیها نصب شدند."
}

function Update-Dependencies {
    $venvOk = Ensure-Venv
    if (-not $venvOk) { return }
    Write-LogInfo "PACKAGES" "Updating packages..." "در حال بروزرسانی بستهها..."
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv pip install --upgrade -r requirements.txt --python .venv\Scripts\python.exe
    } else {
        & .venv\Scripts\python.exe -m pip install -q --upgrade -r requirements.txt
    }
    Write-LogOk "PACKAGES" "All packages updated successfully." "تمامی بستهها بروزرسانی شدند."
}

# بررسی پروسه‌های فعال سرویس وب و سرویس زمان‌بند
function Get-ActiveServerProcesses {
    $webProc = $null
    $schedProc = $null

    if (Test-Path $WebPidFile) {
        $savedPid = Get-Content $WebPidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $webProc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
        }
    }
    if (-not $webProc -and (Test-Path $LegacyPidFile)) {
        $savedPid = Get-Content $LegacyPidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $webProc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
        }
    }

    if (Test-Path $SchedPidFile) {
        $savedPid = Get-Content $SchedPidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $schedProc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
        }
    }

    return @{ Web = $webProc; Scheduler = $schedProc }
}

function Get-ServerStatus {
    $procs = Get-ActiveServerProcesses
    $webProc = $procs.Web
    $schedProc = $procs.Scheduler

    $hasActive = $false
    if ($webProc) {
        Write-Host "  [OK] " -NoNewline -ForegroundColor Green
        Write-Host "Web Service: " -NoNewline -ForegroundColor White
        Write-Host "ACTIVE (PID: $($webProc.Id)) " -NoNewline -ForegroundColor Green
        Write-Host "| سرویس وب فعال است" -ForegroundColor Gray
        $hasActive = $true
    } else {
        Write-Host "  [INFO] " -NoNewline -ForegroundColor Yellow
        Write-Host "Web Service: " -NoNewline -ForegroundColor White
        Write-Host "INACTIVE " -NoNewline -ForegroundColor Yellow
        Write-Host "| سرویس وب فعال نیست" -ForegroundColor Gray
    }

    if ($schedProc) {
        Write-Host "  [OK] " -NoNewline -ForegroundColor Green
        Write-Host "Scheduler Service: " -NoNewline -ForegroundColor White
        Write-Host "ACTIVE (PID: $($schedProc.Id)) " -NoNewline -ForegroundColor Green
        Write-Host "| سرویس زمان‌بند فعال است" -ForegroundColor Gray
        $hasActive = $true
    } else {
        Write-Host "  [INFO] " -NoNewline -ForegroundColor Yellow
        Write-Host "Scheduler Service: " -NoNewline -ForegroundColor White
        Write-Host "INACTIVE " -NoNewline -ForegroundColor Yellow
        Write-Host "| سرویس زمان‌بند فعال نیست" -ForegroundColor Gray
    }

    if ($webProc) {
        Write-Host "       Panel URL: " -NoNewline -ForegroundColor White
        Write-Host "http://localhost:$Port" -ForegroundColor Cyan
    }
    return $hasActive
}

function Test-HealthCheck {
    Write-Host "`n══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  System Health Check | پایش سلامت سیستم" -ForegroundColor Cyan
    Write-Host "══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    # Python
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) {
        $pyVer = (python --version 2>&1) | Out-String
        $pyVer = $pyVer.Trim()
        Write-LogOk "Python" "$pyVer" "پایتون آماده است"
    } else {
        Write-LogErr "Python" "Not Installed!" "پایتون نصب نیست!"
    }

    # uv
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        $uvVer = (uv --version 2>&1) | Out-String
        $uvVer = $uvVer.Trim()
        Write-LogOk "Astral uv" "$uvVer" "ابزار uv آماده است"
    } else {
        Write-LogWarn "Astral uv" "Not found (using pip)" "ابزار uv یافت نشد"
    }

    # .venv
    if (Test-Path ".venv\Scripts\python.exe") {
        Write-LogOk "Virtual Env" "Ready (.venv)" "محیط مجازی آماده است"
    } else {
        Write-LogErr "Virtual Env" "Missing (.venv)" "محیط مجازی موجود نیست"
    }

    # ffmpeg
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Write-LogOk "FFmpeg" "Installed (RTSP Stream)" "ابزار ffmpeg نصب است"
    } else {
        Write-LogWarn "FFmpeg" "Not found (RTSP disabled)" "ابزار ffmpeg یافت نشد"
    }

    # .env
    if (Test-Path ".env") {
        Write-LogOk "Config File" "Exists (.env)" "فایل پیکربندی موجود است"
    } else {
        Write-LogWarn "Config File" "Missing (.env)" "فایل پیکربندی ساخته نشده"
    }

    # data/
    if (Test-Path "data") {
        Write-LogOk "Data Dir" "Exists (data/)" "دایرکتوری داده موجود است"
    } else {
        Write-LogWarn "Data Dir" "Missing (data/)" "دایرکتوری داده موجود نیست"
    }

    Write-Host "──────────────────────────────────────────────────────────────────────" -ForegroundColor DarkCyan
    Write-Host '  Service & System Status | وضعیت سرویس‌ها:' -ForegroundColor White
    Get-ServerStatus | Out-Null

    Write-Host "  Windows Auto-Start: " -NoNewline -ForegroundColor White
    if (Test-Path $StartupShortcut) {
        Write-Host "ENABLED | فعال است" -ForegroundColor Green
    } else {
        Write-Host "DISABLED | غیرفعال است" -ForegroundColor Yellow
    }
    Write-Host "══════════════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan
}

# راه‌اندازی همزمان سرویس وب و زمان‌بند به صورت Foreground
function Start-Server {
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-LogWarn "Server" "Virtual env missing. Installing..." "محیط مجازی یافت نشد..."
        Install-Dependencies
    }
    Ensure-EnvFiles

    Write-Host "`n══════════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  HikStatus Server Running (Web & Scheduler Active)" -ForegroundColor Green
    Write-Host "  Panel URL: http://localhost:$Port" -ForegroundColor Cyan
    Write-Host "  Press Ctrl+C to Stop All Services" -ForegroundColor Yellow
    Write-Host "══════════════════════════════════════════════════════════════════════`n" -ForegroundColor Green

    Open-BrowserUrl "http://localhost:$Port"

    $pythonPath = Join-Path $ScriptDir ".venv\Scripts\python.exe"
    Write-LogInfo "Scheduler" "Starting scheduler process..." "در حال راه‌اندازی پروسه زمان‌بند..."
    $schedProc = Start-Process -FilePath $pythonPath -ArgumentList "scheduler_runner.py" -WorkingDirectory $ScriptDir -PassThru -WindowStyle Hidden

    try {
        Write-LogInfo "Web" "Starting Uvicorn web server..." "در حال راه‌اندازی سرور وب Uvicorn..."
        & .venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port $Port
    } finally {
        if ($schedProc -and -not $schedProc.HasExited) {
            Write-LogInfo "Scheduler" "Stopping scheduler process..." "در حال توقف پروسه زمان‌بند..."
            Stop-Process -Id $schedProc.Id -ErrorAction SilentlyContinue
        }
    }
}

# راه‌اندازی همزمان سرویس وب و زمان‌بند به صورت پس‌زمینه (Background)
function Start-ServerBackground {
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-LogWarn "Server" "Virtual env missing. Installing..." "محیط مجازی یافت نشد..."
        Install-Dependencies
    }
    Ensure-EnvFiles

    $procs = Get-ActiveServerProcesses
    if ($procs.Web -or $procs.Scheduler) {
        Write-LogWarn "Server" "Background services already running." "سرویس‌های پس‌زمینه قبلاً راه‌اندازی شده‌اند."
        Get-ServerStatus | Out-Null
        Open-BrowserUrl "http://localhost:$Port"
        return
    }

    $uvicornPath = Join-Path $ScriptDir ".venv\Scripts\uvicorn.exe"
    $pythonPath = Join-Path $ScriptDir ".venv\Scripts\python.exe"
    Write-LogInfo "Server" "Launching web & scheduler background services..." "در حال راه‌اندازی پس‌زمینه سرویس‌های وب و زمان‌بند..."
    
    $webProc = Start-Process -FilePath $uvicornPath -ArgumentList "main:app --host 0.0.0.0 --port $Port" -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
    $schedProc = Start-Process -FilePath $pythonPath -ArgumentList "scheduler_runner.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru

    if ($webProc -and -not $webProc.HasExited) {
        $webProc.Id | Out-File -FilePath $WebPidFile -Encoding utf8
        Write-LogOk "Web" "Background web service started (PID $($webProc.Id))" "سرویس وب پس‌زمینه با موفقیت اجرا شد"
    } else {
        Write-LogErr "Web" "Failed to start background web service." "راه‌اندازی سرویس وب ناموفق بود."
    }

    if ($schedProc -and -not $schedProc.HasExited) {
        $schedProc.Id | Out-File -FilePath $SchedPidFile -Encoding utf8
        Write-LogOk "Scheduler" "Background scheduler service started (PID $($schedProc.Id))" "سرویس زمان‌بند پس‌زمینه با موفقیت اجرا شد"
    } else {
        Write-LogErr "Scheduler" "Failed to start background scheduler service." "راه‌اندازی سرویس زمان‌بند ناموفق بود."
    }

    Write-Host "  Panel URL: http://localhost:$Port" -ForegroundColor Green
    Write-Host "  Note: You can safely close this terminal." -ForegroundColor Yellow
    Open-BrowserUrl "http://localhost:$Port"
}

# توقف یکپارچه سرویس‌های پس‌زمینه وب و زمان‌بند
function Stop-Server {
    Write-LogInfo "Server" "Stopping web and scheduler background services..." "در حال توقف سرویس‌های پس‌زمینه وب و زمان‌بند..."
    $stopped = $false

    if (Test-Path $WebPidFile) {
        $savedPid = Get-Content $WebPidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
                Write-LogOk "Web" "Stopped background web service (PID $savedPid)" "سرویس وب پس‌زمینه متوقف شد"
                $stopped = $true
            }
        }
        Remove-Item $WebPidFile -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path $LegacyPidFile) {
        $savedPid = Get-Content $LegacyPidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
                $stopped = $true
            }
        }
        Remove-Item $LegacyPidFile -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path $SchedPidFile) {
        $savedPid = Get-Content $SchedPidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
                Write-LogOk "Scheduler" "Stopped background scheduler service (PID $savedPid)" "سرویس زمان‌بند پس‌زمینه متوقف شد"
                $stopped = $true
            }
        }
        Remove-Item $SchedPidFile -Force -ErrorAction SilentlyContinue
    }

    $uvProcs = Get-Process -Name "uvicorn" -ErrorAction SilentlyContinue
    if ($uvProcs) {
        foreach ($p in $uvProcs) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            Write-LogOk "Web" "Terminated uvicorn process (PID $($p.Id))" "پروسه uvicorn متوقف شد"
            $stopped = $true
        }
    }

    $pyProcs = Get-Process -Name "python" -ErrorAction SilentlyContinue
    if ($pyProcs) {
        foreach ($p in $pyProcs) {
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)").CommandLine
                if ($cmdLine -like "*scheduler_runner.py*") {
                    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                    Write-LogOk "Scheduler" "Terminated scheduler_runner process (PID $($p.Id))" "پروسه زمان‌بند متوقف شد"
                    $stopped = $true
                }
            } catch {}
        }
    }

    if (-not $stopped) {
        Write-Host "  [INFO] No active background services found | هیچ سرویس پسزمینهای فعال نبود" -ForegroundColor Yellow
    }
}

function Enable-Startup {
    Write-LogInfo "Startup" "Enabling Windows Auto-Start..." "در حال تنظیم راهاندازی خودکار..."
    try {
        $wshShell = New-Object -ComObject WScript.Shell
        $shortcut = $wshShell.CreateShortcut($StartupShortcut)
        $shortcut.TargetPath = "powershell.exe"
        $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptDir\start.ps1`" -Action start-bg -Port $Port -NoBrowser"
        $shortcut.WorkingDirectory = $ScriptDir
        $shortcut.Description = "HikStatus Auto-Start Background Service"
        $shortcut.Save()

        Write-LogOk "Startup" "Auto-Start enabled successfully." "راهاندازی خودکار فعال شد."
    } catch {
        Write-LogErr "Startup" "Failed to enable Auto-Start: $_" "خطا در فعالسازی استارتآپ"
    }
}

function Disable-Startup {
    if (Test-Path $StartupShortcut) {
        Remove-Item $StartupShortcut -Force
        Write-LogOk "Startup" "Auto-Start disabled." "راهاندازی خودکار غیرفعال شد."
    } else {
        Write-Host '  [INFO] Auto-Start was not enabled | راهاندازی خودکار فعال نبود' -ForegroundColor Yellow
    }
}

function Show-Menu {
    while ($true) {
        Clear-Host
        $procs = Get-ActiveServerProcesses
        $bgStatus = if ($procs.Web -or $procs.Scheduler) { " [ACTIVE]" } else { " [INACTIVE]" }
        $hasStartup = Test-Path $StartupShortcut
        $startupStatus = if ($hasStartup) { " [ENABLED]" } else { " [DISABLED]" }

        Write-Host "══════════════════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
        Write-Host "               HikStatus Native Manager (TUI)" -ForegroundColor Cyan
        Write-Host "        مدیریت بومی و استقرار سامانه پایش | System Management" -ForegroundColor Gray
        Write-Host "══════════════════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
        Write-Host "  [1] Start Foreground Console    | اجرای مستقیم در کنسول (وب + زمان‌بند)" -ForegroundColor White
        
        Write-Host "  [2] Start Background Service   | اجرای سرویس پسزمینه" -NoNewline -ForegroundColor White
        if ($procs.Web -or $procs.Scheduler) { Write-Host "$bgStatus" -ForegroundColor Green } else { Write-Host "$bgStatus" -ForegroundColor DarkGray }

        Write-Host "  [3] Stop Background Service    | توقف سرویس پسزمینه" -ForegroundColor White
        Write-Host "  [4] Check Service Status       | مشاهده وضعیت سرویس" -ForegroundColor White
        
        Write-Host "  [5] Enable Windows Startup     | فعالسازی اجرا خودکار" -NoNewline -ForegroundColor White
        if ($hasStartup) { Write-Host "$startupStatus" -ForegroundColor Green } else { Write-Host "$startupStatus" -ForegroundColor DarkGray }

        Write-Host "  [6] Disable Windows Startup    | غیرفعالسازی اجرا خودکار" -ForegroundColor White
        Write-Host "  [7] Full Setup and Install     | نصب و پیکربندی اولیه" -ForegroundColor White
        Write-Host "  [8] Update Packages            | بهروزرسانی بستهها" -ForegroundColor White
        Write-Host "  [9] System Health Check        | بررسی سلامت سیستم" -ForegroundColor White
        Write-Host "  [0] Exit                       | خروج" -ForegroundColor White
        Write-Host "══════════════════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
        
        $choice = Read-Host "Select Option [0-9] | انتخاب گزینه"

        switch ($choice) {
            "1" { Start-Server; break }
            "2" {
                Start-ServerBackground
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "3" {
                Stop-Server
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "4" {
                Write-Host "`n=== وضعیت سرویس‌ها (Service Status) ===" -ForegroundColor Cyan
                Get-ServerStatus | Out-Null
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "5" {
                Enable-Startup
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "6" {
                Disable-Startup
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "7" {
                Install-Dependencies
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "8" {
                Update-Dependencies
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "9" {
                Test-HealthCheck
                Read-Host "`nPress Enter to return | جهت بازگشت کلید Enter را بزنید..."
                break
            }
            "0" {
                Write-Host "Goodbye! | خداحافظ!" -ForegroundColor Green
                return
            }
            default {
                Write-Host "Invalid choice | گزینه نامعتبر است." -ForegroundColor Red
                Start-Sleep -Seconds 1
            }
        }
    }
}

switch ($Action.ToLower()) {
    "start"           { Start-Server }
    "start-bg"        { Start-ServerBackground }
    "stop"            { Stop-Server }
    "status"          { Get-ServerStatus }
    "enable-startup"  { Enable-Startup }
    "disable-startup" { Disable-Startup }
    "install"         { Install-Dependencies }
    "update"          { Update-Dependencies }
    "check"           { Test-HealthCheck }
    "help"            {
        Write-Host "HikStatus Help:"
        Write-Host "  .\start.ps1                           Interactive TUI Menu"
        Write-Host "  .\start.ps1 -Action start -Port 28888  Start Foreground"
        Write-Host "  .\start.ps1 -Action start-bg          Start Background Service"
        Write-Host "  .\start.ps1 -Action stop              Stop Background Service"
        Write-Host "  .\start.ps1 -Action status            Check Background Status"
        Write-Host "  .\start.ps1 -Action enable-startup    Enable Auto-Start"
        Write-Host "  .\start.ps1 -Action disable-startup   Disable Auto-Start"
        Write-Host "  .\start.ps1 -Action install           Install Dependencies"
        Write-Host "  .\start.ps1 -Action update            Update Packages"
        Write-Host "  .\start.ps1 -Action check             System Health Check"
    }
    default           { Show-Menu }
}
