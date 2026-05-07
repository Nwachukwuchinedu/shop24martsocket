import WebSocket from 'ws';
import os from 'os';

const CLOUD_URL = 'wss://desktop-app-p9b4.onrender.com';
const SECRET_TOKEN = 'BLkXnNZjUqv-P2sR2IbCUkhfC3s7wzukYhjBvTv5NNxY8D7fgUobCETW4Ft-HqcK8VPKWTIHbY7gRsYUsBVidNg';
const DEVICE_ID = ''; // Set manually for testing

const ws = new WebSocket(CLOUD_URL);

ws.on('open', () => {
    console.log('Connected to relay server.');

    // Simulate a website sending a print job
    const printJob = {
        type: 'print',
        deviceId: DEVICE_ID,
        token: SECRET_TOKEN,
        buffer: Buffer.from('SHOP24MART TEST PRINT\r\n---------------------\r\nHello from Cloud!\r\nDate: ' + new Date().toLocaleString() + '\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\x1d\x56\x42\x00').toString('base64'),
        printerName: ''
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
