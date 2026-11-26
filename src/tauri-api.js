'use strict';
// Bridges the editor/overlay pages to the Rust backend (src-tauri/src/main.rs).
// Exposes the same `window.api` surface the pages expect.
(() => {
  if (window.api || !window.__TAURI__) return; // tests stub window.api; plain browsers have no Tauri
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  window.api = {
    capture: (mode) => invoke('capture', { mode }),
    init: () => invoke('editor_init'),
    onLoad: (cb) => listen('editor-load', (e) => cb(e.payload)),
    setEmpty: (empty) => invoke('editor_state', { empty }),
    setTitle: (title) => invoke('editor_title', { title }),
    saveSvg: (svg, saveAs) => invoke('save_svg', { svg, saveAs: !!saveAs }),
    exportPng: (dataUrl) => invoke('export_png', { dataUrl }),
    copyPng: (dataUrl) => invoke('copy_png', { dataUrl }),
    openFile: () => invoke('open_file'),
    openFolder: () => invoke('open_folder'),
    ocr: (dataUrl) => invoke('ocr', { dataUrl }),
    copyText: (text) => invoke('copy_text', { text }),
    loadUi: () => invoke('ui_load'),
    saveUi: (json) => invoke('ui_save', { json }),
    exportUi: (json) => invoke('ui_export', { json }),
    importUi: () => invoke('ui_import'),
    overlayInit: () => invoke('overlay_init'),
    overlayDone: (rect) => invoke('overlay_done', { rect: rect ? { ...rect, vw: window.innerWidth } : null }),
  };
})();
