// نقطه ورود اصلی سیستم (Entry Point)

import * as Api from './api.js';
import * as Ui from './ui.js';
import * as CameraView from './modules/camera_view.js';

// ثبت تمامی توابع در شیء سراسری window جهت حفظ سازگاری کامل با فرانت‌اند و کدهای درون‌برنامه‌ای
for (const [name, func] of Object.entries(Api)) {
    window[name] = func;
}
for (const [name, func] of Object.entries(Ui)) {
    window[name] = func;
}
for (const [name, func] of Object.entries(CameraView)) {
    window[name] = func;
}

// تعریف متغیرها و ثوابت سراسری سیستم بر روی شیء window برای به اشتراک‌گذاری وضعیت بین ماژول‌ها
window.API = '/api/v1';
window.logOff = 0;
window.logFilter = '';
window.logSearchVal = '';
window.loading = false;
window.allLoaded = false;
window.currentCamId = undefined;
window.currentImp = undefined;
window.settingsCache = [];
window.nvrCache = [];
window.groupCache = [];
window.dashCamerasCache = [];
window.ws = null;
window.wsRetryDelay = 1000;
window.dashCamSearchVal = '';
window.dashCamFilter = 'all';
window.dashCamRecordingFilter = 'all';
window.dashCamRecordingFilter = 'all';

window.collapsedFactories = new Set(JSON.parse(localStorage.getItem('collapsedFactories') || '[]'));
window.collapsedNvrs = new Set(JSON.parse(localStorage.getItem('collapsedNvrs') || '[]'));

// --- DASHBOARD & SUMMARY ---

// --- SETTINGS ---
window.settingLabels = {
    'MAIL_ENABLED': 'فعال‌سازی ایمیل',
    'MAIL_SERVER': 'سرور ایمیل',
    'MAIL_PORT': 'پورت',
    'MAIL_USER': 'نام کاربری',
    'MAIL_PASS': 'رمز عبور',
    'MAIL_RECIPIENTS': 'گیرندگان',
    'MAIL_FIRST_ALERT_DELAY_MINUTES': 'تأخیر اعلان اولیه (دقیقه)',
    'MAIL_LOW_IMPORTANCE_DELAY_MINUTES': 'تأخیر اعلان اهمیت کم (دقیقه)',
    'MAIL_ALERT_FREQUENCY_MINUTES': 'فاصله اعلان‌ها (دقیقه)',
    'MAIL_MUTE_AFTER_N_ALERTS': 'بی‌صدا پس از N اعلان',
    'TELEGRAM_ENABLED': 'فعال‌سازی تلگرام',
    'TELEGRAM_BOT_TOKEN': 'توکن ربات',
    'TELEGRAM_CHAT_IDS': 'شناسه چت‌ها',
    'TELEGRAM_PROXY': 'آدرس پروکسی',
    'TELEGRAM_FIRST_ALERT_DELAY_MINUTES': 'تأخیر اعلان اولیه (دقیقه)',
    'TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES': 'تأخیر اعلان اهمیت کم (دقیقه)',
    'TELEGRAM_ALERT_FREQUENCY_MINUTES': 'فاصله اعلان‌ها (دقیقه)',
    'TELEGRAM_MUTE_AFTER_N_ALERTS': 'بی‌صدا پس از N اعلان',
    'OUTAGE_MIN_HOURS_TO_EXPLAIN': 'حداقل زمان قطعی جهت نیاز به رفع ابهام (ساعت)',
    'OUTAGE_EXPLANATION_DEADLINE_HOURS': 'مهلت رفع ابهام قطعی (ساعت)',
    'OUTAGE_ANALYSIS_DAYS': 'روزهای بررسی قطعی در هفته',
    'OUTAGE_ANALYSIS_TIME': 'ساعت بررسی قطعی‌ها (مثال: 07:30)',
};

