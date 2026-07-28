# ساختار بنیادی پروژه HikStatus

## زبان‌ها
- **پایتون 3.12+** (بک‌اند)
- **HTML/CSS/JavaScript** (فرانت‌اند)
- **SQLite** (دیتابیس)

## فریم‌ورک‌ها و کتابخانه‌ها
- **FastAPI** - فریم‌ورک وب بک‌اند
- **Uvicorn** - سرور ASGI
- **SQLModel** - ORM دیتابیس (برپایه SQLAlchemy)
- **jdatetime** - تاریخ شمسی و بومی‌سازی زمان
- **Requests** - درخواست‌های HTTP جهت تعامل با ISAPI دوربین‌ها و NVRهای HikVision
- **python-dotenv** - مدیریت متغیرهای محیطی و فایل .env
- **cryptography** - رمزنگاری اطلاعات حساس (مانند رمزهای عبور NVRها با الگوریتم Fernet)
- **pyotp** - احراز هویت دو مرحله‌ای (2FA) با تولید کدهای OTP یکبار مصرف
- **loguru** - ثبت پیشرفته و سازماندهی‌شده لاگ‌های سیستمی

## معماری کلی

### بک‌اند
- `main.py` - نقطه ورود اصلی، API endpoints، سیستم احراز هویت، نشست‌ها (session)، و کنترل‌های مانیتورینگ
- `monitor.py` - حلقه مانیتورینگ اصلی پس‌زمینه، Polling NVRها، دریافت وضعیت‌ها از طریق ISAPI و پردازش رویدادهای قطعی و هشدارها
- `alerts.py` - منطق و سرویس ارسال ایمیل (SMTP) و تلگرام (Bot API) با مکانیزم‌های delay و mute
- `database.py` - اتصالات دیتابیس، مدل‌های SQLModel و مهاجرت‌ها (Migrations)
- `camera_stats.py` - محاسبات و عملکردهای آماری مربوط به ضبط و پایداری دوربین‌ها
- `rate_limiter.py` - پیاده‌سازی سیستم مدیریت نرخ درخواست‌ها (Rate Limiting) با دکوراتور اختصاصی
- `scheduler.py` - زمان‌بندی کارهای پس‌زمینه به صورت توزیع‌شده و همگام
- `logging_config.py` - ساختاردهی و شخصی‌سازی لاگ‌ها
- `.env` - متغیرهای محیطی و امنیتی پروژه (مانند نام کاربری و رمز پیش‌فرض ادمین و کلیدهای رمزنگاری)

### فرانت‌اند (تم RTL فارسی)
- `static/index.html` - صفحه اصلی پنل داشبورد (Single Page Application)
- `static/login.html` - صفحه ورود کاربری به همراه پشتیبانی از ۲ مرحله‌ای
- `static/style.css` - استایل‌ها، تعاریف تم‌های تیره و روشن، انیمیشن‌ها و ویژگی‌های واکنش‌گرا
- `static/app.js` - منطق فرانت‌اند، اتصالات WebSocket، مدیریت مارکرها روی نقشه، ویرایشگر موقعیت، چارت‌ها و تعامل با API

### داکر
- `docker-compose.yml` - سرویس `hikstatus` روی شبکه بیرونی `vpn` با پیکربندی‌های پیش‌فرض
- `Dockerfile` - بیلد بهینه ایمیج پایتون بر اساس `python:3.12-slim` (تغییریافته به AWS Public ECR جهت دور زدن محدودیت‌های تحریم داکر هاب)

## دیتابیس (SQLite - data/monitor.db)
دیتابیس در حالت WAL (Write-Ahead Logging) کار می‌کند و ایندکس‌های کارایی مناسب برای بهینه‌سازی کوئری‌های پرکاربرد (مانند رویدادهای قطعی و لاگ‌ها) بر روی آن ایجاد شده‌اند.

### جداول اصلی و فیلدها:
1. **NVRGroup** (گروه‌های NVR)
   - `id`: PK
   - `name`: str (یکتا)
   - `description`: str (اختیاری)
   - `map_center_lat`: float (مرکز نقشه - عرض جغرافیایی)
   - `map_center_lng`: float (مرکز نقشه - طول جغرافیایی)
   - `map_zoom`: int (بزرگ‌نمایی نقشه)

