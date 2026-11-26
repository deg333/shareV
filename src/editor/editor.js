'use strict';
/* ShareV editor: every annotation is a plain data object that is rendered to SVG markup.
   The saved .svg contains the screenshot as an <image> plus real vector elements, and a
   <metadata id="sharev-data"> block so the file can be re-opened and edited again. */

const $ = (id) => document.getElementById(id);
const svg = $('svg'), ann = $('ann'), ui = $('ui'), bgImg = $('bg'), wrap = $('wrap'), stage = $('stage');
const ta = $('edit');
const FONT = "'Segoe UI', Helvetica, Arial, sans-serif";
const PAD = 8;
const BOX = new Set(['rect', 'ellipse', 'textbox', 'balloon', 'highlight', 'blur', 'pixelate', 'emoji']);
const FX = new Set(['blur', 'pixelate']); // effects applied to the screenshot itself, drawn under the annotations
const SHADOWY = new Set(['rect', 'ellipse', 'line', 'arrow', 'pen', 'bezier', 'text', 'textbox', 'balloon', 'step', 'emoji']);
const TEXTY = new Set(['text', 'textbox', 'balloon']);

const state = {
  w: 0, h: 0, bg: '', shapes: [], sels: [], marquee: null, tool: 'select', zoom: 1,
  get sel() { return this.sels.length ? this.sels[this.sels.length - 1] : null; }, // primary selection
  set sel(v) { this.sels = v == null ? [] : [v]; },
  undo: [], redo: [], nextId: 1, name: '', loaded: false, bz: null, bzHover: null, bzPre: '', stepOverride: null, bgCanvas: null, bakeFx: true,
};
window.__state = state; // handy for tests / debugging

