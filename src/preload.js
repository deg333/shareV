'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // capture
  capture: (mode) => ipcRenderer.send('capture', mode),
  // editor
  init: () => ipcRenderer.invoke('editor:init'),
  onLoad: (cb) => ipcRenderer.on('editor:load', (_e, p) => cb(p)),
  setEmpty: (empty) => ipcRenderer.send('editor:state', empty),
  setTitle: (t) => ipcRenderer.send('editor:title', t),
  saveSvg: (svg, saveAs) => ipcRenderer.invoke('save-svg', { svg, saveAs }),
  exportPng: (dataURL) => ipcRenderer.invoke('export-png', dataURL),
  copyPng: (dataURL) => ipcRenderer.invoke('copy-png', dataURL),
  openFile: () => ipcRenderer.invoke('open-file'),
  openFolder: () => ipcRenderer.send('open-folder'),
  // region overlay
  overlayInit: () => ipcRenderer.invoke('overlay:init'),
  overlayDone: (rect) => ipcRenderer.send('overlay:done', rect),
});
