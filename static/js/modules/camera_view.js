// ماژول مدیریت و نمایش دوربین‌ها، NVRها و ویجت‌های مرتبط

export function saveCollapsedState() {
    localStorage.setItem('collapsedFactories', JSON.stringify([...collapsedFactories]));
    localStorage.setItem('collapsedNvrs', JSON.stringify([...collapsedNvrs]));
}

export function getNvrNum(ip) { return ip.split('.').pop(); }


export function getNvrDisplayName(ip) {
    const nvrObj = nvrCache.find(n => n.ip === ip);
    return nvrObj && nvrObj.name ? nvrObj.name : `NVR ${window.getNvrNum(ip)}`;
}

export function setDashCamRecordingFilter(val) {
    dashCamRecordingFilter = val;
    window.renderDash();
}

export function setDashCamFilter(filter) {
    dashCamFilter = filter;
    document.querySelectorAll('.chip[id^="filter-cam-"]').forEach(b => {
        b.classList.remove('active');
    });
    if (filter === 'all') document.getElementById('filter-cam-all').classList.add('active');
    else if (filter === 'online') document.getElementById('filter-cam-online').classList.add('active');
    else if (filter === 'offline') document.getElementById('filter-cam-offline').classList.add('active');
    window.renderDash();
}

export function toggleNvr(header) {
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
        window.saveCollapsedState();
    }
}

export function toggleFactory(id) {
    const el = document.getElementById('factory-' + id);
    if (el) {
        el.classList.toggle('open');
        const strId = String(id);
        if (el.classList.contains('open')) {
            collapsedFactories.delete(strId);
        } else {
            collapsedFactories.add(strId);
        }
        window.saveCollapsedState();
    }
}

export function expandAllFactories() {
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
    window.saveCollapsedState();
}

export function collapseAllFactories() {
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
    window.saveCollapsedState();
}

export function createCard(c) {
    const stClass = c.status === 'Online' ? 'status-online' : 'status-offline';
    const meta = encodeURIComponent(JSON.stringify(c));
    const star = c.importance === 3 ? '<span class="cam-card-star">★</span>' : '';
    const ipShort = c.ip ? c.ip.split('.').pop() : '';
    const isRecording = c.recording_scheduled === true;
    const recDotClass = isRecording ? 'cam-record-dot recording' : 'cam-record-dot not-recording';

    return `<div class="cam-card ${stClass}" onclick="window.showCam('${meta}')">
        <div class="cam-card-inner">
            <div class="cam-status-dots">
                <span class="cam-status-dot"></span>
                <span class="${recDotClass}" title="${isRecording ? 'در حال ضبط' : 'ضبط غیرفعال'}"></span>
            </div>
            <div class="cam-card-info">
                <div class="cam-card-name">${window.escapeHTML(c.name)}</div>
                <div class="cam-card-meta">CH ${window.escapeHTML(String(c.channel_id))}</div>
            </div>
            ${star}
        </div>
    </div>`;
}

export async function showCam(data) {
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
    document.getElementById('m-nvr').textContent = `${window.getNvrDisplayName(c.nvr_ip)} (${c.nvr_ip})`;
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
        document.getElementById('m-oldest').textContent = window.formatShamsiDate(c.oldest_record);
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

    const res = await window.apiFetch(`${API}/stats/${c.id}`);
    const s = await res.json();
    document.getElementById('m-d1').textContent = s.down_1h + ' دقیقه';
    document.getElementById('m-d24').textContent = s.down_24h + ' دقیقه';
}

export function playLiveStream() {
    window.open(`/api/v1/cameras/${currentCamId}/live`, '_blank');
}

