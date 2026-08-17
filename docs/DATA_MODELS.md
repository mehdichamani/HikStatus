# 🗄️ مستند مدل‌های داده پروژه HikStatus (DATA_MODELS)

این مستند تشریح کامل ساختار پایگاه‌داده، جداول، فیلدها، روابط کلید خارجی (Foreign Keys)، ایندکس‌ها و رفتارهای آبشاری در پروژه **HikStatus** است.

---

## 📌 ۱. ساختار کلی و تنظیمات دیتابیس

* **موتور پایگاه‌داده:** SQLite همراه با مد **WAL (Write-Ahead Logging)** و همزمانی بالا (`PRAGMA journal_mode=WAL` و `PRAGMA synchronous=NORMAL`).
* **فایل دیتابیس:** `data/monitor.db`
* **نگاشت شیء-رابطه‌ای (ORM):** SQLModel (مبتنی بر SQLAlchemy و Pydantic).

---

## 📊 ۲. جداول اصلی سیستم

### ۲.۱. جدول گروه‌ها (`NVRGroup`)
مدیریت بخش‌ها، شعب یا گروه‌بندی‌های فیزیکی/منطقی دستگاه‌ها.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات و محدودیت‌ها |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی (`PRIMARY KEY`) خودکار |
| `name` | `TEXT` | - | نام یکتا برای گروه (`UNIQUE`) |
| `description` | `TEXT` | `None` | توضیحات گروه |
| `map_center_lat` | `REAL` | `None` | عرض جغرافیایی مرکز نقشه |
| `map_center_lng` | `REAL` | `None` | طول جغرافیایی مرکز نقشه |
| `map_zoom` | `INTEGER` | `None` | ضریب زوم پیش‌فرض نقشه |

---

### ۲.۲. جدول نقشه‌های تصویری/طبقات (`MapPlan`)
پلان‌های دوبعدی یا نقشه‌های سفارشی مربوط به هر گروه.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات و محدودیت‌ها |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی (`PRIMARY KEY`) |
| `group_id` | `INTEGER` | - | کلید خارجی `nvrgroup.id` (`INDEX`) |
| `name` | `TEXT` | - | عنوان نقشه / پلان |
| `image_url` | `TEXT` | - | مسیر ذخیره فایل تصویر نقشه |
| `sort_order` | `INTEGER` | `0` | ترتیب نمایش پلان‌ها |

---

### ۲.۳. جدول دستگاه‌های ضبط (`NVR`)
اطلاعات اتصال و سلامت دستگاه‌های NVR و سرورهای هایک‌ویژن.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات و محدودیت‌ها |
| :--- | :--- | :--- | :--- |
| `ip` | `TEXT` | - | کلید اصلی (`PRIMARY KEY`) — فرمت `IP:PORT` یا `IP` |
| `name` | `TEXT` | `None` | نام نمایشی دستگاه |
| `user` | `TEXT` | - | نام‌کاربری وب دستگاه |
| `password` | `TEXT` | `None` | کلمه عبور رمزنگاری‌شده (Fernet) |
| `enabled` | `BOOLEAN` | `True` | فعال بودن پایش دستگاه (`INDEX`) |
| `status` | `TEXT` | `'Unknown'` | وضعیت: `'Online'`, `'Offline'`, `'Unknown'` |
| `last_online` | `TIMESTAMP` | `None` | آخرین زمان پاسخ‌دهی دستگاه |
| `mail_alert_count` | `INTEGER` | `0` | تعداد هشدارهای ایمیل ارسال‌شده در قطعی جاری |
| `mail_last_alert` | `TIMESTAMP` | `None` | تاریخ/زمان آخرین ارسال ایمیل |
| `telegram_alert_count` | `INTEGER` | `0` | تعداد هشدارهای تلگرام ارسال‌شده در قطعی جاری |
| `telegram_last_alert` | `TIMESTAMP` | `None` | تاریخ/زمان آخرین ارسال تلگرام |
| `group_id` | `INTEGER` | `None` | کلید خارجی `nvrgroup.id` (`INDEX`) |
| `rtsp_port` | `INTEGER` | `554` | پورت استریم RTSP |
| `model` | `TEXT` | `None` | مدل سخت‌افزاری دستگاه |
| `firmware_version` | `TEXT` | `None` | نگارش فریم‌ور |
| `serial_number` | `TEXT` | `None` | شماره سریال یکتای دستگاه |
| `mac_address` | `TEXT` | `None` | آدرس MAC دستگاه |
| `uptime` | `INTEGER` | `None` | مدت زمان روشن بودن (ثانیه) |
| `cpu_usage` | `INTEGER` | `None` | درصد مصرف پردازنده |
| `memory_usage` | `INTEGER` | `None` | درصد مصرف رم |
| `hdd_status` | `TEXT` | `None` | وضعیت هارددیسک‌ها (JSON String) |
| `device_time` | `TIMESTAMP` | `None` | زمان داخلی دستگاه |

