# 🛡️ ماتریس دسترسی مبتنی بر نقش (RBAC Matrix)

این مستند ماتریس جامع سطوح دسترسی، نقش‌های کاربری، کنترل‌های امنیتی و قوانین تفکیک داده‌ها در سامانه **HikStatus** را تشریح می‌کند.

---

## 👥 ۱. نقش‌های کاربری و مسئولیت‌ها

سامانه HikStatus از ۴ نقش کاربری استاندارد پشتیبانی می‌کند:

| نقش (Role) | عنوان فارسی | دامنه اختیارات و شرح مسئولیت |
| :--- | :--- | :--- |
| **`admin`** | مدیر ارشد سیستم | دسترسی کامل و نامحدود به تمامی بخش‌ها، تنظیمات کلان سیستم، مدیریت کاربران، گروه‌ها، NVRها، دیتابیس و لاگ‌های ممیزی. |
| **`it_manager`** | مدیر فناوری اطلاعات | مدیریت تجهیزات نظارتی (NVR و دوربین‌ها)، تست اتصال، همگام‌سازی، مدیریت وظایف زمان‌بندی‌شده، و مشاهده تمامی داده‌های پایش. فاقد دسترسی به تغییر تنظیمات حساس سیستمی و مدیریت کاربران. |
| **`inspector`** | بازرس / ناظر امنیتی | دسترسی فقط-خواندنی (Read-Only) به آمار، گزارش‌های دوره‌ای، چارت‌ها، لاگ‌ها و بررسی توضیحات قطعی‌ها در گروه‌های مجاز خود یا تمام گروه‌ها. فاقد دسترسی به افزودن/ویرایش/حذف تجهیزات. |
| **`group_view`** | ناظر شعبه / گروه | دسترسی محدود و فیلترشده صرفاً به دوربین‌ها، نقشه‌ها و وضعیت‌های مربوط به گروه تخصیص‌یافته (`group_id`). امکان ثبت توضیحات و علت قطعی دوربین‌های شعبه خود. |

---

## 🔒 ۲. مکانیزم‌های کنترل دسترسی در لایه بک‌اند (Dependencies)

در لایه API (`app/main.py`)، کنترل دسترسی‌ها از طریق تزریق وابستگی‌های FastAPI انجام می‌پذیرد:

1. **`require_auth`:** اعتبارسنجی توکن نشست (`UserSession`)، بررسی وضعیت فعال بودن کاربر (`is_active`) و تمدید `last_activity`.
2. **`require_control`:** بررسی عضویت نقش در مجموعه `('admin', 'it_manager')`.
3. **`require_admin`:** محدودسازی دسترسی صرفاً به نقش `'admin'`.
4. **`get_user_accessible_groups`:** بازیابی لیست شناسه‌های گروه مجاز برای کاربر بر اساس فیلدهای `group_id` و `accessible_group_ids`:
   - برای `admin`: بازگشت `None` (دسترسی بدون فیلتر به تمام گروه‌ها).
   - برای `it_manager` و `inspector`: بازگشت لیست گروه‌های تعریف‌شده یا `None` در صورت دسترسی ستاره (`*`).
   - برای `group_view`: بازگشت شناسه تک‌گروه تخصیص‌داده‌شده (`[group_id]`).

---

## 📊 ۳. ماتریس تفصیلی دسترسی به اندپوینت‌های API

علامت‌های جدول:
* ✅ **دسترسی کامل (مجاز)**
* 🔍 **دسترسی مشروط / فیلترشده بر اساس گروه**
* ❌ **عدم دسترسی (HTTP 403 Forbidden)**