export function validateNVRInputs() {
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

export function renderNVRRow(n, deleted = false) {
    const escaped = n.ip.replace(/[^\w]/g, '_');
    if (deleted) {
        return `<div class="list-item list-item-deleted" id="nvr-row-${escaped}" data-ip="${n.ip}">
            <div class="list-item-info" style="text-decoration: line-through; opacity: 0.55;">
                ${n.name ? `<strong style="margin-left: 8px;">${n.name}</strong>` : ''}
                <span class="list-item-ip">${n.ip}</span>
                <span class="list-item-user">(${n.user})</span>
            </div>
            <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                <button class="btn" style="padding: 4px 10px; font-size: 12px; background: var(--surface-2); color: var(--text-secondary); border: 1px solid var(--border);" onclick="window.undoNVRDelete('${n.ip}')">
                    بازگشت
                </button>
                <button class="btn btn-danger" style="padding: 4px 10px; font-size: 12px;" onclick="window.applyNVRDelete('${n.ip}')">
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
        groupSelectOrLabel = `<select class="form-input form-input-sm" style="margin-right: 12px; width: 160px; padding: 2px 8px; font-size:12px; height:28px" onchange="window.updateNVRGroup('${n.ip}', this.value)">${options}</select>`;
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
                <button class="btn-icon" onclick="window.startEditNVR('${n.ip}')" style="width:28px; height:28px" title="ویرایش">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
                </button>
            `;
        }
        if (role === 'admin') {
            actionBtns += `
                <button class="btn-icon" onclick="window.delNVR('${n.ip}')" style="width:28px; height:28px" title="حذف">
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
                    <input type="checkbox" ${n.enabled !== false ? 'checked' : ''} onchange="window.toggleNVRenabled('${n.ip}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                ${actionBtns}
            </div>
        </div>
    </div>`;
}

export function renderGroupsList() {
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
                <button class="btn-icon" onclick="window.openEditGroupModal(${g.id})" style="width:28px; height:28px" title="ویرایش" aria-label="ویرایش">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>
                <button class="btn-icon" onclick="window.deleteGroup(${g.id})" style="width:28px; height:28px" title="حذف" aria-label="حذف">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

export function delNVR(ip) {
    pendingNVRDeletes.add(ip);
    const nvr = nvrCache.find(n => n.ip === ip);
    if (!nvr) return;
    const escaped = ip.replace(/[^\w]/g, '_');
    const row = document.getElementById(`nvr-row-${escaped}`);
    if (row) row.outerHTML = window.renderNVRRow(nvr, true);
}

export function undoNVRDelete(ip) {
    pendingNVRDeletes.delete(ip);
    const nvr = nvrCache.find(n => n.ip === ip);
    if (!nvr) return;
    const escaped = ip.replace(/[^\w]/g, '_');
    const row = document.getElementById(`nvr-row-${escaped}`);
    if (row) row.outerHTML = window.renderNVRRow(nvr, false);
}

export function startEditNVR(ip) {
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
                <button class="btn btn-primary" onclick="window.saveNVRRow('${n.ip}')" style="flex: 1; height: 38px;">ذخیره</button>
                <button class="btn" style="flex: 1; height: 38px; background: var(--surface-2); color: var(--text-secondary); border: 1px solid var(--border);" onclick="window.cancelEditNVR('${n.ip}')">انصراف</button>
            </div>
        </div>
    `;
}

export function cancelEditNVR(ip) {
    const n = nvrCache.find(n => n.ip === ip);
    if (!n) return;
    const escaped = ip.replace(/[^\w]/g, '_');
    const row = document.getElementById(`nvr-row-${escaped}`);
    if (row) {
        row.outerHTML = window.renderNVRRow(n, false);
    }
}

export function drawCameraMarkers(bounds = null, w = 1, h = 1) {
    if (typeof clearActiveFovSelection === 'function') {
        window.clearActiveFovSelection();
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

        window.createMarkerForMap(c, latlng);
    });

    if (!mapEditMode) {
        map.addLayer(mapClusterGroup);
    }
}

export function renderMapCameraList() {
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
                <div class="map-cam-item" onclick="window.focusCameraOnMap(${c.id})">
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
                        <button onclick="window.addCameraToCenter(${c.id}, false); event.stopPropagation();" title="افزودن به عنوان نقطه ساده" style="
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
                        <button onclick="window.addCameraToCenter(${c.id}, true); event.stopPropagation();" title="افزودن با زاویه دید (FOV)" style="
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

export function filterMapCamerasList() {
    window.renderMapCameraList();
}

export function focusCameraOnMap(id) {
    if (!map) return;
    const marker = mapMarkers.find(m => m.camera_id === id);
    if (marker) {
        const latlng = marker.getLatLng();
        map.flyTo(latlng, map.getZoom());
        const c = mapCamerasList.find(cam => cam.id === id);
        if (c) window.selectMarkerForFov(marker, c);
    } else {
        window.showToast('این دوربین در نقشه یافت نشد', 'error');
    }
}

export function renderNvrHealthWidget() {
    const listEl = document.getElementById('nvr-health-list');
    if (!listEl) return;

    const updateTimeEl = document.getElementById('nvr-health-update-time');
    if (updateTimeEl) {
        const task = scheduledTasksCache.find(t => t.id === 'sync_nvr_health');
        updateTimeEl.textContent = task && task.last_run ? `بروزرسانی: ${window.formatTimeAgo(task.last_run)}` : 'بروزرسانی: در حال انتظار...';
    }

    const activeNvrs = nvrCache.filter(n => n.enabled !== false);
    if (activeNvrs.length === 0) {
        listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 24px 0;">دستگاه NVR فعال یافت نشد.</div>';
        return;
    }

    const html = activeNvrs.map(n => {
        let statusBadge = '';
        if (n.status === 'Online') {
            statusBadge = '<span style="font-size: 10px; padding: 3px 8px; border-radius: 12px; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25); font-weight: bold; display: flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; display: inline-block; animation: pulse 2s infinite;"></span>متصل</span>';
        } else if (n.status === 'AuthError') {
            statusBadge = '<span style="font-size: 10px; padding: 3px 8px; border-radius: 12px; background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.25); font-weight: bold; display: flex; align-items: center; gap: 4px;">⚠️ خطای احراز</span>';
        } else {
            statusBadge = '<span style="font-size: 10px; padding: 3px 8px; border-radius: 12px; background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.25); font-weight: bold; display: flex; align-items: center; gap: 4px;">❌ قطع ارتباط</span>';
        }

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

        const hddHtml = window.formatHddInfo(n.hdd_status);

        return `
            <div class="nvr-health-card" style="border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; background: var(--surface-2); transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span style="font-size: 13px; font-weight: 700; color: var(--text);">${n.name || 'NVR بدون نام'}</span>
                        <span class="mono" style="font-size: 11px; color: var(--text-secondary); opacity: 0.85; display: flex; align-items: center; gap: 8px;">
                            <span>${n.ip}</span>
                            <span style="color: var(--border);">|</span>
                            <span>⏱️ کارکرد: ${window.toPersianNumbers(uptimeVal)}</span>
                        </span>
                    </div>
                    <div>${statusBadge}</div>
                </div>
                <div style="font-size: 11px; display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--border); padding-top: 8px;">
                    ${hddHtml}
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = html;
}

export function renderNvrHealthSummaryWidget() {
    const contentEl = document.getElementById('nvr-health-summary-content');
    if (!contentEl) return;

    const updateTimeEl = document.getElementById('nvr-health-summary-update-time');
    if (updateTimeEl) {
        const task = scheduledTasksCache.find(t => t.id === 'sync_nvr_health');
        updateTimeEl.textContent = task && task.last_run ? `بروزرسانی: ${window.formatTimeAgo(task.last_run)}` : 'بروزرسانی: در حال انتظار...';
    }

    const activeNvrs = nvrCache.filter(n => n.enabled !== false);
    if (activeNvrs.length === 0) {
        contentEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 24px 0;">دستگاه NVR فعال یافت نشد.</div>';
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
                    failedHdds += hdds.filter(h => h.status && h.status.toLowerCase() !== 'ok').length;
                }
            } catch (e) {}
        }
    });

    let hddStatusText = '<span style="color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 4px;">💚 تمامی هاردها سالم هستند</span>';
    if (totalHdds === 0) {
        hddStatusText = '<span style="color: var(--text-muted);">اطلاعات هارد در دسترس نیست</span>';
    } else if (failedHdds > 0) {
        hddStatusText = `<span style="color: #ef4444; font-weight: 700; display: flex; align-items: center; gap: 4px;">⚠️ ${window.toPersianNumbers(failedHdds)} خطا در هاردها</span>`;
    }

    const criticalNvrs = activeNvrs.filter(n => {
        if (n.status !== 'Online') return true;
        if (n.hdd_status) {
            try {
                const hdds = JSON.parse(n.hdd_status);
                if (Array.isArray(hdds) && hdds.some(h => h.status && h.status.toLowerCase() !== 'ok')) {
                    return true;
                }
            } catch (e) {}
        }
        return false;
    });

    let alertsHtml = '';
    if (criticalNvrs.length === 0) {
        alertsHtml = `
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 12px; display: flex; align-items: center; gap: 8px; justify-content: center; color: #10b981; font-size: 11.5px; font-weight: bold; margin-top: 4px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>تمامی ${window.toPersianNumbers(total)} دستگاه NVR در وضعیت عادی هستند</span>
            </div>
        `;
    } else {
        const listItems = criticalNvrs.map(n => {
            let errorLabel = '';
            if (n.status === 'AuthError') {
                errorLabel = '<span style="color: #f59e0b; font-weight: bold;">خطای احراز</span>';
            } else if (n.status !== 'Online') {
                errorLabel = '<span style="color: #ef4444; font-weight: bold;">قطع ارتباط</span>';
            } else {
                errorLabel = '<span style="color: #ef4444; font-weight: bold;">خطای هارد</span>';
            }

            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; transition: all 0.2s ease;" onclick="window.showNvrHealthModal(event, '${n.ip}')" title="مشاهده جزئیات سلامت NVR">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--text-primary);">${n.name || 'NVR بدون نام'}</span>
                        <span class="mono" style="font-size: 10px; color: var(--text-secondary);">${n.ip}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        ${errorLabel}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted);"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                </div>
            `;
        }).join('');

        alertsHtml = `
            <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                <h4 style="font-size: 11px; font-weight: 700; color: var(--text-secondary); margin: 0 0 2px 0; display: flex; align-items: center; gap: 4px;">🚨 لیست هشدارهای سلامت (${window.toPersianNumbers(criticalNvrs.length)} دستگاه):</h4>
                <div class="widget-list-scrollable" style="max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-left: 2px;">
                    ${listItems}
                </div>
            </div>
        `;
    }

    contentEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                <div style="background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.15); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 11px; color: var(--text-secondary);">کل NVRها</span>
                    <span style="font-size: 18px; font-weight: 800; color: var(--primary);">${window.toPersianNumbers(total)}</span>
                </div>
                <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 11px; color: var(--text-secondary);">دستگاه‌های متصل</span>
                    <span style="font-size: 18px; font-weight: 800; color: #10b981;">${window.toPersianNumbers(online)}</span>
                </div>
                <div style="background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 11px; color: var(--text-secondary);">قطع ارتباط</span>
                    <span style="font-size: 18px; font-weight: 800; color: ${offline > 0 ? '#ef4444' : 'var(--text-muted)'};">${window.toPersianNumbers(offline)}</span>
                </div>
                <div style="background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.15); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 11px; color: var(--text-secondary);">خطای احراز هویت</span>
                    <span style="font-size: 18px; font-weight: 800; color: ${authError > 0 ? '#f59e0b' : 'var(--text-muted)'};">${window.toPersianNumbers(authError)}</span>
                </div>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.01); border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-top: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; padding: 2px 0;">
                    <span style="color: var(--text-secondary);">وضعیت کل هارد دیسک‌ها:</span>
                    <span>${hddStatusText}</span>
                </div>
            </div>

            ${alertsHtml}
        </div>
    `;
}

export function renderImportantCamerasWidget() {
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

    grid.innerHTML = importantCams.map(c => window.createCard(c)).join('');
}

export async function renderOffCamerasWidget() {
    const listEl = document.getElementById('off-recording-list');
    if (!listEl) return;
    
    try {
        const res = await window.apiFetch(`${API}/cameras/off`);
        const data = await res.json();
        
        if (data.length === 0) {
            listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 16px 0;">هیچ دوربین ضبط خاموشی وجود ندارد.</div>';
            return;
        }
        
        listEl.innerHTML = data.map(item => `
            <div class="widget-list-item">
                <div class="item-title" title="${window.escapeHTML(item.name)}">${window.escapeHTML(item.name)}</div>
                <div class="item-meta">
                    <span style="font-weight: 500;">${window.escapeHTML(item.factory)}</span>
                    <span style="color: var(--danger); font-size: 11px;">(خاموش از ${window.escapeHTML(item.hours_off_str)})</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Error rendering off cameras widget:', e);
        listEl.innerHTML = '<div style="font-size: 12px; color: var(--danger); text-align: center; padding: 16px 0;">خطا در بارگذاری اطلاعات</div>';
    }
}

export function setChangesFilter(type, value) {
    if (value === 'off_recording') {
        changesFilterAction = 'off_recording';
        document.querySelectorAll('[data-cf-period]').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('[data-cf-action]').forEach(b => b.classList.toggle('active', b.dataset.cfAction === 'off_recording'));
        window.renderFilteredCameraChanges();
        return;
    }

    if (type === 'period') {
        changesFilterPeriod = value;
        document.querySelectorAll('[data-cf-period]').forEach(b => b.classList.toggle('active', b.dataset.cfPeriod === value));
    } else {
        changesFilterAction = value;
        document.querySelectorAll('[data-cf-action]').forEach(b => b.classList.toggle('active', b.dataset.cfAction === value));
    }
    window.renderFilteredCameraChanges();
}

export function renderFilteredCameraChanges() {
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
                <div class="item-title" title="${window.escapeHTML(item.name)}" style="font-size: 12px; max-width: 130px;">${window.escapeHTML(item.name)}</div>
                <div class="item-meta" style="font-size: 11px;">
                    <span>${window.escapeHTML(item.factory)}</span>
                    <span style="color: var(--danger); font-size: 10px;">خاموش از ${window.escapeHTML(item.hours_off_str)}</span>
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
        const timeHtml = item.time_ago ? `<span style="color: var(--text-muted); font-size: 9px;">${window.escapeHTML(item.time_ago)}</span>` : '';
        return `
            <div class="widget-list-item" style="padding: 5px 8px;">
                <div class="item-title" title="${window.escapeHTML(item.name)}" style="font-size: 12px; max-width: 130px;">${window.escapeHTML(item.name)}</div>
                <div class="item-meta" style="font-size: 11px;">
                    <span>${window.escapeHTML(item.factory)}</span>
                    <span class="badge-action ${actionClass}">${window.escapeHTML(item.action)}</span>
                    ${timeHtml}
                </div>
            </div>
        `;
    }).join('');
}

export async function renderCameraChangesWidget() {
    const listEl = document.getElementById('changes-list');
    if (!listEl) return;
    
    try {
        const [changesRes] = await Promise.all([
            window.apiFetch(`${API}/cameras/changes`),
            window.prefetchOffRecording()
        ]);
        changesCache = await changesRes.json();
        window.renderFilteredCameraChanges();
    } catch (e) {
        console.error('Error rendering camera changes widget:', e);
        listEl.innerHTML = '<div style="font-size: 12px; color: var(--danger); text-align: center; padding: 16px 0;">خطا در بارگذاری اطلاعات</div>';
    }
}