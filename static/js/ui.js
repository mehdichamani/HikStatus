// ماژول مدیریت رابط کاربری (UI) و رندر کردن عناصر DOM

export async function nav(id, activeTabOverride = null) {
    document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(e => e.classList.remove('active'));

    const view = document.getElementById(id);
    if (view) view.classList.add('active');

    document.querySelectorAll(`[data-view="${id}"]`).forEach(e => e.classList.add('active'));

    const fabDash = document.getElementById('fab-dash-controls');
    if (fabDash) {
        if (id === 'dash') {
            fabDash.classList.remove('hidden');
        } else {
            fabDash.classList.add('hidden');
        }
    }

    if (id === 'dash') window.fetchDash();
    if (id === 'map') window.initOrRefreshMap();
    if (id === 'reports') {
        if (!document.getElementById('startDt').value) {
            window.setPreset(24);
        }
        window.genReport();
        window.fetchAndRenderHeatmap();
    }
    if (id === 'settings') await window.loadSettings(activeTabOverride);
    if (id === 'outages') window.loadOutageExplanations();
}

export function showAboutUs() {
    window.nav('settings', 'sec-about');
}

export function closeModal() {
    document.getElementById('camModal').classList.remove('open');
    const img = document.getElementById('m-snap-img');
    if (img) img.src = '';
    const container = document.getElementById('m-snap-container');
    if (container) container.style.display = 'none';
}

export function renderDash() {
    let filteredCams = dashCamerasCache;

    // Apply status filter
    if (dashCamFilter === 'online') {
        filteredCams = filteredCams.filter(c => c.status === 'Online');
    } else if (dashCamFilter === 'offline') {
        filteredCams = filteredCams.filter(c => c.status !== 'Online');
    }

    // Apply recording status filter
    if (dashCamRecordingFilter === 'on') {
        filteredCams = filteredCams.filter(c => c.recording_scheduled === true);
    } else if (dashCamRecordingFilter === 'off') {
        filteredCams = filteredCams.filter(c => c.recording_scheduled === false);
    } else if (dashCamRecordingFilter === 'continuous') {
        filteredCams = filteredCams.filter(c => c.recording_scheduled === true && c.recording_schedule_type && c.recording_schedule_type.includes('مداوم'));
    } else if (dashCamRecordingFilter === 'motion') {
        filteredCams = filteredCams.filter(c => c.recording_scheduled === true && c.recording_schedule_type && c.recording_schedule_type.includes('حرکتی'));
    } else if (dashCamRecordingFilter === 'alarm') {
        filteredCams = filteredCams.filter(c => c.recording_scheduled === true && c.recording_schedule_type && c.recording_schedule_type === 'آلارم (Alarm)');
    } else if (dashCamRecordingFilter === 'motion_alarm') {
        filteredCams = filteredCams.filter(c => c.recording_scheduled === true && c.recording_schedule_type && c.recording_schedule_type.includes('حرکت و آلارم'));
    } else if (dashCamRecordingFilter === 'event') {
        filteredCams = filteredCams.filter(c => c.recording_scheduled === true && c.recording_schedule_type && c.recording_schedule_type.includes('رویداد'));
    }

    // Render Offline Section
    const off = filteredCams.filter(c => c.status !== 'Online');
    if (off.length > 0) {
        document.getElementById('offline-section').classList.remove('hidden');
        document.getElementById('all-ok').classList.add('hidden');
        document.getElementById('offline-count').textContent = off.length;
        document.getElementById('offline-grid').innerHTML = off.map(c => window.createCard(c)).join('');
    } else {
        document.getElementById('offline-section').classList.add('hidden');
        // Only show "All OK" if there are no offline cameras in the entire unfiltered cache, and we are not filtering
        const unfilteredOff = dashCamerasCache.filter(c => c.status !== 'Online');
        if (unfilteredOff.length === 0 && dashCamFilter === 'all') {
            document.getElementById('all-ok').classList.remove('hidden');
        } else {
            document.getElementById('all-ok').classList.add('hidden');
        }
    }

    // Group filtered cameras by NVR IP
    const groups = {};
    filteredCams.forEach(c => {
        if (!groups[c.nvr_ip]) groups[c.nvr_ip] = [];
        groups[c.nvr_ip].push(c);
    });

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

    // Iterate all known NVRs
    nvrCache.filter(n => n.enabled !== false).sort((a, b) => parseInt(window.getNvrNum(a.ip)) - parseInt(window.getNvrNum(b.ip))).forEach(nvrObj => {
        const ip = nvrObj.ip;
        const groupId = nvrObj.group_id;

        // Only include NVR if it has matching cameras
        const hasMatchingCams = (groups[ip] || []).length > 0;
        if (!hasMatchingCams) return;

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

        let totalCams = 0;
        ips.forEach(ip => { totalCams += (groups[ip] || []).length; });

        const isFactoryCollapsed = collapsedFactories.has(String(g.id));
        let factoryHtml = `<div class="factory-section ${isFactoryCollapsed ? '' : 'open'}" id="factory-${g.id}">
            <div class="factory-header" onclick="window.toggleFactory(${g.id})">
                <div class="factory-header-left">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary);"><path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"/></svg>
                    <span class="factory-name">${g.name}</span>
                    ${g.description ? `<span class="factory-desc">(${g.description})</span>` : ''}
                    <div class="factory-stats">
                        <span>${totalCams} دوربین</span>
                        <span>·</span>
                        <span>${ips.length} NVR</span>
                    </div>
                </div>
                <svg class="factory-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="factory-body">`;

        ips.forEach(ip => {
            const nvrObj = nvrCache.find(n => n.ip === ip);
            const isNvrOffline = nvrObj && nvrObj.enabled !== false && nvrObj.status !== 'Online';
            const isAuthError = nvrObj && nvrObj.status === 'AuthError';
            const list = groups[ip] || [];
            const sorted = list.sort((a, b) => parseInt(a.channel_id) - parseInt(b.channel_id));
            const cards = sorted.map(c => window.createCard(c)).join('');
            const isNvrCollapsed = collapsedNvrs.has(ip);
            factoryHtml += `
                <div class="nvr-block ${isNvrCollapsed ? '' : 'open'} ${isNvrOffline ? 'offline' : ''}">
                    <div class="nvr-header" onclick="window.toggleNvr(this)">
                        <div class="nvr-header-left">
                            <span class="nvr-badge ${isNvrOffline ? 'offline' : ''}">${window.getNvrDisplayName(ip)}</span>
                            <span class="nvr-ip">${ip}</span>
                            ${isAuthError ? `<span class="text-danger" style="font-size:11px; font-weight:bold; margin-right:8px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; background:var(--danger); border-radius:50%;"></span>خطای رمز عبور</span>` : (isNvrOffline ? `<span class="text-danger" style="font-size:11px; font-weight:bold; margin-right:8px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; background:var(--danger); border-radius:50%;"></span>قطع ارتباط</span>` : '')}
                        </div>
                        <svg class="nvr-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                    <div class="nvr-grid" style="${isNvrCollapsed ? 'display: none;' : ''}">${cards}</div>
                </div>`;
        });

        factoryHtml += `</div></div>`;
        con.innerHTML += factoryHtml;
    });

    // Render unassigned NVRs
    if (unassignedNvrIps.length > 0) {
        let totalUnassigned = 0;
        unassignedNvrIps.forEach(ip => { totalUnassigned += (groups[ip] || []).length; });

        const isUnassignedCollapsed = collapsedFactories.has('unassigned');
        let unassignedHtml = `<div class="factory-section ${isUnassignedCollapsed ? '' : 'open'}" id="factory-unassigned">
            <div class="factory-header" onclick="window.toggleFactory('unassigned')">
                <div class="factory-header-left">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary);"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span class="factory-name" style="color: var(--text-secondary);">سایر NVRها (بدون دسته‌بندی کارخانه‌ای)</span>
                    <div class="factory-stats">
                        <span>${totalUnassigned} دوربین</span>
                        <span>·</span>
                        <span>${unassignedNvrIps.length} NVR</span>
                    </div>
                </div>
                <svg class="factory-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="factory-body">`;

        unassignedNvrIps.forEach(ip => {
            const nvrObj = nvrCache.find(n => n.ip === ip);
            const isNvrOffline = nvrObj && nvrObj.enabled !== false && nvrObj.status !== 'Online';
            const isAuthError = nvrObj && nvrObj.status === 'AuthError';
            const list = groups[ip] || [];
            const sorted = list.sort((a, b) => parseInt(a.channel_id) - parseInt(b.channel_id));
            const cards = sorted.map(c => window.createCard(c)).join('');
            const isNvrCollapsed = collapsedNvrs.has(ip);
            unassignedHtml += `
                <div class="nvr-block ${isNvrCollapsed ? '' : 'open'} ${isNvrOffline ? 'offline' : ''}">
                    <div class="nvr-header" onclick="window.toggleNvr(this)">
                        <div class="nvr-header-left">
                            <span class="nvr-badge ${isNvrOffline ? 'offline' : ''}">${window.getNvrDisplayName(ip)}</span>
                            <span class="nvr-ip">${ip}</span>
                            ${isAuthError ? `<span class="text-danger" style="font-size:11px; font-weight:bold; margin-right:8px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; background:var(--danger); border-radius:50%;"></span>خطای رمز عبور</span>` : (isNvrOffline ? `<span class="text-danger" style="font-size:11px; font-weight:bold; margin-right:8px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; background:var(--danger); border-radius:50%;"></span>قطع ارتباط</span>` : '')}
                        </div>
                        <svg class="nvr-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                    <div class="nvr-grid" style="${isNvrCollapsed ? 'display: none;' : ''}">${cards}</div>
                </div>`;
        });

        unassignedHtml += `</div></div>`;
        con.innerHTML += unassignedHtml;
    }
}

export function toggleReportBlock(header) {
    const block = header.closest('.report-block');
    if (block) {
        block.classList.toggle('collapsed');
    }
}

export function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

export function formatShamsiDate(dateInput) {
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

export async function cycleImpModal() {
    let n = currentImp + 1;
    if (n > 3) n = 1;
    await window.apiFetch(`${API}/cameras/${currentCamId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importance: n })
    });
    currentImp = n;
    document.getElementById('m-imp').textContent = ['کم', 'عادی', 'مهم'][n - 1];
    window.fetchDash();
}

export function notificationKey(eventType, channel = null) {
    const prefix = `NOTIFY_${eventType.toUpperCase()}`;
    return channel ? `${prefix}_${channel.toUpperCase()}` : `${prefix}_ENABLED`;
}

export function renderNotificationManagement() {
    const con = document.getElementById('config-forms');
    if (!con || !settingsCache.length) return;
    const values = Object.fromEntries(settingsCache.map(s => [s.key, s.value]));
    const isChecked = key => values[key] !== 'false' ? 'checked' : '';
    const rows = notificationEventCatalog.map(([eventType, title, desc]) => {
        const masterKey = window.notificationKey(eventType);
        const channels = [['email', 'ایمیل'], ['telegram', 'تلگرام'], ['browser', 'مرورگر']].map(([channel, label]) => {
            const key = window.notificationKey(eventType, channel);
            return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                <input type="checkbox" id="${key}" ${isChecked(key)}>
                <span>${label}</span>
            </label>`;
        }).join('');
        return `<div style="padding:14px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
                <div><strong style="font-size:13px;">${title}</strong><p style="margin:5px 0 0;font-size:12px;color:var(--text-secondary);">${desc}</p></div>
                <label class="toggle" title="فعال‌سازی همه کانال‌های این رویداد"><input type="checkbox" id="${masterKey}" ${isChecked(masterKey)} onchange="window.syncNotificationChannels('${eventType}')"><span class="toggle-slider"></span></label>
            </div>
            <div id="notification-channels-${eventType}" style="display:flex;gap:18px;margin-top:11px;padding-right:2px;">${channels}</div>
        </div>`;
    }).join('');
    con.insertAdjacentHTML('afterbegin', `<div class="card" id="grp-Notifications" style="display:none;">
        <div class="settings-card-header"><button class="settings-back-btn" onclick="window.goBackToSettingsMenu()" title="بازگشت به تنظیمات"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></button><h3>مدیریت مرکزی اعلان‌ها</h3></div>
        <div style="padding:0 20px 20px;"><p style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin:0;padding:16px 0 8px;">خاموش‌کردن هر مورد فقط ارسال اعلان را متوقف می‌کند؛ رویدادها و لاگ‌های سیستم همچنان ثبت می‌شوند.</p>${rows}<div class="settings-action-row"><button class="btn btn-primary" onclick="window.saveNotificationSettings()">ذخیره تنظیمات اعلان‌ها</button></div></div>
    </div>`);
    notificationEventCatalog.forEach(([eventType]) => window.syncNotificationChannels(eventType));
}

