#!/usr/bin/env bash
# ==============================================================================
# HikStatus - Native TUI Launcher (Linux & macOS)
# ==============================================================================

set -e

# مسیر اجرای اسکریپت
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# رنگ‌بندی ترمینال
BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PORT="${PORT:-28888}"

# ──────────────────────────────────────────────────────────────────────────────
# توابع کمکی
# ──────────────────────────────────────────────────────────────────────────────

ensure_uv() {
    export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.astral/bin:$PATH"
    if command -v uv >/dev/null 2>&1; then
        return 0
    fi

    echo -e "${YELLOW}[HikStatus] ابزار Astral uv یافت نشد. در حال نصب uv...${NC}"
    
    # 1. تلاش برای نصب با curl از آدرس رسمی
    if command -v curl >/dev/null 2>&1 && curl -LsSf https://astral.sh/uv/install.sh | sh; then
        export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.astral/bin:$PATH"
    # 2. در صورت عدم موفقیت curl (مانند اختلال در پروکسی یا شبکه)، تلاش با pip
    elif command -v python3 >/dev/null 2>&1 && python3 -m pip install --quiet uv; then
        export PATH="$HOME/.local/bin:$PATH"
    else
        echo -e "${RED}[ERROR] پایتون ۳ یا curl یافت نشد یا نصب ناموفق بود.${NC}"
    fi

    if command -v uv >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] uv با موفقیت نصب شد.${NC}"
    else
        echo -e "${YELLOW}[WARN] نصب uv ناموفق بود. استفاده از پایتون پیش‌فرض ادامه می‌یابد.${NC}"
    fi
}

ensure_venv() {
    ensure_uv
    if [ ! -d ".venv" ]; then
        echo -e "${CYAN}[HikStatus] در حال ساخت محیط مجازی (.venv)...${NC}"
        if command -v uv >/dev/null 2>&1; then
            uv venv .venv
        else
            python3 -m venv .venv
        fi
        echo -e "${GREEN}[OK] محیط مجازی ساخته شد.${NC}"
    fi
}

ensure_env_files() {
    mkdir -p data
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            echo -e "${YELLOW}[WARN] فایل .env از روی .env.example ساخته شد. لطفاً آن را ویرایش کنید.${NC}"
        fi
    fi
}

install_deps() {
    ensure_venv
    echo -e "${CYAN}[HikStatus] در حال نصب وابستگی‌ها با uv...${NC}"
    if command -v uv >/dev/null 2>&1; then
        uv pip install -r requirements.txt --python .venv/bin/python
    else
        .venv/bin/pip install --quiet -r requirements.txt
    fi
    ensure_env_files
    echo -e "${GREEN}[OK] تمامی وابستگی‌ها با موفقیت نصب شدند.${NC}"
}

update_deps() {
    ensure_venv
    echo -e "${CYAN}[HikStatus] در حال بروزرسانی وابستگی‌ها...${NC}"
    if command -v uv >/dev/null 2>&1; then
        uv pip install --upgrade -r requirements.txt --python .venv/bin/python
    else
        .venv/bin/pip install --quiet --upgrade -r requirements.txt
    fi
    echo -e "${GREEN}[OK] بسته‌ها بروزرسانی شدند.${NC}"
}

health_check() {
    echo -e "\n${BOLD}=== پایش سلامت سیستم (Health Check) ===${NC}\n"
    
    # 1. پایتون
    if command -v python3 >/dev/null 2>&1; then
        PY_V=$(python3 --version)
        echo -e " [✓] پایتون: ${GREEN}${PY_V}${NC}"
    else
        echo -e " [✗] پایتون: ${RED}نصب نیست!${NC}"
    fi

    # 2. uv
    if command -v uv >/dev/null 2>&1; then
        UV_V=$(uv --version)
        echo -e " [✓] ابزار uv: ${GREEN}${UV_V}${NC}"
    else
        echo -e " [!] ابزار uv: ${YELLOW}نصب نیست (استفاده از pip استاندارد)${NC}"
    fi

    # 3. venv
    if [ -f ".venv/bin/python" ]; then
        echo -e " [✓] محیط مجازی (.venv): ${GREEN}آماده است${NC}"
    else
        echo -e " [✗] محیط مجازی (.venv): ${RED}موجود نیست (گزینه ۲ را اجرا کنید)${NC}"
    fi

    # 4. ffmpeg
    if command -v ffmpeg >/dev/null 2>&1; then
        echo -e " [✓] ffmpeg (استریم RTSP): ${GREEN}نصب است${NC}"
    else
        echo -e " [!] ffmpeg (استریم RTSP): ${YELLOW}یافت نشد! استریم ویدیو کار نخواهد کرد.${NC}"
    fi

    # 5. فایل .env
    if [ -f ".env" ]; then
        echo -e " [✓] فایل پیکربندی (.env): ${GREEN}موجود است${NC}"
    else
        echo -e " [!] فایل پیکربندی (.env): ${YELLOW}ساخته نشده است${NC}"
    fi

    # 6. دایرکتوری data
    if [ -d "data" ]; then
        echo -e " [✓] دایرکتوری داده (data/): ${GREEN}موجود است${NC}"
    else
        echo -e " [!] دایرکتوری داده (data/): ${YELLOW}ساخته نشده است${NC}"
    fi

    # 7. بررسی پروسه‌های در حال اجرای وب و زمان‌بند
    echo -e "\n${BOLD}=== وضعیت سرویس‌ها (Service Status) ===${NC}"
    if pgrep -f "uvicorn main:app" >/dev/null 2>&1; then
        WEB_PIDS=$(pgrep -f "uvicorn main:app" | tr '\n' ' ')
        echo -e " [✓] سرویس وب (Web Service): ${GREEN}فعال است (PID: ${WEB_PIDS})${NC}"
    else
        echo -e " [!] سرویس وب (Web Service): ${YELLOW}غیرفعال است${NC}"
    fi

    if pgrep -f "scheduler_runner.py" >/dev/null 2>&1; then
        SCHED_PIDS=$(pgrep -f "scheduler_runner.py" | tr '\n' ' ')
        echo -e " [✓] سرویس زمان‌بند (Scheduler Service): ${GREEN}فعال است (PID: ${SCHED_PIDS})${NC}"
    else
        echo -e " [!] سرویس زمان‌بند (Scheduler Service): ${YELLOW}غیرفعال است${NC}"
    fi

    echo ""
}