2. **MapPlan** (پلان‌های نقشه تصویری گروه‌ها)
   - `id`: PK
   - `group_id`: FK (ارتباط با NVRGroup)
   - `name`: str
   - `image_url`: str
   - `sort_order`: int (ترتیب نمایش)

3. **NVR** (دستگاه‌های ضبط تصاویر)
   - `ip`: str (PK)
   - `name`: str
   - `user`: str
   - `password`: str (به صورت رمزنگاری‌شده ذخیره می‌شود)
   - `enabled`: bool (فعال/غیرفعال بودن مانیتورینگ)
   - `status`: str (وضعیت آنلاین/آفلاین/نامشخص)
   - `last_online`: datetime
   - `mail_alert_count`: int
   - `mail_last_alert`: datetime
   - `telegram_alert_count`: int
   - `telegram_last_alert`: datetime
   - `group_id`: FK (ارتباط با NVRGroup)
   - `rtsp_port`: int (پورت پخش زنده - پیش‌فرض ۵۵۴)

4. **Camera** (دوربین‌های متصل به NVRها)
   - `id`: PK
   - `name`: str
   - `ip`: str
   - `nvr_ip`: str (FK به NVR.ip با ایندکس اختصاصی)
   - `channel_id`: str (شناسه کانال روی NVR)
   - `importance`: int (درجه اهمیت: 1=Low, 2=Normal, 3=Critical)
   - `last_online`: datetime
   - `status`: str (وضعیت پایش ضبط/اتصال)
   - `mail_alert_count`: int
   - `mail_last_alert`: datetime
   - `telegram_alert_count`: int
   - `telegram_last_alert`: datetime
   - `latitude`, `longitude`: float (موقعیت روی نقشه جهانی)
   - `x_pos`, `y_pos`: float (موقعیت روی نقشه پلان تصویری)
   - `fov_angle`, `fov_radius`, `fov_spread`: float (پارامترهای مخروط زاویه دید)
   - `plan_id`: FK (ارتباط با MapPlan)
   - `model`: str (مدل دوربین برگشتی از ISAPI)
   - `recording_scheduled`: bool (آیا ضبط برنامه‌ریزی‌شده فعال است)
   - `recording_schedule_type`: str
   - `oldest_record`: datetime (تاریخ قدیمی‌ترین ضبط موجود روی دیسک NVR)
   - `total_record_size_gb`: float (حجم کل ضبط‌ها به گیگابایت)
   - `total_record_duration_hours`: float (مدت زمان کل ضبط‌ها به ساعت)
   - `recording_hours_24h`: float (میزان ضبط در ۲۴ ساعت گذشته)
   - `stats_last_updated`: datetime

5. **CameraChangeEvent** (تاریخچه تغییرات دوربین‌ها)
   - `id`: PK
   - `nvr_ip`: str (دارای ایندکس)
   - `camera_name`: str
   - `camera_channel_id`: str
   - `change_type`: str (رویدادها: camera_added, camera_removed, recording_changed)
   - `old_value`, `new_value`: str
   - `detected_at`: datetime
   - `group_id`: FK (ارتباط با NVRGroup)

6. **DowntimeEvent** (رویدادهای قطعی دوربین‌ها)
   - `id`: PK
   - `camera_id`: FK (ارتباط با Camera)
   - `start_time`: datetime (زمان شروع قطعی - دارای ایندکس)
   - `end_time`: datetime (زمان وصل مجدد - دارای ایندکس و نال‌پذیر)

7. **OutageExplanation** (سیستم رفع ابهام قطعی‌ها و توضیحات رویدادها)
   - `id`: PK
   - `camera_id`: FK (ارتباط با Camera)
   - `downtime_event_id`: FK (نال‌پذیر - ارتباط با DowntimeEvent)
   - `group_id`: FK (ارتباط با NVRGroup)
   - `start_time`: datetime
   - `end_time`: datetime (نال‌پذیر)
   - `created_at`: datetime
   - `assigned_deadline`: datetime (مهلت ثبت توضیح قطعی)
   - `explanation_type`: str (ارتباط با علت‌های قطعی)
   - `explanation_detail`: str (جزییات ثبت‌شده توسط ناظر)
   - `explained_by_user_id`: FK (کاربر ثبت‌کننده توضیح)
   - `explained_at`: datetime