---

### ۲.۴. جدول دوربین‌ها (`Camera`)
شناسه و متادیتای دوربین‌های متصل به هر NVR.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات و محدودیت‌ها |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی (`PRIMARY KEY`) |
| `name` | `TEXT` | - | نام یا کانال دوربین |
| `ip` | `TEXT` | - | آی‌پی مستقیم دوربین (در صورت وجود) |
| `nvr_ip` | `TEXT` | - | کلید خارجی به IP دستگاه NVR (`INDEX`) |
| `channel_id` | `TEXT` | - | شماره کانال در NVR (مثال: `1` یا `101`) |
| `importance` | `INTEGER` | `2` | سطح اهمیت: `1` (بالا)، `2` (معمولی)، `3` (پایین) |
| `last_online` | `TIMESTAMP` | `None` | آخرین زمان فعال بودن |
| `status` | `TEXT` | `'Unknown'` | وضعیت: `'Online'`, `'Offline'`, `'Unknown'`, `'Muted'` |
| `mail_alert_count` | `INTEGER` | `0` | شمارنده ارسال هشدار ایمیل |
| `mail_last_alert` | `TIMESTAMP` | `None` | زمان آخرین ارسال ایمیل |
| `telegram_alert_count` | `INTEGER` | `0` | شمارنده ارسال هشدار تلگرام |
| `telegram_last_alert` | `TIMESTAMP` | `None` | زمان آخرین ارسال تلگرام |
| `latitude` | `REAL` | `None` | موقعیت روی نقشه جغرافیایی (عرض) |
| `longitude` | `REAL` | `None` | موقعیت روی نقشه جغرافیایی (طول) |
| `x_pos` | `REAL` | `None` | موقعیت افقی روی پلان تصویری (درصد) |
| `y_pos` | `REAL` | `None` | موقعیت عمودی روی پلان تصویری (درصد) |
| `fov_angle` | `REAL` | `None` | زاویه جهت دید دوربین (درجه) |
| `fov_radius` | `REAL` | `None` | شعاع یا عمق دید دوربین |
| `fov_spread` | `REAL` | `None` | زاویه گشودگی لنز (Field of View) |
| `plan_id` | `INTEGER` | `None` | کلید خارجی به `mapplan.id` |
| `model` | `TEXT` | `None` | مدل دوربین |
| `recording_scheduled` | `BOOLEAN` | `None` | آیا ضبط زمان‌بندی دارد؟ |
| `recording_schedule_type`| `TEXT` | `None` | نوع زمان‌بندی ضبط |
| `oldest_record` | `TIMESTAMP` | `None` | قدیمی‌ترین زمان فیلم ضبط‌شده موجود |
| `total_record_size_gb` | `REAL` | `None` | حجم کل ضبط به گیگابایت |
| `total_record_duration_hours`| `REAL` | `None` | مجموع ساعات فیلم ضبط‌شده |
| `recording_hours_24h` | `REAL` | `None` | مدت ضبط در ۲۴ ساعت گذشته (ساعت) |
| `stats_last_updated` | `TIMESTAMP` | `None` | زمان آخرین به‌روزرسانی آمار ضبط |