window.notificationEventCatalog = [
    ['camera_offline', 'قطع دوربین', 'ارسال هشدار هنگام قطع شدن دوربین'],
    ['camera_recovered', 'وصل مجدد دوربین', 'ارسال پیام بازگشت دوربین به وضعیت آنلاین'],
    ['nvr_offline', 'قطع ارتباط NVR', 'ارسال هشدار هنگام در دسترس نبودن NVR'],
    ['nvr_recovered', 'وصل مجدد NVR', 'ارسال پیام بازگشت NVR به وضعیت آنلاین'],
    ['nvr_auth_error', 'خطای احراز هویت NVR', 'نمایش خطای نام کاربری یا رمز عبور NVR'],
    ['camera_topology_changed', 'افزودن یا حذف دوربین', 'اعلان تغییر ساختار دوربین‌های یک NVR'],
    ['recording_changed', 'تغییر تنظیمات ضبط', 'اعلان تغییر وضعیت یا نوع ضبط دوربین'],
    ['downtime_hourly_summary', 'گزارش قطعی ساعتی', 'ارسال گزارش دوره‌ای دوربین‌های قطع‌شده'],
    ['delivery_failure', 'خطای ارسال اعلان', 'نمایش خطای ناموفق بودن ارسال ایمیل یا تلگرام'],
];

window.pendingNVRDeletes = new Set();

window.confirmPromiseResolver = null;

// --- LOGS ---

window.logLevelFilter = 'all';

window.logTimer;
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logScroll').addEventListener('scroll', (e) => {
        if (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 100) fetchLogs();
    });
});

// --- JALALI/GREGORIAN CONVERSIONS ---
window.BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
window.MIN_JALAALI_YEAR = BREAKS[0];
window.MAX_JALAALI_YEAR = BREAKS[BREAKS.length - 1] - 1;

// --- REPORTS ---

// ===== CHARTS =====
window.chartTrendInstance = null;
window.chartCausesInstance = null;
window.chartGroupsInstance = null;
window.chartTopCamerasInstance = null;
window.chartStatusInstance = null;

// --- INIT ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/v1/auth/me');
        if (res.ok) {
            window.currentUser = await res.json();
            applyRoleUI();
        } else {
            window.location.href = '/login';
            return;
        }
    } catch (e) {
        console.error('Auth verification failed:', e);
        window.location.href = '/login';
        return;
    }
    if (typeof jalaliDatepicker !== 'undefined') {
        jalaliDatepicker.startWatch({
            time: true,
            hasSecond: false
        });
    }
    nav('dash');
    warmUpSearchCache();
    connectWS();
    initBrowserAlerts();
    checkAdminPasswordWarning();
    window.startDashboardCountdowns();

    // Hide initial loading screen
    const loadingScreen = document.getElementById('initial-loading-screen');
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        loadingScreen.style.pointerEvents = 'none';
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 400);
    }
});

// System theme listener
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        const currentTheme = localStorage.getItem('hikstatus-theme') || 'system';
        if (currentTheme === 'system') {
            applyTheme('system');
        }
    });
}

// Call on load to set initial icon and kiosk listeners
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(localStorage.getItem('hikstatus-theme') || 'system');
    initKioskListeners();
    initDashboardCustomization();
});

// ===== BROWSER ALERTS & SOUND SYNTHESIS =====

// ===== MAP & HEATMAP LOGIC =====
window.map = null;
window.mapMarkers = [];
window.mapClusterGroup = null;
window.mapEditMode = false;
window.mapType = 'floor';
window.mapImage = '';
window.mapCamerasList = [];
window.mapStartLat = 37.796067;
window.mapStartLng = 45.062508;
window.currentGroupId = null;
window.mapPlans = [];
window.activePlanId = null;
window.groupsCache = [];

window.fovSaveTimers = {};

// --- Role-Based Access Control (RBAC) frontend logic ---

// User CRUD management
window.usersCache = [];

// Personal Alert Settings management

