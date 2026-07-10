# راهنمای احراز هویت HikVision

این راهنما توضیح می‌دهد چگونه:

- احراز هویت Digest را روی NVR هایک‌ویژن فعال کنید
- یک کاربر غیرادمین برای HikStatus بسازید
- حداقل دسترسی‌های موردنیاز را تنظیم کنید

---

## چرا Digest Authentication لازم است؟

HikStatus از APIهای ISAPI هایک‌ویژن استفاده می‌کند:

- `/ISAPI/ContentMgmt/InputProxy/channels`
- `/ISAPI/ContentMgmt/InputProxy/channels/status`

بسیاری از دستگاه‌های HikVision درخواست‌ها را قبول نمی‌کنند مگر اینکه:

- ISAPI فعال باشد
- Digest Authentication فعال باشد

اگر NVR اضافه نمی‌شود یا دوربین‌ها با وجود صحیح بودن رمز عبور آفلاین نشان داده می‌شوند، معمولاً علت همین مورد است.

---

## فعال‌سازی Digest Authentication

نام منوها ممکن است بسته به نسخه فریمور کمی متفاوت باشد.

### مرحله ۱ — ورود به پنل NVR

آدرس زیر را باز کنید:

```text
http://IP_NVR
```

با حساب ادمین وارد شوید.

---

### مرحله ۲ — تنظیمات امنیتی

به مسیر زیر بروید:

```text
Configuration → System → Security
```

یا:

```text
Configuration → Network → Advanced Settings → Integration Protocol
```

---

### مرحله ۳ — فعال‌سازی ISAPI

گزینه‌ای مشابه موارد زیر را پیدا کنید:

```text
Enable Hikvision-CGI
```

یا:

```text
Enable ISAPI
```

آن را فعال کنید.

---

### مرحله ۴ — انتخاب روش احراز هویت

حالت احراز هویت را روی یکی از موارد زیر قرار دهید:

```text
digest/basic
```

یا:

```text
Digest Authentication
```

از حالت زیر استفاده نکنید:

```text
basic only
```

تنظیمات را ذخیره کنید و در صورت نیاز NVR را ریستارت کنید.

---

## ساخت کاربر غیرادمین برای HikStatus

توصیه می‌شود به‌جای استفاده از حساب ادمین اصلی، یک حساب مانیتورینگ جداگانه بسازید.

### مرحله ۱ — مدیریت کاربران

به مسیر زیر بروید:

```text
Configuration → System → User Management
```

---

### مرحله ۲ — افزودن کاربر

یک کاربر جدید بسازید.

مثال:

```text
Username: hikstatus
Password: strong-password
```

---

### مرحله ۳ — دسترسی‌های موردنیاز

این کاربر فقط به دسترسی‌های مشاهده و خواندن نیاز دارد.

دسترسی‌های پیشنهادی:

- Remote Configuration
- View Device Information
- Preview
- Camera Status
- Remote Log Search (اختیاری)

بسته به نسخه فریمور ممکن است نام‌ها کمی متفاوت باشند.

معمولاً این گروه دسترسی‌ها کافی هستند:

```text
Remote Configuration
Remote Live View
Device Management (Read Only)
```

---

## توصیه‌های امنیتی

از موارد زیر اجتناب کنید:

- استفاده از حساب ادمین اصلی
- رمز عبور مشترک
- باز بودن پنل NVR روی اینترنت

پیشنهاد می‌شود:

- از حساب فقط-خواندنی استفاده کنید
- دسترسی NVR را محدود به شبکه داخلی یا VPN کنید
- رمز پیش‌فرض را تغییر دهید
- پروتکل‌های غیرضروری را غیرفعال کنید

---

## مشکلات رایج

### خطای 401 Unauthorized

معمولاً به علت:

- رمز عبور اشتباه
- غیرفعال بودن Digest Authentication
- غیرفعال بودن ISAPI

---

### نمایش آفلاین بودن دوربین‌ها با وجود دسترسی به NVR

معمولاً به علت:

- نداشتن دسترسی کافی
- فریمور قدیمی
- غیرفعال بودن ISAPI

---

### همگام‌سازی نشدن نام دوربین‌ها

موارد زیر را بررسی کنید:

- فعال بودن ISAPI
- فعال بودن Digest Authentication
- داشتن دسترسی Remote Configuration
