// ─── State Management ──────────────────────────────────────────────────────
const state = {
    isConnected: false,
    deviceId: '',
    jobsCount: 0,
    activePrinter: '',
    printers: []
};

// ─── DOM Elements ──────────────────────────────────────────────────────────
const elements = {
    pages: document.querySelectorAll('.page'),
    navBtns: document.querySelectorAll('.nav-btn'),
    statusPulse: document.getElementById('status-pulse'),
    statusText: document.getElementById('status-text'),
    jobsStat: document.getElementById('stat-jobs'),
    printerStat: document.getElementById('stat-printer'),
    deviceIdStat: document.getElementById('stat-device-id'),
    activityList: document.getElementById('activity-list'),
    consoleView: document.getElementById('console-view'),
    printerList: document.getElementById('printer-list'),
    newPrinterInput: document.getElementById('new-printer-name'),
    btnAddPrinter: document.getElementById('btn-add-printer'),
    btnToggleConnection: document.getElementById('btn-toggle-connection'),
    btnReconnect: document.getElementById('btn-reconnect'),
    btnClearLogs: document.getElementById('btn-clear-logs')
};

// ─── Navigation ─────────────────────────────────────────────────────────────
elements.navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const pageId = btn.dataset.page;
        
        // Update Nav
        elements.navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update Pages
        elements.pages.forEach(page => {
            page.classList.remove('active');
            if (page.id === `page-${pageId}`) page.classList.add('active');
        });
    });
});

// ─── IPC Listeners (from Electron) ──────────────────────────────────────────
window.electronAPI.onStatusUpdate((status) => {
    state.isConnected = status.connected;
    state.deviceId = status.deviceId;
    
    // Update UI
    elements.statusPulse.className = `pulse ${state.isConnected ? 'online' : 'offline'}`;
    elements.statusText.textContent = state.isConnected ? 'Online' : 'Disconnected';
    elements.btnToggleConnection.textContent = state.isConnected ? 'Disconnect' : 'Connect to Cloud';
    elements.deviceIdStat.textContent = state.deviceId;
    
    log(`Bridge is now ${state.isConnected ? 'ONLINE' : 'OFFLINE'}`, status.connected ? 'success' : 'error');
});

window.electronAPI.onLogUpdate((logData) => {
    log(logData.message, logData.type);
});

window.electronAPI.onJobUpdate((jobData) => {
    state.jobsCount = jobData.totalJobs;
    elements.jobsStat.textContent = state.jobsCount;
    
    addActivity(`Job #${state.jobsCount} relayed to ${jobData.printer}`);
    log(`Printing Job #${state.jobsCount} on ${jobData.printer}`, 'job');
});

// ─── Actions ────────────────────────────────────────────────────────────────
elements.btnToggleConnection.addEventListener('click', () => {
    if (state.isConnected) {
        window.electronAPI.disconnect();
    } else {
        window.electronAPI.connect();
    }
});

elements.btnReconnect.addEventListener('click', () => {
    window.electronAPI.forceReconnect();
    log('Forcing bridge reconnection...', 'system');
});

elements.btnClearLogs.addEventListener('click', () => {
    elements.consoleView.innerHTML = '<div class="log-entry system">Logs cleared.</div>';
});

const btnSaveDeviceId = document.getElementById('btn-save-device-id');
btnSaveDeviceId.addEventListener('click', async () => {
    const input = document.getElementById('config-device-id');
    const newId = input.value.trim();
    
    if (!newId) {
        alert('Please enter a valid Device ID');
        return;
    }
    
    btnSaveDeviceId.disabled = true;
    btnSaveDeviceId.textContent = 'Saving...';
    
    const result = await window.electronAPI.setDeviceId(newId);
    
    if (result.success) {
        input.value = '';
        btnSaveDeviceId.textContent = 'Updated!';
        btnSaveDeviceId.classList.add('success');
        
        log(`Device ID successfully updated to: ${newId}`, 'success');
        
        setTimeout(() => {
            btnSaveDeviceId.disabled = false;
            btnSaveDeviceId.textContent = 'Update Device ID';
            btnSaveDeviceId.classList.remove('success');
        }, 2000);
    }
});