export function syncNotificationChannels(eventType) {
    const master = document.getElementById(window.notificationKey(eventType));
    const channels = document.getElementById(`notification-channels-${eventType}`);
    if (!master || !channels) return;
    channels.style.opacity = master.checked ? '1' : '.45';
    channels.querySelectorAll('input').forEach(input => input.disabled = !master.checked);
}

export async function saveNotificationSettings() {
    try {
        const keys = notificationEventCatalog.flatMap(([eventType]) => [window.notificationKey(eventType), ...['email', 'telegram', 'browser'].map(channel => window.notificationKey(eventType, channel))]);
        for (const key of keys) {
            const el = document.getElementById(key);
            const setting = settingsCache.find(s => s.key === key);
            if (el && setting && (el.checked ? 'true' : 'false') !== setting.value) {
                await window.apiFetch(`${API}/settings/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: el.checked ? 'true' : 'false' }) });
                setting.value = el.checked ? 'true' : 'false';
            }
        }
        window.showToast('تنظیمات مرکزی اعلان‌ها ذخیره شد', 'success');
    } catch (e) {
        window.showToast('خطا در ذخیره تنظیمات اعلان‌ها: ' + e.message, 'error');
    }
}

export function switchSettingsTab(tabId) {
    // Hide menu list container
    const menuCon = document.getElementById('settings-menu-container');
    if (menuCon) menuCon.style.display = 'none';

    // Show details container
    const detailsCon = document.getElementById('settings-detail-container');
    if (detailsCon) detailsCon.style.display = 'block';

    const tabs = ['sec-nvr', 'sec-groups', 'sec-users', 'sec-my-alerts', 'grp-Notifications', 'grp-Email', 'grp-Telegram', 'grp-Outages', 'grp-Browser', 'grp-Limits', 'sec-system', 'sec-tasks', 'sec-about', 'sec-logs'];
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = id === tabId ? 'block' : 'none';
        }
    });

    if (tabId === 'sec-logs') {
        window.resetLogs();
    }
    if (tabId === 'grp-Browser') {
        window.updateBrowserAlertsUI();
    }
    if (tabId === 'sec-groups') {
        window.renderGroupsList();
    }
    if (tabId === 'sec-users') {
        window.loadUsers();
    }
    if (tabId === 'sec-my-alerts') {
        window.loadMyAlerts();
    }
    if (tabId === 'sec-tasks') {
        window.loadScheduledTasks();
    }
}

export function goBackToSettingsMenu() {
    // Hide details container
    const detailsCon = document.getElementById('settings-detail-container');
    if (detailsCon) detailsCon.style.display = 'none';

    // Hide all card tabs
    const tabs = ['sec-nvr', 'sec-groups', 'sec-users', 'sec-my-alerts', 'grp-Notifications', 'grp-Email', 'grp-Telegram', 'grp-Outages', 'grp-Browser', 'grp-Limits', 'sec-system', 'sec-tasks', 'sec-about', 'sec-logs'];
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Show menu list container
    const menuCon = document.getElementById('settings-menu-container');
    if (menuCon) menuCon.style.display = 'block';
}

export function renderSettingsMenu(role) {
    const menuList = document.getElementById('settings-menu-list');
    if (!menuList) return;

    const allItems = {
        'sec-groups': {
            title: 'کارخانه‌ها / گروه‌ها',
            desc: 'تعریف و مدیریت کارخانجات و گروه‌های مانیتورینگ تحت پوشش',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
            roles: ['admin']
        },
        'sec-nvr': {
            title: 'دستگاه‌های NVR',
            desc: 'مدیریت اطلاعات و اتصالات ضبط‌کننده‌های ویدئویی شبکه (NVRs)',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
            roles: ['admin']
        },
        'sec-users': {
            title: 'مدیریت کاربران',
            desc: 'تعریف و ویرایش حساب‌ها، کلمه‌های عبور و سطوح دسترسی کارکنان',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
            roles: ['admin']
        },
        'grp-Email': {
            title: 'تنظیمات ایمیل',
            desc: 'پیکربندی سرور خروجی SMTP و فهرست گیرندگان هشدارهای ایمیلی',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
            roles: ['admin']
        },
        'grp-Telegram': {
            title: 'تنظیمات تلگرام',
            desc: 'پیکربندی توکن ربات اطلاع‌رسان و شناسه‌های گفتگوی کانال/گروه',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
            roles: ['admin']
        },
        'grp-Notifications': {
            title: 'مدیریت اعلان‌ها',
            desc: 'کنترل روشن یا خاموش بودن هر رویداد و کانال ارسال آن، بدون حذف لاگ‌ها',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
            roles: ['admin']
        },
        'grp-Outages': {
            title: 'تنظیمات قطعی‌ها',
            desc: 'تنظیم مهلت ثبت علت قطعی دوربین‌ها و زمان‌بندی تحلیل خودکار',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
            roles: ['admin']
        },
        'grp-Browser': {
            title: 'اعلان‌های مرورگر',
            desc: 'فعال‌سازی پخش هشدار صوتی و نوتیفیکیشن دسکتاپ هنگام تغییر وضعیت',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
            roles: ['admin', 'it_manager', 'inspector', 'group_view']
        },
        'grp-Limits': {
            title: 'مدیریت محدودیت‌ها',
            desc: 'تنظیم سقف اتصال‌های همزمان، محدودیت‌های امنیتی، تایم‌اوت‌ها و ماندگاری لاگ‌ها',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
            roles: ['admin']
        },
        'sec-my-alerts': {
            title: 'اعلان‌های شخصی من',
            desc: 'پیکربندی گیرندگان هشدار شخصی شما (ایمیل و چت‌آیدی تلگرام)',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
            roles: ['it_manager', 'inspector', 'group_view']
        },
        'sec-tasks': {
            title: 'وظایف زمان‌بندی‌شده',
            desc: 'پایش و تحریک دستی وظایف دوره‌ای سیستم (پاکسازی، گزارش‌گیری و...)',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
            roles: ['admin']
        },
        'sec-logs': {
            title: 'لاگ‌های سیستم',
            desc: 'مشاهده رویدادها، خطاهای ارتباطی و لاگ ارسال هشدارهای سیستمی',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
            roles: ['admin']
        },
        'sec-system': {
            title: 'کنترل سیستم',
            desc: 'اعمال تنظیمات و راه‌اندازی مانیتور، پشتیبان‌گیری و عملیات دیتابیس',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
            roles: ['admin']
        },
        'sec-about': {
            title: 'درباره ما',
            desc: 'مشخصات فنی و راه‌های ارتباطی با تیم طراح و توسعه‌دهنده سامانه',
            icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
            roles: ['admin', 'it_manager', 'inspector', 'group_view']
        }
    };

    let html = '';
    for (const [id, item] of Object.entries(allItems)) {
        if (item.roles.includes(role)) {
            html += `
                <div class="settings-menu-item" onclick="window.switchSettingsTab('${id}')">
                    <div class="settings-menu-item-left">
                        <div class="settings-menu-item-icon">
                            ${item.icon}
                        </div>
                        <div class="settings-menu-item-text">
                            <span class="settings-menu-item-title">${item.title}</span>
                            <span class="settings-menu-item-desc">${item.desc}</span>
                        </div>
                    </div>
                    <div class="settings-menu-item-chevron">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </div>
                </div>
            `;
        }
    }
    menuList.innerHTML = html;
}

export function updateOutageDaysValue() {
    const chks = document.querySelectorAll('.day-select-chk');
    const selected = [];
    chks.forEach(c => {
        if (c.checked) {
            selected.push(c.value);
        }
    });
    const hiddenInput = document.getElementById('OUTAGE_ANALYSIS_DAYS');
    if (hiddenInput) {
        hiddenInput.value = selected.join(',');
    }
}

export function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        background: ${type === 'error' ? 'var(--danger)' : (type === 'success' ? 'var(--success)' : 'var(--surface-2)')};
        color: ${type === 'error' || type === 'success' ? 'white' : 'var(--text)'};
        padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4); z-index: 9999;
        border: 1px solid ${type === 'error' ? 'var(--danger)' : (type === 'success' ? 'var(--success)' : 'var(--border)')};
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

export function showConfirm(message, title = 'تایید عملیات', isDangerous = true) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    
    const okBtn = document.getElementById('confirm-ok-btn');
    if (isDangerous) {
        okBtn.style.background = 'var(--danger)';
        okBtn.style.borderColor = 'var(--danger)';
    } else {
        okBtn.style.background = 'var(--primary)';
        okBtn.style.borderColor = 'var(--primary)';
    }

    document.getElementById('confirmModal').classList.add('open');
    
    return new Promise((resolve) => {
        confirmPromiseResolver = resolve;
    });
}

export function closeConfirmModal(result) {
    document.getElementById('confirmModal').classList.remove('open');
    if (confirmPromiseResolver) {
        confirmPromiseResolver(result);
        confirmPromiseResolver = null;
    }
}

export function delayLogSearch() {
    clearTimeout(logTimer);
    logTimer = setTimeout(() => {
        logSearchVal = document.getElementById('logSearch').value;
        window.resetLogs();
    }, 500);
}

export function setLogLevelFilter(val) {
    logLevelFilter = val;
    window.resetLogs();
}

export function setFilter(btn, val) {
    document.querySelectorAll('.filter-chips .chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    logFilter = val;
    window.resetLogs();
}

export function translateLogDetails(text) {
    if (!text) return "";
    let t = text;
    // NVR reconnected
    t = t.replace(/(\S+) reconnected/g, "اتصال مجدد $1 برقرار شد");
    // NVR auth error
    t = t.replace(/NVR auth error/g, "خطای احراز هویت NVR");
    // NVR offline
    t = t.replace(/NVR offline/g, "قطع ارتباط با NVR");
    // NVR failed connection exception
    t = t.replace(/Failed: HTTPConnectionPool.*/g, "خطا در اتصال به دستگاه (Connection Timeout)");
    // Monitor loop initialized (via scheduler)
    t = t.replace(/Monitor loop initialized \(via scheduler\)/g, "راه‌اندازی سرویس مانیتورینگ (توسط زمان‌بند)");
    // Sent X alerts for group Y
    t = t.replace(/Sent (\d+) alerts for group (\d+)/g, "ارسال $1 هشدار برای گروه $2");
    // Hourly Summary
    t = t.replace(/Hourly Summary/g, "گزارش خلاصه ساعتی");
    return t;
}

export function div(a, b) {
    return ~~(a / b);
}

export function mod(a, b) {
    return a - ~~(a / b) * b;
}

export function jalCalCore(jy) {
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
        leapJ = leapJ + div(jump, 33) * 8 + div(window.mod(jump, 33), 4);
        jp = jm;
    }
    const n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(window.mod(n, 33) + 3, 4);
    if (window.mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    return {
        gy,
        march,
        jump,
        n
    };
}

export function g2d(gy, gm, gd) {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * window.mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
}

export function d2g(jdn) {
    let j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(window.mod(j, 1461), 4) * 5 + 308;
    const gd = div(window.mod(i, 153), 5) + 1;
    const gm = window.mod(div(i, 153), 12) + 1;
    const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return {
        gy,
        gm,
        gd
    };
}

export function jalCalShort(jy) {
    const { gy, march } = window.jalCalCore(jy);
    return {
        gy,
        march
    };
}

export function j2d(jy, jm, jd) {
    const r = window.jalCalShort(jy);
    return window.g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function jalaliToGregorian(jy, jm, jd) {
    const g = window.d2g(window.j2d(jy, jm, jd));
    return [g.gy, g.gm, g.gd];
}

export function formatPersianDateTime(date) {
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

export function parsePersianDateTime(val) {
    if (!val) return null;
    const match = val.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (!match) return null;
    const jy = parseInt(match[1]);
    const jm = parseInt(match[2]);
    const jd = parseInt(match[3]);
    const hour = match[4] ? parseInt(match[4]) : 0;
    const minute = match[5] ? parseInt(match[5]) : 0;
    const [gy, gm, gd] = window.jalaliToGregorian(jy, jm, jd);
    return new Date(gy, gm - 1, gd, hour, minute, 0);
}

export function setPreset(h) {
    const end = new Date();
    const start = new Date(end.getTime() - (h * 60 * 60 * 1000));
    document.getElementById('startDt').value = window.formatPersianDateTime(start);
    document.getElementById('endDt').value = window.formatPersianDateTime(end);
}

export function toggleReportSection(forceHeatmap = null) {
    const listSection = document.getElementById('report-list-section');
    const heatmapSection = document.getElementById('report-heatmap-section');
    if (listSection) listSection.classList.remove('hidden');
    if (heatmapSection) heatmapSection.classList.remove('hidden');
}

export function switchChartTab(tabId) {
    const tabs = document.querySelectorAll('.chart-tab-content');
    tabs.forEach(t => t.style.display = 'none');
    
    const activeTab = document.getElementById(tabId);
    if (activeTab) {
        activeTab.style.display = 'block';
    }
    
    const navButtons = document.querySelectorAll('#charts-nav button');
    navButtons.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Chart.js cannot calculate size when display is none.
    // Triggering a resize when the tab becomes visible fixes the empty chart issue.
    if (tabId === 'tab-chart-trend' && chartTrendInstance) chartTrendInstance.resize();
    if (tabId === 'tab-chart-causes' && chartCausesInstance) chartCausesInstance.resize();
    if (tabId === 'tab-chart-groups' && chartGroupsInstance) chartGroupsInstance.resize();
    if (tabId === 'tab-chart-top' && chartTopCamerasInstance) chartTopCamerasInstance.resize();
    if (tabId === 'tab-chart-status' && chartStatusInstance) chartStatusInstance.resize();
}

export function getChartColor(varName, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
}

export function renderTrendChart(chartData) {
    const ctx = document.getElementById('chart-trend');
    if (!ctx) return;
    
    if (chartTrendInstance) {
        chartTrendInstance.destroy();
    }
    
    const textColor = window.getChartColor('--text', '#f1f5f9');
    const gridColor = window.getChartColor('--border', '#2a2a36');
    
    chartTrendInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'مجموع ساعت قطعی روزانه',
                data: chartData.data,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index' },
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'inherit' } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'inherit' } },
                    beginAtZero: true
                }
            }
        }
    });
}

export function renderCausesChart(chartData) {
    const ctx = document.getElementById('chart-causes');
    if (!ctx) return;
    
    if (chartCausesInstance) {
        chartCausesInstance.destroy();
    }
    
    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
        chartCausesInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['بدون علت ثبت‌شده'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(128, 128, 128, 0.2)']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index' },
                animation: { duration: 1000, easing: 'easeOutQuart' },
                plugins: {
                    legend: { labels: { color: window.getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } } }
                }
            }
        });
        return;
    }
    
    chartCausesInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: chartData.labels,
            datasets: [{
                data: chartData.data,
                backgroundColor: ['#f43f5e', '#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#eab308'],
                borderWidth: 1,
                borderColor: window.getChartColor('--surface', '#12121a')
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index' },
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: window.getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                }
            }
        }
    });
}

export function renderGroupsChart(chartData) {
    const ctx = document.getElementById('chart-groups');
    if (!ctx) return;
    
    if (chartGroupsInstance) {
        chartGroupsInstance.destroy();
    }
    
    chartGroupsInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'مجموع ساعت قطعی',
                data: chartData.data,
                backgroundColor: 'rgba(59, 130, 246, 0.75)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index' },
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: window.getChartColor('--border', '#2a2a36') },
                    ticks: { color: window.getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                },
                y: {
                    grid: { color: window.getChartColor('--border', '#2a2a36') },
                    ticks: { color: window.getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } },
                    beginAtZero: true
                }
            }
        }
    });
}

export function renderTopCamerasChart(chartData) {
    const ctx = document.getElementById('chart-top-cameras');
    if (!ctx) return;
    
    if (chartTopCamerasInstance) {
        chartTopCamerasInstance.destroy();
    }
    
    chartTopCamerasInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'ساعت قطعی',
                data: chartData.data,
                backgroundColor: 'rgba(239, 68, 68, 0.75)',
                borderColor: '#ef4444',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index' },
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: window.getChartColor('--border', '#2a2a36') },
                    ticks: { color: window.getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } },
                    beginAtZero: true
                },
                y: {
                    grid: { color: window.getChartColor('--border', '#2a2a36') },
                    ticks: { color: window.getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                }
            }
        }
    });
}

export function renderStatusChart(chartData) {
    const ctx = document.getElementById('chart-status');
    if (!ctx) return;
    
    if (chartStatusInstance) {
        chartStatusInstance.destroy();
    }
    
    chartStatusInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: chartData.labels,
            datasets: [{
                data: chartData.data,
                backgroundColor: ['#22c55e', '#ef4444'],
                borderWidth: 1,
                borderColor: window.getChartColor('--surface', '#12121a')
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index' },
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: window.getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                }
            }
        }
    });
}

export function checkAdminPasswordWarning() {
    if (localStorage.getItem('admin_plain_password') === '1') {
        document.getElementById('securityWarningModal').classList.add('open');
    }
}

export function closeSecurityWarning() {
    document.getElementById('securityWarningModal').classList.remove('open');
    localStorage.removeItem('admin_plain_password');
}

export function setConnectionStatus(connected) {
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

export function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
        wsRetryDelay = 1000;
        window.setConnectionStatus(true);
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'cameras') {
            window.updateDashFromWS(msg.data);
        } else if (msg.type === 'alert') {
            window.handleIncomingAlert(msg);
        } else if (msg.type === 'task_status') {
            window.handleTaskStatusUpdate(msg.data);
        }
    };

    ws.onclose = () => {
        window.setConnectionStatus(false);
        setTimeout(connectWS, wsRetryDelay);
        wsRetryDelay = Math.min(wsRetryDelay * 2, 30000);
    };

    ws.onerror = () => ws.close();
}

export function updateDashFromWS(cams) {
    dashCamerasCache = cams;

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

    // NVR status
    const activeNvrs = nvrCache.filter(n => n.enabled !== false);
    const nvrOn = activeNvrs.filter(n => n.status === 'Online').length;
    const nvrOff = activeNvrs.filter(n => n.status !== 'Online').length;
    const sNvrTot = document.getElementById('s-nvr-tot');
    const sNvrOn = document.getElementById('s-nvr-on');
    const sNvrOff = document.getElementById('s-nvr-off');
    if (sNvrTot) sNvrTot.textContent = activeNvrs.length;
    if (sNvrOn) sNvrOn.textContent = nvrOn;
    if (sNvrOff) sNvrOff.textContent = nvrOff;

    // Factory summary
    const factoryCountEl = document.getElementById('s-factory-count');
    if (factoryCountEl) factoryCountEl.textContent = groupCache.length;

    const factorySummaryContent = document.getElementById('factory-summary-content');
    if (factorySummaryContent) {
        let summaryHtml = '';
        groupCache.forEach(g => {
            const groupNvrs = nvrCache.filter(n => n.group_id === g.id);
            const activeGroupNvrs = groupNvrs.filter(n => n.enabled !== false);
            const offlineGroupNvrs = activeGroupNvrs.filter(n => n.status !== 'Online');

            const groupCamCount = cams.filter(c => {
                const nvr = nvrCache.find(n => n.ip === c.nvr_ip);
                return nvr && nvr.group_id === g.id;
            });
            const offlineGroupCams = groupCamCount.filter(c => c.status !== 'Online');

            let camText = `${groupCamCount.length} دوربین`;
            if (offlineGroupCams.length > 0) {
                camText += ` <span class="text-danger" style="font-weight: bold;">(${offlineGroupCams.length} قطع)</span>`;
            }

            let nvrText = `${activeGroupNvrs.length} NVR`;
            if (offlineGroupNvrs.length > 0) {
                nvrText += ` <span class="text-danger" style="font-weight: bold;">(${offlineGroupNvrs.length} قطع)</span>`;
            }

            summaryHtml += `<div class="stat-row"><span class="stat-label">${g.name}</span><span class="stat-value" style="font-size:13px; color: var(--text-secondary);">${camText} · ${nvrText}</span></div>`;
        });

        // Unassigned NVRs summary
        const unassignedNvrs = nvrCache.filter(n => !n.group_id && n.enabled !== false);
        const offlineUnassigned = unassignedNvrs.filter(n => n.status !== 'Online');
        const unassignedCamCount = cams.filter(c => {
            const nvr = nvrCache.find(n => n.ip === c.nvr_ip);
            return nvr && !nvr.group_id;
        });
        const offlineUnassignedCams = unassignedCamCount.filter(c => c.status !== 'Online');

        if (unassignedNvrs.length > 0) {
            let camText = `${unassignedCamCount.length} دوربین`;
            if (offlineUnassignedCams.length > 0) {
                camText += ` <span class="text-danger" style="font-weight: bold;">(${offlineUnassignedCams.length} قطع)</span>`;
            }

            let nvrText = `${unassignedNvrs.length} NVR`;
            if (offlineUnassigned.length > 0) {
                nvrText += ` <span class="text-danger" style="font-weight: bold;">(${offlineUnassigned.length} قطع)</span>`;
            }

            summaryHtml += `<div class="stat-row"><span class="stat-label" style="color: var(--text-secondary);">سایر NVRها</span><span class="stat-value" style="font-size:13px; color: var(--text-secondary);">${camText} · ${nvrText}</span></div>`;
        }

        if (summaryHtml) {
            factorySummaryContent.innerHTML = summaryHtml;
        } else {
            factorySummaryContent.innerHTML = '<div class="stat-row"><span class="stat-label" style="color: var(--text-secondary);">بدون کارخانه</span></div>';
        }
    }

    window.renderDash();
    window.renderImportantCamerasWidget();
    window.renderOffCamerasWidget();
    window.renderCameraChangesWidget();
    window.renderNvrHealthWidget();
    window.renderNvrHealthSummaryWidget();
    window.renderDashboardCharts();

    const dashLoader = document.getElementById('dashLoader');
    if (dashLoader) dashLoader.classList.add('hidden');
    const initialLoading = document.getElementById('initial-loading-screen');
    if (initialLoading) {
        initialLoading.style.opacity = '0';
        setTimeout(() => {
            initialLoading.style.display = 'none';
        }, 400);
    }

    if (typeof map !== 'undefined' && map && typeof updateMapMarkersFromWS === 'function') {
        window.updateMapMarkersFromWS(cams);
    }
}

export function applyTheme(theme) {
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');

    let actualTheme = theme;
    if (theme === 'system') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            actualTheme = 'light';
        } else {
            actualTheme = 'dark';
        }
    }

    if (actualTheme === 'light') {
        root.setAttribute('data-theme', 'light');
        if (meta) meta.setAttribute('content', '#f8fafc');
    } else {
        root.removeAttribute('data-theme');
        if (meta) meta.setAttribute('content', '#0a0a0f');
    }

    localStorage.setItem('hikstatus-theme', theme);
    window.updateThemeIcon(theme);
}

export function toggleTheme() {
    const currentTheme = localStorage.getItem('hikstatus-theme') || 'system';
    let nextTheme = 'light';
    if (currentTheme === 'system') {
        nextTheme = 'light';
    } else if (currentTheme === 'light') {
        nextTheme = 'dark';
    } else if (currentTheme === 'dark') {
        nextTheme = 'system';
    }

    window.applyTheme(nextTheme);

    let themeLabel = '';
    if (nextTheme === 'system') themeLabel = 'هماهنگ با سیستم';
    else if (nextTheme === 'light') themeLabel = 'روشن';
    else if (nextTheme === 'dark') themeLabel = 'تاریک';

    if (typeof showToast === 'function') {
        window.showToast(`پوسته به حالت «${themeLabel}» تغییر یافت`);
    }
}

export function updateThemeIcon(theme) {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    const currentTheme = theme || localStorage.getItem('hikstatus-theme') || 'system';

    if (currentTheme === 'system') {
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
        `;
        btn.setAttribute('title', 'پوسته: هماهنگ با سیستم');
    } else if (currentTheme === 'light') {
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
        `;
        btn.setAttribute('title', 'پوسته: روشن');
    } else {
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
        `;
        btn.setAttribute('title', 'پوسته: تاریک');
    }
}

export function isKioskActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || document.body.classList.contains('kiosk-mode'));
}

export function updateKioskUIState() {
    const isFS = window.isKioskActive();
    if (isFS) {
        document.body.classList.add('kiosk-mode');
    } else {
        document.body.classList.remove('kiosk-mode');
    }
    const btn = document.getElementById('btn-kiosk-toggle');
    if (btn) {
        btn.classList.toggle('active', isFS);
        btn.setAttribute('title', isFS ? 'خروج از حالت کیوسک' : 'حالت کیوسک (تمام‌صفحه)');
    }
}

export function toggleKiosk() {
    const doc = document.documentElement;
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);

    if (!isFS) {
        const req = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
        if (req) {
            const p = req.call(doc);
            if (p && typeof p.then === 'function') {
                p.then(() => {
                    document.body.classList.add('kiosk-mode');
                    window.updateKioskUIState();
                }).catch((err) => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                    document.body.classList.toggle('kiosk-mode');
                    window.updateKioskUIState();
                });
            } else {
                document.body.classList.add('kiosk-mode');
                window.updateKioskUIState();
            }
        } else {
            document.body.classList.toggle('kiosk-mode');
            window.updateKioskUIState();
        }
    } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exit) {
            const p = exit.call(document);
            if (p && typeof p.catch === 'function') {
                p.catch((err) => {
                    console.error(`Error attempting to exit fullscreen: ${err.message}`);
                });
            }
        }
        document.body.classList.remove('kiosk-mode');
        window.updateKioskUIState();
    }
}

