const API = '/api';
let logOff = 0, logFilter = '', logSearchVal = '', loading = false, allLoaded = false;
let currentCamId, currentImp, settingsCache = [], nvrCache = [], groupCache = [], dashCamerasCache = [];
let ws = null, wsRetryDelay = 1000, dashCamSearchVal = '', dashCamFilter = 'all';
let dashCamRecordingFilter = 'all';

let collapsedFactories = new Set(JSON.parse(localStorage.getItem('collapsedFactories') || '[]'));
let collapsedNvrs = new Set(JSON.parse(localStorage.getItem('collapsedNvrs') || '[]'));

function saveCollapsedState() {
    localStorage.setItem('collapsedFactories', JSON.stringify([...collapsedFactories]));
    localStorage.setItem('collapsedNvrs', JSON.stringify([...collapsedNvrs]));
}

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
        if (e instanceof TypeError || e.message === 'Failed to fetch' || e.name === 'TypeError') {
            setConnectionStatus(false);
        }
        throw e;
    }
}

async function nav(id, activeTabOverride = null) {
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

    if (id === 'dash') fetchDash();
    if (id === 'map') initOrRefreshMap();
    if (id === 'reports') {
        if (!document.getElementById('startDt').value) {
            setPreset(24);
        }
        genReport();
        fetchAndRenderHeatmap();
    }
    if (id === 'settings') await loadSettings(activeTabOverride);
    if (id === 'outages') loadOutageExplanations();
}

function showAboutUs() {
    nav('settings', 'sec-about');
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
    try {
        const tRes = await apiFetch(`${API}/scheduler/tasks`);
        if (tRes.ok) {
            scheduledTasksCache = await tRes.json();
        }
    } catch (e) {
        console.error('Error loading Tasks:', e);
    }
    const res = await apiFetch(`${API}/cameras`);
    const cams = await res.json();

    updateDashFromWS(cams);
}

function setDashCamRecordingFilter(val) {
    dashCamRecordingFilter = val;
    renderDash();
}

function renderDash() {
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
        document.getElementById('offline-grid').innerHTML = off.map(c => createCard(c)).join('');
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
    nvrCache.filter(n => n.enabled !== false).sort((a, b) => parseInt(getNvrNum(a.ip)) - parseInt(getNvrNum(b.ip))).forEach(nvrObj => {
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
            <div class="factory-header" onclick="toggleFactory(${g.id})">
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
            const cards = sorted.map(c => createCard(c)).join('');
            const isNvrCollapsed = collapsedNvrs.has(ip);
            factoryHtml += `
                <div class="nvr-block ${isNvrCollapsed ? '' : 'open'} ${isNvrOffline ? 'offline' : ''}">
                    <div class="nvr-header" onclick="toggleNvr(this)">
                        <div class="nvr-header-left">
                            <span class="nvr-badge ${isNvrOffline ? 'offline' : ''}">${getNvrDisplayName(ip)}</span>
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
            <div class="factory-header" onclick="toggleFactory('unassigned')">
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
            const cards = sorted.map(c => createCard(c)).join('');
            const isNvrCollapsed = collapsedNvrs.has(ip);
            unassignedHtml += `
                <div class="nvr-block ${isNvrCollapsed ? '' : 'open'} ${isNvrOffline ? 'offline' : ''}">
                    <div class="nvr-header" onclick="toggleNvr(this)">
                        <div class="nvr-header-left">
                            <span class="nvr-badge ${isNvrOffline ? 'offline' : ''}">${getNvrDisplayName(ip)}</span>
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

function setDashCamFilter(filter) {
    dashCamFilter = filter;
    document.querySelectorAll('.chip[id^="filter-cam-"]').forEach(b => {
        b.classList.remove('active');
    });
    if (filter === 'all') document.getElementById('filter-cam-all').classList.add('active');
    else if (filter === 'online') document.getElementById('filter-cam-online').classList.add('active');
    else if (filter === 'offline') document.getElementById('filter-cam-offline').classList.add('active');
    renderDash();
}

function toggleNvr(header) {
    const block = header.parentElement;
    const grid = header.nextElementSibling;
    block.classList.toggle('open');
    grid.style.display = block.classList.contains('open') ? 'grid' : 'none';

    const ipEl = header.querySelector('.nvr-ip');
    if (ipEl) {
        const ip = ipEl.textContent.trim();
        if (block.classList.contains('open')) {
            collapsedNvrs.delete(ip);
        } else {
            collapsedNvrs.add(ip);
        }
        saveCollapsedState();
    }
}

function toggleFactory(id) {
    const el = document.getElementById('factory-' + id);
    if (el) {
        el.classList.toggle('open');
        const strId = String(id);
        if (el.classList.contains('open')) {
            collapsedFactories.delete(strId);
        } else {
            collapsedFactories.add(strId);
        }
        saveCollapsedState();
    }
}

function expandAllFactories() {
    document.querySelectorAll('.factory-section').forEach(sec => {
        sec.classList.add('open');
        const id = sec.id.replace('factory-', '');
        collapsedFactories.delete(String(id));
    });
    document.querySelectorAll('.nvr-block').forEach(blk => {
        blk.classList.add('open');
        const grid = blk.querySelector('.nvr-grid');
        if (grid) grid.style.display = 'grid';

        const ipEl = blk.querySelector('.nvr-ip');
        if (ipEl) {
            collapsedNvrs.delete(ipEl.textContent.trim());
        }
    });
    saveCollapsedState();
}

function collapseAllFactories() {
    document.querySelectorAll('.factory-section').forEach(sec => {
        sec.classList.remove('open');
        const id = sec.id.replace('factory-', '');
        collapsedFactories.add(String(id));
    });
    document.querySelectorAll('.nvr-block').forEach(blk => {
        blk.classList.remove('open');
        const grid = blk.querySelector('.nvr-grid');
        if (grid) grid.style.display = 'none';

        const ipEl = blk.querySelector('.nvr-ip');
        if (ipEl) {
            collapsedNvrs.add(ipEl.textContent.trim());
        }
    });
    saveCollapsedState();
}

function toggleReportBlock(header) {
    const block = header.closest('.report-block');
    if (block) {
        block.classList.toggle('collapsed');
    }
}

function escapeHTML(str) {
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

function createCard(c) {
    const stClass = c.status === 'Online' ? 'status-online' : 'status-offline';
    const meta = encodeURIComponent(JSON.stringify(c));
    const star = c.importance === 3 ? '<span class="cam-card-star">★</span>' : '';
    const ipShort = c.ip ? c.ip.split('.').pop() : '';
    const isRecording = c.recording_scheduled === true;
    const recDotClass = isRecording ? 'cam-record-dot recording' : 'cam-record-dot not-recording';

    return `<div class="cam-card ${stClass}" onclick="showCam('${meta}')">
        <div class="cam-card-inner">
            <div class="cam-status-dots">
                <span class="cam-status-dot"></span>
                <span class="${recDotClass}" title="${isRecording ? 'در حال ضبط' : 'ضبط غیرفعال'}"></span>
            </div>
            <div class="cam-card-info">
                <div class="cam-card-name">${escapeHTML(c.name)}</div>
                <div class="cam-card-meta">CH ${escapeHTML(String(c.channel_id))}</div>
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

    // Find factory name
    const nvrObj = nvrCache.find(n => n.ip === c.nvr_ip);
    const groupObj = nvrObj && nvrObj.group_id ? groupCache.find(g => g.id === nvrObj.group_id) : null;
    const groupName = groupObj && groupObj.name ? groupObj.name : 'سایر کارخانه‌ها';

    document.getElementById('m-name').textContent = c.name;
    document.getElementById('m-factory').textContent = groupName;
    document.getElementById('m-nvr').textContent = `${getNvrDisplayName(c.nvr_ip)} (${c.nvr_ip})`;
    document.getElementById('m-cam-ip').textContent = c.ip || 'نامشخص';
    document.getElementById('m-cam-ch').textContent = c.channel_id ? `کانال ${c.channel_id}` : 'نامشخص';
    
    const impEl = document.getElementById('m-imp');
    impEl.textContent = ['کم', 'عادی', 'مهم'][c.importance - 1];
    impEl.className = 'badge';
    if (c.importance === 1) impEl.classList.add('badge-info');
    else if (c.importance === 2) impEl.classList.add('badge-warning');
    else if (c.importance === 3) impEl.classList.add('badge-danger');
    
    // Populate specs & recording stats
    document.getElementById('m-model').textContent = c.model || 'نامشخص';
    
    const recConfigEl = document.getElementById('m-rec-config');
    recConfigEl.className = 'badge';
    if (c.recording_scheduled === true) {
        const typeStr = c.recording_schedule_type ? ` - ${c.recording_schedule_type}` : '';
        recConfigEl.textContent = `فعال${typeStr}`;
        recConfigEl.classList.add('badge-success');
    } else if (c.recording_scheduled === false) {
        recConfigEl.textContent = 'غیرفعال';
        recConfigEl.classList.add('badge-danger');
    } else {
        recConfigEl.textContent = 'نامشخص';
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
    window.open(`/api/cameras/${currentCamId}/live`, '_blank');
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
    'OUTAGE_MIN_HOURS_TO_EXPLAIN': 'حداقل زمان قطعی جهت نیاز به رفع ابهام (ساعت)',
    'OUTAGE_EXPLANATION_DEADLINE_HOURS': 'مهلت رفع ابهام قطعی (ساعت)',
    'OUTAGE_ANALYSIS_DAYS': 'روزهای بررسی قطعی در هفته',
    'OUTAGE_ANALYSIS_TIME': 'ساعت بررسی قطعی‌ها (مثال: 07:30)',
};

const notificationEventCatalog = [
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

function notificationKey(eventType, channel = null) {
    const prefix = `NOTIFY_${eventType.toUpperCase()}`;
    return channel ? `${prefix}_${channel.toUpperCase()}` : `${prefix}_ENABLED`;
}

function renderNotificationManagement() {
    const con = document.getElementById('config-forms');
    if (!con || !settingsCache.length) return;
    const values = Object.fromEntries(settingsCache.map(s => [s.key, s.value]));
    const isChecked = key => values[key] !== 'false' ? 'checked' : '';
    const rows = notificationEventCatalog.map(([eventType, title, desc]) => {
        const masterKey = notificationKey(eventType);
        const channels = [['email', 'ایمیل'], ['telegram', 'تلگرام'], ['browser', 'مرورگر']].map(([channel, label]) => {
            const key = notificationKey(eventType, channel);
            return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                <input type="checkbox" id="${key}" ${isChecked(key)}>
                <span>${label}</span>
            </label>`;
        }).join('');
        return `<div style="padding:14px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
                <div><strong style="font-size:13px;">${title}</strong><p style="margin:5px 0 0;font-size:12px;color:var(--text-secondary);">${desc}</p></div>
                <label class="toggle" title="فعال‌سازی همه کانال‌های این رویداد"><input type="checkbox" id="${masterKey}" ${isChecked(masterKey)} onchange="syncNotificationChannels('${eventType}')"><span class="toggle-slider"></span></label>
            </div>
            <div id="notification-channels-${eventType}" style="display:flex;gap:18px;margin-top:11px;padding-right:2px;">${channels}</div>
        </div>`;
    }).join('');
    con.insertAdjacentHTML('afterbegin', `<div class="card" id="grp-Notifications" style="display:none;">
        <div class="settings-card-header"><button class="settings-back-btn" onclick="goBackToSettingsMenu()" title="بازگشت به تنظیمات"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></button><h3>مدیریت مرکزی اعلان‌ها</h3></div>
        <div style="padding:0 20px 20px;"><p style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin:0;padding:16px 0 8px;">خاموش‌کردن هر مورد فقط ارسال اعلان را متوقف می‌کند؛ رویدادها و لاگ‌های سیستم همچنان ثبت می‌شوند.</p>${rows}<div class="settings-action-row"><button class="btn btn-primary" onclick="saveNotificationSettings()">ذخیره تنظیمات اعلان‌ها</button></div></div>
    </div>`);
    notificationEventCatalog.forEach(([eventType]) => syncNotificationChannels(eventType));
}