// ─── Printer Management ─────────────────────────────────────────────────────
async function loadPrinters() {
    const data = await window.electronAPI.getPrinters();
    state.printers = data.list;
    state.activePrinter = data.active;
    
    renderPrinters();
    elements.printerStat.textContent = state.activePrinter || 'None';
    loadSystemPrinters(); // Also refresh system list
}

async function loadSystemPrinters() {
    const sysSelect = document.getElementById('system-printer-select');
    if (!sysSelect) return;

    try {
        const printers = await window.electronAPI.getSystemPrinters();
        
        // Handle both single object and array response from PowerShell
        const printerList = Array.isArray(printers) ? printers : [printers];
        
        sysSelect.innerHTML = '<option value="">-- Select Installed Printer --</option>';
        printerList.forEach(p => {
            if (!p || !p.Name) return;
            const opt = document.createElement('option');
            opt.value = p.Name;
            opt.textContent = `${p.Name} ${p.Shared ? '(Shared)' : ''}`;
            sysSelect.appendChild(opt);
        });
    } catch (e) {
        sysSelect.innerHTML = '<option value="">Error loading printers</option>';
    }
}

const btnSetupPrinter = document.getElementById('btn-setup-printer');
btnSetupPrinter.addEventListener('click', async () => {
    const oldName = document.getElementById('system-printer-select').value;
    const newName = document.getElementById('setup-new-name').value.trim();
    
    if (!oldName || !newName) {
        alert('Please select a printer and enter a new name.');
        return;
    }

    btnSetupPrinter.disabled = true;
    btnSetupPrinter.textContent = 'Configuring...';
    
    log(`Starting system setup for ${oldName} → ${newName}`, 'system');
    
    const result = await window.electronAPI.setupLocalPrinter({ oldName, newName });
    
    btnSetupPrinter.disabled = false;
    btnSetupPrinter.textContent = 'Configure & Share Printer';

    if (result.success) {
        document.getElementById('setup-new-name').value = '';
        log('System printer setup successful!', 'success');
        loadPrinters();
    } else {
        alert(`Failed to setup printer: ${result.error}`);
        log(`Setup error: ${result.error}`, 'error');
    }
});

function renderPrinters() {
    elements.printerList.innerHTML = '';
    
    state.printers.forEach(p => {
        const isActive = p === state.activePrinter;
        const div = document.createElement('div');
        div.className = `printer-item ${isActive ? 'active' : ''}`;
        div.innerHTML = `
            <div class="printer-info">
                <span class="p-name">${p}</span>
                <span class="p-status">${isActive ? 'Currently Active' : 'Registered'}</span>
            </div>
            <div class="printer-actions">
                ${isActive 
                    ? '<span class="btn-small active">Active</span>' 
                    : `<button class="btn-small select" onclick="setActivePrinter('${p}')">Select</button>`
                }
                <button class="btn-small delete" onclick="removePrinter('${p}')">Delete</button>
            </div>
        `;
        elements.printerList.appendChild(div);
    });
}

elements.btnAddPrinter.addEventListener('click', async () => {
    const name = elements.newPrinterInput.value.trim();
    if (!name) return;
    
    await window.electronAPI.addPrinter(name);
    elements.newPrinterInput.value = '';
    loadPrinters();
});

window.setActivePrinter = async (name) => {
    await window.electronAPI.setActivePrinter(name);
    loadPrinters();
    log(`Active printer changed to: ${name}`, 'system');
};

window.removePrinter = async (name) => {
    await window.electronAPI.removePrinter(name);
    loadPrinters();
};

// ─── Utilities ──────────────────────────────────────────────────────────────
function log(msg, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${msg}`;
    elements.consoleView.appendChild(entry);
    elements.consoleView.scrollTop = elements.consoleView.scrollHeight;
}

function addActivity(msg) {
    const empty = elements.activityList.querySelector('.empty');
    if (empty) empty.remove();
    
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.textContent = msg;
    
    elements.activityList.prepend(item);
    
    // Keep only last 5
    if (elements.activityList.children.length > 5) {
        elements.activityList.removeChild(elements.activityList.lastChild);
    }
}

// Initial Load
console.log('Checking Electron API:', window.electronAPI);
if (window.electronAPI) {
    loadPrinters();
    log('Dashboard ready.', 'system');
} else {
    log('Error: Electron API not found. Please restart the app.', 'error');
}
