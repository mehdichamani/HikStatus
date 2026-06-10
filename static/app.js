const API = '/api';
let logOff=0, logFilter='', logSearchVal='', loading=false, allLoaded=false;
let currentCamId, currentImp, settingsCache=[];

function nav(id) {
    document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(e => e.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if(document.getElementById('btn-'+id)) document.getElementById('btn-'+id).classList.add('active');
    if(id==='summ') fetchDash();
    if(id==='dash') fetchDash();
    if(id==='logs' && logOff===0) fetchLogs();
    if(id==='settings') loadSettings();
}

// --- DASHBOARD & SUMMARY ---
function getNvrNum(ip) { return ip.split('.').pop(); }
async function fetchDash() {
    const res = await fetch(`${API}/cameras`); const cams = await res.json();
    const on = cams.filter(c=>c.status==='Online').length;
    const off = cams.filter(c=>c.status!=='Online');
    
    document.getElementById('s-tot').textContent = cams.length;
    document.getElementById('s-on').textContent = on;
    document.getElementById('s-off').textContent = off.length;
    document.getElementById('tot').textContent = cams.length;
    document.getElementById('on').textContent = on;
    document.getElementById('off').textContent = off.length;

    if(off.length > 0) {
        document.getElementById('offline-section').style.display='block';
        document.getElementById('all-ok').style.display='none';
        document.getElementById('offline-grid').innerHTML = off.map(c => createCard(c)).join('');
    } else {
        document.getElementById('offline-section').style.display='none';
        document.getElementById('all-ok').style.display='block';
    }

    const groups={}; cams.forEach(c=>{ if(!groups[c.nvr_ip])groups[c.nvr_ip]=[]; groups[c.nvr_ip].push(c) });
    const con = document.getElementById('nvr-container'); con.innerHTML = '';
    Object.keys(groups).sort((a,b)=>parseInt(getNvrNum(a))-parseInt(getNvrNum(b))).forEach(ip=>{
        const list = groups[ip];
        let cards = list.sort((a,b)=>parseInt(a.channel_id)-parseInt(b.channel_id)).map(c => createCard(c)).join('');
        con.innerHTML += `<div class="nvr-block"><div class="nvr-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display=='none'?'grid':'none'"><span style="font-weight:700; font-size:13px">NVR ${getNvrNum(ip)}</span><span style="opacity:0.5; font-size:12px; font-family:monospace">${ip}</span></div><div class="nvr-grid">${cards}</div></div>`;
    });
}
function createCard(c) {
    const stClass = c.status==='Online'?'status-online':'status-offline';
    const meta = encodeURIComponent(JSON.stringify(c));
    const star = c.importance === 3 ? '<span class="imp-star">★</span>' : '';
    return `<div class="cam-card" onclick="showCam('${meta}')"><div class="cam-inner"><div class="face front imp-${c.importance} ${stClass}">${star}<div class="cam-name">${c.name}</div></div><div class="face back"><div>${c.ip}</div><div>CH ${c.channel_id}</div></div></div></div>`;
}
async function showCam(data) {
    const c = JSON.parse(decodeURIComponent(data));
    currentCamId = c.id; currentImp = c.importance;
    document.getElementById('m-name').textContent = c.name;
    document.getElementById('m-nvr').textContent = c.nvr_ip;
    document.getElementById('m-det').textContent = `${c.ip} (CH ${c.channel_id})`;
    document.getElementById('m-imp').textContent = ['Low','Normal','Critical'][c.importance-1];
    document.getElementById('camModal').classList.add('open');
    const res = await fetch(`${API}/stats/${c.id}`); const s = await res.json();
    document.getElementById('m-d1').textContent = s.down_1h+'m';
    document.getElementById('m-d24').textContent = s.down_24h+'m';
}
async function cycleImpModal() { let n = currentImp + 1; if(n>3)n=1; await fetch(`${API}/cameras/${currentCamId}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({importance:n})}); currentImp=n; document.getElementById('m-imp').textContent = ['Low','Normal','Critical'][n-1]; fetchDash(); }

// --- SETTINGS ---
async function loadSettings() {
    const sRes = await fetch(`${API}/settings`); settingsCache = await sRes.json();
    const cRes = await fetch(`${API}/config/csv`); document.getElementById('csvEditor').value = await cRes.text();
    
    // Build Nav Buttons for sections
    const nav = document.getElementById('config-nav'); nav.innerHTML = '';
    nav.innerHTML += `<button class="btn btn-outline" style="width:100%; text-align:left; margin-bottom:5px" onclick="document.getElementById('sec-nvr').scrollIntoView({behavior:'smooth'})">NVRs</button>`;
    
    // Render Configs
    const con = document.getElementById('config-forms'); con.innerHTML = '';
    const groups = { 'Email': ['MAIL_ENABLED', 'MAIL_SERVER', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_RECIPIENTS', 'MAIL_FIRST_ALERT_DELAY_MINUTES', 'MAIL_LOW_IMPORTANCE_DELAY_MINUTES', 'MAIL_ALERT_FREQUENCY_MINUTES', 'MAIL_MUTE_AFTER_N_ALERTS'], 'Telegram': ['TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'TELEGRAM_PROXY', 'TELEGRAM_FIRST_ALERT_DELAY_MINUTES', 'TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES', 'TELEGRAM_ALERT_FREQUENCY_MINUTES', 'TELEGRAM_MUTE_AFTER_N_ALERTS'] };
    
    for(const [grp, keys] of Object.entries(groups)) {
        nav.innerHTML += `<button class="btn btn-outline" style="width:100%; text-align:left; margin-bottom:5px" onclick="document.getElementById('grp-${grp}').scrollIntoView({behavior:'smooth'})">${grp}</button>`;
        let html = `<div class="config-card" id="grp-${grp}"><div class="config-title">${grp} <button class="btn" style="padding:2px 8px; font-size:10px" onclick="testConn('${grp.toLowerCase()}')">Test</button></div>`;
        keys.forEach(k => {
            const item = settingsCache.find(s=>s.key===k); if(!item) return;
            const label = k.split('_').slice(1).join(' ').toLowerCase().replace(/\b\w/g, c=>c.toUpperCase());
            if(k.endsWith('ENABLED')) { html += `<div class="toggle-row"><span style="font-size:13px; color:#aaa">${label}</span><label class="switch"><input type="checkbox" id="${k}" ${item.value==='true'?'checked':''}><span class="slider"></span></label></div>`; }
            else { html += `<div class="input-wrap"><label class="lbl">${label}</label><input class="std-input" id="${k}" value="${item.value||''}" type="${k.includes('PASS')||k.includes('TOKEN')?'password':'text'}"></div>`; }
        });
        con.innerHTML += html + '</div>';
    }
    // NVR List
    const nRes = await fetch(`${API}/nvrs`); const nvrs = await nRes.json();
    document.getElementById('nvr-list').innerHTML = nvrs.map(n => `<div class="list-item"><span>${n.ip} <span style="color:#666">(${n.user})</span></span><button class="btn-icon" onclick="delNVR('${n.ip}')"><span class="material-icons-round" style="font-size:16px; color:var(--danger)">delete</span></button></div>`).join('');
}
async function saveAll() { for(const s of settingsCache) { const el = document.getElementById(s.key); if(el) { let val = el.value; if(el.type==='checkbox') val=el.checked?'true':'false'; if(val!==s.value) await fetch(`${API}/settings/${s.key}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({key:s.key, value:val})}); } } await fetch(`${API}/config/csv`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:document.getElementById('csvEditor').value})}); alert('Saved'); }
async function apply() { await saveAll(); await fetch(`${API}/monitor/restart`, {method:'POST'}); alert('Restarted'); location.reload(); }
async function testConn(type) { try { const res = await fetch(`/api/test/${type}`, {method:'POST'}); if(res.ok) alert('Passed'); else alert('Failed'); } catch(e){alert(e);} }
async function addNVR() { const ip=document.getElementById('nvrIp').value; const u=document.getElementById('nvrUser').value; const p=document.getElementById('nvrPass').value; await fetch(`${API}/nvrs`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ip, user:u, password:p||null, enabled:true})}); loadSettings(); }
async function delNVR(ip) { if(confirm('Delete?')) { await fetch(`${API}/nvrs/${ip}`, {method:'DELETE'}); loadSettings(); } }
async function purgeData() {
    if (confirm('Are you sure you want to delete all logs and reset camera states? This action cannot be undone.')) {
        const res = await fetch(`${API}/data/purge`, {method: 'POST'});
        if (res.ok) {
            alert('Data purged successfully.');
            location.reload();
        } else {
            alert('Failed to purge data.');
        }
    }
}

