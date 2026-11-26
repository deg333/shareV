'use strict';
/* ShareV editor: every annotation is a plain data object that is rendered to SVG markup.
   The saved .svg contains the screenshot as an <image> plus real vector elements, and a
   <metadata id="sharev-data"> block so the file can be re-opened and edited again. */

const $ = (id) => document.getElementById(id);
const svg = $('svg'), ann = $('ann'), ui = $('ui'), bgImg = $('bg'), wrap = $('wrap'), stage = $('stage');
const ta = $('edit');
const FONT = "'Segoe UI', Helvetica, Arial, sans-serif";
const PAD = 8;
const BOX = new Set(['rect', 'ellipse', 'textbox', 'balloon', 'highlight']);
const TEXTY = new Set(['text', 'textbox', 'balloon']);

const state = {
  w: 0, h: 0, bg: '', shapes: [], sel: null, tool: 'select', zoom: 1,
  undo: [], redo: [], nextId: 1, name: '', loaded: false,
};
window.__state = state; // handy for tests / debugging

// ------------------------------------------------------------------ utils
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(n * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snapshot = () => JSON.stringify(state.shapes, (k, v) => (k[0] === '_' ? undefined : v));
const byId = (id) => state.shapes.find((s) => s.id === id);
const mctx = document.createElement('canvas').getContext('2d');
function measure(text, size, bold) {
  mctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  return mctx.measureText(text).width;
}
function wrapText(text, maxW, size, bold) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? line + ' ' + word : word;
      if (measure(cand, size, bold) <= maxW) { line = cand; continue; }
      if (line) { out.push(line); line = ''; }
      if (measure(word, size, bold) <= maxW) { line = word; continue; }
      let chunk = '';
      for (const ch of word) {
        if (chunk && measure(chunk + ch, size, bold) > maxW) { out.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}
const lineH = (s) => s.size * 1.25;

function layout(s) {
  if (s.type === 'text') {
    s._lines = String(s.text).split('\n');
  } else if (s.type === 'textbox' || s.type === 'balloon') {
    s._lines = wrapText(s.text, Math.max(10, s.w - 2 * PAD), s.size, s.bold);
    s.h = Math.max(s.h, s._lines.length * lineH(s) + 2 * PAD);
  }
}

function bounds(s) {
  if (BOX.has(s.type)) { layout(s); return { x: s.x, y: s.y, w: s.w, h: s.h }; }
  if (s.type === 'line' || s.type === 'arrow') {
    return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  }
  if (s.type === 'pen') {
    const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  layout(s); // text
  const w = Math.max(10, ...s._lines.map((l) => measure(l, s.size, s.bold)));
  return { x: s.x, y: s.y, w, h: s._lines.length * lineH(s) };
}

// ------------------------------------------------------------------ SVG generation
function textEls(s, x, y) {
  if (s._editing || !s.text) return '';
  const first = y + s.size * 0.95;
  const tsp = s._lines.map((l, i) => `<tspan x="${num(x)}" y="${num(first + i * lineH(s))}">${esc(l) || ' '}</tspan>`).join('');
  return `<text font-family="${esc(FONT)}" font-size="${s.size}"${s.bold ? ' font-weight="bold"' : ''} fill="${s.tc}" xml:space="preserve">${tsp}</text>`;
}

function balloonPath(s) {
  const { x, y, w, h } = s;
  const r = Math.min(12, w / 2, h / 2);
  const tx = s.tx, ty = s.ty;
  const inside = tx >= x && tx <= x + w && ty >= y && ty <= y + h;
  const dx = (tx - (x + w / 2)) / w, dy = (ty - (y + h / 2)) / h;
  const side = inside ? '' : Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'b' : 't') : (dx > 0 ? 'r' : 'l');
  const bwH = Math.max(1, Math.min(14, (w - 2 * r) / 4)), bwV = Math.max(1, Math.min(14, (h - 2 * r) / 4));
  const cx = clamp(tx, x + r + bwH, x + w - r - bwH), cy = clamp(ty, y + r + bwV, y + h - r - bwV);
  let d = `M${x + r} ${y}`;
  if (side === 't') d += `L${cx - bwH} ${y}L${tx} ${ty}L${cx + bwH} ${y}`;
  d += `L${x + w - r} ${y}Q${x + w} ${y} ${x + w} ${y + r}`;
  if (side === 'r') d += `L${x + w} ${cy - bwV}L${tx} ${ty}L${x + w} ${cy + bwV}`;
  d += `L${x + w} ${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}`;
  if (side === 'b') d += `L${cx + bwH} ${y + h}L${tx} ${ty}L${cx - bwH} ${y + h}`;
  d += `L${x + r} ${y + h}Q${x} ${y + h} ${x} ${y + h - r}`;
  if (side === 'l') d += `L${x} ${cy + bwV}L${tx} ${ty}L${x} ${cy - bwV}`;
  d += `L${x} ${y + r}Q${x} ${y} ${x + r} ${y}Z`;
  return d;
}

function penPath(pts) {
  if (pts.length === 1) return `M${num(pts[0][0])} ${num(pts[0][1])}l0 0`;
  let d = `M${num(pts[0][0])} ${num(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${num(pts[i][0])} ${num(pts[i][1])} ${num(mx)} ${num(my)}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${num(l[0])} ${num(l[1])}`;
}

function arrowSvg(s, hit) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const L = Math.min(len, Math.max(14, s.sw * 4)), hw = L * 0.5;
  const bx = s.x2 - ux * L, by = s.y2 - uy * L;
  const ex = s.x2 - ux * L * 0.7, ey = s.y2 - uy * L * 0.7;
  const head = `M${num(s.x2)} ${num(s.y2)}L${num(bx - uy * hw)} ${num(by + ux * hw)}L${num(bx + uy * hw)} ${num(by - ux * hw)}Z`;
  return (hit ? `<line class="hit" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="transparent" stroke-width="${Math.max(s.sw, 14)}"/>` : '') +
    `<line x1="${num(s.x1)}" y1="${num(s.y1)}" x2="${num(ex)}" y2="${num(ey)}" stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="round"/>` +
    `<path d="${head}" fill="${s.stroke}" stroke="${s.stroke}" stroke-width="1" stroke-linejoin="round"/>`;
}

function shapeInner(s, hit) {
  const st = `stroke="${s.stroke}" stroke-width="${s.sw}" fill="${s.fill || 'none'}"`;
  switch (s.type) {
    case 'rect':
      return `<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" ${st} stroke-linejoin="round"/>`;
    case 'ellipse':
      return `<ellipse cx="${num(s.x + s.w / 2)}" cy="${num(s.y + s.h / 2)}" rx="${num(s.w / 2)}" ry="${num(s.h / 2)}" ${st}/>`;
    case 'line':
      return (hit ? `<line class="hit" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="transparent" stroke-width="${Math.max(s.sw, 14)}"/>` : '') +
        `<line x1="${num(s.x1)}" y1="${num(s.y1)}" x2="${num(s.x2)}" y2="${num(s.y2)}" stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="round"/>`;
    case 'arrow':
      return arrowSvg(s, hit);
    case 'pen': {
      const d = penPath(s.pts);
      return (hit ? `<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="${Math.max(s.sw, 14)}"/>` : '') +
        `<path d="${d}" fill="none" stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case 'text': {
      layout(s);
      const t = textEls(s, s.x, s.y);
      return hit ? `<rect class="hit" x="${s.x}" y="${s.y}" width="${num(bounds(s).w)}" height="${num(bounds(s).h)}" fill="transparent"/>${t}` : t;
    }
    case 'textbox':
      layout(s);
      return `<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" rx="3" ${st} stroke-linejoin="round"/>` +
        textEls(s, s.x + PAD, s.y + PAD);
    case 'balloon':
      layout(s);
      return `<path d="${balloonPath(s)}" ${st} stroke-linejoin="round"/>` + textEls(s, s.x + PAD, s.y + PAD);
    case 'highlight':
      return `<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" fill="${s.fill}" fill-opacity="0.5" style="mix-blend-mode:multiply"/>`;
    default:
      return '';
  }
}
const shapeSvg = (s, hit) => `<g id="shape-${s.id}" data-type="${s.type}"${hit ? ` data-id="${s.id}"` : ''}>${shapeInner(s, hit)}</g>`;

function buildSvg() {
  const { w, h } = state;
  const meta = JSON.stringify({ version: 1, w, h, shapes: JSON.parse(snapshot()) });
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `<metadata id="sharev-data">${esc(meta)}</metadata>\n` +
    `<image id="sharev-bg" x="0" y="0" width="${w}" height="${h}" xlink:href="${state.bg}"/>\n` +
    `<g id="annotations">\n${state.shapes.map((s) => shapeSvg(s, false)).join('\n')}\n</g>\n</svg>\n`;
}

// ------------------------------------------------------------------ rendering
function render() {
  ann.innerHTML = state.shapes.map((s) => shapeSvg(s, true)).join('');
  renderUI();
  updateButtons();
}

const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move', tail: 'move' };
function handlePoints(s) {
  if (s.type === 'line' || s.type === 'arrow') return { p1: [s.x1, s.y1], p2: [s.x2, s.y2] };
  if (!BOX.has(s.type)) return {};
  const { x, y, w, h } = bounds(s);
  const hp = { nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2] };
  if (s.type === 'balloon') hp.tail = [s.tx, s.ty];
  return hp;
}
function renderUI() {
  const s = byId(state.sel);
  if (!s || state.tool !== 'select') { ui.innerHTML = ''; return; }
  const z = state.zoom, b = bounds(s), pad = 3 / z, hs = 9 / z;
  let out = `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + 2 * pad}" height="${b.h + 2 * pad}" fill="none" stroke="#4da3ff" stroke-width="${1 / z}" stroke-dasharray="${4 / z} ${3 / z}" pointer-events="none"/>`;
  for (const [name, [px, py]] of Object.entries(handlePoints(s))) {
    out += `<rect data-h="${name}" x="${px - hs / 2}" y="${py - hs / 2}" width="${hs}" height="${hs}" fill="${name === 'tail' ? '#ffb020' : '#fff'}" stroke="#2677d4" stroke-width="${1 / z}" style="cursor:${HANDLE_CURSOR[name]}"/>`;
  }
  ui.innerHTML = out;
}

// ------------------------------------------------------------------ document
function setZoom(z) {
  state.zoom = clamp(z, 0.05, 8);
  svg.setAttribute('width', state.w * state.zoom);
  svg.setAttribute('height', state.h * state.zoom);
  $('bZoomLbl').textContent = Math.round(state.zoom * 100) + '%';
  renderUI();
  if (!ta.hidden) positionEditor(byId(state.sel));
}
function fit() {
  const aw = stage.clientWidth - 56, ah = stage.clientHeight - 56;
  setZoom(Math.min(1, aw / state.w, ah / state.h));
}

function loadDoc({ bg, w, h, shapes }, name) {
  state.bg = bg; state.w = w; state.h = h;
  state.shapes = shapes || [];
  state.nextId = state.shapes.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  state.sel = null; state.undo = []; state.redo = []; state.loaded = true; state.name = name || '';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  bgImg.setAttribute('width', w); bgImg.setAttribute('height', h);
  bgImg.setAttribute('href', bg);
  $('welcome').hidden = true; wrap.hidden = false;
  fit(); render();
  $('stInfo').textContent = `${w} × ${h}px`;
  window.api.setEmpty(false);
  window.api.setTitle(`ShareV${name ? ' - ' + name : ''}`);
  syncProps();
}

function imageSize(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => rej(new Error('Could not load image'));
    im.src = src;
  });
}
async function loadImage(dataURL, name) {
  const { w, h } = await imageSize(dataURL);
  loadDoc({ bg: dataURL, w, h, shapes: [] }, name);
}
async function loadSvgText(text, name) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('Not a valid SVG file');
  const meta = doc.querySelector('#sharev-data');
  const bgEl = doc.querySelector('#sharev-bg');
  if (meta && bgEl) {
    const d = JSON.parse(meta.textContent);
    const href = bgEl.getAttribute('xlink:href') || bgEl.getAttribute('href');
    loadDoc({ bg: href, w: d.w, h: d.h, shapes: d.shapes }, name);
    return;
  }
  // a foreign SVG: use it as a flat background
  const dataURL = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
  const root = doc.documentElement;
  let w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (!(w > 0 && h > 0)) { if (vb.length === 4) { w = vb[2]; h = vb[3]; } else ({ w, h } = await imageSize(dataURL)); }
  loadDoc({ bg: dataURL, w: Math.round(w), h: Math.round(h), shapes: [] }, name);
}

