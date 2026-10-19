import { app, Tray, Menu, nativeImage, Notification, BrowserWindow, ipcMain } from 'electron';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Branding & Identity ───────────────────────────────────────────────────
app.setAppUserModelId('com.shop24mart.printbridge');
const ICON_PATH = path.join(__dirname, 'icon.ico');

// ─── App Directories ───────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DATA, 'config.json');
const LOG_FILE = path.join(USER_DATA, 'bridge.log');

// ─── Default Config ────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    deviceId: '', // User will set this
    cloudUrl: 'wss://print.shop24mart.com',
    token: 'BLkXnNZjUqv-P2sR2IbCUkhfC3s7wzukYhjBvTv5NNxY8D7fgUobCETW4Ft-HqcK8VPKWTIHbY7gRsYUsBVidNg',
    printers: [],
    activePrinter: null
};

// ─── State ─────────────────────────────────────────────────────────────────
let config = { ...DEFAULT_CONFIG };
let mainWindow = null;
let tray = null;
let ws = null;
let isConnected = false;
let isConnecting = false;
let jobsHandled = 0;
let reconnectTimeout = null;

// ─── Load/Save Config ──────────────────────────────────────────────────────
function loadConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            config = { ...DEFAULT_CONFIG, ...data };
            // Update cloud URL if it doesn't match the new default
            if (config.cloudUrl !== DEFAULT_CONFIG.cloudUrl) {
                config.cloudUrl = DEFAULT_CONFIG.cloudUrl;
                saveConfig();
            }
        } catch (e) {
            console.error('Failed to load config, using defaults');
        }
    } else {
        saveConfig();
    }
}

function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── Logging ──────────────────────────────────────────────────────────────
function logToUI(message, type = 'system') {
    if (mainWindow) {
        mainWindow.webContents.send('log:update', { message, type });
    }
    const line = `[${new Date().toLocaleString('en-NG')}] [${type.toUpperCase()}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line);
    console.log(line.trim());
}

// ─── WebSocket Bridge Logic ────────────────────────────────────────────────
function connectToCloud() {
    if (ws || isConnecting) return;
    
    if (!config.deviceId) {
        logToUI('Cannot connect: Device ID not set. Please set it in Printer Settings.', 'error');
        isConnecting = false;
        updateUIState();
        return;
    }

    isConnecting = true;
    updateUIState();
    
    logToUI(`Connecting to cloud: ${config.cloudUrl}...`, 'system');

    const socket = new WebSocket(config.cloudUrl);
    ws = socket;

    socket.on('open', () => {
        isConnecting = false;
        isConnected = true;
        logToUI(`Connected to cloud as ${config.deviceId}`, 'success');
        
        socket.send(JSON.stringify({
            type: 'register',
            deviceId: config.deviceId,
            token: config.token
        }));
        
        updateUIState();
        showNotification('Bridge Online', `Connected as ${config.deviceId}`);
    });

    socket.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());

            if (message.type === 'print_job') {
                handlePrintJob(message);
            }

            if (message.type === 'error') {
                logToUI(`Server Error: ${message.message}`, 'error');
            }

        } catch (err) {
            logToUI(`Message error: ${err.message}`, 'error');
        }
    });

    socket.on('close', () => {
        isConnected = false;
        isConnecting = false;
        if (ws === socket) ws = null;
        logToUI('Disconnected from cloud. Retrying...', 'error');
        updateUIState();
        
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(() => {
                reconnectTimeout = null;
                connectToCloud();
            }, 5000);
        }
    });

    socket.on('error', (err) => {
        logToUI(`Connection error: ${err.message}`, 'error');
        isConnecting = false;
        updateUIState();
    });

    socket.on('ping', () => socket.pong());
}

function handlePrintJob(job) {
    try {
        if (!config.activePrinter) {
            logToUI('Print job ignored: No active printer selected.', 'error');
            return;
        }

        const { buffer: base64 } = job;
        const targetPrinter = `\\\\${os.hostname()}\\${config.activePrinter}`;

        logToUI(`New Job Incoming → ${config.activePrinter}`, 'job');

        const buffer = Buffer.from(base64, 'base64');

        fs.writeFile(targetPrinter, buffer, (err) => {
            if (err) {
                logToUI(`Print failed: ${err.message}`, 'error');
                showNotification('Print Failed', err.message);
            } else {
                jobsHandled++;
                logToUI(`Job #${jobsHandled} printed successfully.`, 'success');
                if (mainWindow) {
                    mainWindow.webContents.send('job:update', { 
                        totalJobs: jobsHandled, 
                        printer: config.activePrinter 
                    });
                }
            }
        });

    } catch (err) {
        logToUI(`Processing error: ${err.message}`, 'error');
    }
}

function disconnectCloud() {
    if (ws) {
        ws.close();
        ws = null;
    }
    isConnected = false;
    isConnecting = false;
    updateUIState();
    logToUI('Bridge disconnected manually.', 'system');
}

// ─── UI & IPC ──────────────────────────────────────────────────────────────
function updateUIState() {
    if (mainWindow) {
        mainWindow.webContents.send('status:update', {
            connected: isConnected,
            connecting: isConnecting,
            deviceId: config.deviceId
        });
    }
    updateTray();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        minWidth: 800,
        minHeight: 600,
        icon: ICON_PATH,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        backgroundColor: '#0f172a',
        title: 'Shop24Mart Print Suite'
    });

    // Remove the default "File, Edit, View" menu
    Menu.setApplicationMenu(null);
    
    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        updateUIState();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────
