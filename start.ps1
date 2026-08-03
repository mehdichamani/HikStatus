#Requires -Version 5.1
<#
.SYNOPSIS
    HikStatus Native Manager (PowerShell TUI - Dual Language)
.DESCRIPTION
    Interactive TUI launcher and environment manager for HikStatus using Astral uv.
    Supports Persian & English dual-language output and background service management.
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
    [int]$Port = 28888
)

# تنظیم انکودینگ خروجی ترمینال به UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir
$PidFile = Join-Path $ScriptDir "data\hikstatus.pid"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupShortcut = Join-Path $StartupFolder "HikStatus.lnk"

# توابع چاپ دو زبانه و شکیل
function Write-LogInfo ($fa, $en) {
    Write-Host "[HikStatus] " -NoNewline -ForegroundColor Cyan
    Write-Host "$fa " -NoNewline -ForegroundColor White
    Write-Host "| $en" -ForegroundColor Gray
}

function Write-LogOk ($fa, $en) {
    Write-Host "  [OK] " -NoNewline -ForegroundColor Green
    Write-Host "$fa " -NoNewline -ForegroundColor White
    Write-Host "| $en" -ForegroundColor Gray
}

function Write-LogWarn ($fa, $en) {
    Write-Host "  [WARN] " -NoNewline -ForegroundColor Yellow
    Write-Host "$fa " -NoNewline -ForegroundColor White
    Write-Host "| $en" -ForegroundColor Gray
}

function Write-LogErr ($fa, $en) {
    Write-Host "  [ERROR] " -NoNewline -ForegroundColor Red
    Write-Host "$fa " -NoNewline -ForegroundColor White
    Write-Host "| $en" -ForegroundColor Gray
}

function Ensure-Uv {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        return $true
    }
    Write-LogWarn "ابزار Astral uv یافت نشد. در حال نصب uv..." "Astral uv tool not found. Installing uv..."
    try {
        python -m pip install -q uv 2>$null
        if (Get-Command uv -ErrorAction SilentlyContinue) {
            Write-LogOk "ابزار uv با موفقیت نصب شد." "Astral uv installed successfully."
            return $true
        }
    } catch { }
    Write-LogWarn "نصب uv ناموفق بود. از pip استفاده خواهد شد." "uv installation failed. Falling back to pip."
    return $false
}

function Ensure-Venv {
    $hasUv = Ensure-Uv
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-LogInfo "در حال ساخت محیط مجازی (.venv)..." "Creating virtual environment (.venv)..."
        if ($hasUv) {
            uv venv .venv
        } else {
            python -m venv .venv
        }
        if ($LASTEXITCODE -ne 0) {
            Write-LogErr "ساخت محیط مجازی با خطا مواجه شد." "Failed to create virtual environment."
            return $false
        }
        Write-LogOk "محیط مجازی ساخته شد." "Virtual environment created successfully."
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
            Write-LogWarn "فایل .env از روی .env.example ساخته شد. لطفاً آن را تنظیم کنید." "Created .env from .env.example. Please update settings."
        }
    }
}

function Install-Dependencies {
    $venvOk = Ensure-Venv
    if (-not $venvOk) { return }
    Write-LogInfo "در حال نصب وابستگی‌ها..." "Installing dependencies..."
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv pip install -r requirements.txt --python .venv\Scripts\python.exe
    } else {
        & .venv\Scripts\python.exe -m pip install -q --upgrade pip
        & .venv\Scripts\python.exe -m pip install -q -r requirements.txt
    }
    Ensure-EnvFiles
    Write-LogOk "تمامی وابستگی‌ها با موفقیت نصب شدند." "All dependencies installed successfully."
}

function Update-Dependencies {
    $venvOk = Ensure-Venv
    if (-not $venvOk) { return }
    Write-LogInfo "در حال بروزرسانی بسته‌ها..." "Updating packages..."
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv pip install --upgrade -r requirements.txt --python .venv\Scripts\python.exe
    } else {
        & .venv\Scripts\python.exe -m pip install -q --upgrade -r requirements.txt
    }
    Write-LogOk "تمامی بسته‌ها بروزرسانی شدند." "All packages updated successfully."
}

function Get-ActiveServerProcess {
    if (Test-Path $PidFile) {
        $savedPid = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) {
                return $proc
            }
        }
    }
    return $null
}

