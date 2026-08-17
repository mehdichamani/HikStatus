# 📑 لاگ تصمیمات معماری (Architecture Decision Records - ADR)

> **🎯 هدف:** ثبت شفاف تصمیمات معمارانه، دلایل اتخاذ آن‌ها، وضعیت جاری و پیامدهای فنی در پروژه **HikStatus** جهت جلوگیری از بازگشایی مجدد مباحث تثبیت‌شده.  
> **تاریخ آخرین به‌روزرسانی:** ۱۴۰۵/۰۵/۲۴

---

## 📋 فهرست ADRها

1. [ADR-001: جداسازی سرویس زمان‌بند و پایش به پروسه مستقل](#adr-001)
2. [ADR-002: استفاده از SQLite در حالت WAL Mode](#adr-002)
3. [ADR-003: تثبیت مرجعیت واحد سیستم طراحی (Design System)](#adr-003)
4. [ADR-004: ارتقای استراتژی هش کلمه عبور به PBKDF2 با Salt داینامیک](#adr-004)
5. [ADR-005: استراتژی تک‌کامیت به ازای هر Implementation Plan](#adr-005)
6. [ADR-006: عدم استفاده از فریم‌ورک‌های سنگین و ابزارهای Build در فرانت‌اند](#adr-006)

---

<a id="adr-001"></a>
### 🔷 ADR-001: جداسازی سرویس زمان‌بند و پایش به پروسه مستقل

* **تاریخ:** ۱۴۰۵/۰۵/۲۰  
* **وضعیت:** `تأییدشده و اجراشده (Approved & Implemented)`  
* **مکان کد:** [`scheduler_runner.py`](file:///c:/Users/Mehdi/projects/HikStatus/scheduler_runner.py)

#### 📝 سیاق و مسئله (Context)
اجرای حلقه مانیتورینگ دوربین‌ها، پینگ سخت‌افزاری و دریافت تصاویر Snapshot در داخل Threadهای FastAPI باعث مصرف بالای CPU و Blocking در وب‌سرور می‌شد و در زمان قطعی‌های گسترده، پنل وب کند یا غیرقابل دسترس می‌گردید.

#### 🎯 تصمیم (Decision)
کارهای زمان‌بندی‌شده (Scheduled Tasks) و حلقه اصلی مانیتورینگ کاملاً از فرآیند FastAPI جدا شده و در نقطه ورود مستقل [`scheduler_runner.py`](file:///c:/Users/Mehdi/projects/HikStatus/scheduler_runner.py) اجرا می‌شوند.

#### ⚡ پیامدها (Consequences)
* ✅ وب‌سرور FastAPI فارغ از بار پایش شبکه همیشه سریع و پاسخ‌گو است.
* ✅ در صورت کرش کردن وب‌سرور، سرویس مانیتورینگ به کار خود ادامه می‌دهد و بالعکس.
* ⚠️ نیاز به مکانیزم همزمانی دیتابیس (آدرس‌دهی شده در ADR-002).

---

<a id="adr-002"></a>
### 🔷 ADR-002: استفاده از SQLite در حالت WAL Mode

* **تاریخ:** ۱۴۰۵/۰۵/۲۱  
* **وضعیت:** `تأییدشده و اجراشده (Approved & Implemented)`  
* **مکان کد:** [`app/database.py`](file:///c:/Users/Mehdi/projects/HikStatus/app/database.py)

#### 📝 سیاق و مسئله (Context)
با جداسازی پروسه زمان‌بند از وب‌سرور، خطای `sqlite3.OperationalError: database is locked` به دلیل نوشتن هم‌زمان دو پروسه رخ می‌داد.

#### 🎯 تصمیم (Decision)
فعال‌سازی حالت Write-Ahead Logging (WAL) و `synchronous=NORMAL` روی SQLite از طریق Event Listenerهای SQLAlchemy:
```python
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
```

#### ⚡ پیامدها (Consequences)
* ✅ پشتیبانی کامل از خواندن و نوشتن همزمان بدون قفل شدن دیتابیس.
* ✅ افزایش قابل توجه سرعت نوشتن لاگ‌ها و رویدادهای قطعی.
* ⛔ حالت WAL در `app/database.py` فریز شده و نباید تغییر کند.

---

<a id="adr-003"></a>
### 🔷 ADR-003: تثبیت مرجعیت واحد سیستم طراحی (Design System)

* **تاریخ:** ۱۴۰۵/۰۵/۲۲  
* **وضعیت:** `تأییدشده و اجراشده (Approved & Implemented)`  
* **مکان کد:** [`.agents/DESIGN.md`](file:///c:/Users/Mehdi/projects/HikStatus/.agents/DESIGN.md)

#### 📝 سیاق و مسئله (Context)
وجود چندین مستند طراحی یا پیشنهادات متناقض (مانند `proposals/UX-UI-Redesign.md`) باعث سردرگمی ایجنت‌ها در انتخاب پالت‌های رنگی و متغیرهای UI می‌شد.

#### 🎯 تصمیم (Decision)
تنها مرجع رسمی، معتبر و قابل استناد سیستم طراحی، سند [`.agents/DESIGN.md`](file:///c:/Users/Mehdi/projects/HikStatus/.agents/DESIGN.md) تعیین شد. سند `UX-UI-Redesign.md` صرفاً یک Proposal اجرا‌نشده است.

#### ⚡ پیامدها (Consequences)
* ✅ یکپارچگی کامل تم‌های هشت‌گانه (۴ استایل در ۲ حالت Dark/Light).
* ⛔ عدم ایجاد تغییرات ad-hoc خارج از سیستم متغیرهای CSS تعریف‌شده در DESIGN.md.

---

<a id="adr-004"></a>
### 🔷 ADR-004: ارتقای استراتژی هش کلمه عبور به PBKDF2 با Salt داینامیک

* **تاریخ:** ۱۴۰۵/۰۵/۲۲  
* **وضعیت:** `تأییدشده و اجراشده (Approved & Implemented)`  
* **مکان کد:** [`app/database.py`](file:///c:/Users/Mehdi/projects/HikStatus/app/database.py#L197-L218)

#### 📝 سیاق و مسئله (Context)
استفاده اولیه از SHA-256 ساده برای ذخیره پسوورد کاربران در برابر حملات Rainbow Table ایمن نبود.

#### 🎯 تصمیم (Decision)
الگوریتم `pbkdf2_hmac` با `sha256` و ۱۰۰,۰۰۰ تکرار همراه با ۱۶ بایت Salt داینامیک جایگزین شد. همچنین مکانیزم Fallback جهت ورود کاربران با هش قدیمی SHA-256 حفظ گردید.

#### ⚡ پیامدها (Consequences)
* ✅ ارتقای امنیت رمزهای عبور به استاندارد سازمان.
* ✅ عدم قطعی یا نیاز به ریست کلمه عبور کاربران موجود.

---

<a id="adr-005"></a>
### 🔷 ADR-005: استراتژی تک‌کامیت به ازای هر Implementation Plan

* **تاریخ:** ۱۴۰۵/۰۵/۲۳  
* **وضعیت:** `تأییدشده و اجراشده (Approved & Implemented)`  
* **مکان کد:** [`.agents/AGENTS.md`](file:///c:/Users/Mehdi/projects/HikStatus/.agents/AGENTS.md)

#### 📝 سیاق و مسئله (Context)
تعدد کامیت‌های ریز و متوالی گیت تاریخچه پروژه را شلوغ می‌کرد و تغییرات اسناد `.md` تاریخچه ریلیزها را مختل می‌ساخت.

#### 🎯 تصمیم (Decision)
تمامی تغییرات مربوط به یک Implementation Plan یا ویژگی پس از اعتبارسنجی در قالب **یک کامیت واحد** شامل تمام فایل‌های کد و مستندات ثبت می‌شود (`git add -A`). تغییرات صرفاً مستنداتی باید با `git commit --amend` ادغام شوند.

#### ⚡ پیامدها (Consequences)
* ✅ تاریخچه Git کاملاً شفاف، تمیز و قابل ردیابی است.
* ✅ عدم ثبت نسخه‌های غیرواقعی در CHANGELOG.

---

<a id="adr-006"></a>
### 🔷 ADR-006: عدم استفاده از فریم‌ورک‌های سنگین و ابزارهای Build در فرانت‌اند

* **تاریخ:** ۱۴۰۵/۰۵/۲۳  
* **وضعیت:** `تأییدشده و اجراشده (Approved & Implemented)`  
* **مکان کد:** [`static/js/`](file:///c:/Users/Mehdi/projects/HikStatus/static/js/)

#### 📝 سیاق و مسئله (Context)
نیاز به اجرای روان سامانه روی سرورهای عملیاتی محلی بدون پیچیدگی‌های کامپایل Node.js/npm.

#### 🎯 تصمیم (Decision)
رابط کاربری کماکان به صورت Vanilla JavaScript و Vanilla CSS توسعه داده می‌شود. استفاده از TailwindCSS, React, Vue, Vite یا Webpack ممنوع است.

#### ⚡ پیامدها (Consequences)
* ✅ بارگذاری بسیار سریع صفحات و عدم نیاز به خط لوله کامپایل پیچیده فرانت‌اند.
* ✅ سادگی نگه‌داری و اشکال‌زدایی مستقیم در مرورگر.