---

### ۲.۵. جدول رویدادهای تغییر دوربین (`CameraChangeEvent`)
ثبت تغییرات سخت‌افزاری در تعداد و تنظیمات دوربین‌های NVR.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی |
| `nvr_ip` | `TEXT` | - | آی‌پی دستگاه NVR (`INDEX`) |
| `camera_name` | `TEXT` | `None` | نام دوربین تغییر یافته |
| `camera_channel_id` | `TEXT` | `None` | شناسه کانال دوربین |
| `change_type` | `TEXT` | - | نوع: `"camera_added"`, `"camera_removed"`, `"recording_changed"` |
| `old_value` | `TEXT` | `None` | مقدار قبلی |
| `new_value` | `TEXT` | `None` | مقدار جدید |
| `detected_at` | `TIMESTAMP` | `now` | زمان کشف تغییر |
| `group_id` | `INTEGER` | `None` | کلید خارجی `nvrgroup.id` |

---

### ۲.۶. وقایع قطعی و توقف (`DowntimeEvent`)
بازه زمانی قطعی هر دوربین از لحظه قطع تا وصل مجدد.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی |
| `camera_id` | `INTEGER` | - | کلید خارجی `camera.id` (`INDEX`) |
| `start_time` | `TIMESTAMP` | `now` | زمان شروع قطعی |
| `end_time` | `TIMESTAMP` | `None` | زمان پایان قطعی و وصل مجدد (`INDEX`) |

---

### ۲.۷. جدول رفع ابهام قطعی‌ها (`OutageExplanation`)
ثبت توضیحات، دلایل و علت‌های قطعی‌های طولانی توسط مسئولین گروه.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی |
| `camera_id` | `INTEGER` | - | کلید خارجی `camera.id` |
| `downtime_event_id` | `INTEGER` | `None` | کلید خارجی `downtimeevent.id` (می‌تواند خالی باشد) |
| `group_id` | `INTEGER` | `None` | کلید خارجی `nvrgroup.id` |
| `start_time` | `TIMESTAMP` | - | زمان شروع قطعی مورد نظر |
| `end_time` | `TIMESTAMP` | `None` | زمان پایان قطعی |
| `created_at` | `TIMESTAMP` | `now` | زمان ایجاد درخواست رفع ابهام |
| `assigned_deadline` | `TIMESTAMP` | - | مهلت مجاز جهت ارائه توضیح |
| `explanation_type` | `TEXT` | `None` | علت کلی (انتخاب از `OutageCause`) |
| `explanation_detail` | `TEXT` | `None` | شرح و توضیحات تکمیلی کاربر |
| `explained_by_user_id`| `INTEGER` | `None` | کلید خارجی `user.id` |
| `explained_at` | `TIMESTAMP` | `None` | تاریخ و زمان ثبت توضیح |

---

### ۲.۸. جدول علل قطعی (`OutageCause`)
عناوین پیش‌فرض و سفارشی برای دسته‌بندی دلایل قطعی دوربین‌ها.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی |
| `name` | `TEXT` | - | عنوان علت (یکتا، `UNIQUE`, `INDEX`) |
| `is_active` | `BOOLEAN` | `True` | فعال بودن جهت انتخاب در لیست‌ها |

---

