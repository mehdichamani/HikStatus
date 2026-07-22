# مشکلات و باگ‌های پروژه HikStatus

  

## 🔴 بحرانی (نیاز به حل فوری)

  

### امنیتی

  

- **[SEC-1] کوکی session_token بدون `Secure` flag** — `main.py:366`

  - کوکی بدون `secure=True` تنظیم شده و در HTTP غیررمزگذاری شده ارسال می‌شود

  - ریسک:劫持 کوکی از طریق شبکه‌های ناامن

  

- **[BUG-4] مسیر `/api/data/purge` فقط نیاز به `require_auth` دارد** — `main.py:506-511`

  - هر کاربر احراز هویت شده (حتی `group_view`) می‌تواند کل دیتابیس را پاک کند

  - باید `require_admin` باشد

  

- **[BUG-5] مسیر `/api/data/backup` فقط نیاز به `require_auth` دارد** — `main.py:514-525`

  - هر کاربر احراز هویت شده می‌تواند پشتیبان دیتابیس (شامل رمزهای عبور) را دانلود کند

  - باید `require_admin` باشد

  

---

  

## 🟠 بالا (باید در اسرع وقت حل شود)

  

### امنیتی

  

- **[BUG-6] مسیر `/api/config/export` رمزهای عبور NVR را رمزگشایی و خروجی می‌دهد** — `main.py:563-649`

  - رمز عبور NVR به صورت plain text در JSON export قرار می‌گیرد

  - `password_hash` کاربران نیز خروجی داده می‌شود

  

- **[DB-5] `get_encryption_key` key ثابت fallback** — `database.py:175`

  - اگر کتابخانه `cryptography` نصب نباشد، یک key ثابت و شناخته‌شده استفاده می‌شود

  - بسیار خطرناک در محیط production

  

- **[FE-8] XSS آسیب‌پذیری در `createCard`** — `app.js:280-301`

  - نام دوربین با `encodeURIComponent(JSON.stringify(c))` در onclick قرار می‌گیرد

  - اگر نام شامل `'` یا `"` باشد، ممکن است XSS ایجاد شود

  

### عملکردی

  

- **[BUG-3] Race condition در rate limiter** — `main.py:241-249`

  - دیکشنری `_login_attempts` بدون lock مدیریت می‌شود

  - در محیط async ممکن است چندین درخواست همزمان از rate limit رد شوند

  

---

  

## 🟡 متوسط

  

### باگ

  

- **[BUG-7] مسیر `/api/config/import` بدون محدودیت حجم فایل JSON** — `main.py:652-775`

  - هیچ محدودیتی در حجم فایل JSON وارد شده وجود ندارد

  - می‌تواند باعث مصرف حافظه بیش از حد شود

  

- **[BUG-8] مسیر `/api/groups/{id}/plans` آپلود فایل بدون محدودیت حجم** — `main.py:918-947`

  - فایل‌های تصویری بدون بررسی حجم آپلود می‌شوند

  

- **[BUG-9] پروسه FFmpeg orphan** — `main.py:1238`

  - اگر `GeneratorExit` رخ ندهد (مثلاً crash سرور)، پروسه FFmpeg orphan می‌شود

  - `process.kill()` فقط پروسه اصلی را متوقف می‌کند نه child processها را

  

- **[BUG-10] مقایسه رمز عبور plain text با `==`** — `main.py:221-235`

  - حساس به timing attack

  - بهتر است از `hmac.compare_digest` استفاده شود

  

- **[DB-2] `DowntimeEvent.start_time` بدون timezone** — `database.py:76`

  - `datetime.now` بدون timezone - مشکل compatibility با timezone-aware datetime

  

- **[DB-3] `UserSession.last_activity` بدون timezone** — `database.py:114`

  - مشکل مشابه با DB-2

  

- **[SCHED-3] Race condition در `trigger_task_now`** — `scheduler.py:138-147`

  - بین چک کردن status و ایجاد تسک، ممکن است تسک دیگری اجرا شود

  

### عملکردی

  

- **[PERF-1] تابع `get_heatmap_stats` حلقه Python دارد** — `main.py:1332`

  - برای بازه‌های زمانی بزرگ (مثلاً 30 روز = 720 iterations) بسیار کند است

  - بهتر است از SQL aggregation استفاده شود

  

- **[PERF-2] مسیر `/api/cameras/{id}/snapshot` درخواست sync** — `main.py:1021-1062`

  - `requests.get` با timeout 5 ثانیه بدون connection pooling

  

- **[PERF-3] `sync_recording_stats_from_nvr` درخواست‌های HTTP زیاد** — `monitor.py:502-651`

  - برای هر دوربین حداقل 2 درخواست HTTP بدون connection pooling

  

### کیفیت کد

  

- **[FE-1] کد تکراری بین `updateDashFromWS` و `fetchDash`** — `app.js:1373-1574`

  - بیش از 200 خط کد تکراری

  

- **[FE-7] تابع `fetchDash` بسیار طولانی** — `app.js:63-266`

  - بیش از 200 خط - خوانایی سخت

  

---

  

## ℹ️ غیر مهم (نیاز به حل ندارند)

  

### معماری و ساختار

- **Global Mutable State** — متغیرهایی مانند `_login_attempts` و `_config_cache` برای اپلیکیشن تک‌پروسه‌ای فعلی مشکلی ایجاد نمی‌کنند.

  

### کیفیت کد

- **Broad Exception Handling** — ۲ مورد `except:` و ۳۰ مورد `except Exception` در سناریوهای مناسبی استفاده شده‌اند.

  

### عملکرد و زیرساخت

- **جایگزینی requests با httpx** — در حال حاضر توصیه نمی‌شود. الگوی فعلی `asyncio.to_thread()` برای حجم فعلی مناسب است.

  

### فرانت‌اند

- **وابستگی به Google Fonts** — `style.css:1` از `@import url(...)` استفاده می‌کند. در صورت قطعی اینترنت فونت بارگذاری نمی‌شود.

- **AudioContext جدید در هر بار** — `app.js:1676-1736` برای هر صدا AudioContext جدید ایجاد می‌کند.

- **Notification spam** — `app.js:1790-1815` اگر چندین دوربین همزمان قطع شوند notification های زیادی ایجاد می‌شود.

  

### داکر

- **شبکه `vpn` external** — `docker-compose.yml:19-21` اگر شبکه `vpn` وجود نداشته باشد container شروع نمی‌شود.

- **پورت بدون binding** — `docker-compose.yml:8` پورت 28888 در همه interface ها باز است.