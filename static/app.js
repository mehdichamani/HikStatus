const API = '/api';
let logOff = 0, logFilter = '', logSearchVal = '', loading = false, allLoaded = false;
let currentCamId, currentImp, settingsCache = [], nvrCache = [];
let ws = null, wsRetryDelay = 1000;

async function apiFetch(url, options = {}) {
    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            window.location.href = '/login';
            throw new Error('Unauthorized');
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || 'Request failed');
        }
        return res;
    } catch (e) {
        console.error('API Error:', e);
        setConnectionStatus(false);
        throw e;
    }
}

function nav(id) {
    document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(e => e.classList.remove('active'));

    const view = document.getElementById(id);
    if (view) view.classList.add('active');

    document.querySelectorAll(`[data-view="${id}"]`).forEach(e => e.classList.add('active'));

    if (id === 'summ') fetchDash();
    if (id === 'dash') fetchDash();
    if (id === 'map') initOrRefreshMap();
    if (id === 'reports') {
        if (!document.getElementById('startDt').value) {
            setPreset(24);
        }
        genReport();
        fetchAndRenderHeatmap();
    }
    if (id === 'logs' && logOff === 0) fetchLogs();
    if (id === 'settings') loadSettings();
}

function closeModal() {
    document.getElementById('camModal').classList.remove('open');
}

// --- DASHBOARD & SUMMARY ---
function getNvrNum(ip) { return ip.split('.').pop(); }

function getNvrDisplayName(ip) {
    const nvrObj = nvrCache.find(n => n.ip === ip);
    return nvrObj && nvrObj.name ? nvrObj.name : `NVR ${getNvrNum(ip)}`;
}

async function fetchDash() {
    try {
        const nRes = await apiFetch(`${API}/nvrs`);
        nvrCache = await nRes.json();
    } catch (e) {
        console.error('Error loading NVRs:', e);
    }
    const res = await apiFetch(`${API}/cameras`);
    const cams = await res.json();
    const on = cams.filter(c => c.status === 'Online').length;
    const off = cams.filter(c => c.status !== 'Online');

    document.getElementById('s-tot').textContent = cams.length;
    document.getElementById('s-on').textContent = on;
    document.getElementById('s-off').textContent = off.length;

    const totEl = document.getElementById('tot');
    const onEl = document.getElementById('on');
    const offEl = document.getElementById('off');
    if (totEl) totEl.textContent = cams.length;
    if (onEl) onEl.textContent = on;
    if (offEl) offEl.textContent = off.length;

    if (off.length > 0) {
        document.getElementById('offline-section').classList.remove('hidden');
        document.getElementById('all-ok').classList.add('hidden');
        document.getElementById('offline-count').textContent = off.length;
        document.getElementById('offline-grid').innerHTML = off.map(c => createCard(c)).join('');
    } else {
        document.getElementById('offline-section').classList.add('hidden');
        document.getElementById('all-ok').classList.remove('hidden');
    }

    const groups = {};
    cams.forEach(c => { if (!groups[c.nvr_ip]) groups[c.nvr_ip] = []; groups[c.nvr_ip].push(c) });

    const con = document.getElementById('nvr-container');
    con.innerHTML = '';

    Object.keys(groups).sort((a, b) => parseInt(getNvrNum(a)) - parseInt(getNvrNum(b))).forEach(ip => {
        const list = groups[ip];
        const sorted = list.sort((a, b) => parseInt(a.channel_id) - parseInt(b.channel_id));
        const cards = sorted.map(c => createCard(c)).join('');
        con.innerHTML += `
            <div class="nvr-block open">
                <div class="nvr-header" onclick="toggleNvr(this)">
                    <div class="nvr-header-left">
                        <span class="nvr-badge">${getNvrDisplayName(ip)}</span>
                        <span class="nvr-ip">${ip}</span>
                    </div>
                    <svg class="nvr-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <div class="nvr-grid">${cards}</div>
            </div>`;
    });
}

function toggleNvr(header) {
    const block = header.parentElement;
    const grid = header.nextElementSibling;
    block.classList.toggle('open');
    grid.style.display = block.classList.contains('open') ? 'grid' : 'none';
}

function createCard(c) {
    const stClass = c.status === 'Online' ? 'status-online' : 'status-offline';
    const meta = encodeURIComponent(JSON.stringify(c));
    const star = c.importance === 3 ? '<span class="cam-card-star">★</span>' : '';
    const ipShort = c.ip ? c.ip.split('.').pop() : '';

    return `<div class="cam-card ${stClass}" onclick="showCam('${meta}')">
        <div class="cam-card-inner">
            <span class="cam-status-dot"></span>
            <div class="cam-card-info">
                <div class="cam-card-name">${c.name}</div>
                <div class="cam-card-meta">CH ${c.channel_id}</div>
            </div>
            ${star}
        </div>
    </div>`;
}

async function showCam(data) {
    const c = JSON.parse(decodeURIComponent(data));
    currentCamId = c.id;
    currentImp = c.importance;

    document.getElementById('m-name').textContent = c.name;
    document.getElementById('m-nvr').textContent = c.nvr_ip;
    document.getElementById('m-det').textContent = `${c.ip} (CH ${c.channel_id})`;
    document.getElementById('m-imp').textContent = ['کم', 'عادی', 'مهم'][c.importance - 1];
    document.getElementById('camModal').classList.add('open');

    const res = await apiFetch(`${API}/stats/${c.id}`);
    const s = await res.json();
    document.getElementById('m-d1').textContent = s.down_1h + ' دقیقه';
    document.getElementById('m-d24').textContent = s.down_24h + ' دقیقه';
}