// ------------------------------------------------------------------ history
function pushUndo(pre) {
  if (pre === snapshot()) return false;
  state.undo.push(pre);
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  updateButtons();
  return true;
}
function restore(json) {
  state.shapes = JSON.parse(json);
  state.nextId = state.shapes.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  if (!byId(state.sel)) state.sel = null;
  render(); syncProps();
}
function undo() { if (!state.undo.length) return; commitEdit(); state.redo.push(snapshot()); restore(state.undo.pop()); }
function redo() { if (!state.redo.length) return; commitEdit(); state.undo.push(snapshot()); restore(state.redo.pop()); }
function updateButtons() {
  $('bUndo').disabled = !state.undo.length;
  $('bRedo').disabled = !state.redo.length;
  $('bDel').disabled = !state.sel;
  const has = state.loaded;
  for (const id of ['bSave', 'bSaveAs', 'bPng', 'bCopy']) $(id).disabled = !has;
}

// ------------------------------------------------------------------ properties
const P = {
  stroke: $('pStroke'), fill: $('pFill'), fillOn: $('pFillOn'), text: $('pText'),
  width: $('pWidth'), size: $('pSize'), bold: $('pBold'),
};
function syncProps() {
  const s = byId(state.sel);
  if (!s) return;
  if (s.stroke) P.stroke.value = s.stroke;
  if (s.fill && s.fill !== 'none') P.fill.value = s.fill;
  if ('fill' in s && s.type !== 'highlight') P.fillOn.checked = s.fill !== 'none';
  if (s.tc) P.text.value = s.tc;
  if (s.sw) P.width.value = s.sw;
  if (s.size) P.size.value = s.size;
  if ('bold' in s) P.bold.checked = !!s.bold;
}
let propPre = null;
function onProp(key) {
  return () => {
    const s = byId(state.sel);
    if (!s) return;
    if (propPre === null) propPre = snapshot();
    const v = P[key].type === 'checkbox' ? P[key].checked : P[key].value;
    switch (key) {
      case 'stroke': if ('stroke' in s) s.stroke = v; break;
      case 'fill': if (s.type === 'highlight' || (s.fill && s.fill !== 'none')) s.fill = v; break;
      case 'fillOn': if (s.type !== 'highlight' && 'fill' in s) s.fill = v ? P.fill.value : 'none'; break;
      case 'text': if (TEXTY.has(s.type)) s.tc = v; break;
      case 'width': if ('sw' in s) s.sw = clamp(+v || 1, 1, 60); break;
      case 'size': if ('size' in s) s.size = clamp(+v || 12, 6, 200); break;
      case 'bold': if ('bold' in s) s.bold = v; break;
    }
    render();
  };
}
for (const k of Object.keys(P)) {
  P[k].addEventListener('input', onProp(k));
  P[k].addEventListener('change', () => { onProp(k)(); if (propPre !== null) { pushUndo(propPre); propPre = null; } });
}

