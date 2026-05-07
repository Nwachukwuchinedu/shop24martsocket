import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    // Connection controls
    connect: () => ipcRenderer.send('bridge:connect'),
    disconnect: () => ipcRenderer.send('bridge:disconnect'),
    forceReconnect: () => ipcRenderer.send('bridge:reconnect'),

    // Printer management
    getPrinters: () => ipcRenderer.invoke('printers:get'),
    addPrinter: (name) => ipcRenderer.invoke('printers:add', name),
    removePrinter: (name) => ipcRenderer.invoke('printers:remove', name),
    setActivePrinter: (name) => ipcRenderer.invoke('printers:set-active', name),

    // State listeners
    onStatusUpdate: (callback) => ipcRenderer.on('status:update', (_event, value) => callback(value)),
    onLogUpdate: (callback) => ipcRenderer.on('log:update', (_event, value) => callback(value)),
    onJobUpdate: (callback) => ipcRenderer.on('job:update', (_event, value) => callback(value))
});