// ------------------------------------------------------------------ utils
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(n * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snapshot = () => JSON.stringify(state.shapes, (k, v) => (k[0] === '_' ? undefined : v));
const byId = (id) => state.shapes.find((s) => s.id === id);
const selShapes = () => state.sels.map(byId).filter(Boolean);
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
  if (s.type === 'step') { const r = s.size / 2; return { x: s.x - r, y: s.y - r, w: s.size, h: s.size }; }
  if (BOX.has(s.type)) { layout(s); return { x: s.x, y: s.y, w: s.w, h: s.h }; }
  if (s.type === 'line' || s.type === 'arrow') {
    return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  }
  if (s.type === 'pen' || s.type === 'bezier') {
    const pts = s.type === 'pen' ? s.pts : s.nodes.map((n) => [n.x, n.y]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  layout(s); // text
  const w = Math.max(10, ...s._lines.map((l) => measure(l, s.size, s.bold)));
  return { x: s.x, y: s.y, w, h: s._lines.length * lineH(s) };
}

// ------------------------------------------------------------------ SVG generation
const opAttr = (name, v) => (v === undefined || v === null || v >= 1 ? '' : ` ${name}="${num(v)}"`);
function textEls(s, x, y) {
  if (s._editing || !s.text) return '';
  const first = y + s.size * 0.95;
  const tsp = s._lines.map((l, i) => `<tspan x="${num(x)}" y="${num(first + i * lineH(s))}">${esc(l) || ' '}</tspan>`).join('');
  const outline = s.type === 'text' && s.sw > 0 && s.stroke && s.stroke !== 'none'
    ? ` stroke="${s.stroke}"${opAttr('stroke-opacity', s.sa)} stroke-width="${s.sw * 2}" stroke-linejoin="round" paint-order="stroke"` : '';
  return `<text font-family="${esc(FONT)}" font-size="${s.size}"${s.bold ? ' font-weight="bold"' : ''} fill="${s.tc}"${opAttr('fill-opacity', s.ta)}${outline} xml:space="preserve">${tsp}</text>`;
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
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${num(p1[0] + (p2[0] - p0[0]) / 6)} ${num(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${num(p2[0] - (p3[0] - p1[0]) / 6)} ${num(p2[1] - (p3[1] - p1[1]) / 6)} ${num(p2[0])} ${num(p2[1])}`;
  }
  return d;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let idx = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}
/** Remove hand jitter: weighted moving average (x2) then Douglas-Peucker; the renderer splines the rest. */
function smoothPts(pts) {
  if (pts.length < 3) return pts;
  let a = pts;
  for (let k = 0; k < 3; k++) {
    const b = [a[0]];
    for (let i = 1; i < a.length - 1; i++) {
      b.push([(a[i - 1][0] + 2 * a[i][0] + a[i + 1][0]) / 4, (a[i - 1][1] + 2 * a[i][1] + a[i + 1][1]) / 4]);
    }
    b.push(a[a.length - 1]);
    a = b;
  }
  return rdp(a, 1.2);
}
function bezierPath(s) {
  const n = s.nodes;
  const seg = (a, b) => `C${num(a.hx)} ${num(a.hy)} ${num(2 * b.x - b.hx)} ${num(2 * b.y - b.hy)} ${num(b.x)} ${num(b.y)}`;
  let d = `M${num(n[0].x)} ${num(n[0].y)}`;
  for (let i = 1; i < n.length; i++) d += seg(n[i - 1], n[i]);
  if (s.closed && n.length > 2) d += seg(n[n.length - 1], n[0]) + 'Z';
  return d;
}

// ---- line-like shapes (line, arrow, freehand, bezier pen) with optional arrowheads at either end
const HEADY = new Set(['line', 'arrow', 'pen', 'bezier']);
const headOn = (s, end) => (end ? (s.he ?? s.type === 'arrow') : !!s.hs);
const headLen = (s) => s.hz || Math.max(14, s.sw * 4);
const unit = (dx, dy) => { const l = Math.hypot(dx, dy); return l > 1e-6 ? [dx / l, dy / l] : null; };
const neg = (u) => [-u[0], -u[1]];

/** Tip positions and outward directions of both ends: {a:{x,y,u}, b:{x,y,u}} or null. */
function lineEnds(s) {
  if (s.type === 'line' || s.type === 'arrow') {
    const u = unit(s.x2 - s.x1, s.y2 - s.y1);
    return u && { a: { x: s.x1, y: s.y1, u: neg(u) }, b: { x: s.x2, y: s.y2, u } };
  }
  if (s.type === 'pen') {
    const p = s.pts;
    if (p.length < 2) return null;
    const dir = (from, step) => { // direction against the first point >= 4px away, to ignore jitter
      const tip = p[from];
      for (let i = from + step; i >= 0 && i < p.length; i += step) {
        if (Math.hypot(p[i][0] - tip[0], p[i][1] - tip[1]) >= 4 || i === 0 || i === p.length - 1) return unit(tip[0] - p[i][0], tip[1] - p[i][1]);
      }
      return null;
    };
    const ua = dir(0, 1), ub = dir(p.length - 1, -1);
    return ua && ub && { a: { x: p[0][0], y: p[0][1], u: ua }, b: { x: p[p.length - 1][0], y: p[p.length - 1][1], u: ub } };
  }
  if (s.type === 'bezier' && s.nodes.length >= 2 && !s.closed) {
    const n = s.nodes, f = n[0], f1 = n[1], l = n[n.length - 1], l0 = n[n.length - 2];
    const ta = unit(f.hx - f.x, f.hy - f.y) || unit(2 * f1.x - f1.hx - f.x, 2 * f1.y - f1.hy - f.y) || unit(f1.x - f.x, f1.y - f.y);
    const tb = unit(l.hx - l.x, l.hy - l.y) || unit(l.x - l0.hx, l.y - l0.hy) || unit(l.x - l0.x, l.y - l0.y);
    return ta && tb && { a: { x: f.x, y: f.y, u: neg(ta) }, b: { x: l.x, y: l.y, u: tb } };
  }
  return null;
}

function trimPts(pts, T) { // shorten a polyline at its end by T
  const out = pts.map((q) => q.slice());
  while (T > 0 && out.length >= 2) {
    const l = out[out.length - 1], q = out[out.length - 2];
    const d = Math.hypot(l[0] - q[0], l[1] - q[1]);
    if (d > T) { out[out.length - 1] = [l[0] + (q[0] - l[0]) * (T / d), l[1] + (q[1] - l[1]) * (T / d)]; break; }
    T -= d;
    if (out.length > 2) out.pop(); else break;
  }
  return out;
}
/** Geometry to stroke: the line pulled back from each arrowhead so a thick stroke can't poke past the tip. */
function trimmedGeom(s, e) {
  const L = headLen(s);
  let Ts = headOn(s, false) ? L * 0.7 : 0, Te = headOn(s, true) ? L * 0.7 : 0;
  if (!e || (!Ts && !Te)) return s;
  if (s.type === 'line' || s.type === 'arrow') {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const k = Math.min(1, (len * 0.9) / (Ts + Te || 1));
    Ts *= k; Te *= k;
    return { ...s, x1: s.x1 - e.a.u[0] * Ts, y1: s.y1 - e.a.u[1] * Ts, x2: s.x2 - e.b.u[0] * Te, y2: s.y2 - e.b.u[1] * Te };
  }
  if (s.type === 'pen') {
    let pts = s.pts;
    if (Te) pts = trimPts(pts, Te);
    if (Ts) pts = trimPts(pts.slice().reverse(), Ts).reverse();
    return { ...s, pts };
  }
  const nodes = s.nodes.map((n) => ({ ...n }));
  const mv = (n, dx, dy) => { n.x += dx; n.y += dy; n.hx += dx; n.hy += dy; };
  if (Ts) mv(nodes[0], -e.a.u[0] * Ts, -e.a.u[1] * Ts);
  if (Te) mv(nodes[nodes.length - 1], -e.b.u[0] * Te, -e.b.u[1] * Te);
  return { ...s, nodes };
}
function headSvg(tip, L, color) {
  const [ux, uy] = tip.u, hw = L * 0.5;
  const bx = tip.x - ux * L, by = tip.y - uy * L;
  return `<path d="M${num(tip.x)} ${num(tip.y)}L${num(bx - uy * hw)} ${num(by + ux * hw)}L${num(bx + uy * hw)} ${num(by - ux * hw)}Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`;
}
function strokeShape(s, hit) {
  const e = lineEnds(s);
  const g = trimmedGeom(s, e);
  const hw = Math.max(s.sw, 14);
  const stk = `stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="round" stroke-linejoin="round"`;
  let body, hitEl, under = '';
  if (s.type === 'line' || s.type === 'arrow') {
    hitEl = `<line class="hit" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="transparent" stroke-width="${hw}"/>`;
    body = `<line x1="${num(g.x1)}" y1="${num(g.y1)}" x2="${num(g.x2)}" y2="${num(g.y2)}" ${stk}/>`;
  } else {
    const d = s.type === 'pen' ? penPath(g.pts) : bezierPath(g);
    hitEl = `<path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="${hw}"/>`;
    body = `<path d="${d}" fill="none" ${stk}/>`;
    if (s.type === 'bezier' && s.closed && s.fill && s.fill !== 'none') {
      under = `<path d="${d}" fill="${s.fill}"${opAttr('fill-opacity', s.fa)} stroke="none"/>`;
    }
  }
  const L = headLen(s);
  let heads = '';
  if (e && headOn(s, false)) heads += headSvg(e.a, L, s.stroke);
  if (e && headOn(s, true)) heads += headSvg(e.b, L, s.stroke);
  const sa = s.sa ?? 1;
  const inner = body + heads;
  return (hit ? hitEl : '') + under + (sa < 1 ? `<g opacity="${num(sa)}">${inner}</g>` : inner);
}

function shapeInner(s, hit) {
  const st = `stroke="${s.stroke}"${opAttr('stroke-opacity', s.sa)} stroke-width="${s.sw}" fill="${s.fill || 'none'}"${opAttr('fill-opacity', s.fa)}`;
  switch (s.type) {
    case 'rect':
      return `<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" ${st} stroke-linejoin="round"/>`;
    case 'ellipse':
      return `<ellipse cx="${num(s.x + s.w / 2)}" cy="${num(s.y + s.h / 2)}" rx="${num(s.w / 2)}" ry="${num(s.h / 2)}" ${st}/>`;
    case 'line': case 'arrow': case 'pen': case 'bezier':
      return strokeShape(s, hit);
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
    case 'step': {
      const r = s.size / 2, label = String(s.n);
      const fs = s.size * (label.length > 2 ? 0.4 : label.length > 1 ? 0.5 : 0.58);
      const ring = s.sw > 0 ? ` stroke="${s.stroke}"${opAttr('stroke-opacity', s.sa)} stroke-width="${s.sw}"` : '';
      return `<circle cx="${num(s.x)}" cy="${num(s.y)}" r="${num(r)}" fill="${s.fill}"${opAttr('fill-opacity', s.fa)}${ring}/>` +
        `<text x="${num(s.x)}" y="${num(s.y)}" dy="0.35em" text-anchor="middle" font-family="${esc(FONT)}" font-size="${num(fs)}" font-weight="bold" fill="${s.tc}"${opAttr('fill-opacity', s.ta)}>${esc(label)}</text>`;
    }
    case 'blur': case 'pixelate':
      return fxInner(s);
    case 'emoji':
      return emojiInner(s, hit);
    case 'ocr':
      return `<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" fill="rgba(255,176,32,.15)" stroke="#ffb020" stroke-width="2" stroke-dasharray="6 4"/>`;
    case 'highlight': {
      const r = `x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}"`;
      return `<rect ${r} fill="${s.fill}" fill-opacity="${num(s.fa ?? 0.5)}" style="mix-blend-mode:multiply"/>` +
        (s.sw > 0 ? `<rect ${r} fill="none" stroke="${s.stroke || '#ff0000'}"${opAttr('stroke-opacity', s.sa)} stroke-width="${s.sw}" stroke-linejoin="round"/>` : '');
    }
    default:
      return '';
  }
}
// ---- emoji: SVG artwork (bundled Blobmoji + user-added), sanitised, scoped and embedded as nested <svg>
const emojiLib = new Map(); // id -> {id, name, group, char, raw|root, file, tpl, thumb}
const DEFAULT_EMOJI = 'b:u1f60a';
const EMOJI_DROP = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animateTransform', 'animateMotion'];
function sanitizeEmoji(text) {
  // pre-strip scripts and inline handlers textually so the parser never even sees them (also keeps the CSP log clean)
  const pre = String(text).replace(/<!DOCTYPE[^>]*>/i, '').replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const doc = new DOMParser().parseFromString(pre, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) return null;
  for (const tag of EMOJI_DROP) root.querySelectorAll(tag).forEach((n) => n.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value;
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'xlink:href') && !(v.startsWith('#') || /^data:image\/(png|jpeg|gif|webp);/i.test(v))) el.removeAttribute(a.name);
      else if (/url\(\s*(?!['"]?#)/i.test(v)) el.removeAttribute(a.name);
    }
    if (el.localName === 'style') el.textContent = el.textContent.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none');
  }
  let vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => Number.isNaN(n)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
    vb = [0, 0, w > 0 ? w : 128, h > 0 ? h : 128];
  }
  root.setAttribute('viewBox', vb.join(' '));
  for (const a of ['width', 'height', 'x', 'y', 'id', 'preserveAspectRatio']) root.removeAttribute(a);
  return root;
}
function addEmoji(id, name, raw, group, extra = {}) {
  const item = { id, name, group, raw, root: null, char: extra.char || '', file: extra.file || '', tpl: null, thumb: null, bad: false };
  emojiLib.set(id, item);
  return item;
}
function rootOf(item) {
  if (!item.root && !item.bad) {
    item.root = sanitizeEmoji(item.raw);
    if (!item.root) item.bad = true;
  }
  return item.root;
}
/** Markup with placeholders for x/y/size and a per-shape prefix that keeps ids and CSS classes unique in one document. */
function emojiTpl(item) {
  if (!item.tpl) {
    const c = rootOf(item).cloneNode(true);
    c.setAttribute('x', '__X__'); c.setAttribute('y', '__Y__'); c.setAttribute('width', '__W__'); c.setAttribute('height', '__H__');
    c.setAttribute('preserveAspectRatio', 'xMidYMid meet'); c.setAttribute('overflow', 'hidden');
    c.querySelectorAll('[class]').forEach((el) => el.setAttribute('class', el.getAttribute('class').split(/\s+/).filter(Boolean).map((k) => '__P__' + k).join(' ')));
    c.querySelectorAll('style').forEach((st) => { st.textContent = st.textContent.replace(/\.([A-Za-z_][\w-]*)/g, '.__P__$1'); });
    item.tpl = new XMLSerializer().serializeToString(c)
      .replace(/\sid="([^"]*)"/g, ' id="__P__$1"')
      .replace(/url\((['"]?)#([^)'"]+)\1\)/g, 'url($1#__P__$2$1)')
      .replace(/((?:xlink:)?href)="#([^"]*)"/g, '$1="#__P__$2"');
  }
  return item.tpl;
}
const emojiFill = (item, x, y, w, h, pre) => emojiTpl(item).replaceAll('__X__', x).replaceAll('__Y__', y).replaceAll('__W__', w).replaceAll('__H__', h).replaceAll('__P__', pre);
function emojiThumb(item) {
  if (!item.thumb && rootOf(item)) item.thumb = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(emojiFill(item, 0, 0, 64, 64, 't-'));
  return item.thumb || '';
}
const emojiText = (item) => (rootOf(item) ? new XMLSerializer().serializeToString(rootOf(item)) : '');
function emojiInner(s, hit) {
  const item = emojiLib.get(s.key);
  const box = `x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}"`;
  if (!item || !rootOf(item)) return `<rect ${box} fill="#888" fill-opacity=".25" stroke="#888" stroke-dasharray="4 3"/>`;
  return (hit ? `<rect class="hit" ${box} fill="transparent"/>` : '') + emojiFill(item, num(s.x), num(s.y), num(s.w), num(s.h), `e${s.id}-`);
}

// ---- blur / pixelate: computed on a canvas from the screenshot, embedded as a small raster <image>
const fxCache = new Map();
function fxCanvas(s) {
  const bg = state.bgCanvas;
  if (!bg) return null;
  const x = Math.round(s.x), y = Math.round(s.y), w = Math.max(1, Math.round(s.w)), h = Math.max(1, Math.round(s.h));
  const amt = Math.max(1, Math.round(s.amt || 12));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d');
  if (s.type === 'pixelate') {
    const bw = Math.max(1, Math.ceil(w / amt)), bh = Math.max(1, Math.ceil(h / amt));
    const small = document.createElement('canvas');
    small.width = bw; small.height = bh;
    const sg = small.getContext('2d');
    sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
    sg.drawImage(bg, x, y, w, h, 0, 0, bw, bh); // average each block...
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, bw, bh, 0, 0, bw * amt, bh * amt); // ...then blow it up without smoothing
  } else {
    const pad = Math.ceil(amt * 2.5); // sample beyond the box so the edges blur with their surroundings
    const t = document.createElement('canvas');
    t.width = w + 2 * pad; t.height = h + 2 * pad;
    const tg = t.getContext('2d');
    tg.filter = `blur(${amt}px)`;
    tg.drawImage(bg, x - pad, y - pad, w + 2 * pad, h + 2 * pad, 0, 0, w + 2 * pad, h + 2 * pad);
    g.drawImage(t, pad, pad, w, h, 0, 0, w, h);
  }
  return out;
}
function fxUrl(s) {
  const key = [s.type, Math.round(s.x), Math.round(s.y), Math.round(s.w), Math.round(s.h), s.amt].join('|');
  let url = fxCache.get(key);
  if (!url) {
    const c = fxCanvas(s);
    if (!c) return '';
    url = c.toDataURL('image/png');
    if (fxCache.size > 80) fxCache.clear();
    fxCache.set(key, url);
  }
  return url;
}
function fxInner(s) {
  const url = fxUrl(s);
  const r = `x="${Math.round(s.x)}" y="${Math.round(s.y)}" width="${Math.max(1, Math.round(s.w))}" height="${Math.max(1, Math.round(s.h))}"`;
  return url ? `<image ${r} preserveAspectRatio="none" xlink:href="${url}"/>` : `<rect ${r} fill="#888" fill-opacity=".3"/>`;
}
/** Screenshot with every blur/pixelate burned in (used when saving, so the original pixels are not left in the file). */
function bakedCanvas() {
  const bg = state.bgCanvas;
  const c = document.createElement('canvas');
  c.width = bg.width; c.height = bg.height;
  const g = c.getContext('2d');
  g.drawImage(bg, 0, 0);
  for (const s of state.shapes) if (FX.has(s.type)) { const f = fxCanvas(s); if (f) g.drawImage(f, Math.round(s.x), Math.round(s.y)); }
  return c;
}
const bakedBgUrl = () => bakedCanvas().toDataURL('image/png');
function buildBgCanvas(src) {
  const im = new Image();
  im.onload = () => {
    if (state.bg !== src) return;
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    state.bgCanvas = c; fxCache.clear();
    render();
  };
  im.src = src;
}
// ---- drop shadow: one filter per distinct size, defined once per document
const shadowId = (z) => `sv-sh-${Math.round(z)}`;
function shadowDefs() {
  const sizes = [...new Set(state.shapes.filter((s) => s.sh && SHADOWY.has(s.type)).map((s) => Math.round(s.shz || 4)))];
  return sizes.map((z) => `<filter id="${shadowId(z)}" filterUnits="userSpaceOnUse" x="0" y="0" width="${state.w}" height="${state.h}" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${num(z * 0.6)}"/><feOffset dx="${num(z * 0.7)}" dy="${num(z * 0.9)}" result="o"/>` +
    `<feComponentTransfer in="o" result="s"><feFuncA type="linear" slope="0.6"/></feComponentTransfer>` +
    `<feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`).join('');
}
const shapeSvg = (s, hit) => `<g id="shape-${s.id}" data-type="${s.type}"${hit ? ` data-id="${s.id}"` : ''}${s.sh && SHADOWY.has(s.type) ? ` filter="url(#${shadowId(s.shz || 4)})"` : ''}>${shapeInner(s, hit)}</g>`;

function buildSvg() {
  const { w, h } = state;
  const fxShapes = state.shapes.filter((s) => FX.has(s.type));
  const bake = state.bakeFx && fxShapes.length && state.bgCanvas;
  const all = JSON.parse(snapshot());
  const kept = bake ? all.filter((s) => !FX.has(s.type)) : all;
  const used = {};
  for (const s of kept) if (s.type === 'emoji') { const it = emojiLib.get(s.key); if (it && it.group !== 'blob' && !used[s.key]) used[s.key] = emojiText(it); }
  const meta = JSON.stringify({ version: 1, w, h, shapes: kept, ...(Object.keys(used).length ? { emoji: used } : {}) });
  const others = state.shapes.filter((s) => !FX.has(s.type));
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `<metadata id="sharev-data">${esc(meta)}</metadata>\n` +
    `<defs>${shadowDefs()}</defs>\n` +
    `<image id="sharev-bg" x="0" y="0" width="${w}" height="${h}" xlink:href="${bake ? bakedBgUrl() : state.bg}"/>\n` +
    (bake ? '' : `<g id="effects">\n${fxShapes.map((s) => shapeSvg(s, false)).join('\n')}\n</g>\n`) +
    `<g id="annotations">\n${others.map((s) => shapeSvg(s, false)).join('\n')}\n</g>\n</svg>\n`;
}

// ------------------------------------------------------------------ rendering
function render() {
  $('defs').innerHTML = shadowDefs();
  $('fx').innerHTML = state.shapes.filter((s) => FX.has(s.type)).map((s) => shapeSvg(s, true)).join('');
  ann.innerHTML = state.shapes.filter((s) => !FX.has(s.type)).map((s) => shapeSvg(s, true)).join('');
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
  if (s.type === 'emoji') { delete hp.n; delete hp.s; delete hp.e; delete hp.w; }
  return hp;
}
function bezierGuides(s, interactive, z) {
  let out = '';
  const hs = 9 / z, r = 4.5 / z, sw = 1 / z;
  s.nodes.forEach((n, i) => {
    const gx = 2 * n.x - n.hx, gy = 2 * n.y - n.hy;
    const has = Math.hypot(n.hx - n.x, n.hy - n.y) > 0.5;
    if (has) {
      out += `<line x1="${gx}" y1="${gy}" x2="${n.hx}" y2="${n.hy}" stroke="#4da3ff" stroke-width="${sw}" pointer-events="none"/>`;
      for (const [name, x, y] of [['h' + i, n.hx, n.hy], ['g' + i, gx, gy]]) {
        out += `<circle ${interactive ? `data-h="${name}"` : 'pointer-events="none"'} cx="${x}" cy="${y}" r="${r}" fill="#4da3ff" stroke="#fff" stroke-width="${sw}" style="cursor:move"/>`;
      }
    }
    out += `<rect ${interactive ? `data-h="n${i}"` : 'pointer-events="none"'} x="${n.x - hs / 2}" y="${n.y - hs / 2}" width="${hs}" height="${hs}" fill="${i === 0 ? '#ffb020' : '#fff'}" stroke="#2677d4" stroke-width="${sw}" style="cursor:move"/>`;
  });
  return out;
}
function renderUI() {
  const z = state.zoom;
  const bz = state.bz;
  if (bz) {
    let out = bezierGuides(bz, false, z);
    const h = state.bzHover, last = bz.nodes[bz.nodes.length - 1];
    if (h && !drag) {
      const prev = { x: last.x, y: last.y, hx: last.hx, hy: last.hy };
      out += `<path d="${bezierPath({ nodes: [prev, { x: h.x, y: h.y, hx: h.x, hy: h.y }] })}" fill="none" stroke="#4da3ff" stroke-width="${1.5 / z}" stroke-dasharray="${5 / z} ${4 / z}" pointer-events="none"/>`;
    }
    ui.innerHTML = out;
    return;
  }
  if (state.tool !== 'select') { ui.innerHTML = ''; return; }
  const sel = selShapes();
  const mq = state.marquee;
  const marquee = mq ? `<rect x="${mq.x}" y="${mq.y}" width="${mq.w}" height="${mq.h}" fill="rgba(77,163,255,.15)" stroke="#4da3ff" stroke-width="${1 / z}" pointer-events="none"/>` : '';
  if (sel.length !== 1) {
    const pad = 3 / z;
    ui.innerHTML = sel.map((sh) => {
      const b = bounds(sh);
      return `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + 2 * pad}" height="${b.h + 2 * pad}" fill="none" stroke="#4da3ff" stroke-width="${1 / z}" stroke-dasharray="${4 / z} ${3 / z}" pointer-events="none"/>`;
    }).join('') + marquee;
    return;
  }
  const s = sel[0];
  const b = bounds(s), pad = 3 / z, hs = 9 / z;
  let out = `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + 2 * pad}" height="${b.h + 2 * pad}" fill="none" stroke="#4da3ff" stroke-width="${1 / z}" stroke-dasharray="${4 / z} ${3 / z}" pointer-events="none"/>`;
  if (s.type === 'bezier') out += bezierGuides(s, true, z);
  for (const [name, [px, py]] of Object.entries(handlePoints(s))) {
    out += `<rect data-h="${name}" x="${px - hs / 2}" y="${py - hs / 2}" width="${hs}" height="${hs}" fill="${name === 'tail' ? '#ffb020' : '#fff'}" stroke="#2677d4" stroke-width="${1 / z}" style="cursor:${HANDLE_CURSOR[name]}"/>`;
  }
  ui.innerHTML = out + marquee;
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
  state.bgCanvas = null; buildBgCanvas(bg);
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
    for (const [id, text] of Object.entries(d.emoji || {})) { // emoji that came from outside the bundled set travel inside the file
      if (typeof text === 'string' && text.length < 1000000 && !emojiLib.has(id)) addEmoji(id, 'embedded emoji', text, 'doc');
    }
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
  state.sels = state.sels.filter(byId);
  render(); syncProps(); refreshNum();
}
function undo() { if (!state.undo.length) return; commitEdit(); state.redo.push(snapshot()); restore(state.undo.pop()); }
function redo() { if (!state.redo.length) return; commitEdit(); state.undo.push(snapshot()); restore(state.redo.pop()); }
function updateButtons() {
  $('bUndo').disabled = !state.undo.length;
  $('bRedo').disabled = !state.redo.length;
  $('bDel').disabled = !state.sels.length;
  $('bCopyStyle').disabled = !state.sels.length;
  $('bPasteStyle').disabled = !state.sels.length || !styleClip;
  const has = state.loaded;
  for (const id of ['bSave', 'bSaveAs', 'bPng', 'bCopy']) $(id).disabled = !has;
}

// ------------------------------------------------------------------ per-tool options
const RED = '#ff0000', WHITE = '#ffffff', YELLOW = '#ffff00';
const ALPHA = { sa: 1, fa: 1, ta: 1 };
const SHADOW_DEFAULT = { sh: false, shz: 4 };
const LINE_OPTS = { stroke: RED, sw: 4, hs: false, he: false, hz: 20 };
const BOX_OPTS = { fill: RED, fillOn: true, stroke: WHITE, sw: 3, tc: WHITE, size: 24, bold: false };
const DEFAULT_OPTS = {
  rect: { stroke: RED, sw: 4, fill: YELLOW, fillOn: false },
  ellipse: { stroke: RED, sw: 4, fill: YELLOW, fillOn: false },
  line: { ...LINE_OPTS },
  arrow: { ...LINE_OPTS, he: true },
  pen: { ...LINE_OPTS },
  bezier: { ...LINE_OPTS, fill: RED, fillOn: false },
  text: { tc: WHITE, stroke: RED, sw: 5, size: 28, bold: true }, // white text with a red outline
  textbox: { ...BOX_OPTS },
  balloon: { ...BOX_OPTS },
  highlight: { fill: YELLOW, fa: 0.5, stroke: RED, sw: 0 },
  ocr: {},
  emoji: { size: 96, key: DEFAULT_EMOJI },
  blur: { amt: 12 },
  pixelate: { amt: 12 },
  step: { fill: RED, tc: WHITE, size: 36, stroke: WHITE, sw: 0 }, // numbered red circle
};
const OPTS_KEY = 'sharev.toolopts.v1';
const toolOpts = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') || {}; } catch { /* storage unavailable */ }
  const o = {};
  for (const k of Object.keys(DEFAULT_OPTS)) o[k] = { ...ALPHA, ...(SHADOWY.has(k) ? SHADOW_DEFAULT : {}), ...DEFAULT_OPTS[k], ...(saved[k] || {}) };
  return o;
})();
let saveTimer = 0;
/** Persist tool options + custom colours: localStorage (fallback) and ShareV-Data/ui-settings.json (portable). */
function persistOpts() {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(toolOpts)); } catch { /* ignore */ }
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favEmoji)); } catch { /* ignore */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (window.api.saveUi) window.api.saveUi(settingsJson()).catch(() => {}); }, 400);
}
const FAV_KEY = 'sharev.favemoji';
// pinned by default: cross, check, smile, laughing, grimace, exploding head (used until the user changes their favourites)
const DEFAULT_FAVS = ['b:u274c', 'b:u2714', 'b:u1f60a', 'b:u1f923', 'b:u1f62c', 'b:u1f92f'];
let favEmoji = [...DEFAULT_FAVS];
try {
  const raw = localStorage.getItem(FAV_KEY);
  if (raw !== null) favEmoji = (JSON.parse(raw) || []).filter((x) => typeof x === 'string').slice(0, 200);
} catch { /* ignore */ }
const settingsJson = () => JSON.stringify({ app: 'ShareV', version: 1, toolOpts, customColors, bakeFx: state.bakeFx, favEmoji, calc: window.ShareVCalc ? window.ShareVCalc.getState() : undefined }, null, 2);
function applySettings(obj) {
  const src = (obj && obj.toolOpts) || {};
  for (const k of Object.keys(DEFAULT_OPTS)) {
    const clean = {};
    for (const [key, val] of Object.entries(src[k] || {})) if (key in DEFAULT_OPTS[k] || key in ALPHA || key in SHADOW_DEFAULT) clean[key] = val;
    toolOpts[k] = { ...ALPHA, ...(SHADOWY.has(k) ? SHADOW_DEFAULT : {}), ...DEFAULT_OPTS[k], ...clean };
  }
  if (obj && obj.calc && window.ShareVCalc) window.ShareVCalc.setState(obj.calc); // history survives a reset, comes back on import
  state.bakeFx = !(obj && obj.bakeFx === false);
  if (obj && Array.isArray(obj.favEmoji)) { favEmoji = obj.favEmoji.filter((x) => typeof x === 'string').slice(0, 200); if (typeof renderPicker === 'function' && !ep.hidden) renderPicker(); }
  if (typeof refreshBakeLabel === 'function') refreshBakeLabel();
  customColors = Array.isArray(obj && obj.customColors) ? obj.customColors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 16) : [];
  const type = ctxType();
  if (type && state.tool !== 'select') loadOpts(type);
  updateControls();
}