function syncNotificationChannels(eventType) {
    const master = document.getElementById(notificationKey(eventType));
    const channels = document.getElementById(`notification-channels-${eventType}`);
    if (!master || !channels) return;
    channels.style.opacity = master.checked ? '1' : '.45';
    channels.querySelectorAll('input').forEach(input => input.disabled = !master.checked);
}

async function saveNotificationSettings() {
    try {
        const keys = notificationEventCatalog.flatMap(([eventType]) => [notificationKey(eventType), ...['email', 'telegram', 'browser'].map(channel => notificationKey(eventType, channel))]);
        for (const key of keys) {
            const el = document.getElementById(key);
            const setting = settingsCache.find(s => s.key === key);
            if (el && setting && (el.checked ? 'true' : 'false') !== setting.value) {
                await apiFetch(`${API}/settings/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: el.checked ? 'true' : 'false' }) });
                setting.value = el.checked ? 'true' : 'false';
            }
        }
        showToast('تنظیمات مرکزی اعلان‌ها ذخیره شد', 'success');
    } catch (e) {
        showToast('خطا در ذخیره تنظیمات اعلان‌ها: ' + e.message, 'error');
    }
}

async function loadSettings(activeTabOverride = null) {
    const role = window.currentUser ? window.currentUser.role : 'group_view';

    // 1. Immediately render the settings list menu
    renderSettingsMenu(role);

    // 2. Determine display based on activeTabOverride
    if (activeTabOverride) {
        switchSettingsTab(activeTabOverride);
    } else {
        goBackToSettingsMenu();
    }

    // 3. Parallelize fetches to load data instantly
    let settingsPromise = Promise.resolve([]);
    if (role === 'admin') {
        settingsPromise = apiFetch(`${API}/settings`).then(res => res.json());
    }
    const groupsPromise = apiFetch(`${API}/groups`).then(res => res.json()).catch(() => []);
    const nvrsPromise = apiFetch(`${API}/nvrs`).then(res => res.json()).catch(() => []);

    const [settings, groups, nvrs] = await Promise.all([settingsPromise, groupsPromise, nvrsPromise]);
    settingsCache = settings;
    groupCache = groups;
    nvrCache = nvrs;

    const nvrForm = document.querySelector('#sec-nvr .nvr-form');
    if (nvrForm) {
        nvrForm.style.display = (role === 'admin') ? '' : 'none';
    }

    const con = document.getElementById('config-forms');
    con.innerHTML = '';

    if (role === 'admin') {
        const groupsConfig = {
            'ایمیل': ['MAIL_ENABLED', 'MAIL_SERVER', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_RECIPIENTS', 'MAIL_FIRST_ALERT_DELAY_MINUTES', 'MAIL_LOW_IMPORTANCE_DELAY_MINUTES', 'MAIL_ALERT_FREQUENCY_MINUTES', 'MAIL_MUTE_AFTER_N_ALERTS'],
            'تلگرام': ['TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'TELEGRAM_PROXY', 'TELEGRAM_FIRST_ALERT_DELAY_MINUTES', 'TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES', 'TELEGRAM_ALERT_FREQUENCY_MINUTES', 'TELEGRAM_MUTE_AFTER_N_ALERTS'],
            'قطعی‌ها': ['OUTAGE_MIN_HOUTS_TO_EXPLAIN', 'OUTAGE_EXPLANATION_DEADLINE_HOURS', 'OUTAGE_ANALYSIS_DAYS', 'OUTAGE_ANALYSIS_TIME'] // Note: OUTAGE_MIN_HOURS_TO_EXPLAIN key fallback
        };

        // Find the actual keys in the settings database so we don't request wrong keys
        const actualKeys = settingsCache.map(s => s.key);
        const emailKeys = ['MAIL_ENABLED', 'MAIL_SERVER', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_RECIPIENTS', 'MAIL_FIRST_ALERT_DELAY_MINUTES', 'MAIL_LOW_IMPORTANCE_DELAY_MINUTES', 'MAIL_ALERT_FREQUENCY_MINUTES', 'MAIL_MUTE_AFTER_N_ALERTS'].filter(k => actualKeys.includes(k));
        const telegramKeys = ['TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'TELEGRAM_PROXY', 'TELEGRAM_FIRST_ALERT_DELAY_MINUTES', 'TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES', 'TELEGRAM_ALERT_FREQUENCY_MINUTES', 'TELEGRAM_MUTE_AFTER_N_ALERTS'].filter(k => actualKeys.includes(k));
        const outageKeys = ['OUTAGE_MIN_HOURS_TO_EXPLAIN', 'OUTAGE_MIN_HOUTS_TO_EXPLAIN', 'OUTAGE_EXPLANATION_DEADLINE_HOURS', 'OUTAGE_ANALYSIS_DAYS', 'OUTAGE_ANALYSIS_TIME'].filter(k => actualKeys.includes(k));

        const groupsMapping = {
            'ایمیل': emailKeys,
            'تلگرام': telegramKeys,
            'قطعی‌ها': outageKeys
        };

        const groupKeys = {
            'ایمیل': 'Email',
            'تلگرام': 'Telegram',
            'قطعی‌ها': 'Outages'
        };

        for (const [grp, keys] of Object.entries(groupsMapping)) {
            const engKey = groupKeys[grp];
            const hasTestBtn = ['Email', 'Telegram'].includes(engKey);

            let html = `<div class="card" id="grp-${engKey}" style="display: none;">
                <div class="settings-card-header">
                    <button class="settings-back-btn" onclick="goBackToSettingsMenu()" title="بازگشت به تنظیمات">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                    <h3>تنظیمات ${grp}</h3>
                    ${hasTestBtn ? `<button class="btn btn-ghost" style="padding:4px 12px; font-size:11px; margin-right: auto;" onclick="testConn('${engKey.toLowerCase()}')">تست اتصال</button>` : ''}
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

                if (k === 'OUTAGE_ANALYSIS_DAYS') {
                    const daysVal = item.value || '';
                    const selectedDays = daysVal.split(',').map(x => x.trim());
                    const weekDaysConfig = [
                        { name: 'شنبه', val: '5' },
                        { name: 'یک‌شنبه', val: '6' },
                        { name: 'دوشنبه', val: '0' },
                        { name: 'سه‌شنبه', val: '1' },
                        { name: 'چهارشنبه', val: '2' },
                        { name: 'پنج‌شنبه', val: '3' },
                        { name: 'جمعه', val: '4' }
                    ];
                    
                    let daysCheckboxes = weekDaysConfig.map(day => {
                        return `<label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; user-select: none;">
                            <input type="checkbox" class="day-select-chk" value="${day.val}" ${selectedDays.includes(day.val) ? 'checked' : ''} onchange="updateOutageDaysValue()">
                            <span>${day.name}</span>
                        </label>`;
                    }).join('');
                    
                    html += `<div class="form-field-group span-2">
                        <label class="form-label">${label}</label>
                        <input type="hidden" id="OUTAGE_ANALYSIS_DAYS" value="${daysVal}">
                        <div class="days-checkbox-group" style="display: flex; flex-wrap: wrap; gap: 16px; background: var(--surface-2); padding: 12px 16px; border-radius: var(--radius-sm); border: 1px solid var(--border); margin-top: 5px;">
                            ${daysCheckboxes}
                        </div>
                    </div>`;
                    return;
                }

                const isLongField = ['MAIL_RECIPIENTS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'TELEGRAM_PROXY'].includes(k);
                const gridClass = isLongField ? 'span-2' : '';

                html += `<div class="form-field-group ${gridClass}">
                    <label class="form-label">${label}</label>
                    <input class="form-input" id="${k}" value="${item.value || ''}" type="${k.includes('PASS') || k.includes('TOKEN') ? 'password' : 'text'}">
                </div>`;
            });

            html += `</div>`;

            if (engKey === 'Outages') {
                html += `
                <div class="form-field-group span-2" style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 20px;">
                    <label class="form-label" style="font-weight: bold; font-size: 14px;">مدیریت علت‌های قطعی (رفع ابهام)</label>
                    <div style="display: flex; gap: 8px; margin-top: 10px; margin-bottom: 15px;">
                        <input id="new-cause-name" class="form-input" placeholder="علت جدید (مثال: قطع فیبر نوری)" style="flex: 1;">
                        <button class="btn btn-primary" onclick="addOutageCause()" style="padding: 8px 16px;">افزودن علت</button>
                    </div>
                    <div id="causes-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto;">
                        <!-- Dynamically populated -->
                    </div>
                </div>`;
            }

            html += `<div class="settings-action-row">
                    <button class="btn btn-primary" onclick="apply()">ذخیره و اعمال تنظیمات</button>
                </div>
            </div>`;
            con.innerHTML += html;
        }
        renderNotificationManagement();
    }

    pendingNVRDeletes = new Set();
    document.getElementById('nvr-list').innerHTML = nvrCache.map(n =>
        renderNVRRow(n)
    ).join('');

    // Populate group options in Add NVR form dropdown
    const nvrGroupSelect = document.getElementById('nvrGroup');
    if (nvrGroupSelect) {
        if (!groupCache || !Array.isArray(groupCache)) {
            nvrGroupSelect.innerHTML = '<option value="">بدون کارخانه (بدون گروه)</option>';
        } else {
            nvrGroupSelect.innerHTML = '<option value="">بدون کارخانه (بدون گروه)</option>' + groupCache.map(g => 
                `<option value="${g.id}">${g.name}</option>`
            ).join('');
        }
    }

    // Re-run active tab rendering if an override is active
    if (activeTabOverride) {
        switchSettingsTab(activeTabOverride);
    }
    
    if (window.currentUser && window.currentUser.role === 'admin') {
        loadOutageCauses();
    }
}

async function saveAll(silent = false) {
    let changed = 0;
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
                changed++;
            }
        }
    }
    if (!silent) {
        showToast('تنظیمات با موفقیت ذخیره شد', 'success');
    }
    return changed;
}

async function apply() {
    try {
        await saveAll(true);
        await apiFetch(`${API}/monitor/restart`, { method: 'POST' });
        showToast('تنظیمات با موفقیت ذخیره شد و مانیتورینگ ریستارت گردید', 'success');
        
        // Find currently visible tab by checking which card is displayed
        const tabs = ['sec-nvr', 'sec-groups', 'sec-users', 'sec-my-alerts', 'grp-Notifications', 'grp-Email', 'grp-Telegram', 'grp-Outages', 'grp-Browser', 'grp-Limits', 'sec-system', 'sec-tasks', 'sec-about', 'sec-logs'];
        let activeTab = null;
        for (const id of tabs) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none' && el.style.display !== '') {
                activeTab = id;
                break;
            }
        }
        // Reload settings and restore the same tab
        await loadSettings(activeTab);
    } catch (e) {
        showToast('خطا در ذخیره و اعمال تغییرات: ' + e.message, 'error');
    }
}

function switchSettingsTab(tabId) {
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
        resetLogs();
    }
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