export function initKioskListeners() {
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
        document.addEventListener(evt, () => {
            const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
            if (!isFS) {
                document.body.classList.remove('kiosk-mode');
            } else {
                document.body.classList.add('kiosk-mode');
            }
            window.updateKioskUIState();
        });
    });
}

export function initBrowserAlerts() {
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

    window.updateBrowserAlertsUI();
}

export function updateBrowserAlertsUI() {
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

export async function toggleBrowserAlerts(checkbox) {
    if (checkbox.checked) {
        if (!("Notification" in window)) {
            window.showToast("این مرورگر از اعلان‌ها پشتیبانی نمی‌کند", "error");
            checkbox.checked = false;
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            localStorage.setItem('BROWSER_ALERT_ENABLED', 'true');
            window.showToast("اعلان‌های دسکتاپ فعال شدند");
        } else {
            localStorage.setItem('BROWSER_ALERT_ENABLED', 'false');
            checkbox.checked = false;
            window.showToast("مجوز اعلان صادر نشد", "error");
        }
    } else {
        localStorage.setItem('BROWSER_ALERT_ENABLED', 'false');
        window.showToast("اعلان‌های دسکتاپ غیرفعال شدند");
    }
    window.updateBrowserAlertsUI();
}

export function toggleGlobalMute(checkbox) {
    localStorage.setItem('BROWSER_ALERT_MUTED', checkbox.checked ? 'true' : 'false');
    window.showToast(checkbox.checked ? "صداها بی‌صدا شدند" : "صداها فعال شدند");
}

export function toggleCategoryNotify(category, checkbox) {
    localStorage.setItem(`BROWSER_NOTIFY_${category.toUpperCase()}_ENABLED`, checkbox.checked ? 'true' : 'false');
}

export function toggleCategorySound(category, checkbox) {
    localStorage.setItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`, checkbox.checked ? 'true' : 'false');
}

export function playSynthesizedSound(category) {
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

export function testSound(category) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return window.showToast("مرورگر شما از صدا پشتیبانی نمی‌کند", "error");
    
    const originalMute = localStorage.getItem('BROWSER_ALERT_MUTED');
    const originalSoundVal = localStorage.getItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`);
    
    localStorage.setItem('BROWSER_ALERT_MUTED', 'false');
    localStorage.setItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`, 'true');
    
    window.playSynthesizedSound(category);
    
    localStorage.setItem('BROWSER_ALERT_MUTED', originalMute);
    localStorage.setItem(`BROWSER_SOUND_${category.toUpperCase()}_ENABLED`, originalSoundVal);
}

export function testBrowserNotification() {
    if (!("Notification" in window)) {
        return window.showToast("این مرورگر از اعلان‌ها پشتیبانی نمی‌کند", "error");
    }

    if (Notification.permission !== "granted") {
        Notification.requestPermission().then(permission => {
            window.updateBrowserAlertsUI();
            if (permission === "granted") {
                window.sendTestNotification();
            } else {
                window.showToast("مجوز اعلان صادر نشد. لطفاً مجوز را دستی فعال کنید.", "error");
            }
        });
    } else {
        window.sendTestNotification();
    }
}

export function sendTestNotification() {
    const notification = new Notification("تست اعلان HikStatus", {
        body: "سیستم اعلان مرورگر به درستی کار می‌کند!",
        icon: '/static/logo.webp',
        dir: 'rtl'
    });
    
    window.playSynthesizedSound('recovery');
    window.showToast("اعلان آزمایشی ارسال شد");
    
    notification.onclick = () => {
        window.focus();
        window.nav('dash');
        notification.close();
    };
}

export function handleIncomingAlert(msg) {
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
            window.nav('dash');
            notification.close();
        };
    }

    window.playSynthesizedSound(category);
}

export function populateMapGroupSelect() {
    const sel = document.getElementById('map-group-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">همه دوربین‌ها</option>';
    groupsCache.forEach(g => {
        sel.innerHTML += `<option value="${g.id}">${g.name}</option>`;
    });
    if (prev) sel.value = prev;
}

export async function onMapGroupChange(groupId) {
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
        await window.loadGroupPlans(currentGroupId);
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

    window.renderPlanTabs();
    window.setupLeafletMap(true);
    window.renderMapCameraList();
}

export function renderPlanTabs() {
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
        return `<div style="display:inline-flex;align-items:center;gap:4px;background:${isActive ? 'var(--primary)' : 'var(--bg-tertiary)'};color:${isActive ? '#fff' : 'var(--text-secondary)'};border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;white-space:nowrap;" onclick="window.switchPlan(${p.id})">
            <span>${p.name}</span>
            <span onclick="window.deletePlan(${p.id});event.stopPropagation();" style="cursor:pointer;opacity:0.7;font-size:14px;line-height:1;" title="حذف">&times;</span>
        </div>`;
    }).join('');
}

export function switchPlan(planId) {
    const plan = mapPlans.find(p => p.id === planId);
    if (!plan) return;
    activePlanId = planId;
    mapImage = plan.image_url;
    window.renderPlanTabs();
    window.setupLeafletMap(true);
    window.renderMapCameraList();
}

export async function initOrRefreshMap() {
    if (settingsCache.length === 0) {
        try {
            const sRes = await fetch(`${API}/settings`);
            settingsCache = await sRes.json();
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    await window.loadGroupsCache();
    window.populateMapGroupSelect();

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
        await window.loadGroupPlans(currentGroupId);
    }

    document.getElementById('btn-map-floor').classList.toggle('active', mapType === 'floor');
    document.getElementById('btn-map-geo').classList.toggle('active', mapType === 'geo');
    document.getElementById('upload-plan-section').style.display = mapType === 'floor' ? 'block' : 'none';

    try {
        const nRes = await window.apiFetch(`${API}/nvrs`);
        nvrCache = await nRes.json();
    } catch (e) {
        console.error('Failed to load NVRs:', e);
    }

    try {
        const camRes = await window.apiFetch(`${API}/cameras`);
        mapCamerasList = await camRes.json();
        mapCamerasList.forEach(c => {
            const nvr = nvrCache.find(n => n.ip === c.nvr_ip);
            c.group_id = nvr ? nvr.group_id : null;
        });
    } catch (e) {
        console.error('Failed to load cameras:', e);
    }

    window.renderPlanTabs();
    window.setupLeafletMap();
    window.renderMapCameraList();
}

export function setupLeafletMap(ignoreRestored = false) {
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

            window.drawCameraMarkers(bounds, w, h);
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

        window.drawCameraMarkers();
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
        window.closeMapFovSection();
    });
}

export function getFovPolygonPoints(centerLatLng, radius, angle, spread) {
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

export function getFovPolygonPointsGeo(centerLatLng, radiusMeters, angle, spread) {
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

export function calculateFovPoints(c, latlng) {
    const angle = c.fov_angle || 0;
    const radius = c.fov_radius || 50;
    const spread = c.fov_spread || 60;

    if (mapType === 'floor') {
        return window.getFovPolygonPoints(latlng, radius, angle, spread);
    } else {
        return window.getFovPolygonPointsGeo(latlng, radius, angle, spread);
    }
}

export function getMarkerPopupContent(c) {
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
                    <input type="checkbox" id="popup-fov-enable-${c.id}" ${isFovEnabled ? 'checked' : ''} onchange="window.toggleMarkerFov(${c.id}, this.checked)">
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
                    <input type="range" min="0" max="360" value="${c.fov_angle || 0}" style="width: 100%; accent-color: var(--primary);" oninput="window.updateMarkerFovVal(${c.id}, 'angle', this.value)">
                </div>
                <div style="margin-bottom: 8px;">
                    <div style="display:flex; justify-content:space-between; font-size: 11px; color: var(--text-secondary);">
                        <span>برد (شعاع)</span>
                        <span id="lbl-radius-${c.id}" style="color: var(--primary-hover); font-weight: bold;">${c.fov_radius || 50}</span>
                    </div>
                    <input type="range" min="5" max="500" value="${c.fov_radius || 50}" style="width: 100%; accent-color: var(--primary);" oninput="window.updateMarkerFovVal(${c.id}, 'radius', this.value)">
                </div>
                <div style="margin-bottom: 8px;">
                    <div style="display:flex; justify-content:space-between; font-size: 11px; color: var(--text-secondary);">
                        <span>زاویه بازشو</span>
                        <span id="lbl-spread-${c.id}" style="color: var(--primary-hover); font-weight: bold;">${c.fov_spread || 60}°</span>
                    </div>
                    <input type="range" min="10" max="180" value="${c.fov_spread || 60}" style="width: 100%; accent-color: var(--primary);" oninput="window.updateMarkerFovVal(${c.id}, 'spread', this.value)">
                </div>
            </div>
            
            <!-- Remove from Map Button -->
            <button onclick="window.removeCameraFromMap(${c.id})" style="
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

export function updateMarkerFovVal(id, field, value) {
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
        const pts = window.calculateFovPoints(c, marker.getLatLng());
        marker.fovPolygon.setLatLngs(pts);
    }

    window.saveFovDebounced(id, c.fov_angle, c.fov_radius, c.fov_spread);
}

export function createMarkerForMap(c, latlng) {
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
        const pts = window.calculateFovPoints(c, latlng);
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
    });

    if (mapClusterGroup && !mapEditMode) {
        mapClusterGroup.addLayer(marker);
    } else {
        marker.addTo(map);
    }

    marker.camera_id = c.id;
    marker.fovPolygon = fovPolygon;

    marker.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        window.selectMarkerForFov(marker, c);
    });

    marker.on('drag', function (e) {
        if (marker.fovPolygon) {
            const position = marker.getLatLng();
            const pts = window.calculateFovPoints(c, position);
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

        await window.apiFetch(`${API}/cameras/${c.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        window.showToast(`موقعیت دوربین "${c.name}" ذخیره شد`);
    });

    mapMarkers.push(marker);
    return marker;
}

