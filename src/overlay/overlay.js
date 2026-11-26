'use strict';
const $ = (id) => document.getElementById(id);
const sel = $('sel'), dim = $('dim'), lbl = $('lbl'), gv = $('gv'), gh = $('gh');
let start = null, rect = null, finished = false;

window.api.overlayInit().then((d) => { if (d) $('bg').style.backgroundImage = `url(${d.url})`; });

const finish = (r) => { if (!finished) { finished = true; window.api.overlayDone(r); } };

function update(x, y) {
  gv.style.left = x + 'px';
  gh.style.top = y + 'px';
  if (!start) return;
  const l = Math.min(start.x, x), t = Math.min(start.y, y);
  const w = Math.abs(x - start.x), h = Math.abs(y - start.y);
  rect = { x: l, y: t, w, h };
  Object.assign(sel.style, { display: 'block', left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
  lbl.textContent = `${w} × ${h}`;
  lbl.style.display = 'block';
  lbl.style.left = Math.min(l, innerWidth - 90) + 'px';
  lbl.style.top = (t > 26 ? t - 26 : t + h + 6) + 'px';
}

addEventListener('mousedown', (e) => {
  if (e.button === 2) return finish(null);
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  dim.style.display = 'none';
  $('hint').style.display = 'none';
  update(e.clientX, e.clientY);
});
addEventListener('mousemove', (e) => update(e.clientX, e.clientY));
addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !start) return;
  update(e.clientX, e.clientY);
  if (rect && rect.w > 2 && rect.h > 2) finish(rect);
  else { start = rect = null; sel.style.display = lbl.style.display = 'none'; dim.style.display = ''; }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(null); });
addEventListener('contextmenu', (e) => { e.preventDefault(); finish(null); });
