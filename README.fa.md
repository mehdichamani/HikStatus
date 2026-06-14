# HikStatus

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)

داشبورد مانیتورینگ دوربین و دستگاه NVR هایک‌ویژن با اعلان‌های لحظه‌ای از طریق ایمیل و تلگرام.

## امکانات

- مانیتورینگ لحظه‌ای وضعیت دوربین‌ها (آنلاین/آفلاین)
- کشف خودکار دستگاه NVR و دوربین‌ها
- سیستم اعلان از طریق ایمیل و تلگرام
- رابط کاربری فارسی با پشتیبانی RTL
- ردیابی زمان قطعی و گزارش‌های ساعتی
- سطح اهمیت دوربین‌ها (کم/متوسط/بحرانی)
- بی‌صدا کردن اعلان‌ها پس از تعداد مشخص
- طراحی واکنش‌گرا برای دسکتاپ و موبایل

## شروع سریع

### داکر (توصیه شده)

```bash
# کلون کردن مخزن
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# پیکربندی محیط
cp .env.example .env  # ویرایش با اطلاعات خود

# اجرا با Docker Compose
docker compose up -d
```

### سیستم‌عامل بومی (ویندوز/لینوکس/مک)

```bash
# کلون کردن مخزن
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# ویندوز
install.bat
start.bat

# لینوکس/مک
chmod +x run.sh
./run.sh
```

### دسترسی

مرورگر خود را باز کنید: http://localhost:28888

نام کاربری و رمز عبور پیش‌فرض:
- نام کاربری: `admin`
- رمز عبور: `admin`

**مهم:** رمز عبور پیش‌فرض را پس از اولین ورود تغییر دهید!

## پیکربندی

### متغیرهای محیطی (.env)

```env
ADMIN_USER=admin
ADMIN_PASS=your-secure-password
```

### پیکربندی اولیه (init_config.json)

فایل `init_config.example.json` را به `init_config.json` کپی کرده و ویرایش کنید:

```json
{
  "settings": {
    "MAIL_ENABLED": "true",
    "MAIL_SERVER": "smtp.gmail.com",
    "MAIL_PORT": "587",
    "MAIL_USER": "your-email@gmail.com",
    "MAIL_PASS": "your-app-password",
    "MAIL_RECIPIENTS": "admin@example.com",
    "TELEGRAM_ENABLED": "true",
    "TELEGRAM_BOT_TOKEN": "your-bot-token",
    "TELEGRAM_CHAT_IDS": "your-chat-id"
  },
  "nvrs": [
    {
      "ip": "192.168.1.100",
      "user": "admin",
      "password": "your-nvr-password",
      "enabled": true
    }
  ]
}
```

### نام دوربین‌ها (camera_names.csv)

فایل CSV اختیاری برای نام‌گذاری سفارشی دوربین‌ها:

```csv
ip_address,camera_name
192.168.1.100,دروازه ورودی
192.168.1.101,حیاط پشتی
```

## معماری

- **بک‌اند:** Python FastAPI + SQLite (SQLModel)
- **فرانت‌اند:** HTML/CSS/JS خالص با پشتیبانی RTL
- **دیتابیس:** SQLite با حالت WAL برای دسترسی همزمان
- **اعلان‌ها:** ایمیل (SMTP) و تلگرام (Bot API)

## ساختار پروژه

```
HikStatus/
├── main.py              # برنامه FastAPI
├── monitor.py           # حلقه مانیتورینگ دوربین
├── alerts.py            # اعلان‌های ایمیل و تلگرام
├── database.py          # تعاریف دیتابیس SQLModel
├── static/              # فایل‌های فرانت‌اند
│   ├── index.html
│   ├── login.html
│   ├── app.js
│   └── style.css
├── Dockerfile           # تصویر Docker
├── docker-compose.yml   # پیکربندی Docker Compose
├── requirements.txt     # وابستگی‌های Python
├── install.bat          # نصب‌کننده ویندوز
├── start.bat            # اجرای‌کننده ویندوز
├── run.sh               # اجرای‌کننده لینوکس/مک
└── .env                 # متغیرهای محیطی (gitignored)
```

## پایانه‌های API

| متد | پایانه | توضیحات |
|-----|--------|---------|
| GET | `/api/health` | بررسی سلامت |
| POST | `/api/auth/login` | ورود |
| POST | `/api/auth/logout` | خروج |
| GET | `/api/nvrs` | لیست NVR ها |
| POST | `/api/nvrs` | افزودن NVR |
| DELETE | `/api/nvrs/{ip}` | حذف NVR |
| GET | `/api/cameras` | لیست دوربین‌ها |
| PUT | `/api/cameras/{id}` | ویرایش دوربین |
| GET | `/api/settings` | لیست تنظیمات |
| PUT | `/api/settings/{key}` | ویرایش تنظیم |
| GET | `/api/logs` | جستجوی لاگ‌ها |
| GET | `/api/stats/{cam_id}` | آمار قطعی دوربین |
| GET | `/api/reports/generate` | تولید گزارش |

## مجوز

MIT License