// ------------------------------------------------------------------ tools
function setTool(t) {
  commitEdit();
  state.tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  svg.style.cursor = t === 'select' ? 'default' : 'crosshair';
  renderUI();
}

function newShape(tool, p) {
  const common = { id: state.nextId++, type: tool };
  const stroke = P.stroke.value, sw = clamp(+P.width.value || 4, 1, 60);
  const txt = { text: '', size: clamp(+P.size.value || 28, 6, 200), bold: P.bold.checked, tc: P.text.value };
  switch (tool) {
    case 'rect': case 'ellipse':
      return { ...common, x: p.x, y: p.y, w: 0, h: 0, stroke, sw, fill: P.fillOn.checked ? P.fill.value : 'none' };
    case 'line': case 'arrow':
      return { ...common, x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke, sw };
    case 'pen':
      return { ...common, pts: [[p.x, p.y]], stroke, sw };
    case 'text':
      return { ...common, x: p.x, y: p.y, ...txt };
    case 'textbox':
      return { ...common, x: p.x, y: p.y, w: 0, h: 0, stroke, sw: Math.min(sw, 8), fill: P.fill.value, ...txt };
    case 'balloon':
      return { ...common, x: p.x, y: p.y, w: 0, h: 0, tx: p.x, ty: p.y, stroke, sw: Math.min(sw, 8), fill: P.fill.value, ...txt };
    case 'highlight':
      return { ...common, x: p.x, y: p.y, w: 0, h: 0, fill: P.fill.value };
  }
}