const P = {
  stroke: $('pStroke'), fill: $('pFill'), fillOn: $('pFillOn'), text: $('pText'),
  width: $('pWidth'), size: $('pSize'), bold: $('pBold'),
  strokeA: $('pStrokeA'), fillA: $('pFillA'), textA: $('pTextA'),
  headStart: $('pHeadStart'), headEnd: $('pHeadEnd'), headSize: $('pHeadSize'), num: $('pNum'),
  amount: $('pAmount'), shadow: $('pShadow'), shadowSize: $('pShadowSize'),
};
const KEYMAP = {
  stroke: 'stroke', fill: 'fill', fillOn: 'fillOn', text: 'tc', width: 'sw', size: 'size', bold: 'bold',
  strokeA: 'sa', fillA: 'fa', textA: 'ta', headStart: 'hs', headEnd: 'he', headSize: 'hz',
  amount: 'amt', shadow: 'sh', shadowSize: 'shz',
};
const LINEY = ['stroke', 'width', 'headStart', 'headEnd', 'headSize'];
const BOXY = ['stroke', 'fill', 'fillOn', 'text', 'width', 'size', 'bold'];
const RELEVANT = {
  rect: ['stroke', 'fill', 'fillOn', 'width'], ellipse: ['stroke', 'fill', 'fillOn', 'width'],
  line: LINEY, arrow: LINEY, pen: LINEY, bezier: [...LINEY, 'fill', 'fillOn'],
  text: ['text', 'stroke', 'width', 'size', 'bold'], textbox: BOXY, balloon: BOXY, highlight: ['stroke', 'fill', 'width'],
  step: ['fill', 'text', 'stroke', 'width', 'size', 'num'],
  blur: ['amount'], pixelate: ['amount'], ocr: [], emoji: ['size', 'emoji'],
};
for (const k of Object.keys(RELEVANT)) if (SHADOWY.has(k)) RELEVANT[k] = [...RELEVANT[k], 'shadow', 'shadowSize'];
const AMOUNT_LABEL = { blur: 'Radius', pixelate: 'Block' };
const STROKE_LABEL = { text: 'Outline', textbox: 'Border', balloon: 'Border', step: 'Border' };
const SIZE_LABEL = { step: 'Size', emoji: 'Size' };
const maxStep = () => state.shapes.reduce((m, s) => (s.type === 'step' ? Math.max(m, s.n) : m), 0);
const nextStep = () => (state.stepOverride ?? maxStep() + 1);
function refreshNum() { if (state.tool === 'step') P.num.value = nextStep(); }