### ۲.۹. جدول لاگ‌های ممیزی و رویدادها (`Log`)
سیستم ثبت لاگ ساختاریافته برای تمامی اتفاقات، خطاهای امنیتی و مانیتورینگ.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات و ایندکس‌ها |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی |
| `timestamp` | `TIMESTAMP` | `now` | زمان ثبت لاگ (`INDEX`) |
| `category` | `TEXT` | `'System'` | دسته‌بندی: `Auth`, `NVR`, `Camera`, `Alert`, `System` (`INDEX`) |
| `level` | `TEXT` | `'INFO'` | سطح لاگ: `INFO`, `WARNING`, `ERROR`, `CRITICAL` (`INDEX`) |
| `action` | `TEXT` | `None` | عملیات انجام‌شده (مانند `login`, `camera_offline`, `sync`) (`INDEX`) |
| `actor_username` | `TEXT` | `'system'` | نام کاربری عامل (`INDEX`) |
| `actor_ip` | `TEXT` | `None` | آدرس IP کاربر/عامل |
| `group_id` | `INTEGER` | `None` | شناسه گروه مربوطه (`INDEX`) |
| `target_type` | `TEXT` | `None` | نوع هدف: `nvr`, `camera`, `user`, `group` |
| `target_id` | `TEXT` | `None` | شناسه یا IP هدف |
| `details` | `TEXT` | - | متن تشریحی لاگ |
| `log_type` | `TEXT` | `None` | فیلد سازگاری رویداد |
| `state` | `TEXT` | `None` | وضعیت رویداد |

---

### ۲.۱۰. جدول کاربران (`User`)
اطلاعات احراز هویت، نقش‌ها و تنظیمات امنیتی کاربران.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی |
| `username` | `TEXT` | - | نام‌کاربری یکتا (`UNIQUE`, `INDEX`) |
| `password_hash` | `TEXT` | - | رشته رمزنگاری شده با Salt و الگوریتم PBKDF2 |
| `role` | `TEXT` | `'group_view'` | نقش کاربر (توضیحات در بخش ۳) |
| `group_id` | `INTEGER` | `None` | کلید خارجی `nvrgroup.id` (گروه پیش‌فرض/تخصیص‌یافته) |
| `accessible_group_ids`| `TEXT` | `None` | لیست گروه‌های مجاز (فرمت کاما جدا `1,2,3`) |
| `is_active` | `BOOLEAN` | `True` | فعال بودن اکانت |
| `two_factor_secret` | `TEXT` | `None` | کلید احراز هویت دو مرحله‌ای TOTP |
| `two_factor_enabled` | `BOOLEAN` | `False` | وضعیت فعال بودن 2FA |

---

### ۲.۱۱. جدول نشست‌های کاربری (`UserSession`)
مدیریت توکن‌های لاگین، انقضا و نشست‌های فعال.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `token` | `TEXT` | - | کلید اصلی (`PRIMARY KEY`) — توکن امنیتی تصادفی |
| `username` | `TEXT` | - | نام‌کاربری لاگین‌شده |
| `role` | `TEXT` | - | نقش کاربر در زمان لاگین |
| `group_id` | `INTEGER` | `None` | شناسه گروه کاربر |
| `user_id` | `INTEGER` | `None` | کلید خارجی `user.id` |
| `created_at` | `TIMESTAMP` | `now` | زمان ایجاد نشست |
| `expires_at` | `TIMESTAMP` | - | زمان انقضای توکن |
| `last_activity` | `TIMESTAMP` | `now` | زمان آخرین درخواست معتبر |

---

### ۲.۱۲. جدول تنظیمات هشدار کاربر (`UserAlertSettings`)
تنظیمات ارسال اختصاصی پیام برای هر کاربر.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `None` | کلید اصلی |
| `user_id` | `INTEGER` | - | کلید خارجی یکتا به `user.id` (`UNIQUE`) |
| `mail_enabled` | `BOOLEAN` | `False` | ارسال هشدار ایمیل به کاربر |
| `mail_recipients` | `TEXT` | `None` | آدرس‌های ایمیل مقصد (با کاما) |
| `telegram_enabled` | `BOOLEAN` | `False` | ارسال هشدار تلگرام به کاربر |
| `telegram_chat_ids` | `TEXT` | `None` | شناسه چت‌های تلگرام (با کاما) |

---

### ۲.۱۳. جدول کارهای زمان‌بندی‌شده (`ScheduledTask`)
مدیریت و مانیتورینگ Taskهای پس‌زمینه.