function setBox(s, a, p, square) {
  let dx = p.x - a.x, dy = p.y - a.y;
  if (square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
  s.x = Math.min(a.x, a.x + dx); s.y = Math.min(a.y, a.y + dy); s.w = Math.abs(dx); s.h = Math.abs(dy);
}
function snap45(a, p) {
  const dx = p.x - a.x, dy = p.y - a.y, len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}
function moveBy(s, o, dx, dy) {
  for (const k of ['x', 'tx', 'x1', 'x2']) if (k in o) s[k] = o[k] + dx;
  for (const k of ['y', 'ty', 'y1', 'y2']) if (k in o) s[k] = o[k] + dy;
  if (o.pts) s.pts = o.pts.map((q) => [q[0] + dx, q[1] + dy]);
}

// ------------------------------------------------------------------ pointer interaction
let drag = null;
const pt = (e) => {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
};

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state.loaded) return;
  commitEdit();
  const p = pt(e);
  const pre = snapshot();
  if (state.tool === 'select') {
    const h = e.target.dataset && e.target.dataset.h;
    const hitEl = e.target.closest && e.target.closest('[data-id]');
    if (h && byId(state.sel)) {
      drag = { kind: 'resize', pre, handle: h, s: byId(state.sel), orig: JSON.parse(pre).find((x) => x.id === state.sel) };
    } else if (hitEl) {
      state.sel = +hitEl.dataset.id;
      drag = { kind: 'move', pre, start: p, s: byId(state.sel), orig: JSON.parse(pre).find((x) => x.id === state.sel), moved: false };
      syncProps();
    } else {
      state.sel = null;
    }
    render();
    if (!drag) return;
  } else {
    const s = newShape(state.tool, p);
    state.shapes.push(s);
    state.sel = s.id;
    drag = { kind: 'create', pre, start: p, s };
    render();
  }
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
});

