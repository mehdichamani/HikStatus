# ⚙️ مرجع تنظیمات سیستم HikStatus (SETTINGS_REFERENCE)

این مستند تشریح کامل کلیدهای جدول تنظیمات عمومی (`Settings`)، مقادیر پیش‌فرض، نوع داده، رفتار پیش‌فرض و تأثیر هر تنظیم بر اجزای مختلف سامانه **HikStatus** است.

---

## 📌 ۱. ساختار جدول تنظیمات

جدول `Settings` به عنوان یک حافظه کلید-مقدار (Key-Value) در دیتابیس عمل می‌کند:
* **`key` (`TEXT`, Primary Key):** شناسه یکتای تنظیم با حروف بزرگ انگلیسی.
* **`value` (`TEXT`):** مقدار متنی تنظیم (اعداد، رشته‌ها، بولین‌ها و لیست‌ها به صورت رشته ذخیره می‌شوند).
* **`description` (`TEXT`):** شرح وظیفه و راهنمای کوتاه تنظیم.

> [!NOTE]
> در صورتی که تنظیمی در جدول یافت نشود، سرویس‌های سیستم مقدار پیش‌فرض سخت‌کدشده (Hardcoded Fallback) خود را به عنوان مقدار معتبر در نظر می‌گیرند.

---

## 📧 ۲. تنظیمات ایمیل و ارسال اعلان (Email / SMTP)

این تنظیمات پیکربندی سرور ایمیل جهت ارسال گزارش‌ها و هشدارهای سیستم را مشخص می‌کنند.

| کلید تنظیم | مقدار پیش‌فرض | نوع داده | شرح و رفتار سیستم |
| :--- | :--- | :--- | :--- |
| `MAIL_ENABLED` | `"false"` | `Boolean` (`"true"`/`"false"`) | فعال یا غیرفعال بودن سرویس ارسال هشدار ایمیلی در سراسر سامانه. |
| `MAIL_SERVER` | `"smtp.gmail.com"` | `String` | آدرس سرور SMTP (مثال: `smtp.gmail.com` یا سرور داخلی). |
| `MAIL_PORT` | `"587"` | `Integer` | پورت اتصال به سرور SMTP (معمولاً `587` برای STARTTLS و `465` برای SSL). |
| `MAIL_USER` | `"email@gmail.com"` | `String` | نام کاربری یا آدرس ایمیل فرستنده جهت لاگین به سرور SMTP. |
| `MAIL_PASS` | `"password"` | `String` | رمز عبور یا App Password ایمیل فرستنده. |
| `MAIL_RECIPIENTS` | `"admin@example.com"` | `String` | لیست آدرس‌های ایمیل گیرندگان پیش‌فرض (با کاما `,` جدا شوند). |
| `MAIL_FIRST_ALERT_DELAY_MINUTES` | `"1"` | `Integer` (دقیقه) | حداقل زمان قطعی مورد نیاز قبل از ارسال اولین هشدار برای دوربین‌های معمولی. |
| `MAIL_LOW_IMPORTANCE_DELAY_MINUTES` | `"30"` | `Integer` (دقیقه) | تاخیر ارسال اولین هشدار برای دوربین‌های با اهمیت پایین (جهت جلوگیری از ارسال پیام‌های گذرا). |
| `MAIL_ALERT_FREQUENCY_MINUTES` | `"60"` | `Integer` (دقیقه) | فاصله زمانی بین ارسال هشدارهای متوالی برای دوربینی که قطعی آن تداوم دارد. |
| `MAIL_MUTE_AFTER_N_ALERTS` | `"3"` | `Integer` | حداکثر تعداد هشدارهای ارسالی قبل از مسدود شدن موقت (Mute) تا زمان رفع قطعی. |

---

## 🤖 ۳. تنظیمات بات تلگرام (Telegram Notifications)

تنظیمات مربوط به ارسال هشدارهای فوری از طریق ربات تلگرام.