function Get-ServerStatus {
    $proc = Get-ActiveServerProcess
    if ($proc) {
        Write-LogOk "سرویس پس‌زمینه HikStatus فعال است. (PID: $($proc.Id))" "Background service is active. (PID: $($proc.Id))"
        Write-Host "     🌐 " -NoNewline -ForegroundColor Cyan
        Write-Host "آدرس پنل | Panel URL: " -NoNewline -ForegroundColor White
        Write-Host "http://localhost:$Port" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [INFO] " -NoNewline -ForegroundColor Yellow
        Write-Host "سرویس پس‌زمینه در حال اجرا نیست. " -NoNewline -ForegroundColor White
        Write-Host "| Background service is inactive." -ForegroundColor Gray
        return $false
    }
}

function Test-HealthCheck {
    Write-Host "`n══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "   🔍 پایش سلامت سیستم | System Health Check" -ForegroundColor Cyan
    Write-Host "══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    # Python
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) {
        $pyVer = & python --version 2>&1
        Write-LogOk "پایتون: $pyVer" "Python: $pyVer"
    } else {
        Write-LogErr "پایتون نصب نیست!" "Python is not installed!"
    }

    # uv
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        $uvVer = & uv --version 2>&1
        Write-LogOk "ابزار uv: $uvVer" "Astral uv tool: $uvVer"
    } else {
        Write-LogWarn "ابزار uv نصب نیست (استفاده از pip)" "uv tool not found (using pip)"
    }

    # .venv
    if (Test-Path ".venv\Scripts\python.exe") {
        Write-LogOk "محیط مجازی (.venv): آماده است" "Virtual environment (.venv): Ready"
    } else {
        Write-LogErr "محیط مجازی (.venv): موجود نیست" "Virtual environment (.venv): Not found"
    }

    # ffmpeg
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Write-LogOk "ffmpeg (استریم RTSP): نصب است" "ffmpeg (RTSP stream): Installed"
    } else {
        Write-LogWarn "ffmpeg (استریم RTSP): یافت نشد!" "ffmpeg (RTSP stream): Not found!"
    }

    # .env
    if (Test-Path ".env") {
        Write-LogOk "فایل پیکربندی (.env): موجود است" "Configuration file (.env): Exists"
    } else {
        Write-LogWarn "فایل پیکربندی (.env): موجود نیست" "Configuration file (.env): Missing"
    }

    # data/
    if (Test-Path "data") {
        Write-LogOk "دایرکتوری داده (data/): موجود است" "Data directory (data/): Exists"
    } else {
        Write-LogWarn "دایرکتوری داده (data/): موجود نیست" "Data directory (data/): Missing"
    }

    # وضعیت پس‌زمینه و Startup
    Write-Host "──────────────────────────────────────────────────────────────────────" -ForegroundColor DarkCyan
    Write-Host "  📌 وضعیت سرویس پس‌زمینه | Background Status:" -ForegroundColor White
    Get-ServerStatus | Out-Null

    Write-Host "  📌 راه‌اندازی خودکار | Windows Startup:" -ForegroundColor White
    if (Test-Path $StartupShortcut) {
        Write-LogOk "فعال است" "Enabled"
    } else {
        Write-Host "  [INFO] " -NoNewline -ForegroundColor Yellow
        Write-Host "غیرفعال است " -NoNewline -ForegroundColor White
        Write-Host "| Disabled" -ForegroundColor Gray
    }
    Write-Host "══════════════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan
}

function Start-Server {
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-LogWarn "محیط مجازی یافت نشد. ابتدا نصب انجام می‌شود..." "Virtual env not found. Running setup..."
        Install-Dependencies
    }
    Ensure-EnvFiles

    Write-Host "`n╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  🚀 HikStatus در حال اجراست (کنسول) | Running (Console Foreground)    ║" -ForegroundColor Green
    Write-Host "║  🌐 آدرس پنل | Panel URL: http://localhost:$Port                       ║" -ForegroundColor Cyan
    Write-Host "║  🛑 برای توقف کلید Ctrl+C را بزنید | Press Ctrl+C to stop           ║" -ForegroundColor Yellow
    Write-Host "╚══════════════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

    & .venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port $Port
}