svg.addEventListener('pointermove', (e) => {
  const p = pt(e);
  $('stPos').textContent = state.loaded ? `${Math.round(p.x)}, ${Math.round(p.y)}` : '';
  if (!drag) return;
  const { s } = drag;
  if (drag.kind === 'create') {
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * state.zoom > 3) drag.moved = true;
    switch (s.type) {
      case 'rect': case 'ellipse': setBox(s, drag.start, p, e.shiftKey); break;
      case 'highlight': case 'textbox': case 'balloon': setBox(s, drag.start, p, false); break;
      case 'line': case 'arrow': { const q = e.shiftKey ? snap45(drag.start, p) : p; s.x2 = q.x; s.y2 = q.y; break; }
      case 'pen': {
        const l = s.pts[s.pts.length - 1];
        if (Math.hypot(p.x - l[0], p.y - l[1]) * state.zoom >= 2) s.pts.push([p.x, p.y]);
        break;
      }
    }
    if (s.type === 'balloon') { s.tx = s.x + s.w * 0.25; s.ty = s.y + s.h + Math.max(30, s.h * 0.45); }
  } else if (drag.kind === 'move') {
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * state.zoom < 3) return;
    drag.moved = true;
    moveBy(s, drag.orig, dx, dy);
  } else if (drag.kind === 'resize') {
    const o = drag.orig, h = drag.handle;
    if (h === 'p1') { const q = e.shiftKey ? snap45({ x: o.x2, y: o.y2 }, p) : p; s.x1 = q.x; s.y1 = q.y; }
    else if (h === 'p2') { const q = e.shiftKey ? snap45({ x: o.x1, y: o.y1 }, p) : p; s.x2 = q.x; s.y2 = q.y; }
    else if (h === 'tail') { s.tx = p.x; s.ty = p.y; }
    else {
      let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h;
      if (h.includes('w')) l = p.x;
      if (h.includes('e')) r = p.x;
      if (h.includes('n')) t = p.y;
      if (h.includes('s')) b = p.y;
      s.x = Math.min(l, r); s.w = Math.abs(r - l); s.y = Math.min(t, b); s.h = Math.abs(b - t);
    }
  }
  render();
});