| کلید تنظیم | مقدار پیش‌فرض | نوع داده | شرح و رفتار سیستم |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_ENABLED` | `"false"` | `Boolean` (`"true"`/`"false"`) | فعال یا غیرفعال بودن ارسال هشدارهای تلگرامی. |
| `TELEGRAM_BOT_TOKEN` | `""` | `String` | توکن دسترسی API ربات تلگرام (دریافتی از BotFather). |
| `TELEGRAM_CHAT_IDS` | `""` | `String` | شناسه‌های چت، گروه یا کانال مقصد تلگرام (با کاما `,` جدا شوند). |
| `TELEGRAM_PROXY` | `""` | `String` | آدرس پروکسی برای دسترسی به تلگرام (مانند `socks5://127.0.0.1:1080` یا `http://ip:port`). |
| `TELEGRAM_FIRST_ALERT_DELAY_MINUTES` | `"1"` | `Integer` (دقیقه) | حداقل زمان پایداری قطعی قبل از ارسال اولین پیام تلگرام. |
| `TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES` | `"15"` | `Integer` (دقیقه) | تاخیر ارسال پیام برای دوربین‌های کم‌اهمیت در تلگرام. |
| `TELEGRAM_ALERT_FREQUENCY_MINUTES` | `"30"` | `Integer` (دقیقه) | فاصله زمانی بین هشدارهای تکراری قطعی در تلگرام. |
| `TELEGRAM_MUTE_AFTER_N_ALERTS` | `"3"` | `Integer` | سقف تعداد ارسال پیام به ازای هر قطعی قبل از Mute شدن خودکار. |

---

## 🔔 ۴. سیاست‌ها و ماتریس کانال‌های اعلان (Notification Policy Matrix)

سیستم دارای یک ماتریس مرکزی برای تعیین مجاز بودن رویدادها و کانال‌های ارسالی است:
* ساختار کلید فعال بودن کلی رویداد: `NOTIFY_<EVENT_TYPE>_ENABLED`
* ساختار کلید کانال اختصاصی: `NOTIFY_<EVENT_TYPE>_<CHANNEL>` (کانال‌ها شامل `EMAIL`, `TELEGRAM`, `BROWSER`)

| رویداد (`EVENT_TYPE`) | عنوان فارسی | کلید فعال‌سازی کلی | کلیدهای کانال اختصاصی | مقدار پیش‌فرض |
| :--- | :--- | :--- | :--- | :--- |
| `CAMERA_OFFLINE` | قطع دوربین | `NOTIFY_CAMERA_OFFLINE_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `CAMERA_RECOVERED` | وصل مجدد دوربین | `NOTIFY_CAMERA_RECOVERED_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `NVR_OFFLINE` | قطع ارتباط NVR | `NOTIFY_NVR_OFFLINE_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `NVR_RECOVERED` | وصل مجدد NVR | `NOTIFY_NVR_RECOVERED_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `NVR_AUTH_ERROR` | خطای احراز هویت NVR | `NOTIFY_NVR_AUTH_ERROR_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `CAMERA_TOPOLOGY_CHANGED`| افزودن یا حذف دوربین | `NOTIFY_CAMERA_TOPOLOGY_CHANGED_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `RECORDING_CHANGED` | تغییر تنظیمات ضبط | `NOTIFY_RECORDING_CHANGED_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `DOWNTIME_HOURLY_SUMMARY`| گزارش قطعی ساعتی | `NOTIFY_DOWNTIME_HOURLY_SUMMARY_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |
| `DELIVERY_FAILURE` | خطای ارسال اعلان | `NOTIFY_DELIVERY_FAILURE_ENABLED` | `_EMAIL`, `_TELEGRAM`, `_BROWSER` | `"true"` |

> [!TIP]
> برای غیرفعال کردن یک اعلان خاص (مثلاً ارسال ایمیل هنگام وصل مجدد دوربین)، تنظیم `NOTIFY_CAMERA_RECOVERED_EMAIL` را به `"false"` تغییر دهید.