function goBackToSettingsMenu() {
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

function renderSettingsMenu(role) {
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
                <div class="settings-menu-item" onclick="switchSettingsTab('${id}')">
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


function updateOutageDaysValue() {
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

async function loadOutageCauses() {
    const list = document.getElementById('causes-list');
    if (!list) return;
    
    try {
        const res = await apiFetch(`/api/outage-causes`);
        const causes = await res.json();
        
        list.innerHTML = causes.map(c => {
            const statusText = c.is_active ? '' : ' (غیرفعال شده)';
            const actionBtn = `<button class="btn btn-ghost" onclick="deleteOutageCause(${c.id})" style="color: var(--danger); padding: 2px 8px; font-size: 11px;">حذف</button>`;
            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);">
                <span style="font-size: 13px; ${c.is_active ? '' : 'color: var(--text-muted); text-decoration: line-through;'}">${c.name}${statusText}</span>
                ${c.is_active ? actionBtn : ''}
            </div>`;
        }).join('');
    } catch(e) {
        console.error('Error loading outage causes:', e);
    }
}

async function addOutageCause() {
    const input = document.getElementById('new-cause-name');
    const name = input.value.trim();
    if (!name) return showToast('نام علت را وارد کنید', 'error');
    
    try {
        const res = await apiFetch(`/api/outage-causes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'خطا در ثبت علت');
        }
        showToast('علت جدید با موفقیت اضافه شد');
        input.value = '';
        loadOutageCauses();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deleteOutageCause(id) {
    if (!await showConfirm('آیا از حذف/غیرفعال‌سازی این علت قطعی اطمینان دارید؟')) return;
    try {
        const res = await apiFetch(`/api/outage-causes/${id}`, { method: 'DELETE' });
        const data = await res.json();
        showToast(data.message);
        loadOutageCauses();
    } catch (e) {
        showToast(e.message, 'error');
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

function validateNVRInputs() {
    const ipInput = document.getElementById('nvrIp');
    const portInput = document.getElementById('nvrRtspPort');
    const msgLabel = document.getElementById('nvr-validation-msg');
    const addBtn = document.getElementById('btn-add-nvr');

    let ipValid = true;
    let portValid = true;
    let errMsg = '';

    const ipValue = ipInput ? ipInput.value.trim() : '';
    const portValue = portInput ? portInput.value.trim() : '';

    if (!ipValue) {
        ipValid = false;
    } else {
        // ریجکس منعطف جهت پذیرش همزمان آدرس‌های IP و نام‌های دامنه یا میزبان (مانند DDNSها)
        const ipPattern = /^[a-zA-Z0-9_\-\.]+(:[0-9]+)?$/;
        if (!ipPattern.test(ipValue)) {
            ipValid = false;
            errMsg += 'قالب آدرس IP یا میزبان نامعتبر است. ';
        }
    }

    if (portValue) {
        const portVal = parseInt(portValue);
        if (isNaN(portVal) || portVal < 1 || portVal > 65535) {
            portValid = false;
            errMsg += 'پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد.';
        }
    }

    if (msgLabel) msgLabel.textContent = errMsg;

    if (ipValid && portValid) {
        if (ipInput) ipInput.style.borderColor = '';
        if (portInput) portInput.style.borderColor = '';
        if (addBtn) addBtn.disabled = false;
        if (addBtn) addBtn.style.opacity = '1';
        return true;
    } else {
        if (ipInput) {
            if (!ipValid && ipValue) ipInput.style.borderColor = 'var(--danger)';
            else ipInput.style.borderColor = '';
        }

        if (portInput) {
            if (!portValid) portInput.style.borderColor = 'var(--danger)';
            else portInput.style.borderColor = '';
        }

        if (addBtn) addBtn.disabled = true;
        if (addBtn) addBtn.style.opacity = '0.5';
        return false;
    }
}

async function addNVR() {
    if (!validateNVRInputs()) {
        return showToast('لطفاً مقادیر ورودی را به درستی وارد کنید', 'error');
    }
    const name = document.getElementById('nvrName').value.trim();
    const ip = document.getElementById('nvrIp').value.trim();
    const u = document.getElementById('nvrUser').value.trim();
    const p = document.getElementById('nvrPass').value;
    const rtspPort = parseInt(document.getElementById('nvrRtspPort').value) || 554;
    const groupEl = document.getElementById('nvrGroup');
    const groupId = groupEl && groupEl.value ? parseInt(groupEl.value) : null;
    
    if (!ip || !u) return showToast('IP و نام کاربری الزامی است', 'error');

    await apiFetch(`${API}/nvrs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || null, ip, user: u, password: p || null, enabled: true, rtsp_port: rtspPort, group_id: groupId })
    });
    document.getElementById('nvrName').value = '';
    document.getElementById('nvrIp').value = '';
    document.getElementById('nvrUser').value = '';
    document.getElementById('nvrPass').value = '';
    document.getElementById('nvrRtspPort').value = '554';
    if (groupEl) groupEl.value = '';
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
    const canEdit = role === 'admin';

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

    const disabledStyle = n.enabled === false ? 'opacity: 0.5;' : '';
    const enabledBadge = n.enabled === false
        ? `<span class="badge" style="font-size: 11px; margin-right: 6px; background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 2px 6px; border-radius: 4px;">غیرفعال</span>`
        : '';

    return `<div class="list-item" id="nvr-row-${escaped}" data-ip="${n.ip}" style="${disabledStyle}; flex-direction: column; align-items: stretch; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="list-item-info">
                ${n.name ? `<strong style="margin-left: 8px; color: var(--text-primary);">${n.name}</strong>` : ''}
                <span class="list-item-ip">${n.ip}</span>
                <span class="list-item-user">(${n.user})</span>
                <span class="badge" style="font-size: 11px; margin-right: 6px; background: rgba(59, 130, 246, 0.1); color: #3b82f6; padding: 2px 6px; border-radius: 4px;">RTSP: ${n.rtsp_port || 554}</span>
                ${enabledBadge}
                ${groupSelectOrLabel}
            </div>
            <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                <label class="toggle" style="transform: scale(0.85); transform-origin: right; margin: 0;">
                    <input type="checkbox" ${n.enabled !== false ? 'checked' : ''} onchange="toggleNVRenabled('${n.ip}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                ${actionBtns}
            </div>
        </div>
    </div>`;
}

async function toggleNVRenabled(ip, enabled) {
    try {
        await apiFetch(`${API}/nvrs/${encodeURIComponent(ip)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const nRes = await apiFetch(`${API}/nvrs`);
        nvrCache = await nRes.json();
        document.getElementById('nvr-list').innerHTML = nvrCache.map(n => renderNVRRow(n)).join('');
        showToast(enabled ? 'NVR فعال شد' : 'NVR غیرفعال شد');
    } catch (e) {
        showToast('خطا در تغییر وضعیت NVR: ' + e.message, 'error');
    }
}

function renderGroupsList() {
    const list = document.getElementById('group-list');
    if (!list) return;
    if (!groupCache || !Array.isArray(groupCache)) {
        list.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 13px;">در حال بارگذاری کارخانه‌ها...</div>';
        return;
    }
    list.innerHTML = groupCache.map(g => `
        <div class="list-item" id="group-row-${g.id}">
            <div class="list-item-info">
                <strong style="margin-left: 8px; color: var(--text-primary);">${g.name}</strong>
                <span class="list-item-user">${g.description || ''}</span>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
                <button class="btn-icon" onclick="openEditGroupModal(${g.id})" style="width:28px; height:28px" title="ویرایش" aria-label="ویرایش">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>
                <button class="btn-icon" onclick="deleteGroup(${g.id})" style="width:28px; height:28px" title="حذف" aria-label="حذف">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
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
    if (!await showConfirm('آیا از حذف این کارخانه اطمینان دارید؟ NVRهای این کارخانه بدون گروه خواهند شد.')) return;
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
        <div class="edit-nvr-form">
            <div class="form-group-compact">
                <label class="compact-label">آدرس IP یا میزبان</label>
                <input class="form-input form-input-ltr" id="edit-nvr-ip-${escaped}" value="${n.ip}" placeholder="آدرس IP یا میزبان">
            </div>
            <div class="form-group-compact">
                <label class="compact-label">نام دلخواه</label>
                <input class="form-input" id="edit-nvr-name-${escaped}" value="${n.name || ''}" placeholder="نام دلخواه">
            </div>
            <div class="form-group-compact">
                <label class="compact-label">نام کاربری</label>
                <input class="form-input form-input-ltr" id="edit-nvr-user-${escaped}" value="${n.user || ''}" placeholder="نام کاربری">
            </div>
            <div class="form-group-compact">
                <label class="compact-label">رمز عبور جدید</label>
                <input class="form-input form-input-ltr" id="edit-nvr-pass-${escaped}" type="password" placeholder="رمز عبور جدید">
            </div>
            <div class="form-group-compact">
                <label class="compact-label">پورت RTSP</label>
                <input class="form-input form-input-ltr" id="edit-nvr-rtsp-port-${escaped}" type="number" value="${n.rtsp_port || 554}" placeholder="پورت RTSP">
            </div>
            <div style="display: flex; gap: 6px; align-items: flex-end;">
                <button class="btn btn-primary" onclick="saveNVRRow('${n.ip}')" style="flex: 1; height: 38px;">ذخیره</button>
                <button class="btn" style="flex: 1; height: 38px; background: var(--surface-2); color: var(--text-secondary); border: 1px solid var(--border);" onclick="cancelEditNVR('${n.ip}')">انصراف</button>
            </div>
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
    const ipEl = document.getElementById(`edit-nvr-ip-${escaped}`);
    const nameEl = document.getElementById(`edit-nvr-name-${escaped}`);
    const userEl = document.getElementById(`edit-nvr-user-${escaped}`);
    const passEl = document.getElementById(`edit-nvr-pass-${escaped}`);
    const rtspPortEl = document.getElementById(`edit-nvr-rtsp-port-${escaped}`);
    
    if (!ipEl || !ipEl.value.trim()) {
        return showToast('آدرس IP یا میزبان الزامی است', 'error');
    }
    const newIp = ipEl.value.trim();
    const ipPattern = /^[a-zA-Z0-9_\-\.]+(:[0-9]+)?$/;
    if (!ipPattern.test(newIp)) {
        return showToast('قالب آدرس IP یا میزبان نامعتبر است.', 'error');
    }

    if (!userEl.value.trim()) {
        return showToast('نام کاربری الزامی است', 'error');
    }

    const portVal = parseInt(rtspPortEl.value.trim());
    if (isNaN(portVal) || portVal < 1 || portVal > 65535) {
        return showToast('پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد.', 'error');
    }
    
    const payload = {
        ip: newIp,
        name: nameEl.value.trim() || null,
        user: userEl.value.trim(),
        rtsp_port: portVal
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
        
        loadSettings();
    } catch (e) {
        showToast('خطا در به‌روزرسانی NVR: ' + e.message, 'error');
    }
}

async function purgeDatabase() {
    if (!await showConfirm('توجه: تمامی اطلاعات دیتابیس (دوربین‌ها، NVRها، لاگ‌ها، دسته‌بندی‌ها و تنظیمات) به طور کامل پاک خواهند شد. آیا مطمئن هستید؟')) return;
    try {
        await apiFetch(`${API}/data/purge`, { method: 'POST' });
        showToast('پاکسازی کامل دیتابیس با موفقیت انجام شد');
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
    if (!await showConfirm(`آیا مطمئنید؟ پایگاه داده فعلی با فایل "${file.name}" جایگزین خواهد شد و مانیتور راه‌اندازی مجدد می‌شود.`)) return;
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

async function importJsonConfig(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (!file.name.endsWith('.json')) {
        showToast('فایل باید با پسوند .json باشد', 'error');
        return;
    }
    if (!await showConfirm(`توجه: با بارگذاری این فایل، تمامی تنظیمات فعلی، لیست NVRها، گروه‌ها و کاربران کاملاً حذف شده و با اطلاعات فایل "${file.name}" جایگزین خواهند شد. آیا ادامه می‌دهید؟`)) return;
    const statusEl = document.getElementById('import-json-status');
    if (statusEl) statusEl.textContent = 'در حال بارگذاری...';
    try {
        const text = await file.text();
        let jsonData;
        try {
            jsonData = JSON.parse(text);
        } catch (err) {
            throw new Error('فرمت فایل JSON معتبر نیست');
        }
        
        const res = await fetch(`${API}/config/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(jsonData),
            credentials: 'include',
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'خطای نامشخص' }));
            throw new Error(err.detail || 'خطا در بارگذاری تنظیمات');
        }
        if (statusEl) statusEl.textContent = '';
        showToast('پیکربندی JSON با موفقیت بارگذاری شد. در حال بازنشانی مانیتور...');
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

let confirmPromiseResolver = null;

function showConfirm(message, title = 'تایید عملیات', isDangerous = true) {
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

function closeConfirmModal(result) {
    document.getElementById('confirmModal').classList.remove('open');
    if (confirmPromiseResolver) {
        confirmPromiseResolver(result);
        confirmPromiseResolver = null;
    }
}

// --- LOGS ---
function delayLogSearch() {
    clearTimeout(logTimer);
    logTimer = setTimeout(() => {
        logSearchVal = document.getElementById('logSearch').value;
        resetLogs();
    }, 500);
}

let logLevelFilter = 'all';

function setLogLevelFilter(val) {
    logLevelFilter = val;
    resetLogs();
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

function translateLogDetails(text) {
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

async function fetchLogs() {
    if (loading || allLoaded) return;
    loading = true;
    document.getElementById('logLoader').classList.remove('hidden');

    let url = `${API}/logs?limit=30&offset=${logOff}`;
    if (logFilter) url += `&category=${encodeURIComponent(logFilter)}`;
    if (logLevelFilter && logLevelFilter !== 'all') url += `&level=${encodeURIComponent(logLevelFilter)}`;
    if (logSearchVal) url += `&q=${encodeURIComponent(logSearchVal)}`;

    const res = await apiFetch(url);
    const logs = await res.json();

    if (logs.length < 30) allLoaded = true;

    document.getElementById('log-list').insertAdjacentHTML('beforeend', logs.map(l => {
        let detail = translateLogDetails(l.details);
        if (detail.includes('mins')) detail = `<span class="downtime-tag">${detail.match(/\d+m/)}</span> ` + detail;

        const level = (l.level || 'INFO').toUpperCase();
        let levelCls = 'status-success';
        if (['ERROR', 'CRITICAL', 'FAILED', 'OFFLINE', 'AUTHERROR'].includes(level) || ['Error', 'Failed', 'Offline', 'AuthError'].includes(l.state)) {
            levelCls = 'status-danger';
        } else if (level === 'WARNING' || level === 'CHANGED') {
            levelCls = 'status-warning';
        }

        const category = l.category || l.log_type || 'System';
        const action = l.action || l.state || level;
        const actor = (l.actor_username && l.actor_username !== 'system') 
            ? `<span style="font-weight:600; color:var(--primary);">${l.actor_username}</span>` + (l.actor_ip ? ` <span style="font-size:11px; color:var(--text-muted);">(${l.actor_ip})</span>` : '')
            : `<span style="color:var(--text-muted); font-size:12px;">سیستم</span>`;

        return `<tr>
            <td style="white-space:nowrap; font-size:12px;">${l.shamsi_date}</td>
            <td style="white-space:nowrap;">
                <span class="chip" style="font-size:11px; padding:2px 8px; border-radius:10px;">${category}</span>
                <span class="${levelCls}" style="font-weight:600; font-size:11px; margin-right:4px;">${level}</span>
            </td>
            <td style="white-space:nowrap;">${actor}</td>
            <td style="white-space:nowrap; font-weight:600; font-size:12px; color:var(--text);">${action}</td>
            <td style="font-size:13px; line-height:1.4;">${detail}</td>
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

    const loaderHtml = `
        <div class="skeleton-loading">
            <div class="skeleton skeleton-row"></div>
            <div class="skeleton skeleton-row short"></div>
            <div class="skeleton skeleton-row"></div>
        </div>
    `;
    document.getElementById('rep-list').innerHTML = loaderHtml;
    document.getElementById('rep-nvr-list').innerHTML = loaderHtml;
    document.getElementById('rep-auth-list').innerHTML = loaderHtml;
    document.getElementById('rep-task-list').innerHTML = loaderHtml;

    const res = await apiFetch(`${API}/reports/generate?start=${s}&end=${e}`);
    const data = await res.json();

    // Load and render charts
    loadAndRenderCharts(s, e);

    // 1. Camera Downtimes
    const cameras = data.cameras || [];
    if (cameras.length === 0) {
        document.getElementById('rep-list').innerHTML = '<div class="empty-state">قطعی‌ای یافت نشد</div>';
    } else {
        const max = Math.max(...cameras.map(i => i.mins));
        document.getElementById('rep-list').innerHTML = cameras.map(i => {
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

    // 2. NVR Events
    const nvrEvents = data.nvr_events || [];
    if (nvrEvents.length === 0) {
        document.getElementById('rep-nvr-list').innerHTML = '<div class="empty-state">رویدادی یافت نشد</div>';
    } else {
        document.getElementById('rep-nvr-list').innerHTML = nvrEvents.map(i => {
            const statusClass = i.state === 'Online' ? 'success' : 'danger';
            const statusText = i.state === 'Online' ? 'وصل مجدد NVR' : 'قطع ارتباط NVR';
            return `<div class="report-item">
                <div class="report-item-header" style="margin-bottom:0;">
                    <span class="report-item-name" style="display:flex; align-items:center; gap:8px;">
                        <span class="badge ${statusClass}">${statusText}</span>
                        <span>${translateLogDetails(i.details)}</span>
                    </span>
                    <span class="report-item-value" style="font-size:12px; color:var(--text-muted);">${i.shamsi_date}</span>
                </div>
            </div>`;
        }).join('');
    }

    // 3. NVR Auth Errors
    const authErrors = data.nvr_auth_errors || [];
    if (authErrors.length === 0) {
        document.getElementById('rep-auth-list').innerHTML = '<div class="empty-state">خطایی یافت نشد</div>';
    } else {
        document.getElementById('rep-auth-list').innerHTML = authErrors.map(i => {
            return `<div class="report-item">
                <div class="report-item-header" style="margin-bottom:0;">
                    <span class="report-item-name" style="display:flex; align-items:center; gap:8px;">
                        <span class="badge warning">خطای رمز عبور</span>
                        <span>${translateLogDetails(i.details)}</span>
                    </span>
                    <span class="report-item-value" style="font-size:12px; color:var(--text-muted);">${i.shamsi_date}</span>
                </div>
            </div>`;
        }).join('');
    }

    // 4. Task Events
    const taskEvents = data.task_events || [];
    if (taskEvents.length === 0) {
        document.getElementById('rep-task-list').innerHTML = '<div class="empty-state">رویدادی یافت نشد</div>';
    } else {
        document.getElementById('rep-task-list').innerHTML = taskEvents.map(i => {
            const statusClass = i.state === 'Started' ? 'info' : (i.state === 'Success' ? 'success' : 'danger');
            const statusText = i.state === 'Started' ? 'شروع اجرا' : (i.state === 'Success' ? 'پایان موفق' : 'خطای اجرا');
            return `<div class="report-item">
                <div class="report-item-header" style="margin-bottom:0;">
                    <span class="report-item-name" style="display:flex; align-items:center; gap:8px;">
                        <span class="badge ${statusClass}">${statusText}</span>
                        <span>${translateLogDetails(i.details)}</span>
                    </span>
                    <span class="report-item-value" style="font-size:12px; color:var(--text-muted);">${i.shamsi_date}</span>
                </div>
            </div>`;
        }).join('');
    }
}

function toggleReportSection(forceHeatmap = null) {
    const listSection = document.getElementById('report-list-section');
    const heatmapSection = document.getElementById('report-heatmap-section');
    if (listSection) listSection.classList.remove('hidden');
    if (heatmapSection) heatmapSection.classList.remove('hidden');
}

// ===== CHARTS =====
let chartTrendInstance = null;
let chartCausesInstance = null;
let chartGroupsInstance = null;
let chartTopCamerasInstance = null;
let chartStatusInstance = null;

function switchChartTab(tabId) {
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

function getChartColor(varName, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
}

async function loadAndRenderCharts(s, e) {
    const chartsSection = document.getElementById('report-charts-section');
    if (chartsSection) {
        chartsSection.style.display = 'flex';
    }
    
    try {
        const res = await apiFetch(`${API}/reports/charts?start=${s}&end=${e}`);
        const data = await res.json();
        
        renderTrendChart(data.trend_chart);
        renderCausesChart(data.causes_chart);
        renderGroupsChart(data.group_chart);
        renderTopCamerasChart(data.top_cameras_chart);
        renderStatusChart(data.status_chart);
    } catch (err) {
        console.error('Error loading charts:', err);
    }
}

function renderTrendChart(chartData) {
    const ctx = document.getElementById('chart-trend');
    if (!ctx) return;
    
    if (chartTrendInstance) {
        chartTrendInstance.destroy();
    }
    
    const textColor = getChartColor('--text', '#f1f5f9');
    const gridColor = getChartColor('--border', '#2a2a36');
    
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

function renderCausesChart(chartData) {
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
                    legend: { labels: { color: getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } } }
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
                borderColor: getChartColor('--surface', '#12121a')
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
                    labels: { color: getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                }
            }
        }
    });
}

function renderGroupsChart(chartData) {
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
                    grid: { color: getChartColor('--border', '#2a2a36') },
                    ticks: { color: getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                },
                y: {
                    grid: { color: getChartColor('--border', '#2a2a36') },
                    ticks: { color: getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } },
                    beginAtZero: true
                }
            }
        }
    });
}

function renderTopCamerasChart(chartData) {
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
                    grid: { color: getChartColor('--border', '#2a2a36') },
                    ticks: { color: getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } },
                    beginAtZero: true
                },
                y: {
                    grid: { color: getChartColor('--border', '#2a2a36') },
                    ticks: { color: getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                }
            }
        }
    });
}

function renderStatusChart(chartData) {
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
                borderColor: getChartColor('--surface', '#12121a')
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
                    labels: { color: getChartColor('--text', '#f1f5f9'), font: { family: 'inherit' } }
                }
            }
        }
    });
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
    warmUpSearchCache();
    connectWS();
    initBrowserAlerts();
    checkAdminPasswordWarning();

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

    renderDash();
    renderImportantCamerasWidget();
    renderOffCamerasWidget();
    renderCameraChangesWidget();
    renderNvrHealthWidget();
    renderNvrHealthSummaryWidget();
    renderDashboardCharts();

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
        updateMapMarkersFromWS(cams);
    }
}

async function logout() {
    try {
        await apiFetch(`${API}/auth/logout`, { method: 'POST' });
    } catch (e) { }
    window.location.href = '/login';
}

function applyTheme(theme) {
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
    updateThemeIcon(theme);
}

// System theme listener
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        const currentTheme = localStorage.getItem('hikstatus-theme') || 'system';
        if (currentTheme === 'system') {
            applyTheme('system');
        }
    });
}

function toggleTheme() {
    const currentTheme = localStorage.getItem('hikstatus-theme') || 'system';
    let nextTheme = 'light';
    if (currentTheme === 'system') {
        nextTheme = 'light';
    } else if (currentTheme === 'light') {
        nextTheme = 'dark';
    } else if (currentTheme === 'dark') {
        nextTheme = 'system';
    }

    applyTheme(nextTheme);

    let themeLabel = '';
    if (nextTheme === 'system') themeLabel = 'هماهنگ با سیستم';
    else if (nextTheme === 'light') themeLabel = 'روشن';
    else if (nextTheme === 'dark') themeLabel = 'تاریک';

    if (typeof showToast === 'function') {
        showToast(`پوسته به حالت «${themeLabel}» تغییر یافت`);
    }
}

function updateThemeIcon(theme) {
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

// Call on load to set initial icon and kiosk listeners
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(localStorage.getItem('hikstatus-theme') || 'system');
    initKioskListeners();
    initDashboardCustomization();
});

function isKioskActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || document.body.classList.contains('kiosk-mode'));
}

function updateKioskUIState() {
    const isFS = isKioskActive();
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

function toggleKiosk() {
    const doc = document.documentElement;
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);

    if (!isFS) {
        const req = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
        if (req) {
            const p = req.call(doc);
            if (p && typeof p.then === 'function') {
                p.then(() => {
                    document.body.classList.add('kiosk-mode');
                    updateKioskUIState();
                }).catch((err) => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                    document.body.classList.toggle('kiosk-mode');
                    updateKioskUIState();
                });
            } else {
                document.body.classList.add('kiosk-mode');
                updateKioskUIState();
            }
        } else {
            document.body.classList.toggle('kiosk-mode');
            updateKioskUIState();
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
        updateKioskUIState();
    }
}

function initKioskListeners() {
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
        document.addEventListener(evt, () => {
            const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
            if (!isFS) {
                document.body.classList.remove('kiosk-mode');
            } else {
                document.body.classList.add('kiosk-mode');
            }
            updateKioskUIState();
        });
    });
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
    
    notification.onclick = () => {
        window.focus();
        nav('dash');
        notification.close();
    };
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
            nav('dash');
            notification.close();
        };
    }

    playSynthesizedSound(category);
}

// ===== MAP & HEATMAP LOGIC =====
let map = null;
let mapMarkers = [];
let mapClusterGroup = null;
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
    if (!await showConfirm('آیا از حذف این پлан مطمئن هستید؟')) return;

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
    if (!await showConfirm('آیا از حذف این دوربین از نقشه مطمئن هستید؟')) return;

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

    if (mapClusterGroup) {
        map.removeLayer(mapClusterGroup);
        mapClusterGroup.clearLayers();
    } else {
        mapClusterGroup = L.markerClusterGroup({
            maxClusterRadius: 50,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true
        });
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

    if (!mapEditMode) {
        map.addLayer(mapClusterGroup);
    }
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

// User CRUD management
let usersCache = [];

function populateInspectorGroupsList() {
    const listCon = document.getElementById('inspector-groups-list');
    if (!listCon) return;
    if (!groupCache || groupCache.length === 0) {
        listCon.innerHTML = '<span style="font-size: 12px; color: var(--text-muted); grid-column: 1 / -1;">کارخانه‌ای تعریف نشده است</span>';
        return;
    }
    listCon.innerHTML = groupCache.map(g => `
        <label style="font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; background: var(--surface); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);">
            <input type="checkbox" class="inspector-group-cb" value="${g.id}" onchange="updateInspectorSelectAllState()">
            <span style="user-select: none;">${g.name}</span>
        </label>
    `).join('');
    updateInspectorSelectAllState();
}

function toggleAllInspectorGroups(checked) {
    const checkboxes = document.querySelectorAll('.inspector-group-cb');
    checkboxes.forEach(cb => cb.checked = checked);
}

function updateInspectorSelectAllState() {
    const checkboxes = document.querySelectorAll('.inspector-group-cb');
    const selectAllCb = document.getElementById('inspector-select-all');
    if (!selectAllCb || checkboxes.length === 0) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    selectAllCb.checked = allChecked;
}

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
        
        populateInspectorGroupsList();
        
        // Handle User Role change to show/hide group select or inspector access container
        const roleSelect = document.getElementById('userRole');
        if (roleSelect && !roleSelect.dataset.hasListener) {
            roleSelect.dataset.hasListener = 'true';
            roleSelect.addEventListener('change', (e) => {
                const groupSelect = document.getElementById('userGroup');
                const inspectorCon = document.getElementById('inspector-groups-container');
                if (e.target.value === 'it_manager' || e.target.value === 'inspector') {
                    if (groupSelect) groupSelect.style.display = 'none';
                    if (inspectorCon) inspectorCon.style.display = 'block';
                } else if (e.target.value === 'admin') {
                    if (groupSelect) groupSelect.style.display = 'none';
                    if (inspectorCon) inspectorCon.style.display = 'none';
                } else {
                    if (groupSelect) groupSelect.style.display = '';
                    if (inspectorCon) inspectorCon.style.display = 'none';
                }
            });
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
                <button class="btn btn-ghost" onclick="openEditUserModal(${u.id})" style="color:var(--primary); padding: 4px 8px;">ویرایش</button>
                <button class="btn btn-ghost" onclick="deleteUser(${u.id})" style="color:var(--danger); padding: 4px 8px;">حذف</button>
            </div>
        </div>`;
    }).join('');
}

async function addUser() {
    const username = document.getElementById('userName').value.trim();
    const password = document.getElementById('userPass').value;
    const role = document.getElementById('userRole').value;
    const grpVal = document.getElementById('userGroup').value;
    
    let accessible_group_ids = null;
    let group_id = null;
    if (role === 'inspector' || role === 'it_manager') {
        const checkedCbs = Array.from(document.querySelectorAll('.inspector-group-cb:checked')).map(cb => cb.value);
        const allCbs = document.querySelectorAll('.inspector-group-cb');
        if (checkedCbs.length > 0 && checkedCbs.length < allCbs.length) {
            accessible_group_ids = checkedCbs.join(',');
            group_id = parseInt(checkedCbs[0]);
        } else if (checkedCbs.length === allCbs.length) {
            accessible_group_ids = null;
            group_id = checkedCbs[0] ? parseInt(checkedCbs[0]) : null;
        } else if (checkedCbs.length === 0) {
            accessible_group_ids = '0';
            group_id = null;
        }
    } else if (role !== 'admin' && grpVal) {
        group_id = parseInt(grpVal);
    }
    
    if (!username || !password) {
        return showToast('نام کاربری و رمز عبور را وارد کنید', 'error');
    }
    
    try {
        await apiFetch(`${API}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role, group_id, accessible_group_ids })
        });
        showToast('کاربر جدید با موفقیت اضافه شد');
        document.getElementById('userName').value = '';
        document.getElementById('userPass').value = '';
        toggleAllInspectorGroups(false);
        loadUsers();
    } catch (e) {
        showToast('خطا در افزودن کاربر: ' + e.message, 'error');
    }
}

async function deleteUser(id) {
    if (!await showConfirm('آیا از حذف این کاربر مطمئن هستید؟')) return;
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
    
    cancel2FASetup();
    update2FAUIState();
    
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

function update2FAUIState() {
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

let activeQRCode = null;

async function start2FASetup() {
    try {
        const res = await apiFetch(`${API}/auth/2fa/setup`, {
            method: 'POST'
        });
        const data = await res.json();
        
        document.getElementById('p-2fa-disabled-section').style.display = 'none';
        document.getElementById('p-2fa-setup-section').style.display = 'flex';
        document.getElementById('p-2fa-manual-key').value = data.secret;
        document.getElementById('p-2fa-verification-code').value = '';
        
        const qrContainer = document.getElementById('p-2fa-qrcode');
        qrContainer.innerHTML = '';
        
        if (typeof QRCode !== 'undefined') {
            activeQRCode = new QRCode(qrContainer, {
                text: data.otpauth_url,
                width: 160,
                height: 160,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        } else {
            qrContainer.innerHTML = '<div style="color:var(--danger);font-size:12px;padding:20px 0;">خطا در بارگذاری کتابخانه QR Code. لطفاً دوباره تلاش کنید.</div>';
        }
    } catch (e) {
        showToast('خطا در راه‌اندازی ورود دو مرحله‌ای: ' + e.message, 'error');
    }
}

function cancel2FASetup() {
    const codeField = document.getElementById('p-2fa-verification-code');
    if (codeField) codeField.value = '';
    update2FAUIState();
}

async function verify2FAAndEnable() {
    const code = document.getElementById('p-2fa-verification-code').value.trim();
    if (code.length !== 6 || isNaN(code)) {
        return showToast('لطفاً کد ۶ رقمی را به‌طور صحیح وارد کنید', 'error');
    }
    
    try {
        await apiFetch(`${API}/auth/2fa/verify-setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        
        showToast('ورود دو مرحله‌ای با موفقیت فعال شد');
        window.currentUser.two_factor_enabled = true;
        update2FAUIState();
    } catch (e) {
        showToast('خطا در تایید کد: ' + e.message, 'error');
    }
}

function copy2FAKey() {
    const keyInput = document.getElementById('p-2fa-manual-key');
    keyInput.select();
    navigator.clipboard.writeText(keyInput.value);
    showToast('کلید با موفقیت در حافظه کپی شد');
}

async function disable2FA() {
    const password = document.getElementById('p-2fa-disable-password').value;
    if (!password) {
        return showToast('لطفاً برای غیرفعال‌سازی، رمز عبور خود را وارد کنید', 'error');
    }
    
    try {
        await apiFetch(`${API}/auth/2fa/disable`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        showToast('ورود دو مرحله‌ای غیرفعال شد');
        window.currentUser.two_factor_enabled = false;
        update2FAUIState();
    } catch (e) {
        showToast('خطا در غیرفعال‌سازی: ' + e.message, 'error');
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

function parseIntervalToUnit(seconds) {
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

function formatInterval(seconds) {
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

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '-';
    if (seconds < 60) return `${Math.round(seconds)} ثانیه`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} دقیقه`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h} ساعت و ${m} دقیقه` : `${h} ساعت`;
}

const TASK_DETAILS = {
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

function renderScheduledTasks() {
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
                : `<button class="btn btn-ghost" onclick="confirmRunTask('${t.id}', '${t.name}')" style="color: #22c55e; padding: 4px 10px; font-size: 12px;">اجرا</button>`);

        const stopBtn = isRunning
            ? `<button class="btn btn-ghost" onclick="stopTask('${t.id}')" style="color: #ef4444; padding: 4px 10px; font-size: 12px;">توقف</button>`
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
                            <input type="checkbox" ${isChecked} onchange="toggleTask('${t.id}', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="task-card-body">
                    <div class="task-card-row">
                        <span class="task-card-label">آخرین اجرا:</span>
                        <span class="task-card-value">${t.last_run ? displayPersianDateTime(t.last_run) : 'هرگز'} ${t.last_duration ? '(' + formatDuration(t.last_duration) + ')' : ''} - ${lastStatusBadge}</span>
                    </div>
                    ${errorHtml}
                    <div class="task-card-row">
                        <span class="task-card-label">اجرای بعدی:</span>
                        <span class="task-card-value">${displayPersianDateTime(t.next_run)}</span>
                    </div>
                    <div class="task-card-row">
                        <span class="task-card-label">دوره تکرار:</span>
                        <div class="task-card-interval">
                            ${t.id === 'analyze_outages' ? `
                                <span class="task-card-value" style="color: var(--text-muted); font-size: 12px;">وابسته به تنظیمات بررسی قطعی‌ها</span>
                            ` : (() => {
                                const p = parseIntervalToUnit(t.interval);
                                return `
                                <span class="task-card-value">${formatInterval(t.interval)}</span>
                                <div class="task-card-interval-edit" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                    <input type="number" id="interval-val-${t.id}" class="form-input" style="width: 65px; padding: 4px 6px; font-size: 12px; text-align: center;" value="${p.val}" min="1">
                                    <select id="interval-unit-${t.id}" class="form-input" style="padding: 4px 6px; font-size: 12px; width: 85px;">
                                        <option value="1" ${p.unit === 1 ? 'selected' : ''}>ثانیه</option>
                                        <option value="60" ${p.unit === 60 ? 'selected' : ''}>دقیقه</option>
                                        <option value="3600" ${p.unit === 3600 ? 'selected' : ''}>ساعت</option>
                                        <option value="86400" ${p.unit === 86400 ? 'selected' : ''}>روز</option>
                                    </select>
                                    <button class="btn btn-sm" onclick="saveTaskInterval('${t.id}')" style="padding: 4px 10px; font-size: 11px; background: var(--surface-3); border: 1px solid var(--border);">ذخیره</button>
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

async function confirmRunTask(id, name) {
    if (await showConfirm(`آیا از اجرای دستی «${name}» اطمینان دارید؟`)) {
        runTask(id);
    }
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
    const valInput = document.getElementById(`interval-val-${id}`);
    const unitSelect = document.getElementById(`interval-unit-${id}`);
    if (!valInput || !unitSelect) return;
    
    const num = parseInt(valInput.value);
    const unit = parseInt(unitSelect.value);
    
    if (isNaN(num) || num <= 0) {
        showToast("مقدار دوره زمانی معتبر نیست", "error");
        return;
    }
    
    const interval = num * unit;

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
    if (task.id === 'sync_nvr_health') {
        renderNvrHealthWidget();
        renderNvrHealthSummaryWidget();
    }
}

// ===== GLOBAL SEARCH AND DROPDOWN =====
async function warmUpSearchCache() {
    try {
        if (!nvrCache || nvrCache.length === 0) {
            const nRes = await apiFetch(`${API}/nvrs`);
            nvrCache = await nRes.json();
        }
        if (!groupCache || groupCache.length === 0) {
            const gRes = await apiFetch(`${API}/groups`);
            groupCache = await gRes.json();
        }
        if (!dashCamerasCache || dashCamerasCache.length === 0) {
            const res = await apiFetch(`${API}/cameras`);
            dashCamerasCache = await res.json();
        }
    } catch (e) {
        console.error('Failed to warm up search cache:', e);
    }
}

function toggleGlobalSearch(event) {
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
        
        warmUpSearchCache();
    }
}

document.addEventListener('click', (e) => {
    const container = document.querySelector('.global-search-container');
    const dropdown = document.getElementById('global-search-dropdown');
    if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

function onGlobalSearch(query) {
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
        const nvrName = nvrObj && nvrObj.name ? nvrObj.name : `NVR ${getNvrNum(c.nvr_ip)}`;
        const groupObj = nvrObj && nvrObj.group_id ? groupCache.find(g => g.id === nvrObj.group_id) : null;
        const groupName = groupObj && groupObj.name ? groupObj.name : 'سایر NVRها';

        const pathText = `${groupName} › ${nvrName} › ${c.name}`;
        const meta = encodeURIComponent(JSON.stringify(c));
        const statusDot = c.status === 'Online' ? 
            '<span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block;"></span>' : 
            '<span style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; display: inline-block;"></span>';

        return `<div class="search-result-item" onclick="showCam('${meta}'); toggleGlobalSearch();" style="padding: 8px; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: background 0.2s; border-radius: 4px; gap: 8px;">
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

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}

// Outage Explanations UI logic
let outagesCache = [];
let outagesSelectedIds = [];
let currentOutagePage = 1;
const outagesPerPage = 15;
let currentSuggestedCause = null;
let currentSuggestedDetail = null;
let isBulkExplanation = false;

async function loadOutageExplanations() {
    try {
        const res = await apiFetch(`${API}/outage-explanations`);
        outagesCache = await res.json();
        
        outagesSelectedIds = [];
        currentOutagePage = 1;
        updateOutagesBulkBar();

        const selectAllChk = document.getElementById('outage-select-all');
        if (selectAllChk) selectAllChk.checked = false;

        // Populate the group filter dynamically
        populateOutageGroupFilter();
        
        renderOutagesList();
    } catch (e) {
        console.error('Error loading outages:', e);
        showToast('خطا در بارگذاری لیست رفع ابهام قطعی‌ها: ' + e.message, 'error');
    }
}

function populateOutageGroupFilter() {
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

function filterOutages() {
    renderOutagesList();
}

function renderOutagesList() {
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

    renderOutagesPageButtons(totalPages);

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
                actionBtn = `<button class="btn btn-primary" onclick="openExplanationModal(${o.id})" style="padding: 4px 8px; font-size: 12px; background: #6366f1; border-color: #6366f1; cursor: pointer;">ویرایش</button>`;
            } else {
                actionBtn = '<span style="font-size: 12px; color: var(--text-muted);">غیر قابل ویرایش</span>';
            }
        } else if (o.status === 'expired') {
            statusBadge = '<span class="badge badge-danger" style="background:#ef4444; color:#fff; padding: 4px 8px; border-radius: 4px; font-size:12px;">منقضی شده</span>';
            if (role === 'admin') {
                actionBtn = `<button class="btn btn-primary" onclick="openExplanationModal(${o.id})" style="padding: 4px 8px; font-size: 12px; background: #6366f1; border-color: #6366f1; cursor: pointer;">رفع ابهام (ادمین)</button>`;
            } else {
                actionBtn = '<span style="font-size: 12px; color: var(--danger);">پایان مهلت</span>';
            }
        } else {
            statusBadge = '<span class="badge badge-warning" style="background:#f59e0b; color:#fff; padding: 4px 8px; border-radius: 4px; font-size:12px;">در انتظار رفع ابهام</span>';
            if (canExplain) {
                actionBtn = `<button class="btn btn-primary" onclick="openExplanationModal(${o.id})" style="padding: 4px 8px; font-size: 12px; cursor: pointer;">رفع ابهام</button>`;
            } else {
                actionBtn = '<span style="font-size: 12px; color: var(--text-muted);">-</span>';
            }
        }
        
        const isChecked = outagesSelectedIds.includes(o.id) ? 'checked' : '';
        const checkboxHtml = `<input type="checkbox" class="outage-row-checkbox" value="${o.id}" ${isChecked} onchange="onOutageRowCheckboxChange(${o.id}, this.checked)" style="cursor: pointer;">`;

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

function renderOutagesPageButtons(totalPages) {
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
            renderOutagesList();
        };
        container.appendChild(btn);
    }
}

function changeOutagesPage(direction) {
    currentOutagePage += direction;
    renderOutagesList();
}

function onOutageRowCheckboxChange(id, checked) {
    if (checked) {
        if (!outagesSelectedIds.includes(id)) {
            outagesSelectedIds.push(id);
        }
    } else {
        outagesSelectedIds = outagesSelectedIds.filter(x => x !== id);
    }
    updateOutagesBulkBar();
}

function toggleSelectAllOutages() {
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
    updateOutagesBulkBar();
}

function updateOutagesBulkBar() {
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

async function openExplanationModal(id) {
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
        const res = await apiFetch(`/api/outage-causes`);
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

async function openBulkExplanationModal() {
    if (outagesSelectedIds.length === 0) {
        showToast('هیچ موردی انتخاب نشده است', 'error');
        return;
    }
    isBulkExplanation = true;

    // پنهان کردن بنر پیشنهاد هوشمند برای ثبت دسته‌جمعی
    const banner = document.getElementById('outages-suggestion-banner');
    if (banner) banner.classList.add('hidden');

    document.getElementById('exp-outage-id').value = '';

    try {
        const res = await apiFetch(`/api/outage-causes`);
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

function applySystemSuggestion() {
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
    showToast('پیشنهاد هوشمند سیستم با موفقیت اعمال شد');
}

function closeExplanationModal() {
    const modal = document.getElementById('explanationModal');
    if (modal) {
        modal.classList.remove('open');
        modal.classList.add('hidden');
    }
}

async function submitExplanation() {
    const explanation_type = document.getElementById('exp-type').value;
    const explanation_detail = document.getElementById('exp-detail').value.trim();
    
    try {
        if (isBulkExplanation) {
            if (outagesSelectedIds.length === 0) {
                showToast('هیچ موردی برای ثبت انتخاب نشده است', 'error');
                return;
            }
            await apiFetch(`${API}/outage-explanations/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: outagesSelectedIds,
                    explanation_type,
                    explanation_detail
                })
            });
            showToast('رفع ابهام دسته‌جمعی قطعی‌ها با موفقیت انجام شد');
        } else {
            const id = parseInt(document.getElementById('exp-outage-id').value);
            await apiFetch(`${API}/outage-explanations/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ explanation_type, explanation_detail })
            });
            showToast('رفع ابهام قطعی با موفقیت انجام شد');
        }
        closeExplanationModal();
        loadOutageExplanations();
    } catch (e) {
        showToast('خطا در ثبت رفع ابهام قطعی: ' + e.message, 'error');
    }
}

// ===== DASHBOARD CUSTOMIZATION & DRAG-AND-DROP =====
const SIZES = ['size-full', 'size-half', 'size-third'];
const SIZE_LABELS = { 'size-full': '100%', 'size-half': '50%', 'size-third': '33%' };

function cycleWidgetSize(widgetId) {
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

    saveDashboardLayout();
    if (widgetId === 'widget-chart-status' || widgetId === 'widget-chart-causes') {
        setTimeout(renderDashboardCharts, 150);
    }
}

const DEFAULT_WIDGET_ORDER = [
    'widget-cam-stats',
    'widget-nvr-stats',
    'widget-nvr-health',
    'widget-nvr-health-summary',
    'widget-factory-summary',
    'widget-off-recording',
    'widget-camera-changes',
    'widget-offline-section',
    'widget-all-ok',
    'widget-nvr-container',
    'widget-important-cams',
    'widget-chart-status',
    'widget-chart-causes',
    'widget-ping-summary'
];

const WIDGET_METADATA = {
    'widget-cam-stats': { title: 'وضعیت دوربین‌ها', desc: 'نمایش تعداد کل، متصل و قطع دوربین‌ها' },
    'widget-nvr-stats': { title: 'وضعیت NVRها', desc: 'نمایش تعداد کل، متصل و قطع دستگاه‌های NVR' },
    'widget-nvr-health': { title: 'وضعیت سلامت NVRها', desc: 'نمایش اطلاعات سخت‌افزاری پردازنده، حافظه، دیسک‌ها و کارکرد NVRها' },
    'widget-nvr-health-summary': { title: 'خلاصه وضعیت سلامت NVRها', desc: 'نمایش گزارش خلاصه سلامت و هشدارهای سخت‌افزاری تجهیزات ضبط' },
    'widget-factory-summary': { title: 'خلاصه کارخانه‌ها', desc: 'نمایش آمار کلی کارخانجات' },
    'widget-off-recording': { title: 'دوربین‌های ضبط خاموش', desc: 'لیست دوربین‌هایی که ضبط آن‌ها غیرفعال است به همراه جزئیات' },
    'widget-camera-changes': { title: 'تغییرات اخیر دوربین‌ها', desc: 'نمایش لیست دوربین‌های حذف یا اضافه شده در ۲۴ ساعت و هفته/ماه اخیر' },
    'widget-offline-section': { title: 'دوربین‌های قطع شده', desc: 'لیست سریع دوربین‌های دارای قطعی' },
    'widget-all-ok': { title: 'سلامت شبکه', desc: 'نمایش وضعیت اتصالات در صورت عدم قطعی' },
    'widget-nvr-container': { title: 'گروه‌بندی کارخانه‌ها و NVRها', desc: 'نمایش کامل دوربین‌ها به تفکیک کارخانه و NVR با فیلتر' },
    'widget-important-cams': { title: 'دوربین‌های مهم', desc: 'نمایش دوربین‌های با سطح اهمیت «مهم»' },
    'widget-chart-status': { title: 'نمودار وضعیت فعلی', desc: 'نمودار دوناتی درصد اتصالات و قطعی‌های فعلی' },
    'widget-chart-causes': { title: 'نمودار علل قطعی', desc: 'نمودار میله‌ای تحلیل بیشترین علل قطعی تجهیزات' },
    'widget-ping-summary': { title: 'پایداری و پینگ شبکه', desc: 'نمایش درصد پایداری SLA و میانگین پینگ اتصالات' }
};

let isDashEditMode = false;
let draggedWidgetId = null;

function initDashboardCustomization() {
    loadDashboardLayout();
    initDragAndDropListeners();
}

function toggleDashEditMode(forceState) {
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
        enableDraggableWidgets(true);
        if (typeof showToast === 'function') showToast('حالت ویرایش داشبورد فعال شد. می‌توانید کارت‌ها را با درگ و دراپ جابجا کنید.');
    } else {
        dashSection.classList.remove('dash-edit-mode');
        if (btnEdit) btnEdit.classList.remove('active');
        if (fabEdit) fabEdit.classList.remove('active');
        if (editControls) editControls.classList.add('hidden');
        enableDraggableWidgets(false);
        saveDashboardLayout();
        if (typeof showToast === 'function') showToast('تغییرات داشبورد ذخیره گردید.');
    }
}

function enableDraggableWidgets(enable) {
    const widgets = document.querySelectorAll('.dash-widget');
    widgets.forEach(w => {
        w.setAttribute('draggable', enable ? 'true' : 'false');
    });
}

function removeWidget(widgetId) {
    const el = document.getElementById(widgetId);
    if (el) {
        el.classList.add('widget-hidden');
        saveDashboardLayout();
        if (isDashEditMode) {
            updateAddWidgetModalContent();
        }
        if (typeof showToast === 'function') showToast('ویجت از داشبورد حذف شد');
    }
}

function addWidget(widgetId) {
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
        saveDashboardLayout();
        updateAddWidgetModalContent();
        closeAddWidgetModal();
        if (widgetId === 'widget-important-cams') renderImportantCamerasWidget();
        if (widgetId === 'widget-off-recording') renderOffCamerasWidget();
        if (widgetId === 'widget-camera-changes') renderCameraChangesWidget();
        if (widgetId === 'widget-chart-status' || widgetId === 'widget-chart-causes') setTimeout(renderDashboardCharts, 150);
        if (typeof showToast === 'function') showToast('ویجت با موفقیت به داشبورد اضافه شد');
    }
}

function resetDashboardLayout() {
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
    saveDashboardLayout();
    if (typeof showToast === 'function') showToast('چینش داشبورد به حالت اولیه بازنشانی شد');
}

function saveDashboardLayout() {
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

function loadDashboardLayout() {
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

function initDragAndDropListeners() {
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
            saveDashboardLayout();
        }
    });
}

function openAddWidgetModal() {
    updateAddWidgetModalContent();
    const modal = document.getElementById('modal-add-widget');
    if (modal) {
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.add('open');
        });
    }
}

function closeAddWidgetModal() {
    const modal = document.getElementById('modal-add-widget');
    if (modal) {
        modal.classList.remove('open');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 200);
    }
}

function updateAddWidgetModalContent() {
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
                <button class="btn btn-primary btn-sm" onclick="addWidget('${id}')" style="padding: 6px 14px; font-size: 12px; cursor: pointer; flex-shrink: 0;">
                    + افزودن
                </button>
            </div>
        `;
    }).join('');
}

function toPersianNumbers(str) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(str).replace(/[0-9]/g, (w) => persianDigits[+w]);
}

function formatTimeAgo(dateStr) {
    if (!dateStr) return 'هرگز';
    const now = new Date();
    const lastRun = new Date(dateStr);
    const diffMs = now - lastRun;
    if (diffMs < 0) return 'هم‌اکنون';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'چند لحظه پیش';
    if (diffMins < 60) {
        return toPersianNumbers(`${diffMins} دقیقه پیش`);
    }
    const diffHours = Math.floor(diffMins / 60);
    const remMins = diffMins % 60;
    if (remMins === 0) {
        return toPersianNumbers(`${diffHours} ساعت پیش`);
    }
    return toPersianNumbers(`${diffHours} ساعت و ${remMins} دقیقه پیش`);
}

function formatHddInfo(hddJsonStr) {
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
                <span>💾 ${h.name || 'هارد'}: ${toPersianNumbers(capStr)} / ${toPersianNumbers(freeStr)} خالی</span>
                <span class="${statusClass}" style="font-weight: bold;">(${statusLabel})</span>
            </div>`;
        }).join('');
    } catch (e) {
        return '💿 خطا در خواندن اطلاعات هارد';
    }
}

function renderNvrHealthWidget() {
    const listEl = document.getElementById('nvr-health-list');
    if (!listEl) return;

    const updateTimeEl = document.getElementById('nvr-health-update-time');
    if (updateTimeEl) {
        const task = scheduledTasksCache.find(t => t.id === 'sync_nvr_health');
        updateTimeEl.textContent = task && task.last_run ? `بروزرسانی: ${formatTimeAgo(task.last_run)}` : 'بروزرسانی: در حال انتظار...';
    }

    const activeNvrs = nvrCache.filter(n => n.enabled !== false);
    if (activeNvrs.length === 0) {
        listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px 0;">دستگاه NVR فعال یافت نشد.</div>';
        return;
    }

    const html = activeNvrs.map(n => {
        let statusBadge = '';
        if (n.status === 'Online') {
            statusBadge = '<span class="badge badge-success" style="font-size: 11px; padding: 2px 6px;">متصل</span>';
        } else if (n.status === 'AuthError') {
            statusBadge = '<span class="badge badge-danger" style="font-size: 11px; padding: 2px 6px;">خطای احراز هویت</span>';
        } else {
            statusBadge = '<span class="badge badge-danger" style="font-size: 11px; padding: 2px 6px;">قطع ارتباط</span>';
        }

        const cpuVal = n.cpu_usage !== null && n.cpu_usage !== undefined ? `${n.cpu_usage}%` : 'نامشخص';
        const ramVal = n.memory_usage !== null && n.memory_usage !== undefined ? `${n.memory_usage}%` : 'نامشخص';

        let uptimeVal = 'نامشخص';
        if (n.uptime) {
            let days = Math.floor(n.uptime / 86400);
            let hours = Math.floor((n.uptime % 86400) / 3600);
            if (days > 0) {
                uptimeVal = `${days} روز و ${hours} ساعت`;
            } else {
                uptimeVal = `${hours} ساعت`;
            }
        }

        const hddHtml = formatHddInfo(n.hdd_status);

        return `
            <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-2);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="font-size: 13px; color: var(--text-primary);">${n.name || 'NVR بدون نام'}</strong>
                        <span class="mono" style="font-size: 11px; color: var(--text-secondary);">${n.ip}</span>
                    </div>
                    <div>${statusBadge}</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; font-size: 11px; color: var(--text-secondary); border-top: 1px dashed var(--border); padding-top: 8px;">
                    <div>⚙️ پردازنده: <strong style="color: var(--text);">${toPersianNumbers(cpuVal)}</strong></div>
                    <div>🧠 حافظه: <strong style="color: var(--text);">${toPersianNumbers(ramVal)}</strong></div>
                    <div>⏱️ کارکرد: <strong style="color: var(--text);">${toPersianNumbers(uptimeVal)}</strong></div>
                </div>
                <div style="font-size: 11px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
                    ${hddHtml}
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = html;
}

function renderNvrHealthSummaryWidget() {
    const contentEl = document.getElementById('nvr-health-summary-content');
    if (!contentEl) return;

    const updateTimeEl = document.getElementById('nvr-health-summary-update-time');
    if (updateTimeEl) {
        const task = scheduledTasksCache.find(t => t.id === 'sync_nvr_health');
        updateTimeEl.textContent = task && task.last_run ? `بروزرسانی: ${formatTimeAgo(task.last_run)}` : 'بروزرسانی: در حال انتظار...';
    }

    const activeNvrs = nvrCache.filter(n => n.enabled !== false);
    if (activeNvrs.length === 0) {
        contentEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px 0;">دستگاه NVR فعال یافت نشد.</div>';
        return;
    }

    const total = activeNvrs.length;
    const online = activeNvrs.filter(n => n.status === 'Online').length;
    const offline = activeNvrs.filter(n => n.status !== 'Online' && n.status !== 'AuthError').length;
    const authError = activeNvrs.filter(n => n.status === 'AuthError').length;

    let totalHdds = 0;
    let failedHdds = 0;
    activeNvrs.forEach(n => {
        if (n.hdd_status) {
            try {
                const hdds = JSON.parse(n.hdd_status);
                if (Array.isArray(hdds)) {
                    totalHdds += hdds.length;
                    failedHdds += hdds.filter(h => h.status !== 'OK').length;
                }
            } catch (e) {}
        }
    });

    const highCpu = activeNvrs.filter(n => n.cpu_usage !== null && n.cpu_usage > 80).length;
    const highRam = activeNvrs.filter(n => n.memory_usage !== null && n.memory_usage > 90).length;

    let hddStatusText = '<span class="text-success" style="font-weight: bold;">تمامی هاردها سالم هستند</span>';
    if (totalHdds === 0) {
        hddStatusText = '<span class="text-muted">اطلاعات هارد در دسترس نیست</span>';
    } else if (failedHdds > 0) {
        hddStatusText = `<span class="text-danger" style="font-weight: bold;">⚠️ ${toPersianNumbers(failedHdds)} خطا در هاردها</span>`;
    }

    let resourceAlertText = '<span class="text-success">نرمال</span>';
    if (highCpu > 0 || highRam > 0) {
        resourceAlertText = '<span class="text-danger" style="font-weight: bold;">⚠️ بار مصرفی بالا</span>';
    }

    contentEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="stat-row">
                <span class="stat-label">تعداد کل NVRهای فعال</span>
                <span class="stat-value" style="font-weight: bold;">${toPersianNumbers(total)}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">دستگاه‌های متصل</span>
                <span class="stat-value text-success" style="font-weight: bold;">${toPersianNumbers(online)}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">دستگاه‌های قطع شده</span>
                <span class="stat-value ${offline > 0 ? 'text-danger' : 'text-muted'}" style="font-weight: bold;">${toPersianNumbers(offline)}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">خطای احراز هویت</span>
                <span class="stat-value ${authError > 0 ? 'text-danger' : 'text-muted'}" style="font-weight: bold;">${toPersianNumbers(authError)}</span>
            </div>
            <div class="stat-row" style="border-top: 1px dashed var(--border); padding-top: 8px; margin-top: 4px;">
                <span class="stat-label">سلامت ذخیره‌سازی (HDD)</span>
                <span class="stat-value" style="font-size: 11px;">${hddStatusText}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">مصرف منابع سخت‌افزاری</span>
                <span class="stat-value" style="font-size: 11px;">${resourceAlertText}</span>
            </div>
        </div>
    `;
}

function renderImportantCamerasWidget() {
    const grid = document.getElementById('important-cams-grid');
    const countBadge = document.getElementById('important-cams-count');
    if (!grid) return;

    if (!dashCamerasCache || dashCamerasCache.length === 0) {
        grid.innerHTML = '<div style="font-size: 13px; color: var(--text-muted); padding: 12px 0; text-align: center; width: 100%; grid-column: 1 / -1;">در حال بارگذاری...</div>';
        return;
    }

    const importantCams = dashCamerasCache.filter(c => c.importance === 'مهم' || c.importance === 'high' || c.importance === 3);
    if (countBadge) countBadge.textContent = importantCams.length;

    if (importantCams.length === 0) {
        grid.innerHTML = '<div style="font-size: 13px; color: var(--text-muted); padding: 12px 0; text-align: center; width: 100%; grid-column: 1 / -1;">هیچ دوربینی با درجه اهمیت «مهم» تعریف نشده است.</div>';
        return;
    }

    grid.innerHTML = importantCams.map(c => createCard(c)).join('');
}

async function renderOffCamerasWidget() {
    const listEl = document.getElementById('off-recording-list');
    if (!listEl) return;
    
    try {
        const res = await apiFetch(`${API}/cameras/off`);
        const data = await res.json();
        
        if (data.length === 0) {
            listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 16px 0;">هیچ دوربین ضبط خاموشی وجود ندارد.</div>';
            return;
        }
        
        listEl.innerHTML = data.map(item => `
            <div class="widget-list-item">
                <div class="item-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
                <div class="item-meta">
                    <span style="font-weight: 500;">${escapeHTML(item.factory)}</span>
                    <span style="color: var(--danger); font-size: 11px;">(خاموش از ${escapeHTML(item.hours_off_str)})</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Error rendering off cameras widget:', e);
        listEl.innerHTML = '<div style="font-size: 12px; color: var(--danger); text-align: center; padding: 16px 0;">خطا در بارگذاری اطلاعات</div>';
    }
}

let changesFilterPeriod = '24h';
let changesFilterAction = 'all';
let changesCache = null;
let offRecordingCache = null;

function setChangesFilter(type, value) {
    if (value === 'off_recording') {
        changesFilterAction = 'off_recording';
        document.querySelectorAll('[data-cf-period]').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('[data-cf-action]').forEach(b => b.classList.toggle('active', b.dataset.cfAction === 'off_recording'));
        renderFilteredCameraChanges();
        return;
    }

    if (type === 'period') {
        changesFilterPeriod = value;
        document.querySelectorAll('[data-cf-period]').forEach(b => b.classList.toggle('active', b.dataset.cfPeriod === value));
    } else {
        changesFilterAction = value;
        document.querySelectorAll('[data-cf-action]').forEach(b => b.classList.toggle('active', b.dataset.cfAction === value));
    }
    renderFilteredCameraChanges();
}

function renderFilteredCameraChanges() {
    const listEl = document.getElementById('changes-list');
    if (!listEl) return;

    if (changesFilterAction === 'off_recording') {
        if (!offRecordingCache) {
            listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 16px 0;">در حال بارگذاری...</div>';
            return;
        }
        if (offRecordingCache.length === 0) {
            listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 16px 0;">هیچ دوربین ضبط خاموشی وجود ندارد.</div>';
            return;
        }
        listEl.innerHTML = offRecordingCache.map(item => `
            <div class="widget-list-item" style="padding: 5px 8px;">
                <div class="item-title" title="${escapeHTML(item.name)}" style="font-size: 12px; max-width: 130px;">${escapeHTML(item.name)}</div>
                <div class="item-meta" style="font-size: 11px;">
                    <span>${escapeHTML(item.factory)}</span>
                    <span style="color: var(--danger); font-size: 10px;">خاموش از ${escapeHTML(item.hours_off_str)}</span>
                </div>
            </div>
        `).join('');
        return;
    }

    if (!changesCache) return;

    let items = [];
    if (changesFilterPeriod === '24h') items = changesCache.changes_24h || [];
    else if (changesFilterPeriod === '7d') items = changesCache.changes_week || [];
    else items = changesCache.changes_month || [];

    if (changesFilterAction === 'added') items = items.filter(i => i.action === 'اضافه شده');
    else if (changesFilterAction === 'removed') items = items.filter(i => i.action === 'حذف شده');

    if (items.length === 0) {
        listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 16px 0;">بدون تغییر</div>';
        return;
    }

    listEl.innerHTML = items.map(item => {
        const actionClass = item.action === 'اضافه شده' ? 'added' : 'removed';
        const timeHtml = item.time_ago ? `<span style="color: var(--text-muted); font-size: 9px;">${escapeHTML(item.time_ago)}</span>` : '';
        return `
            <div class="widget-list-item" style="padding: 5px 8px;">
                <div class="item-title" title="${escapeHTML(item.name)}" style="font-size: 12px; max-width: 130px;">${escapeHTML(item.name)}</div>
                <div class="item-meta" style="font-size: 11px;">
                    <span>${escapeHTML(item.factory)}</span>
                    <span class="badge-action ${actionClass}">${escapeHTML(item.action)}</span>
                    ${timeHtml}
                </div>
            </div>
        `;
    }).join('');
}

async function prefetchOffRecording() {
    try {
        const res = await apiFetch(`${API}/cameras/off`);
        offRecordingCache = await res.json();
        if (changesFilterAction === 'off_recording') renderFilteredCameraChanges();
    } catch (e) {
        console.error('Error prefetching off recording:', e);
    }
}

async function renderCameraChangesWidget() {
    const listEl = document.getElementById('changes-list');
    if (!listEl) return;
    
    try {
        const [changesRes] = await Promise.all([
            apiFetch(`${API}/cameras/changes`),
            prefetchOffRecording()
        ]);
        changesCache = await changesRes.json();
        renderFilteredCameraChanges();
    } catch (e) {
        console.error('Error rendering camera changes widget:', e);
        listEl.innerHTML = '<div style="font-size: 12px; color: var(--danger); text-align: center; padding: 16px 0;">خطا در بارگذاری اطلاعات</div>';
    }
}

let dashChartStatusInstance = null;
let dashChartCausesInstance = null;
let lastCausesFetchTime = 0;

function renderDashboardCharts() {
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
        apiFetch(`${API}/reports/causes?period=30d`).then(async res => {
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

// ===== EDIT GROUP AND USER MODALS =====

function openEditGroupModal(id) {
    const group = groupCache.find(g => g.id === id);
    if (!group) return showToast('کارخانه پیدا نشد', 'error');
    
    document.getElementById('editGroupId').value = group.id;
    document.getElementById('editGroupName').value = group.name;
    document.getElementById('editGroupDesc').value = group.description || '';
    
    document.getElementById('editGroupModal').classList.add('open');
}

function closeEditGroupModal() {
    document.getElementById('editGroupModal').classList.remove('open');
}

async function saveGroupEdit() {
    const id = document.getElementById('editGroupId').value;
    const name = document.getElementById('editGroupName').value.trim();
    const description = document.getElementById('editGroupDesc').value.trim();
    
    if (!name) return showToast('نام کارخانه الزامی است', 'error');
    
    try {
        await apiFetch(`${API}/groups/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        showToast('کارخانه با موفقیت ویرایش شد');
        closeEditGroupModal();
        
        // Refresh groups cache and reload settings
        const gRes = await apiFetch(`${API}/groups`);
        groupCache = await gRes.json();
        renderGroupsList();
        loadSettings('sec-groups'); // keeps the groups tab active
    } catch (e) {
        showToast('خطا در ویرایش کارخانه: ' + e.message, 'error');
    }
}

function populateEditInspectorGroupsList() {
    const listCon = document.getElementById('edit-inspector-groups-list');
    if (!listCon) return;
    if (!groupCache || groupCache.length === 0) {
        listCon.innerHTML = '<span style="font-size: 12px; color: var(--text-muted); grid-column: 1 / -1;">کارخانه‌ای تعریف نشده است</span>';
        return;
    }
    listCon.innerHTML = groupCache.map(g => `
        <label style="font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; background: var(--surface); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);">
            <input type="checkbox" class="edit-inspector-group-cb" value="${g.id}" onchange="updateEditInspectorSelectAllState()">
            <span style="user-select: none;">${g.name}</span>
        </label>
    `).join('');
    updateEditInspectorSelectAllState();
}

function toggleAllEditInspectorGroups(checked) {
    const checkboxes = document.querySelectorAll('.edit-inspector-group-cb');
    checkboxes.forEach(cb => cb.checked = checked);
}

function updateEditInspectorSelectAllState() {
    const checkboxes = document.querySelectorAll('.edit-inspector-group-cb');
    const selectAllCb = document.getElementById('edit-inspector-select-all');
    if (!selectAllCb || checkboxes.length === 0) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    selectAllCb.checked = allChecked;
}

function openEditUserModal(id) {
    const user = usersCache.find(u => u.id === id);
    if (!user) return showToast('کاربر پیدا نشد', 'error');

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
    populateEditInspectorGroupsList();
    if (user.accessible_group_ids) {
        const allowedIds = user.accessible_group_ids.split(',').map(id => id.trim());
        const checkboxes = document.querySelectorAll('.edit-inspector-group-cb');
        checkboxes.forEach(cb => {
            cb.checked = allowedIds.includes(cb.value);
        });
        updateEditInspectorSelectAllState();
    } else {
        toggleAllEditInspectorGroups(true);
        updateEditInspectorSelectAllState();
    }

    onEditUserRoleChange();

    document.getElementById('editUserModal').classList.add('open');
}

function closeEditUserModal() {
    document.getElementById('editUserModal').classList.remove('open');
}

function onEditUserRoleChange() {
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

async function saveUserEdit() {
    const id = document.getElementById('editUserId').value;
    const password = document.getElementById('editUserPass').value;
    const role = document.getElementById('editUserRole').value;
    const grpVal = document.getElementById('editUserGroup').value;
    const isActive = document.getElementById('editUserActive').checked;
    
    let accessible_group_ids = null;
    let group_id = null;
    if (role === 'inspector' || role === 'it_manager') {
        const checkedCbs = Array.from(document.querySelectorAll('.edit-inspector-group-cb:checked')).map(cb => cb.value);
        const allCbs = document.querySelectorAll('.edit-inspector-group-cb');
        if (checkedCbs.length > 0 && checkedCbs.length < allCbs.length) {
            accessible_group_ids = checkedCbs.join(',');
            group_id = parseInt(checkedCbs[0]);
        } else if (checkedCbs.length === allCbs.length) {
            accessible_group_ids = null;
            group_id = checkedCbs[0] ? parseInt(checkedCbs[0]) : null;
        } else if (checkedCbs.length === 0) {
            accessible_group_ids = '0';
            group_id = null;
        }
    } else if (role !== 'admin' && grpVal) {
        group_id = parseInt(grpVal);
    }

    const payload = {
        role,
        group_id,
        accessible_group_ids,
        is_active: isActive
    };
    if (password) {
        payload.password = password;
    }

    try {
        await apiFetch(`${API}/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast('کاربر با موفقیت ویرایش شد');
        closeEditUserModal();
        loadUsers();
    } catch (e) {
        showToast('خطا در ویرایش کاربر: ' + e.message, 'error');
    }
}
