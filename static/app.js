const API = '/api';
let logOff = 0, logFilter = '', logSearchVal = '', loading = false, allLoaded = false;
let currentCamId, currentImp, settingsCache = [], nvrCache = [], groupCache = [];
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
    const img = document.getElementById('m-snap-img');
    if (img) img.src = '';
    const container = document.getElementById('m-snap-container');
    if (container) container.style.display = 'none';
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
    try {
        const gRes = await apiFetch(`${API}/groups`);
        groupCache = await gRes.json();
    } catch (e) {
        console.error('Error loading Groups:', e);
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

    // Map of group_id to list of NVR IPs
    const groupNVRs = {};
    const groupMap = {};
    groupCache.forEach(g => {
        groupMap[g.id] = g.name;
        groupNVRs[g.id] = [];
    });
    const unassignedNvrIps = [];

    Object.keys(groups).sort((a, b) => parseInt(getNvrNum(a)) - parseInt(getNvrNum(b))).forEach(ip => {
        const nvrObj = nvrCache.find(n => n.ip === ip);
        const groupId = nvrObj ? nvrObj.group_id : null;
        if (groupId && groupMap[groupId]) {
            if (!groupNVRs[groupId]) groupNVRs[groupId] = [];
            groupNVRs[groupId].push(ip);
        } else {
            unassignedNvrIps.push(ip);
        }
    });

    // Render grouped factories
    groupCache.forEach(g => {
        const ips = groupNVRs[g.id] || [];
        if (ips.length === 0) return;

        let factoryHtml = `<div class="factory-group-section" style="margin-bottom: 30px;">
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid var(--primary); display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary);"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                ${g.name}
                ${g.description ? `<span style="font-size: 12px; font-weight: normal; color: var(--text-secondary); margin-right: 8px;">(${g.description})</span>` : ''}
            </div>
            <div style="display: grid; grid-template-columns: 1fr; gap: 15px;">`;

        ips.forEach(ip => {
            const list = groups[ip];
            const sorted = list.sort((a, b) => parseInt(a.channel_id) - parseInt(b.channel_id));
            const cards = sorted.map(c => createCard(c)).join('');
            factoryHtml += `
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

        factoryHtml += `</div></div>`;
        con.innerHTML += factoryHtml;
    });

    // Render unassigned NVRs
    if (unassignedNvrIps.length > 0) {
        let unassignedHtml = `<div class="factory-group-section" style="margin-bottom: 30px;">
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid var(--border); display: flex; align-items: center; gap: 8px; color: var(--text-secondary);">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary);"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                سایر NVRها (بدون دسته‌بندی کارخانه‌ای)
            </div>
            <div style="display: grid; grid-template-columns: 1fr; gap: 15px;">`;

        unassignedNvrIps.forEach(ip => {
            const list = groups[ip];
            const sorted = list.sort((a, b) => parseInt(a.channel_id) - parseInt(b.channel_id));
            const cards = sorted.map(c => createCard(c)).join('');
            unassignedHtml += `
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

        unassignedHtml += `</div></div>`;
        con.innerHTML += unassignedHtml;
    }
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

function formatShamsiDate(dateInput) {
    if (!dateInput) return 'نامشخص';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'نامشخص';
    
    const formatter = new Intl.DateTimeFormat('fa-IR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    
    try {
        const parts = formatter.formatToParts(date);
        const partMap = {};
        parts.forEach(p => partMap[p.type] = p.value);
        
        let weekday = partMap.weekday;
        if (weekday === 'پنجشنبه') weekday = 'پنج‌شنبه';
        else if (weekday === 'یکشنبه') weekday = 'یک‌شنبه';
        else if (weekday === 'سه شنبه' || weekday === 'سه‌شنبه') weekday = 'سه‌شنبه';
        
        return `${weekday} ${partMap.day} ${partMap.month} ${partMap.hour}:${partMap.minute}`;
    } catch (e) {
        return date.toLocaleString('fa-IR');
    }
}

async function showCam(data) {
    const c = JSON.parse(decodeURIComponent(data));
    currentCamId = c.id;
    currentImp = c.importance;

    // Load cached snapshot
    const snapContainer = document.getElementById('m-snap-container');
    const snapImg = document.getElementById('m-snap-img');
    const snapLoader = document.getElementById('m-snap-loader');
    
    snapContainer.style.display = 'block';
    snapLoader.style.display = 'none';
    snapImg.style.display = 'block';
    snapImg.src = `/static/snapshots/camera_${c.id}.jpg?t=${new Date().getTime()}`;
    snapImg.onerror = () => {
        snapContainer.style.display = 'none';
    };

    document.getElementById('m-name').textContent = c.name;
    document.getElementById('m-nvr').textContent = c.nvr_ip;
    document.getElementById('m-det').textContent = `${c.ip} (CH ${c.channel_id})`;
    document.getElementById('m-imp').textContent = ['کم', 'عادی', 'مهم'][c.importance - 1];
    
    // Populate specs & recording stats
    document.getElementById('m-model').textContent = c.model || 'نامشخص';
    
    const recConfigEl = document.getElementById('m-rec-config');
    if (c.recording_scheduled === true) {
        const typeStr = c.recording_schedule_type ? ` (${c.recording_schedule_type})` : '';
        recConfigEl.textContent = `فعال${typeStr}`;
        recConfigEl.style.color = '#28a745';
    } else if (c.recording_scheduled === false) {
        recConfigEl.textContent = 'غیرفعال';
        recConfigEl.style.color = '#dc3545';
    } else {
        recConfigEl.textContent = 'نامشخص';
        recConfigEl.style.color = '';
    }
    
    let rec24hText = 'نامشخص';
    if (c.recording_hours_24h !== null) {
        const totalSeconds = Math.round(c.recording_hours_24h * 3600);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        rec24hText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    document.getElementById('m-rec-24h').textContent = rec24hText;
    
    if (c.oldest_record) {
        document.getElementById('m-oldest').textContent = formatShamsiDate(c.oldest_record);
    } else {
        document.getElementById('m-oldest').textContent = 'نامشخص';
    }
    
    document.getElementById('m-size').textContent = c.total_record_size_gb !== null ? `${c.total_record_size_gb} GB` : 'نامشخص';
    
    if (c.total_record_duration_hours !== null) {
        const hrs = c.total_record_duration_hours;
        if (hrs >= 24) {
            document.getElementById('m-duration').textContent = `${(hrs / 24).toFixed(1)} روز (${hrs} ساعت)`;
        } else {
            document.getElementById('m-duration').textContent = `${hrs} ساعت`;
        }
    } else {
        document.getElementById('m-duration').textContent = 'نامشخص';
    }
    
    document.getElementById('camModal').classList.add('open');
    const impBtn = document.getElementById('m-imp-btn');
    if (impBtn) {
        impBtn.style.display = (window.currentUser && window.currentUser.role === 'group_view') ? 'none' : '';
    }

    const res = await apiFetch(`${API}/stats/${c.id}`);
    const s = await res.json();
    document.getElementById('m-d1').textContent = s.down_1h + ' دقیقه';
    document.getElementById('m-d24').textContent = s.down_24h + ' دقیقه';
}

function playLiveStream() {
    window.open(`/api/cameras/${currentCamId}/stream`, '_blank');
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
    const role = window.currentUser ? window.currentUser.role : 'group_view';
    if (role === 'admin') {
        const sRes = await apiFetch(`${API}/settings`);
        settingsCache = await sRes.json();
    } else {
        settingsCache = [];
    }

    const nav = document.getElementById('config-nav');
    if (role === 'admin') {
        nav.innerHTML = `
            <button data-tab="sec-nvr" onclick="switchSettingsTab('sec-nvr')">NVRها</button>
            <button data-tab="sec-groups" onclick="switchSettingsTab('sec-groups')">کارخانه‌ها / گروه‌ها</button>
            <button data-tab="sec-users" onclick="switchSettingsTab('sec-users')">مدیریت کاربران</button>
            <button data-tab="grp-Email" onclick="switchSettingsTab('grp-Email')">تنظیمات ایمیل</button>
            <button data-tab="grp-Telegram" onclick="switchSettingsTab('grp-Telegram')">تنظیمات تلگرام</button>
            <button data-tab="grp-Browser" onclick="switchSettingsTab('grp-Browser')">اعلان مرورگر</button>
            <button data-tab="sec-tasks" onclick="switchSettingsTab('sec-tasks')">وظایف زمان‌بندی‌شده</button>
            <button data-tab="sec-system" onclick="switchSettingsTab('sec-system')">کنترل سیستم</button>
            <button data-tab="sec-about" onclick="switchSettingsTab('sec-about')">درباره ما</button>
        `;
    } else if (role === 'group_control') {
        nav.innerHTML = `
            <button data-tab="sec-nvr" onclick="switchSettingsTab('sec-nvr')">NVRها</button>
            <button data-tab="sec-my-alerts" onclick="switchSettingsTab('sec-my-alerts')">تنظیمات اعلان شخصی من</button>
            <button data-tab="grp-Browser" onclick="switchSettingsTab('grp-Browser')">اعلان مرورگر</button>
            <button data-tab="sec-about" onclick="switchSettingsTab('sec-about')">درباره ما</button>
        `;
    } else if (role === 'group_view') {
        nav.innerHTML = `
            <button data-tab="sec-about" onclick="switchSettingsTab('sec-about')">درباره ما</button>
        `;
    }

    const nvrForm = document.querySelector('#sec-nvr .nvr-form');
    if (nvrForm) {
        nvrForm.style.display = (role === 'admin') ? '' : 'none';
    }

    const con = document.getElementById('config-forms');
    con.innerHTML = '';

    if (role === 'admin') {
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
    }

    try {
        const gRes = await apiFetch(`${API}/groups`);
        groupCache = await gRes.json();
    } catch (e) {
        console.error('Error loading groups:', e);
    }

    const nRes = await apiFetch(`${API}/nvrs`);
    const nvrs = await nRes.json();
    nvrCache = nvrs;
    pendingNVRDeletes = new Set();
    document.getElementById('nvr-list').innerHTML = nvrs.map(n =>
        renderNVRRow(n)
    ).join('');

    let defaultTab = 'sec-nvr';
    if (role === 'group_view') {
        defaultTab = 'sec-about';
    }
    const activeTab = document.querySelector('.settings-nav button.active')?.getAttribute('data-tab') || defaultTab;
    switchSettingsTab(activeTab);
}

function switchSettingsTab(tabId) {
    document.querySelectorAll('.settings-nav button').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    const tabs = ['sec-nvr', 'sec-groups', 'sec-users', 'sec-my-alerts', 'grp-Email', 'grp-Telegram', 'grp-Browser', 'sec-system', 'sec-tasks', 'sec-about'];
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = id === tabId ? 'block' : 'none';
        }
    });

    if (tabId === 'grp-Browser') {
        updateBrowserAlertsUI();
    }
    if (tabId === 'sec-groups') {
        renderGroupsList();
    }
    if (tabId === 'sec-users') {
        loadUsers();
    }
    if (tabId === 'sec-my-alerts') {
        loadMyAlerts();
    }
    if (tabId === 'sec-tasks') {
        loadScheduledTasks();
    }
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

    const role = window.currentUser ? window.currentUser.role : 'group_view';
    const currentGroupId = window.currentUser ? window.currentUser.group_id : null;
    const canEdit = role === 'admin' || (role === 'group_control' && n.group_id === currentGroupId);

    let groupSelectOrLabel = '';
    if (role === 'admin') {
        let options = `<option value="">بدون کارخانه (بدون گروه)</option>`;
        groupCache.forEach(g => {
            const selected = n.group_id === g.id ? 'selected' : '';
            options += `<option value="${g.id}" ${selected}>${g.name}</option>`;
        });
        groupSelectOrLabel = `<select class="form-input form-input-sm" style="margin-right: 12px; width: 160px; padding: 2px 8px; font-size:12px; height:28px" onchange="updateNVRGroup('${n.ip}', this.value)">${options}</select>`;
    } else {
        const group = groupCache.find(g => g.id === n.group_id);
        const groupName = group ? group.name : 'بدون کارخانه';
        groupSelectOrLabel = `<span style="margin-right: 12px; font-size: 12px; opacity: 0.8; color: var(--text-primary);">کارخانه: ${groupName}</span>`;
    }

    let actionBtns = '';
    if (canEdit || role === 'admin') {
        actionBtns += `<div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">`;
        if (canEdit) {
            actionBtns += `
                <button class="btn-icon" onclick="startEditNVR('${n.ip}')" style="width:28px; height:28px" title="ویرایش">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
                </button>
            `;
        }
        if (role === 'admin') {
            actionBtns += `
                <button class="btn-icon" onclick="delNVR('${n.ip}')" style="width:28px; height:28px" title="حذف">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            `;
        }
        actionBtns += `</div>`;
    }

    return `<div class="list-item" id="nvr-row-${escaped}" data-ip="${n.ip}">
        <div class="list-item-info">
            ${n.name ? `<strong style="margin-left: 8px; color: var(--text-primary);">${n.name}</strong>` : ''}
            <span class="list-item-ip">${n.ip}</span>
            <span class="list-item-user">(${n.user})</span>
            ${groupSelectOrLabel}
        </div>
        ${actionBtns}
    </div>`;
}

function renderGroupsList() {
    const list = document.getElementById('group-list');
    if (!list) return;
    list.innerHTML = groupCache.map(g => `
        <div class="list-item" id="group-row-${g.id}">
            <div class="list-item-info">
                <strong style="margin-left: 8px; color: var(--text-primary);">${g.name}</strong>
                <span class="list-item-user">${g.description || ''}</span>
            </div>
            <button class="btn-icon" onclick="deleteGroup(${g.id})" style="width:28px; height:28px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>
    `).join('');
}

async function addGroup() {
    const name = document.getElementById('groupName').value.trim();
    const desc = document.getElementById('groupDesc').value.trim();
    if (!name) return showToast('نام کارخانه الزامی است', 'error');

    try {
        await apiFetch(`${API}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc || null })
        });
        document.getElementById('groupName').value = '';
        document.getElementById('groupDesc').value = '';
        showToast('کارخانه با موفقیت اضافه شد');

        // Refresh groups
        const gRes = await apiFetch(`${API}/groups`);
        groupCache = await gRes.json();
        renderGroupsList();
    } catch (e) {
        showToast('خطا در افزودن کارخانه: ' + e.message, 'error');
    }
}

async function deleteGroup(id) {
    if (!confirm('آیا از حذف این کارخانه اطمینان دارید؟ NVRهای این کارخانه بدون گروه خواهند شد.')) return;
    try {
        await apiFetch(`${API}/groups/${id}`, { method: 'DELETE' });
        showToast('کارخانه حذف شد');

        // Refresh groups and reload settings (to refresh NVR dropdowns)
        const gRes = await apiFetch(`${API}/groups`);
        groupCache = await gRes.json();
        loadSettings();
    } catch (e) {
        showToast('خطا در حذف کارخانه: ' + e.message, 'error');
    }
}

async function updateNVRGroup(ip, groupId) {
    try {
        await apiFetch(`${API}/nvrs/${encodeURIComponent(ip)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId ? parseInt(groupId) : null })
        });
        showToast('کارخانه NVR به‌روزرسانی شد');

        // Update local nvrCache
        const nRes = await apiFetch(`${API}/nvrs`);
        nvrCache = await nRes.json();
    } catch (e) {
        showToast('خطا در به‌روزرسانی کارخانه NVR: ' + e.message, 'error');
    }
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

function startEditNVR(ip) {
    const n = nvrCache.find(n => n.ip === ip);
    if (!n) return;
    const escaped = ip.replace(/[^\w]/g, '_');
    const row = document.getElementById(`nvr-row-${escaped}`);
    if (!row) return;

    row.innerHTML = `
        <div style="display: flex; gap: 8px; align-items: center; width: 100%; flex-wrap: wrap;">
            <span class="list-item-ip" style="font-weight: bold; margin-left: 8px;">${n.ip}</span>
            <input class="form-input form-input-sm" id="edit-nvr-name-${escaped}" value="${n.name || ''}" placeholder="نام دلخواه" style="width: 140px; height: 28px; font-size: 12px; padding: 2px 8px;">
            <input class="form-input form-input-sm" id="edit-nvr-user-${escaped}" value="${n.user || ''}" placeholder="نام کاربری" style="width: 100px; height: 28px; font-size: 12px; padding: 2px 8px;">
            <input class="form-input form-input-sm" id="edit-nvr-pass-${escaped}" type="password" placeholder="رمز عبور جدید" style="width: 120px; height: 28px; font-size: 12px; padding: 2px 8px;">
            <button class="btn btn-primary" onclick="saveNVRRow('${n.ip}')" style="padding: 4px 10px; font-size: 12px; height: 28px;">ذخیره</button>
            <button class="btn" style="padding: 4px 10px; font-size: 12px; height: 28px; background: var(--surface-2); color: var(--text-secondary); border: 1px solid var(--border);" onclick="cancelEditNVR('${n.ip}')">انصراف</button>
        </div>
    `;
}

function cancelEditNVR(ip) {
    const n = nvrCache.find(n => n.ip === ip);
    if (!n) return;
    const escaped = ip.replace(/[^\w]/g, '_');
    const row = document.getElementById(`nvr-row-${escaped}`);
    if (row) {
        row.outerHTML = renderNVRRow(n, false);
    }
}

async function saveNVRRow(ip) {
    const escaped = ip.replace(/[^\w]/g, '_');
    const nameEl = document.getElementById(`edit-nvr-name-${escaped}`);
    const userEl = document.getElementById(`edit-nvr-user-${escaped}`);
    const passEl = document.getElementById(`edit-nvr-pass-${escaped}`);
    
    if (!userEl.value.trim()) {
        return showToast('نام کاربری الزامی است', 'error');
    }
    
    const payload = {
        name: nameEl.value.trim() || null,
        user: userEl.value.trim(),
    };
    
    if (passEl.value) {
        payload.password = passEl.value;
    }
    
    try {
        await apiFetch(`${API}/nvrs/${encodeURIComponent(ip)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast('NVR با موفقیت به‌روزرسانی شد');
        
        // Refresh local cache and UI
        const nRes = await apiFetch(`${API}/nvrs`);
        nvrCache = await nRes.json();
        
        const n = nvrCache.find(x => x.ip === ip);
        const row = document.getElementById(`nvr-row-${escaped}`);
        if (row && n) {
            row.outerHTML = renderNVRRow(n, false);
        }
    } catch (e) {
        showToast('خطا در به‌روزرسانی NVR: ' + e.message, 'error');
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
    toast.innerHTML = msg;
    document.body.appendChild(toast);
    
    const duration = type === 'error' ? 6000 : 2500;
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
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

// --- JALALI/GREGORIAN CONVERSIONS ---
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const MIN_JALAALI_YEAR = BREAKS[0];
const MAX_JALAALI_YEAR = BREAKS[BREAKS.length - 1] - 1;

function div(a, b) {
    return ~~(a / b);
}

function mod(a, b) {
    return a - ~~(a / b) * b;
}

function jalCalCore(jy) {
    if (!Number.isFinite(jy) || jy < MIN_JALAALI_YEAR || jy > MAX_JALAALI_YEAR) {
        throw new RangeError(`Invalid Jalaali year ${jy}`);
    }
    const gy = jy + 621;
    let leapJ = -14;
    let jp = BREAKS[0];
    let jm = 0;
    let jump = 0;
    for (let i = 1; i < BREAKS.length; i += 1) {
        jm = BREAKS[i];
        jump = jm - jp;
        if (jy < jm) break;
        leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
        jp = jm;
    }
    const n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    return {
        gy,
        march,
        jump,
        n
    };
}

function g2d(gy, gm, gd) {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
}

function d2g(jdn) {
    let j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(mod(j, 1461), 4) * 5 + 308;
    const gd = div(mod(i, 153), 5) + 1;
    const gm = mod(div(i, 153), 12) + 1;
    const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return {
        gy,
        gm,
        gd
    };
}

function jalCalShort(jy) {
    const { gy, march } = jalCalCore(jy);
    return {
        gy,
        march
    };
}

function j2d(jy, jm, jd) {
    const r = jalCalShort(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function jalaliToGregorian(jy, jm, jd) {
    const g = d2g(j2d(jy, jm, jd));
    return [g.gy, g.gm, g.gd];
}

function formatPersianDateTime(date) {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const getVal = (type) => parts.find(p => p.type === type).value;
    
    const year = getVal('year');
    const month = getVal('month');
    const day = getVal('day');
    let hour = getVal('hour');
    if (hour === '24') hour = '00';
    const minute = getVal('minute');
    
    return `${year}/${month}/${day} ${hour}:${minute}`;
}

function parsePersianDateTime(val) {
    if (!val) return null;
    const match = val.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (!match) return null;
    const jy = parseInt(match[1]);
    const jm = parseInt(match[2]);
    const jd = parseInt(match[3]);
    const hour = match[4] ? parseInt(match[4]) : 0;
    const minute = match[5] ? parseInt(match[5]) : 0;
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    return new Date(gy, gm - 1, gd, hour, minute, 0);
}

// --- REPORTS ---
function setPreset(h) {
    const end = new Date();
    const start = new Date(end.getTime() - (h * 60 * 60 * 1000));
    document.getElementById('startDt').value = formatPersianDateTime(start);
    document.getElementById('endDt').value = formatPersianDateTime(end);
}

async function genReport() {
    toggleReportSection(false);

    const startVal = document.getElementById('startDt').value;
    const endVal = document.getElementById('endDt').value;
    if (!startVal || !endVal) return showToast('محدوده زمانی را انتخاب کنید', 'error');

    const startDate = parsePersianDateTime(startVal);
    const endDate = parsePersianDateTime(endVal);
    if (!startDate || !endDate) return showToast('قالب تاریخ نامعتبر است', 'error');

    const s = startDate.getTime() / 1000;
    const e = endDate.getTime() / 1000;

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
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/auth/me');
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
    connectWS();
    initBrowserAlerts();
    checkAdminPasswordWarning();
});

function checkAdminPasswordWarning() {
    if (localStorage.getItem('admin_plain_password') === '1') {
        document.getElementById('securityWarningModal').classList.add('open');
    }
}

function closeSecurityWarning() {
    document.getElementById('securityWarningModal').classList.remove('open');
    localStorage.removeItem('admin_plain_password');
}

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
        } else if (msg.type === 'alert') {
            handleIncomingAlert(msg);
        } else if (msg.type === 'task_status') {
            handleTaskStatusUpdate(msg.data);
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

// ===== BROWSER ALERTS & SOUND SYNTHESIS =====
function initBrowserAlerts() {
    if (localStorage.getItem('BROWSER_ALERT_ENABLED') === null) localStorage.setItem('BROWSER_ALERT_ENABLED', 'false');
    if (localStorage.getItem('BROWSER_ALERT_MUTED') === null) localStorage.setItem('BROWSER_ALERT_MUTED', 'false');
    
    const categories = ['critical', 'recovery', 'warning'];
    categories.forEach(cat => {
        if (localStorage.getItem(`BROWSER_NOTIFY_${cat.toUpperCase()}_ENABLED`) === null) {
            localStorage.setItem(`BROWSER_NOTIFY_${cat.toUpperCase()}_ENABLED`, 'true');
        }
        if (localStorage.getItem(`BROWSER_SOUND_${cat.toUpperCase()}_ENABLED`) === null) {
            localStorage.setItem(`BROWSER_SOUND_${cat.toUpperCase()}_ENABLED`, 'true');
        }
    });

    updateBrowserAlertsUI();
}

function updateBrowserAlertsUI() {
    const elEnabled = document.getElementById('BROWSER_ALERT_ENABLED');
    const elMuted = document.getElementById('BROWSER_ALERT_MUTED');
    if (!elEnabled || !elMuted) return;

    elEnabled.checked = localStorage.getItem('BROWSER_ALERT_ENABLED') === 'true';
    elMuted.checked = localStorage.getItem('BROWSER_ALERT_MUTED') === 'true';

    const categories = ['critical', 'recovery', 'warning'];
    categories.forEach(cat => {
        const elNotify = document.getElementById(`BROWSER_NOTIFY_${cat.toUpperCase()}_ENABLED`);
        const elSound = document.getElementById(`BROWSER_SOUND_${cat.toUpperCase()}_ENABLED`);
        if (elNotify) elNotify.checked = localStorage.getItem(`BROWSER_NOTIFY_${cat.toUpperCase()}_ENABLED`) !== 'false';
        if (elSound) elSound.checked = localStorage.getItem(`BROWSER_SOUND_${cat.toUpperCase()}_ENABLED`) !== 'false';
    });

    const permissionEl = document.getElementById('browser-permission-status');
    if (permissionEl) {
        if (!("Notification" in window)) {
            permissionEl.textContent = "مرورگر شما از اعلان‌ها پشتیبانی نمی‌کند ❌";
            permissionEl.style.color = "var(--danger)";
            elEnabled.disabled = true;
            return;
        }

        if (Notification.permission === "granted") {
            permissionEl.textContent = "مجوز صادر شده است ✅";
            permissionEl.style.color = "var(--success)";
        } else if (Notification.permission === "denied") {
            permissionEl.textContent = "مجوز توسط شما مسدود شده است ❌";
            permissionEl.style.color = "var(--danger)";
        } else {
            permissionEl.textContent = "در انتظار درخواست مجوز... ⚠️";
            permissionEl.style.color = "var(--warning)";
        }
    }
}

async function toggleBrowserAlerts(checkbox) {
    if (checkbox.checked) {
        if (!("Notification" in window)) {
            showToast("این مرورگر از اعلان‌ها پشتیبانی نمی‌کند", "error");
            checkbox.checked = false;
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            localStorage.setItem('BROWSER_ALERT_ENABLED', 'true');
            showToast("اعلان‌های دسکتاپ فعال شدند");
        } else {
            localStorage.setItem('BROWSER_ALERT_ENABLED', 'false');
            checkbox.checked = false;
            showToast("مجوز اعلان صادر نشد", "error");
        }
    } else {
        localStorage.setItem('BROWSER_ALERT_ENABLED', 'false');
        showToast("اعلان‌های دسکتاپ غیرفعال شدند");
    }
    updateBrowserAlertsUI();
}

function toggleGlobalMute(checkbox) {
    localStorage.setItem('BROWSER_ALERT_MUTED', checkbox.checked ? 'true' : 'false');
    showToast(checkbox.checked ? "صداها بی‌صدا شدند" : "صداها فعال شدند");
}

function toggleCategoryNotify(category, checkbox) {
    localStorage.setItem(`BROWSER_NOTIFY_${category.toUpperCase()}_ENABLED`, checkbox.checked ? 'true' : 'false');
}

function toggleCategorySound(category, checkbox) {
    localStorage.setItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`, checkbox.checked ? 'true' : 'false');
}

function playSynthesizedSound(category) {
    const isMuted = localStorage.getItem('BROWSER_ALERT_MUTED') === 'true';
    if (isMuted) return;

    const soundEnabled = localStorage.getItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`) !== 'false';
    if (!soundEnabled) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    try {
        const ctx = new AudioContext();

        if (category === 'critical') {
            // Critical: Alarm sound (High sawtooth beep followed by lower beep)
            const playBeep = (freq, startTime, duration) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, startTime);
                gain.gain.setValueAtTime(0.12, startTime);
                gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration - 0.02);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + duration);
            };
            playBeep(880, ctx.currentTime, 0.15);
            playBeep(587.33, ctx.currentTime + 0.18, 0.25);
        } else if (category === 'recovery') {
            // Recovery: Pleasant rising chime (C5 -> E5 -> G5 -> C6)
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, index) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.08);
                gain.gain.setValueAtTime(0.1, ctx.currentTime + index * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + index * 0.08 + 0.25);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime + index * 0.08);
                osc.stop(ctx.currentTime + index * 0.08 + 0.25);
            });
        } else if (category === 'warning') {
            // Warning: Soft warning chime (single triangle wave decay ding)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.35);
        }
    } catch (e) {
        console.error("Audio Context playback failed", e);
    }
}

function testSound(category) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return showToast("مرورگر شما از صدا پشتیبانی نمی‌کند", "error");
    
    const originalMute = localStorage.getItem('BROWSER_ALERT_MUTED');
    const originalSoundVal = localStorage.getItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`);
    
    localStorage.setItem('BROWSER_ALERT_MUTED', 'false');
    localStorage.setItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`, 'true');
    
    playSynthesizedSound(category);
    
    localStorage.setItem('BROWSER_ALERT_MUTED', originalMute);
    localStorage.setItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`, originalSoundVal);
}

function testBrowserNotification() {
    if (!("Notification" in window)) {
        return showToast("این مرورگر از اعلان‌ها پشتیبانی نمی‌کند", "error");
    }

    if (Notification.permission !== "granted") {
        Notification.requestPermission().then(permission => {
            updateBrowserAlertsUI();
            if (permission === "granted") {
                sendTestNotification();
            } else {
                showToast("مجوز اعلان صادر نشد. لطفاً مجوز را دستی فعال کنید.", "error");
            }
        });
    } else {
        sendTestNotification();
    }
}

function sendTestNotification() {
    const notification = new Notification("تست اعلان HikStatus", {
        body: "سیستم اعلان مرورگر به درستی کار می‌کند!",
        icon: '/static/logo.webp',
        dir: 'rtl'
    });
    
    playSynthesizedSound('recovery');
    showToast("اعلان آزمایشی ارسال شد");
}

function handleIncomingAlert(msg) {
    const isEnabled = localStorage.getItem('BROWSER_ALERT_ENABLED') === 'true';
    if (!isEnabled) return;

    let category = 'warning';
    if (msg.alert_type === 'error') category = 'critical';
    else if (msg.alert_type === 'success') category = 'recovery';

    const notifyEnabled = localStorage.getItem(`BROWSER_NOTIFY_${category.toUpperCase()}_ENABLED`) !== 'false';
    
    if (notifyEnabled && Notification.permission === "granted") {
        const notification = new Notification(msg.title, {
            body: msg.body,
            icon: '/static/logo.webp',
            tag: `hikstatus-${category}`,
            dir: 'rtl'
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }

    playSynthesizedSound(category);
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
let currentGroupId = null;
let mapPlans = [];
let activePlanId = null;
let groupsCache = [];

async function loadGroupsCache() {
    try {
        const res = await apiFetch(`${API}/groups`);
        groupsCache = await res.json();
    } catch (e) {
        groupsCache = [];
    }
}

function populateMapGroupSelect() {
    const sel = document.getElementById('map-group-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">همه دوربین‌ها</option>';
    groupsCache.forEach(g => {
        sel.innerHTML += `<option value="${g.id}">${g.name}</option>`;
    });
    if (prev) sel.value = prev;
}

async function onMapGroupChange(groupId) {
    currentGroupId = groupId ? parseInt(groupId) : null;
    mapPlans = [];
    activePlanId = null;

    const floorBtn = document.getElementById('btn-map-floor');

    if (currentGroupId) {
        if (floorBtn) floorBtn.style.display = 'inline-block';
        const group = groupsCache.find(g => g.id === currentGroupId);
        if (group) {
            if (group.map_center_lat !== null && group.map_center_lng !== null) {
                mapStartLat = group.map_center_lat;
                mapStartLng = group.map_center_lng;
            }
            if (group.map_zoom !== null) {
                localStorage.setItem('map_zoom_geo', group.map_zoom);
            }
        }
        await loadGroupPlans(currentGroupId);
    } else {
        if (floorBtn) floorBtn.style.display = 'none';
        if (mapType === 'floor') {
            mapType = 'geo';
            document.getElementById('btn-map-floor')?.classList.remove('active');
            document.getElementById('btn-map-geo')?.classList.add('active');
            document.getElementById('upload-plan-section').style.display = 'none';
        }
        const latSet = settingsCache.find(s => s.key === 'MAP_START_LAT');
        const lngSet = settingsCache.find(s => s.key === 'MAP_START_LNG');
        mapStartLat = latSet ? parseFloat(latSet.value) : 37.796067;
        mapStartLng = lngSet ? parseFloat(lngSet.value) : 45.062508;
    }

    renderPlanTabs();
    setupLeafletMap(true);
    renderMapCameraList();
}

async function loadGroupPlans(groupId) {
    try {
        const res = await apiFetch(`${API}/groups/${groupId}/plans`);
        mapPlans = await res.json();
        if (mapPlans.length > 0 && !activePlanId) {
            activePlanId = mapPlans[0].id;
            mapImage = mapPlans[0].image_url;
        } else if (mapPlans.length === 0) {
            activePlanId = null;
            mapImage = '';
        }
    } catch (e) {
        mapPlans = [];
        activePlanId = null;
        mapImage = '';
    }
}

function renderPlanTabs() {
    const container = document.getElementById('map-plan-tabs');
    const uploadBtn = document.getElementById('btn-upload-plan');
    if (!container) return;

    if (!currentGroupId || mapType !== 'floor') {
        container.innerHTML = '';
        if (uploadBtn) uploadBtn.style.display = 'none';
        return;
    }

    if (uploadBtn) uploadBtn.style.display = 'flex';

    if (mapPlans.length === 0) {
        container.innerHTML = '<span style="font-size:11px; color:var(--text-muted);">پلانی آپلود نشده</span>';
        return;
    }

    container.innerHTML = mapPlans.map(p => {
        const isActive = p.id === activePlanId;
        return `<div style="display:inline-flex;align-items:center;gap:4px;background:${isActive ? 'var(--primary)' : 'var(--bg-tertiary)'};color:${isActive ? '#fff' : 'var(--text-secondary)'};border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;white-space:nowrap;" onclick="switchPlan(${p.id})">
            <span>${p.name}</span>
            <span onclick="deletePlan(${p.id});event.stopPropagation();" style="cursor:pointer;opacity:0.7;font-size:14px;line-height:1;" title="حذف">&times;</span>
        </div>`;
    }).join('');
}

function switchPlan(planId) {
    const plan = mapPlans.find(p => p.id === planId);
    if (!plan) return;
    activePlanId = planId;
    mapImage = plan.image_url;
    renderPlanTabs();
    setupLeafletMap(true);
    renderMapCameraList();
}

async function uploadGroupPlan(input) {
    if (!input.files || !input.files[0] || !currentGroupId) return;

    const formData = new FormData();
    formData.append('file', input.files[0]);
    const planName = input.files[0].name.replace(/\.[^.]+$/, '');
    formData.append('name', planName);

    showToast('در حال آپلود...');
    try {
        const res = await fetch(`${API}/groups/${currentGroupId}/plans`, {
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
        showToast('پلان با موفقیت آپلود شد');
        await loadGroupPlans(currentGroupId);
        activePlanId = data.id;
        mapImage = data.image_url;
        renderPlanTabs();
        setupLeafletMap(true);
        renderMapCameraList();
    } catch (e) {
        showToast('خطا در آپلود پلان: ' + e.message, 'error');
    }
    input.value = '';
}

async function deletePlan(planId) {
    if (!currentGroupId) return;
    if (!confirm('آیا از حذف این پлан مطمئن هستید؟')) return;

    try {
        const res = await apiFetch(`${API}/groups/${currentGroupId}/plans/${planId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        showToast('پлан حذف شد');
        await loadGroupPlans(currentGroupId);
        if (activePlanId === planId) {
            activePlanId = mapPlans.length > 0 ? mapPlans[0].id : null;
            mapImage = activePlanId ? mapPlans[0].image_url : '';
        }
        renderPlanTabs();
        setupLeafletMap(true);
        renderMapCameraList();
    } catch (e) {
        showToast('خطا در حذف پلان', 'error');
    }
}

async function initOrRefreshMap() {
    if (settingsCache.length === 0) {
        try {
            const sRes = await fetch(`${API}/settings`);
            settingsCache = await sRes.json();
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    await loadGroupsCache();
    populateMapGroupSelect();

    const typeSet = settingsCache.find(s => s.key === 'MAP_TYPE');
    mapType = typeSet ? typeSet.value : 'floor';

    const floorBtn = document.getElementById('btn-map-floor');

    if (!currentGroupId) {
        if (floorBtn) floorBtn.style.display = 'none';
        if (mapType === 'floor') {
            mapType = 'geo';
        }
        const imageSet = settingsCache.find(s => s.key === 'MAP_IMAGE');
        const latSet = settingsCache.find(s => s.key === 'MAP_START_LAT');
        const lngSet = settingsCache.find(s => s.key === 'MAP_START_LNG');
        mapImage = imageSet ? imageSet.value : '';
        mapStartLat = latSet ? parseFloat(latSet.value) : 37.796067;
        mapStartLng = lngSet ? parseFloat(lngSet.value) : 45.062508;
    } else {
        if (floorBtn) floorBtn.style.display = 'inline-block';
        const group = groupsCache.find(g => g.id === currentGroupId);
        if (group) {
            if (group.map_center_lat !== null && group.map_center_lng !== null) {
                mapStartLat = group.map_center_lat;
                mapStartLng = group.map_center_lng;
            }
        }
        await loadGroupPlans(currentGroupId);
    }

    document.getElementById('btn-map-floor').classList.toggle('active', mapType === 'floor');
    document.getElementById('btn-map-geo').classList.toggle('active', mapType === 'geo');
    document.getElementById('upload-plan-section').style.display = mapType === 'floor' ? 'block' : 'none';

    try {
        const nRes = await apiFetch(`${API}/nvrs`);
        nvrCache = await nRes.json();
    } catch (e) {
        console.error('Failed to load NVRs:', e);
    }

    try {
        const camRes = await apiFetch(`${API}/cameras`);
        mapCamerasList = await camRes.json();
        mapCamerasList.forEach(c => {
            const nvr = nvrCache.find(n => n.ip === c.nvr_ip);
            c.group_id = nvr ? nvr.group_id : null;
        });
    } catch (e) {
        console.error('Failed to load cameras:', e);
    }

    renderPlanTabs();
    setupLeafletMap();
    renderMapCameraList();
}

function setupLeafletMap(ignoreRestored = false) {
    let restoredCenter = null;
    let restoredZoom = null;

    const centerKeyLat = `map_center_lat_${mapType}`;
    const centerKeyLng = `map_center_lng_${mapType}`;
    const zoomKey = `map_zoom_${mapType}`;

    // 1. Save state before removing old map
    if (map) {
        if (!ignoreRestored) {
            const currentCenter = map.getCenter();
            restoredCenter = [currentCenter.lat, currentCenter.lng];
            restoredZoom = map.getZoom();

            localStorage.setItem(centerKeyLat, currentCenter.lat);
            localStorage.setItem(centerKeyLng, currentCenter.lng);
            localStorage.setItem(zoomKey, restoredZoom);
        }
        map.remove();
        map = null;
    }

    if (!ignoreRestored) {
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
        if (restoredCenter !== null && restoredZoom !== null) {
            map = L.map('map-canvas', {
                center: restoredCenter,
                zoom: restoredZoom,
                attributionControl: false
            });
        } else {
            const groupCams = currentGroupId
                ? mapCamerasList.filter(c => c.group_id === currentGroupId && c.latitude !== null && c.longitude !== null)
                : mapCamerasList.filter(c => c.latitude !== null && c.longitude !== null);

            map = L.map('map-canvas', {
                attributionControl: false
            });

            if (groupCams.length > 0) {
                if (groupCams.length === 1) {
                    map.setView([groupCams[0].latitude, groupCams[0].longitude], 16);
                } else {
                    const latMin = Math.min(...groupCams.map(c => c.latitude));
                    const latMax = Math.max(...groupCams.map(c => c.latitude));
                    const lngMin = Math.min(...groupCams.map(c => c.longitude));
                    const lngMax = Math.max(...groupCams.map(c => c.longitude));
                    map.fitBounds([[latMin, lngMin], [latMax, lngMax]]);
                }
            } else {
                map.setView([35.6892, 51.3890], 12); // Tehran
            }
        }

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

    map.on('click', () => {
        closeMapFovSection();
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
    c.plan_id = null;
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
                plan_id: null,
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

    marker.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        selectMarkerForFov(marker, c);
    });

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
                y_pos: Math.max(0, Math.min(100, yPct)),
                plan_id: activePlanId
            };
            c.x_pos = payload.x_pos;
            c.y_pos = payload.y_pos;
            c.plan_id = activePlanId;
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
    if (typeof clearActiveFovSelection === 'function') {
        clearActiveFovSelection();
    }
    mapMarkers.forEach(m => {
        if (m.fovPolygon) {
            map.removeLayer(m.fovPolygon);
        }
        map.removeLayer(m);
    });
    mapMarkers = [];

    const cams = currentGroupId
        ? mapCamerasList.filter(c => c.group_id === currentGroupId)
        : mapCamerasList;

    cams.forEach(c => {
        let latlng = null;

        if (mapType === 'floor') {
            if (c.x_pos === null || c.y_pos === null || c.plan_id !== activePlanId) return;
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

    mapCamerasList.forEach(c => {
        const nvr = nvrCache.find(n => n.ip === c.nvr_ip);
        c.group_id = nvr ? nvr.group_id : null;
    });

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

    document.getElementById('upload-plan-section').style.display = mapType === 'floor' ? 'block' : 'none';
    document.getElementById('btn-map-floor').classList.toggle('active', mapType === 'floor');
    document.getElementById('btn-map-geo').classList.toggle('active', mapType === 'geo');

    renderPlanTabs();
    setupLeafletMap();
    renderMapCameraList();
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

    let pool = mapCamerasList;
    if (currentGroupId) {
        pool = pool.filter(c => c.group_id === currentGroupId);
    }

    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name, 'fa'));

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
        const hasLoc = mapType === 'floor' ? (c.x_pos !== null && c.y_pos !== null && c.plan_id === activePlanId) : (c.latitude !== null && c.longitude !== null);
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
        const c = mapCamerasList.find(cam => cam.id === id);
        if (c) selectMarkerForFov(marker, c);
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
            y_pos: Math.max(0, Math.min(100, yPct)),
            plan_id: activePlanId
        };
        c.x_pos = payload.x_pos;
        c.y_pos = payload.y_pos;
        c.plan_id = activePlanId;
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

        // Select the marker to open the FOV sidebar immediately
        selectMarkerForFov(marker, c);
    } catch (e) {
        showToast('خطا در ذخیره موقعیت: ' + e.message, 'error');
    }
}

// --- Role-Based Access Control (RBAC) frontend logic ---

function applyRoleUI() {
    if (!window.currentUser) return;
    const role = window.currentUser.role;
    
    // Hide navigation views
    document.querySelectorAll('[data-view="logs"]').forEach(el => {
        el.style.display = (role === 'admin') ? '' : 'none';
    });
    document.querySelectorAll('[data-view="reports"]').forEach(el => {
        el.style.display = (role === 'admin' || role === 'group_control') ? '' : 'none';
    });
    document.querySelectorAll('[data-view="settings"]').forEach(el => {
        el.style.display = '';
    });

    const editBtn = document.getElementById('btn-edit-positions');
    if (editBtn) {
        editBtn.style.display = (role === 'group_view') ? 'none' : '';
    }

    const headerUsername = document.getElementById('header-username');
    if (headerUsername) {
        headerUsername.textContent = window.currentUser.username;
    }
}

// User CRUD management
let usersCache = [];

async function loadUsers() {
    try {
        const res = await apiFetch(`${API}/users`);
        usersCache = await res.json();
        renderUsersList();
        
        // Populate group options in User Form dropdown
        const select = document.getElementById('userGroup');
        if (select) {
            select.innerHTML = '<option value="">بدون گروه</option>' + groupCache.map(g => 
                `<option value="${g.id}">${g.name}</option>`
            ).join('');
        }
    } catch (e) {
        console.error('Error loading users:', e);
    }
}

function renderUsersList() {
    const list = document.getElementById('user-list');
    if (!list) return;
    if (usersCache.length === 0) {
        list.innerHTML = '<div class="empty-state">کاربری تعریف نشده است</div>';
        return;
    }
    list.innerHTML = usersCache.map(u => {
        const group = groupCache.find(g => g.id === u.group_id);
        const groupName = group ? group.name : 'بدون گروه';
        const roleLabel = {
            'admin': 'مدیر کامل',
            'group_control': 'کنترل گروه',
            'group_view': 'مشاهده گروه'
        }[u.role] || u.role;
        
        return `<div class="list-item">
            <div class="list-item-info">
                <strong>${u.username}</strong>
                <span style="font-size:12px; opacity:0.7; margin-right:15px;">نقش: ${roleLabel} | کارخانه: ${groupName}</span>
            </div>
            <div class="list-item-actions">
                <button class="btn btn-ghost" onclick="deleteUser(${u.id})" style="color:var(--danger)">حذف</button>
            </div>
        </div>`;
    }).join('');
}

async function addUser() {
    const username = document.getElementById('userName').value.trim();
    const password = document.getElementById('userPass').value;
    const role = document.getElementById('userRole').value;
    const grpVal = document.getElementById('userGroup').value;
    const group_id = grpVal ? parseInt(grpVal) : null;
    
    if (!username || !password) {
        return showToast('نام کاربری و رمز عبور را وارد کنید', 'error');
    }
    
    try {
        await apiFetch(`${API}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role, group_id })
        });
        showToast('کاربر جدید با موفقیت اضافه شد');
        document.getElementById('userName').value = '';
        document.getElementById('userPass').value = '';
        loadUsers();
    } catch (e) {
        showToast('خطا در افزودن کاربر: ' + e.message, 'error');
    }
}

async function deleteUser(id) {
    if (!confirm('آیا از حذف این کاربر مطمئن هستید؟')) return;
    try {
        await apiFetch(`${API}/users/${id}`, { method: 'DELETE' });
        showToast('کاربر با موفقیت حذف شد');
        loadUsers();
    } catch (e) {
        showToast('خطا در حذف کاربر: ' + e.message, 'error');
    }
}

// Personal Alert Settings management
async function loadMyAlerts() {
    try {
        const res = await apiFetch(`${API}/me/alerts`);
        const data = await res.json();
        
        document.getElementById('myMailEnabled').checked = data.mail_enabled;
        document.getElementById('myMailRecipients').value = data.mail_recipients || '';
        document.getElementById('myTelegramEnabled').checked = data.telegram_enabled;
        document.getElementById('myTelegramChatIds').value = data.telegram_chat_ids || '';
    } catch (e) {
        console.error('Error loading personal alert settings:', e);
    }
}

async function saveMyAlerts() {
    const payload = {
        mail_enabled: document.getElementById('myMailEnabled').checked,
        mail_recipients: document.getElementById('myMailRecipients').value.trim(),
        telegram_enabled: document.getElementById('myTelegramEnabled').checked,
        telegram_chat_ids: document.getElementById('myTelegramChatIds').value.trim()
    };
    
    try {
        await apiFetch(`${API}/me/alerts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast('تنظیمات اعلان شخصی با موفقیت ذخیره شد');
    } catch (e) {
        showToast('خطا در ذخیره تنظیمات: ' + e.message, 'error');
    }
}

// --- Profile & Change Password Handlers ---

function openProfileModal() {
    if (!window.currentUser) return;
    
    document.getElementById('p-username').textContent = window.currentUser.username;
    
    const roleLabel = {
        'admin': 'مدیر کامل سیستم',
        'group_control': 'کنترل گروه/کارخانه',
        'group_view': 'مشاهده گروه/کارخانه'
    }[window.currentUser.role] || window.currentUser.role;
    
    document.getElementById('p-role').textContent = roleLabel;
    document.getElementById('p-new-pass').value = '';
    document.getElementById('p-new-pass-confirm').value = '';
    
    document.getElementById('profileModal').classList.add('open');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('open');
}

async function changeMyPassword() {
    const newPass = document.getElementById('p-new-pass').value;
    const confirmPass = document.getElementById('p-new-pass-confirm').value;
    
    if (!newPass) {
        return showToast('رمز عبور جدید را وارد کنید', 'error');
    }
    if (newPass !== confirmPass) {
        return showToast('رمز عبور جدید و تکرار آن مطابقت ندارند', 'error');
    }
    
    try {
        await apiFetch(`${API}/me/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password: newPass })
        });
        showToast('رمز عبور با موفقیت تغییر یافت');
        closeProfileModal();
    } catch (e) {
        showToast('خطا در تغییر رمز عبور: ' + e.message, 'error');
    }
}

// --- Interactive FOV Editor & Dragging Handles ---

let activeFovMarker = null;
let activeFovCamera = null;
let fovHandles = [];

function selectMarkerForFov(marker, c) {
    clearActiveFovSelection();
    
    activeFovMarker = marker;
    activeFovCamera = c;
    
    const panel = document.getElementById('map-fov-section');
    if (!panel) return;
    panel.style.display = 'block';
    
    document.getElementById('map-fov-cam-name').textContent = `تنظیم محدوده دید دوربین "${c.name}"`;
    
    const isFovEnabled = c.fov_angle != null && c.fov_radius != null;
    document.getElementById('sidebar-fov-enable').checked = isFovEnabled;
    
    const slidersBlock = document.getElementById('sidebar-fov-sliders');
    slidersBlock.style.display = isFovEnabled ? 'block' : 'none';
    
    if (isFovEnabled) {
        document.getElementById('sidebar-fov-angle').value = c.fov_angle || 0;
        document.getElementById('lbl-sidebar-angle').textContent = `${c.fov_angle || 0}°`;
        
        document.getElementById('sidebar-fov-radius').value = c.fov_radius || 50;
        document.getElementById('lbl-sidebar-radius').textContent = c.fov_radius || 50;
        
        document.getElementById('sidebar-fov-spread').value = c.fov_spread || 60;
        document.getElementById('lbl-sidebar-spread').textContent = `${c.fov_spread || 60}°`;
        
        spawnFovHandles();
    }
}

function clearActiveFovSelection() {
    fovHandles.forEach(h => map.removeLayer(h));
    fovHandles = [];
    activeFovMarker = null;
    activeFovCamera = null;
}

function closeMapFovSection() {
    const panel = document.getElementById('map-fov-section');
    if (panel) panel.style.display = 'none';
    clearActiveFovSelection();
}

function spawnFovHandles() {
    fovHandles.forEach(h => map.removeLayer(h));
    fovHandles = [];
    
    if (!activeFovMarker || !activeFovCamera || !activeFovMarker.fovPolygon) return;
    
    const c = activeFovCamera;
    const center = activeFovMarker.getLatLng();
    const pts = activeFovMarker.fovPolygon.getLatLngs()[0];
    
    if (!pts || pts.length < 3) return;
    
    const leftPt = pts[1];
    const rightPt = pts[pts.length - 2];
    
    const handleIcon = L.divIcon({
        className: 'fov-handle-icon',
        html: `<div style="width: 12px; height: 12px; background: #ef4444; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5); cursor: move;"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });
    
    const leftHandle = L.marker(leftPt, { icon: handleIcon, draggable: true }).addTo(map);
    const rightHandle = L.marker(rightPt, { icon: handleIcon, draggable: true }).addTo(map);
    
    fovHandles.push(leftHandle, rightHandle);
    
    leftHandle.on('drag', () => handleDrag(leftHandle, rightHandle));
    rightHandle.on('drag', () => handleDrag(leftHandle, rightHandle));
    
    leftHandle.on('dragend', () => saveFovFromHandles());
    rightHandle.on('dragend', () => saveFovFromHandles());
}

function getFlatAngle(center, pt) {
    const cy = center.lat !== undefined ? center.lat : center[0];
    const cx = center.lng !== undefined ? center.lng : center[1];
    const py = pt.lat !== undefined ? pt.lat : pt[0];
    const px = pt.lng !== undefined ? pt.lng : pt[1];
    
    const dx = px - cx;
    const dy = py - cy;
    const rad = Math.atan2(dy, dx);
    let deg = 90 - (rad * 180 / Math.PI);
    while (deg < 0) deg += 360;
    while (deg >= 360) deg -= 360;
    return deg;
}

function getGeoAngle(center, pt) {
    const lat1 = (center.lat) * Math.PI / 180;
    const lng1 = (center.lng) * Math.PI / 180;
    const lat2 = (pt.lat) * Math.PI / 180;
    const lng2 = (pt.lng) * Math.PI / 180;
    
    const dLng = lng2 - lng1;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    while (brng < 0) brng += 360;
    while (brng >= 360) brng -= 360;
    return brng;
}

function handleDrag(leftHandle, rightHandle) {
    if (!activeFovMarker || !activeFovCamera) return;
    
    const c = activeFovCamera;
    const center = activeFovMarker.getLatLng();
    const leftLatLng = leftHandle.getLatLng();
    const rightLatLng = rightHandle.getLatLng();
    
    let radius, leftAngle, rightAngle;
    
    if (mapType === 'floor') {
        const distL = Math.sqrt(Math.pow(leftLatLng.lat - center.lat, 2) + Math.pow(leftLatLng.lng - center.lng, 2));
        const distR = Math.sqrt(Math.pow(rightLatLng.lat - center.lat, 2) + Math.pow(rightLatLng.lng - center.lng, 2));
        radius = Math.round((distL + distR) / 2);
        
        leftAngle = getFlatAngle(center, leftLatLng);
        rightAngle = getFlatAngle(center, rightLatLng);
    } else {
        const distL = map.distance(center, leftLatLng);
        const distR = map.distance(center, rightLatLng);
        radius = Math.round((distL + distR) / 2);
        
        leftAngle = getGeoAngle(center, leftLatLng);
        rightAngle = getGeoAngle(center, rightLatLng);
    }
    
    let spread = rightAngle - leftAngle;
    if (spread < 0) spread += 360;
    
    spread = Math.max(10, Math.min(180, spread));
    
    let angle = leftAngle + (spread / 2);
    while (angle >= 360) angle -= 360;
    
    c.fov_angle = Math.round(angle);
    c.fov_radius = Math.round(radius);
    c.fov_spread = Math.round(spread);
    
    document.getElementById('sidebar-fov-angle').value = c.fov_angle;
    document.getElementById('lbl-sidebar-angle').textContent = `${c.fov_angle}°`;
    
    document.getElementById('sidebar-fov-radius').value = c.fov_radius;
    document.getElementById('lbl-sidebar-radius').textContent = c.fov_radius;
    
    document.getElementById('sidebar-fov-spread').value = c.fov_spread;
    document.getElementById('lbl-sidebar-spread').textContent = `${c.fov_spread}°`;
    
    if (activeFovMarker.fovPolygon) {
        const pts = calculateFovPoints(c, center);
        activeFovMarker.fovPolygon.setLatLngs(pts);
    }
}

function saveFovFromHandles() {
    if (!activeFovCamera) return;
    const c = activeFovCamera;
    saveFovDebounced(c.id, c.fov_angle, c.fov_radius, c.fov_spread);
    spawnFovHandles();
}

async function toggleSidebarFov(enabled) {
    if (!activeFovMarker || !activeFovCamera) return;
    
    const c = activeFovCamera;
    const marker = activeFovMarker;
    const slidersBlock = document.getElementById('sidebar-fov-sliders');
    
    if (enabled) {
        slidersBlock.style.display = 'block';
        c.fov_angle = 0;
        c.fov_radius = mapType === 'floor' ? 80 : 50;
        c.fov_spread = 60;
        
        document.getElementById('sidebar-fov-angle').value = c.fov_angle;
        document.getElementById('lbl-sidebar-angle').textContent = `${c.fov_angle}°`;
        document.getElementById('sidebar-fov-radius').value = c.fov_radius;
        document.getElementById('lbl-sidebar-radius').textContent = c.fov_radius;
        document.getElementById('sidebar-fov-spread').value = c.fov_spread;
        document.getElementById('lbl-sidebar-spread').textContent = `${c.fov_spread}°`;
        
        if (marker.fovPolygon) {
            map.removeLayer(marker.fovPolygon);
        }
        
        const pts = calculateFovPoints(c, marker.getLatLng());
        marker.fovPolygon = L.polygon(pts, {
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 0.15,
            weight: 1.5
        }).addTo(map);
        
        spawnFovHandles();
        saveFovDebounced(c.id, c.fov_angle, c.fov_radius, c.fov_spread);
    } else {
        slidersBlock.style.display = 'none';
        c.fov_angle = null;
        c.fov_radius = null;
        c.fov_spread = null;
        
        if (marker.fovPolygon) {
            map.removeLayer(marker.fovPolygon);
            marker.fovPolygon = null;
        }
        
        fovHandles.forEach(h => map.removeLayer(h));
        fovHandles = [];
        
        await apiFetch(`${API}/cameras/${c.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fov_angle: null,
                fov_radius: null,
                fov_spread: null
            })
        });
        showToast('محدوده دید دوربین غیرفعال شد');
    }
}

