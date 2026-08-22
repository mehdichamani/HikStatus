# 📁 پوشه Proposals — طرح‌های پیشنهادی در انتظار تصمیم

این پوشه شامل **پلن‌ها، طرح‌های امکان‌سنجی و ایده‌های توسعه‌ای** است که هنوز تصمیم نهایی برای اجرای آنها گرفته نشده.

---

## ⚠️ قوانین این پوشه

> **هیچ ایجنتی مجاز نیست محتوای این فایل‌ها را بدون تأیید صریح کاربر پیاده‌سازی کند.**

- فایل‌های اینجا **مستند نیستند** — پلن و ایده هستند.
- وضعیت هر فایل باید یکی از سه حالت زیر باشد:

| وضعیت | معنا |
|---|---|
| `[pending]` | در انتظار تصمیم — پیش‌فرض فایل‌های جدید |
| `[implemented]` | اجرا شده و ادغام‌شده در سامانه (با تست‌های خودکار و مستندات) |
| `[approved]` | تأیید شده، آماده اجرا |
| `[rejected]` | رد شده یا جایگزین‌شده (نگهداری برای مرجع تاریخی) |

---

## 📄 فایل‌های فعلی

| فایل | موضوع | وضعیت | توضیحات / مستندات مرتبط |
|---|---|---|---|
| [`UX-UI-Redesign.md`](file:///home/unreal/projects/HikStatus/.agents/proposals/UX-UI-Redesign.md) | بازطراحی کامل رابط کاربری | `[rejected]` | جایگزین‌شده با سیستم طراحی جامع در [`.agents/DESIGN.md`](file:///home/unreal/projects/HikStatus/.agents/DESIGN.md) طبق ADR-003 |
| [`بهبود فرآیند تعریف NVR.md`](file:///home/unreal/projects/HikStatus/.agents/proposals/%D8%A8%D9%87%D8%A8%D9%88%D8%AF%20%D9%81%D8%B1%D8%A2%DB%8C%D9%86%D8%AF%20%D8%AA%D8%B9%D8%B1%DB%8C%D9%81%20NVR.md) | مدیریت هوشمند NVR و import JSON | `[implemented]` | پیاده‌سازی کامل (تست‌های `test_nvr_lifecycle_import.py` و تصمیم شماره ۱۱) |
| [`تجمیع اعلان‌های مرورگر و خوانش فارسی.md`](file:///home/unreal/projects/HikStatus/.agents/proposals/%D8%AA%D8%AC%D9%85%DB%8C%D8%B9%20%D8%A7%D8%B9%D9%84%D8%A7%D9%86%E2%80%8C%D9%87%D8%A7%DB%8C%20%D9%85%D8%B1%D9%88%D8%B1%DA%AF%D8%B1%20%D9%88%20%D8%AE%D9%88%D8%A7%D9%86%D8%B4%20%D9%81%D8%A7%D8%B1%D8%B3%DB%8C.md) | تجمیع نوتیفیکیشن و TTS فارسی | `[implemented]` | تجمیع در انتهای چرخه پایش با Web Speech API و صدای چایم Fallback (تست‌های `test_browser_notifications.py`) |
| [`تجمیع کامل هشدارهای تلگرام با Rich Messages.md`](file:///home/unreal/projects/HikStatus/.agents/proposals/%D8%AA%D8%AC%D9%85%DB%8C%D8%B9%20%DA%A9%D8%A7%D9%85%D9%84%20%D9%87%D8%B4%D8%AF%D8%A7%D8%B1%D9%87%D8%A7%DB%8C%20%D8%AA%D9%84%DA%AF%D8%B1%D8%A7%D9%85%20%D8%A8%D8%A7%20Rich%20Messages.md) | تجمیع هشدارهای NVR و دوربین با Rich Messages | `[implemented]` | پیاده‌سازی کامل در نسخه 0.10.0 (تست‌های `test_telegram_rich_alerts.py`) |

---

## ➕ اضافه کردن پلن جدید

هر پلن جدید (چه از طرف کاربر، چه از طرف ایجنت) باید:
1. در این پوشه ذخیره شود.
2. در جدول بالا ثبت شود.
3. وضعیت آن `[pending]` باشد تا کاربر تصمیم بگیرد.
