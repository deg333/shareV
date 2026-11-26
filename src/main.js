'use strict';
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen,
  ipcMain, dialog, clipboard, nativeImage, shell, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// ---------------------------------------------------------------- portable data
function resolveDataDir() {
  let base;
  if (process.env.PORTABLE_EXECUTABLE_DIR) base = process.env.PORTABLE_EXECUTABLE_DIR; // electron-builder portable exe
  else if (app.isPackaged) base = path.dirname(process.execPath);
  else base = path.join(__dirname, '..');
  let dir = path.join(base, 'ShareV-Data');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    dir = path.join(app.getPath('appData'), 'ShareV'); // read-only location: fall back
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
const dataDir = resolveDataDir();
app.setPath('userData', path.join(dataDir, 'profile'));

// ---------------------------------------------------------------- settings
const settingsFile = path.join(dataDir, 'settings.json');
const defaults = {
  hotkeys: {
    fullscreen: 'PrintScreen',
    region: 'CommandOrControl+PrintScreen',
    window: 'Alt+PrintScreen',
    lastRegion: 'CommandOrControl+Shift+PrintScreen',
  },
  saveDir: path.join(dataDir, 'Screenshots'),
  copyToClipboard: false, // copy the raw capture to the clipboard right after capturing
  lastRegion: null, // {x,y,w,h} in desktop DIP coordinates
};
let settings = JSON.parse(JSON.stringify(defaults));
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  settings = { ...settings, ...saved, hotkeys: { ...settings.hotkeys, ...(saved.hotkeys || {}) } };
} catch { /* first run */ }
function saveSettings() {
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
}
saveSettings();

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
});
function notify(body) {
  try { if (Notification.isSupported()) new Notification({ title: 'ShareV', body, silent: true }).show(); } catch { /* ignore */ }
}
const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
const PRELOAD = path.join(__dirname, 'preload.js');

// ---------------------------------------------------------------- capture
async function grabDisplay(display) {
  const f = display.scaleFactor || 1;
  const size = { width: Math.round(display.size.width * f), height: Math.round(display.size.height * f) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  if (!sources.length) throw new Error('No screen sources available');
  let src = sources.find((s) => s.display_id && String(s.display_id) === String(display.id));
  if (!src) {
    const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id);
    src = sources[idx] || sources[0];
  }
  return src.thumbnail;
}

async function activeWindowKey() {
  if (process.platform === 'win32') {
    const script = "Add-Type -Name W -Namespace N -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();'; [N.W]::GetForegroundWindow().ToInt64()";
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 8000);
    return out ? { id: out } : null;
  }
  if (process.platform === 'linux') {
    const out = await run('xdotool', ['getactivewindow']);
    return out ? { id: out } : null;
  }
  if (process.platform === 'darwin') {
    const out = await run('osascript', ['-e',
      'tell application "System Events" to get name of first window of (first application process whose frontmost is true)']);
    return out ? { name: out } : null;
  }
  return null;
}

async function grabActiveWindow() {
  const key = await activeWindowKey();
  if (key) {
    const sources = await desktopCapturer.getSources({
      types: ['window'], thumbnailSize: { width: 4096, height: 4096 }, fetchWindowIcons: false,
    });
    const src = sources.find((s) => (key.id && s.id.split(':')[1] === key.id) || (key.name && s.name === key.name));
    if (src && !src.thumbnail.isEmpty()) return src.thumbnail;
  }
  notify('Could not detect the active window - captured the full screen instead.');
  return grabDisplay(cursorDisplay());
}