function updateSidebarFovVal(field, value) {
    if (!activeFovMarker || !activeFovCamera) return;
    
    const c = activeFovCamera;
    const marker = activeFovMarker;
    const val = parseInt(value);
    
    if (field === 'angle') {
        c.fov_angle = val;
        document.getElementById('lbl-sidebar-angle').textContent = `${val}°`;
    } else if (field === 'radius') {
        c.fov_radius = val;
        document.getElementById('lbl-sidebar-radius').textContent = val;
    } else if (field === 'spread') {
        c.fov_spread = val;
        document.getElementById('lbl-sidebar-spread').textContent = `${val}°`;
    }
    
    if (marker.fovPolygon) {
        const pts = calculateFovPoints(c, marker.getLatLng());
        marker.fovPolygon.setLatLngs(pts);
    }
    
    spawnFovHandles();
    saveFovDebounced(c.id, c.fov_angle, c.fov_radius, c.fov_spread);
}

// --- SCHEDULED TASKS ---
let scheduledTasksCache = [];

async function loadScheduledTasks() {
    try {
        const res = await apiFetch(`${API}/scheduler/tasks`);
        if (!res.ok) throw new Error("خطا در دریافت لیست تسک‌ها");
        scheduledTasksCache = await res.json();
        renderScheduledTasks();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

function displayPersianDateTime(isoStr) {
    if (!isoStr) return 'هرگز';
    try {
        const d = new Date(isoStr);
        return formatPersianDateTime(d);
    } catch(e) {
        return 'نامعتبر';
    }
}

function renderScheduledTasks() {
    const tbody = document.getElementById('tasks-table-body');
    if (!tbody) return;

    if (scheduledTasksCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">هیچ وظیفه‌ای تعریف نشده است.</td></tr>`;
        return;
    }

    tbody.innerHTML = scheduledTasksCache.map(t => {
        const statusBadge = t.status === 'Running' 
            ? `<span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #22c55e; padding: 4px 8px; border-radius: 4px; font-size: 11px;">درحال اجرا</span>`
            : `<span class="badge" style="background: rgba(148, 163, 184, 0.1); color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; font-size: 11px;">بیکار</span>`;

        const lastStatusBadge = t.last_status === 'Success'
            ? `<span style="color: #22c55e;">موفق</span>`
            : t.last_status === 'Failed'
            ? `<span style="color: #ef4444;">ناموفق</span>`
            : t.last_status === 'Cancelled'
            ? `<span style="color: var(--warning);">لغو شده</span>`
            : `<span style="color: var(--text-muted);">-</span>`;

        const lastRunStr = t.last_run 
            ? `${displayPersianDateTime(t.last_run)} (${t.last_duration} ثانیه) - ${lastStatusBadge}`
            : 'هرگز';

        const runBtn = t.status === 'Running'
            ? `<button class="btn btn-ghost btn-sm" disabled style="opacity: 0.5; padding: 4px 8px; font-size: 12px;">اجرا ▶️</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="runTask('${t.id}')" style="color: #22c55e; padding: 4px 8px; font-size: 12px;">اجرا ▶️</button>`;

        const stopBtn = t.status === 'Running'
            ? `<button class="btn btn-ghost btn-sm" onclick="stopTask('${t.id}')" style="color: #ef4444; padding: 4px 8px; font-size: 12px;">توقف ⏹️</button>`
            : `<button class="btn btn-ghost btn-sm" disabled style="opacity: 0.5; padding: 4px 8px; font-size: 12px;">توقف ⏹️</button>`;

        const isChecked = t.is_enabled ? 'checked' : '';

        return `
            <tr id="task-row-${t.id}">
                <td>
                    <strong style="color: var(--text-primary); display: block; margin-bottom: 2px;">${t.name}</strong>
                    <span style="font-size: 11px; color: var(--text-secondary); display: block;">${t.description}</span>
                </td>
                <td>${statusBadge}</td>
                <td style="font-size: 12px; font-family: monospace; direction: ltr; text-align: right;">${lastRunStr}</td>
                <td style="font-size: 12px; font-family: monospace; direction: ltr; text-align: right;">${displayPersianDateTime(t.next_run)}</td>
                <td>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <input type="number" id="interval-input-${t.id}" class="form-input" style="width: 80px; padding: 4px 8px; font-size: 12px; text-align: center;" value="${t.interval}">
                        <button class="btn btn-sm" onclick="saveTaskInterval('${t.id}')" style="padding: 4px 8px; font-size: 11px; background: var(--surface-3); border: 1px solid var(--border);">ذخیره</button>
                    </div>
                </td>
                <td>
                    <label class="toggle" style="transform: scale(0.85); transform-origin: right;">
                        <input type="checkbox" ${isChecked} onchange="toggleTask('${t.id}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td>
                    <div style="display: flex; gap: 4px;">
                        ${runBtn}
                        ${stopBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function runTask(id) {
    try {
        const res = await apiFetch(`${API}/scheduler/tasks/${id}/run`, { method: 'POST' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || "خطا در اجرای تسک");
        }
        showToast("درخواست اجرای تسک ارسال شد", "success");
        loadScheduledTasks();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

async function stopTask(id) {
    try {
        const res = await apiFetch(`${API}/scheduler/tasks/${id}/stop`, { method: 'POST' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || "خطا در توقف تسک");
        }
        showToast("درخواست توقف تسک ارسال شد", "success");
        loadScheduledTasks();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

async function saveTaskInterval(id) {
    const input = document.getElementById(`interval-input-${id}`);
    if (!input) return;
    const interval = parseInt(input.value);
    if (isNaN(interval) || interval <= 0) {
        showToast("دوره زمانی معتبر نیست", "error");
        return;
    }

    try {
        const res = await apiFetch(`${API}/scheduler/tasks/${id}/interval`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval })
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || "خطا در ذخیره زمان‌بندی");
        }
        showToast("زمان‌بندی تسک با موفقیت به‌روزرسانی شد", "success");
        loadScheduledTasks();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

async function toggleTask(id, enabled) {
    try {
        const res = await apiFetch(`${API}/scheduler/tasks/${id}/toggle`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_enabled: enabled })
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || "خطا در تغییر وضعیت تسک");
        }
        showToast(enabled ? "تسک فعال شد" : "تسک غیرفعال شد", "success");
        loadScheduledTasks();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

function handleTaskStatusUpdate(task) {
    const idx = scheduledTasksCache.findIndex(t => t.id === task.id);
    if (idx !== -1) {
        scheduledTasksCache[idx] = task;
    } else {
        scheduledTasksCache.push(task);
    }
    const activeTabBtn = document.querySelector('.settings-nav button.active');
    if (activeTabBtn && activeTabBtn.getAttribute('data-tab') === 'sec-tasks') {
        renderScheduledTasks();
    }
}