// LOGS (Restored)
function delayLogSearch() { clearTimeout(logTimer); logTimer = setTimeout(()=>{ logSearchVal=document.getElementById('logSearch').value; resetLogs(); }, 500); }
function setFilter(btn, val) { document.querySelectorAll('.btn-outline').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); logFilter=val; resetLogs(); }
function resetLogs() { document.getElementById('log-list').innerHTML=''; logOff=0; allLoaded=false; fetchLogs(); }
async function fetchLogs() {
    if(loading||allLoaded)return; loading=true; document.getElementById('logLoader').style.display='block';
    const res = await fetch(`${API}/logs?q=${logFilter||logSearchVal}&limit=30&offset=${logOff}`); const logs = await res.json();
    if(logs.length<30) allLoaded=true;
    document.getElementById('log-list').insertAdjacentHTML('beforeend', logs.map(l=>{
        let detail = l.details; if(detail.includes('mins')) detail = `<span class="downtime-tag">${detail.match(/\d+m/)}</span> ` + detail;
        const clr = ['Error','Failed','Offline'].includes(l.state) ? 'var(--danger)' : 'var(--success)';
        return `<tr><td class="log-time">${l.shamsi_date}</td><td style="font-weight:600; font-size:11px">${l.log_type}</td><td style="color:${clr}; font-weight:700">${l.state}</td><td>${detail}</td></tr>`;
    }).join(''));
    logOff+=logs.length; loading=false; document.getElementById('logLoader').style.display='none';
}

