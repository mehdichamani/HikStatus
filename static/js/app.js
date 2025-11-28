document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-link');
    const contents = document.querySelectorAll('.tab-content');
    const lastUpdatedSpan = document.getElementById('last-updated');
    const saveConfigBtn = document.getElementById('save-config-btn');
    const changePasswordBtn = document.getElementById('change-password-btn');
    const logFilterInput = document.getElementById('log-filter-input');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    
    // Modal elements
    const modal = document.getElementById('camera-detail-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    let updateInterval;
    let currentTab = 'status'; // Default tab

    // --- Dark Mode ---
    function setDarkMode(isDark) {
        if (isDark) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('darkMode', 'true');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('darkMode', 'false');
        }
    }

    // Check saved preference for dark mode
    if (localStorage.getItem('darkMode') === 'true') {
        setDarkMode(true);
    }

    darkModeToggle.addEventListener('click', () => {
        setDarkMode(!document.body.classList.contains('dark-mode'));
    });

    // --- Tab Switching ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            currentTab = tab.getAttribute('data-tab');
            
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(currentTab).classList.add('active');

            // Load data for the activated tab
            switch (currentTab) {
                case 'status':
                    loadStatus();
                    break;
                case 'logs':
                    loadLogs();
                    break;
                case 'reports':
                    loadReports();
                    break;
                case 'config':
                    loadConfig();
                    break;
            }
        });
    });

    // --- Modal Listeners ---
    if (modal) {
        modalCloseBtn.addEventListener('click', () => modal.classList.remove('show'));
        modal.addEventListener('click', (e) => {
            // Close if clicked on the overlay itself
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    }

    // --- Data Loading Functions ---

    function loadStatus() {
        fetch('/api/status')
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                
                const cardContainer = document.getElementById('camera-grid-container');
                const summaryContainer = document.getElementById('global-summary-container');
                
                cardContainer.innerHTML = ''; // Clear old cards
                summaryContainer.innerHTML = ''; // Clear old summary

                // --- 1. Calculate and build global summary cards ---
                const totalCameras = data.length;
                const onlineCameras = data.filter(c => c.status === 'Online').length;
                const offlineCameras = totalCameras - onlineCameras;
                const nvrSet = new Set(data.map(c => c.nvr_ip));
                const totalNvrs = nvrSet.size;

                summaryContainer.innerHTML = `
                    <div class="summary-card total-cams">
                        <h3>${totalCameras}</h3>
                        <p>Total Cameras</p>
                    </div>
                    <div class="summary-card total-nvrs">
                        <h3>${totalNvrs}</h3>
                        <p>Total NVRs</p>
                    </div>
                    <div class="summary-card total-online">
                        <h3>${onlineCameras}</h3>
                        <p>Online</p>
                    </div>
                    <div class="summary-card total-offline">
                        <h3>${offlineCameras}</h3>
                        <p>Offline</p>
                    </div>
                `;
                
                // --- 2. Sort data and build small camera grid cards ---
                data.sort((a, b) => {
                    if (a.status !== 'Online' && b.status === 'Online') return -1;
                    if (a.status === 'Online' && b.status !== 'Online') return 1;
                    if (a.nvr_ip < b.nvr_ip) return -1;
                    if (a.nvr_ip > b.nvr_ip) return 1;
                    if (a.camera_name < b.camera_name) return -1;
                    if (a.camera_name > b.camera_name) return 1;
                    return 0;
                });

                data.forEach(cam => {
                    const card = document.createElement('div');
                    card.className = 'camera-grid-card';
                    
                    const statusLightClass = (cam.status === 'Online') ? 'online' : 'offline';
                    
                    card.innerHTML = `
                        <span class="camera-name">${cam.camera_name}</span>
                        <div class="status-light ${statusLightClass}"></div>
                    `;

                    // Add click listener to show modal
                    card.addEventListener('click', () => {
                        document.getElementById('modal-cam-name').textContent = cam.camera_name;
                        document.getElementById('modal-cam-ip').textContent = cam.camera_ip || 'N/A';
                        document.getElementById('modal-cam-nvr').textContent = cam.nvr_ip || 'N/A';
                        
                        let statusText = cam.status;
                        if (cam.status !== 'Online' && cam.is_muted) {
                            statusText = 'Offline (Muted)';
                        }
                        document.getElementById('modal-cam-status').textContent = statusText;
                        document.getElementById('modal-cam-downtime').textContent = formatDuration(cam.downtime_seconds);
                        
                        modal.classList.add('show');
                    });

                    cardContainer.appendChild(card);
                });
            })
            .catch(error => {
                console.error('Error loading status:', error);
                showToast(`Error loading status: ${error.message}`, 'error');
                stopAutoUpdate(); // Stop on error
            });
    }

    // This function is no longer needed, loadStatus handles summary
    // function loadChecks() { ... }

    function loadLogs() {
        fetch('/api/logs?limit=200')
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                const tableBody = document.getElementById('logs-table-body');
                tableBody.innerHTML = '';
                data.forEach(log => {
                    const row = tableBody.insertRow();
                    row.className = `severity-${log.severity}`;
                    
                    const timestamp = log.timestamp;
                    const parts = timestamp.split(' ');
                    row.insertCell().textContent = parts[0] || '';
                    row.insertCell().textContent = parts[1] || '';
                    row.insertCell().textContent = log.alert_type;
                    row.insertCell().textContent = log.severity;
                    row.insertCell().textContent = log.nvr_ip || 'N/A';
                    row.insertCell().textContent = log.camera_name || 'N/A';
                    row.insertCell().textContent = log.camera_ip || 'N/A';
                    row.insertCell().textContent = formatDuration(log.duration_seconds);
                    row.insertCell().textContent = log.details || '';
                });
                // Re-apply filter after loading
                filterLogs();
            })
            .catch(error => {
                console.error('Error loading logs:', error);
                showToast(`Error loading logs: ${error.message}`, 'error');
            });
    }

    function loadReports() {
        fetch('/api/reports/uptime_24h')
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                const tableBody = document.getElementById('reports-table-body');
                tableBody.innerHTML = '';
                
                // Sort by uptime percentage, lowest first
                data.sort((a, b) => a.uptime_percent - b.uptime_percent);

                data.forEach(cam => {
                    const row = tableBody.insertRow();
                    const percent = cam.uptime_percent;
                    let barClass = 'high';
                    if (percent < 99) barClass = 'medium';
                    if (percent < 95) barClass = 'low';

                    row.insertCell().textContent = cam.name;
                    row.insertCell().textContent = cam.ip;
                    row.insertCell().textContent = cam.nvr_ip;
                    
                    row.insertCell().innerHTML = `
                        <div class="progress-bar-container" title="${percent}% Uptime">
                            <div class="progress-bar ${barClass}" style="width: ${percent}%;">
                                ${percent}%
                            </div>
                        </div>
                    `;
                });
            })
            .catch(error => {
                console.error('Error loading reports:', error);
                showToast(`Error loading reports: ${error.message}`, 'error');
            });
    }


    function loadConfig() {
        fetch('/api/config')
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                document.getElementById('first-alert-delay').value = data.FIRST_ALERT_DELAY_MINUTES;
                document.getElementById('alert-frequency').value = data.ALERT_FREQUENCY_MINUTES;
                document.getElementById('mute-after-n-alerts').value = data.MUTE_AFTER_N_ALERTS;
            })
            .catch(error => {
                console.error('Error loading config:', error);
                showToast(`Error loading config: ${error.message}`, 'error');
            });
    }

    // --- Event Handlers ---

    function saveConfig() {
        const config = {
            FIRST_ALERT_DELAY_MINUTES: document.getElementById('first-alert-delay').value,
            ALERT_FREQUENCY_MINUTES: document.getElementById('alert-frequency').value,
            MUTE_AFTER_N_ALERTS: document.getElementById('mute-after-n-alerts').value,
        };

        const csrfToken = getCsrfToken();

        fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify(config)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast(data.message || 'Configuration saved!', 'success');
                // Restart auto-update
                startAutoUpdate();
            } else {
                throw new Error(data.error || 'Failed to save config');
            }
        })
        .catch(error => {
            console.error('Error saving config:', error);
            showToast(`Error: ${error.message}`, 'error');
        });
    }

    function changePassword() {
        const newPassword = document.getElementById('new-password').value;
        if (!newPassword) {
            showToast('Password cannot be empty', 'error');
            return;
        }

        const csrfToken = getCsrfToken();

        fetch('/api/change_password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({ new_password: newPassword })
        })
        .then(response => response.json())
        .then(data => {
            if (data.message) {
                showToast(data.message, 'success');
                document.getElementById('new-password').value = '';
            } else {
                throw new Error(data.error || 'Failed to change password');
            }
        })
        .catch(error => {
            console.error('Error changing password:', error);
            showToast(`Error: ${error.message}`, 'error');
        });
    }

    // --- Log Filtering ---
    function filterLogs() {
        const filter = logFilterInput.value.toLowerCase();
        const tableBody = document.getElementById('logs-table-body');
        const rows = tableBody.getElementsByTagName('tr');

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const text = row.textContent.toLowerCase();
            if (text.includes(filter)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    }

    // --- Utility Functions ---

    function formatDuration(seconds) {
        if (seconds === null || seconds === undefined) {
            return 'N/A';
        }
        if (seconds < 0) return '00:00';

        const minutes = Math.floor(seconds / 60);
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor((minutes % 1440) / 60);
        const mins = minutes % 60;

        const pad = (n) => (n < 10 ? '0' + n : n);

        if (days > 0) {
            return `${days}d ${pad(hours)}:${pad(mins)}`;
        } else {
            return `${pad(hours)}:${pad(mins)}`;
        }
    }

    function getCsrfToken() {
        // Read from the meta tag instead of cookie
        const token = document.querySelector('meta[name="csrf-token"]');
        return token ? token.getAttribute('content') : '';
    }

    function showToast(message, type = 'info') {
        const toast = document.getElementById('toast-message');
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        setTimeout(() => {
            toast.className = 'toast';
        }, 3000);
    }

    function updateAll() {
        if (currentTab === 'status') {
            loadStatus();
            // loadChecks(); // No longer needed
        } else if (currentTab === 'logs') {
            loadLogs();
        } else if (currentTab === 'reports') {
            loadReports();
        }
    }

    function startAutoUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        // Update every 60 seconds
        updateInterval = setInterval(updateAll, 60000); 
    }

    function stopAutoUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        lastUpdatedSpan.textContent = 'Auto-update stopped due to error.';
    }

    // --- Initial Load ---
    loadStatus(); // This now loads summary cards AND camera grid
    // loadChecks(); // No longer needed
    startAutoUpdate();

    // Bind event listeners
    saveConfigBtn.addEventListener('click', saveConfig);
    changePasswordBtn.addEventListener('click', changePassword);
    logFilterInput.addEventListener('keyup', filterLogs);
});