function selectRegion(display, image) {
  return new Promise((resolve) => {
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false,
      skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false, show: false,
      enableLargerThanScreen: true, backgroundColor: '#000000',
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
    });
    const id = win.webContents.id;
    let done = false;
    const finish = (rect) => {
      if (done) return;
      done = true;
      overlays.delete(id);
      if (!win.isDestroyed()) win.destroy();
      resolve(rect);
    };
    overlays.set(id, {
      finish,
      payload: { url: 'data:image/jpeg;base64,' + image.toJPEG(92).toString('base64'), w: b.width, h: b.height },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.once('ready-to-show', () => { win.setBounds(b); win.show(); win.focus(); });
    win.on('closed', () => finish(null));
    win.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
  });
}
const overlays = new Map();
ipcMain.handle('overlay:init', (e) => overlays.get(e.sender.id)?.payload);
ipcMain.on('overlay:done', (e, rect) => overlays.get(e.sender.id)?.finish(rect));

function cropDip(image, display, r) {
  const sz = image.getSize();
  const sx = sz.width / display.size.width;
  const sy = sz.height / display.size.height;
  const x = Math.max(0, Math.round(r.x * sx));
  const y = Math.max(0, Math.round(r.y * sy));
  const width = Math.min(sz.width - x, Math.round(r.w * sx));
  const height = Math.min(sz.height - y, Math.round(r.h * sy));
  return width > 0 && height > 0 ? image.crop({ x, y, width, height }) : null;
}

let busy = false;
async function capture(mode) {
  if (busy) return;
  busy = true;
  const hidden = BrowserWindow.getAllWindows().filter((w) => w.isVisible());
  hidden.forEach((w) => w.hide());
  let img = null;
  try {
    await sleep(process.platform === 'win32' ? 250 : 400);
    if (mode === 'full') {
      img = await grabDisplay(cursorDisplay());
    } else if (mode === 'window') {
      img = await grabActiveWindow();
    } else if (mode === 'region' || (mode === 'lastRegion' && !settings.lastRegion)) {
      const disp = cursorDisplay();
      const full = await grabDisplay(disp);
      const r = await selectRegion(disp, full);
      if (r && r.w > 1 && r.h > 1) {
        img = cropDip(full, disp, r);
        settings.lastRegion = { x: disp.bounds.x + r.x, y: disp.bounds.y + r.y, w: r.w, h: r.h };
        saveSettings();
      }
    } else if (mode === 'lastRegion') {
      const lr = settings.lastRegion;
      const disp = screen.getDisplayMatching({ x: lr.x, y: lr.y, width: lr.w, height: lr.h });
      const full = await grabDisplay(disp);
      img = cropDip(full, disp, { x: lr.x - disp.bounds.x, y: lr.y - disp.bounds.y, w: lr.w, h: lr.h });
    }
  } catch (err) {
    dialog.showErrorBox('ShareV capture failed', String(err && err.message || err));
  } finally {
    hidden.forEach((w) => { if (!w.isDestroyed()) w.showInactive(); });
    busy = false;
  }
  if (img && !img.isEmpty()) {
    if (settings.copyToClipboard) clipboard.writeImage(img);
    openEditor({ dataURL: img.toDataURL() });
  }
}