export function updateMapMarkersFromWS(cams) {
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
    window.renderMapCameraList();
}

export function toggleMapEditMode() {
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

    window.setupLeafletMap();
}

export function applyRoleUI() {
    if (!window.currentUser) return;
    const role = window.currentUser.role;
    
    // Hide navigation views
    document.querySelectorAll('[data-view="logs"]').forEach(el => {
        el.style.display = (role === 'admin') ? '' : 'none';
    });
    document.querySelectorAll('[data-view="reports"]').forEach(el => {
        el.style.display = (role === 'admin' || role === 'it_manager' || role === 'inspector') ? '' : 'none';
    });
    document.querySelectorAll('[data-view="outages"]').forEach(el => {
        el.style.display = (role === 'admin' || role === 'it_manager' || role === 'inspector') ? '' : 'none';
    });
    document.querySelectorAll('[data-view="settings"]').forEach(el => {
        el.style.display = '';
    });

    const editBtn = document.getElementById('btn-edit-positions');
    if (editBtn) {
        editBtn.style.display = (role === 'admin') ? '' : 'none';
    }

    const headerUsername = document.getElementById('header-username');
    if (headerUsername) {
        headerUsername.textContent = window.currentUser.username;
    }
}

export function populateInspectorGroupsList() {
    const listCon = document.getElementById('inspector-groups-list');
    if (!listCon) return;
    if (!groupCache || groupCache.length === 0) {
        listCon.innerHTML = '<span style="font-size: 12px; color: var(--text-muted); grid-column: 1 / -1;">کارخانه‌ای تعریف نشده است</span>';
        return;
    }
    listCon.innerHTML = groupCache.map(g => `
        <label style="font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; background: var(--surface); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);">
            <input type="checkbox" class="inspector-group-cb" value="${g.id}" onchange="window.updateInspectorSelectAllState()">
            <span style="user-select: none;">${g.name}</span>
        </label>
    `).join('');
    window.updateInspectorSelectAllState();
}