async function cycleImpModal() {
    let n = currentImp + 1;
    if (n > 3) n = 1;
    await apiFetch(`${API}/cameras/${currentCamId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importance: n })
    });
    currentImp = n;
    document.getElementById('m-imp').textContent = ['کم', 'عادی', 'مهم'][n - 1];
    fetchDash();
}

// --- SETTINGS ---
const settingLabels = {
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
};

async function loadSettings() {
    const sRes = await apiFetch(`${API}/settings`);
    settingsCache = await sRes.json();

    const nav = document.getElementById('config-nav');
    nav.innerHTML = `
        <button data-tab="sec-nvr" onclick="switchSettingsTab('sec-nvr')">NVRها</button>
        <button data-tab="grp-Email" onclick="switchSettingsTab('grp-Email')">تنظیمات ایمیل</button>
        <button data-tab="grp-Telegram" onclick="switchSettingsTab('grp-Telegram')">تنظیمات تلگرام</button>
        <button data-tab="sec-system" onclick="switchSettingsTab('sec-system')">کنترل سیستم</button>
    `;

    const con = document.getElementById('config-forms');
    con.innerHTML = '';

    const groups = {
        'ایمیل': ['MAIL_ENABLED', 'MAIL_SERVER', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_RECIPIENTS', 'MAIL_FIRST_ALERT_DELAY_MINUTES', 'MAIL_LOW_IMPORTANCE_DELAY_MINUTES', 'MAIL_ALERT_FREQUENCY_MINUTES', 'MAIL_MUTE_AFTER_N_ALERTS'],
        'تلگرام': ['TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'TELEGRAM_PROXY', 'TELEGRAM_FIRST_ALERT_DELAY_MINUTES', 'TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES', 'TELEGRAM_ALERT_FREQUENCY_MINUTES', 'TELEGRAM_MUTE_AFTER_N_ALERTS']
    };

    const groupKeys = {
        'ایمیل': 'Email',
        'تلگرام': 'Telegram'
    };

    for (const [grp, keys] of Object.entries(groups)) {
        const engKey = groupKeys[grp];

        let html = `<div class="card" id="grp-${engKey}">
            <div class="card-header">
                <h3>تنظیمات ${grp}</h3>
                <button class="btn btn-ghost" style="padding:4px 12px; font-size:11px" onclick="testConn('${engKey.toLowerCase()}')">تست اتصال</button>
            </div>`;

        // 1. Add Master toggle if it exists
        const enabledKey = keys.find(k => k.endsWith('ENABLED'));
        if (enabledKey) {
            const item = settingsCache.find(s => s.key === enabledKey);
            if (item) {
                const label = settingLabels[enabledKey] || enabledKey;
                html += `<div class="settings-toggle-header">
                    <span class="toggle-label">${label}</span>
                    <label class="toggle">
                        <input type="checkbox" id="${enabledKey}" ${item.value === 'true' ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>`;
            }
        }

        // 2. Add grid container for other fields
        html += `<div class="settings-fields-grid">`;

        keys.forEach(k => {
            if (k.endsWith('ENABLED')) return; // already handled

            const item = settingsCache.find(s => s.key === k);
            if (!item) return;
            const label = settingLabels[k] || k;

            const isLongField = ['MAIL_RECIPIENTS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'TELEGRAM_PROXY'].includes(k);
            const gridClass = isLongField ? 'span-2' : '';

            html += `<div class="form-field-group ${gridClass}">
                <label class="form-label">${label}</label>
                <input class="form-input" id="${k}" value="${item.value || ''}" type="${k.includes('PASS') || k.includes('TOKEN') ? 'password' : 'text'}">
            </div>`;
        });

        html += `</div>
            <div class="settings-action-row">
                <button class="btn btn-primary" onclick="apply()">ذخیره و اعمال تنظیمات</button>
            </div>
        </div>`;
        con.innerHTML += html;
    }

    const nRes = await apiFetch(`${API}/nvrs`);
    const nvrs = await nRes.json();
    nvrCache = nvrs;
    pendingNVRDeletes = new Set();
    document.getElementById('nvr-list').innerHTML = nvrs.map(n =>
        renderNVRRow(n)
    ).join('');

    const activeTab = document.querySelector('.settings-nav button.active')?.getAttribute('data-tab') || 'sec-nvr';
    switchSettingsTab(activeTab);
}

function switchSettingsTab(tabId) {
    document.querySelectorAll('.settings-nav button').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    const tabs = ['sec-nvr', 'grp-Email', 'grp-Telegram', 'sec-system'];
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = id === tabId ? 'block' : 'none';
        }
    });
}

async function saveAll() {
    for (const s of settingsCache) {
        const el = document.getElementById(s.key);
        if (el) {
            let val = el.value;
            if (el.type === 'checkbox') val = el.checked ? 'true' : 'false';
            if (val !== s.value) {
                await apiFetch(`${API}/settings/${s.key}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: s.key, value: val })
                });
            }
        }
    }
    showToast('ذخیره شد');
}

async function apply() {
    await saveAll();
    await apiFetch(`${API}/monitor/restart`, { method: 'POST' });
    showToast('ریستارت شد');
    setTimeout(() => location.reload(), 500);
}

