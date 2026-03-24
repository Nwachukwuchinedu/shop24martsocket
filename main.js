const { app, Tray, Menu, nativeImage, Notification, dialog } = require('electron');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

// ─── Hide from taskbar & dock, tray only ───────────────────────────────────
app.dock && app.dock.hide();

// ─── Single instance lock ──────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ─── Logging ──────────────────────────────────────────────────────────────
const logDir = path.join(app.getPath('userData'), 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'bridge.log');

function log(msg) {
    const line = `[${new Date().toLocaleString('en-NG')}] ${msg}\n`;
    fs.appendFileSync(logFile, line);
}

// ─── State ─────────────────────────────────────────────────────────────────
const PORT = 3001;
let wss = null;
let tray = null;
let isRunning = false;
let connectedClients = 0;
let jobsHandled = 0;

// ─── WebSocket Bridge ──────────────────────────────────────────────────────
function startBridge() {
    if (wss) return;

    wss = new WebSocketServer({ port: PORT });
    isRunning = true;

    log(`Bridge started on ws://localhost:${PORT}`);

    wss.on('connection', (ws) => {
        connectedClients++;
        log(`Client connected. (${connectedClients} active)`);
        updateTray();

        ws.on('message', async (message) => {
            try {
                const { buffer: base64, printerName } = JSON.parse(message.toString());

                const targetPrinter = printerName
                    ? `\\\\localhost\\${printerName.replace('POSPrinter ', '')}`
                    : `\\\\localhost\\POS58`;

                log(`Print job #${++jobsHandled} → ${targetPrinter}`);

                const buffer = Buffer.from(base64, 'base64');

                fs.writeFile(targetPrinter, buffer, (err) => {
                    if (err) {
                        log(`Print failed: ${err.message}`);
                        ws.send(JSON.stringify({ ok: false, error: `Print failed: ${err.message}` }));
                        showNotification('Print Failed', err.message, 'error');
                    } else {
                        log(`Job #${jobsHandled} printed successfully.`);
                        ws.send(JSON.stringify({ ok: true }));
                        showNotification('Receipt Printed', `Job #${jobsHandled} sent to printer.`, 'success');
                    }
                });

            } catch (err) {
                log(`Processing error: ${err.message}`);
                ws.send(JSON.stringify({ ok: false, error: err.message }));
            }
        });

        ws.on('close', () => {
            connectedClients = Math.max(0, connectedClients - 1);
            log(`Client disconnected. (${connectedClients} active)`);
            updateTray();
        });

        ws.on('error', (err) => log(`WS error: ${err.message}`));
    });

    wss.on('error', (err) => {
        log(`Server error: ${err.message}`);
        isRunning = false;
        wss = null;
        updateTray();
        if (err.code === 'EADDRINUSE') {
            showNotification('Port In Use', `Port ${PORT} is already in use.`, 'error');
        }
    });

    updateTray();
}

function stopBridge(cb) {
    if (!wss) { cb && cb(); return; }

    log('Stopping bridge...');
    isRunning = false;

    // Close all connections
    wss.clients.forEach(ws => ws.terminate());

    wss.close(() => {
        wss = null;
        connectedClients = 0;
        log('Bridge stopped.');
        updateTray();
        cb && cb();
    });
}

function restartBridge() {
    log('Restarting bridge...');
    stopBridge(() => {
        setTimeout(() => {
            startBridge();
            showNotification('Bridge Restarted', `Listening on ws://localhost:${PORT}`, 'success');
        }, 500);
    });
}

// ─── Notifications ─────────────────────────────────────────────────────────
function showNotification(title, body) {
    if (Notification.isSupported()) {
        new Notification({ title, body, silent: true }).show();
    }
}

// ─── Tray ──────────────────────────────────────────────────────────────────
function getStatusLabel() {
    if (!isRunning) return '⛔  Stopped';
    if (connectedClients > 0) return `🟢  Connected (${connectedClients} client${connectedClients > 1 ? 's' : ''})`;
    return `🟡  Running — waiting for connection`;
}

function updateTray() {
    if (!tray) return;

    const menu = Menu.buildFromTemplate([
        {
            label: 'Shop24Mart Print Bridge',
            enabled: false,
        },
        { type: 'separator' },
        {
            label: getStatusLabel(),
            enabled: false,
        },
        {
            label: `📋  Port: ${PORT}`,
            enabled: false,
        },
        {
            label: `🖨️  Jobs handled: ${jobsHandled}`,
            enabled: false,
        },
        { type: 'separator' },
        {
            label: '▶  Start Bridge',
            enabled: !isRunning,
            click: () => {
                startBridge();
                showNotification('Bridge Started', `Listening on ws://localhost:${PORT}`);
            }
        },
        {
            label: '🔄  Restart Bridge',
            enabled: isRunning,
            click: () => restartBridge()
        },
        {
            label: '⏹  Stop Bridge',
            enabled: isRunning,
            click: () => {
                stopBridge();
                showNotification('Bridge Stopped', 'Print bridge has been stopped.');
            }
        },
        { type: 'separator' },
        {
            label: '📄  View Logs',
            click: () => {
                const { shell } = require('electron');
                shell.openPath(logFile);
            }
        },
        { type: 'separator' },
        {
            label: '✕  Quit',
            click: () => {
                stopBridge(() => app.quit());
            }
        }
    ]);

    tray.setContextMenu(menu);
    tray.setToolTip(
        isRunning
            ? `Shop24Mart Bridge • Running on :${PORT}`
            : 'Shop24Mart Bridge • Stopped'
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
            isRunning
                ? `Running on ws://localhost:${PORT} • ${jobsHandled} jobs`
                : 'Bridge is stopped. Right-click to start.'
        );
    });

    // Auto-start bridge
    startBridge();
    updateTray();

    log('App ready.');
});

app.on('window-all-closed', (e) => e.preventDefault());