# 📊 وضعیت لحظه‌ای پروژه (Project State)

---

## 📌 ۱. اطلاعات کلی و نگارش
* **نسخه جاری سیستم:** `0.9.0` (در حال آماده‌سازی برای نسخه پایدار `1.0.0`)
* **تاریخ آخرین به‌روزرسانی:** ۱۴۰۵/۰۵/۲۷
* **وضعیت سرور وب:** FastAPI / Python 3.12+ (اجرا روی پورتهای استاندارد یا داینامیک)
* **وضعیت زمان‌بند (Scheduler):** تفکیک‌شده و مستقل ([`scheduler_runner.py`](file:///home/unreal/projects/HikStatus/scheduler_runner.py))
* **پایگاه داده:** SQLite WAL در مسیر `data/monitor.db` (با مدیریت همزمانی بالا)

---

## 🧪 ۲. وضعیت آزمون‌ها و کیفیت کد
* **تست‌های خودکار (Pytest):** ۳۸ از ۳۸ تست موفق (`38 passed`) در ماژول‌های:
  - `test_endpoints.py` (۲۵ تست مسیرهای API و دسترسی‌ها)
  - `test_new_scenarios.py` (۲ تست سناریوهای پایش)
  - `test_nvr_health.py` (۱ تست سلامت سخت‌افزاری)
  - `test_outage.py` (۲ تست تحلیل قطعی‌ها)
  - `test_scheduler_arch.py` (۲ تست معماری زمان‌بند مستقل)
  - `test_telegram_rich_alerts.py` (۶ تست سیستم هشدار غنی تلگرام)
* **لینتر و فرمتر:** ابزار Ruff فعال و تنظیم‌شده در [`pyproject.toml`](file:///home/unreal/projects/HikStatus/pyproject.toml)

---

## ⏳ ۳. طرح‌های پیشنهادی در انتظار تصمیم (Pending Proposals)
> ⚠️ **نکته برای ایجنت‌ها:** این موارد در پوشه [`.agents/proposals/`](file:///home/unreal/projects/HikStatus/.agents/proposals/) قرار دارند و تا زمان تأیید صریح کاربر، نباید پیاده‌سازی شوند.

1. **طرح بازطراحی رابط کاربری ([`proposals/UX-UI-Redesign.md`](file:///home/unreal/projects/HikStatus/.agents/proposals/UX-UI-Redesign.md)):**
   - وضعیت: `pending`
   - خلاصه: مدرن‌سازی داشبورد با گلس‌مورفیسم، انیمیشن‌های CSS و کارت‌های وضعیت.
2. **بهبود فرآیند تعریف NVR ([`proposals/بهبود فرآیند تعریف NVR.md`](file:///home/unreal/projects/HikStatus/.agents/proposals/بهبود فرآیند تعریف NVR.md)):**
   - وضعیت: `pending`
   - خلاصه: افزودن قابلیت Wizard مرحله‌به‌مرحله و تست اتصال خودکار قبل از ذخیره NVR.
3. **تجمیع اعلان‌های مرورگر ([`proposals/تجمیع اعلان‌های مرورگر و خوانش فارسی.md`](file:///home/unreal/projects/HikStatus/.agents/proposals/تجمیع اعلان‌های مرورگر و خوانش فارسی.md)):**
   - وضعیت: `pending`
   - خلاصه: موتور Web Audio اختصاصی با TTS فارسی و صف اعلان‌ها برای هشدار صوتی قطعی دوربین‌ها.

---

## 📚 ۴. ساختار مستندات پایدار سیستم
تمامی مستندات کلیدی و استاندارد پروژه ایجاد و اعتبارسنجی شده‌اند:
* **اسناد راهنما و محدودیت‌های ایجنت‌ها (`.agents/`):**
  - [`.agents/PROJECT_STATE.md`](file:///home/unreal/projects/HikStatus/.agents/PROJECT_STATE.md) — وضعیت لحظه‌ای سیستم و تست‌ها
  - [`.agents/CONSTRAINTS.md`](file:///home/unreal/projects/HikStatus/.agents/CONSTRAINTS.md) — محدودیت‌ها و کدهای فریز شده
  - [`.agents/CODE_PATTERNS.md`](file:///home/unreal/projects/HikStatus/.agents/CODE_PATTERNS.md) — الگوهای استاندارد کدنویسی
  - [`.agents/DECISIONS.md`](file:///home/unreal/projects/HikStatus/.agents/DECISIONS.md) — لاگ تصمیمات معماری (ADR)
  - [`.agents/DESIGN.md`](file:///home/unreal/projects/HikStatus/.agents/DESIGN.md) — سیستم جامع طراحی و رابط کاربری
* **مستندات فنی معماری و سیستم (`docs/`):**
  - [`docs/DATA_MODELS.md`](file:///home/unreal/projects/HikStatus/docs/DATA_MODELS.md) — مدل‌های داده، جداول و اینام‌ها
  - [`docs/CODEBASE_MAP.md`](file:///home/unreal/projects/HikStatus/docs/CODEBASE_MAP.md) — نقشه ساختار کدبیس و ماژول‌ها
  - [`docs/MONITOR_LOGIC.md`](file:///home/unreal/projects/HikStatus/docs/MONITOR_LOGIC.md) — منطق و چرخه حلقه مانیتورینگ
  - [`docs/SETTINGS_REFERENCE.md`](file:///home/unreal/projects/HikStatus/docs/SETTINGS_REFERENCE.md) — مرجع جامع تنظیمات سیستم
  - [`docs/RBAC_MATRIX.md`](file:///home/unreal/projects/HikStatus/docs/RBAC_MATRIX.md) — ماتریس دسترسی ۴ نقش کاربری
  - [`docs/TEST_GUIDE.md`](file:///home/unreal/projects/HikStatus/docs/TEST_GUIDE.md) — راهنمای جامع آزمون‌ها و کیفیت‌سنجی

---

## ⚠️ ۵. بدهی‌های فنی و هشدارهای شناخته‌شده (Known Issues & Tech Debt)
* **هشدارهای Deprecation پایتون:**
  - استفاده از `asyncio.iscoroutinefunction` در [`app/rate_limiter.py`](file:///home/unreal/projects/HikStatus/app/rate_limiter.py) که در پایتون ۳.۱۶ منسوخ خواهد شد (باید با `inspect.iscoroutinefunction` جایگزین شود).
* **حجم متمرکز فایل اصلی:**
  - فایل [`app/main.py`](file:///home/unreal/projects/HikStatus/app/main.py) حجمی حدود ۱۰۴ کیلوبایت و ۳۰۰۰ سطر دارد و به مرور باید به روترهای تفکیک‌شده (APIRouter) شکسته شود.

---

## 💡 ۶. تصمیمات کلیدی اتخاذ‌شده (Key Established Decisions)
1. **جداسازی سرویس زمان‌بندی:** پروسه پایش و کارهای پس‌زمینه از فرآیند وب جدا شده و نقطه ورود اختصاصی [`scheduler_runner.py`](file:///home/unreal/projects/HikStatus/scheduler_runner.py) دارد.
2. **سیستم رنگ و تم یکپارچه:** تنها مرجع معتبر تم و ظاهر، مستند [`.agents/DESIGN.md`](file:///home/unreal/projects/HikStatus/.agents/DESIGN.md) است.
3. **عدم وابستگی سنگین در فرانت‌اند:** استفاده از Vanilla JS بدون استفاده از کامپایلر یا فریم‌ورک‌های React/Vue.
4. **تجمیع کامل اعلان‌های تلگرام با Rich Messages:** تمام هشدارهای تلگرام به صورت ۱۰۰٪ غنی (تگ‌های آکاردئونی `<blockquote expandable>`، متون مونو `<code>` و خلاصه آماری) در انتهای هر دور پایش در قالب یک پیام چرخه‌ای جامع برای مدیران ارشد و پیام‌های فیلترشده برای مدیران IT مخابره می‌شوند و روش سنتی بولت‌های ساده به طور کامل حذف گردید.
5. **متمرکزسازی مدیریت سیستم‌عامل ویندوز در `start.ps1`:** فایل‌های واسطه‌ای `start.cmd` و `stop.cmd` حذف گردیدند و اسکریپت قدرتمند و تعاملی `start.ps1` به عنوان تک‌مرجع و نقطه ورود مدیریت بومی (TUI و CLI) در ویندوز تثبیت شد.
6. **مرجعیت واحد چنج‌لاگ در `docs/CHANGELOG.md`:** دو فایل چنج‌لاگ قبلی یکپارچه شدند و کلیه مستندات تغییرات و گردش کار ایجنت‌ها به یک سند استاندارد در [`docs/CHANGELOG.md`](file:///home/unreal/projects/HikStatus/docs/CHANGELOG.md) متصل گردید.
7. **اعتبارسنجی منعطف و ایمن ضد CSRF با پشتیبانی از Reverse Proxy:** بررسی هدرهای `Origin` و `Referer` بر پایه هاست استخراج‌شده و هدرهای `X-Forwarded-Host`/`Host` صورت می‌گیرد تا پروژه بدون خطای CSRF در سرویس‌های کلود (مانند Railway و Render) و پشت پروکسی‌های معکوس با حفظ امنیت کامل کار کند.


