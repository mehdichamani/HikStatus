# 🧪 راهنمای جامع تست‌نویسی و کیفیت‌سنجی (TEST_GUIDE)

این مستند راهنمای توسعه، نگهداری، اجرای آزمون‌ها و تکنیک‌های شبیه‌سازی (Mocking) در پروژه **HikStatus** است.

---

## 📂 ۱. ساختار پوشه آزمون‌ها (`tests/`)

مجموعه تست‌ها با فریم‌ورک **`pytest`** و کلاینت تستی FastAPI (`TestClient`) پیاده‌سازی شده است:

```
tests/
├── conftest.py                   ← تنظیم مسیر پایه پروژه (sys.path)
├── test_endpoints.py             ← تست جامع CRUD اندپوینت‌ها، احراز هویت و دسترسی‌ها
├── test_new_scenarios.py         ← تست سناریوهای مانیتورینگ چندگانه و تشخیص تغییرات
├── test_nvr_health.py            ← تست پایش سلامت دیسک و اطلاعات سیستمی NVR
├── test_outage.py                ← تست تحلیل و ثبت قطعی‌های طولانی دوربین‌ها
├── test_scheduler_arch.py        ← تست چرخه و معماری زمان‌بند مستقل
└── test_telegram_rich_alerts.py  ← تست تولید پیام‌های غنی، دکمه‌های Inline و ارسال تلگرام
```

---

## ⚙️ ۲. نحوه اجرای آزمون‌ها

### ۲.۱. اجرای تمام تست‌ها (توصیه‌شده)
```bash
uv run --no-project pytest
```

یا در صورت فعال بودن venv:
```bash
pytest
```

### ۲.۲. اجرای همراه با خروجی لاگ و جزئیات کامل
```bash
uv run --no-project pytest -v -s
```

### ۲.۳. اجرای یک فایل تست خاص
```bash
uv run --no-project pytest tests/test_endpoints.py -v
```

### ۲.۴. اجرای یک سناریو یا تابع تست منفرد
```bash
uv run --no-project pytest tests/test_endpoints.py -k "test_endpoint_nvrs_crud" -v
```

---

## 🛠️ ۳. ساختار فیکسچرها (Fixtures) و دیتابیس تست

برای جلوگیری از دستکاری دیتابیس عملیاتی (`data/monitor.db`)، تمامی تست‌ها از پایگاه داده موقت SQLite در حافظه یا فایل ایزوله استفاده می‌کنند.

### ۳.۱. فیکسچر مدیریت سشن (`session_fixture`)
در فایل [`tests/test_endpoints.py`](file:///c:/Users/Mehdi/projects/HikStatus/tests/test_endpoints.py):
1. دیتابیس تست موقت ایجاد و جداول با `SQLModel.metadata.create_all(test_engine)` ساخته می‌شوند.
2. اتصالات موتورهای `database.engine`, `monitor.engine` و `scheduler.engine` موقتاً به دیتابیس تست متصل می‌گردند.
3. مقادیر اولیه ضروری (مانند تنظیمات پیش‌فرض و کاربر ادمین پیش‌فرض با `id=1`) ایجاد می‌شوند.
4. پس از اتمام تست، جداول پاک‌سازی (`drop_all`) و متغیرهای اصلی بازیابی می‌شوند.

### ۳.۲. فیکسچر کلاینت و جایگزینی وابستگی‌ها (`client_fixture`)
جهت تست اندپوینت‌ها بدون نیاز به اجرای فرآیند لاگین واقعی در تک‌تک تست‌ها، از قابلیت `app.dependency_overrides` استفاده می‌شود:
```python
main.app.dependency_overrides[get_session] = get_session_override
main.app.dependency_overrides[require_auth] = require_auth_override
main.app.dependency_overrides[require_control] = require_control_override
main.app.dependency_overrides[require_admin] = require_admin_override
```

---

## 🎭 ۴. الگوهای شبیه‌سازی (Mocking Patterns)

پروژه با سخت‌افزارهای خارجی (دستگاه‌های NVR هایک‌ویژن) و سرویس‌های بیرونی (تلگرام و SMTP) در ارتباط است. در محیط تست هیچ‌گونه تماس شبکه واقعی نباید برقرار شود.

### ۴.۱. شبیه‌سازی تماس‌های HTTP هایک‌ویژن و ISAPI
استفاده از دکوراتور `unittest.mock.patch` روی کتابخانه `requests`:
```python
from unittest import mock


@mock.patch("requests.get")
def test_camera_snapshot(mock_get, client):
    # شبیه‌سازی پاسخ موفق با بایت‌های تصویر
    mock_get.return_value.status_code = 200
    mock_get.return_value.content = b"fake_jpeg_data"

    response = client.get("/api/cameras/1/snapshot")
    assert response.status_code == 200
```

### ۴.۲. شبیه‌سازی ارسال پیام تلگرام و ایمیل
```python
@mock.patch("app.services.alerts.send_telegram_alert")
def test_alert_flow(mock_tg, session):
    mock_tg.return_value = True
    # اجرای متد مانیتورینگ
    ...
    assert mock_tg.called
```

---

## ✍️ ۵. راهنمای اضافه کردن تست جدید

هنگام افزودن قابلیت یا Endpoint جدید، این الگو را رعایت کنید:

```python
def test_my_new_feature(session, client):
    # ۱. فراهم‌سازی داده اولیه (Arrange)
    group = NVRGroup(name="گروه جدید")
    session.add(group)
    session.commit()
    
    # ۲. فراخوانی اکشن / اندپوینت (Act)
    response = client.post("/api/my-endpoint", json={"group_id": group.id})
    
    # ۳. بررسی و اعتبارسنجی خروجی (Assert)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

---

## 📋 ۶. اصول و استانداردهای کیفی آزمون‌ها

1. **استقلال کامل تست‌ها:** هر آزمون باید ایزوله باشد و نباید به نتیجه یا داده‌های تست‌های قبل از خود وابسته باشد.
2. **عدم تداخل داده‌ای:** قبل و بعد از تست از بازنشانی Session و Truncate جداول اطمینان حاصل شود.
3. **سرعت بالا:** تست‌ها نباید شامل `time.sleep` طولانی باشند؛ در صورت نیاز به بررسی فواصل زمانی، از شبیه‌سازی `datetime.now()` یا متغیرهای مربوطه استفاده کنید.
4. **رعایت قوانین لینتر:** کدهای تست باید با قواعد `ruff check` و فرمت‌بندی استاندارد پروژه سازگار باشند.

---

**تاریخ نگارش:** ۱۴۰۵/۰۵/۲۷
