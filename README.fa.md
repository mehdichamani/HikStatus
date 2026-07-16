# HikStatus

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)

داشبورد مانیتورینگ لحظه‌ای دوربین‌ها و دستگاه‌های NVR هایک‌ویژن با اعلان از طریق ایمیل و تلگرام.

## امکانات

- مانیتورینگ لحظه‌ای وضعیت دوربین‌ها (آنلاین / آفلاین)
- همگام‌سازی خودکار نام دوربین‌ها از NVR از طریق ISAPI هایک‌ویژن
- سیستم اعلان از طریق ایمیل (SMTP) و تلگرام (Bot API)
- تنظیم تأخیر، فاصله و سقف بی‌صدا کردن اعلان‌ها
- ردیابی زمان قطعی با آمار دقیق برای هر دوربین
- سطح اهمیت دوربین‌ها (کم / متوسط / بحرانی)
- نقشه تعاملی با قابلیت قرار دادن دوربین (پلان طبقه یا نقشه جغرافیایی)
- پشتیبان‌گیری و بازیابی پایگاه داده از طریق رابط وب
- رابط کاربری فارسی با پشتیبانی کامل RTL
- طراحی واکنش‌گرا برای دسکتاپ و موبایل

---

## شروع سریع

### روش اول: Docker (توصیه‌شده)

```bash
# کلون کردن مخزن
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# پیکربندی محیط
cp .env.example .env
# فایل .env را ویرایش کنید و ADMIN_USER و ADMIN_PASS را تنظیم کنید

# (اختیاری) پیش‌پیکربندی NVRها و تنظیمات
cp init_config.example.json init_config.json
# فایل init_config.json را با اطلاعات NVRهای خود ویرایش کنید

# ساخت و اجرا
docker compose up -d
```