function Start-ServerBackground {
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        Write-LogWarn "محیط مجازی یافت نشد. ابتدا نصب انجام می‌شود..." "Virtual env not found. Running setup..."
        Install-Dependencies
    }
    Ensure-EnvFiles

    $activeProc = Get-ActiveServerProcess
    if ($activeProc) {
        Write-LogWarn "سرویس پس‌زمینه قبلاً با PID $($activeProc.Id) راه‌اندازی شده است." "Background service is already running with PID $($activeProc.Id)."
        Write-Host "     🌐 آدرس پنل | Dashboard URL: http://localhost:$Port" -ForegroundColor Cyan
        return
    }

    $uvicornPath = Join-Path $ScriptDir ".venv\Scripts\uvicorn.exe"
    Write-LogInfo "در حال راه‌اندازی سرویس در پس‌زمینه..." "Launching background service..."
    
    $proc = Start-Process -FilePath $uvicornPath -ArgumentList "main:app --host 0.0.0.0 --port $Port" -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru

    if ($proc -and -not $proc.HasExited) {
        Ensure-EnvFiles
        $proc.Id | Out-File -FilePath $PidFile -Encoding utf8
        Start-Sleep -Seconds 1
        Write-LogOk "سرویس پس‌زمینه با موفقیت راه‌اندازی شد. (PID: $($proc.Id))" "Background service started successfully. (PID: $($proc.Id))"
        Write-Host "     🌐 آدرس پنل | Panel URL: " -NoNewline -ForegroundColor White
        Write-Host "http://localhost:$Port" -ForegroundColor Green
        Write-Host "     💡 می‌توانید بدون متوقف شدن پروژه، این ترمینال را ببندید. | You can safely close this terminal." -ForegroundColor Yellow
    } else {
        Write-LogErr "راه‌اندازی سرویس پس‌زمینه ناموفق بود." "Failed to start background service."
    }
}

function Stop-Server {
    Write-LogInfo "در حال توقف سرویس پس‌زمینه..." "Stopping background service..."
    $stopped = $false

    if (Test-Path $PidFile) {
        $savedPid = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
                Write-LogOk "پردازش سرویس (PID: $savedPid) متوقف شد." "Service process (PID: $savedPid) terminated."
                $stopped = $true
            }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    if (-not $stopped) {
        $procs = Get-Process -Name "uvicorn" -ErrorAction SilentlyContinue
        if ($procs) {
            foreach ($p in $procs) {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                Write-LogOk "پروسه uvicorn (PID: $($p.Id)) متوقف شد." "uvicorn process (PID: $($p.Id)) terminated."
                $stopped = $true
            }
        }
    }

    if (-not $stopped) {
        Write-Host "  [INFO] " -NoNewline -ForegroundColor Yellow
        Write-Host "هیچ سرویس پس‌زمینه‌ای فعال نبود. " -NoNewline -ForegroundColor White
        Write-Host "| No active background service was found." -ForegroundColor Gray
    }
}

