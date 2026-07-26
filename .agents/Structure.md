# ساختار بنیادی پروژه HikStatus

## زبان‌ها
- **پایتون 3.12+** (بک‌اند)
- **HTML/CSS/JavaScript** (فرانت‌اند)
- **SQLite** (دیتابیس)

## فریم‌ورک‌ها و کتابخانه‌ها
- **FastAPI** - فریم‌ورک وب بک‌اند
- **Uvicorn** - سرور ASGI
- **SQLModel** - ORM دیتابیس
- **jdatetime** - تاریخ شمسی
- **Requests** - درخواست HTTP (ISAPI HikVision)
- **python-dotenv** - مدیریت متغیرهای محیطی

## معماری کلی

### بک‌اند
- `main.py` - نقطه ورود، API endpoints، احراز هویت، مدیریت session
- `monitor.py` - حلقه مانیتورینگ اصلی، polling NVRها، پردازش آلرت‌ها
- `alerts.py` - ارسال ایمیل و تلگرام
- `database.py` - مدل‌های دیتابیس، ارتباطات، migrations
- `.env` - متغیرهای محیطی (ADMIN_USER, ADMIN_PASS)

### فرانت‌اند (تم RTL فارسی)
- `static/index.html` - صفحه اصلی داشبورد
- `static/login.html` - صفحه ورود
- `static/style.css` - استایل‌ها
- `static/app.js` - منطق فرانت‌اند، WebSocket، نقشه

### داکر
- `docker-compose.yml` - سرویس `hikstatus` روی شبکه `vpn`
- `Dockerfile` - بیلد ایمیج Python 3.12-slim

## دیتابیس (SQLite - data/monitor.db)
### جداول اصلی:
- **NVR** (ip PK, name, user, password, enabled, status, group_id FK)
- **Camera** (id PK, name, ip, nvr_ip FK, channel_id, status, importance, موقعیت جغرافیایی, FOV, آمار ضبط)
- **NVRGroup** (id PK, name, description)
- **DowntimeEvent** (id PK, camera_id FK, start_time, end_time)
- **Log** (id PK, timestamp, log_type, state, details)
- **Settings** (key PK, value, description)
- **User** (id PK, username, password_hash, role, group_id FK, is_active)
- **UserAlertSettings** (id PK, user_id FK, mail_enabled, mail_recipients, telegram_enabled, telegram_chat_ids)

## نقش‌های کاربری (RBAC)
1. **admin** - دسترسی کامل به همه چیز
2. **group_control** - دسترسی به NVRها و دوربین‌های گروه خود + ارسال آلرت شخصی
3. **group_view** - فقط مشاهده دوربین‌های گروه خود

## API اصلی
- `/api/auth/login|logout|me` - احراز هویت
- `/api/nvrs` - CRUD NVR
- `/api/cameras` - لیست و ویرایش دوربین‌ها
  - `/api/cameras/off` - لیست دوربین‌های با ضبط غیرفعال (خاموش)
  - `/api/cameras/changes` - لیست تغییرات اخیر دوربین‌ها (۲۴ ساعت و هفته/ماه اخیر)
- `/api/settings` - تنظیمات
- `/api/groups` - مدیریت گروه‌ها
- `/api/users` - مدیریت کاربران
- `/api/me/alerts` - تنظیمات آلرت شخصی
- `/api/logs` - لاگ‌ها
- `/api/stats/*` - آمار قطعی
- `/api/reports/generate` - گزارش
- `/api/data/backup|restore` - پشتیبان‌گیری
- `/ws` - WebSocket برای بروزرسانی لحظه‌ای

## قوانین توسعه
1. **رمزهای عبور و توکن‌ها هرگز در کد هاردکد نمی‌شوند** - از `.env` استفاده شود
2. **پیغام‌های خطای Web UI حتماً به فارسی** هستند
3. **لاگ‌های ترمینال به انگلیسی** نوشته می‌شوند
4. **مستندات و توضیحات به فارسی** نوشته می‌شوند
5. **کامیت‌ها با توضیحات فارسی** انجام شوند
6. دیتابیس SQLite است و از WAL mode استفاده می‌کند
7. WebSocket برای بروزرسانی لحظه‌ای وضعیت دوربین‌ها استفاده می‌شود
8. آلرت‌ها از سیستم delay/count/mute پیروی می‌کنند
9. پورت پیش‌فرض: 28888
10. شبکه داکر: `vpn` (external)
