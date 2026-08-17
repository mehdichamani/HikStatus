# 🚫 محدودیت‌ها و قوانین دست‌نزن (System Constraints & Frozen Rules)

> **🎯 هدف:** جلوگیری از تغییر کدهای فریز شده، حفظ پایداری سیستم، عدم بازگشایی تصمیمات قبلی اتخاذ‌شده و رعایت الگوهای استاندارد توسط ایجنت‌های هوشمند.  
> **تاریخ آخرین به‌روزرسانی:** ۱۴۰۵/۰۵/۲۴

---

## 🧊 ۱. کدهای فریز شده و خطوط قرمز (Frozen Components)

تغییر در این موارد تنها با دستور و تأیید صریح کاربر مجاز است:

1. **جداسازی سرویس زمان‌بند (`scheduler_runner.py`):**
   - فرآیند پایش، اجرای Scheduled Tasks و background taskها کاملاً مستقل از وب‌سرور FastAPI طراحی شده و نقطه ورود آن [`scheduler_runner.py`](file:///c:/Users/Mehdi/projects/HikStatus/scheduler_runner.py) است.
   - ⛔ **خط قرمز:** به هیچ عنوان منطق زمان‌بند یا مانیتورینگ نباید به صورت Background Thread/Task مجدداً درون فرآیند FastAPI ادغام شود.

2. **تنظیمات همزمانی پایگاه داده (SQLite WAL Mode):**
   - دیتابیس پروژه SQLite در مسیر `data/monitor.db` است.
   - جهت پشتیبانی از خواندن و نوشتن همزمان بین وب‌سرور و زمان‌بند، دستورات زیر در [`app/database.py`](file:///c:/Users/Mehdi/projects/HikStatus/app/database.py) فریز شده‌اند:
     ```python
     PRAGMA journal_mode=WAL;
     PRAGMA synchronous=NORMAL;
     ```
   - ⛔ **خط قرمز:** حالت `journal_mode` نباید به DELETE یا TRUNCATE تغییر یابد.

3. **ساختار فرانت‌اند (Vanilla JS & Modern CSS):**
   - بخش UI سیستم بدون هیچ فریم‌ورک سنگین (مانند React, Vue, Angular) یا ابزارهای Build (مانند Vite, Webpack) پیاده‌سازی شده است.
   - ⛔ **خط قرمز:** افزودن پکیج‌های npm یا کتابخانه‌های سنگین و کامپایلری JS/CSS (مانند Tailwind) ممنوع است. تمام متغیرها بر پایه [`.agents/DESIGN.md`](file:///c:/Users/Mehdi/projects/HikStatus/.agents/DESIGN.md) تنظیم می‌شوند.

4. **طرح‌های پیشنهادی اجرا‌نشده (`.agents/proposals/`):**
   - اسناد و کدهای موجود در پوشه `proposals/` صرفاً طرح‌های پیشنهادی در انتظار تصمیم کاربران هستند.
   - ⛔ **خط قرمز:** ایجنت‌ها نباید بدون درخواست صریح کاربر، این پیشنهادات را پیاده‌سازی کرده یا وارد کد اصلی کنند.

---

## 🔒 ۲. تصمیمات معمارانه نهایی (Established Decisions — Do Not Re-open)

این تصمیمات قبلاً بررسی، تست و اتخاذ شده‌اند و نباید مجدداً به بحث گذاشته یا تغییر یابند:

1. **استراتژی تک‌کامیت به ازای هر پلن (Single Commit Policy):**
   - هر Implementation Plan یا Feature باید در قالب **یک کامیت واحد** ثبت شود (`git add -A`).
   - تغییرات اسناد `.md` نباید به صورت کامیت‌های جداگانه ثبت گردند (از `git commit --amend` یا ادغام در کامیت اصلی کد استفاده می‌شود).

2. **مرجع واحد سیستم طراحی (Design System Source of Truth):**
   - تنها مرجع معتبر تم، رنگ‌بندی و پالت‌های HSL، مستند [`.agents/DESIGN.md`](file:///c:/Users/Mehdi/projects/HikStatus/.agents/DESIGN.md) است.
   - تمام کلاس‌ها و متغیرهای UI باید از CSS Custom Properties سیستم پیروی کنند.

3. **کنترل نرخ و تجمیع هشدارها (Notification Rate Limiting / Batching):**
   - ارسال اعلان‌های تلگرام و ایمیل نباید برای هر قطعی به صورت بی‌رویه انجام شود؛ سیستم دارای مکانیزم کنترل نرخ (Throttling/Batching) است.

---

## 📐 ۳. الگوها و الزامات اجرایی (Mandatory Execution Rules)

1. **زبان و فرمت مستندسازی:**
   - تمامی کامیت‌ها، نظرات درون کد، لاگ‌های سیستم و مستندات باید به **زبان فارسی روان** باشند.
   - تمامی تاریخ‌ها باید به صورت **شمسی (`YYYY/MM/DD`)** ثبت شوند.

2. **به‌روزرسانی هم‌زمان وضعیت پروژه (`.agents/PROJECT_STATE.md`):**
   - در صورت مشاهده باگ جدید، هشدارهای منسوخ‌شدگی، بدهی فنی یا اتخاذ تصمیم معمارانه جدید توسط کاربر، ایجنت موظف است بلافاصله [`.agents/PROJECT_STATE.md`](file:///c:/Users/Mehdi/projects/HikStatus/.agents/PROJECT_STATE.md) را به‌روزرسانی کند.