---

## 📉 ۵. تحلیل و رفع ابهام قطعی‌ها (Outage Analysis & Explanations)

این پارامترها قوانین مربوط به تشخیص قطعی‌های طولانی و ایجاد خودکار تسک‌های رفع ابهام برای کاربران ناظر گروه را تعیین می‌کنند.

| کلید تنظیم | مقدار پیش‌فرض | نوع داده | شرح و رفتار سیستم |
| :--- | :--- | :--- | :--- |
| `OUTAGE_MIN_HOURS_TO_EXPLAIN` | `"2"` | `Integer` (ساعت) | حداقل مدت زمان قطعی یک دوربین تا مشمول الزام ارائه توضیح شود. |
| `OUTAGE_EXPLANATION_DEADLINE_HOURS`| `"24"` | `Integer` (ساعت) | مهلت مجاز برای کاربر ناظر جهت ثبت دلیل قطعی (Deadline). |
| `OUTAGE_ANALYSIS_DAYS` | `"5,6,0,1,2,3"` | `String` | روزهای کاری هفته برای اجرای تحلیل (شنبه=`5`، یکشنبه=`6`، دوشنبه=`0`، سه‌شنبه=`1`، چهارشنبه=`2`، پنج‌شنبه=`3`، جمعه=`4`). |
| `OUTAGE_ANALYSIS_TIME` | `"07:30"` | `String` (HH:MM) | ساعت اجرای تسک روزانه تحلیل قطعی‌ها (به وقت سرور). |
| `OUTAGE_LAST_ANALYSIS_TIME` | `""` | `String` (ISO) | تاریخ و زمان آخرین اجرای موفق تسک تحلیل قطعی‌ها. |

---

## 🗺️ ۶. تنظیمات نقشه و پلان‌های بصری (Map & Floor Plans)

پیکربندی حالت پیش‌فرض نمایش نقشه‌ها در داشبورد و صفحه دوربین‌ها.

| کلید تنظیم | مقدار پیش‌فرض | نوع داده | شرح و رفتار سیستم |
| :--- | :--- | :--- | :--- |
| `MAP_TYPE` | `"floor"` | `String` (`"floor"`/`"gis"`) | نوع نمای پیش‌فرض نقشه: `"floor"` برای پلان‌های تصویری طبقات و `"gis"` برای نقشه جغرافیایی OpenStreetMap. |
| `MAP_IMAGE` | `""` | `String` (URL/Path) | آدرس تصویر پیش‌فرض پلان طبقه در صورت عدم انتخاب گروه. |
| `MAP_START_LAT` | `"37.796067"` | `Float` (عرض جغرافیایی) | مختصات عرض جغرافیایی پیش‌فرض برای مرکز نقشه GIS. |
| `MAP_START_LNG` | `"45.062508"` | `Float` (طول جغرافیایی) | مختصات طول جغرافیایی پیش‌فرض برای مرکز نقشه GIS. |

---

## 💡 نکات و بهترین شیوه‌ها (Best Practices)

1. **اعتبارسنجی مقادیر:** هنگام ویرایش مقادیر از طریق API یا فرانت‌اند، مقادیر عددی باید با مقادیر مثبت اعتبارسنجی شوند و مقادیر بولین با رشته‌های `"true"` یا `"false"` تنظیم گردند.
2. **عدم حذف کلیدها:** از حذف رکوردهای جدول `Settings` خودداری کنید؛ برای خاموش کردن هر قابلیت کافیست مقدار آن را به `"false"` یا مقدار خالی تغییر دهید.
3. **همگام‌سازی زمان‌بند:** پس از تغییر تنظیمات سرور ایمیل یا بات تلگرام، سرویس هشدار در فراخوانی بعدی به صورت خودکار مقادیر جدید را از دیتابیس بارگذاری می‌کند.