/** The tool whose options the toolbar currently edits: the active tool, or the selected shape's type. */
function ctxType() {
  if (state.tool !== 'select') return state.tool;
  const ts = [...new Set(selShapes().map((s) => s.type))];
  return ts.length === 1 ? ts[0] : ts.length ? 'mixed' : null;
}
function relevantKeys(type) {
  if (type !== 'mixed') return RELEVANT[type] || [];
  return [...new Set(selShapes().flatMap((s) => RELEVANT[s.type] || []))];
}
function updateControls() {
  const type = ctxType();
  const rel = relevantKeys(type);
  for (const k of Object.keys(P)) {
    const label = P[k].closest('label');
    const base = /A$/.test(k) && k !== 'fillOn' ? k.slice(0, -1) : k; // opacity sliders follow their colour
    label.hidden = !type || !rel.includes(base) || (base === 'num' && state.tool === 'select' && state.sels.length > 1);
  }
  const first = P.stroke.closest('label').firstChild;
  if (first && first.nodeType === 3) first.nodeValue = (STROKE_LABEL[type] || 'Line') + ' ';
  const showEmoji = rel.includes('emoji');
  $('pEmojiLbl').hidden = !showEmoji;
  if (showEmoji) refreshEmojiBtn();
  const am = P.amount.closest('label').querySelector('.lbl');
  if (am) am.textContent = AMOUNT_LABEL[type] || 'Radius';
  const sz = P.size.closest('label').firstChild;
  if (sz && sz.nodeType === 3) sz.nodeValue = (SIZE_LABEL[type] || 'Font') + ' ';
}
function loadOpts(type) {
  const o = toolOpts[type];
  if (!o) return;
  if ('stroke' in o) P.stroke.value = o.stroke;
  if ('fill' in o) P.fill.value = o.fill;
  if ('fillOn' in o) P.fillOn.checked = o.fillOn;
  if ('tc' in o) P.text.value = o.tc;
  if ('sw' in o) P.width.value = o.sw;
  if ('size' in o) P.size.value = o.size;
  if ('bold' in o) P.bold.checked = o.bold;
  P.strokeA.value = Math.round((o.sa ?? 1) * 100);
  P.fillA.value = Math.round((o.fa ?? 1) * 100);
  P.textA.value = Math.round((o.ta ?? 1) * 100);
  if ('amt' in o) P.amount.value = o.amt;
  if ('sh' in o) { P.shadow.checked = o.sh; P.shadowSize.value = o.shz; }
  if ('hs' in o) { P.headStart.checked = o.hs; P.headEnd.checked = o.he; P.headSize.value = o.hz; }
}
function syncProps() {
  const s = byId(state.sel);
  if (s) {
    if (s.stroke) P.stroke.value = s.stroke;
    if (s.fill && s.fill !== 'none') P.fill.value = s.fill;
    if ('fill' in s && s.type !== 'highlight') P.fillOn.checked = s.fill !== 'none';
    if (s.tc) P.text.value = s.tc;
    if ('sw' in s) P.width.value = s.sw;
    if (s.size) P.size.value = s.size;
    if ('bold' in s) P.bold.checked = !!s.bold;
    P.strokeA.value = Math.round((s.sa ?? 1) * 100);
    P.fillA.value = Math.round((s.fa ?? (s.type === 'highlight' ? 0.5 : 1)) * 100);
    P.textA.value = Math.round((s.ta ?? 1) * 100);
    if (s.type === 'step') P.num.value = s.n;
    if ('amt' in s) P.amount.value = s.amt;
    if (s.type === 'emoji') P.size.value = Math.round(s.w);
    if (SHADOWY.has(s.type)) { P.shadow.checked = !!s.sh; P.shadowSize.value = s.shz || 4; }
    if (HEADY.has(s.type)) { P.headStart.checked = headOn(s, false); P.headEnd.checked = headOn(s, true); P.headSize.value = Math.round(headLen(s)); }
  }
  updateControls();
}
let propPre = null;
function onProp(key) {
  return () => {
    const el = P[key];
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'num' && state.tool === 'step') { state.stepOverride = Math.max(0, Math.round(+el.value || 0)); return; }
    const isAlpha = /A$/.test(key) && key !== 'fillOn';
    const store = isAlpha ? clamp((+v || 0) / 100, 0, 1) : ['width', 'size', 'headSize', 'amount', 'shadowSize'].includes(key) ? +v || 0 : v;
    if (isAlpha) el.title = el.title.replace(/ \d+%$/, '') + ` ${Math.round(store * 100)}%`;
    // remember the value for the tool (or the selected shape's tool) it belongs to
    const ctx = ctxType();
    const types = ctx === 'mixed' ? [...new Set(selShapes().map((x) => x.type))] : [ctx];
    for (const type of types) {
      if (type && toolOpts[type] && KEYMAP[key] && KEYMAP[key] in toolOpts[type]) toolOpts[type][KEYMAP[key]] = store;
    }
    persistOpts();
    if (state.tool !== 'select' || !state.sels.length) return;
    if (propPre === null) propPre = snapshot();
    for (const s of selShapes()) applyProp(s, key, v, store);
    render();
  };
}
function applyProp(s, key, v, store) {
  {
    switch (key) {
      case 'stroke': if ('stroke' in s) s.stroke = v; break;
      case 'fill': if (s.type === 'highlight' || (s.fill && s.fill !== 'none')) s.fill = v; break;
      case 'fillOn': if (s.type !== 'highlight' && 'fill' in s) s.fill = v ? P.fill.value : 'none'; break;
      case 'text': if (TEXTY.has(s.type)) s.tc = v; break;
      case 'width': if ('sw' in s) s.sw = clamp(+v || 0, ['text', 'highlight', 'step'].includes(s.type) ? 0 : 1, 60); break;
      case 'size':
        if (s.type === 'emoji') { const n = clamp(+v || 8, 8, 4000); s.x += (s.w - n) / 2; s.y += (s.h - n) / 2; s.w = s.h = n; }
        else if ('size' in s) s.size = clamp(+v || 12, 6, 400);
        break;
      case 'amount': if (FX.has(s.type)) s.amt = clamp(Math.round(+v || 1), 1, 200); break;
      case 'shadow': if (SHADOWY.has(s.type)) s.sh = v; break;
      case 'shadowSize': if (SHADOWY.has(s.type)) s.shz = clamp(Math.round(+v || 4), 1, 40); break;
      case 'num': if (s.type === 'step' && state.sels.length === 1) s.n = Math.max(0, Math.round(+v || 0)); break;
      case 'bold': if ('bold' in s) s.bold = v; break;
      case 'strokeA': s.sa = store; break;
      case 'fillA': s.fa = store; break;
      case 'textA': s.ta = store; break;
      case 'headStart': if (HEADY.has(s.type)) s.hs = v; break;
      case 'headEnd': if (HEADY.has(s.type)) s.he = v; break;
      case 'headSize': if (HEADY.has(s.type)) s.hz = clamp(+v || 20, 4, 200); break;
    }
  }
}
for (const k of Object.keys(P)) {
  P[k].addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') P[k].blur(); });
  P[k].addEventListener('input', onProp(k));
  P[k].addEventListener('change', () => { onProp(k)(); if (propPre !== null) { pushUndo(propPre); propPre = null; } });
}

// ------------------------------------------------------------------ tools
function setTool(t) {
  commitEdit();
  finishBezier();
  state.tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  svg.style.cursor = t === 'select' ? 'default' : t === 'painter' ? 'copy' : 'crosshair';
  if (t === 'painter') flash(styleClip ? 'Style painter: click shapes to apply the copied style (Shift-click picks a new one, Esc to finish)' : 'Style painter: click a shape to copy its style, then click others to apply it');
  state.stepOverride = null;
  if (t !== 'select') loadOpts(t);
  updateControls();
  refreshNum();
  renderUI();
}

function finishBezier() {
  const s = state.bz;
  if (!s) return;
  state.bz = null; state.bzHover = null;
  if (s.nodes.length < 2) {
    state.shapes = state.shapes.filter((x) => x !== s);
    state.sel = null;
  } else {
    pushUndo(state.bzPre);
    state.sel = s.id;
    setTool('select');
  }
  render();
}