async function syncCameraNames() {
    const btn = document.getElementById('btn-sync-names');
    if (btn) btn.disabled = true;
    showToast('در حال همگام‌سازی نام دوربین‌ها...');
    try {
        const res = await apiFetch(`/api/config/sync-names`, { method: 'POST' });
        const data = await res.json();
        
        let successCount = 0;
        let failCount = 0;
        if (data.results) {
            data.results.forEach(r => {
                if (r.success) successCount++;
                else failCount++;
            });
        }
        
        if (failCount === 0) {
            showToast('همگام‌سازی نام‌ها با موفقیت انجام شد');
        } else {
            showToast(`همگام‌سازی پایان یافت (${successCount} موفق، ${failCount} ناموفق)`, 'warning');
        }
        
        setTimeout(() => location.reload(), 1500);
    } catch (e) {
        showToast('خطا در همگام‌سازی: ' + e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function testConn(type) {
    try {
        await apiFetch(`/api/test/${type}`, { method: 'POST' });
        showToast('تست موفق');
    } catch (e) {
        showToast('تست ناموفق: ' + e.message, 'error');
    }
}

async function addNVR() {
    const name = document.getElementById('nvrName').value.trim();
    const ip = document.getElementById('nvrIp').value.trim();
    const u = document.getElementById('nvrUser').value.trim();
    const p = document.getElementById('nvrPass').value;
    if (!ip || !u) return showToast('IP و نام کاربری الزامی است', 'error');

    await apiFetch(`${API}/nvrs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || null, ip, user: u, password: p || null, enabled: true })
    });
    document.getElementById('nvrName').value = '';
    document.getElementById('nvrIp').value = '';
    document.getElementById('nvrUser').value = '';
    document.getElementById('nvrPass').value = '';
    loadSettings();
}

let pendingNVRDeletes = new Set();

function renderNVRRow(n, deleted = false) {
    const escaped = n.ip.replace(/[^\w]/g, '_');
    if (deleted) {
        return `<div class="list-item list-item-deleted" id="nvr-row-${escaped}" data-ip="${n.ip}">
            <div class="list-item-info" style="text-decoration: line-through; opacity: 0.55;">
                ${n.name ? `<strong style="margin-left: 8px;">${n.name}</strong>` : ''}
                <span class="list-item-ip">${n.ip}</span>
                <span class="list-item-user">(${n.user})</span>
            </div>
            <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                <button class="btn" style="padding: 4px 10px; font-size: 12px; background: var(--surface-2); color: var(--text-secondary); border: 1px solid var(--border);" onclick="undoNVRDelete('${n.ip}')">
                    بازگشت
                </button>
                <button class="btn btn-danger" style="padding: 4px 10px; font-size: 12px;" onclick="applyNVRDelete('${n.ip}')">
                    حذف
                </button>
            </div>
        </div>`;
    }
    return `<div class="list-item" id="nvr-row-${escaped}" data-ip="${n.ip}">
        <div class="list-item-info">
            ${n.name ? `<strong style="margin-left: 8px; color: var(--text-primary);">${n.name}</strong>` : ''}
            <span class="list-item-ip">${n.ip}</span>
            <span class="list-item-user">(${n.user})</span>
        </div>
        <button class="btn-icon" onclick="delNVR('${n.ip}')" style="width:28px; height:28px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
    </div>`;
}

function delNVR(ip) {
    pendingNVRDeletes.add(ip);
    const nvr = nvrCache.find(n => n.ip === ip);
    if (!nvr) return;
    const escaped = ip.replace(/[^\w]/g, '_');
    const row = document.getElementById(`nvr-row-${escaped}`);
    if (row) row.outerHTML = renderNVRRow(nvr, true);
}

function undoNVRDelete(ip) {
    pendingNVRDeletes.delete(ip);
    const nvr = nvrCache.find(n => n.ip === ip);
    if (!nvr) return;
    const escaped = ip.replace(/[^\w]/g, '_');
    const row = document.getElementById(`nvr-row-${escaped}`);
    if (row) row.outerHTML = renderNVRRow(nvr, false);
}

async function applyNVRDelete(ip) {
    try {
        await apiFetch(`${API}/nvrs/${encodeURIComponent(ip)}`, { method: 'DELETE' });
        pendingNVRDeletes.delete(ip);
        showToast('NVR با موفقیت حذف شد');
        loadSettings();
    } catch (e) {
        showToast('خطا در حذف NVR: ' + e.message, 'error');
    }
}

async function purgeEmpty() {
    if (!confirm('توجه: تمامی اطلاعات دیتابیس (دوربین‌ها، NVRها، لاگ‌ها و تنظیمات) پاک خواهند شد و پایگاه داده خالی ایجاد می‌شود. ادامه می‌دهید؟')) return;
    try {
        await apiFetch(`${API}/data/purge/empty`, { method: 'POST' });
        showToast('پاکسازی و ایجاد دیتابیس خالی با موفقیت انجام شد');
        setTimeout(() => location.reload(), 1000);
    } catch (e) {
        showToast('خطا: ' + e.message, 'error');
    }
}

async function purgeInit() {
    if (!confirm('توجه: تمامی اطلاعات فعلی دیتابیس پاک شده و با مقادیر پیش‌فرض فایل init_config.json جایگزین خواهد شد. ادامه می‌دهید؟')) return;
    try {
        await apiFetch(`${API}/data/purge/init`, { method: 'POST' });
        showToast('پاکسازی و بارگذاری تنظیمات اولیه انجام شد');
        setTimeout(() => location.reload(), 1000);
    } catch (e) {
        showToast('خطا: ' + e.message, 'error');
    }
}

async function restoreDatabase(input) {
    const file = input.files[0];
    if (!file) return;
    // Reset input so selecting same file again triggers onchange
    input.value = '';
    if (!file.name.endsWith('.db')) {
        showToast('فایل باید با پسوند .db باشد', 'error');
        return;
    }
    if (!confirm(`آیا مطمئنید؟ پایگاه داده فعلی با فایل "${file.name}" جایگزین خواهد شد و مانیتور راه‌اندازی مجدد می‌شود.`)) return;
    const statusEl = document.getElementById('restore-status');
    if (statusEl) statusEl.textContent = 'در حال آپلود...';
    try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API}/data/restore`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'خطای نامشخص' }));
            throw new Error(err.detail || 'خطا در بازیابی');
        }
        if (statusEl) statusEl.textContent = '';
        showToast('بازیابی با موفقیت انجام شد. در حال بارگذاری مجدد...');
        setTimeout(() => location.reload(), 1500);
    } catch (e) {
        if (statusEl) statusEl.textContent = '';
        showToast('خطا: ' + e.message, 'error');
    }
}

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        background: ${type === 'error' ? 'var(--danger)' : 'var(--surface-2)'};
        color: ${type === 'error' ? 'white' : 'var(--text)'};
        padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4); z-index: 9999;
        border: 1px solid ${type === 'error' ? 'var(--danger)' : 'var(--border)'};
        animation: fadeIn 0.3s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// --- LOGS ---
function delayLogSearch() {
    clearTimeout(logTimer);
    logTimer = setTimeout(() => {
        logSearchVal = document.getElementById('logSearch').value;
        resetLogs();
    }, 500);
}

function setFilter(btn, val) {
    document.querySelectorAll('.filter-chips .chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    logFilter = val;
    resetLogs();
}

function resetLogs() {
    document.getElementById('log-list').innerHTML = '';
    logOff = 0;
    allLoaded = false;
    fetchLogs();
}

async function fetchLogs() {
    if (loading || allLoaded) return;
    loading = true;
    document.getElementById('logLoader').classList.remove('hidden');

    const res = await apiFetch(`${API}/logs?q=${logFilter || logSearchVal}&limit=30&offset=${logOff}`);
    const logs = await res.json();

    if (logs.length < 30) allLoaded = true;

    document.getElementById('log-list').insertAdjacentHTML('beforeend', logs.map(l => {
        let detail = l.details;
        if (detail.includes('mins')) detail = `<span class="downtime-tag">${detail.match(/\d+m/)}</span> ` + detail;
        const cls = ['Error', 'Failed', 'Offline'].includes(l.state) ? 'status-danger' : 'status-success';
        return `<tr>
            <td style="white-space:nowrap">${l.shamsi_date}</td>
            <td style="font-weight:600; font-size:12px">${l.log_type}</td>
            <td class="${cls}">${l.state}</td>
            <td>${detail}</td>
        </tr>`;
    }).join(''));

    logOff += logs.length;
    loading = false;
    document.getElementById('logLoader').classList.add('hidden');
}

let logTimer;
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logScroll').addEventListener('scroll', (e) => {
        if (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 100) fetchLogs();
    });
});

// --- REPORTS ---
function setPreset(h) {
    const end = new Date();
    const start = new Date(end.getTime() - (h * 60 * 60 * 1000));
    start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
    end.setMinutes(end.getMinutes() - end.getTimezoneOffset());
    document.getElementById('startDt').value = start.toISOString().slice(0, 16);
    document.getElementById('endDt').value = end.toISOString().slice(0, 16);
}

