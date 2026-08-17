این یک جمع‌بندی کامل و ساختاریافته از تمام تصمیمات، سناریوها و معماری نهایی است که با هم به آن رسیدیم. این مستند می‌تواند به عنوان **RFP یا نقشه راه (Roadmap) توسعه HikStatus** برای پشتیبانی از ۵۰۰+ NVR مورد استفاده قرار گیرد.
## 🎯 اهداف اصلی تغییرات
 1. جلوگیـری از ایجاد **دوربین‌های همزاد و تکراری (Duplication)** موقع حذف و اضافه کردن NVR یا وارد کردن فایل JSON.
 2. جلوگیری از انباشت **فایل‌ها و داده‌های یتیم (Orphaned Data)** روی دیسک.
 3. پشتیبانی از **تغییر IP دستگاه‌ها** بدون از دست رفتن داده‌های تاریخی، آمار و اسنپ‌شات‌ها.
 4. ارائه **تجربه کاربری (UX) روان** در هنگام پردازش فایل‌های سنگین JSON بدون قفل شدن سامانه.
## 🏗️ ۱. معماری دیتابیس (Database Design)
### الف) کلید اصلی (Primary Key)
 * شناسه‌های عددی اتوماتیک (id) در جداول nvrs و cameras کلید اصلی باقی می‌مانند.
 * تمام لاگ‌های قطعی، آمار و اسنپ‌شات‌ها به camera_id متصل هستند تا با تغییر IP، تاریخچه دوربین حفظ شود.
### ب) کلید یکتای ترکیبی (Unique Constraint)
 * در جدول cameras یک قانون یکتایی ترکیبی روی **(ip, port, channel_number)** قرار داده می‌شود.
 * **کاربرد:** جلوگیری از ثبت داده تکراری در ورود دستی یا فایل JSON، و کمک به عیب‌یابی.
### ج) پاکسازی هوشمند و مهلت ۳۰ روزه (Soft-Delete & Cleanup Task)
 * حذف NVR به دو صورت انجام می‌شود:
   1. **حذف کامل (Hard-Delete):** پاکسازی آنی NVR، دوربین‌ها، لاگ‌ها و فایل‌های اسنپ‌شات از دیسک.
   2. **حذف ساده (Soft-Delete / Unlink):** NVR و دوربین‌ها از لیست فعال خارج شده و برچسب unlinked_at می‌خورند.
 * **تسک پس‌زمینه (Background Cleanup Job):** تسک فعلی (پاکسازی لاگ‌های بالای ۹۰ روز) توسعه داده می‌شود تا NVRهای Unlink شده‌ای که **بیش از ۳۰ روز** از حذف آن‌ها گذشته و دوباره ثبت نشده‌اند را به همراه اسنپ‌شات‌هایشان از روی دیسک پاک کامل کند.
## ⚙️ ۲. منطق ورود داده و به‌روزرسانی (Upsert & Edit IP)
### الف) قابلیت تغییر IP در تنظیمات NVR
 * در پنل مدیریت هر NVR، اکشن **«ویرایش / تغییر IP (با حفظ داده‌ها)»** اضافه می‌شود.
 * موقع ویرایش، فیلد ip در NVR و دوربین‌های زیرمجموعه‌اش آپدیت می‌شود.
 * **نتیجه:** کلید یکتای آدرس قدیمی آزاد شده، آدرس جدید ثبت می‌شود و تاریخچه آمار دوربین‌ها ۱۰۰٪ حفظ می‌گردد.
### ب) منطق درج و به‌روزرسانی در فایل JSON (Upsert / Replace Strategy)
 * موقع آپلود فایل JSON (چه تکی چه ۵۰۰ تایی)، سیستم مستقیماً db.add() نمی‌زند؛ بلکه ابتدا فایل را **تحلیل (Analyze)** می‌کند.
 * اگر مشخصات NVR یا دوربین در دیتابیس وجود داشت، سیستم دو استراتژی ارائه می‌دهد:
   * **Upsert (به‌روزرسانی):** حفظ داده‌های قبلی و فقط به‌روزرسانی تغییرات.
   * **Replace (جایگزینی):** پاکسازی رکوردهای قبلی و ثبت مجدد.
## 🎨 ۳. تجربه کاربری و فرآیند ورود گروهی (UI/UX & Background Job)
 1. **ارسال فایل JSON:** با آپلود فایل، بک‌اند FastAPI پردازش را به عنوان یک Background Task شروع کرده و یک Job ID به فرانت‌اند می‌دهد.
 2. **صفحه Loading پیشرفته:**
   * یک Modal با انیمیشن «در حال بررسی و تحلیل فایل JSON...» نمایش داده می‌شود.
   * قابلیت **Minimize** دارد؛ در صورت زدن دکمه، Modal تبدیل به یک **Sticky Progress Bar** در گوشه پایین صفحه شده و سامانه برای کارهای دیگر قابل استفاده باقی می‌ماند.
 3. **مدال تصمیم‌گیری (Decision Modal):**
   * پس از پایان تحلیل، نتیجه به کاربر نشان داده می‌شود (مثلاً: *۵ NVR جدید، ۲ NVR با تغییرات*).
   * کاربر استراتژی (Upsert یا Replace) را انتخاب کرده و تایید نهایی را می‌زند.