export function toggleAllInspectorGroups(checked) {
    const checkboxes = document.querySelectorAll('.inspector-group-cb');
    checkboxes.forEach(cb => cb.checked = checked);
}

export function updateInspectorSelectAllState() {
    const checkboxes = document.querySelectorAll('.inspector-group-cb');
    const selectAllCb = document.getElementById('inspector-select-all');
    if (!selectAllCb || checkboxes.length === 0) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    selectAllCb.checked = allChecked;
}

export function renderUsersList() {
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
            'admin': 'مدیر سیستم',
            'it_manager': 'مسئول آی‌تی',
            'inspector': 'ناظر'
        }[u.role] || u.role;
        
        let detailsText = `نقش: ${roleLabel}`;
        if (u.role === 'inspector' || u.role === 'it_manager') {
            if (!u.accessible_group_ids) {
                detailsText += ` | دسترسی کارخانه‌ها: همه کارخانه‌ها`;
            } else {
                const ids = u.accessible_group_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
                const names = ids.map(id => groupCache.find(g => g.id === id)?.name || id).join('، ');
                detailsText += ` | دسترسی کارخانه‌ها: ${names || 'هیچ‌کدام'}`;
            }
        } else if (u.role !== 'admin') {
            detailsText += ` | کارخانه: ${groupName}`;
        }
        
        return `<div class="list-item">
            <div class="list-item-info">
                <strong>${u.username}</strong>
                <span style="font-size:12px; opacity:0.7; margin-right:15px;">${detailsText}</span>
            </div>
            <div class="list-item-actions" style="display: flex; gap: 8px;">
                <button class="btn btn-ghost" onclick="window.openEditUserModal(${u.id})" style="color:var(--primary); padding: 4px 8px;">ویرایش</button>
                <button class="btn btn-ghost" onclick="window.deleteUser(${u.id})" style="color:var(--danger); padding: 4px 8px;">حذف</button>
            </div>
        </div>`;
    }).join('');
}

export function openProfileModal() {
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
    
    window.cancel2FASetup();
    window.update2FAUIState();
    
    document.getElementById('profileModal').classList.add('open');
}

export function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('open');
}

export function update2FAUIState() {
    const isEnabled = window.currentUser && window.currentUser.two_factor_enabled;
    const disabledSec = document.getElementById('p-2fa-disabled-section');
    const setupSec = document.getElementById('p-2fa-setup-section');
    const enabledSec = document.getElementById('p-2fa-enabled-section');
    
    if (!disabledSec || !setupSec || !enabledSec) return;
    
    if (isEnabled) {
        disabledSec.style.display = 'none';
        setupSec.style.display = 'none';
        enabledSec.style.display = 'block';
        document.getElementById('p-2fa-disable-password').value = '';
    } else {
        disabledSec.style.display = 'block';
        setupSec.style.display = 'none';
        enabledSec.style.display = 'none';
    }
}

export function cancel2FASetup() {
    const codeField = document.getElementById('p-2fa-verification-code');
    if (codeField) codeField.value = '';
    window.update2FAUIState();
}

export function copy2FAKey() {
    const keyInput = document.getElementById('p-2fa-manual-key');
    keyInput.select();
    navigator.clipboard.writeText(keyInput.value);
    window.showToast('کلید با موفقیت در حافظه کپی شد');
}

export function selectMarkerForFov(marker, c) {
    window.clearActiveFovSelection();
    
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
        
        window.spawnFovHandles();
    }
}

export function clearActiveFovSelection() {
    fovHandles.forEach(h => map.removeLayer(h));
    fovHandles = [];
    activeFovMarker = null;
    activeFovCamera = null;
}

export function closeMapFovSection() {
    const panel = document.getElementById('map-fov-section');
    if (panel) panel.style.display = 'none';
    window.clearActiveFovSelection();
}

export function spawnFovHandles() {
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
    
    leftHandle.on('drag', () => window.handleDrag(leftHandle, rightHandle));
    rightHandle.on('drag', () => window.handleDrag(leftHandle, rightHandle));
    
    leftHandle.on('dragend', () => window.saveFovFromHandles());
    rightHandle.on('dragend', () => window.saveFovFromHandles());
}

export function getFlatAngle(center, pt) {
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

export function getGeoAngle(center, pt) {
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

export function handleDrag(leftHandle, rightHandle) {
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
        
        leftAngle = window.getFlatAngle(center, leftLatLng);
        rightAngle = window.getFlatAngle(center, rightLatLng);
    } else {
        const distL = map.distance(center, leftLatLng);
        const distR = map.distance(center, rightLatLng);
        radius = Math.round((distL + distR) / 2);
        
        leftAngle = window.getGeoAngle(center, leftLatLng);
        rightAngle = window.getGeoAngle(center, rightLatLng);
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
        const pts = window.calculateFovPoints(c, center);
        activeFovMarker.fovPolygon.setLatLngs(pts);
    }
}

export function saveFovFromHandles() {
    if (!activeFovCamera) return;
    const c = activeFovCamera;
    window.saveFovDebounced(c.id, c.fov_angle, c.fov_radius, c.fov_spread);
    window.spawnFovHandles();
}

export function updateSidebarFovVal(field, value) {
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
        const pts = window.calculateFovPoints(c, marker.getLatLng());
        marker.fovPolygon.setLatLngs(pts);
    }
    
    window.spawnFovHandles();
    window.saveFovDebounced(c.id, c.fov_angle, c.fov_radius, c.fov_spread);
}

export function displayPersianDateTime(isoStr) {
    if (!isoStr) return 'هرگز';
    try {
        const d = new Date(isoStr);
        return window.formatPersianDateTime(d);
    } catch(e) {
        return 'نامعتبر';
    }
}

export function parseIntervalToUnit(seconds) {
    if (!seconds || seconds <= 0) return { val: 1, unit: 60 };
    if (seconds >= 86400 && seconds % 86400 === 0) {
        return { val: seconds / 86400, unit: 86400 };
    }
    if (seconds >= 3600 && seconds % 3600 === 0) {
        return { val: seconds / 3600, unit: 3600 };
    }
    if (seconds >= 60 && seconds % 60 === 0) {
        return { val: seconds / 60, unit: 60 };
    }
    return { val: seconds, unit: 1 };
}

export function formatInterval(seconds) {
    if (!seconds || seconds <= 0) return '-';
    const units = [
        { label: 'روز', value: 86400 },
        { label: 'ساعت', value: 3600 },
        { label: 'دقیقه', value: 60 },
        { label: 'ثانیه', value: 1 }
    ];
    const parts = [];
    let remaining = seconds;
    for (const u of units) {
        if (remaining >= u.value) {
            const count = Math.floor(remaining / u.value);
            remaining %= u.value;
            const num = count.toLocaleString('fa-IR');
            parts.push(`${num} ${u.label}`);
        }
    }
    return parts.length ? parts.join(' و ') : '-';
}

export function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '-';
    if (seconds < 60) return `${Math.round(seconds)} ثانیه`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} دقیقه`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h} ساعت و ${m} دقیقه` : `${h} ساعت`;
}