8. **OutageCause** (علت‌های مجاز قطعی سیستم)
   - `id`: PK
   - `name`: str (یکتا و ایندکس‌دار)
   - `is_active`: bool

9. **Log** (لاگ‌های مانیتورینگ و لاگ‌های امنیتی/Audit)
   - `id`: PK
   - `timestamp`: datetime (دارای ایندکس)
   - `category`: str (دسته‌بندی: System, Auth, User, Monitor و غیره)
   - `level`: str (سطح لاگ: INFO, WARNING, ERROR)
   - `action`: str (اکشنِ لاگین، ایجاد کاربر، حذف NVR و غیره)
   - `actor_username`: str (کاربر عامل اکشن)
   - `actor_ip`: str
   - `group_id`: FK (ارتباط با NVRGroup)
   - `target_type`, `target_id`: str (موجودیت هدف برای Audit Log)
   - `details`: str (توضیحات فارسی رویداد)
   - `log_type`, `state`: str (سازگاری با فیلدهای قدیمی)

10. **Settings** (تنظیمات سراسری کلید-مقدار)
    - `key`: str (PK)
    - `value`: str
    - `description`: str

11. **User** (کاربران سیستم)
    - `id`: PK
    - `username`: str (یکتا و دارای ایندکس)
    - `password_hash`: str (هش‌شده با الگوریتم pbkdf2_hmac با سالت تصادفی)
    - `role`: str (نقش‌های کاربری تعریف‌شده در RBAC)
    - `group_id`: FK (گروه اصلی کاربر - ارتباط با NVRGroup)
    - `accessible_group_ids`: str (لیست کاما-جدا شده از گروه‌های مجاز برای دسترسی همزمان)
    - `is_active`: bool
    - `two_factor_secret`: str (کلید سکرت سیستم دو مرحله‌ای)
    - `two_factor_enabled`: bool

12. **UserAlertSettings** (تنظیمات ارسال هشدارهای اختصاصی کاربران)
    - `id`: PK
    - `user_id`: FK (یکتا - ارتباط با User)
    - `mail_enabled`: bool
    - `mail_recipients`: str (تنها یک آدرس ایمیل معتبر مجاز است)
    - `telegram_enabled`: bool
    - `telegram_chat_ids`: str (تنها یک چت آیدی تلگرام معتبر مجاز است)

13. **UserSession** (نشست‌های فعال کاربران)
    - `token`: str (PK)
    - `username`: str
    - `role`: str
    - `group_id`: FK
    - `user_id`: FK
    - `created_at`: datetime
    - `expires_at`: datetime
    - `last_activity`: datetime

14. **ScheduledTask** (وظایف زمان‌بندی‌شده سیستمی)
    - `id`: str (PK)
    - `name`: str
    - `description`: str
    - `interval`: int (فاصله زمانی به ثانیه)
    - `is_enabled`: bool
    - `status`: str (Idle / Running)
    - `last_run`, `last_duration`, `last_status`: datetime/float/str
    - `last_error`: str
    - `next_run`: datetime

## نقش‌های کاربری (RBAC)
سیستم از مکانیزم کنترل دسترسی مبتنی بر نقش (Role-Based Access Control) استفاده می‌کند:

1. **admin** (مدیر کل سیستم): دسترسی کامل و بی‌محدودیت به تمامی تنظیمات، ویرایش‌ها، افزودن/حذف NVRها، مدیریت کاربران، مشاهده تمام گروه‌ها، پشتیبان‌گیری و پاک‌سازی دیتابیس.
2. **it_manager** (مدیر فناوری - IT): دسترسی به مدیریت، مانیتورینگ و ویرایش اطلاعات دوربین‌ها و NVRهای متعلق به گروه خود یا گروه‌های دسترسی چندگانه (`accessible_group_ids`) و همچنین قابلیت توضیح قطعی‌ها در سیستم رفع ابهام.
3. **inspector** (ناظر ارشد): دسترسی مانیتورینگ کامل به دوربین‌ها و نقشه‌ها و گزارش‌های مرتبط با گروه‌های خود، فاقد دسترسی مدیریتی و تغییر ساختار، با دسترسی به ثبت گزارش قطعی‌ها.
4. **group_view** (کاربر مشاهده‌گر گروه): پایین‌ترین سطح دسترسی که فقط و فقط می‌تواند وضعیت زنده، چارت‌ها و قطعی‌های دوربین‌های گروه خود را به صورت سناریوی مشاهده‌گر دنبال کند و دکمه‌های ثبت و ویرایش برای او پنهان است.