async function genReport() {
    toggleReportSection(false);

    const s = new Date(document.getElementById('startDt').value).getTime() / 1000;
    const e = new Date(document.getElementById('endDt').value).getTime() / 1000;
    if (!s || !e) return showToast('محدوده زمانی را انتخاب کنید', 'error');

    document.getElementById('rep-list').innerHTML = '<div class="loader"><div class="spinner"></div><span>درحال تحلیل...</span></div>';

    const res = await apiFetch(`${API}/reports/generate?start=${s}&end=${e}`);
    const data = await res.json();

    if (data.length === 0) {
        document.getElementById('rep-list').innerHTML = '<div class="empty-state">قطعی‌ای یافت نشد</div>';
        return;
    }

    const max = Math.max(...data.map(i => i.mins));
    document.getElementById('rep-list').innerHTML = data.map(i => {
        const pct = Math.min(100, (i.mins / max) * 100);
        return `<div class="report-item">
            <div class="report-item-header">
                <span class="report-item-name">${i.name}</span>
                <span class="report-item-value">${i.mins} دقیقه</span>
            </div>
            <div class="report-bar">
                <div class="report-bar-fill" style="width:${pct}%"></div>
            </div>
        </div>`;
    }).join('');
}

function toggleReportSection(forceHeatmap = null) {
    const listSection = document.getElementById('report-list-section');
    const heatmapSection = document.getElementById('report-heatmap-section');
    const toggleBtn = document.getElementById('btn-toggle-heatmap');

    const currentlyHidden = heatmapSection.classList.contains('hidden');
    const showHeatmap = forceHeatmap === null ? currentlyHidden : forceHeatmap;

    listSection.classList.toggle('hidden', showHeatmap);
    heatmapSection.classList.toggle('hidden', !showHeatmap);

    toggleBtn.textContent = showHeatmap ? 'گزارش قطعی' : 'نقشه حرارتی';
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    nav('summ');
    connectWS();
});

function setConnectionStatus(connected) {
    const el = document.getElementById('header-status');
    const warningEl = document.getElementById('connection-warning');
    if (warningEl) {
        if (connected) {
            warningEl.classList.add('hidden');
        } else {
            warningEl.classList.remove('hidden');
        }
    }
    if (!el) return;
    const dot = el.querySelector('.pulse-dot');
    const label = el.querySelector('span:last-child');
    if (connected) {
        el.classList.remove('disconnected');
        if (dot) dot.classList.remove('disconnected');
        if (label) label.textContent = 'فعال';
    } else {
        el.classList.add('disconnected');
        if (dot) dot.classList.add('disconnected');
        if (label) label.textContent = 'قطع اتصال';
    }
}

function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
        wsRetryDelay = 1000;
        setConnectionStatus(true);
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'cameras') {
            updateDashFromWS(msg.data);
        }
    };

    ws.onclose = () => {
        setConnectionStatus(false);
        setTimeout(connectWS, wsRetryDelay);
        wsRetryDelay = Math.min(wsRetryDelay * 2, 30000);
    };

    ws.onerror = () => ws.close();
}

function updateDashFromWS(cams) {
    const on = cams.filter(c => c.status === 'Online').length;
    const off = cams.filter(c => c.status !== 'Online');

    document.getElementById('s-tot').textContent = cams.length;
    document.getElementById('s-on').textContent = on;
    document.getElementById('s-off').textContent = off.length;

    const totEl = document.getElementById('tot');
    const onEl = document.getElementById('on');
    const offEl = document.getElementById('off');
    if (totEl) totEl.textContent = cams.length;
    if (onEl) onEl.textContent = on;
    if (offEl) offEl.textContent = off.length;

    if (off.length > 0) {
        document.getElementById('offline-section').classList.remove('hidden');
        document.getElementById('all-ok').classList.add('hidden');
        document.getElementById('offline-count').textContent = off.length;
        document.getElementById('offline-grid').innerHTML = off.map(c => createCard(c)).join('');
    } else {
        document.getElementById('offline-section').classList.add('hidden');
        document.getElementById('all-ok').classList.remove('hidden');
    }

    const groups = {};
    cams.forEach(c => { if (!groups[c.nvr_ip]) groups[c.nvr_ip] = []; groups[c.nvr_ip].push(c) });

    const con = document.getElementById('nvr-container');
    if (!con) return;
    con.innerHTML = '';

    Object.keys(groups).sort((a, b) => parseInt(getNvrNum(a)) - parseInt(getNvrNum(b))).forEach(ip => {
        const list = groups[ip];
        const sorted = list.sort((a, b) => parseInt(a.channel_id) - parseInt(b.channel_id));
        const cards = sorted.map(c => createCard(c)).join('');
        con.innerHTML += `
            <div class="nvr-block open">
                <div class="nvr-header" onclick="toggleNvr(this)">
                    <div class="nvr-header-left">
                        <span class="nvr-badge">${getNvrDisplayName(ip)}</span>
                        <span class="nvr-ip">${ip}</span>
                    </div>
                    <svg class="nvr-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <div class="nvr-grid">${cards}</div>
            </div>`;
    });
    if (map) updateMapMarkersFromWS(cams);
}

async function logout() {
    try {
        await apiFetch(`${API}/auth/logout`, { method: 'POST' });
    } catch (e) { }
    window.location.href = '/login';
}

// ===== MAP & HEATMAP LOGIC =====
let map = null;
let mapMarkers = [];
let mapEditMode = false;
let mapType = 'floor';
let mapImage = '';
let mapCamerasList = [];
let mapStartLat = 37.796067;
let mapStartLng = 45.062508;