function newShape(tool, p) {
  const s = newShape0(tool, p);
  const o = toolOpts[tool];
  if (SHADOWY.has(tool)) { s.sh = !!o.sh; s.shz = o.shz; }
  return s;
}
function newShape0(tool, p) {
  const o = toolOpts[tool];
  const alpha = { sa: o.sa, fa: o.fa, ta: o.ta };
  const base = { id: state.nextId++, type: tool, ...alpha };
  const heads = { hs: !!o.hs, he: !!o.he, hz: o.hz };
  const filled = o.fillOn ? o.fill : 'none';
  const txt = { text: '', size: o.size, bold: !!o.bold, tc: o.tc };
  switch (tool) {
    case 'rect': case 'ellipse':
      return { ...base, x: p.x, y: p.y, w: 0, h: 0, stroke: o.stroke, sw: o.sw, fill: filled };
    case 'line': case 'arrow':
      return { ...base, x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: o.stroke, sw: o.sw, ...heads };
    case 'pen':
      return { ...base, pts: [[p.x, p.y]], stroke: o.stroke, sw: o.sw, ...heads };
    case 'bezier':
      return { ...base, nodes: [], closed: false, stroke: o.stroke, sw: o.sw, fill: filled, ...heads };
    case 'text':
      return { ...base, x: p.x, y: p.y, stroke: o.stroke, sw: o.sw, ...txt };
    case 'textbox':
      return { ...base, x: p.x, y: p.y, w: 0, h: 0, stroke: o.stroke, sw: o.sw, fill: filled, ...txt };
    case 'balloon':
      return { ...base, x: p.x, y: p.y, w: 0, h: 0, tx: p.x, ty: p.y, stroke: o.stroke, sw: o.sw, fill: filled, ...txt };
    case 'highlight':
      return { ...base, x: p.x, y: p.y, w: 0, h: 0, fill: o.fill, stroke: o.stroke, sw: o.sw };
    case 'blur': case 'pixelate':
      return { ...base, x: p.x, y: p.y, w: 0, h: 0, amt: o.amt };
    case 'ocr':
      return { ...base, x: p.x, y: p.y, w: 0, h: 0 };
    case 'emoji':
      return { ...base, x: p.x, y: p.y, w: 0, h: 0, key: emojiLib.has(o.key) ? o.key : DEFAULT_EMOJI };
    case 'step': {
      const n = nextStep();
      state.stepOverride = null;
      return { ...base, x: p.x, y: p.y, n, fill: o.fill, tc: o.tc, size: o.size, stroke: o.stroke, sw: o.sw };
    }
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
  if (o.nodes) s.nodes = o.nodes.map((n) => ({ x: n.x + dx, y: n.y + dy, hx: n.hx + dx, hy: n.hy + dy }));
}

// ------------------------------------------------------------------ pointer interaction
let drag = null;
const pt = (e) => {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
};

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state.loaded) return;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // re-enable shortcuts
  commitEdit();
  const p = pt(e);
  const pre = snapshot();
  if (state.tool === 'painter') { // format painter: the first click (or Shift-click) picks the style, further clicks apply it
    const hit = e.target.closest && e.target.closest('[data-id]');
    const s = hit && byId(+hit.dataset.id);
    if (s) {
      if (!styleClip || e.shiftKey) copyStyleFrom(s);
      else { const pre = snapshot(); applyStyleTo(s, styleClip); pushUndo(pre); state.sel = s.id; render(); syncProps(); }
    }
    e.preventDefault();
    return;
  }
  if (state.tool === 'bezier') {
    let s = state.bz;
    if (!s) {
      s = newShape('bezier', p);
      state.shapes.push(s);
      state.bz = s; state.bzPre = pre; state.sel = s.id;
    } else {
      const f = s.nodes[0];
      if (s.nodes.length >= 3 && Math.hypot(p.x - f.x, p.y - f.y) * state.zoom < 10) { s.closed = true; finishBezier(); return; }
    }
    const node = { x: p.x, y: p.y, hx: p.x, hy: p.y };
    s.nodes.push(node);
    drag = { kind: 'bnode', s, node };
    svg.setPointerCapture(e.pointerId);
    render();
    e.preventDefault();
    return;
  }
  if (state.tool === 'select') {
    const h = e.target.dataset && e.target.dataset.h;
    const hitEl = e.target.closest && e.target.closest('[data-id]');
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (h && state.sels.length === 1 && byId(state.sel)) {
      drag = { kind: 'resize', pre, handle: h, s: byId(state.sel), orig: JSON.parse(pre).find((x) => x.id === state.sel) };
    } else if (hitEl) {
      const id = +hitEl.dataset.id;
      if (additive) {
        // shift/ctrl-click toggles membership in the selection
        state.sels = state.sels.includes(id) ? state.sels.filter((x) => x !== id) : [...state.sels, id];
      } else if (!state.sels.includes(id)) {
        state.sel = id; // clicking a member of a multi-selection keeps it, so the group can be dragged
      } else {
        state.sels = [...state.sels.filter((x) => x !== id), id]; // make it the primary
      }
      syncProps();
      if (state.sels.includes(id)) {
        const all = JSON.parse(pre);
        drag = { kind: 'move', pre, start: p, moved: false, ids: [...state.sels], origs: Object.fromEntries(all.filter((x) => state.sels.includes(x.id)).map((x) => [x.id, x])) };
      }
    } else {
      // empty canvas: rubber-band selection (shift/ctrl adds to the current selection)
      if (!additive) state.sels = [];
      drag = { kind: 'marquee', start: p, base: [...state.sels] };
      syncProps();
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
  if (!drag) {
    if (state.bz) { state.bzHover = p; renderUI(); }
    return;
  }
  const { s } = drag;
  if (drag.kind === 'marquee') {
    const r = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
    state.marquee = r;
    const hit = state.shapes.filter((sh) => { const b = bounds(sh); return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y; }).map((sh) => sh.id);
    state.sels = [...drag.base.filter((id) => !hit.includes(id)), ...hit];
    syncProps();
  } else if (drag.kind === 'bnode') {
    drag.node.hx = p.x; drag.node.hy = p.y;
  } else if (drag.kind === 'create') {
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * state.zoom > 3) drag.moved = true;
    switch (s.type) {
      case 'step': s.x = p.x; s.y = p.y; break;
      case 'emoji': setBox(s, drag.start, p, true); break;
      case 'rect': case 'ellipse': setBox(s, drag.start, p, e.shiftKey); break;
      case 'highlight': case 'textbox': case 'balloon': case 'blur': case 'pixelate': case 'ocr': setBox(s, drag.start, p, false); break;
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
    for (const id of drag.ids) { const sh = byId(id); if (sh) moveBy(sh, drag.origs[id], dx, dy); }
  } else if (drag.kind === 'resize') {
    const o = drag.orig, h = drag.handle;
    if (s.type === 'bezier') {
      const i = +h.slice(1), n = s.nodes[i], on = o.nodes[i];
      if (h[0] === 'n') { n.x = p.x; n.y = p.y; n.hx = on.hx + (p.x - on.x); n.hy = on.hy + (p.y - on.y); }
      else if (h[0] === 'h') { n.hx = p.x; n.hy = p.y; }
      else { n.hx = 2 * n.x - p.x; n.hy = 2 * n.y - p.y; }
    } else if (s.type === 'emoji') { // square, scaled from the opposite corner
      const ax = h.includes('w') ? o.x + o.w : o.x, ay = h.includes('n') ? o.y + o.h : o.y;
      const size = Math.max(8, Math.abs(p.x - ax), Math.abs(p.y - ay));
      s.w = s.h = size;
      s.x = h.includes('w') ? ax - size : ax;
      s.y = h.includes('n') ? ay - size : ay;
    } else if (h === 'p1') { const q = e.shiftKey ? snap45({ x: o.x2, y: o.y2 }, p) : p; s.x1 = q.x; s.y1 = q.y; }
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
  if (d.kind === 'bnode') { render(); return; }
  if (d.kind === 'marquee') { state.marquee = null; syncProps(); render(); return; }
  if (d.kind === 'create') {
    if (s.type === 'emoji') { // stamp: a click drops the default size, a drag sizes it; the tool stays active
      if (!d.moved) { const size = toolOpts.emoji.size; s.w = s.h = size; s.x = d.start.x - size / 2; s.y = d.start.y - size / 2; }
      else if (s.w < 8) { state.shapes = state.shapes.filter((x) => x !== s); state.sel = null; render(); return; }
      else { toolOpts.emoji.size = Math.round(s.w); persistOpts(); P.size.value = toolOpts.emoji.size; }
      pushUndo(d.pre); state.sel = s.id; render(); return;
    }
    if (s.type === 'ocr') { // region picker only: nothing is stored
      state.shapes = state.shapes.filter((x) => x !== s); state.sel = null;
      setTool('select'); render();
      if (s.w > 4 && s.h > 4) runOcr({ x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h) });
      return;
    }
    if (s.type === 'step') { // stays on the tool: every click drops the next number
      pushUndo(d.pre); state.sel = s.id; render(); refreshNum(); return;
    }
    if (s.type === 'pen') s.pts = smoothPts(s.pts);
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
  const bz = state.bz;
  if (bz) { // the double click's two clicks each added a node: drop the duplicate
    const n = bz.nodes;
    if (n.length > 2 && Math.hypot(n[n.length - 1].x - n[n.length - 2].x, n[n.length - 1].y - n[n.length - 2].y) * state.zoom < 6) n.pop();
    finishBezier();
    return;
  }
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
  const outlined = s.type === 'text' && s.sw > 0;
  ta.style.webkitTextStroke = outlined ? `${s.sw * 2 * z}px ${s.stroke}` : '0';
  ta.style.paintOrder = 'stroke fill';
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
  ann.innerHTML = state.shapes.filter((x) => !FX.has(x.type)).map((x) => shapeSvg(x, true)).join('');
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
  const sel = selShapes();
  if (!sel.length) return;
  const pre = snapshot();
  state.shapes = state.shapes.filter((x) => !sel.includes(x));
  state.sel = null;
  pushUndo(pre); render(); syncProps();
}
function duplicateSel() {
  const sel = selShapes();
  if (!sel.length) return;
  const pre = snapshot();
  const ids = [];
  for (const s of sel) {
    const c = JSON.parse(JSON.stringify(s, (k, v) => (k[0] === '_' ? undefined : v)));
    c.id = state.nextId++;
    moveBy(c, s, 16, 16);
    state.shapes.push(c); ids.push(c.id);
  }
  state.sels = ids;
  pushUndo(pre); render();
}
function reorder(dir) {
  const sel = state.shapes.filter((x) => state.sels.includes(x.id)); // keep their relative order
  if (!sel.length) return;
  const pre = snapshot();
  const rest = state.shapes.filter((x) => !sel.includes(x));
  state.shapes = dir > 0 ? [...rest, ...sel] : [...sel, ...rest];
  pushUndo(pre); render();
}
function nudge(dx, dy) {
  const sel = selShapes();
  if (!sel.length) return;
  const pre = snapshot();
  for (const s of sel) moveBy(s, JSON.parse(JSON.stringify(s)), dx, dy);
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

// ------------------------------------------------------------------ OCR sidebar
const side = $('side'), ocrLinesEl = $('ocrLines'), ocrStatus = $('ocrStatus');
const ocrState = { lines: [], busy: false };
/** One sidebar at a time: 'ocr', 'calc' or null (both closed). */
function openPanel(which) {
  side.hidden = which !== 'ocr';
  $('calcSide').hidden = which !== 'calc';
  if (state.loaded) fit();
}
window.__openPanel = openPanel;
function openSide(on = true) { openPanel(on ? 'ocr' : null); }
function showHl(box) {
  $('hl').innerHTML = box
    ? `<rect x="${box.x - 3}" y="${box.y - 3}" width="${box.w + 6}" height="${box.h + 6}" fill="rgba(255,176,32,.18)" stroke="#ffb020" stroke-width="${2 / state.zoom}" stroke-dasharray="${5 / state.zoom} ${3 / state.zoom}"/>` : '';
}
function renderSide() {
  ocrLinesEl.innerHTML = ocrState.lines.map((l, i) =>
    `<div class="ln" data-i="${i}"><textarea rows="1" spellcheck="false">${esc(l.text)}</textarea>` +
    `<button data-a="copy" title="Copy this line">&#10064;</button><button data-a="place" title="Place this line as SVG text">T</button></div>`).join('');
  ocrLinesEl.querySelectorAll('textarea').forEach((x) => { x.style.height = '0'; x.style.height = x.scrollHeight + 'px'; });
}
function copyText(text) {
  return window.api.copyText ? window.api.copyText(text) : navigator.clipboard.writeText(text);
}
window.__copyText = copyText; window.__flash = (m) => flash(m); window.__persist = () => persistOpts();
/** OCR the whole image (rect omitted) or a region. Blur/pixelate are burned in first, so redacted text is never read. */
async function runOcr(rect) {
  if (!state.loaded || ocrState.busy) return;
  openSide();
  if (!window.api.ocr) { ocrStatus.textContent = 'Text recognition is not available here.'; return; }
  ocrState.busy = true;
  ocrStatus.textContent = 'Recognising…';
  try {
    const full = bakedCanvas();
    let canvas = full;
    if (rect) {
      canvas = document.createElement('canvas');
      canvas.width = rect.w; canvas.height = rect.h;
      canvas.getContext('2d').drawImage(full, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    }
    const res = await window.api.ocr(canvas.toDataURL('image/png'));
    const ox = rect ? rect.x : 0, oy = rect ? rect.y : 0;
    ocrState.lines = res.lines.map((l) => ({ text: l.text, x: l.x + ox, y: l.y + oy, w: l.w, h: l.h }));
    ocrStatus.textContent = ocrState.lines.length
      ? `${ocrState.lines.length} line${ocrState.lines.length === 1 ? '' : 's'} recognised${res.language ? ' (' + res.language + ')' : ''}${rect ? ' in the region' : ''}.`
      : 'No text found.';
    renderSide();
  } catch (err) {
    ocrStatus.textContent = 'Error: ' + (err && err.message || err);
  } finally { ocrState.busy = false; }
}
/** Median colour of a 3px ring around the box = background; mean of strongly-different pixels inside = text colour. */
function analyzeBox(b) {
  const bg = state.bgCanvas, g = bg.getContext('2d', { willReadFrequently: true });
  const x0 = clamp(Math.floor(b.x) - 3, 0, bg.width - 1), y0 = clamp(Math.floor(b.y) - 3, 0, bg.height - 1);
  const x1 = clamp(Math.ceil(b.x + b.w) + 3, 1, bg.width), y1 = clamp(Math.ceil(b.y + b.h) + 3, 1, bg.height);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const d = g.getImageData(x0, y0, w, h).data;
  const ring = [[], [], []], inner = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const edge = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
    if (edge) { ring[0].push(d[i]); ring[1].push(d[i + 1]); ring[2].push(d[i + 2]); } else inner.push([d[i], d[i + 1], d[i + 2]]);
  }
  const med = (a) => { a.sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 255; };
  const bgc = [med(ring[0]), med(ring[1]), med(ring[2])];
  const far = inner.filter((p) => Math.hypot(p[0] - bgc[0], p[1] - bgc[1], p[2] - bgc[2]) > 110);
  const lum = 0.299 * bgc[0] + 0.587 * bgc[1] + 0.114 * bgc[2];
  let fg = lum > 140 ? [0, 0, 0] : [255, 255, 255];
  if (far.length > 4) fg = [0, 1, 2].map((k) => Math.round(far.reduce((s, p) => s + p[k], 0) / far.length));
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  return { bg: hex(bgc), fg: hex(fg) };
}
function textShapeFor(l, cover) {
  const { bg, fg } = analyzeBox(l);
  let size = clamp(Math.round(l.h * 0.85), 8, 160);
  const m = measure(l.text, size, false);
  if (m > 0) size = clamp(Math.round(size * clamp(l.w / m, 0.65, 1.5)), 8, 160); // match the original line width
  const base = { sa: 1, fa: 1, ta: 1, sh: false, shz: 4 };
  const out = [];
  if (cover) out.push({ id: state.nextId++, type: 'rect', x: l.x - 2, y: l.y - 2, w: l.w + 4, h: l.h + 4, stroke: bg, sw: 0, fill: bg, ...base });
  out.push({ id: state.nextId++, type: 'text', x: l.x, y: l.y + (l.h - size * 1.25) / 2, text: l.text, size, bold: false, tc: fg, stroke: '#000000', sw: 0, ...base });
  return out;
}
function placeLines(lines) {
  if (!lines.length || !state.bgCanvas) return;
  const pre = snapshot();
  const cover = $('ocrCover').checked;
  const made = lines.flatMap((l) => textShapeFor(l, cover));
  state.shapes.push(...made);
  state.sels = made.filter((s) => s.type === 'text').map((s) => s.id);
  pushUndo(pre); render(); syncProps();
  flash(`${lines.length} SVG text line${lines.length === 1 ? '' : 's'} placed`);
}
$('bOcr').onclick = () => { openSide(); runOcr(); };
$('bCalc').onclick = toggleCalc;
$('bSim').onclick = () => window.ShareVSim && window.ShareVSim.open();
$('ocrAll').onclick = () => runOcr();
$('ocrRegion').onclick = () => { if (state.loaded) setTool('ocr'); };
$('sideClose').onclick = () => { openSide(false); showHl(null); };
$('ocrCopy').onclick = () => guard(async () => { await copyText(ocrState.lines.map((l) => l.text).join('\n')); flash('Text copied'); });
$('ocrPlace').onclick = () => placeLines(ocrState.lines);
ocrLinesEl.addEventListener('input', (e) => {
  const row = e.target.closest('.ln');
  if (!row) return;
  ocrState.lines[+row.dataset.i].text = e.target.value;
  e.target.style.height = '0'; e.target.style.height = e.target.scrollHeight + 'px';
});
ocrLinesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button'), row = e.target.closest('.ln');
  if (!btn || !row) return;
  const l = ocrState.lines[+row.dataset.i];
  if (btn.dataset.a === 'copy') guard(async () => { await copyText(l.text); flash('Line copied'); });
  else placeLines([l]);
});
ocrLinesEl.addEventListener('mouseover', (e) => { const row = e.target.closest('.ln'); showHl(row ? ocrState.lines[+row.dataset.i] : null); });
ocrLinesEl.addEventListener('mouseleave', () => showHl(null));

// ------------------------------------------------------------------ emoji picker
for (const e of window.BLOB_EMOJI || []) addEmoji('b:' + e.i, e.n, e.s, 'blob', { char: e.c });
function loadUserEmoji() {
  if (!window.api.emojiList) return;
  window.api.emojiList().then((list) => {
    for (const f of list || []) addEmoji('u:' + f.file, f.file.replace(/\.svg$/i, '').replace(/[_-]+/g, ' '), f.svg, 'user', { file: f.file });
    if (!ep.hidden) renderPicker();
  }).catch(() => {});
}
const ep = $('emojiPicker'), egrid = $('emojiGrid'), estatus = $('emojiStatus');
const currentEmojiKey = () => {
  const s = state.tool === 'select' ? selShapes().find((x) => x.type === 'emoji') : null;
  return s ? s.key : toolOpts.emoji.key;
};
function refreshEmojiBtn() {
  const it = emojiLib.get(currentEmojiKey()) || emojiLib.get(DEFAULT_EMOJI);
  $('pEmoji').innerHTML = it ? `<img alt="" src="${emojiThumb(it)}">` : '';
  $('pEmoji').title = it ? `Emoji: ${it.name}. Click to choose another.` : 'Choose emoji';
}
function renderPicker() {
  const q = $('emojiSearch').value.trim().toLowerCase().replace(/\ufe0f/g, '');
  const cur = currentEmojiKey();
  const match = (it) => !q || it.name.toLowerCase().includes(q) || (it.char && it.char.replace(/\ufe0f/g, '').includes(q)) || it.id.toLowerCase().includes(q);
  const groups = [['Favourites', 'fav'], ['My emoji', 'user'], ['In this document', 'doc'], ['Emoji', 'blob']];
  let html = '', any = false;
  for (const [title, g] of groups) {
    const items = g === 'fav'
      ? favEmoji.map((id) => emojiLib.get(id)).filter((it) => it && !it.bad && match(it))
      : [...emojiLib.values()].filter((it) => it.group === g && !it.bad && match(it));
    if (!items.length) continue;
    any = true;
    html += `<h4>${g === 'fav' ? '&#9733; ' : ''}${title}</h4>` + items.map((it) => {
      const th = emojiThumb(it), fav = favEmoji.includes(it.id);
      return th ? `<button class="em${it.id === cur ? ' cur' : ''}${fav ? ' isfav' : ''}" data-id="${esc(it.id)}" title="${esc(it.name)}  (right-click or &#9733; to ${fav ? 'unpin' : 'pin to the top'})"><img alt="" src="${th}"><span class="fav" data-fav="1">${fav ? '&#9733;' : '&#9734;'}</span>${g === 'user' ? '<span class="del" data-del="1" title="Remove from my emoji">&times;</span>' : ''}</button>` : '';
    }).join('');
  }
  egrid.innerHTML = any ? html : '<div class="none">No match. Paste an emoji (or its hex code) below to fetch it from svgmoji, or import your own SVG files.</div>';
}
function showEmojiPicker(anchor) {
  if (!ep.hidden && ep.dataset.anchor === anchor.id + anchor.dataset.tool) { hideEmojiPicker(); return; }
  ep.dataset.anchor = anchor.id + anchor.dataset.tool;
  $('emojiSearch').value = '';
  renderPicker();
  ep.hidden = false;
  const r = anchor.getBoundingClientRect();
  ep.style.left = Math.max(8, Math.min(r.left, innerWidth - ep.offsetWidth - 8)) + 'px';
  ep.style.top = Math.min(r.bottom + 6, Math.max(8, innerHeight - ep.offsetHeight - 8)) + 'px';
  $('emojiSearch').focus();
}
function hideEmojiPicker() { ep.hidden = true; ep.dataset.anchor = ''; }
function chooseEmoji(id) {
  toolOpts.emoji.key = id;
  persistOpts();
  const targets = state.tool === 'select' ? selShapes().filter((s) => s.type === 'emoji') : [];
  if (targets.length) { const pre = snapshot(); targets.forEach((s) => { s.key = id; }); pushUndo(pre); render(); }
  else if (state.tool !== 'emoji') setTool('emoji');
  refreshEmojiBtn();
  hideEmojiPicker();
}
/** Pin / unpin an emoji; favourites are listed first in the picker and saved with the other settings. */
function toggleFav(id) {
  favEmoji = favEmoji.includes(id) ? favEmoji.filter((x) => x !== id) : [...favEmoji, id];
  persistOpts();
  const keep = egrid.scrollTop;
  renderPicker();
  egrid.scrollTop = keep;
}
async function removeUserEmoji(id) {
  const it = emojiLib.get(id);
  if (!it || it.group !== 'user') return;
  try { if (window.api.emojiDelete) await window.api.emojiDelete(it.file); } catch { /* already gone */ }
  emojiLib.delete(id);
  if (favEmoji.includes(id)) { favEmoji = favEmoji.filter((x) => x !== id); persistOpts(); }
  if (toolOpts.emoji.key === id) { toolOpts.emoji.key = DEFAULT_EMOJI; persistOpts(); }
  renderPicker(); refreshEmojiBtn();
}
$('emojiSearch').addEventListener('input', renderPicker);
egrid.addEventListener('click', (e) => {
  const b = e.target.closest('.em');
  if (!b) return;
  if (e.target.dataset.del) { removeUserEmoji(b.dataset.id); return; }
  if (e.target.dataset.fav) { toggleFav(b.dataset.id); return; }
  chooseEmoji(b.dataset.id);
});
egrid.addEventListener('contextmenu', (e) => { const b = e.target.closest('.em'); if (b) { e.preventDefault(); toggleFav(b.dataset.id); } });
document.addEventListener('mousedown', (e) => { if (!ep.hidden && !ep.contains(e.target) && !e.target.closest('#pEmoji, [data-tool="emoji"]')) hideEmojiPicker(); });
$('pEmoji').addEventListener('click', (e) => { e.preventDefault(); showEmojiPicker($('pEmoji')); });
document.querySelector('[data-tool="emoji"]').addEventListener('click', (e) => showEmojiPicker(e.currentTarget));

const svgmojiUrl = (set, hex) => `https://raw.githubusercontent.com/svgmoji/svgmoji/v3.2.0/packages/svgmoji__${set}/svg/${hex}.svg`;
/** "😀 🚀", "1F600", "U+1F680" or "1F468-200D-1F4BB" -> ['1F600', '1F680', ...] (svgmoji hexcodes) */
function parseEmojiInput(s) {
  const out = [];
  const isHex = (t) => /^(u\+)?[0-9a-f]{4,6}([-_+](u\+)?[0-9a-f]{2,6})*$/i.test(t) && (/[0-9]/.test(t) || /^u\+/i.test(t));
  const rest = [];
  for (const tok of s.split(/[\s,;]+/).filter(Boolean)) {
    if (isHex(tok)) out.push(tok.replace(/u\+/gi, '').replace(/[_+]/g, '-').toUpperCase());
    else rest.push(tok);
  }
  const text = rest.join(' ');
  const segs = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((x) => x.segment) : [...text];
  for (const g of segs) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(g)) out.push([...g].map((c) => c.codePointAt(0).toString(16).toUpperCase()).join('-'));
  }
  return out;
}
async function fetchEmoji() {
  const input = $('emojiFetchIn').value.trim();
  if (!input) return;
  const set = $('emojiSet').value;
  const codes = parseEmojiInput(input);
  if (!codes.length) { estatus.textContent = 'Paste an emoji or a hex code such as 1F600.'; return; }
  let added = 0, firstId = '';
  const failed = [];
  estatus.textContent = 'Fetching…';
  for (const hex of codes) {
    // svgmoji keeps variation selectors only for some emoji: try with and without FE0F
    const cands = [...new Set([hex, hex.replace(/-FE0F/g, ''), hex.includes('FE0F') ? hex : hex + '-FE0F'])];
    let text = null;
    for (const c of cands) {
      try { const r = await fetch(svgmojiUrl(set, c)); if (r.ok) { text = await r.text(); break; } } catch { /* offline: handled below */ }
    }
    if (!text || !sanitizeEmoji(text)) { failed.push(hex); continue; }
    const name = `${set}_${hex}`;
    try {
      const file = window.api.emojiSave ? await window.api.emojiSave(name, text) : name + '.svg';
      const id = 'u:' + file;
      addEmoji(id, `${set} ${hex}`, text, 'user', { file });
      firstId = firstId || id; added++;
    } catch (err) { failed.push(hex); }
  }
  estatus.textContent = (added ? `Added ${added}. ` : '') + (failed.length ? `Not found / offline: ${failed.join(', ')}` : '');
  if (added) { $('emojiFetchIn').value = ''; $('emojiSearch').value = ''; renderPicker(); }
}
async function importEmojiFiles() {
  if (!window.api.emojiImport) return;
  const files = await window.api.emojiImport();
  let added = 0;
  for (const f of files || []) {
    if (!sanitizeEmoji(f.svg)) continue;
    const file = await window.api.emojiSave(f.file, f.svg);
    addEmoji('u:' + file, file.replace(/\.svg$/i, '').replace(/[_-]+/g, ' '), f.svg, 'user', { file });
    added++;
  }
  estatus.textContent = added ? `Imported ${added} file${added === 1 ? '' : 's'}.` : 'No valid SVG files imported.';
  if (added) renderPicker();
}
$('emojiFetch').onclick = () => guard(fetchEmoji);
$('emojiFetchIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); guard(fetchEmoji); } e.stopPropagation(); });
$('emojiSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') hideEmojiPicker(); e.stopPropagation(); });
$('emojiImport').onclick = () => guard(importEmojiFiles);
loadUserEmoji();