### ۳.۱. احراز هویت و حساب کاربری
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/auth/login` | POST | عمومی (با Rate Limit) | ✅ | ✅ | ✅ | ✅ |
| `/api/auth/logout` | POST | `require_auth` | ✅ | ✅ | ✅ | ✅ |
| `/api/auth/me` | GET | `require_auth` | ✅ | ✅ | ✅ | ✅ |
| `/api/me/change-password` | POST | `require_auth` | ✅ | ✅ | ✅ | ✅ |
| `/api/me/alerts` | GET / PUT | `require_auth` | ✅ | ✅ | ✅ | ✅ |
| `/api/auth/2fa/*` | POST | `require_auth` | ✅ | ✅ | ✅ | ✅ |

---

### ۳.۲. مدیریت کاربران (`User Management`)
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/users` | GET | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/users` | POST | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/users/{id}` | PUT | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/users/{id}` | DELETE | `require_admin` | ✅ | ❌ | ❌ | ❌ |

---

### ۳.۳. مدیریت دستگاه‌های NVR و دوربین‌ها
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/nvrs` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |
| `/api/nvrs` | POST | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/nvrs/{ip}` | PUT | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/nvrs/{ip}` | DELETE | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/nvrs/{ip}/test` | POST | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/nvrs/{ip}/sync` | POST | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/cameras` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |
| `/api/cameras/{id}` | PUT | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/cameras/{id}/snapshot` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |
| `/api/cameras/off` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |
| `/api/cameras/changes` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |

---

### ۳.۴. گروه‌ها و پلان‌های تصویری (`Groups & Plans`)
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/groups` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |
| `/api/groups` | POST | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/groups/{id}` | PUT | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/groups/{id}` | DELETE | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/groups/{id}/plans` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |
| `/api/groups/{id}/plans` | POST | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/plans/{id}` | DELETE | `require_control` | ✅ | ✅ | ❌ | ❌ |

---

### ۳.۵. آمارها، گزارش‌ها و علل قطعی (`Outages & Reports`)
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/reports/generate` | GET | `require_auth` | ✅ | ✅ | ✅ | 🔍 |
| `/api/reports/charts` | GET | `require_auth` | ✅ | ✅ | ✅ | 🔍 |
| `/api/reports/causes` | GET | `require_auth` | ✅ | ✅ | ✅ | 🔍 |
| `/api/outages/pending` | GET | `require_auth` | ✅ | 🔍 | 🔍 | 🔍 |
| `/api/outages/explain` | POST | `require_auth` | ✅ | ✅ | ❌ | 🔍 (گروه خود) |
| `/api/outage-causes` | GET | `require_auth` | ✅ | ✅ | ✅ | ✅ |
| `/api/outage-causes` | POST / DELETE | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/stats/heatmap` | GET | `require_auth` | ✅ | ✅ | ✅ | 🔍 |

---

### ۳.۶. مدیریت کارهای زمان‌بندی‌شده (`Scheduler Tasks`)
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/scheduler/tasks` | GET | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/scheduler/tasks/{id}/interval` | PUT | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/scheduler/tasks/{id}/toggle` | PUT | `require_control` | ✅ | ✅ | ❌ | ❌ |
| `/api/scheduler/tasks/{id}/run` | POST | `require_control` | ✅ | ✅ | ❌ | ❌ |

---

### ۳.۷. لاگ‌های سیستم و ممیزی (`Audit Logs`)
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/logs` | GET | `require_auth` | ✅ | ✅ | ✅ | 🔍 (فیلتر لاگ‌های گروه) |
| `/api/logs/stats` | GET | `require_auth` | ✅ | ✅ | ✅ | 🔍 |

---

### ۳.۸. تنظیمات و پشتیبان‌گیری (`Settings & Backup`)
| اندپوینت (Endpoint) | متد | وابستگی امنیتی | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/settings` | GET | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/settings/{key}` | PUT | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/config/export` | GET | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/config/import` | POST | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/backup/download` | GET | `require_admin` | ✅ | ❌ | ❌ | ❌ |
| `/api/backup/restore` | POST | `require_admin` | ✅ | ❌ | ❌ | ❌ |

---

## 🖥️ ۴. ماتریس کنترل المان‌های رابط کاربری (Frontend UI Elements)

در لایه فرانت‌اند (`static/js/ui.js`)، دسترسی به دکمه‌ها و منوها متناسب با نقش کاربر در آبجکت لاگین کنترل می‌شود:

| بخش رابط کاربری | `admin` | `it_manager` | `inspector` | `group_view` |
| :--- | :---: | :---: | :---: | :---: |
| منوی مدیریت کاربران | نمایش | مخفی | مخفی | مخفی |
| منوی تنظیمات سیستمی و پشتیبان‌گیری | نمایش | مخفی | مخفی | مخفی |
| دکمه‌های افزودن / ویرایش / حذف NVR | فعال | فعال | مخفی | مخفی |
| دکمه‌های ویرایش پلان و موقعیت دوربین‌ها | فعال | فعال | غیرفعال | غیرفعال |
| کنترل زمان‌بند و اجرای دستی تسک‌ها | فعال | فعال | مخفی | مخفی |
| دکمه‌های ثبت علت قطعی دوربین | فعال | فعال | غیرفعال | فعال (صرفاً شعبه خود) |
| منوی گزارش‌گیری و نمودارهای تجمیعی | نمایش | نمایش | نمایش | نمایش (محدود به شعبه) |
| لاگ‌های سیستمی و ممیزی | دسترسی کامل | دسترسی کامل | دسترسی کامل | فقط لاگ‌های مربوط به شعبه |

---

**تاریخ نگارش:** ۱۴۰۵/۰۵/۲۷