// --- Profile & Change Password Handlers ---

window.activeQRCode = null;

// --- Interactive FOV Editor & Dragging Handles ---

window.activeFovMarker = null;
window.activeFovCamera = null;
window.fovHandles = [];

// --- SCHEDULED TASKS ---
window.scheduledTasksCache = [];

window.TASK_DETAILS = {
    ping_cameras: [
        'دریافت وضعیت Online/Offline همه دوربین‌ها از NVRها',
        'ثبت رویداد قطعی برای دوربین‌های آفلاین و بستن رویدادهای بازیابی',
        'به‌روزرسانی وضعیت NVR و دوربین‌ها در دیتابیس',
        'ارسال هشدار تلگرام و ایمیل برای قطعی‌ها و بازیابی‌ها',
        'ارسال گزارش خلاصه ساعتی قطعی‌ها'
    ],
    sync_nvr_configs: [
        'دریافت تنظیمات ضبط (روشن/خاموش و نوع) از NVRها',
        'به‌روزرسانی وضعیت ضبط و نوع آن برای هر دوربین',
        'ثبت تغییرات وضعیت ضبط در تاریخچه رویدادها',
        'همگام‌سازی خودکار نام دوربین‌ها'
    ],
    sync_nvr_stats: [
        'جستجوی فایل‌های ویدئویی روی هارد NVR از ابتدا تاکنون',
        'دریافت فراداده فایل‌های ۲۴ ساعت اخیر',
        'محاسبه حجم کل داده‌های ضبط‌شده (GB)',
        'محاسبه قدیمی‌ترین تاریخ ضبط و مجموع ساعات ضبط',
        'محاسبه درصد پوشش ضبط در ۲۴ ساعت اخیر',
        'به‌روزرسانی آمار ضبط هر دوربین در دیتابیس'
    ],
    sync_camera_names: [
        'دریافت نام، IP و مدل دوربین‌ها از NVRها',
        'به‌روزرسانی نام و IP دوربین‌ها در دیتابیس',
        'تشخیص دوربین‌های جدید و افزودن خودکار به دیتابیس',
        'تشخیص دوربین‌های حذف‌شده و پاک‌سازی خودکار',
        'ثبت تغییرات ساختاری و ارسال هشدار'
    ],
    capture_camera_snapshots: [
        'دریافت تصویر لحظه‌ای از sub-stream دوربین‌های آنلاین',
        'ذخیره تصاویر در مسیر data/snapshots/camera_{id}.jpg',
        'تهیه تصویر پیش‌نمایش برای نمایش در پنل وب'
    ],
    cleanup_database: [
        'حذف خودکار لاگ‌های مانیتورینگ قدیمی‌تر از N روز',
        'حذف رویدادهای قطعی بسته‌شده قدیمی',
        'حذف نشست‌های کاربری منقضی‌شده',
        'بهینه‌سازی حجم دیتابیس'
    ],
    analyze_outages: [
        'بررسی قطعی‌های ۲۴ ساعت اخیر برای همه دوربین‌ها',
        'محاسبه مجموع زمان قطعی هر دوربین',
        'شناسایی دوربین‌های با قطعی بیش از آستانه تنظیم‌شده',
        'ثبت رکورد قطعی نیازمند توضیح برای مدیران',
        'تعیین مهلت توضیح برای قطعی‌های ثبت‌شده'
    ]
};

// ===== GLOBAL SEARCH & THEME DROPDOWNS =====

document.addEventListener('click', (e) => {
    // Global Search Dropdown outside click
    const searchContainer = document.querySelector('.global-search-container');
    const searchDropdown = document.getElementById('global-search-dropdown');
    if (searchContainer && searchDropdown && !searchContainer.contains(e.target)) {
        searchDropdown.classList.add('hidden');
    }

    // Theme Selector Mini Modal outside click
    const themeContainer = document.querySelector('.theme-dropdown-container');
    const themeDropdown = document.getElementById('theme-selector-dropdown');
    if (themeContainer && themeDropdown && !themeContainer.contains(e.target)) {
        themeDropdown.classList.add('hidden');
    }
});