// ---------------------------------------------------------------- editor windows
const editors = new Map(); // webContents.id -> {win, payload, filePath, empty}
function openEditor(payload) {
  for (const [, ed] of editors) {
    if (ed.empty && !ed.win.isDestroyed() && payload) {
      ed.empty = false;
      ed.payload = payload;
      ed.win.webContents.send('editor:load', payload);
      ed.win.show(); ed.win.focus();
      return ed;
    }
  }
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 760, minHeight: 480, title: 'ShareV', autoHideMenuBar: true,
    backgroundColor: '#1e1f22', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  const id = win.webContents.id;
  const ed = { win, payload: payload || null, filePath: null, empty: !payload };
  editors.set(id, ed);
  win.on('closed', () => editors.delete(id));
  win.loadFile(path.join(__dirname, 'editor', 'index.html'));
  return ed;
}
const edOf = (e) => editors.get(e.sender.id);
const stamp = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `ShareV_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
function ensureSaveDir() {
  try { fs.mkdirSync(settings.saveDir, { recursive: true }); } catch { /* ignore */ }
  return settings.saveDir;
}

ipcMain.handle('editor:init', (e) => edOf(e)?.payload || null);
ipcMain.on('editor:state', (e, empty) => { const ed = edOf(e); if (ed) ed.empty = !!empty; });
ipcMain.on('editor:title', (e, t) => { const ed = edOf(e); if (ed) ed.win.setTitle(t); });
ipcMain.on('capture', (e, mode) => capture(mode));
ipcMain.on('open-folder', () => shell.openPath(ensureSaveDir()));

ipcMain.handle('save-svg', async (e, { svg, saveAs }) => {
  const ed = edOf(e);
  if (!ed) return null;
  let target = ed.filePath;
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(ed.win, {
      defaultPath: path.join(ensureSaveDir(), stamp() + '.svg'),
      filters: [{ name: 'SVG image', extensions: ['svg'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, svg, 'utf8');
  ed.filePath = target;
  return target;
});

ipcMain.handle('export-png', async (e, dataURL) => {
  const ed = edOf(e);
  const r = await dialog.showSaveDialog(ed.win, {
    defaultPath: path.join(ensureSaveDir(), stamp() + '.png'),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, nativeImage.createFromDataURL(dataURL).toPNG());
  return r.filePath;
});

ipcMain.handle('copy-png', (e, dataURL) => { clipboard.writeImage(nativeImage.createFromDataURL(dataURL)); return true; });

ipcMain.handle('open-file', async (e) => {
  const ed = edOf(e);
  const r = await dialog.showOpenDialog(ed.win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['svg', 'png', 'jpg', 'jpeg', 'bmp', 'webp'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  if (/\.svg$/i.test(file)) {
    ed.filePath = file;
    return { kind: 'svg', text: fs.readFileSync(file, 'utf8'), name: path.basename(file) };
  }
  return { kind: 'image', dataURL: nativeImage.createFromPath(file).toDataURL(), name: path.basename(file) };
});

// ---------------------------------------------------------------- tray + hotkeys
let tray = null;
const labels = { full: 'Capture full screen', region: 'Capture region', window: 'Capture active window', lastRegion: 'Capture last region' };
const hk = (k) => settings.hotkeys[k];

function buildTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 20, height: 20 });
    tray = new Tray(icon);
    tray.setToolTip('ShareV');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `${labels.full}\t${hk('fullscreen')}`, click: () => capture('full') },
      { label: `${labels.window}\t${hk('window')}`, click: () => capture('window') },
      { label: `${labels.region}\t${hk('region')}`, click: () => capture('region') },
      { label: `${labels.lastRegion}\t${hk('lastRegion')}`, click: () => capture('lastRegion') },
      { type: 'separator' },
      { label: 'Open editor', click: () => openEditor(null) },
      { label: 'Open screenshots folder', click: () => shell.openPath(ensureSaveDir()) },
      { label: 'Open data folder (settings.json)', click: () => shell.openPath(dataDir) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', () => openEditor(null));
  } catch { tray = null; }
}

function registerHotkeys() {
  const map = { fullscreen: 'full', region: 'region', window: 'window', lastRegion: 'lastRegion' };
  const failed = [];
  for (const [key, mode] of Object.entries(map)) {
    const acc = hk(key);
    if (!acc) continue;
    let ok = false;
    try { ok = globalShortcut.register(acc, () => capture(mode)); } catch { ok = false; }
    if (!ok) failed.push(acc);
  }
  if (failed.length) notify(`Could not register hotkeys: ${failed.join(', ')} (already in use?). Edit settings.json to change them.`);
}

// ---------------------------------------------------------------- lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    if (w) { w.show(); w.focus(); } else openEditor(null);
  });
  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
      Menu.setApplicationMenu(null);
    }
    buildTray();
    registerHotkeys();
    if (!process.argv.includes('--tray') || !tray) openEditor(null);
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