async function initOrRefreshMap() {
    if (settingsCache.length === 0) {
        try {
            const sRes = await fetch(`${API}/settings`);
            settingsCache = await sRes.json();
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    const typeSet = settingsCache.find(s => s.key === 'MAP_TYPE');
    const imageSet = settingsCache.find(s => s.key === 'MAP_IMAGE');
    const latSet = settingsCache.find(s => s.key === 'MAP_START_LAT');
    const lngSet = settingsCache.find(s => s.key === 'MAP_START_LNG');

    mapType = typeSet ? typeSet.value : 'floor';
    mapImage = imageSet ? imageSet.value : '';
    mapStartLat = latSet ? parseFloat(latSet.value) : 37.796067;
    mapStartLng = lngSet ? parseFloat(lngSet.value) : 45.062508;

    document.getElementById('btn-map-floor').classList.toggle('active', mapType === 'floor');
    document.getElementById('btn-map-geo').classList.toggle('active', mapType === 'geo');
    document.getElementById('upload-plan-section').style.display = mapType === 'floor' ? 'block' : 'none';

    try {
        const res = await apiFetch(`${API}/cameras`);
        mapCamerasList = await res.json();
    } catch (e) {
        console.error('Failed to load cameras:', e);
    }

    setupLeafletMap();
    renderMapCameraList();
}

function setupLeafletMap() {
    let restoredCenter = null;
    let restoredZoom = null;

    const centerKeyLat = `map_center_lat_${mapType}`;
    const centerKeyLng = `map_center_lng_${mapType}`;
    const zoomKey = `map_zoom_${mapType}`;

    // 1. Save state before removing old map
    if (map) {
        const currentCenter = map.getCenter();
        restoredCenter = [currentCenter.lat, currentCenter.lng];
        restoredZoom = map.getZoom();

        localStorage.setItem(centerKeyLat, currentCenter.lat);
        localStorage.setItem(centerKeyLng, currentCenter.lng);
        localStorage.setItem(zoomKey, restoredZoom);

        map.remove();
        map = null;
    } else {
        // 2. Load from localStorage
        const localLat = localStorage.getItem(centerKeyLat);
        const localLng = localStorage.getItem(centerKeyLng);
        const localZoom = localStorage.getItem(zoomKey);

        if (localLat !== null && localLng !== null) {
            restoredCenter = [parseFloat(localLat), parseFloat(localLng)];
        }
        if (localZoom !== null) {
            restoredZoom = parseInt(localZoom);
        }
    }

    mapMarkers = [];
    const container = document.getElementById('map-canvas');
    if (!container) return;
    container.innerHTML = '';

    if (mapType === 'floor') {
        if (!mapImage) {
            container.innerHTML = `
                <div class="no-map-placeholder" role="img" aria-label="تصویر نقشه بارگذاری نشده است / Map image not uploaded">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <h3>تصویر نقشه بارگذاری نشده است</h3>
                    <p>لطفاً ابندا فایل نقشه را آپلود کنید.</p>
                </div>
            `;
            return;
        }

        map = L.map('map-canvas', {
            crs: L.CRS.Simple,
            minZoom: -2,
            maxZoom: 2,
            attributionControl: false
        });

        const img = new Image();
        img.onload = function () {
            const w = this.width;
            const h = this.height;
            window.mapImgWidth = w;
            window.mapImgHeight = h;
            const bounds = [[0, 0], [h, w]];
            L.imageOverlay(mapImage, bounds).addTo(map);

            if (restoredCenter !== null && restoredZoom !== null) {
                map.setView(restoredCenter, restoredZoom);
            } else {
                map.fitBounds(bounds);
            }

            drawCameraMarkers(bounds, w, h);
        };
        img.onerror = function () {
            container.innerHTML = `
                <div class="no-map-placeholder" role="img" aria-label="خطا در بارگذاری تصویر نقشه / Map image failed to load">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <h3>خطا در بارگذاری تصویر نقشه</h3>
                    <p>تصویر نقشه یافت نشد یا خراب است.</p>
                </div>
            `;
        };
        img.src = mapImage;

    } else {
        let center = [mapStartLat, mapStartLng];
        let zoom = 16;

        if (restoredCenter !== null && restoredZoom !== null) {
            center = restoredCenter;
            zoom = restoredZoom;
        } else {
            const validCams = mapCamerasList.filter(c => c.latitude !== null && c.longitude !== null);
            if (validCams.length > 0) {
                const latSum = validCams.reduce((sum, c) => sum + c.latitude, 0);
                const lngSum = validCams.reduce((sum, c) => sum + c.longitude, 0);
                center = [latSum / validCams.length, lngSum / validCams.length];
            }
        }

        map = L.map('map-canvas', {
            center: center,
            zoom: zoom,
            attributionControl: false
        });

        L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 20
        }).addTo(map);

        drawCameraMarkers();
    }

    // 3. Listen to map movements to update localStorage
    map.on('moveend', () => {
        if (map) {
            const c = map.getCenter();
            localStorage.setItem(centerKeyLat, c.lat);
            localStorage.setItem(centerKeyLng, c.lng);
        }
    });

    map.on('zoomend', () => {
        if (map) {
            localStorage.setItem(zoomKey, map.getZoom());
        }
    });
}

function getFovPolygonPoints(centerLatLng, radius, angle, spread) {
    const centerY = centerLatLng.lat !== undefined ? centerLatLng.lat : centerLatLng[0];
    const centerX = centerLatLng.lng !== undefined ? centerLatLng.lng : centerLatLng[1];

    const startAngle = angle - (spread / 2);
    const endAngle = angle + (spread / 2);

    const points = [[centerY, centerX]];
    const numPoints = 24;
    for (let i = 0; i <= numPoints; i++) {
        const currAngleDeg = startAngle + (endAngle - startAngle) * (i / numPoints);
        const angleRad = ((90 - currAngleDeg) * Math.PI) / 180;
        const x = centerX + radius * Math.cos(angleRad);
        const y = centerY + radius * Math.sin(angleRad);
        points.push([y, x]);
    }
    points.push([centerY, centerX]);
    return points;
}

function getFovPolygonPointsGeo(centerLatLng, radiusMeters, angle, spread) {
    const centerLat = centerLatLng.lat !== undefined ? centerLatLng.lat : centerLatLng[0];
    const centerLng = centerLatLng.lng !== undefined ? centerLatLng.lng : centerLatLng[1];

    const startAngle = angle - (spread / 2);
    const endAngle = angle + (spread / 2);

    const points = [[centerLat, centerLng]];
    const earthRadius = 6378137; // in meters
    const numPoints = 24;

    for (let i = 0; i <= numPoints; i++) {
        const currAngleDeg = startAngle + (endAngle - startAngle) * (i / numPoints);
        const bearingRad = (currAngleDeg * Math.PI) / 180;

        const dDivR = radiusMeters / earthRadius;
        const latRad = (centerLat * Math.PI) / 180;
        const lngRad = (centerLng * Math.PI) / 180;

        const destLatRad = Math.asin(
            Math.sin(latRad) * Math.cos(dDivR) +
            Math.cos(latRad) * Math.sin(dDivR) * Math.cos(bearingRad)
        );
        const destLngRad = lngRad + Math.atan2(
            Math.sin(bearingRad) * Math.sin(dDivR) * Math.cos(latRad),
            Math.cos(dDivR) - Math.sin(latRad) * Math.sin(destLatRad)
        );

        points.push([
            (destLatRad * 180) / Math.PI,
            (destLngRad * 180) / Math.PI
        ]);
    }
    points.push([centerLat, centerLng]);
    return points;
}

function calculateFovPoints(c, latlng) {
    const angle = c.fov_angle || 0;
    const radius = c.fov_radius || 50;
    const spread = c.fov_spread || 60;

    if (mapType === 'floor') {
        return getFovPolygonPoints(latlng, radius, angle, spread);
    } else {
        return getFovPolygonPointsGeo(latlng, radius, angle, spread);
    }
}