function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  const s = d.s;
  if (d.kind === 'create') {
    let keep = true;
    if (BOX.has(s.type)) {
      if (!d.moved && (s.type === 'textbox' || s.type === 'balloon')) {
        s.w = 220; s.h = 70;
        if (s.type === 'balloon') { s.tx = s.x + 55; s.ty = s.y + s.h + 36; }
      } else if (s.w < 3 || s.h < 3) keep = false;
    } else if (s.type === 'line' || s.type === 'arrow') {
      keep = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= 4;
    }
    if (!keep) { state.shapes = state.shapes.filter((x) => x !== s); state.sel = null; render(); return; }
    setTool('select');
    state.sel = s.id;
    if (TEXTY.has(s.type)) { render(); startEdit(s, d.pre, true); return; }
    pushUndo(d.pre);
    render(); syncProps();
  } else {
    pushUndo(d.pre);
    render();
  }
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('dblclick', (e) => {
  const el = e.target.closest && e.target.closest('[data-id]');
  const s = el && byId(+el.dataset.id);
  if (s && TEXTY.has(s.type) && state.tool === 'select') startEdit(s, snapshot(), false);
});

// ------------------------------------------------------------------ text editing
let editing = null; // {s, pre, isNew}
function positionEditor(s) {
  if (!s) return;
  const z = state.zoom;
  layout(s);
  ta.style.fontSize = s.size * z + 'px';
  ta.style.fontWeight = s.bold ? 'bold' : 'normal';
  ta.style.color = s.tc;
  if (s.type === 'text') {
    ta.style.left = s.x * z + 'px'; ta.style.top = s.y * z + 'px';
    ta.style.width = Math.max(120, ta.scrollWidth + 4) + 'px';
    ta.style.height = '0px';
    ta.style.height = Math.max(lineH(s) * z, ta.scrollHeight) + 'px';
  } else {
    ta.style.left = (s.x + PAD) * z + 'px'; ta.style.top = (s.y + PAD) * z + 'px';
    ta.style.width = (s.w - 2 * PAD) * z + 'px';
    ta.style.height = (s.h - 2 * PAD) * z + 'px';
  }
}
function startEdit(s, pre, isNew) {
  commitEdit();
  editing = { s, pre, isNew };
  s._editing = true;
  state.sel = s.id;
  ta.hidden = false;
  ta.value = s.text;
  render();
  positionEditor(s);
  ta.focus();
  ta.select();
}
function commitEdit() {
  if (!editing) return;
  const { s, pre, isNew } = editing;
  editing = null;
  s._editing = false;
  s.text = ta.value;
  ta.hidden = true;
  if (isNew && !s.text.trim()) {
    state.shapes = state.shapes.filter((x) => x !== s);
    state.sel = null;
  } else {
    pushUndo(pre);
  }
  render(); syncProps();
}
ta.addEventListener('input', () => {
  const s = editing && editing.s;
  if (!s) return;
  s.text = ta.value;
  ann.innerHTML = state.shapes.map((x) => shapeSvg(x, true)).join('');
  renderUI();
  positionEditor(s);
});
ta.addEventListener('blur', commitEdit);
ta.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitEdit(); svg.focus && svg.focus(); }
});

// ------------------------------------------------------------------ actions
function deleteSel() {
  const s = byId(state.sel);
  if (!s) return;
  const pre = snapshot();
  state.shapes = state.shapes.filter((x) => x !== s);
  state.sel = null;
  pushUndo(pre); render();
}
function duplicateSel() {
  const s = byId(state.sel);
  if (!s) return;
  const pre = snapshot();
  const c = JSON.parse(JSON.stringify(s, (k, v) => (k[0] === '_' ? undefined : v)));
  c.id = state.nextId++;
  moveBy(c, s, 16, 16);
  state.shapes.push(c); state.sel = c.id;
  pushUndo(pre); render();
}
function reorder(dir) {
  const i = state.shapes.findIndex((x) => x.id === state.sel);
  if (i < 0) return;
  const pre = snapshot();
  const [s] = state.shapes.splice(i, 1);
  state.shapes.splice(dir > 0 ? state.shapes.length : 0, 0, s);
  pushUndo(pre); render();
}
function nudge(dx, dy) {
  const s = byId(state.sel);
  if (!s) return;
  const pre = snapshot();
  moveBy(s, JSON.parse(JSON.stringify(s)), dx, dy);
  pushUndo(pre); render();
}

let flashT = 0;
function flash(msg) {
  $('stInfo').textContent = msg;
  clearTimeout(flashT);
  flashT = setTimeout(() => { $('stInfo').textContent = state.loaded ? `${state.w} × ${state.h}px` : ''; }, 3500);
}