function Enable-Startup {
    Write-LogInfo "در حال تنظیم راه‌اندازی خودکار ویندوز..." "Setting up Windows Auto-Start..."
    try {
        $wshShell = New-Object -ComObject WScript.Shell
        $shortcut = $wshShell.CreateShortcut($StartupShortcut)
        $shortcut.TargetPath = "powershell.exe"
        $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptDir\start.ps1`" -Action start-bg -Port $Port"
        $shortcut.WorkingDirectory = $ScriptDir
        $shortcut.Description = "HikStatus Auto-Start Background Service"
        $shortcut.Save()

        Write-LogOk "راه‌اندازی خودکار با موفقیت فعال شد." "Windows Auto-Start enabled successfully."
        Write-Host "     💡 با ورود به ویندوز، سرویس خودکار اجرا می‌شود. | Service will auto-start upon Windows login." -ForegroundColor Green
    } catch {
        Write-LogErr "خطا در فعال‌سازی راه‌اندازی خودکار: $_" "Error enabling Auto-Start: $_"
    }
}

function Disable-Startup {
    if (Test-Path $StartupShortcut) {
        Remove-Item $StartupShortcut -Force
        Write-LogOk "راه‌اندازی خودکار غیرفعال شد." "Windows Auto-Start disabled successfully."
    } else {
        Write-Host "  [INFO] " -NoNewline -ForegroundColor Yellow
        Write-Host "راه‌اندازی خودکار قبلاً فعال نشده بود. " -NoNewline -ForegroundColor White
        Write-Host "| Windows Auto-Start was not enabled." -ForegroundColor Gray
    }
}

function Show-Menu {
    while ($true) {
        Clear-Host
        $activeProc = Get-ActiveServerProcess
        $bgStatus = if ($activeProc) { " [فعال 🟢 | Active]" } else { " [غیرفعال 🔴 | Inactive]" }
        $hasStartup = Test-Path $StartupShortcut
        $startupStatus = if ($hasStartup) { " [فعال 🟢 | Active]" } else { " [غیرفعال 🔴 | Inactive]" }

        Write-Host "╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor DarkCyan
        Write-Host "║               HikStatus Native Manager (TUI)                         ║" -ForegroundColor Cyan
        Write-Host "║         مدیریت بومی و استقرار سامانه پایش | Native System Manager        ║" -ForegroundColor DarkGray
        Write-Host "╠══════════════════════════════════════════════════════════════════════╣" -ForegroundColor DarkCyan
        Write-Host "║  1. 🚀 اجرای مستقیم در کنسول  | Start Foreground (Direct Console)   ║" -ForegroundColor White
        Write-Host "║  2. 👻 اجرای سرویس در پس‌زمینه | Start Background Service$bgStatus ║" -ForegroundColor White
        Write-Host "║  3. 🛑 توقف سرویس پس‌زمینه      | Stop Background Service            ║" -ForegroundColor White
        Write-Host "║  4. 📊 مشاهده وضعیت سرویس       | Check Service Status               ║" -ForegroundColor White
        Write-Host "║  5. ⏰ فعال‌سازی اجرا خودکار   | Enable Windows Startup$startupStatus  ║" -ForegroundColor White
        Write-Host "║  6. ❌ غیرفعال‌سازی اجرا خودکار | Disable Windows Startup             ║" -ForegroundColor White
        Write-Host "║  7. 📦 نصب و پیکربندی اولیه    | Full Setup and Install             ║" -ForegroundColor White
        Write-Host "║  8. 🔄 به‌روزرسانی بسته‌ها       | Update Packages                    ║" -ForegroundColor White
        Write-Host "║  9. 🔍 بررسی سلامت سیستم        | System Health Check                ║" -ForegroundColor White
        Write-Host "║  0. 🚪 خروج                    | Exit                               ║" -ForegroundColor White
        Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor DarkCyan
        
        $choice = Read-Host "لطفاً یک گزینه انتخاب کنید | Please select an option [0-9]"

        switch ($choice) {
            "1" { Start-Server; break }
            "2" { Start-ServerBackground; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "3" { Stop-Server; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "4" { Test-HealthCheck; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "5" { Enable-Startup; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "6" { Disable-Startup; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "7" { Install-Dependencies; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "8" { Update-Dependencies; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "9" { Test-HealthCheck; Read-Host "`nجهت بازگشت Enter را بزنید | Press Enter to return..."; break }
            "0" { Write-Host "خداحافظ! | Goodbye!" -ForegroundColor Green; return }
            default { Write-Host "گزینه نامعتبر است | Invalid choice." -ForegroundColor Red; Start-Sleep -Seconds 1 }
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
        Write-Host "HikStatus Dual-Language Help:"
        Write-Host "  .\start.ps1                           منوی تعاملی | Interactive TUI Menu"
        Write-Host "  .\start.ps1 -Action start -Port 28888  اجرای مستقیم | Start Foreground"
        Write-Host "  .\start.ps1 -Action start-bg          اجرا در پس‌زمینه | Start Background Service"
        Write-Host "  .\start.ps1 -Action stop              توقف سرویس | Stop Background Service"
        Write-Host "  .\start.ps1 -Action status            مشاهده وضعیت | Check Background Status"
        Write-Host "  .\start.ps1 -Action enable-startup    فعال‌سازی استارت‌آپ | Enable Auto-Start"
        Write-Host "  .\start.ps1 -Action disable-startup   غیرفعال‌سازی استارت‌آپ | Disable Auto-Start"
        Write-Host "  .\start.ps1 -Action install           نصب وابستگی‌ها | Install Dependencies"
        Write-Host "  .\start.ps1 -Action update            بروزرسانی بسته‌ها | Update Packages"
        Write-Host "  .\start.ps1 -Action check             پایش سلامت | System Health Check"
    }
    default           { Show-Menu }
}