export function renderScheduledTasks() {
    const container = document.getElementById('tasks-container');
    if (!container) return;

    if (scheduledTasksCache.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px 20px;">هیچ وظیفه‌ای تعریف نشده است.</div>`;
        return;
    }

    container.innerHTML = scheduledTasksCache.map(t => {
        const isRunning = t.status === 'Running';
        const isEnabled = t.is_enabled;
        const hasError = t.last_status === 'Failed' && t.last_error;

        const statusBadge = isRunning
            ? `<span class="task-badge task-badge-running">درحال اجرا</span>`
            : `<span class="task-badge task-badge-idle">بیکار</span>`;

        const lastStatusBadge = t.last_status === 'Success'
            ? `<span class="task-status-ok">موفق</span>`
            : t.last_status === 'Failed'
            ? `<span class="task-status-fail">ناموفق</span>`
            : t.last_status === 'Cancelled'
            ? `<span class="task-status-cancel">لغو شده</span>`
            : `<span style="color: var(--text-muted);">-</span>`;

        const errorHtml = hasError
            ? `<div class="task-error">${t.last_error}</div>`
            : '';

        const runBtn = t.id === 'analyze_outages'
            ? ''
            : (isRunning
                ? `<button class="btn btn-ghost" disabled style="opacity: 0.5; padding: 4px 10px; font-size: 12px;">اجرا</button>`
                : `<button class="btn btn-ghost" onclick="window.confirmRunTask('${t.id}', '${t.name}')" style="color: #22c55e; padding: 4px 10px; font-size: 12px;">اجرا</button>`);

        const stopBtn = isRunning
            ? `<button class="btn btn-ghost" onclick="window.stopTask('${t.id}')" style="color: #ef4444; padding: 4px 10px; font-size: 12px;">توقف</button>`
            : `<button class="btn btn-ghost" disabled style="opacity: 0.5; padding: 4px 10px; font-size: 12px;">توقف</button>`;

        const isChecked = isEnabled ? 'checked' : '';

        return `
            <div class="task-card ${!isEnabled ? 'task-card-disabled' : ''}" id="task-row-${t.id}">
                <div class="task-card-header">
                    <div class="task-card-title">
                        <strong>${t.name}</strong>
                        <span class="task-card-desc">${t.description}</span>
                        ${TASK_DETAILS[t.id] ? `
                        <div class="task-card-details">
                            <ul>
                                ${TASK_DETAILS[t.id].map(d => `<li>${d}</li>`).join('')}
                            </ul>
                        </div>` : ''}
                    </div>
                    <div class="task-card-controls">
                        ${statusBadge}
                        <label class="toggle" style="transform: scale(0.85); transform-origin: right; margin: 0;">
                            <input type="checkbox" ${isChecked} onchange="window.toggleTask('${t.id}', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="task-card-body">
                    <div class="task-card-row">
                        <span class="task-card-label">آخرین اجرا:</span>
                        <span class="task-card-value">${t.last_run ? window.displayPersianDateTime(t.last_run) : 'هرگز'} ${t.last_duration ? '(' + window.formatDuration(t.last_duration) + ')' : ''} - ${lastStatusBadge}</span>
                    </div>
                    ${errorHtml}
                    <div class="task-card-row">
                        <span class="task-card-label">اجرای بعدی:</span>
                        <span class="task-card-value">${window.displayPersianDateTime(t.next_run)}</span>
                    </div>
                    <div class="task-card-row">
                        <span class="task-card-label">دوره تکرار:</span>
                        <div class="task-card-interval">
                            ${t.id === 'analyze_outages' ? `
                                <span class="task-card-value" style="color: var(--text-muted); font-size: 12px;">وابسته به تنظیمات بررسی قطعی‌ها</span>
                            ` : (() => {
                                const p = window.parseIntervalToUnit(t.interval);
                                return `
                                <span class="task-card-value">${window.formatInterval(t.interval)}</span>
                                <div class="task-card-interval-edit" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                    <input type="number" id="interval-val-${t.id}" class="form-input" style="width: 65px; padding: 4px 6px; font-size: 12px; text-align: center;" value="${p.val}" min="1">
                                    <select id="interval-unit-${t.id}" class="form-input" style="padding: 4px 6px; font-size: 12px; width: 85px;">
                                        <option value="1" ${p.unit === 1 ? 'selected' : ''}>ثانیه</option>
                                        <option value="60" ${p.unit === 60 ? 'selected' : ''}>دقیقه</option>
                                        <option value="3600" ${p.unit === 3600 ? 'selected' : ''}>ساعت</option>
                                        <option value="86400" ${p.unit === 86400 ? 'selected' : ''}>روز</option>
                                    </select>
                                    <button class="btn btn-sm" onclick="window.saveTaskInterval('${t.id}')" style="padding: 4px 10px; font-size: 11px; background: var(--surface-3); border: 1px solid var(--border);">ذخیره</button>
                                </div>
                                `;
                            })()}
                        </div>
                    </div>
                </div>
                <div class="task-card-footer">
                    ${runBtn}
                    ${stopBtn}
                </div>
            </div>
        `;
    }).join('');
}

export async function confirmRunTask(id, name) {
    if (await window.showConfirm(`آیا از اجرای دستی «${name}» اطمینان دارید؟`)) {
        window.runTask(id);
    }
}

export function handleTaskStatusUpdate(task) {
    const idx = scheduledTasksCache.findIndex(t => t.id === task.id);
    if (idx !== -1) {
        scheduledTasksCache[idx] = task;
    } else {
        scheduledTasksCache.push(task);
    }
    const activeTabBtn = document.querySelector('.settings-nav button.active');
    if (activeTabBtn && activeTabBtn.getAttribute('data-tab') === 'sec-tasks') {
        window.renderScheduledTasks();
    }
    if (task.id === 'sync_nvr_health') {
        window.renderNvrHealthWidget();
        window.renderNvrHealthSummaryWidget();
    }
}

export function toggleGlobalSearch(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('global-search-dropdown');
    if (!dropdown) return;
    
    const isHidden = dropdown.classList.toggle('hidden');
    if (!isHidden) {
        const input = document.getElementById('global-search-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        document.getElementById('global-search-results').innerHTML = 
            '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px 0;">عبارتی وارد کنید...</div>';
        
        window.warmUpSearchCache();
    }
}

export function onGlobalSearch(query) {
    const resultsContainer = document.getElementById('global-search-results');
    if (!resultsContainer) return;

    if (!query || query.trim() === '') {
        resultsContainer.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px 0;">عبارتی وارد کنید...</div>';
        return;
    }

    const q = query.toLowerCase().trim();
    
    // Find matching cameras
    const matches = dashCamerasCache.filter(c => {
        const camName = (c.name || '').toLowerCase();
        const camIp = (c.ip || '').toLowerCase();
        
        // Find NVR and its Group
        const nvrObj = nvrCache.find(n => n.ip === c.nvr_ip);
        const nvrName = nvrObj && nvrObj.name ? nvrObj.name.toLowerCase() : '';
        const groupObj = nvrObj && nvrObj.group_id ? groupCache.find(g => g.id === nvrObj.group_id) : null;
        const groupName = groupObj && groupObj.name ? groupObj.name.toLowerCase() : '';

        return camName.includes(q) || camIp.includes(q) || nvrName.includes(q) || groupName.includes(q);
    });

    if (matches.length === 0) {
        resultsContainer.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px 0;">دوربینی یافت نشد</div>';
        return;
    }

    resultsContainer.innerHTML = matches.map(c => {
        const nvrObj = nvrCache.find(n => n.ip === c.nvr_ip);
        const nvrName = nvrObj && nvrObj.name ? nvrObj.name : `NVR ${window.getNvrNum(c.nvr_ip)}`;
        const groupObj = nvrObj && nvrObj.group_id ? groupCache.find(g => g.id === nvrObj.group_id) : null;
        const groupName = groupObj && groupObj.name ? groupObj.name : 'سایر NVRها';

        const pathText = `${groupName} › ${nvrName} › ${c.name}`;
        const meta = encodeURIComponent(JSON.stringify(c));
        const statusDot = c.status === 'Online' ? 
            '<span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block;"></span>' : 
            '<span style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; display: inline-block;"></span>';

        return `<div class="search-result-item" onclick="window.showCam('${meta}'); window.toggleGlobalSearch();" style="padding: 8px; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: background 0.2s; border-radius: 4px; gap: 8px;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <span style="font-size: 13px; font-weight: 500; color: var(--text);">${pathText}</span>
                <span style="font-size: 11px; color: var(--text-secondary);">${c.ip}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                ${statusDot}
            </div>
        </div>`;
    }).join('');
}

export function populateOutageGroupFilter() {
    const sel = document.getElementById('outage-filter-group');
    if (!sel) return;
    
    // Clear dynamic options (keep first one "همه کارخانه‌ها")
    while (sel.options.length > 1) {
        sel.remove(1);
    }
    
    // Find unique group names from cache
    const groups = [...new Set(outagesCache.map(o => o.group_name).filter(Boolean))];
    groups.sort();
    
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        sel.appendChild(opt);
    });
}

export function filterOutages() {
    window.renderOutagesList();
}

export function renderOutagesList() {
    const list = document.getElementById('outage-explanations-list');
    if (!list) return;
    
    // Get filter values
    const filterGroupVal = document.getElementById('outage-filter-group').value;
    const filterStatusVal = document.getElementById('outage-filter-status').value;
    const filterDaysVal = document.getElementById('outage-filter-days').value;
    const searchVal = document.getElementById('outage-search') ? document.getElementById('outage-search').value.toLowerCase().trim() : '';
    
    let filtered = outagesCache;
    
    // 1. Group Filter
    if (filterGroupVal) {
        filtered = filtered.filter(o => o.group_name === filterGroupVal);
    }
    
    // 2. Status Filter
    if (filterStatusVal === 'pending') {
        filtered = filtered.filter(o => o.status === 'pending');
    } else if (filterStatusVal === 'explained') {
        filtered = filtered.filter(o => o.status === 'explained');
    } else if (filterStatusVal === 'expired') {
        filtered = filtered.filter(o => o.status === 'expired');
    }
    
    // 3. Days Filter
    if (filterDaysVal !== 'all') {
        const days = parseInt(filterDaysVal);
        const cutoff = new Date().getTime() - (days * 24 * 3600 * 1000);
        filtered = filtered.filter(o => {
            const startMs = new Date(o.start_time).getTime();
            return startMs >= cutoff;
        });
    }

    // 4. Search Filter
    if (searchVal) {
        filtered = filtered.filter(o =>
            (o.camera_name && o.camera_name.toLowerCase().includes(searchVal)) ||
            (o.camera_ip && o.camera_ip.toLowerCase().includes(searchVal))
        );
    }
    
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / outagesPerPage) || 1;
    if (currentOutagePage > totalPages) {
        currentOutagePage = totalPages;
    }
    if (currentOutagePage < 1) {
        currentOutagePage = 1;
    }

    const startIndex = (currentOutagePage - 1) * outagesPerPage;
    const endIndex = Math.min(startIndex + outagesPerPage, totalCount);

    const pStart = document.getElementById('outages-pagination-start');
    const pEnd = document.getElementById('outages-pagination-end');
    const pTotal = document.getElementById('outages-pagination-total');
    if (pStart) pStart.textContent = totalCount === 0 ? 0 : startIndex + 1;
    if (pEnd) pEnd.textContent = endIndex;
    if (pTotal) pTotal.textContent = totalCount;

    window.renderOutagesPageButtons(totalPages);

    if (totalCount === 0) {
        list.innerHTML = '<tr><td colspan="13" class="empty-state" style="text-align: center; padding: 20px;">هیچ قطعی یافت نشد</td></tr>';
        return;
    }
    
    const paginated = filtered.slice(startIndex, endIndex);

    const role = window.currentUser ? window.currentUser.role : 'group_view';
    const canExplain = role === 'admin' || role === 'it_manager';
    
    list.innerHTML = paginated.map(o => {
        let statusBadge = '';
        let actionBtn = '';
        
        if (o.status === 'explained') {
            statusBadge = '<span class="badge badge-success" style="background:#10b981; color:#fff; padding: 4px 8px; border-radius: 4px; font-size:12px;">رفع ابهام شده</span>';
            if (role === 'admin') {
                actionBtn = `<button class="btn btn-primary" onclick="window.openExplanationModal(${o.id})" style="padding: 4px 8px; font-size: 12px; background: #6366f1; border-color: #6366f1; cursor: pointer;">ویرایش</button>`;
            } else {
                actionBtn = '<span style="font-size: 12px; color: var(--text-muted);">غیر قابل ویرایش</span>';
            }
        } else if (o.status === 'expired') {
            statusBadge = '<span class="badge badge-danger" style="background:#ef4444; color:#fff; padding: 4px 8px; border-radius: 4px; font-size:12px;">منقضی شده</span>';
            if (role === 'admin') {
                actionBtn = `<button class="btn btn-primary" onclick="window.openExplanationModal(${o.id})" style="padding: 4px 8px; font-size: 12px; background: #6366f1; border-color: #6366f1; cursor: pointer;">رفع ابهام (ادمین)</button>`;
            } else {
                actionBtn = '<span style="font-size: 12px; color: var(--danger);">پایان مهلت</span>';
            }
        } else {
            statusBadge = '<span class="badge badge-warning" style="background:#f59e0b; color:#fff; padding: 4px 8px; border-radius: 4px; font-size:12px;">در انتظار رفع ابهام</span>';
            if (canExplain) {
                actionBtn = `<button class="btn btn-primary" onclick="window.openExplanationModal(${o.id})" style="padding: 4px 8px; font-size: 12px; cursor: pointer;">رفع ابهام</button>`;
            } else {
                actionBtn = '<span style="font-size: 12px; color: var(--text-muted);">-</span>';
            }
        }
        
        const isChecked = outagesSelectedIds.includes(o.id) ? 'checked' : '';
        const checkboxHtml = `<input type="checkbox" class="outage-row-checkbox" value="${o.id}" ${isChecked} onchange="window.onOutageRowCheckboxChange(${o.id}, this.checked)" style="cursor: pointer;">`;

        return `<tr style="border-bottom: 1px solid var(--border); transition: background 0.2s;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='transparent'">
            <td style="padding: 12px; text-align: center;">${checkboxHtml}</td>
            <td data-label="نام دوربین" style="padding: 12px;"><strong>${o.camera_name}</strong></td>
            <td data-label="IP" style="padding: 12px; font-family: monospace;">${o.camera_ip}</td>
            <td data-label="کارخانه" style="padding: 12px;">${o.group_name}</td>
            <td data-label="زمان شروع" style="padding: 12px; font-size: 13px;">${o.shamsi_start}</td>
            <td data-label="زمان پایان" style="padding: 12px; font-size: 13px;">${o.shamsi_end}</td>
            <td data-label="مدت (ساعت)" style="padding: 12px; text-align: center;">${o.duration_hours}</td>
            <td data-label="مهلت رفع ابهام" style="padding: 12px; font-size: 13px; color: var(--text-secondary);">${o.shamsi_deadline}</td>
            <td data-label="علت قطعی" style="padding: 12px;">${o.explanation_type || '-'}</td>
            <td data-label="توضیحات رفع ابهام" style="padding: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${o.explanation_detail || ''}">${o.explanation_detail || '-'}</td>
            <td data-label="ثبت‌کننده" style="padding: 12px; font-size: 13px;">${o.explained_by_username || '-'}</td>
            <td data-label="وضعیت" style="padding: 12px;">${statusBadge}</td>
            <td data-label="عملیات" style="padding: 12px;">${actionBtn}</td>
        </tr>`;
    }).join('');
}