async function renderPng() {
  const markup = buildSvg();
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = state.w; c.height = state.h;
    c.getContext('2d').drawImage(im, 0, 0, state.w, state.h);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

async function guard(fn) { try { await fn(); } catch (err) { flash('Error: ' + (err && err.message || err)); } }
const saveSvg = (as) => guard(async () => {
  if (!state.loaded) return;
  commitEdit();
  const f = await window.api.saveSvg(buildSvg(), !!as);
  if (f) { flash('Saved ' + f); window.api.setTitle('ShareV - ' + f.split(/[\\/]/).pop()); }
});
const exportPng = () => guard(async () => {
  if (!state.loaded) return;
  commitEdit();
  const f = await window.api.exportPng(await renderPng());
  if (f) flash('Exported ' + f);
});
const copyImage = () => guard(async () => {
  if (!state.loaded) return;
  commitEdit();
  await window.api.copyPng(await renderPng());
  flash('Copied to clipboard');
});
const openFile = () => guard(async () => {
  const r = await window.api.openFile();
  if (!r) return;
  if (r.kind === 'svg') await loadSvgText(r.text, r.name); else await loadImage(r.dataURL, r.name);
});

// ------------------------------------------------------------------ wiring
document.querySelectorAll('[data-cap]').forEach((b) => b.addEventListener('click', () => window.api.capture(b.dataset.cap)));
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('bOpen').onclick = openFile;
$('bSave').onclick = () => saveSvg(false);
$('bSaveAs').onclick = () => saveSvg(true);
$('bPng').onclick = exportPng;
$('bCopy').onclick = copyImage;
$('bUndo').onclick = undo;
$('bRedo').onclick = redo;
$('bDel').onclick = deleteSel;
$('bZoomIn').onclick = () => setZoom(state.zoom * 1.25);
$('bZoomOut').onclick = () => setZoom(state.zoom / 1.25);
$('bZoomLbl').onclick = fit;
$('bZoom100').onclick = () => setZoom(1);
stage.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !state.loaded) return;
  e.preventDefault();
  setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });
addEventListener('resize', () => { if (state.loaded && state.zoom <= 1) fit(); });

const KEYS = { v: 'select', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', p: 'pen', t: 'text', b: 'textbox', c: 'balloon', h: 'highlight' };
addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z') { e.shiftKey ? redo() : undo(); }
    else if (k === 'y') redo();
    else if (k === 's') saveSvg(e.shiftKey);
    else if (k === 'o') openFile();
    else if (k === 'c') copyImage();
    else if (k === 'd') duplicateSel();
    else if (k === ']') reorder(1);
    else if (k === '[') reorder(-1);
    else if (k === '0') fit();
    else if (k === '1') setZoom(1);
    else if (k === '=' || k === '+') setZoom(state.zoom * 1.25);
    else if (k === '-') setZoom(state.zoom / 1.25);
    else return;
    e.preventDefault();
    return;
  }
  if (k === 'delete' || k === 'backspace') { deleteSel(); e.preventDefault(); }
  else if (k === 'escape') { state.sel = null; setTool('select'); render(); }
  else if (k === 'enter') { const s = byId(state.sel); if (s && TEXTY.has(s.type)) { startEdit(s, snapshot(), false); e.preventDefault(); } }
  else if (k.startsWith('arrow') && state.sel) {
    const d = e.shiftKey ? 10 : 1;
    nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
    e.preventDefault();
  } else if (KEYS[k] && state.loaded) setTool(KEYS[k]);
});

// paste an image straight from the clipboard
addEventListener('paste', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  const r = new FileReader();
  r.onload = () => guard(() => loadImage(r.result, 'clipboard'));
  r.readAsDataURL(item.getAsFile());
});

// drag & drop files
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const r = new FileReader();
  if (/\.svg$/i.test(f.name)) { r.onload = () => guard(() => loadSvgText(r.result, f.name)); r.readAsText(f); }
  else { r.onload = () => guard(() => loadImage(r.result, f.name)); r.readAsDataURL(f); }
});

setTool('select');
updateButtons();
window.api.onLoad((p) => guard(() => loadImage(p.dataURL)));
window.api.init().then((p) => { if (p) guard(() => loadImage(p.dataURL)); else window.api.setEmpty(true); });

// exposed for tests
window.__sharev = { buildSvg, renderPng, loadSvgText, loadImage, setTool };
