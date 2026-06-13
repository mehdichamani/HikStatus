const API = '/api';
let logOff=0, logFilter='', logSearchVal='', loading=false, allLoaded=false;
let currentCamId, currentImp, settingsCache=[];

async function apiFetch(url, options={}) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            const err = await res.json().catch(() => ({detail: res.statusText}));
            throw new Error(err.detail || 'Request failed');
        }
        return res;
    } catch(e) {
        console.error('API Error:', e);
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
    setInterval(fetchDash, 5000);
});
