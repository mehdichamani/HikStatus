// ماژول ارتباط با بک‌اند و ارسال درخواست‌های API

const API = '/api/v1';

export async function apiFetch(url, options = {}) {
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

export async function fetchDash() {
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

export async function loadSettings(activeTabOverride = null) {
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

export async function saveAll(silent = false) {
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

export async function apply() {
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

export async function loadOutageCauses() {
    const list = document.getElementById('causes-list');
    if (!list) return;

    try {
        const res = await apiFetch(`/api/v1/outage-causes`);
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

export async function addOutageCause() {
    const input = document.getElementById('new-cause-name');
    const name = input.value.trim();
    if (!name) return showToast('نام علت را وارد کنید', 'error');

    try {
        const res = await apiFetch(`/api/v1/outage-causes`, {
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

export async function deleteOutageCause(id) {
    if (!await showConfirm('آیا از حذف/غیرفعال‌سازی این علت قطعی اطمینان دارید؟')) return;
    try {
        const res = await apiFetch(`/api/v1/outage-causes/${id}`, { method: 'DELETE' });
        const data = await res.json();
        showToast(data.message);
        loadOutageCauses();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

export async function testConn(type) {
    try {
        await apiFetch(`/api/v1/test/${type}`, { method: 'POST' });
        showToast('تست موفق');
    } catch (e) {
        showToast('تست ناموفق: ' + e.message, 'error');
    }
}

export async function addNVR() {
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

export async function toggleNVRenabled(ip, enabled) {
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

export async function addGroup() {
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

export async function deleteGroup(id) {
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

export async function updateNVRGroup(ip, groupId) {
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

export async function applyNVRDelete(ip) {
    try {
        await apiFetch(`${API}/nvrs/${encodeURIComponent(ip)}`, { method: 'DELETE' });
        pendingNVRDeletes.delete(ip);
        showToast('NVR با موفقیت حذف شد');
        loadSettings();
    } catch (e) {
        showToast('خطا در حذف NVR: ' + e.message, 'error');
    }
}

export async function saveNVRRow(ip) {
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

export async function purgeDatabase() {
    if (!await showConfirm('توجه: تمامی اطلاعات دیتابیس (دوربین‌ها، NVRها، لاگ‌ها، دسته‌بندی‌ها و تنظیمات) به طور کامل پاک خواهند شد. آیا مطمئن هستید؟')) return;
    try {
        await apiFetch(`${API}/data/purge`, { method: 'POST' });
        showToast('پاکسازی کامل دیتابیس با موفقیت انجام شد');
        setTimeout(() => location.reload(), 1000);
    } catch (e) {
        showToast('خطا: ' + e.message, 'error');
    }
}

export async function restoreDatabase(input) {
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

export async function importJsonConfig(input) {
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

export function resetLogs() {
    document.getElementById('log-list').innerHTML = '';
    logOff = 0;
    allLoaded = false;
    fetchLogs();
}

export async function fetchLogs() {
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

export async function genReport() {
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

export async function loadAndRenderCharts(s, e) {
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

export async function logout() {
    try {
        await apiFetch(`${API}/auth/logout`, { method: 'POST' });
    } catch (e) { }
    window.location.href = '/login';
}

export async function loadGroupsCache() {
    try {
        const res = await apiFetch(`${API}/groups`);
        groupsCache = await res.json();
    } catch (e) {
        groupsCache = [];
    }
}

export async function loadGroupPlans(groupId) {
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

export async function uploadGroupPlan(input) {
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

export async function deletePlan(planId) {
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

export function saveFovDebounced(id, angle, radius, spread) {
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

export async function toggleMarkerFov(id, enabled) {
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

export async function removeCameraFromMap(id) {
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

export async function setMapType(type) {
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

export async function uploadMapImage(input) {
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

export async function fetchAndRenderHeatmap() {
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

export async function addCameraToCenter(id, hasFov) {
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

export async function loadUsers() {
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

export async function addUser() {
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

export async function deleteUser(id) {
    if (!await showConfirm('آیا از حذف این کاربر مطمئن هستید؟')) return;
    try {
        await apiFetch(`${API}/users/${id}`, { method: 'DELETE' });
        showToast('کاربر با موفقیت حذف شد');
        loadUsers();
    } catch (e) {
        showToast('خطا در حذف کاربر: ' + e.message, 'error');
    }
}

export async function loadMyAlerts() {
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

export async function saveMyAlerts() {
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

export async function changeMyPassword() {
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

export async function start2FASetup() {
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

export async function verify2FAAndEnable() {
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

export async function disable2FA() {
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

export async function toggleSidebarFov(enabled) {
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

export async function loadScheduledTasks() {
    try {
        const res = await apiFetch(`${API}/scheduler/tasks`);
        if (!res.ok) throw new Error("خطا در دریافت لیست تسک‌ها");
        scheduledTasksCache = await res.json();
        renderScheduledTasks();
    } catch(e) {
        showToast(e.message, 'error');
    }
}

export async function runTask(id) {
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

export async function stopTask(id) {
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

export async function saveTaskInterval(id) {
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

export async function toggleTask(id, enabled) {
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

export async function warmUpSearchCache() {
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

export async function loadOutageExplanations() {
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

export async function submitExplanation() {
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

export async function prefetchOffRecording() {
    try {
        const res = await apiFetch(`${API}/cameras/off`);
        offRecordingCache = await res.json();
        if (changesFilterAction === 'off_recording') renderFilteredCameraChanges();
    } catch (e) {
        console.error('Error prefetching off recording:', e);
    }
}

export async function saveGroupEdit() {
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

export async function saveUserEdit() {
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
