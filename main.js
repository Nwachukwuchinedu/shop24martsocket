import { app, Tray, Menu, nativeImage, Notification, dialog } from 'electron';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Hide from taskbar & dock, tray only ───────────────────────────────────
if (app.dock) app.dock.hide();

// ─── Single instance lock ──────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ─── Configuration ────────────────────────────────────────────────────────
// Use computer name as default device ID if not specified
const DEVICE_ID = process.env.DEVICE_ID || 'shop-device-1';
const CLOUD_URL = process.env.CLOUD_URL || 'wss://desktop-app-p9b4.onrender.com';
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'BLkXnNZjUqv-P2sR2IbCUkhfC3s7wzukYhjBvTv5NNxY8D7fgUobCETW4Ft-HqcK8VPKWTIHbY7gRsYUsBVidNg';

// ─── Logging ──────────────────────────────────────────────────────────────
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'bridge.log');

function log(msg) {
    const line = `[${new Date().toLocaleString('en-NG')}] ${msg}\n`;
    fs.appendFileSync(logFile, line);
    console.log(msg);
}

// ─── State ─────────────────────────────────────────────────────────────────
let ws = null;
let tray = null;
let isConnected = false;
let isConnecting = false;
let jobsHandled = 0;
let reconnectTimeout = null;

// ─── WebSocket Client ──────────────────────────────────────────────────────
function connectToCloud() {
    if (ws || isConnecting) return;

    isConnecting = true;
    updateTray();
    
    log(`Connecting to cloud: ${CLOUD_URL}...`);

    ws = new WebSocket(CLOUD_URL);

    ws.on('open', () => {
        isConnecting = false;
        isConnected = true;
        log(`Connected to cloud. Registering as ${DEVICE_ID}...`);
        
        // Register device
        ws.send(JSON.stringify({
            type: 'register',
            deviceId: DEVICE_ID,
            token: SECRET_TOKEN
        }));
        
        updateTray();
        showNotification('Bridge Connected', `Linked to cloud as: ${DEVICE_ID}`);
    });

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            log(`Received: ${message.type || 'unknown'}`);

            if (message.type === 'registered') {
                log(`Device registration confirmed: ${message.deviceId}`);
            }

            if (message.type === 'print_job') {
                handlePrintJob(message);
            }

            if (message.type === 'error') {
                log(`Server error: ${message.message}`);
                showNotification('Cloud Error', message.message);
            }

        } catch (err) {
            log(`Message parse error: ${err.message}`);
        }
    });

    ws.on('close', () => {
        isConnected = false;
        isConnecting = false;
        ws = null;
        log('Disconnected from cloud. Retrying in 5s...');
        updateTray();
        
        // Auto-reconnect
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(() => {
                reconnectTimeout = null;
                connectToCloud();
            }, 5000);
        }
    });

    ws.on('error', (err) => {
        log(`WS error: ${err.message}`);
        isConnecting = false;
        updateTray();
    });

    // Heartbeat: Response to server ping
    ws.on('ping', () => {
        ws.pong();
    });
}

function handlePrintJob(job) {
    try {
        const { buffer: base64, printerName } = job;

        // Windows thermal printer path hack
        const cleanPrinterName = (printerName || 'POS58').replace('POSPrinter ', '');
        const targetPrinter = `\\\\${os.hostname()}\\${cleanPrinterName}`;

        log(`Print job #${++jobsHandled} → ${targetPrinter}`);

        const buffer = Buffer.from(base64, 'base64');

        fs.writeFile(targetPrinter, buffer, (err) => {
            if (err) {
                log(`Print failed: ${err.message}`);
                showNotification('Print Failed', err.message);
            } else {
                log(`Job #${jobsHandled} printed successfully.`);
                showNotification('Receipt Printed', `Job #${jobsHandled} sent to printer.`);
            }
            updateTray();
        });

    } catch (err) {
        log(`Processing error: ${err.message}`);
    }
}

function disconnectCloud() {
    if (ws) {
        log('Closing connection...');
        ws.close();
        ws = null;
    }
    isConnected = false;
    isConnecting = false;
    updateTray();
}

// ─── Notifications ─────────────────────────────────────────────────────────
function showNotification(title, body) {
    if (Notification.isSupported()) {
        new Notification({ title, body, silent: true }).show();
    }
}

// ─── Tray ──────────────────────────────────────────────────────────────────
function getStatusLabel() {
    if (isConnecting) return '🟡  Connecting...';
    if (isConnected) return `🟢  Online: ${DEVICE_ID}`;
    return `⛔  Offline (Disconnected)`;
}

function updateTray() {
    if (!tray) return;

    const menu = Menu.buildFromTemplate([
        {
            label: 'Shop24Mart Print Bridge (Cloud)',
            enabled: false,
        },
        { type: 'separator' },
        {
            label: getStatusLabel(),
            enabled: false,
        },
        {
            label: `🆔  Device: ${DEVICE_ID}`,
            enabled: false,
        },
        {
            label: `🖨️  Jobs handled: ${jobsHandled}`,
            enabled: false,
        },
        { type: 'separator' },
        {
            label: '▶  Connect to Cloud',
            enabled: !isConnected && !isConnecting,
            click: () => connectToCloud()
        },
        {
            label: '🔄  Force Reconnect',
            enabled: true,
            click: () => {
                disconnectCloud();
                setTimeout(connectToCloud, 1000);
            }
        },
        {
            label: '⏹  Disconnect',
            enabled: isConnected || isConnecting,
            click: () => disconnectCloud()
        },
        { type: 'separator' },
        {
            label: '📄  View Logs',
            click: () => {
                import('electron').then(({ shell }) => {
                    shell.openPath(logFile);
                });
            }
        },
        { type: 'separator' },
        {
            label: '✕  Quit',
            click: () => {
                disconnectCloud();
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(menu);
    tray.setToolTip(
        isConnected
            ? `Shop24Mart Bridge • Online as ${DEVICE_ID}`
            : 'Shop24Mart Bridge • Offline'
    );
}

// ─── App Ready ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    app.setAppUserModelId('Shop24Mart Print Bridge');

    // Build tray icon
    const iconPath = path.join(__dirname, 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    tray.setToolTip('Shop24Mart Print Bridge');

    // Left click → show balloon
    tray.on('click', () => {
        showNotification(
            'Shop24Mart Print Bridge',
            isConnected
                ? `Connected to cloud as: ${DEVICE_ID}`
                : 'Bridge is offline. Right-click to connect.'
        );
    });

    // Auto-connect
    connectToCloud();
    updateTray();

    log('App ready.');
});

app.on('window-all-closed', (e) => e.preventDefault());