# راه‌اندازی همزمان پروسه وب و زمان‌بند در لینوکس
start_server() {
    if [ ! -f ".venv/bin/python" ]; then
        echo -e "${YELLOW}[WARN] محیط مجازی یافته نشد. ابتدا فرایند نصب انجام می‌شود...${NC}"
        install_deps
    fi

    ensure_env_files

    echo -e "\n${GREEN}${BOLD}🚀 در حال راه‌اندازی همزمان سرویس وب HikStatus و موتور زمان‌بند...${NC}"
    echo -e "${CYAN}آدرس پنل: http://localhost:${PORT}${NC}"
    echo -e "${YELLOW}جهت توقف کامل هر دو پروسه، کلید Ctrl+C را فشار دهید.${NC}\n"

    # مدیریت سیگنال‌های خروج جهت متوقف کردن هر دو پروسه
    trap 'echo -e "\n${YELLOW}[HikStatus] در حال متوقف کردن پروسه‌های وب و زمان‌بند...${NC}"; kill $SCHEDULER_PID $WEB_PID 2>/dev/null' EXIT INT TERM
    
    # راه‌اندازی مستقل موتور زمان‌بند در پس‌زمینه
    .venv/bin/python scheduler_runner.py &
    SCHEDULER_PID=$!

    # راه‌اندازی سرویس اصلی وب FastAPI/Uvicorn
    .venv/bin/uvicorn main:app --host 0.0.0.0 --port "$PORT" &
    WEB_PID=$!

    # انتظار برای پایان کار پروسه‌ها
    wait $WEB_PID $SCHEDULER_PID 2>/dev/null
}

show_menu() {
    clear 2>/dev/null || true
    echo -e "${BLUE}${BOLD}====================================================${NC}"
    echo -e "${CYAN}${BOLD}             HikStatus Manager (Native TUI)          ${NC}"
    echo -e "${BLUE}${BOLD}====================================================${NC}"
    echo -e "  ${BOLD}1)${NC} 🚀 راه اندازی برنامه (Start Server)"
    echo -e "  ${BOLD}2)${NC} 📦 نصب و پیکربندی اولیه (Full Setup & Install)"
    echo -e "  ${BOLD}3)${NC} 🔄 به‌روزرسانی وابستگی‌ها (Update Packages)"
    echo -e "  ${BOLD}4)${NC} 🔍 بررسی سلامت سیستم (Health Check)"
    echo -e "  ${BOLD}5)${NC} 🚪 خروج (Exit)"
    echo -e "${BLUE}${BOLD}====================================================${NC}"
    read -rp "لطفاً گزینه مورد نظر را انتخاب کنید [1-5]: " choice

    case "$choice" in
        1)
            start_server
            ;;
        2)
            install_deps
            read -rp "جهت بازگشت به منو کلید Enter را بزنید..."
            show_menu
            ;;
        3)
            update_deps
            read -rp "جهت بازگشت به منو کلید Enter را بزنید..."
            show_menu
            ;;
        4)
            health_check
            read -rp "جهت بازگشت به منو کلید Enter را بزنید..."
            show_menu
            ;;
        5)
            echo -e "${GREEN}خداحافظ!${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}گزینه نامعتبر است.${NC}"
            sleep 1
            show_menu
            ;;
    esac
}

# ──────────────────────────────────────────────────────────────────────────────
# ورودی خط فرمان (Non-interactive mode)
# ──────────────────────────────────────────────────────────────────────────────
case "$1" in
    start|--start)
        if [ -n "$2" ]; then PORT="$2"; fi
        start_server
        ;;
    install|--install)
        install_deps
        ;;
    update|--update)
        update_deps
        ;;
    check|--check)
        health_check
        ;;
    help|--help|-h)
        echo "راهنمای اسکریپت HikStatus:"
        echo "  ./start.sh                  اجرای منوی تعاملی TUI"
        echo "  ./start.sh start [PORT]     اجرای مستقیم سرور"
        echo "  ./start.sh install          نصب نیازمندی‌ها"
        echo "  ./start.sh update           بروزرسانی نیازمندی‌ها"
        echo "  ./start.sh check            بررسی سلامت محیط"
        ;;
    *)
        show_menu
        ;;
esac
