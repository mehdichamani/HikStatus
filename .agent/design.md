# سیستم طراحی و تم‌بندی رنگی پروژه HikStatus 🎨

**تاریخ تدوین:** ۱۳ مرداد ۱۴۰۵  
**نسخه:** 1.1.0  

این مستند شامل پالت‌های رنگی استاندارد، سیستم طراحی بر پایه متغیرهای CSS (CSS Custom Properties) و راهنمای کامل استفاده از آن در بخش فرانت‌اند پروژه **HikStatus** می‌باشد.

---

## 📐 ساختار سیستم رنگی

سیستم تم‌بندی شامل **۴ استایل متمایز** است که هر کدام دو حالت **روشن (Light)** و **تاریک (Dark)** را پشتیبانی می‌کنند (در مجموع ۸ حالت متغیر):

0. **Classic Minimal (کلاسیک / ساده و اصلی):** تم ساده، خنثی و بدون اغراق رنگی (پس‌زمینه مشکی/سرمه‌ای خیلی تیره `#0a0a0f` در تاریک و سفید خالص `#f8fafc` در روشن)؛ دقیقا هماهنگ با هویت اولیه سامانه.
1. **Corporate Navy (شرکتی / سرمه‌ای):** استایل رسمی، صنعتی و پایدار؛ مناسب برای داشبوردهای مدیریتی و سازمانی.
2. **Modern Emerald (مدرن / زمردی):** استایل مدرن و تازه‌کننده با تمرکز بر سلامت سیستم‌ها و پایش‌های زنده.
3. **Cyber Violet (سایبر / بنفش):** استایل پیشرفته های‌تک (High-Tech)؛ بسیار جذاب برای مراکز عملیات شبکه (NOC) و مانیتورینگ امنیتی.

---

## 📊 جدول مقایسه کامل کدهای رنگی (Color Palette Reference Table)

