# لیست یکپارچهٔ مشکلات و بهبودهای پروژه HikStatus

  

## 🔴 بحرانی (نیاز به حل فوری)

  

### امنیتی

  

- [ ] **کوکی session_token** بدون `Secure` flag — `main.py:366`

- اضافه کردن `secure=True` به کوکی

- [ ] **مسیر `/api/data/purge`** فقط نیاز به `require_auth` دارد — `main.py:506-511`

- تغییر به `require_admin`

- [ ] **مسیر `/api/data/backup`** فقط نیاز به `require_auth` دارد — `main.py:514-525`

- تغییر به `require_admin`

- [ ] **مسیر `/api/config/export`** رمزهای NVR را رمزگشایی می‌کند — `main.py:563-649`

- حذف خروجی رمزگشایی

- [ ] **کلید ثابت fallback** در `get_encryption_key` — `database.py:175`

- حذف کلید ثابت

- [ ] **XSS** در `createCard` — `app.js:280-301`

- استفاده از sanitization مناسب

  

## 🟠 بالا (باید در اسرع وقت حل شود)

  

### امنیتی / عملکردی

  

- [ ] **قفل (lock) برای rate limiter** — `main.py:241-249`

- اضافه کردن `threading.Lock` یا `asyncio.Lock`

  

### عملکردی

  

- [ ] **محدودیت حجم فایل JSON** در import — `main.py:652-775`

- [ ] **محدودیت حجم فایل تصویر** در آپلود — `main.py:918-947`

- [ ] **مدیریت صحیح پروسه‌های orphan FFmpeg** — `main.py:1238`

- استفاده از `process.terminate()` و `process.wait()` برای تمام فرزندان

- [ ] **مقایسهٔ امن رمز عبور** — `main.py:221-235`

- استفاده از `hmac.compare_digest`

- [ ] **استفاده از timezone‑aware datetime** برای `DowntimeEvent.start_time` — `database.py:76`

- [ ] **استفاده از timezone‑aware datetime** برای `UserSession.last_activity` — `database.py:114`

- [ ] **رفع race condition در `trigger_task_now`** — `scheduler.py:138-147`

  

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