if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}

// Outage Explanations UI logic
window.outagesCache = [];
window.outagesSelectedIds = [];
window.currentOutagePage = 1;
window.outagesPerPage = 15;
window.currentSuggestedCause = null;
window.currentSuggestedDetail = null;
window.isBulkExplanation = false;

// ===== DASHBOARD CUSTOMIZATION & DRAG-AND-DROP =====
window.SIZES = ['size-full', 'size-half', 'size-third'];
window.SIZE_LABELS = { 'size-full': '100%', 'size-half': '50%', 'size-third': '33%' };

window.DEFAULT_WIDGET_ORDER = [
    'widget-cam-stats',
    'widget-nvr-health-summary',
    'widget-factory-summary',
    'widget-off-recording',
    'widget-camera-changes',
    'widget-offline-section',
    'widget-nvr-container',
    'widget-important-cams',
    'widget-chart-status',
    'widget-chart-causes',
    'widget-ping-summary'
];

window.WIDGET_METADATA = {
    'widget-cam-stats': { title: 'خلاصه وضعیت دوربین‌ها', desc: 'نمایش خلاصه وضعیت اتصال، دوربین‌های ضبط خاموش و حذف شده در ۲۴ ساعت اخیر' },
    'widget-nvr-health': { title: 'وضعیت سلامت NVRها', desc: 'نمایش وضعیت دیسک‌ها (HDD)، کارکرد (Uptime) و پایش سلامت فیزیکی دستگاه‌های NVR' },
    'widget-nvr-health-summary': { title: 'خلاصه وضعیت سلامت NVRها', desc: 'نمایش گزارش خلاصه سلامت و وضعیت ذخیره‌سازی تجهیزات ضبط' },
    'widget-factory-summary': { title: 'خلاصه کارخانه‌ها', desc: 'نمایش آمار کلی کارخانجات' },
    'widget-off-recording': { title: 'دوربین‌های ضبط خاموش', desc: 'لیست دوربین‌هایی که ضبط آن‌ها غیرفعال است به همراه جزئیات' },
    'widget-camera-changes': { title: 'تغییرات اخیر دوربین‌ها', desc: 'نمایش لیست دوربین‌های حذف یا اضافه شده در ۲۴ ساعت و هفته/ماه اخیر' },
    'widget-offline-section': { title: 'دوربین‌های قطع شده', desc: 'لیست سریع دوربین‌های دارای قطعی' },
    'widget-nvr-container': { title: 'گروه‌بندی کارخانه‌ها و NVRها', desc: 'نمایش کامل دوربین‌ها به تفکیک کارخانه و NVR با فیلتر' },
    'widget-important-cams': { title: 'دوربین‌های مهم', desc: 'نمایش دوربین‌های با سطح اهمیت «مهم»' },
    'widget-chart-status': { title: 'نمودار وضعیت فعلی', desc: 'نمودار دوناتی درصد اتصالات و قطعی‌های فعلی' },
    'widget-chart-causes': { title: 'نمودار علل قطعی', desc: 'نمودار میله‌ای تحلیل بیشترین علل قطعی تجهیزات' },
    'widget-ping-summary': { title: 'پایداری و پینگ شبکه', desc: 'نمایش درصد پایداری SLA و میانگین پینگ اتصالات' }
};

window.isDashEditMode = false;
window.draggedWidgetId = null;

window.changesFilterPeriod = '24h';
window.changesFilterAction = 'all';
window.changesCache = null;
window.offRecordingCache = null;

window.dashChartStatusInstance = null;
window.dashChartCausesInstance = null;
window.lastCausesFetchTime = 0;

// ===== EDIT GROUP AND USER MODALS =====