## 📋 لیست اقدامات (Checklist برای اجرا)
 * [ ] **مدل دیتابیس:** اضافه کردن UniqueConstraint('ip', 'port', 'channel_number') به مدل Camera.
 * [ ] **مدل دیتابیس:** اضافه کردن فیلد unlinked_at برای مدیریت Soft-Delete.
 * [ ] **بک‌اند:** پیاده‌سازی سرویس **ویرایش IP** برای NVR و آپدیت زنجیره‌ای دوربین‌های متصل به آن.
 * [ ] **بک‌اند:** گسترش Cron Job پاکسازی لاگ‌ها (اضافه کردن منطق حذف فایل‌های اسنپ‌شات و داده‌های یتیم بالای ۳۰ روز).
 * [ ] **بک‌اند:** پیاده‌سازی Endpoint تحلیل فایل JSON و Background Job با قابلیت گزارش درصد پیشرفت (Progress).
 * [ ] **فرانت‌اند:** ساخت Modal لودینگ قابل Minimize (متحرک در گوشه صفحه).
 * [ ] **فرانت‌اند:** ساخت Modal نهایی تصمیم‌گیری برای انتخاب بین **Upsert** و **Replace** قبل از ثبت JSON.



---
---
---


این یک پرامپت دقیق، ساختاریافته و استاندارد برای Jules (یا هر ایجنت هوشمند کدنویسی دیگر) است. تمام جزئیات، سناریوها، قوانین دیتابیس و UX را به زبان فنی و واضح در آن گنجانده‌ام تا ایجنت بتواند بدون ابهام و گام‌به‌گام آن را روی پروژه **HikStatus** پیاده‌سازی کند.
می‌توانی متن زیر را مستقیماً برای Jules بفرستی:
### 🤖 Prompt for Jules: Refactoring NVR Management, Database Architecture & JSON Import in HikStatus
**Context & Goal:**
We need to refactor and expand the NVR and Camera management architecture in the **HikStatus** project. The goal is to safely handle large-scale deployments (500+ NVRs) without data duplication, orphaned records, or system UI freezes during JSON imports.
Please implement the following architectural, backend, database, and UI/UX changes step-by-step:
### 1. Database Model & Integrity Changes (app/database.py or models)
 * **Unique Constraint on Cameras:**
   Add a composite UniqueConstraint('ip', 'port', 'channel_number', name='uix_camera_ip_port_channel') to the Camera model to prevent duplicate camera records during manual entry or JSON imports.
 * **Soft-Delete Support:**
   Add an unlinked_at timestamp field (nullable) to the NVR model.
 * **Cascade Relationships:**
   Ensure proper cascade rules are set for foreign keys where appropriate.
### 2. NVR Management Actions & Backend API
 * **Edit IP Action:**
   Implement/update an endpoint to edit an NVR's IP address (PUT /api/v1/nvrs/{id}/ip). Updating an NVR's IP must update the IP fields across all associated cameras under that NVR without changing their primary key ids (preserving all historical logs, stats, and snapshots).
 * **Soft-Delete (Unlink) vs Hard-Delete:**
   * **Soft-Delete (Unlink):** Sets unlinked_at = utcnow() on the NVR and deactivates monitoring for its cameras, but keeps database records and files intact.
   * **Hard-Delete:** Immediately purges the NVR, its cameras, history logs, and all physical snapshot files from disk.
### 3. Orphaned Data Cleanup Task (app/services/scheduler.py or background task)
 * Extend the existing log cleanup task (which purges logs older than 90 days) to include an **Orphaned File & Record Cleanup**:
   * Scan for NVRs where unlinked_at is older than **30 days**.
   * Delete all associated physical snapshot files from disk for those unlinked cameras/NVRs.
   * Execute a hard delete on those NVR and camera records from the database.
### 4. JSON Import Engine & Upsert/Replace Strategy
 * Do NOT perform raw db.add() on JSON uploads.
 * Implement an **Analysis Engine** for imported JSON files:
   * Parse NVRs and cameras in the JSON payload.
   * Compare incoming data against existing records based on unique identifiers and existing IDs/IPs.
   * Support two execution strategies based on user choice:
     * **Upsert:** Update existing records (IPs, names, settings) and insert new ones without purging untouched existing data.
     * **Replace:** Clear conflicting existing NVRs/cameras and replace them with the JSON contents.
### 5. Asynchronous Processing & UI/UX Workflow
 * **Background Processing for JSON Import:**
   * JSON analysis/import endpoints must run as a FastAPI BackgroundTasks (or async job) returning a job_id and progress endpoint (GET /api/v1/jobs/{job_id}/status).
 * **Frontend Loading & Minimize Feature (static/js/ & UI):**
   * Upon JSON upload, display an animated loading modal ("Analyzing JSON & NVR status...").
   * Include a **"Minimize"** button on the modal.
   * When minimized, shrink the modal into a **Sticky Progress Bar** at the bottom-right corner of the screen so the user can continue using the dashboard during processing.
 * **Decision Modal:**
   * Once the job analysis reaches 100%, pop up a Decision Modal summarizing the findings (e.g., *"Found 5 new NVRs, 2 existing NVRs with IP changes"*).
   * Let the user select between **Upsert** and **Replace** before applying final database commits.
### Execution Instructions:
 1. Review the current database models and endpoints first.
 2. Apply database model changes and migrations/table updates.
 3. Update backend FastAPI endpoints and background tasks.
 4. Update frontend JS modules and HTML modals.
 5. Ensure all existing unit tests pass and add new tests covering:
   * Unique constraint violation prevention.
   * NVR IP updating without losing camera history.
   * 30-day unlinked cleanup logic.