// ------------------------------------------------------------------ colour presets
const PRESETS = [
  ['black', '#000000'], ['gray', '#808080'], ['silver', '#c0c0c0'], ['white', '#ffffff'],
  ['navy', '#000080'], ['blue', '#0000ff'], ['teal', '#008080'], ['aqua', '#00ffff'],
  ['green', '#008000'], ['lime', '#00ff00'], ['olive', '#808000'], ['yellow', '#ffff00'],
  ['maroon', '#800000'], ['red', '#ff0000'], ['purple', '#800080'], ['fuchsia', '#ff00ff'],
];
const BRAND = [['Pantone 355 C', '#039647'], ['Pantone 342 CVC', '#007256'], ['Pantone 567 C', '#173f35'], ['Pantone 417 C', '#65665c']];
const CUSTOM_KEY = 'sharev.customcolors';
let customColors = [];
try { customColors = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]').filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 16); } catch { /* ignore */ }
const palette = $('palette');
let paletteFor = null;
function setColor(input, hex) {
  input.value = hex;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function swatches(list, input) {
  return `<div class="grid">${list.map(([name, hex]) => `<button class="sw" data-hex="${hex}" title="${esc(name)} ${hex}" style="background:${hex}"></button>`).join('')}</div>`;
}
function showPalette(btn) {
  const input = $(btn.dataset.for);
  if (paletteFor === input && !palette.hidden) { hidePalette(); return; }
  paletteFor = input;
  palette.innerHTML = '<h4>Basic colours</h4>' + swatches(PRESETS, input) +
    '<h4>Brand</h4>' + swatches(BRAND, input) +
    '<h4>My colours</h4>' + (customColors.length ? swatches(customColors.map((c) => [c, c]), input) : '<div style="color:var(--dim);font-size:12px">none saved yet</div>') +
    '<button class="save">+ Save current colour</button>';
  palette.hidden = false;
  const r = btn.getBoundingClientRect();
  palette.style.left = Math.max(8, Math.min(r.left, innerWidth - palette.offsetWidth - 8)) + 'px';
  palette.style.top = r.bottom + 6 + 'px';
}
function hidePalette() { palette.hidden = true; paletteFor = null; }
document.querySelectorAll('button.pal').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showPalette(b); }));
palette.addEventListener('click', (e) => {
  const sw = e.target.closest('.sw');
  if (sw && paletteFor) { setColor(paletteFor, sw.dataset.hex); hidePalette(); return; }
  if (e.target.classList.contains('save') && paletteFor) {
    const hex = paletteFor.value.toLowerCase();
    if (!customColors.includes(hex)) customColors = [hex, ...customColors].slice(0, 16);
    persistOpts();
    const btn = document.querySelector(`button.pal[data-for="${paletteFor.id}"]`);
    paletteFor = null; showPalette(btn);
  }
});
document.addEventListener('mousedown', (e) => { if (!palette.hidden && !palette.contains(e.target) && !e.target.closest('button.pal')) hidePalette(); });