let logTimer;
document.addEventListener('DOMContentLoaded', ()=>{
    document.getElementById('logScroll').addEventListener('scroll', (e)=>{ 
        if(e.target.scrollTop+e.target.clientHeight >= e.target.scrollHeight-100) fetchLogs(); 
    });
});

// --- REPORTS ---
function setPreset(h) {
    const end = new Date(); const start = new Date(end.getTime()-(h*60*60*1000));
    start.setMinutes(start.getMinutes()-start.getTimezoneOffset()); end.setMinutes(end.getMinutes()-end.getTimezoneOffset());
    document.getElementById('startDt').value = start.toISOString().slice(0,16); document.getElementById('endDt').value = end.toISOString().slice(0,16);
}
async function genReport() {
    const s = new Date(document.getElementById('startDt').value).getTime()/1000; const e = new Date(document.getElementById('endDt').value).getTime()/1000;
    if(!s || !e) return alert('Select Range');
    document.getElementById('rep-list').innerHTML = '<div style="padding:20px; text-align:center">Analyzing...</div>';
    const res = await fetch(`${API}/reports/generate?start=${s}&end=${e}`); const data = await res.json();
    if(data.length===0) { document.getElementById('rep-list').innerHTML='<div style="padding:20px; text-align:center">No downtime found.</div>'; return; }
    const max = Math.max(...data.map(i=>i.mins));
    document.getElementById('rep-list').innerHTML = data.map(i=>{
        const pct = Math.min(100, (i.mins/max)*100);
        return `<div style="padding:15px; border-bottom:1px solid var(--border)"><div style="display:flex; justify-content:space-between; margin-bottom:6px"><span>${i.name}</span><span style="color:var(--danger); font-weight:700">${i.mins}m</span></div><div style="height:6px; background:#222; border-radius:3px"><div style="height:100%; background:var(--danger); border-radius:3px; width:${pct}%"></div></div></div>`;
    }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    nav('summ');
    setInterval(fetchDash, 5000);
});
