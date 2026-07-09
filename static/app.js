const API = '/api';
let logOff=0, logFilter='', logSearchVal='', loading=false, allLoaded=false;
let currentCamId, currentImp, settingsCache=[];
let ws = null, wsRetryDelay = 1000;

async function apiFetch(url, options={}) {
    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            window.location.href = '/login';
            throw new Error('Unauthorized');
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({detail: res.statusText}));
            throw new Error(err.detail || 'Request failed');
        }
        return res;
    } catch(e) {
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

    if(id==='summ') fetchDash();
    if(id==='dash') fetchDash();
    if(id==='map') initOrRefreshMap();
    if(id==='reports') {
        if (!document.getElementById('startDt').value) {
            setPreset(24);
        }
        genReport();
        fetchAndRenderHeatmap();
    }
    if(id==='logs' && logOff===0) fetchLogs();
    if(id==='settings') loadSettings();
}

function closeModal() {
    document.getElementById('camModal').classList.remove('open');
}

// --- DASHBOARD & SUMMARY ---
function getNvrNum(ip) { return ip.split('.').pop(); }

async function fetchDash() {
    const res = await apiFetch(`${API}/cameras`);
    const cams = await res.json();
    const on = cams.filter(c=>c.status==='Online').length;
    const off = cams.filter(c=>c.status!=='Online');

    document.getElementById('s-tot').textContent = cams.length;
    document.getElementById('s-on').textContent = on;
    document.getElementById('s-off').textContent = off.length;

    const totEl = document.getElementById('tot');
    const onEl = document.getElementById('on');
    const offEl = document.getElementById('off');
    if(totEl) totEl.textContent = cams.length;
    if(onEl) onEl.textContent = on;
    if(offEl) offEl.textContent = off.length;

    if(off.length > 0) {
        document.getElementById('offline-section').classList.remove('hidden');
        document.getElementById('all-ok').classList.add('hidden');
        document.getElementById('offline-count').textContent = off.length;
        document.getElementById('offline-grid').innerHTML = off.map(c => createCard(c)).join('');
    } else {
        document.getElementById('offline-section').classList.add('hidden');
        document.getElementById('all-ok').classList.remove('hidden');
    }

    const groups={};
    cams.forEach(c=>{ if(!groups[c.nvr_ip])groups[c.nvr_ip]=[]; groups[c.nvr_ip].push(c) });

    const con = document.getElementById('nvr-container');
    con.innerHTML = '';

    Object.keys(groups).sort((a,b)=>parseInt(getNvrNum(a))-parseInt(getNvrNum(b))).forEach(ip=>{
        const list = groups[ip];
        const sorted = list.sort((a,b)=>parseInt(a.channel_id)-parseInt(b.channel_id));
        const cards = sorted.map(c => createCard(c)).join('');
        con.innerHTML += `
            <div class="nvr-block open">
                <div class="nvr-header" onclick="toggleNvr(this)">
                    <div class="nvr-header-left">
                        <span class="nvr-badge">NVR ${getNvrNum(ip)}</span>
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
    const stClass = c.status==='Online'?'status-online':'status-offline';
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
    document.getElementById('m-imp').textContent = ['کم', 'عادی', 'مهم'][c.importance-1];
    document.getElementById('camModal').classList.add('open');

    const res = await apiFetch(`${API}/stats/${c.id}`);
    const s = await res.json();
    document.getElementById('m-d1').textContent = s.down_1h + ' دقیقه';
    document.getElementById('m-d24').textContent = s.down_24h + ' دقیقه';
}

async function cycleImpModal() {
    let n = currentImp + 1;
    if(n > 3) n = 1;
    await apiFetch(`${API}/cameras/${currentCamId}`, {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({importance:n})
    });
    currentImp = n;
    document.getElementById('m-imp').textContent = ['کم', 'عادی', 'مهم'][n-1];
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

    const cRes = await apiFetch(`${API}/config/csv`);
    document.getElementById('csvEditor').value = await cRes.text();

    const nav = document.getElementById('config-nav');
    nav.innerHTML = `<button onclick="scrollToId('sec-nvr')">NVRها</button>`;

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

    for(const [grp, keys] of Object.entries(groups)) {
        const engKey = groupKeys[grp];
        nav.innerHTML += `<button onclick="scrollToId('grp-${engKey}')">${grp}</button>`;

        let html = `<div class="card" id="grp-${engKey}">
            <div class="card-header">
                <h3>${grp}</h3>
                <button class="btn btn-ghost" style="padding:4px 12px; font-size:11px" onclick="testConn('${engKey.toLowerCase()}')">تست</button>
            </div>
            <div style="padding:12px 16px">`;

        keys.forEach(k => {
            const item = settingsCache.find(s=>s.key===k);
            if(!item) return;
            const label = settingLabels[k] || k;

            if(k.endsWith('ENABLED')) {
                html += `<div class="toggle-row">
                    <span class="toggle-label">${label}</span>
                    <label class="toggle">
                        <input type="checkbox" id="${k}" ${item.value==='true'?'checked':''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>`;
            } else {
                html += `<div style="margin-bottom:12px">
                    <label class="form-label">${label}</label>
                    <input class="form-input" id="${k}" value="${item.value||''}" type="${k.includes('PASS')||k.includes('TOKEN')?'password':'text'}">
                </div>`;
            }
        });

        con.innerHTML += html + '</div></div>';
    }

    const nRes = await apiFetch(`${API}/nvrs`);
    const nvrs = await nRes.json();
    document.getElementById('nvr-list').innerHTML = nvrs.map(n => `
        <div class="list-item">
            <div class="list-item-info">
                <span class="list-item-ip">${n.ip}</span>
                <span class="list-item-user">(${n.user})</span>
            </div>
            <button class="btn-icon" onclick="delNVR('${n.ip}')" style="width:28px; height:28px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>
    `).join('');
}

function scrollToId(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveAll() {
    for(const s of settingsCache) {
        const el = document.getElementById(s.key);
        if(el) {
            let val = el.value;
            if(el.type==='checkbox') val = el.checked ? 'true' : 'false';
            if(val !== s.value) {
                await apiFetch(`${API}/settings/${s.key}`, {
                    method:'PUT',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({key:s.key, value:val})
                });
            }
        }
    }
    await apiFetch(`${API}/config/csv`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({content:document.getElementById('csvEditor').value})
    });
    showToast('ذخیره شد');
}

async function apply() {
    await saveAll();
    await apiFetch(`${API}/monitor/restart`, {method:'POST'});
    showToast('ریستارت شد');
    setTimeout(() => location.reload(), 500);
}

async function testConn(type) {
    try {
        await apiFetch(`/api/test/${type}`, {method:'POST'});
        showToast('تست موفق');
    } catch(e) {
        showToast('تست ناموفق: ' + e.message, 'error');
    }
}

async function addNVR() {
    const ip = document.getElementById('nvrIp').value.trim();
    const u = document.getElementById('nvrUser').value.trim();
    const p = document.getElementById('nvrPass').value;
    if(!ip || !u) return showToast('IP و نام کاربری الزامی است', 'error');

    await apiFetch(`${API}/nvrs`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ip, user:u, password:p||null, enabled:true})
    });
    document.getElementById('nvrIp').value = '';
    document.getElementById('nvrUser').value = '';
    document.getElementById('nvrPass').value = '';
    loadSettings();
}

async function delNVR(ip) {
    if(!confirm('حذف شود؟')) return;
    await apiFetch(`${API}/nvrs/${ip}`, {method:'DELETE'});
    loadSettings();
}

async function purgeData() {
    if(!confirm('تمامی لاگ‌ها و وضعیت دوربین‌ها ریست می‌شود. ادامه می‌دهید؟')) return;
    try {
        await apiFetch(`${API}/data/purge`, {method: 'POST'});
        showToast('ریست انجام شد');
        location.reload();
    } catch(e) {
        showToast('خطا: ' + e.message, 'error');
    }
}

function showToast(msg, type='success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        background: ${type==='error' ? 'var(--danger)' : 'var(--surface-2)'};
        color: ${type==='error' ? 'white' : 'var(--text)'};
        padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4); z-index: 9999;
        border: 1px solid ${type==='error' ? 'var(--danger)' : 'var(--border)'};
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
    logTimer = setTimeout(()=> {
        logSearchVal = document.getElementById('logSearch').value;
        resetLogs();
    }, 500);
}

function setFilter(btn, val) {
    document.querySelectorAll('.filter-chips .chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    logFilter = val;
    resetLogs();
}

function resetLogs() {
    document.getElementById('log-list').innerHTML='';
    logOff=0;
    allLoaded=false;
    fetchLogs();
}

async function fetchLogs() {
    if(loading || allLoaded) return;
    loading=true;
    document.getElementById('logLoader').classList.remove('hidden');

    const res = await apiFetch(`${API}/logs?q=${logFilter||logSearchVal}&limit=30&offset=${logOff}`);
    const logs = await res.json();

    if(logs.length < 30) allLoaded=true;

    document.getElementById('log-list').insertAdjacentHTML('beforeend', logs.map(l=>{
        let detail = l.details;
        if(detail.includes('mins')) detail = `<span class="downtime-tag">${detail.match(/\d+m/)}</span> ` + detail;
        const cls = ['Error','Failed','Offline'].includes(l.state) ? 'status-danger' : 'status-success';
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
document.addEventListener('DOMContentLoaded', ()=>{
    document.getElementById('logScroll').addEventListener('scroll', (e)=>{
        if(e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 100) fetchLogs();
    });
});

// --- REPORTS ---
function setPreset(h) {
    const end = new Date();
    const start = new Date(end.getTime() - (h * 60 * 60 * 1000));
    start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
    end.setMinutes(end.getMinutes() - end.getTimezoneOffset());
    document.getElementById('startDt').value = start.toISOString().slice(0,16);
    document.getElementById('endDt').value = end.toISOString().slice(0,16);
}

async function genReport() {
    const s = new Date(document.getElementById('startDt').value).getTime() / 1000;
    const e = new Date(document.getElementById('endDt').value).getTime() / 1000;
    if(!s || !e) return showToast('محدوده زمانی را انتخاب کنید', 'error');

    document.getElementById('rep-list').innerHTML = '<div class="loader"><div class="spinner"></div><span>درحال تحلیل...</span></div>';

    const res = await apiFetch(`${API}/reports/generate?start=${s}&end=${e}`);
    const data = await res.json();

    if(data.length === 0) {
        document.getElementById('rep-list').innerHTML = '<div class="empty-state">قطعی‌ای یافت نشد</div>';
        return;
    }

    const max = Math.max(...data.map(i=>i.mins));
    document.getElementById('rep-list').innerHTML = data.map(i=>{
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
    const on = cams.filter(c=>c.status==='Online').length;
    const off = cams.filter(c=>c.status!=='Online');

    document.getElementById('s-tot').textContent = cams.length;
    document.getElementById('s-on').textContent = on;
    document.getElementById('s-off').textContent = off.length;

    const totEl = document.getElementById('tot');
    const onEl = document.getElementById('on');
    const offEl = document.getElementById('off');
    if(totEl) totEl.textContent = cams.length;
    if(onEl) onEl.textContent = on;
    if(offEl) offEl.textContent = off.length;

    if(off.length > 0) {
        document.getElementById('offline-section').classList.remove('hidden');
        document.getElementById('all-ok').classList.add('hidden');
        document.getElementById('offline-count').textContent = off.length;
        document.getElementById('offline-grid').innerHTML = off.map(c => createCard(c)).join('');
    } else {
        document.getElementById('offline-section').classList.add('hidden');
        document.getElementById('all-ok').classList.remove('hidden');
    }

    const groups={};
    cams.forEach(c=>{ if(!groups[c.nvr_ip])groups[c.nvr_ip]=[]; groups[c.nvr_ip].push(c) });

    const con = document.getElementById('nvr-container');
    if(!con) return;
    con.innerHTML = '';

    Object.keys(groups).sort((a,b)=>parseInt(getNvrNum(a))-parseInt(getNvrNum(b))).forEach(ip=>{
        const list = groups[ip];
        const sorted = list.sort((a,b)=>parseInt(a.channel_id)-parseInt(b.channel_id));
        const cards = sorted.map(c => createCard(c)).join('');
        con.innerHTML += `
            <div class="nvr-block open">
                <div class="nvr-header" onclick="toggleNvr(this)">
                    <div class="nvr-header-left">
                        <span class="nvr-badge">NVR ${getNvrNum(ip)}</span>
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
    } catch(e) {}
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
        } catch(e) {
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
    } catch(e) {
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
    
    if (mapType === 'floor') {
        map = L.map('map-canvas', {
            crs: L.CRS.Simple,
            minZoom: -2,
            maxZoom: 2,
            attributionControl: false
        });
        
        const img = new Image();
        img.onload = function() {
            const w = this.width;
            const h = this.height;
            window.mapImgWidth = w;
            window.mapImgHeight = h;
            const bounds = [[0, 0], [h, w]];
            L.imageOverlay(mapImage || '/static/logo.png', bounds).addTo(map);
            
            if (restoredCenter !== null && restoredZoom !== null) {
                map.setView(restoredCenter, restoredZoom);
            } else {
                map.fitBounds(bounds);
            }
            
            drawCameraMarkers(bounds, w, h);
        };
        img.onerror = function() {
            const bounds = [[0, 0], [600, 800]];
            window.mapImgWidth = 800;
            window.mapImgHeight = 600;
            L.imageOverlay('/static/logo.png', bounds).addTo(map);
            
            if (restoredCenter !== null && restoredZoom !== null) {
                map.setView(restoredCenter, restoredZoom);
            } else {
                map.fitBounds(bounds);
            }
            
            drawCameraMarkers(bounds, 800, 600);
        };
        img.src = mapImage || '/static/logo.png';
        
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
    
    const marker = L.marker(latlng, {
        icon: icon,
        draggable: mapEditMode
    }).addTo(map);
    marker.camera_id = c.id;
    
    const statusText = c.status === 'Online' ? 'متصل' : 'قطع';
    const popupContent = `
        <div style="direction: rtl; text-align: right">
            <strong style="font-size: 14px; display:block; margin-bottom: 4px;">${c.name}</strong>
            <p style="margin: 2px 0"><b>NVR:</b> ${c.nvr_ip}</p>
            <p style="margin: 2px 0"><b>کانال:</b> ${c.channel_id}</p>
            <p style="margin: 2px 0"><b>IP:</b> ${c.ip}</p>
            <p style="margin: 4px 0 0"><b>وضعیت:</b> <span style="color: ${c.status === 'Online' ? 'var(--success)' : 'var(--danger)'}; font-weight: bold">${statusText}</span></p>
        </div>
    `;
    marker.bindPopup(popupContent);
    
    marker.on('dragend', async function(e) {
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
    mapMarkers.forEach(m => map.removeLayer(m));
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
            const err = await res.json().catch(() => ({detail: res.statusText}));
            throw new Error(err.detail || 'Upload failed');
        }
        
        const data = await res.json();
        showToast('تصویر پلان با موفقیت آپلود شد');
        
        const s = settingsCache.find(sett => sett.key === 'MAP_IMAGE');
        if (s) s.value = data.url;
        
        mapImage = data.url;
        initOrRefreshMap();
    } catch(e) {
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
                
                const timeRange = `${h.toString().padStart(2, '0')}:00 تا ${(h+1).toString().padStart(2, '0')}:00`;
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
        
    } catch(e) {
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
                <div class="map-cam-item unpositioned" style="cursor: default;">
                    <div class="map-cam-name-wrap" style="opacity: 0.6;">
                        <span class="map-cam-dot unknown"></span>
                        <span class="map-cam-name" title="${c.name}">${c.name}</span>
                    </div>
                    <button class="btn-add-map" onclick="addCameraToCenter(${c.id}); event.stopPropagation();" title="افزودن به مرکز نقشه" style="
                        background: var(--primary-glow);
                        border: 1px solid var(--primary);
                        color: var(--primary-hover);
                        border-radius: 4px;
                        width: 22px;
                        height: 22px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: bold;
                        padding: 0;
                        transition: var(--transition);
                    ">+</button>
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

async function addCameraToCenter(id) {
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
    } catch(e) {
        showToast('خطا در ذخیره موقعیت: ' + e.message, 'error');
    }
}
