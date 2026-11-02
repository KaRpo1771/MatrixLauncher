'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['progress', 'game-log', 'game-exit', 'game-window', 'ms-result', 'fs-change', 'win-state', 'update-state']);

contextBridge.exposeInMainWorld('mm', {
  platform: process.platform,
  invoke: (channel, ...args) => {
    if (!/^[a-z]+:[A-Za-z:]+$/.test(channel)) throw new Error('Недопустимый канал');
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error('Недопустимое событие');
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  }
});
