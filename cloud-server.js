const { WebSocketServer } = require('ws');
const http = require('http');

// Configuration
const PORT = process.env.PORT || 3001;
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'shop24mart-secure-token';

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Shop24Mart Print Relay Server is running.');
});

const wss = new WebSocketServer({ server });

// Map to store connected devices: deviceId -> WebSocket
const devices = new Map();

console.log(`[${new Date().toISOString()}] Relay server starting on port ${PORT}`);

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    let currentDeviceId = null;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            // 1. Register Device
            if (data.type === 'register') {
                if (data.token !== SECRET_TOKEN) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Invalid token' }));
                    return ws.terminate();
                }
                
                currentDeviceId = data.deviceId;
                devices.set(currentDeviceId, ws);
                console.log(`[${new Date().toISOString()}] Device registered: ${currentDeviceId}`);
                ws.send(JSON.stringify({ type: 'registered', deviceId: currentDeviceId }));
            }

            // 2. Relay Print Job (from Website/Phone)
            if (data.type === 'print') {
                const targetId = data.deviceId;
                const targetWs = devices.get(targetId);

                if (targetWs && targetWs.readyState === 1) {
                    console.log(`[${new Date().toISOString()}] Relaying job to: ${targetId}`);
                    targetWs.send(JSON.stringify({
                        type: 'print_job',
                        buffer: data.buffer,
                        printerName: data.printerName
                    }));
                    ws.send(JSON.stringify({ type: 'print_status', status: 'relayed', deviceId: targetId }));
                } else {
                    console.log(`[${new Date().toISOString()}] Target device offline: ${targetId}`);
                    ws.send(JSON.stringify({ type: 'error', message: `Device ${targetId} is offline` }));
                }
            }

        } catch (err) {
            console.error(`[${new Date().toISOString()}] Error processing message:`, err.message);
        }
    });

    ws.on('close', () => {
        if (currentDeviceId) {
            devices.delete(currentDeviceId);
            console.log(`[${new Date().toISOString()}] Device disconnected: ${currentDeviceId}`);
        }
    });

    ws.on('error', (err) => {
        console.error(`[${new Date().toISOString()}] WS error:`, err.message);
    });
});

// Heartbeat interval
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

server.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Relay server listening on http://localhost:${PORT}`);
});