// ------------------------------------------------------------------ capture options (delay, include ShareV itself)
const capDelay = $('capDelay'), capSelf = $('capSelf');
if (window.api.getCaptureOpts) {
  window.api.getCaptureOpts().then((o) => { capDelay.value = String(o.delay); capSelf.checked = !!o.self; }).catch(() => {});
}
const saveCapOpts = () => { if (window.api.setCaptureOpts) window.api.setCaptureOpts(+capDelay.value, capSelf.checked).catch(() => {}); };
capDelay.addEventListener('change', () => { saveCapOpts(); capDelay.blur(); });
capSelf.addEventListener('change', () => { saveCapOpts(); capSelf.blur(); });
if (window.api.onTick) window.api.onTick((n) => { if (n > 0) flash(`Capturing in ${n}…`); });

// ------------------------------------------------------------------ capture hotkeys while ShareV has focus
// The global keyboard hook normally swallows these keys. If it ever misses one (hook dropped, key delivered to this window)
// the editor triggers the capture itself, so the hotkeys keep working with ShareV focused.
let hotkeyMap = {};
const modKey = (c, a, s) => `${c ? 'c' : ''}${a ? 'a' : ''}${s ? 's' : ''}`;
function loadHotkeys() {
  if (!window.api.getHotkeys) return;
  window.api.getHotkeys().then((hk) => {
    const map = {};
    const modes = { fullscreen: 'full', region: 'region', window: 'window', lastRegion: 'lastRegion' };
    for (const [name, mode] of Object.entries(modes)) {
      const parts = String(hk[name] || '').split('+').map((x) => x.trim().toLowerCase());
      if (!parts.some((x) => ['printscreen', 'prtsc', 'prtscr', 'snapshot'].includes(x))) continue; // other keys use the global-shortcut plugin
      const has = (...n) => parts.some((x) => n.includes(x));
      map[modKey(has('ctrl', 'control', 'commandorcontrol', 'cmdorctrl', 'commandorctrl', 'cmd', 'command'), has('alt', 'option'), has('shift'))] = mode;
    }
    hotkeyMap = map;
  }).catch(() => {});
}
let lastHotkey = 0;
function onPrintScreen(e) {
  if (e.code !== 'PrintScreen' && e.key !== 'PrintScreen') return;
  const mode = hotkeyMap[modKey(e.ctrlKey || e.metaKey, e.altKey, e.shiftKey)];
  if (!mode) return;
  e.preventDefault();
  const now = Date.now();
  if (now - lastHotkey < 700) return; // keydown and keyup both arrive for some combinations
  lastHotkey = now;
  window.api.capture(mode);
}
addEventListener('keydown', onPrintScreen, true);
addEventListener('keyup', onPrintScreen, true); // Windows sends only a key-up for a plain PrintScreen
loadHotkeys();

// ------------------------------------------------------------------ keyboard shortcut help
const SHORTCUTS = [
  ['Tools', [['Select / move', 'V'], ['Rectangle', 'R'], ['Ellipse', 'E'], ['Line', 'L'], ['Arrow', 'A'], ['Pen (bezier curves)', 'P'], ['Freehand (smoothed)', 'F'],
    ['Text', 'T'], ['Text box', 'B'], ['Balloon', 'C'], ['Step number', 'N'], ['Highlight', 'H'], ['Calculator / unit converter sidebar', 'F2'], ['Crank & slider simulator', 'F3'], ['Blur region', 'U'], ['Pixelate region', 'X'], ['Recognise text in region (OCR)', 'O'], ['Emoji stamp', 'M']]],
  ['Selecting', [['Select several', 'Drag a box, or Shift/Ctrl + click'], ['Select all', 'Ctrl + A'], ['Deselect / back to Select', 'Esc'], ['Edit text of selected', 'Enter / double-click']]],
  ['Style', [['Copy style of selected shape', 'Ctrl + Shift + C'], ['Paste style onto selection', 'Ctrl + Shift + V'], ['Style painter tool', 'K'], ['Context menu with these and more', 'right-click a shape']]],
  ['Editing the selection', [['Nudge 1 px', '← ↑ → ↓'], ['Nudge 10 px', 'Shift + arrow keys'], ['Duplicate', 'Ctrl + D'], ['Bring to front', 'Ctrl + ]'],
    ['Send to back', 'Ctrl + ['], ['Delete', 'Del / Backspace'], ['Undo', 'Ctrl + Z'], ['Redo', 'Ctrl + Y / Ctrl + Shift + Z']]],
  ['Drawing', [['Constrain line to 45° / box to square', 'hold Shift'], ['Pen: finish path', 'Enter / double-click'], ['Pen: close path', 'click the first point'],
    ['Pen: remove last point', 'Backspace'], ['Finish text', 'Ctrl + Enter / Esc']]],
  ['File & view', [['Open', 'Ctrl + O'], ['Save SVG', 'Ctrl + S'], ['Save SVG as…', 'Ctrl + Shift + S'], ['Copy image', 'Ctrl + C'], ['Paste image', 'Ctrl + V'],
    ['Zoom in / out', 'Ctrl + + / Ctrl + −  (or Ctrl + wheel)'], ['Fit / actual size', 'Ctrl + 0 / Ctrl + 1'], ['This help', '? / F1']]],
  ['Capture (global)', [['Region', 'PrintScreen'], ['Active window', 'Alt + PrintScreen'], ['Full screen', 'Ctrl + PrintScreen'], ['Last region', 'Ctrl + Shift + PrintScreen']]],
];
$('helpBody').innerHTML = SHORTCUTS.map(([title, rows]) => `<h3>${title}</h3>` +
  rows.map(([a, k]) => `<div class="row"><span>${esc(a)}</span><span><kbd>${esc(k)}</kbd></span></div>`).join('')).join('');