| استایل (Style) | حالت (Mode) | کلید تم (Key) | پس‌زمینه اصلی (`--bg`) | سطح / کارت (`--surface`) | رنگ برند / اصلی (`--primary`) | رنگ متن (`--text`) | رنگ مرز (`--border`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **0. کلاسیک (ساده)** | 🌙 Dark | `classic-dark` | `#0a0a0f` | `#12121a` | `#6366f1` (نیلی) | `#f1f5f9` | `#2a2a36` |
| **0. کلاسیک (ساده)** | ☀️ Light | `classic-light` | `#f8fafc` | `#ffffff` | `#4f46e5` (نیلی تیره) | `#0f172a` | `#e2e8f0` |
| **1. شرکتی (سرمه‌ای)** | 🌙 Dark | `navy-dark` | `#0f172a` | `#1e293b` | `#3b82f6` (آبی روشن) | `#f8fafc` | `#334155` |
| **1. شرکتی (سرمه‌ای)** | ☀️ Light | `navy-light` | `#f4f6f9` | `#ffffff` | `#1e3a8a` (سرمه‌ای) | `#1e293b` | `#dcdfe6` |
| **2. مدرن (زمردی)** | 🌙 Dark | `emerald-dark` | `#022c22` | `#064e3b` | `#10b981` (زمردی روشن) | `#ecfdf5` | `#047857` |
| **2. مدرن (زمردی)** | ☀️ Light | `emerald-light` | `#f0fdf4` | `#ffffff` | `#059669` (سبز زمردی) | `#064e3b` | `#cbd5e1` |
| **3. سایبر (بنفش)** | 🌙 Dark | `violet-dark` | `#0b0716` | `#170e2b` | `#a855f7` (بنفش روشن) | `#f5f3ff` | `#3b206e` |
| **3. سایبر (بنفش)** | ☀️ Light | `violet-light` | `#faf5ff` | `#ffffff` | `#7e22ce` (بنفش تیره) | `#3b0764` | `#e9d5ff` |

---

## 🎨 متغیرهای جامع CSS (Design Tokens)

```css
/* ==========================================================================
   HikStatus Unified Color System & Design Tokens
   ========================================================================== */

/* --------------------------------------------------------------------------
   0. STYLE 0: CLASSIC MINIMAL (پیش‌فرض سیستم)
   -------------------------------------------------------------------------- */

/* Classic Dark */
:root,
[data-theme="classic-dark"] {
  --bg: #0a0a0f;
  --surface: #12121a;
  --surface-2: #1a1a24;
  --surface-3: #22222e;
  --border: #2a2a36;
  --border-light: #333340;

  --primary: #6366f1;
  --primary-hover: #818cf8;
  --primary-glow: rgba(99, 102, 241, 0.15);

  --text: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  --success: #22c55e;
  --success-bg: rgba(34, 197, 94, 0.1);
  --danger: #ef4444;
  --danger-bg: rgba(239, 68, 68, 0.1);
  --warning: #f59e0b;
  --info: #3b82f6;
  --info-bg: rgba(59, 130, 246, 0.1);

  --shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

/* Classic Light */
[data-theme="classic-light"] {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-2: #f1f5f9;
  --surface-3: #e2e8f0;
  --border: #e2e8f0;
  --border-light: #cbd5e1;

  --primary: #4f46e5;
  --primary-hover: #6366f1;
  --primary-glow: rgba(79, 70, 229, 0.12);

  --text: #0f172a;
  --text-secondary: #475569;
  --text-muted: #64748b;

  --success: #16a34a;
  --success-bg: rgba(22, 163, 74, 0.1);
  --danger: #dc2626;
  --danger-bg: rgba(220, 38, 38, 0.1);
  --warning: #d97706;
  --info: #2563eb;
  --info-bg: rgba(37, 99, 235, 0.1);

  --shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

/* --------------------------------------------------------------------------
   1. STYLE 1: CORPORATE NAVY
   -------------------------------------------------------------------------- */

[data-theme="navy-dark"] {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface-2: #2d3d54;
  --surface-3: #3b4f6c;
  --border: #334155;
  --border-light: #475569;

  --primary: #3b82f6;
  --primary-hover: #60a5fa;
  --primary-glow: rgba(59, 130, 246, 0.25);

  --text: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #64748b;

  --success: #34d399;
  --danger: #f87171;
  --warning: #fbbf24;
  --info: #60a5fa;
}

[data-theme="navy-light"] {
  --bg: #f4f6f9;
  --surface: #ffffff;
  --surface-2: #eaeef4;
  --surface-3: #dbe2ed;
  --border: #dcdfe6;
  --border-light: #e2e8f0;

  --primary: #1e3a8a;
  --primary-hover: #1d4ed8;
  --primary-glow: rgba(30, 58, 138, 0.12);

  --text: #1e293b;
  --text-secondary: #475569;
  --text-muted: #64748b;

  --success: #10b981;
  --danger: #ef4444;
  --warning: #d97706;
  --info: #2563eb;
}

/* --------------------------------------------------------------------------
   2. STYLE 2: MODERN EMERALD
   -------------------------------------------------------------------------- */

[data-theme="emerald-dark"] {
  --bg: #022c22;
  --surface: #064e3b;
  --surface-2: #0b6e54;
  --surface-3: #108e6c;
  --border: #047857;
  --border-light: #059669;

  --primary: #10b981;
  --primary-hover: #34d399;

  --text: #ecfdf5;
  --text-secondary: #a7f3d0;
  --text-muted: #6ee7b7;

  --success: #34d399;
  --danger: #f87171;
  --warning: #fbbf24;
  --info: #38bdf8;
}

[data-theme="emerald-light"] {
  --bg: #f0fdf4;
  --surface: #ffffff;
  --surface-2: #dcfce7;
  --surface-3: #bbf7d0;
  --border: #cbd5e1;

  --primary: #059669;
  --primary-hover: #10b981;

  --text: #064e3b;
  --text-secondary: #047857;
  --text-muted: #6b7280;

  --success: #059669;
  --danger: #dc2626;
  --warning: #d97706;
  --info: #0284c7;
}

/* --------------------------------------------------------------------------
   3. STYLE 3: CYBER VIOLET
   -------------------------------------------------------------------------- */

[data-theme="violet-dark"] {
  --bg: #0b0716;
  --surface: #170e2b;
  --surface-2: #261748;
  --surface-3: #362263;
  --border: #3b206e;

  --primary: #a855f7;
  --primary-hover: #c084fc;

  --text: #f5f3ff;
  --text-secondary: #ddd6fe;
  --text-muted: #a78bfa;

  --success: #00ff9d;
  --danger: #ff0055;
  --warning: #ffb703;
  --info: #00e5ff;
}

[data-theme="violet-light"] {
  --bg: #faf5ff;
  --surface: #ffffff;
  --surface-2: #f3e8ff;
  --border: #e9d5ff;

  --primary: #7e22ce;
  --primary-hover: #9333ea;

  --text: #3b0764;
  --text-secondary: #6b21a8;

  --success: #10b981;
  --danger: #e11d48;
  --warning: #f59e0b;
  --info: #8b5cf6;
}
```