> [!IMPORTANT]
> **وابستگی به شبکه خارجی داکر (`vpn`)**
> 
> به طور پیش‌فرض، فایل `docker-compose.yml` به یک شبکه خارجی به نام `vpn` متصل است.
> - **در صورتی که می‌خواهید از این شبکه استفاده کنید**، پیش از اجرای داکر حتماً آن را بسازید:
>   ```bash
>   docker network create vpn
>   ```
> - **در صورتی که نیازی به این شبکه ندارید (اختیاری)**، می‌توانید بخش `networks` را در انتهای فایل [docker-compose.yml](file:///home/unreal/docker/HikStatus/docker-compose.yml) کامنت کرده یا حذف کنید تا کانتینر از شبکه پیش‌فرض (Bridge) استفاده کند.

> [!TIP]
> **مشکل دسترسی (`sqlite3.OperationalError: unable to open database file`)**
>
> اگر داکر پوشه `./data` را خودکار بسازد، ممکن است مالکیت آن به `root` تعلق گیرد و کاربر غیر ریشه داخل کانتینر (`appuser` با شناسه ۱۰۰۰) نتواند بنویسد. برای رفع:
> ```bash
> sudo chown -R 1000:1000 ./data
> ```

---

### روش دوم: Python بومی (لینوکس / مک)

```bash
# کلون کردن مخزن
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# پیکربندی محیط
cp .env.example .env
# فایل .env را ویرایش کنید

# (اختیاری) پیش‌پیکربندی
cp init_config.example.json init_config.json

# اجرا (محیط مجازی و وابستگی‌ها خودکار نصب می‌شوند)
chmod +x start.sh
./start.sh
```

برای اجرا روی پورت دلخواه:
```bash
./start.sh 8080
```

---

### روش سوم: Python بومی (ویندوز)

```bat
REM کلون کردن مخزن
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

REM پیکربندی محیط
copy .env.example .env
REM فایل .env را ویرایش کرده و ADMIN_USER و ADMIN_PASS را تنظیم کنید

REM (اختیاری) پیش‌پیکربندی NVRها
copy init_config.example.json init_config.json

REM نصب اولیه (ایجاد .venv و نصب وابستگی‌ها)
install.bat

REM اجرای برنامه
start.bat
```

برای اجرا روی پورت دلخواه:
```bat
start.bat 8080
```

برای حذف نصب (فقط `.venv` حذف می‌شود، داده‌ها و تنظیمات حفظ می‌شوند):
```bat
uninstall.bat
```

> [!NOTE]
> نیاز به Python 3.10 یا بالاتر دارید. از https://www.python.org/downloads/ دانلود کنید و هنگام نصب گزینه **"Add Python to PATH"** را فعال کنید.

---

### دسترسی

مرورگر خود را باز کنید: **http://localhost:28888**

نام کاربری و رمز عبور پیش‌فرض (در `.env` تنظیم می‌شود):
- نام کاربری: `admin`
- رمز عبور: `admin` ← **قبل از انتشار در شبکه حتماً تغییر دهید**

---

## پیکربندی

### متغیرهای محیطی (`.env`)

```env
ADMIN_USER=admin
ADMIN_PASS=your-secure-password
```

این اطلاعات برای ورود به رابط وب استفاده می‌شوند. از `.env.example` کپی کرده و ویرایش کنید.

---

### پیکربندی اولیه (`init_config.json`)

فایل `init_config.example.json` را به `init_config.json` کپی کرده تا در اولین راه‌اندازی (یا پس از عملیات «پاکسازی و بارگذاری تنظیمات اولیه») پایگاه داده مقداردهی شود:

```json
{
  "settings": {
    "MAIL_ENABLED": "true",
    "MAIL_SERVER": "smtp.gmail.com",
    "MAIL_PORT": "587",
    "MAIL_USER": "your-email@gmail.com",
    "MAIL_PASS": "your-app-password",
    "MAIL_RECIPIENTS": "admin@example.com",
    "TELEGRAM_ENABLED": "true",
    "TELEGRAM_BOT_TOKEN": "your-bot-token",
    "TELEGRAM_CHAT_IDS": "your-chat-id"
  },
  "nvrs": [
    {
      "ip": "192.168.1.100:8000",
      "name": "ساختمان اصلی",
      "user": "admin",
      "password": "your-nvr-password",
      "enabled": true
    }
  ]
}
```

> [!NOTE]
> **پروکسی تلگرام (داکر)**
>
> اگر پروکسی روی سیستم میزبان (مثلاً `127.0.0.1:10808`) اجرا می‌شود، از آدرس `http://host.docker.internal:10808` در تنظیمات تلگرام استفاده کنید.

---

## نام دوربین‌ها (همگام‌سازی خودکار ISAPI)

نام دوربین‌ها در هر بار راه‌اندازی برنامه به صورت خودکار از هر NVR از طریق **ISAPI هایک‌ویژن** دریافت و به‌روزرسانی می‌شوند. در صورت تغییر نام دوربین‌ها در NVR، می‌توانید از رابط وب همگام‌سازی دستی انجام دهید:

**تنظیمات → کنترل سیستم → همگام‌سازی نام دوربین‌ها**

نام پشتیبان در صورت عدم دسترسی به ISAPI: `<نام NVR> ch <شماره کانال>`

---

## راهنمای احراز هویت HikVision

اگر:

- NVR اضافه نمی‌شود
- دوربین‌ها آفلاین نمایش داده می‌شوند
- خطای `401 Unauthorized` دریافت می‌کنید

احتمالاً باید:

- ISAPI را فعال کنید
- Digest Authentication را فعال کنید
- یک کاربر غیرادمین مخصوص HikStatus بسازید

راهنمای کامل:

- [راهنمای احراز هویت HikVision](HIKVISION_AUTH_SETUP.fa.md)

---

## رابط تنظیمات

پنل تنظیمات وب به تب‌های زیر تقسیم شده است:

| تب | محتوا |
|----|-------|
| **NVRها** | افزودن / حذف NVR با حذف مرحله‌ای (لغو قبل از تأیید) |
| **تنظیمات ایمیل** | پیکربندی SMTP، تأخیر، فاصله، سقف بی‌صدا |
| **تنظیمات تلگرام** | توکن ربات، شناسه چت، پروکسی، تأخیر و بی‌صدا |
| **کنترل سیستم** | همگام‌سازی نام، پشتیبان‌گیری/بازیابی، اعمال و ریستارت، منطقه خطر |

### منطقه خطر

| عملیات | تأثیر |
|---------|-------|
| پاکسازی و پایگاه داده خالی | حذف همه داده‌ها؛ فقط تنظیمات پیش‌فرض ایجاد می‌شود |
| پاکسازی و بارگذاری تنظیمات اولیه | حذف همه داده‌ها و مقداردهی از `init_config.json` |

---

## پشتیبان‌گیری و بازیابی پایگاه داده

از **تنظیمات → کنترل سیستم → پشتیبان‌گیری و بازیابی**:

- **دریافت پشتیبان**: دانلود فایل `monitor.db` با نام `hikstatus_backup_YYYYMMDD_HHMMSS.db`
- **بازیابی از فایل**: آپلود فایل `.db` پشتیبان؛ سرور اعتبار SQLite را بررسی کرده، پایگاه داده را اتمیک جایگزین می‌کند و مانیتور را مجدداً راه‌اندازی می‌کند

---

## معماری

| لایه | فناوری |
|------|--------|
| بک‌اند | Python 3.12، FastAPI، Uvicorn |
| پایگاه داده | SQLite با حالت WAL (از طریق SQLModel / SQLAlchemy) |
| فرانت‌اند | HTML + CSS + JavaScript خالص، RTL |
| اعلان‌ها | SMTP ایمیل، Telegram Bot API |
| کانتینر | Docker + Docker Compose |

---

## ساختار پروژه

```
HikStatus/
├── main.py                   # برنامه FastAPI، مسیرها، احراز هویت، پشتیبان/بازیابی
├── monitor.py                # حلقه پایش دوربین + همگام‌سازی ISAPI
├── alerts.py                 # منطق اعلان ایمیل و تلگرام
├── database.py               # مدل‌های SQLModel و موتور پایگاه داده
├── static/
│   ├── index.html            # داشبورد اصلی SPA
│   ├── login.html            # صفحه ورود
│   ├── app.js                # منطق فرانت‌اند
│   └── style.css             # استایل‌ها
├── Dockerfile                # تعریف ایمیج Docker
├── docker-compose.yml        # پیکربندی Docker Compose
├── requirements.txt          # وابستگی‌های Python
├── start.sh                  # راه‌انداز Python بومی (لینوکس/مک)
├── install.bat               # نصب اولیه ویندوز
├── start.bat                 # راه‌انداز ویندوز
├── uninstall.bat             # حذف نصب ویندوز
├── init_config.example.json  # قالب برای مقداردهی اولیه پایگاه داده
├── .env.example              # قالب برای متغیرهای محیطی
└── .env                      # اسرار (gitignored)
```

---

## پایانه‌های API

| متد | پایانه | توضیحات |
|-----|--------|---------|
| GET | `/api/health` | بررسی سلامت |
| POST | `/api/auth/login` | ورود |
| POST | `/api/auth/logout` | خروج |
| GET | `/api/nvrs` | لیست NVRها |
| POST | `/api/nvrs` | افزودن NVR |
| DELETE | `/api/nvrs/{ip}` | حذف NVR (و همه دوربین‌ها و رویدادهای قطعی) |
| GET | `/api/cameras` | لیست همه دوربین‌ها |
| PUT | `/api/cameras/{id}` | ویرایش دوربین (نام، اهمیت، موقعیت، بی‌صدا) |
| GET | `/api/settings` | لیست همه تنظیمات |
| PUT | `/api/settings/{key}` | ویرایش یک تنظیم |
| GET | `/api/logs` | جستجوی لاگ‌ها |
| GET | `/api/stats/{cam_id}` | آمار قطعی دوربین |
| GET | `/api/reports/generate` | تولید گزارش قطعی |
| POST | `/api/monitor/restart` | ریستارت حلقه مانیتورینگ |
| POST | `/api/config/sync-names` | همگام‌سازی دستی نام دوربین‌ها از NVRها |
| GET | `/api/data/backup` | دانلود پایگاه داده به عنوان فایل `.db` |
| POST | `/api/data/restore` | بازیابی پایگاه داده از فایل آپلودشده |
| POST | `/api/data/purge/empty` | پاکسازی و ایجاد پایگاه داده خالی |
| POST | `/api/data/purge/init` | پاکسازی و بارگذاری از `init_config.json` |
| POST | `/api/test/email` | ارسال ایمیل آزمایشی |
| POST | `/api/test/telegram` | ارسال پیام تلگرام آزمایشی |

---

## مجوز

MIT License
