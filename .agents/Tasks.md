# لیست یکپارچهٔ مشکلات و بهبودهای پروژه HikStatus

  

## 🔴 بحرانی (نیاز به حل فوری)

  

### امنیتی

  

- [x] **کوکی session_token** بدون `Secure` flag — `main.py:366`

- اضافه کردن `secure=True` به کوکی
- **توضیح**: آرگومان `secure=True` به متد `set_cookie` در تمام endpointهای لاگین و احراز هویت در فایل `main.py` اضافه شد تا کوکی تنها روی HTTPS منتقل شود.

- [x] **مسیر `/api/data/purge`** فقط نیاز به `require_auth` دارد — `main.py:506-511`

- تغییر به `require_admin`
- **توضیح**: پیش‌نیاز `Depends(require_auth)` به `Depends(require_admin)` در فایل `main.py` تغییر یافت.

- [x] **مسیر `/api/data/backup`** فقط نیاز به `require_auth` دارد — `main.py:514-525`

- تغییر به `require_admin`
- **توضیح**: پیش‌نیاز `Depends(require_auth)` به `Depends(require_admin)` در فایل `main.py` تغییر یافت.

- [x] **مسیر `/api/config/export`** رمزهای NVR را رمزگشایی می‌کند — `main.py:563-649`

- حذف خروجی رمزگشایی
- **توضیح**: روند رمزگشایی حذف شد و به جای آن در خروجی API فیلد password با رشته خالی جایگزین شد.

- [x] **کلید ثابت fallback** در `get_encryption_key` — `database.py:175`

- حذف کلید ثابت
- **توضیح**: کلید ثابت از فایل `database.py` پاک شد و در صورت شکست ساخت کلید ارور `RuntimeError` برگردانده می‌شود.

- [x] **XSS** در `createCard` — `app.js:280-301`

- استفاده از sanitization مناسب
- **توضیح**: تابع `escapeHTML` به فایل `app.js` اضافه شد و مقادیر داینامیک `c.name` و `c.channel_id` درون این تابع قرار گرفتند تا قبل از تزریق به کد HTML کاراکترهای خطرناک escape شوند.

  

## 🟠 بالا (باید در اسرع وقت حل شود)

  

### امنیتی / عملکردی

  

- [x] **قفل (lock) برای rate limiter** — `main.py:241-249`

- اضافه کردن `threading.Lock` یا `asyncio.Lock`
- **توضیح**: کلاس `threading.Lock` وارد شد و پروسه آپدیت دیکشنری `_login_attempts` در تابع `check_rate_limit` به وسیله متد `with _rate_limit_lock` ایمن گردید تا از بروز race condition جلوگیری شود.

  

### عملکردی

  

- [x] **محدودیت حجم فایل JSON** در import — `main.py:652-775`
- **توضیح**: محدودیت حجم فایل برای جلوگیری از DOS/OOM اضافه شد.

- [x] **محدودیت حجم فایل تصویر** در آپلود — `main.py:918-947`
- **توضیح**: محدودیت ۵ مگابایتی برای فایل‌های تصویری اضافه شد.

- [x] **مدیریت صحیح پروسه‌های orphan FFmpeg** — `main.py:1238`

- استفاده از `process.terminate()` و `process.wait()` برای تمام فرزندان
- **توضیح**: با اجرای `ffmpeg` از طریق یک `process group` جدید (`start_new_session=True`) و به کمک `os.killpg`، تمامی زیرپردازش‌ها به درستی متوقف می‌شوند.

- [x] **مقایسهٔ امن رمز عبور** — `main.py:221-235`

- استفاده از `hmac.compare_digest`
- **توضیح**: عملگر `==` با متد `secrets.compare_digest` جایگزین شد تا از حملات زمان‌سنجی (Timing Attack) جلوگیری شود.

- [ ] **استفاده از timezone‑aware datetime** برای `DowntimeEvent.start_time` — `database.py:76`

- [ ] **استفاده از timezone‑aware datetime** برای `UserSession.last_activity` — `database.py:114`

- [x] **رفع race condition در `trigger_task_now`** — `scheduler.py:138-147`
- **توضیح**: یک `asyncio.Lock` به سطح کلاس اضافه شد و قبل از بررسی و تغییر وضعیت تسک (مانند وضعیت `Running`) از بروز اختلال همزمانی جلوگیری می‌کند.

  

## 🟡 متوسط (بهبود تجربه کاربری و قابلیت‌های جدید)

  

### بهبودهای عملکردی

  

- [ ] **بهینه‌سازی query heatmap** با SQL aggregation — `main.py:1332`

- [ ] **بهینه‌سازی endpoint `/api/cameras/{id}/snapshot`** — `main.py:1021-1062`

- [ ] **بهینه‌سازی `sync_recording_stats_from_nvr`** — `monitor.py:502-651`

  

### کیفیت کد

  

- [ ] **حذف کد تکراری** بین `fetchDash` و `updateDashFromWS` — `app.js:1373-1574`

- [ ] **شکستن تابع `fetchDash`** به توابع کوچکتر — `app.js:63-266`

  

### قابلیت‌های مدیریتی

  

- [ ] **ماژولار کردن و تفکیک Endpointها** — تقسیم `main.py` به روت‌های جداگانه

  

### رابط کاربری

  

- [ ] **صفحه نمایش تمام‌صفحه (kiosk mode)** برای مانیتورهای بزرگ

- [ ] **نمایش گرافیکی تاریخچه قطعی** با نمودارهای مختلف

  

### زیرساخت فنی

  

- [ ] **پایش پیشرفته وضعیت NVR** (دستگاه‌های HDD، دما، وضعیت ضبط کانال‌ها)

- [ ] **سیستم برچسب (tag) برای دوربین‌ها** — دسته‌بندی بهتر

  

## ℹ️ پایین (آینده و بهبودها)

  

### گزارش‌گیری و مستندات

  

- [ ] **گزارش‌گیری پیشرفته و آمار پایداری (SLA) با خروجی PDF/Excel**

- [ ] **مستندات API با OpenAPI/Swagger** — فیلد `docs_url` در FastAPI

- [ ] **ثبت تاریخچه تغییرات کاربران** (audit log)

  

### تست و استقرار

  

- [ ] **تست‌های خودکار** (pytest) برای API و منطق

- [ ] **CI/CD pipeline** (GitHub Actions) برای تست و دیپلوی