const help = $('help');
// ---- settings menu
const menu = $('menu');
function refreshBakeLabel() { $('bakeBtn').textContent = (state.bakeFx ? '\u2713 ' : '\u2003') + 'Burn blur / pixelate into saved image'; }
refreshBakeLabel();
$('bSettings').onclick = (e) => { e.stopPropagation(); refreshBakeLabel(); menu.hidden = !menu.hidden; };
document.addEventListener('mousedown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('#bSettings')) menu.hidden = true; });
menu.addEventListener('click', (e) => guard(async () => {
  const act = e.target.closest('button') && e.target.closest('button').dataset.act;
  if (!act) return;
  menu.hidden = true;
  if (act === 'export') { const f = await window.api.exportUi(settingsJson()); if (f) flash('Settings exported to ' + f); }
  else if (act === 'import') {
    const txt = await window.api.importUi();
    if (txt) { const obj = JSON.parse(txt); if (!obj || typeof obj !== 'object' || !obj.toolOpts) throw new Error('Not a ShareV settings file'); applySettings(obj); persistOpts(); flash('Settings imported'); }
  } else if (act === 'bake') {
    state.bakeFx = !state.bakeFx; refreshBakeLabel(); persistOpts();
    flash(state.bakeFx ? 'Blur/pixelate will be burned into saved files (original pixels removed)' : 'Blur/pixelate kept editable - the original unblurred screenshot stays inside the SVG!');
  } else if (act === 'reset') { applySettings({}); persistOpts(); flash('Tool options reset to defaults'); }
}));
const toggleHelp = (on) => { help.hidden = on === undefined ? !help.hidden : !on; };
$('bHelp').onclick = () => toggleHelp();
$('helpClose').onclick = () => toggleHelp(false);
help.addEventListener('mousedown', (e) => { if (e.target === help) toggleHelp(false); });

// ------------------------------------------------------------------ copy / paste style (format painter + context menu)
const STYLE_KEYS = ['stroke', 'sw', 'sa', 'fill', 'fa', 'tc', 'ta', 'bold', 'sh', 'shz'];
let styleClip = null; // {type, props}
function copyStyleFrom(s) {
  const props = {};
  for (const k of STYLE_KEYS) if (k in s && s[k] !== undefined) props[k] = s[k];
  if (HEADY.has(s.type)) { props.hs = headOn(s, false); props.he = headOn(s, true); props.hz = headLen(s); }
  if (s.type === 'emoji') props.size = s.w; else if ('size' in s) props.size = s.size;
  if ('amt' in s) props.amt = s.amt;
  styleClip = { type: s.type, props };
  updateButtons();
  flash('Style copied - Ctrl+Shift+V (or the paste button / right-click) applies it to the selection');
}
/** Apply only what makes sense for the target's type (colours, widths, opacity, shadow, arrowheads, font...). */
function applyStyleTo(t, clip) {
  const p = clip.props, same = t.type === clip.type;
  if ('stroke' in t && p.stroke !== undefined) t.stroke = p.stroke;
  if ('sw' in t && p.sw !== undefined && (p.sw > 0 || ['text', 'highlight', 'step'].includes(t.type))) t.sw = p.sw;
  if (p.sa !== undefined && 'stroke' in t) t.sa = p.sa;
  if ('fill' in t && p.fill !== undefined && !(t.type === 'highlight' && p.fill === 'none')) t.fill = p.fill;
  if ('fill' in t && p.fa !== undefined) t.fa = p.fa;
  if ('tc' in t && p.tc !== undefined) { t.tc = p.tc; if (p.ta !== undefined) t.ta = p.ta; }
  if ('bold' in t && p.bold !== undefined) t.bold = p.bold;
  if (p.size !== undefined && (same || (TEXTY.has(t.type) && 'size' in t && clip.type !== 'emoji' && clip.type !== 'step'))) {
    if (t.type === 'emoji') { const c = { x: t.x + t.w / 2, y: t.y + t.h / 2 }; t.w = t.h = p.size; t.x = c.x - p.size / 2; t.y = c.y - p.size / 2; } else if ('size' in t) t.size = p.size;
  }
  if (SHADOWY.has(t.type) && p.sh !== undefined) { t.sh = p.sh; t.shz = p.shz || 4; }
  if (HEADY.has(t.type) && p.hs !== undefined) { t.hs = p.hs; t.he = p.he; t.hz = p.hz; }
  if (same && 'amt' in t && p.amt !== undefined) t.amt = p.amt;
}
function copyStyleSel() { const s = byId(state.sel); if (s) copyStyleFrom(s); }
function pasteStyleSel() {
  const sel = selShapes();
  if (!styleClip || !sel.length) return;
  const pre = snapshot();
  sel.forEach((s) => applyStyleTo(s, styleClip));
  pushUndo(pre); render(); syncProps();
  flash(`Style pasted to ${sel.length} shape${sel.length === 1 ? '' : 's'}`);
}
// ---- right-click menu
const ctx = $('ctx');
function hideCtx() { ctx.hidden = true; }
function showCtx(x, y) {
  const n = state.sels.length;
  const items = [
    ['copy', 'Copy style', 'Ctrl+Shift+C', true],
    ['paste', 'Paste style' + (n > 1 ? ` to ${n} shapes` : ''), 'Ctrl+Shift+V', !!styleClip],
    ['paint', 'Paint this style onto other shapes', 'K', true],
    null,
    ['dup', 'Duplicate', 'Ctrl+D', true],
    ['front', 'Bring to front', 'Ctrl+]', true],
    ['back', 'Send to back', 'Ctrl+[', true],
    ['del', 'Delete', 'Del', true],
  ];
  ctx.innerHTML = items.map((it) => it ? `<button data-a="${it[0]}"${it[3] ? '' : ' disabled'}><span>${it[1]}</span><kbd>${it[2]}</kbd></button>` : '<hr>').join('');
  ctx.hidden = false;
  ctx.style.left = Math.max(4, Math.min(x, innerWidth - ctx.offsetWidth - 4)) + 'px';
  ctx.style.top = Math.max(4, Math.min(y, innerHeight - ctx.offsetHeight - 4)) + 'px';
}
ctx.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  hideCtx();
  ({
    copy: copyStyleSel, paste: pasteStyleSel, dup: duplicateSel, del: deleteSel,
    front: () => reorder(1), back: () => reorder(-1),
    paint: () => { copyStyleSel(); setTool('painter'); },
  })[b.dataset.a]();
});
svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const hit = e.target.closest && e.target.closest('[data-id]');
  if (!state.loaded || !hit || !['select', 'painter'].includes(state.tool)) { hideCtx(); return; }
  const id = +hit.dataset.id;
  state.sels = state.sels.includes(id) ? [...state.sels.filter((x) => x !== id), id] : [id];
  if (state.tool === 'painter') setTool('select');
  syncProps(); render();
  showCtx(e.clientX, e.clientY);
});
// no browser menu (Inspect, Back...) anywhere except in text fields, where cut/copy/paste is useful
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
document.addEventListener('mousedown', (e) => { if (!ctx.hidden && !ctx.contains(e.target)) hideCtx(); });
addEventListener('blur', hideCtx);
$('bCopyStyle').onclick = copyStyleSel;
$('bPasteStyle').onclick = pasteStyleSel;

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

const KEYS = { v: 'select', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', f: 'pen', p: 'bezier', t: 'text', b: 'textbox', c: 'balloon', h: 'highlight', n: 'step', u: 'blur', x: 'pixelate', o: 'ocr', m: 'emoji', k: 'painter' };
function toggleCalc() {
  if (!window.ShareVCalc) return;
  if (!$('calcSide').hidden) openPanel(null); else window.ShareVCalc.open();
}
addEventListener('keydown', (e) => { if (e.key === 'F2' && $('sim').hidden) { e.preventDefault(); toggleCalc(); } }, true);
addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (e.target.closest && e.target.closest('#calcSide')) return; // the calculator panel handles its own keys
  if (tag === 'TEXTAREA' || (tag === 'INPUT' && ['number', 'text'].includes(e.target.type))) return; // typing; sliders/checkboxes keep shortcuts
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (!help.hidden) { if (k === 'escape' || k === '?' || k === 'f1') { toggleHelp(false); e.preventDefault(); } return; }
  if (!palette.hidden && k === 'escape') { hidePalette(); return; }
  if (k === '?' || k === 'f1') { toggleHelp(true); e.preventDefault(); return; }
  if (mod) {
    if (k === 'z') { e.shiftKey ? redo() : undo(); }
    else if (k === 'y') redo();
    else if (k === 's') saveSvg(e.shiftKey);
    else if (k === 'o') openFile();
    else if (k === 'c' && e.shiftKey) copyStyleSel();
    else if (k === 'v' && e.shiftKey) pasteStyleSel();
    else if (k === 'c') copyImage();
    else if (k === 'd') duplicateSel();
    else if (k === 'a') { state.tool === 'select' && (state.sels = state.shapes.map((x) => x.id)); syncProps(); render(); }
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
  if (state.bz && (k === 'enter' || k === 'escape')) { finishBezier(); e.preventDefault(); return; }
  if (state.bz && k === 'backspace') {
    state.bz.nodes.pop();
    if (!state.bz.nodes.length) { state.shapes = state.shapes.filter((x) => x !== state.bz); state.bz = null; }
    render(); e.preventDefault(); return;
  }
  if (k === 'delete' || k === 'backspace') { deleteSel(); e.preventDefault(); }
  else if (k === 'escape') { state.sel = null; setTool('select'); render(); }
  else if (k === 'enter') { const s = state.sels.length === 1 && byId(state.sel); if (s && TEXTY.has(s.type)) { startEdit(s, snapshot(), false); e.preventDefault(); } }
  else if (k.startsWith('arrow') && state.sels.length) {
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
if (window.api.loadUi) {
  window.api.loadUi().then((txt) => { if (txt) applySettings(JSON.parse(txt)); }).catch(() => {});
}
window.api.onLoad((p) => guard(() => loadImage(p.dataURL)));
window.api.init().then((p) => { if (p) guard(() => loadImage(p.dataURL)); else window.api.setEmpty(true); });

// exposed for tests
window.__sharev = { buildSvg, renderPng, loadSvgText, loadImage, setTool };
