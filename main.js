import { app, Tray, Menu, nativeImage, Notification, BrowserWindow, ipcMain } from 'electron';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── App Directories ───────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DATA, 'config.json');
const LOG_FILE = path.join(USER_DATA, 'bridge.log');

// ─── Default Config ────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    deviceId: os.hostname() || 'shop-device-1',
    cloudUrl: 'wss://desktop-app-p9b4.onrender.com',
    token: 'BLkXnNZjUqv-P2sR2IbCUkhfC3s7wzukYhjBvTv5NNxY8D7fgUobCETW4Ft-HqcK8VPKWTIHbY7gRsYUsBVidNg',
    printers: ['POS58'],
    activePrinter: 'POS58'
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
        height: 700,
        backgroundColor: '#0f172a',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

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
        config.activePrinter = config.printers[0] || 'POS58';
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
function updateTray() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        { label: `Shop24Mart Bridge: ${isConnected ? 'Online' : 'Offline'}`, enabled: false },
        { label: `Device: ${config.deviceId}`, enabled: false },
        { type: 'separator' },
        { label: 'Open Dashboard', click: () => { if (!mainWindow) createWindow(); else mainWindow.focus(); } },
        { label: isConnected ? 'Disconnect' : 'Connect', click: () => isConnected ? disconnectCloud() : connectToCloud() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);
}

function showNotification(title, body) {
    new Notification({ title, body, silent: true }).show();
}

app.whenReady().then(() => {
    loadConfig();
    
    // Create Tray
    const iconPath = path.join(__dirname, 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Shop24Mart Print Bridge');
    
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