function getMarkerPopupContent(c) {
    const statusText = c.status === 'Online' ? 'متصل' : 'قطع';
    const isFovEnabled = c.fov_angle != null && c.fov_radius != null;

    return `
        <div class="marker-popup-content" style="direction: rtl; text-align: right; min-width: 220px; font-family: Vazirmatn, sans-serif;">
            <strong style="font-size: 14px; display:block; margin-bottom: 4px; color: var(--text);">${c.name}</strong>
            <p style="margin: 2px 0; font-size: 11px; color: var(--text-secondary);"><b>NVR:</b> ${c.nvr_ip}</p>
            <p style="margin: 2px 0; font-size: 11px; color: var(--text-secondary);"><b>کانال:</b> ${c.channel_id}</p>
            <p style="margin: 2px 0; font-size: 11px; color: var(--text-secondary);"><b>IP:</b> ${c.ip}</p>
            <p style="margin: 4px 0 0; font-size: 11px; color: var(--text-secondary);"><b>وضعیت:</b> <span style="color: ${c.status === 'Online' ? 'var(--success)' : 'var(--danger)'}; font-weight: bold">${statusText}</span></p>
            
            <hr style="border: 0; border-top: 1px solid var(--border); margin: 8px 0;">
            
            <!-- FOV Toggle -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 12px; font-weight: 500; color: var(--text);">محدوده دید (FOV)</span>
                <label class="toggle" style="transform: scale(0.8); margin: 0; padding: 0; display: inline-block;">
                    <input type="checkbox" id="popup-fov-enable-${c.id}" ${isFovEnabled ? 'checked' : ''} onchange="toggleMarkerFov(${c.id}, this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>
            
            <!-- FOV Sliders -->
            <div id="popup-fov-sliders-${c.id}" style="display: ${isFovEnabled ? 'block' : 'none'}; margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px;">
                <div style="margin-bottom: 8px;">
                    <div style="display:flex; justify-content:space-between; font-size: 11px; color: var(--text-secondary);">
                        <span>جهت زاویه</span>
                        <span id="lbl-angle-${c.id}" style="color: var(--primary-hover); font-weight: bold;">${c.fov_angle || 0}°</span>
                    </div>
                    <input type="range" min="0" max="360" value="${c.fov_angle || 0}" style="width: 100%; accent-color: var(--primary);" oninput="updateMarkerFovVal(${c.id}, 'angle', this.value)">
                </div>
                <div style="margin-bottom: 8px;">
                    <div style="display:flex; justify-content:space-between; font-size: 11px; color: var(--text-secondary);">
                        <span>برد (شعاع)</span>
                        <span id="lbl-radius-${c.id}" style="color: var(--primary-hover); font-weight: bold;">${c.fov_radius || 50}</span>
                    </div>
                    <input type="range" min="5" max="500" value="${c.fov_radius || 50}" style="width: 100%; accent-color: var(--primary);" oninput="updateMarkerFovVal(${c.id}, 'radius', this.value)">
                </div>
                <div style="margin-bottom: 8px;">
                    <div style="display:flex; justify-content:space-between; font-size: 11px; color: var(--text-secondary);">
                        <span>زاویه بازشو</span>
                        <span id="lbl-spread-${c.id}" style="color: var(--primary-hover); font-weight: bold;">${c.fov_spread || 60}°</span>
                    </div>
                    <input type="range" min="10" max="180" value="${c.fov_spread || 60}" style="width: 100%; accent-color: var(--primary);" oninput="updateMarkerFovVal(${c.id}, 'spread', this.value)">
                </div>
            </div>
            
            <!-- Remove from Map Button -->
            <button onclick="removeCameraFromMap(${c.id})" style="
                width: 100%;
                margin-top: 8px;
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid var(--danger);
                color: #ff8080;
                border-radius: 6px;
                padding: 6px;
                font-size: 11px;
                font-family: Vazirmatn, sans-serif;
                cursor: pointer;
                transition: background 0.2s;
            " onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'">
                حذف از نقشه
            </button>
        </div>
    `;
}

let fovSaveTimers = {};
function saveFovDebounced(id, angle, radius, spread) {
    if (fovSaveTimers[id]) {
        clearTimeout(fovSaveTimers[id]);
    }
    fovSaveTimers[id] = setTimeout(async () => {
        try {
            await fetch(`${API}/cameras/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fov_angle: angle,
                    fov_radius: radius,
                    fov_spread: spread
                })
            });
        } catch (e) {
            console.error('Failed to auto-save FOV settings:', e);
        }
    }, 500);
}

async function toggleMarkerFov(id, enabled) {
    const c = mapCamerasList.find(cam => cam.id === id);
    if (!c) return;

    const slidersBlock = document.getElementById(`popup-fov-sliders-${id}`);
    const marker = mapMarkers.find(m => m.camera_id === id);

    if (enabled) {
        c.fov_angle = 0;
        c.fov_radius = mapType === 'floor' ? 80 : 50;
        c.fov_spread = 60;

        if (slidersBlock) slidersBlock.style.display = 'block';

        if (marker) {
            if (marker.fovPolygon) {
                map.removeLayer(marker.fovPolygon);
            }
            const pts = calculateFovPoints(c, marker.getLatLng());
            marker.fovPolygon = L.polygon(pts, {
                color: '#f43f5e',
                fillColor: '#f43f5e',
                fillOpacity: 0.3,
                weight: 1
            }).addTo(map);
        }
    } else {
        c.fov_angle = null;
        c.fov_radius = null;
        c.fov_spread = null;

        if (slidersBlock) slidersBlock.style.display = 'none';

        if (marker && marker.fovPolygon) {
            map.removeLayer(marker.fovPolygon);
            marker.fovPolygon = null;
        }
    }

    await apiFetch(`${API}/cameras/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fov_angle: c.fov_angle,
            fov_radius: c.fov_radius,
            fov_spread: c.fov_spread
        })
    });
}

function updateMarkerFovVal(id, field, value) {
    const c = mapCamerasList.find(cam => cam.id === id);
    if (!c) return;

    const val = parseFloat(value);

    if (field === 'angle') {
        c.fov_angle = val;
        const lbl = document.getElementById(`lbl-angle-${id}`);
        if (lbl) lbl.textContent = `${val}°`;
    } else if (field === 'radius') {
        c.fov_radius = val;
        const lbl = document.getElementById(`lbl-radius-${id}`);
        if (lbl) lbl.textContent = val;
    } else if (field === 'spread') {
        c.fov_spread = val;
        const lbl = document.getElementById(`lbl-spread-${id}`);
        if (lbl) lbl.textContent = `${val}°`;
    }

    const marker = mapMarkers.find(m => m.camera_id === id);
    if (marker && marker.fovPolygon) {
        const pts = calculateFovPoints(c, marker.getLatLng());
        marker.fovPolygon.setLatLngs(pts);
    }

    saveFovDebounced(id, c.fov_angle, c.fov_radius, c.fov_spread);
}