export function renderOutagesPageButtons(totalPages) {
    const container = document.getElementById('outages-page-numbers');
    if (!container) return;
    container.innerHTML = '';

    const btnPrev = document.getElementById('outages-btn-prev');
    const btnNext = document.getElementById('outages-btn-next');
    if (btnPrev) btnPrev.disabled = currentOutagePage === 1;
    if (btnNext) btnNext.disabled = currentOutagePage === totalPages;

    const startPage = Math.max(1, currentOutagePage - 2);
    const endPage = Math.min(totalPages, startPage + 4);

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = i === currentOutagePage ? 'btn btn-primary' : 'btn btn-ghost';
        btn.style.padding = '4px 8px';
        btn.style.fontSize = '12px';
        btn.style.minWidth = '28px';
        btn.style.cursor = 'pointer';
        btn.textContent = i;
        btn.onclick = () => {
            currentOutagePage = i;
            window.renderOutagesList();
        };
        container.appendChild(btn);
    }
}

export function changeOutagesPage(direction) {
    currentOutagePage += direction;
    window.renderOutagesList();
}

export function onOutageRowCheckboxChange(id, checked) {
    if (checked) {
        if (!outagesSelectedIds.includes(id)) {
            outagesSelectedIds.push(id);
        }
    } else {
        outagesSelectedIds = outagesSelectedIds.filter(x => x !== id);
    }
    window.updateOutagesBulkBar();
}

export function toggleSelectAllOutages() {
    const selectAllChk = document.getElementById('outage-select-all');
    if (!selectAllChk) return;

    const checked = selectAllChk.checked;
    const checkboxes = document.querySelectorAll('.outage-row-checkbox');
    checkboxes.forEach(chk => {
        chk.checked = checked;
        const id = parseInt(chk.value);
        if (checked) {
            if (!outagesSelectedIds.includes(id)) {
                outagesSelectedIds.push(id);
            }
        } else {
            outagesSelectedIds = outagesSelectedIds.filter(x => x !== id);
        }
    });
    window.updateOutagesBulkBar();
}

export function updateOutagesBulkBar() {
    const bar = document.getElementById('outages-bulk-bar');
    const cnt = document.getElementById('outages-selected-count');
    if (!bar) return;

    if (outagesSelectedIds.length > 0) {
        bar.classList.remove('hidden');
        if (cnt) cnt.textContent = outagesSelectedIds.length;
    } else {
        bar.classList.add('hidden');
    }
}

export async function openExplanationModal(id) {
    isBulkExplanation = false;
    const o = outagesCache.find(x => x.id === id);
    if (!o) return;
    
    document.getElementById('exp-outage-id').value = id;
    
    // مدیریت بنر پیشنهاد هوشمند سیستم
    const banner = document.getElementById('outages-suggestion-banner');
    const bannerText = document.getElementById('outages-suggestion-text');
    if (banner && bannerText) {
        if (o.suggested_cause) {
            currentSuggestedCause = o.suggested_cause;
            currentSuggestedDetail = o.suggested_detail || '';
            bannerText.textContent = `${o.suggested_cause} - ${o.suggested_detail}`;
            banner.classList.remove('hidden');
        } else {
            currentSuggestedCause = null;
            currentSuggestedDetail = null;
            banner.classList.add('hidden');
        }
    }

    // Populate active causes dynamically from database
    try {
        const res = await window.apiFetch(`/api/v1/outage-causes`);
        const causes = await res.json();
        const sel = document.getElementById('exp-type');
        if (sel) {
            sel.innerHTML = causes
                .filter(c => c.is_active)
                .map(c => `<option value="${c.name}">${c.name}</option>`)
                .join('');

            if (o.explanation_type) {
                sel.value = o.explanation_type;
            }
        }
    } catch (e) {
        console.error('Error fetching causes for modal:', e);
    }

    document.getElementById('exp-detail').value = o.explanation_detail || '';

    const modal = document.getElementById('explanationModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('open');
    }
}

export async function openBulkExplanationModal() {
    if (outagesSelectedIds.length === 0) {
        window.showToast('هیچ موردی انتخاب نشده است', 'error');
        return;
    }
    isBulkExplanation = true;

    // پنهان کردن بنر پیشنهاد هوشمند برای ثبت دسته‌جمعی
    const banner = document.getElementById('outages-suggestion-banner');
    if (banner) banner.classList.add('hidden');

    document.getElementById('exp-outage-id').value = '';

    try {
        const res = await window.apiFetch(`/api/v1/outage-causes`);
        const causes = await res.json();
        const sel = document.getElementById('exp-type');
        if (sel) {
            sel.innerHTML = causes
                .filter(c => c.is_active)
                .map(c => `<option value="${c.name}">${c.name}</option>`)
                .join('');
        }
    } catch (e) {
        console.error('Error fetching causes for modal:', e);
    }
    
    document.getElementById('exp-detail').value = '';
    
    const modal = document.getElementById('explanationModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('open');
    }
}

export function applySystemSuggestion() {
    if (currentSuggestedCause) {
        const sel = document.getElementById('exp-type');
        if (sel) {
            let found = false;
            for (let i = 0; i < sel.options.length; i++) {
                if (sel.options[i].value === currentSuggestedCause) {
                    sel.value = currentSuggestedCause;
                    found = true;
                    break;
                }
            }
            if (!found) {
                const opt = document.createElement('option');
                opt.value = currentSuggestedCause;
                opt.textContent = currentSuggestedCause;
                sel.appendChild(opt);
                sel.value = currentSuggestedCause;
            }
        }
    }
    if (currentSuggestedDetail) {
        document.getElementById('exp-detail').value = currentSuggestedDetail;
    }
    window.showToast('پیشنهاد هوشمند سیستم با موفقیت اعمال شد');
}

export function closeExplanationModal() {
    const modal = document.getElementById('explanationModal');
    if (modal) {
        modal.classList.remove('open');
        modal.classList.add('hidden');
    }
}

export function cycleWidgetSize(widgetId) {
    const el = document.getElementById(widgetId);
    if (!el) return;

    let currentSize = 'size-full';
    SIZES.forEach(s => {
        if (el.classList.contains(s)) currentSize = s;
    });

    const currentIndex = SIZES.indexOf(currentSize);
    const nextSize = SIZES[(currentIndex + 1) % SIZES.length];

    SIZES.forEach(s => el.classList.remove(s));
    el.classList.add(nextSize);

    const sizeLabel = el.querySelector('.size-label');
    if (sizeLabel) {
        sizeLabel.textContent = SIZE_LABELS[nextSize];
    }

    window.saveDashboardLayout();
    if (widgetId === 'widget-chart-status' || widgetId === 'widget-chart-causes') {
        setTimeout(renderDashboardCharts, 150);
    }
}

export function initDashboardCustomization() {
    window.loadDashboardLayout();
    window.initDragAndDropListeners();
}

export function toggleDashEditMode(forceState) {
    isDashEditMode = typeof forceState === 'boolean' ? forceState : !isDashEditMode;
    const dashSection = document.getElementById('dash');
    const btnEdit = document.getElementById('btn-edit-dash');
    const fabEdit = document.getElementById('btn-fab-edit');
    const editControls = document.getElementById('dash-edit-controls');
    
    if (isDashEditMode) {
        dashSection.classList.add('dash-edit-mode');
        if (btnEdit) btnEdit.classList.add('active');
        if (fabEdit) fabEdit.classList.add('active');
        if (editControls) editControls.classList.remove('hidden');
        window.enableDraggableWidgets(true);
        if (typeof showToast === 'function') window.showToast('حالت ویرایش داشبورد فعال شد. می‌توانید کارت‌ها را با درگ و دراپ جابجا کنید.');
    } else {
        dashSection.classList.remove('dash-edit-mode');
        if (btnEdit) btnEdit.classList.remove('active');
        if (fabEdit) fabEdit.classList.remove('active');
        if (editControls) editControls.classList.add('hidden');
        window.enableDraggableWidgets(false);
        window.saveDashboardLayout();
        if (typeof showToast === 'function') window.showToast('تغییرات داشبورد ذخیره گردید.');
    }
}

export function enableDraggableWidgets(enable) {
    const widgets = document.querySelectorAll('.dash-widget');
    widgets.forEach(w => {
        w.setAttribute('draggable', enable ? 'true' : 'false');
    });
}

export function removeWidget(widgetId) {
    const el = document.getElementById(widgetId);
    if (el) {
        el.classList.add('widget-hidden');
        window.saveDashboardLayout();
        if (isDashEditMode) {
            window.updateAddWidgetModalContent();
        }
        if (typeof showToast === 'function') window.showToast('ویجت از داشبورد حذف شد');
    }
}

export function addWidget(widgetId) {
    const el = document.getElementById(widgetId);
    if (el) {
        el.classList.remove('widget-hidden');
        if (isDashEditMode) {
            el.setAttribute('draggable', 'true');
        }
        const container = document.getElementById('dash-widgets-container');
        if (container && !container.contains(el)) {
            container.appendChild(el);
        }
        window.saveDashboardLayout();
        window.updateAddWidgetModalContent();
        window.closeAddWidgetModal();
        if (widgetId === 'widget-important-cams') window.renderImportantCamerasWidget();
        if (widgetId === 'widget-off-recording') window.renderOffCamerasWidget();
        if (widgetId === 'widget-camera-changes') window.renderCameraChangesWidget();
        if (widgetId === 'widget-chart-status' || widgetId === 'widget-chart-causes') setTimeout(renderDashboardCharts, 150);
        if (typeof showToast === 'function') window.showToast('ویجت با موفقیت به داشبورد اضافه شد');
    }
}

export function resetDashboardLayout() {
    localStorage.removeItem('hikstatus_dashboard_layout');
    const container = document.getElementById('dash-widgets-container');
    
    DEFAULT_WIDGET_ORDER.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === 'widget-important-cams' || id === 'widget-chart-status' || id === 'widget-chart-causes' || id === 'widget-ping-summary') {
                el.classList.add('widget-hidden');
            } else {
                el.classList.remove('widget-hidden');
            }
            if (container) container.appendChild(el);
        }
    });
    window.saveDashboardLayout();
    if (typeof showToast === 'function') window.showToast('چینش داشبورد به حالت اولیه بازنشانی شد');
}