ipcMain.on('bridge:connect', connectToCloud);
ipcMain.on('bridge:disconnect', disconnectCloud);
ipcMain.on('bridge:reconnect', () => {
    disconnectCloud();
    setTimeout(connectToCloud, 1000);
});

ipcMain.handle('device:set-id', (event, id) => {
    config.deviceId = id;
    saveConfig();
    logToUI(`Device ID updated to: ${id}`, 'system');
    
    // Update UI and trigger connection
    updateUIState();
    connectToCloud();
    
    return { success: true };
});

ipcMain.handle('system-printers:get', async () => {
    try {
        const { stdout } = await execAsync('powershell "Get-Printer | Select-Object Name, Shared, ShareName | ConvertTo-Json"');
        return JSON.parse(stdout);
    } catch (e) {
        console.error('Failed to get system printers', e);
        return [];
    }
});

ipcMain.handle('printer:setup-local', async (event, { oldName, newName }) => {
    try {
        logToUI(`Starting configuration for: ${oldName} → ${newName}`, 'system');
        
        // 1. Rename Printer
        const renameCmd = `powershell -Command "Rename-Printer -Name '${oldName}' -NewName '${newName}'"`;
        await execAsync(renameCmd);
        logToUI(`Printer renamed to ${newName}`, 'success');

        // 2. Enable Sharing and set Share Name
        const shareCmd = `powershell -Command "Set-Printer -Name '${newName}' -Shared $true -ShareName '${newName}'"`;
        await execAsync(shareCmd);
        logToUI(`Printer shared as ${newName}`, 'success');

        // 3. Update our internal bridge config
        if (!config.printers.includes(newName)) {
            config.printers.push(newName);
        }
        config.activePrinter = newName;
        saveConfig();

        return { success: true };
    } catch (e) {
        logToUI(`Setup failed: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
});

ipcMain.handle('printer:test', async (event, name) => {
    return new Promise((resolve) => {
        try {
            const targetPrinter = `\\\\${os.hostname()}\\${name}`;
            const testText = "SHOP24MART PRINT SUITE\n====================\n\n*** TEST PRINT SUCCESSFUL ***\n\nPrinter: " + name + "\nTime: " + new Date().toLocaleString() + "\n\n\n\n\n\n";
            
            // ESC @ (Init) + Text + GS V 0 (Cut)
            const buffer = Buffer.concat([
                Buffer.from([0x1B, 0x40]), 
                Buffer.from(testText),
                Buffer.from([0x1D, 0x56, 0x00])
            ]);

            fs.writeFile(targetPrinter, buffer, (err) => {
                if (err) {
                    logToUI(`Test print error on ${name}: ${err.message}`, 'error');
                    resolve({ success: false, error: err.message });
                } else {
                    logToUI(`Test print successful on ${name}`, 'success');
                    resolve({ success: true });
                }
            });
        } catch (err) {
            resolve({ success: false, error: err.message });
        }
    });
});


ipcMain.handle('printers:get', () => ({
    list: config.printers,
    active: config.activePrinter
}));

ipcMain.handle('printers:add', (event, name) => {
    if (!config.printers.includes(name)) {
        config.printers.push(name);
        saveConfig();
        logToUI(`Added printer: ${name}`, 'system');
    }
    return config.printers;
});

ipcMain.handle('printers:remove', (event, name) => {
    config.printers = config.printers.filter(p => p !== name);
    if (config.activePrinter === name) {
        config.activePrinter = config.printers[0];
    }
    saveConfig();
    logToUI(`Removed printer: ${name}`, 'system');
    return config.printers;
});

ipcMain.handle('printers:set-active', (event, name) => {
    config.activePrinter = name;
    saveConfig();
    logToUI(`Switched active printer to: ${name}`, 'system');
    return true;
});

// ─── Tray & App Lifecycle ──────────────────────────────────────────────────
let isQuitting = false;

function updateTray() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        { label: `Shop24Mart Bridge: ${isConnected ? 'Online' : 'Offline'}`, enabled: false },
        { label: `Device: ${config.deviceId || 'Not Set'}`, enabled: false },
        { type: 'separator' },
        { label: 'Open Dashboard', click: () => mainWindow?.show() },
        { 
            label: isConnected ? 'Disconnect' : 'Connect', 
            click: () => isConnected ? disconnectCloud() : connectToCloud() 
        },
        { type: 'separator' },
        { label: 'Quit', click: () => {
            isQuitting = true;
            app.quit();
        }}
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip('Shop24Mart Print Bridge');
}

function createTray() {
    const icon = nativeImage.createFromPath(ICON_PATH);
    tray = new Tray(icon);
    updateTray();
}

function showNotification(title, body) {
    new Notification({ title, body, silent: true }).show();
}

app.whenReady().then(() => {
    loadConfig();
    createTray();
    createWindow();
    connectToCloud();
});

app.on('window-all-closed', () => {
    // Keep running in tray on macOS, but for Windows we usually want to keep it too
    // unless explicitly quit.
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});