| نام فیلد | نوع داده | پیش‌فرض | توضیحات |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | - | شناسه یکتای کار (مثال: `monitor_loop`) |
| `name` | `TEXT` | - | عنوان تسک |
| `description` | `TEXT` | - | شرح وظیفه تسک |
| `interval` | `INTEGER` | - | فاصله اجرا (به ثانیه) |
| `is_enabled` | `BOOLEAN` | `True` | فعال بودن زمان‌بند برای این تسک |
| `status` | `TEXT` | `'Idle'` | وضعیت جاری: `'Idle'`, `'Running'`, `'Failed'` |
| `last_run` | `TIMESTAMP` | `None` | آخرین زمان اجرای تسک |
| `last_duration` | `REAL` | `None` | مدت زمان آخرین اجرا (ثانیه) |
| `last_status` | `TEXT` | `None` | نتیجه اجرای قبلی: `'Success'`, `'Failed'` |
| `last_error` | `TEXT` | `None` | متن آخرین خطای رخ‌داده |
| `next_run` | `TIMESTAMP` | `None` | پیش‌بینی زمان اجرای بعدی |

---

### ۲.۱۴. جدول تنظیمات عمومی (`Settings`)
نگهداری جفت‌های کلید-مقدار (Key-Value) برای پیکربندی‌های کلی سیستم.

| نام فیلد | نوع داده | توضیحات |
| :--- | :--- | :--- |
| `key` | `TEXT` | کلید اصلی (`PRIMARY KEY`) — نام تنظیمات (مانند `MAIL_ENABLED`, `TELEGRAM_BOT_TOKEN`) |
| `value` | `TEXT` | مقدار تنظیمات |
| `description` | `TEXT` | توضیحات کارکرد تنظیم |

---

## 🔐 ۳. انام‌ها و مقادیر استاندارد (Enums & Constants)

### ۳.۱. نقش‌های کاربری (`User.role`)
1. **`admin` (مدیر ارشد):** دسترسی کامل به کلیه منوها، مدیریت کاربران، گروه‌ها، NVRها، دیتابیس و تنظیمات کلان.
2. **`it_manager` (مدیر فناوری اطلاعات):** امکان مدیریت NVRها، دوربین‌ها، بررسی خطاها و کارهای زمان‌بندی‌شده.
3. **`inspector` (بازرس):** دسترسی به گزارش‌ها، بررسی لاگ‌ها، پیگیری وضعیت رفع ابهام قطعی‌ها بدون دسترسی به ویرایش تجهیزات.
4. **`group_view` (کاربر ناظر گروه):** مشاهده نقشه، آمار و پاسخ به رفع ابهام‌های قطعی تنها برای گروه‌های مجاز خود.

### ۳.۲. سطح اهمیت دوربین (`Camera.importance`)
* **سطح ۱ (`High`):** دوربین‌های بسیار حساس — تاخیر اعلان کوتاه (۱ دقیقه)، ارسال سریع در بات تلگرام و ایمیل.
* **سطح ۲ (`Medium`):** دوربین‌های عادی — تاخیر پیش‌فرض اعلان.
* **سطح ۳ (`Low`):** دوربین‌های کم‌اهمیت — تاخیر بالاتر اعلان و نادیده‌گرفتن هشدارهای مکرر.

---

## 🔒 ۴. مکانیزم‌های رمزنگاری و امنیت داده

1. **رمز عبور کاربران (`User.password_hash`):**
   - الگوریتم: `PBKDF2-HMAC-SHA256` با ۱۰۰,۰۰۰ دور چرخه و Salt تصادفی ۱۶ بایتی (`secrets.token_bytes(16)`).
   - ساختار رشته ذخیره‌شده: `<salt_hex>:<hash_hex>`.
2. **رمز عبور NVRها (`NVR.password`):**
   - رمزنگاری متقارن دوطرفه با کتابخانه **`Fernet (AES-128-CBC + HMAC-SHA256)`**.
   - کلید رمزنگاری از متغیر محیطی `ENCRYPTION_KEY` یا فایل حفاظت‌شده `data/encryption.key` خوانده می‌شود.