async function removeCameraFromMap(id) {
    if (!confirm('آیا از حذف این دوربین از نقشه مطمئن هستید؟')) return;

    const c = mapCamerasList.find(cam => cam.id === id);
    if (!c) return;

    c.x_pos = null;
    c.y_pos = null;
    c.latitude = null;
    c.longitude = null;
    c.fov_angle = null;
    c.fov_radius = null;
    c.fov_spread = null;

    const markerIndex = mapMarkers.findIndex(m => m.camera_id === id);
    if (markerIndex !== -1) {
        const marker = mapMarkers[markerIndex];
        if (marker.fovPolygon) {
            map.removeLayer(marker.fovPolygon);
        }
        map.removeLayer(marker);
        mapMarkers.splice(markerIndex, 1);
    }

    try {
        await apiFetch(`${API}/cameras/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                x_pos: null,
                y_pos: null,
                latitude: null,
                longitude: null,
                fov_angle: null,
                fov_radius: null,
                fov_spread: null
            })
        });
        showToast('دوربین از نقشه حذف شد');
        renderMapCameraList();
    } catch (e) {
        showToast('خطا در حذف دوربین: ' + e.message, 'error');
    }
}

function createMarkerForMap(c, latlng) {
    const statusClass = c.status === 'Online' ? 'online' : (c.status === 'Offline' ? 'offline' : 'unknown');
    const markerHtml = `
        <div class="cam-marker ${statusClass}" id="marker-cam-${c.id}">
            <div class="cam-marker-dot"></div>
        </div>`;

    const icon = L.divIcon({
        html: markerHtml,
        className: 'custom-div-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    let fovPolygon = null;
    if (c.fov_angle != null && c.fov_radius != null) {
        const pts = calculateFovPoints(c, latlng);
        fovPolygon = L.polygon(pts, {
            color: '#f43f5e',
            fillColor: '#f43f5e',
            fillOpacity: 0.3,
            weight: 1
        }).addTo(map);
    }

    const marker = L.marker(latlng, {
        icon: icon,
        draggable: mapEditMode
    }).addTo(map);
    marker.camera_id = c.id;
    marker.fovPolygon = fovPolygon;

    marker.bindPopup(getMarkerPopupContent(c));

    marker.on('drag', function (e) {
        if (marker.fovPolygon) {
            const position = marker.getLatLng();
            const pts = calculateFovPoints(c, position);
            marker.fovPolygon.setLatLngs(pts);
        }
    });

    marker.on('dragend', async function (e) {
        const position = marker.getLatLng();
        let payload = {};

        if (mapType === 'floor') {
            const w = window.mapImgWidth || 800;
            const h = window.mapImgHeight || 600;
            const xPct = (position.lng / w) * 100;
            const yPct = 100 - ((position.lat / h) * 100);
            payload = {
                x_pos: Math.max(0, Math.min(100, xPct)),
                y_pos: Math.max(0, Math.min(100, yPct))
            };
            c.x_pos = payload.x_pos;
            c.y_pos = payload.y_pos;
        } else {
            payload = {
                latitude: position.lat,
                longitude: position.lng
            };
            c.latitude = payload.latitude;
            c.longitude = payload.longitude;
        }

        await apiFetch(`${API}/cameras/${c.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast(`موقعیت دوربین "${c.name}" ذخیره شد`);
    });

    mapMarkers.push(marker);
    return marker;
}

function drawCameraMarkers(bounds = null, w = 1, h = 1) {
    mapMarkers.forEach(m => {
        if (m.fovPolygon) {
            map.removeLayer(m.fovPolygon);
        }
        map.removeLayer(m);
    });
    mapMarkers = [];

    mapCamerasList.forEach(c => {
        let latlng = null;

        if (mapType === 'floor') {
            if (c.x_pos === null || c.y_pos === null) return;
            const x = (c.x_pos * w) / 100;
            const y = ((100 - c.y_pos) * h) / 100;
            latlng = [y, x];
        } else {
            if (c.latitude === null || c.longitude === null) return;
            latlng = [c.latitude, c.longitude];
        }

        createMarkerForMap(c, latlng);
    });
}

function updateMapMarkersFromWS(cams) {
    if (!map || mapEditMode) return;
    mapCamerasList = cams;

    cams.forEach(c => {
        const markerEl = document.getElementById(`marker-cam-${c.id}`);
        if (markerEl) {
            const statusClass = c.status === 'Online' ? 'online' : (c.status === 'Offline' ? 'offline' : 'unknown');
            markerEl.className = `cam-marker ${statusClass}`;
        }
    });
    renderMapCameraList();
}

async function setMapType(type) {
    if (type === mapType) return;
    mapType = type;

    await apiFetch(`${API}/settings/MAP_TYPE`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'MAP_TYPE', value: type })
    });

    const s = settingsCache.find(sett => sett.key === 'MAP_TYPE');
    if (s) s.value = type;

    initOrRefreshMap();
}

function toggleMapEditMode() {
    mapEditMode = !mapEditMode;
    const btn = document.getElementById('btn-edit-positions');
    const guide = document.getElementById('map-edit-guide');

    if (mapEditMode) {
        btn.classList.add('active');
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:8px"><path d="M20 6L9 17l-5-5"/></svg>
            تایید موقعیت‌ها
        `;
        if (guide) guide.style.display = 'block';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:8px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            ویرایش مکان دوربین‌ها
        `;
        if (guide) guide.style.display = 'none';
    }

    setupLeafletMap();
}

async function uploadMapImage(input) {
    if (!input.files || !input.files[0]) return;

    const formData = new FormData();
    formData.append('file', input.files[0]);

    showToast('در حال آپلود...');
    try {
        const res = await fetch(`${API}/map/upload`, {
            method: 'POST',
            body: formData
        });

        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || 'Upload failed');
        }

        const data = await res.json();
        showToast('تصویر پلان با موفقیت آپلود شد');

        const s = settingsCache.find(sett => sett.key === 'MAP_IMAGE');
        if (s) s.value = data.url;

        mapImage = data.url;
        initOrRefreshMap();
    } catch (e) {
        showToast('خطا در آپلود پلان: ' + e.message, 'error');
    }
}

