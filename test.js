const WebSocket = require('ws');

const CLOUD_URL = 'wss://untrellised-snakily-dollie.ngrok-free.dev';
const SECRET_TOKEN = 'shop24mart-secure-token';
const DEVICE_ID = require('os').hostname() || 'shop-device-1'; // Match what Electron uses

const ws = new WebSocket(CLOUD_URL);

ws.on('open', () => {
    console.log('Connected to relay server.');

    // Simulate a website sending a print job
    const printJob = {
        type: 'print',
        deviceId: DEVICE_ID,
        token: SECRET_TOKEN,
        buffer: Buffer.from('SHOP24MART TEST PRINT\r\n---------------------\r\nHello from Cloud!\r\nDate: ' + new Date().toLocaleString() + '\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\x1d\x56\x42\x00').toString('base64'),
        printerName: 'POS58'
    };

    console.log(`Sending print job to ${DEVICE_ID}...`);
    ws.send(JSON.stringify(printJob));
});

ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('Received from server:', message);
    if (message.status === 'relayed') {
        console.log('Success! Job relayed.');
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.error('Error:', err.message);
});

setTimeout(() => {
    console.log('Timed out waiting for response.');
    process.exit(1);
}, 5000);