export function saveDashboardLayout() {
    const container = document.getElementById('dash-widgets-container');
    if (!container) return;
    
    const widgets = container.querySelectorAll('.dash-widget');
    const layout = [];
    
    widgets.forEach(w => {
        let size = 'size-full';
        SIZES.forEach(s => { if (w.classList.contains(s)) size = s; });

        layout.push({
            id: w.id,
            hidden: w.classList.contains('widget-hidden'),
            size: size
        });
    });
    
    localStorage.setItem('hikstatus_dashboard_layout', JSON.stringify(layout));
}

export function loadDashboardLayout() {
    const container = document.getElementById('dash-widgets-container');
    if (!container) return;
    
    const saved = localStorage.getItem('hikstatus_dashboard_layout');
    if (!saved) return;
    
    try {
        const layout = JSON.parse(saved);
        layout.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                if (item.hidden) {
                    el.classList.add('widget-hidden');
                } else {
                    el.classList.remove('widget-hidden');
                }
                if (item.size) {
                    SIZES.forEach(s => el.classList.remove(s));
                    el.classList.add(item.size);
                    const sizeLabel = el.querySelector('.size-label');
                    if (sizeLabel) sizeLabel.textContent = SIZE_LABELS[item.size] || '100%';
                }
                container.appendChild(el);
            }
        });
    } catch (e) {
        console.error('Error loading dashboard layout:', e);
    }
}

export function initDragAndDropListeners() {
    const container = document.getElementById('dash-widgets-container');
    if (!container) return;
    
    container.addEventListener('dragstart', (e) => {
        if (!isDashEditMode) return;
        const widget = e.target.closest('.dash-widget');
        if (!widget) return;
        
        draggedWidgetId = widget.id;
        widget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', widget.id);
    });

    container.addEventListener('dragover', (e) => {
        if (!isDashEditMode || !draggedWidgetId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const targetWidget = e.target.closest('.dash-widget');
        if (targetWidget && targetWidget.id !== draggedWidgetId) {
            const rect = targetWidget.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.clientY < midpoint) {
                container.insertBefore(document.getElementById(draggedWidgetId), targetWidget);
            } else {
                container.insertBefore(document.getElementById(draggedWidgetId), targetWidget.nextSibling);
            }
        }
    });

    container.addEventListener('dragend', (e) => {
        const widget = e.target.closest('.dash-widget');
        if (widget) widget.classList.remove('dragging');
        draggedWidgetId = null;
        if (isDashEditMode) {
            window.saveDashboardLayout();
        }
    });
}

export function openAddWidgetModal() {
    window.updateAddWidgetModalContent();
    const modal = document.getElementById('modal-add-widget');
    if (modal) {
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.add('open');
        });
    }
}

export function closeAddWidgetModal() {
    const modal = document.getElementById('modal-add-widget');
    if (modal) {
        modal.classList.remove('open');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 200);
    }
}

export function updateAddWidgetModalContent() {
    const listEl = document.getElementById('add-widget-list');
    if (!listEl) return;
    
    const hiddenWidgets = [];
    DEFAULT_WIDGET_ORDER.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.classList.contains('widget-hidden')) {
            hiddenWidgets.push(id);
        }
    });
    
    if (hiddenWidgets.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 24px 0;">
                <p>تمامی ویجت‌های در دسترس در حال حاضر روی داشبورد شما فعال هستند.</p>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = hiddenWidgets.map(id => {
        const meta = WIDGET_METADATA[id] || { title: id, desc: '' };
        return `
            <div class="add-widget-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);">
                <div>
                    <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 4px; color: var(--text);">${meta.title}</h4>
                    <p style="font-size: 12px; color: var(--text-muted);">${meta.desc}</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.addWidget('${id}')" style="padding: 6px 14px; font-size: 12px; cursor: pointer; flex-shrink: 0;">
                    + افزودن
                </button>
            </div>
        `;
    }).join('');
}

export function toPersianNumbers(str) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(str).replace(/[0-9]/g, (w) => persianDigits[+w]);
}

export function formatTimeAgo(dateStr) {
    if (!dateStr) return 'هرگز';
    const now = new Date();
    const lastRun = new Date(dateStr);
    const diffMs = now - lastRun;
    if (diffMs < 0) return 'هم‌اکنون';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'چند لحظه پیش';
    if (diffMins < 60) {
        return window.toPersianNumbers(`${diffMins} دقیقه پیش`);
    }
    const diffHours = Math.floor(diffMins / 60);
    const remMins = diffMins % 60;
    if (remMins === 0) {
        return window.toPersianNumbers(`${diffHours} ساعت پیش`);
    }
    return window.toPersianNumbers(`${diffHours} ساعت و ${remMins} دقیقه پیش`);
}

export function formatHddInfo(hddJsonStr) {
    if (!hddJsonStr) return '💿 اطلاعات هارد: نامشخص';
    try {
        const hdds = JSON.parse(hddJsonStr);
        if (!Array.isArray(hdds) || hdds.length === 0) return '💿 بدون هارد دیسک';
        return hdds.map(h => {
            const capVal = parseFloat(h.capacity) || 0;
            const freeVal = parseFloat(h.freeSpace) || 0;

            let capGB = capVal > 50000 ? (capVal / 1024).toFixed(1) : capVal.toFixed(1);
            let freeGB = freeVal > 50000 ? (freeVal / 1024).toFixed(1) : freeVal.toFixed(1);

            let capStr = capGB > 900 ? `${(capGB / 1024).toFixed(1)}TB` : `${capGB}GB`;
            let freeStr = freeGB > 900 ? `${(freeGB / 1024).toFixed(1)}TB` : `${freeGB}GB`;

            let statusClass = h.status === 'OK' ? 'text-success' : 'text-danger';
            let statusLabel = h.status === 'OK' ? 'سالم' : (h.status || 'خطا');
            return `<div style="padding-right: 4px; display: flex; align-items: center; gap: 8px;">
                <span>💾 ${h.name || 'هارد'}: ${window.toPersianNumbers(capStr)} / ${window.toPersianNumbers(freeStr)} خالی</span>
                <span class="${statusClass}" style="font-weight: bold;">(${statusLabel})</span>
            </div>`;
        }).join('');
    } catch (e) {
        return '💿 خطا در خواندن اطلاعات هارد';
    }
}

export function renderDashboardCharts() {
    if (typeof Chart === 'undefined') return;

    // Status Chart
    const statusCanvas = document.getElementById('dash-chart-status-canvas');
    if (statusCanvas && dashCamerasCache) {
        const onCount = dashCamerasCache.filter(c => c.status === 'Online').length;
        const offCount = dashCamerasCache.filter(c => c.status !== 'Online').length;
        
        if (dashChartStatusInstance) dashChartStatusInstance.destroy();
        dashChartStatusInstance = new Chart(statusCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['متصل', 'قطع'],
                datasets: [{
                    data: [onCount, offCount],
                    backgroundColor: ['#22c55e', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Vazirmatn' } } }
                }
            }
        });
    }

    // Causes Chart - throttle fetch to max once every 15s
    const causesCanvas = document.getElementById('dash-chart-causes-canvas');
    const now = Date.now();
    if (causesCanvas && (now - lastCausesFetchTime > 15000 || !dashChartCausesInstance)) {
        lastCausesFetchTime = now;
        window.apiFetch(`${API}/reports/causes?period=30d`).then(async res => {
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) return;
            const labels = data.map(d => d.cause);
            const values = data.map(d => d.count);
            
            if (dashChartCausesInstance) dashChartCausesInstance.destroy();
            dashChartCausesInstance = new Chart(causesCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'تعداد قطعی‌ها',
                        data: values,
                        backgroundColor: '#6366f1',
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { family: 'Vazirmatn' } }, grid: { display: false } },
                        y: { ticks: { color: '#94a3b8' }, grid: { color: '#2a2a36' } }
                    }
                }
            });
        }).catch(err => console.error('Error fetching causes chart data:', err));
    }
}

export function openEditGroupModal(id) {
    const group = groupCache.find(g => g.id === id);
    if (!group) return window.showToast('کارخانه پیدا نشد', 'error');
    
    document.getElementById('editGroupId').value = group.id;
    document.getElementById('editGroupName').value = group.name;
    document.getElementById('editGroupDesc').value = group.description || '';
    
    document.getElementById('editGroupModal').classList.add('open');
}

export function closeEditGroupModal() {
    document.getElementById('editGroupModal').classList.remove('open');
}

export function populateEditInspectorGroupsList() {
    const listCon = document.getElementById('edit-inspector-groups-list');
    if (!listCon) return;
    if (!groupCache || groupCache.length === 0) {
        listCon.innerHTML = '<span style="font-size: 12px; color: var(--text-muted); grid-column: 1 / -1;">کارخانه‌ای تعریف نشده است</span>';
        return;
    }
    listCon.innerHTML = groupCache.map(g => `
        <label style="font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; background: var(--surface); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);">
            <input type="checkbox" class="edit-inspector-group-cb" value="${g.id}" onchange="window.updateEditInspectorSelectAllState()">
            <span style="user-select: none;">${g.name}</span>
        </label>
    `).join('');
    window.updateEditInspectorSelectAllState();
}

export function toggleAllEditInspectorGroups(checked) {
    const checkboxes = document.querySelectorAll('.edit-inspector-group-cb');
    checkboxes.forEach(cb => cb.checked = checked);
}

export function updateEditInspectorSelectAllState() {
    const checkboxes = document.querySelectorAll('.edit-inspector-group-cb');
    const selectAllCb = document.getElementById('edit-inspector-select-all');
    if (!selectAllCb || checkboxes.length === 0) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    selectAllCb.checked = allChecked;
}

export function openEditUserModal(id) {
    const user = usersCache.find(u => u.id === id);
    if (!user) return window.showToast('کاربر پیدا نشد', 'error');

    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUserName').value = user.username;
    document.getElementById('editUserPass').value = '';
    document.getElementById('editUserRole').value = user.role;
    document.getElementById('editUserActive').checked = user.is_active !== false;

    // Populate group select
    const select = document.getElementById('editUserGroup');
    if (select) {
        select.innerHTML = '<option value="">بدون گروه</option>' + groupCache.map(g => 
            `<option value="${g.id}">${g.name}</option>`
        ).join('');
        select.value = user.group_id || '';
    }

    // Populate and set checkboxes
    window.populateEditInspectorGroupsList();
    if (user.accessible_group_ids) {
        const allowedIds = user.accessible_group_ids.split(',').map(id => id.trim());
        const checkboxes = document.querySelectorAll('.edit-inspector-group-cb');
        checkboxes.forEach(cb => {
            cb.checked = allowedIds.includes(cb.value);
        });
        window.updateEditInspectorSelectAllState();
    } else {
        window.toggleAllEditInspectorGroups(true);
        window.updateEditInspectorSelectAllState();
    }

    window.onEditUserRoleChange();

    document.getElementById('editUserModal').classList.add('open');
}

export function closeEditUserModal() {
    document.getElementById('editUserModal').classList.remove('open');
}

export function onEditUserRoleChange() {
    const role = document.getElementById('editUserRole').value;
    const groupCon = document.getElementById('edit-user-group-container');
    const inspectorCon = document.getElementById('edit-inspector-groups-container');
    if (role === 'it_manager' || role === 'inspector') {
        if (groupCon) groupCon.style.display = 'none';
        if (inspectorCon) inspectorCon.style.display = 'block';
    } else if (role === 'admin') {
        if (groupCon) groupCon.style.display = 'none';
        if (inspectorCon) inspectorCon.style.display = 'none';
    } else {
        if (groupCon) groupCon.style.display = 'block';
        if (inspectorCon) inspectorCon.style.display = 'none';
    }
}