async function fetchAndRenderHeatmap() {
    const hoursLabels = document.getElementById('heatmap-hours-labels');
    const gridCells = document.getElementById('heatmap-grid-cells');
    if (!hoursLabels || !gridCells) return;

    hoursLabels.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        const hStr = h.toString().padStart(2, '0');
        hoursLabels.innerHTML += `<div>${hStr}</div>`;
    }

    try {
        const res = await apiFetch(`${API}/stats/heatmap`);
        const data = await res.json();

        const lookup = {};
        data.forEach(item => {
            lookup[`${item.day}-${item.hour}`] = item.value;
        });

        const dayOrder = [5, 6, 0, 1, 2, 3, 4];
        const dayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

        gridCells.innerHTML = '';

        dayOrder.forEach((pyDay, index) => {
            const dayName = dayNames[index];
            for (let h = 0; h < 24; h++) {
                const value = lookup[`${pyDay}-${h}`] || 0;

                let level = 0;
                if (value > 0 && value <= 15) level = 1;
                else if (value > 15 && value <= 60) level = 2;
                else if (value > 60 && value <= 360) level = 3;
                else if (value > 360) level = 4;

                const timeRange = `${h.toString().padStart(2, '0')}:00 تا ${(h + 1).toString().padStart(2, '0')}:00`;
                let tooltipText = `${dayName}، ساعت ${timeRange}<br>قطعی: بدون قطعی`;
                if (value > 0) {
                    if (value >= 60) {
                        const hrs = (value / 60).toFixed(1);
                        tooltipText = `${dayName}، ساعت ${timeRange}<br>قطعی: ${hrs} ساعت`;
                    } else {
                        tooltipText = `${dayName}، ساعت ${timeRange}<br>قطعی: ${value} دقیقه`;
                    }
                }

                gridCells.innerHTML += `
                    <div class="heatmap-cell level-${level}">
                        <div class="heatmap-tooltip">${tooltipText}</div>
                    </div>`;
            }
        });

    } catch (e) {
        console.error('Heatmap render error:', e);
    }
}

function renderMapCameraList() {
    const container = document.getElementById('map-camera-list');
    if (!container) return;

    const searchVal = (document.getElementById('mapCameraSearch')?.value || '').toLowerCase();

    // Sort alphabetically by name
    const sorted = [...mapCamerasList].sort((a, b) => a.name.localeCompare(b.name, 'fa'));

    // Filter by search query
    const filtered = sorted.filter(c =>
        c.name.toLowerCase().includes(searchVal) ||
        c.ip.includes(searchVal) ||
        c.channel_id.toString().includes(searchVal)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 11px;">دوربینی یافت نشد</div>';
        return;
    }

    container.innerHTML = filtered.map(c => {
        const hasLoc = mapType === 'floor' ? (c.x_pos !== null && c.y_pos !== null) : (c.latitude !== null && c.longitude !== null);
        const dotClass = c.status === 'Online' ? 'online' : (c.status === 'Offline' ? 'offline' : 'unknown');

        if (hasLoc) {
            return `
                <div class="map-cam-item" onclick="focusCameraOnMap(${c.id})">
                    <div class="map-cam-name-wrap">
                        <span class="map-cam-dot ${dotClass}"></span>
                        <span class="map-cam-name" title="${c.name}">${c.name}</span>
                    </div>
                    <span class="map-cam-badge">CH ${c.channel_id}</span>
                </div>
            `;
        } else {
            return `
                <div class="map-cam-item unpositioned" style="cursor: default; display: flex; justify-content: space-between; align-items: center; padding: 8px 10px;">
                    <div class="map-cam-name-wrap" style="opacity: 0.6; display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1;">
                        <span class="map-cam-dot unknown"></span>
                        <span class="map-cam-name" title="${c.name}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${c.name}</span>
                    </div>
                    <div class="map-cam-actions" style="display: flex; gap: 6px; flex-shrink: 0;">
                        <!-- Add as Simple Dot -->
                        <button onclick="addCameraToCenter(${c.id}, false); event.stopPropagation();" title="افزودن به عنوان نقطه ساده" style="
                            background: rgba(99, 102, 241, 0.15);
                            border: 1px solid var(--primary);
                            color: var(--primary-hover);
                            border-radius: 4px;
                            width: 24px;
                            height: 24px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            cursor: pointer;
                            transition: var(--transition);
                        ">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="6"/>
                            </svg>
                        </button>
                        <!-- Add with Field of View -->
                        <button onclick="addCameraToCenter(${c.id}, true); event.stopPropagation();" title="افزودن با زاویه دید (FOV)" style="
                            background: rgba(244, 63, 94, 0.15);
                            border: 1px solid #f43f5e;
                            color: #fb7185;
                            border-radius: 4px;
                            width: 24px;
                            height: 24px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            cursor: pointer;
                            transition: var(--transition);
                        ">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                <path d="M12 21 L3 5 A11 11 0 0 1 21 5 Z" fill="rgba(244, 63, 94, 0.3)"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }
    }).join('');
}

function filterMapCamerasList() {
    renderMapCameraList();
}

function focusCameraOnMap(id) {
    if (!map) return;
    const marker = mapMarkers.find(m => m.camera_id === id);
    if (marker) {
        const latlng = marker.getLatLng();
        map.flyTo(latlng, map.getZoom());
        marker.openPopup();
    } else {
        showToast('این دوربین در نقشه یافت نشد', 'error');
    }
}

async function addCameraToCenter(id, hasFov) {
    if (!map) return;
    const c = mapCamerasList.find(cam => cam.id === id);
    if (!c) return;

    let payload = {};
    let latlng = null;
    const center = map.getCenter();

    if (mapType === 'floor') {
        const w = window.mapImgWidth || 800;
        const h = window.mapImgHeight || 600;

        const xPct = (center.lng / w) * 100;
        const yPct = 100 - ((center.lat / h) * 100);

        payload = {
            x_pos: Math.max(0, Math.min(100, xPct)),
            y_pos: Math.max(0, Math.min(100, yPct))
        };
        c.x_pos = payload.x_pos;
        c.y_pos = payload.y_pos;
        latlng = [center.lat, center.lng];
    } else {
        payload = {
            latitude: center.lat,
            longitude: center.lng
        };
        c.latitude = payload.latitude;
        c.longitude = payload.longitude;
        latlng = [center.lat, center.lng];
    }

    if (hasFov) {
        payload.fov_angle = 0;
        payload.fov_radius = mapType === 'floor' ? 80 : 50;
        payload.fov_spread = 60;

        c.fov_angle = payload.fov_angle;
        c.fov_radius = payload.fov_radius;
        c.fov_spread = payload.fov_spread;
    } else {
        payload.fov_angle = null;
        payload.fov_radius = null;
        payload.fov_spread = null;

        c.fov_angle = null;
        c.fov_radius = null;
        c.fov_spread = null;
    }

    try {
        await apiFetch(`${API}/cameras/${c.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast(`دوربین "${c.name}" به مرکز نقشه اضافه شد`);

        // Dynamically add marker without resetting the map
        const marker = createMarkerForMap(c, latlng);

        // Re-render the sidebar list to update buttons without modifying map position
        renderMapCameraList();

        // Open the marker's popup immediately
        marker.openPopup();
    } catch (e) {
        showToast('خطا در ذخیره موقعیت: ' + e.message, 'error');
    }
}