## APIهای کلیدی
- `/api/auth/*` - لاگین، خروج، مدیریت ۲ مرحله‌ای (2FA) و تغییر رمز عبور زنده
- `/api/nvrs` - مدیریت دستگاه‌های NVR (فقط ادمین)
- `/api/cameras` - مانیتورینگ دوربین‌ها، ویرایش خصوصیات، ثبت موقعیت و FOV روی نقشه
  - `/api/cameras/{id}/snapshot` - دریافت آخرین فریم زنده دوربین به وسیله ISAPI
  - `/api/cameras/{id}/stream` - سیستم پروکسی یا تبدیل زنده استریم RTSP به تصاویر متحرک JPEG
- `/api/groups` - مدیریت گروه‌ها و ارتباط دوربین‌ها
- `/api/users` - مدیریت کاربران و تخصیص نقش‌ها و گروه‌های چندگانه به آنها
- `/api/me/alerts` - تنظیمات ارسال نوتیفیکیشن ایمیل و تلگرام برای کاربر جاری (حداکثر ۱ ایمیل یا چت آیدی تلگرام)
- `/api/logs` - دریافت و فیلتر پیشرفته لاگ‌های سیستمی و Audit Logs بر اساس گروه‌ها و دسته‌ها
- `/api/outage-explanations` - ثبت، مشاهده و ویرایش توضیحات رفع ابهام قطعی دوربین‌ها بر اساس مهلت اختصاص‌یافته
- `/api/outage-causes` - لیست کردن و مدیریت انواع علت‌های از پیش‌تعریف‌شده قطعی دوربین‌ها
- `/api/reports/generate` - سیستم خروجی اکسل یا گزارش‌گیری متنی پایداری دوربین‌ها بدون گلوگاه عملکردی
- `/api/scheduler/tasks` - کنترل دستی یا فعال‌سازی کارهای زمان‌بندی‌شده سیستمی
- `/api/data/*` - فرآیندهای حساس ادمین شامل دانلود کامل بک‌آپ دیتابیس، بازیابی از فایل بک‌آپ دیتابیس و پاک‌سازی دیتابیس

## قوانین معماری و توسعه
1. **امنیت پسوردها و کلیدها:** هیچ رمز عبوری یا توکنی در پایگاه داده یا کدها به صورت متن آشکار (Plain text) ذخیره یا هاردکد نمی‌شود. متدهای رمزنگاری اختصاصی Fernet با کلیدهای داینامیک یا هش PBKDF2 برای امنیت کامل استفاده می‌شوند.
2. **پیشگیری از گلوگاه‌های عملکردی:** در کدهای مانیتورینگ، آمارها و تولید گزارش‌ها، به شدت از کدهای تو در تو با پیچیدگی O(N^2) و الگوهای N+1 Query اجتناب شده است. همه اطلاعات لازم در حافظه موقت (In-Memory) دسته‌بندی و مپ می‌شوند.
3. **تاریخ و بومی‌سازی شمسی:** وب سرویس خطاها را کاملاً به زبان شیرین فارسی نمایش می‌دهد. تاریخ‌ها و زمان‌ها در پنل کاربری به صورت شمسی (جلالی) بر اساس ساختار `پنج‌شنبه ۲۵ تیر ۱۱:۴۵` با لایبرری jdatetime فرمت‌دهی می‌شوند. لاگ‌های کنسول به انگلیسی ثبت می‌شوند.
4. **تطابق با ISAPI:** تعامل با تجهیزات Hikvision کاملاً از طریق پروتکل ISAPI و ترجیحاً با دور زدن ساختار تکراری XML به کمک توابع پیشرفته رگکس و پارس اختصاصی است.
5. **ارسال هشدارها:** هشدارهای ایمیل و تلگرام برای هر کاربر مانیتور به حداکثر ۱ آدرس محدود شده تا مانع ارسال اسپم شود.
