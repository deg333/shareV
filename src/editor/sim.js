'use strict';
/* Crank & slider (slider-crank) simulator: animated mechanism, four inversions, graphs and the working shown step by step.
   Maths is in sim-core.js (unit tested). Lengths are kept in mm internally and converted for display. */
(() => {
  const K = window.SimCore;
  const $ = (id) => document.getElementById(id);
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const KEY = 'sharev.sim';
  const root = $('sim');
  const W = 1000, H = 400; // mechanism viewBox

  const st = {
    inv: 1, graph: 'x', showGraph: true, units: 'SI',
    r: 40, l: 120, e: 0, rpm: 20, F: 100, m: 0.5,
    preset: 'IC Engine', phase: 18 * D2R, th: 18 * D2R, playing: false,
  };
  const INV_NAME = ['', '1st', '2nd', '3rd', '4th'];
  const INV_TEXT = [
    '',
    'link 1 (frame) fixed',
    'link 2 (crank) fixed',
    'link 3 (connecting rod) fixed',
    'link 4 (slider) fixed',
  ];
  const INV_USE = [
    '',
    'IC engine, reciprocating compressor',
    'Whitworth quick return, Gnome rotary engine',
    'oscillating cylinder, crank & slotted-lever quick return',
    'hand pump, Bull engine',
  ];
  const INPUT_TEXT = ['', 'input: crank turns at O₂', 'input: link 1 turns about the fixed crank O₂', 'input: crank turns about A relative to the fixed rod (β = θ + φ)', 'input: crank turns, the guide slides through the fixed block'];

  // ------------------------------------------------------------------ units
  const U = {
    SI: { len: 'mm', L: (mm) => mm, fromL: (v) => v, force: 'N', F: (N) => N, fromF: (v) => v, mass: 'kg', M: (kg) => kg, fromM: (v) => v, tq: 'N·m', T: (nm) => nm, vel: 'mm/s', acc: 'mm/s²' },
    Imperial: { len: 'in', L: (mm) => mm / 25.4, fromL: (v) => v * 25.4, force: 'lbf', F: (N) => N / 4.4482216, fromF: (v) => v * 4.4482216, mass: 'lb', M: (kg) => kg / 0.45359237, fromM: (v) => v * 0.45359237, tq: 'lbf·in', T: (nm) => nm * 8.8507458, vel: 'in/s', acc: 'in/s²' },
  };
  const un = () => U[st.units];
  const num = (v, d = 2) => { const s = (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d); return s === '-0' ? '0' : s; };
  const sig = (v) => { // 4 significant digits, no exponent clutter
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) < 5e-5) return '0';
    const d = Math.max(0, 3 - Math.floor(Math.log10(Math.abs(v))));
    return num(v, Math.min(d, 6));
  };
  const omegaOf = () => (2 * Math.PI * st.rpm) / 60;
  const params = () => ({ r: st.r, l: st.l, e: st.e });
  const load = () => ({ F: st.F, m: st.m });

  // ------------------------------------------------------------------ state persistence (small, local only)
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify({ inv: st.inv, graph: st.graph, showGraph: st.showGraph, units: st.units, r: st.r, l: st.l, e: st.e, rpm: st.rpm, F: st.F, m: st.m, preset: st.preset })); } catch { /* ignore */ }
  }
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o) for (const k of ['inv', 'graph', 'showGraph', 'units', 'r', 'l', 'e', 'rpm', 'F', 'm', 'preset']) if (o[k] !== undefined) st[k] = o[k];
  } catch { /* ignore */ }

  // ------------------------------------------------------------------ DOM
  let built = false;
  const sliders = [
    { id: 'r', chip: '2', color: 'teal', label: 'Crank', sym: 'r', mm: [5, 100, 1], get: () => st.r, set: (v) => { st.r = v; } },
    { id: 'l', chip: '3', color: 'purple', label: 'Con-rod', sym: 'l', mm: [20, 300, 1], get: () => st.l, set: (v) => { st.l = v; } },
    { id: 'e', chip: '1', color: 'gray', label: 'Offset', sym: 'e', mm: [-60, 60, 1], get: () => st.e, set: (v) => { st.e = v; } },
    { id: 'rpm', chip: '⟳ 2', color: 'teal', label: 'Input speed', sym: '', mm: [1, 300, 1], get: () => st.rpm, set: (v) => { st.rpm = v; }, rpm: true },
  ];
  function build() {
    if (built) return;
    built = true;
    root.innerHTML = `
      <div class="simbar"><h2>Crank &amp; slider simulator</h2><span class="simsub">slider-crank chain, four inversions &middot; Space run/pause &middot; ← → step (Shift = 10°) &middot; Esc close</span>
        <button id="simClose" title="Close (Esc)">&times;</button></div>
      <div class="simcols">
        <div class="simmain">
          <div class="card stagecard">
            <div class="pills"><span id="pillInv" class="pill"></span><span id="pillIn" class="pill"></span><span id="pillRun" class="pill warn"></span></div>
            <svg id="simSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
          <div class="card ctrl">
            <div class="row"><span class="lbl">INVERSION</span><div class="seg" id="segInv">${[1, 2, 3, 4].map((i) => `<button data-inv="${i}">${INV_NAME[i]}</button>`).join('')}</div>
              <span class="lbl">GRAPH</span><div class="seg" id="segGraph"><button data-g="x">x(θ)</button><button data-g="v">v(θ)</button><button data-g="a">a(θ)</button><button data-g="T">T(θ)</button></div>
              <button id="btnShow" class="toggle"></button>
              <span class="lbl">UNITS</span><div class="seg" id="segUnits"><button data-u="SI">SI</button><button data-u="Imperial">Imperial</button></div></div>
            <div class="row"><span class="lbl">PRESETS</span><div class="presets" id="presets">${Object.keys(K.PRESETS).map((n) => `<button data-p="${n}">${n}</button>`).join('')}</div>
              <button id="btnPlay" class="play">▶ Run</button><button id="btnStepB" title="Step back">⏮</button><button id="btnStepF" title="Step forward">⏭</button></div>
          </div>
          <div class="card sliders" id="sliders">${sliders.map((s) => `
            <div class="sl ${s.color}"><span class="chip">${s.chip}</span><span class="nm">${s.label}${s.sym ? ` <i>${s.sym}</i>` : ''}</span>
              <input type="range" id="sl_${s.id}"><span class="val" id="val_${s.id}"></span></div>`).join('')}
            <div class="sl gold"><span class="chip">F</span><span class="nm">Slider force <i>F</i></span><input type="range" id="sl_F" min="0" max="2000" step="10"><span class="val" id="val_F"></span></div>
            <div class="sl gold"><span class="chip">m</span><span class="nm">Slider mass <i>m</i></span><input type="range" id="sl_m" min="0" max="10" step="0.1"><span class="val" id="val_m"></span></div>
          </div>
          <div class="cards" id="readouts"></div>
          <div class="card graphcard" id="graphCard"><svg id="simGraph" viewBox="0 0 ${W} 210" preserveAspectRatio="none"></svg></div>
        </div>
        <aside class="simmath card"><h3>The maths <span>— updates live</span></h3><div id="mathBody"></div></aside>
      </div>`;
    wire();
    applySliderRanges();
    syncAll();
  }

  function wire() {
    $('simClose').onclick = close;
    $('segInv').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.inv = +b.dataset.inv; st.preset = ''; st.th = K.thetaFromPhase(params(), st.inv, st.phase, st.th); changed(true); } };
    $('segGraph').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.graph = b.dataset.g; changed(); } };
    $('segUnits').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.units = b.dataset.u; applySliderRanges(); changed(); } };
    $('btnShow').onclick = () => { st.showGraph = !st.showGraph; changed(); };
    $('presets').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const p = K.PRESETS[b.dataset.p];
      Object.assign(st, { inv: p.inv, r: p.r, l: p.l, e: p.e, rpm: p.rpm, preset: b.dataset.p });
      st.phase = 18 * D2R; st.th = st.phase;
      applySliderRanges();
      changed(true);
    };
    $('btnPlay').onclick = toggle;
    $('btnStepB').onclick = () => step(-1);
    $('btnStepF').onclick = () => step(1);
    $('simSvg').addEventListener('click', toggle);
    $('simGraph').addEventListener('click', (e) => {
      const r = $('simGraph').getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const th = Math.max(0, Math.min(1, (x - GM.l) / (W - GM.l - GM.r))) * 2 * Math.PI;
      st.th = th;
      const k = K.kin(params(), th);
      st.phase = st.inv === 3 && k ? th + k.phi : th;
      st.playing = false; render(true);
    });
    for (const s of sliders) {
      $('sl_' + s.id).addEventListener('input', (e) => {
        const raw = parseFloat(e.target.value);
        s.set(s.rpm ? raw : un().fromL(raw));
        st.preset = '';
        constrain(s.id);
        changed(false);
      });
    }
    $('sl_F').addEventListener('input', (e) => { st.F = un().fromF(parseFloat(e.target.value)); changed(false, true); });
    $('sl_m').addEventListener('input', (e) => { st.m = un().fromM(parseFloat(e.target.value)); changed(false, true); });
    $('graphCard').addEventListener('mousedown', (e) => e.stopPropagation());
  }

  /** the crank can only make a full turn if l >= r + |e|: keep the other lengths consistent while dragging */
  function constrain(changedId) {
    const need = K.minRod(st.r, st.e);
    if (st.l < need) {
      if (changedId === 'l') { st.r = Math.max(5, st.l - Math.abs(st.e) - 0.01); if (st.r + Math.abs(st.e) + 0.01 > st.l) st.e = Math.sign(st.e) * Math.max(0, st.l - st.r - 0.01); }
      else st.l = need;
    }
    applySliderRanges();
  }
  function applySliderRanges() {
    const u = un();
    for (const s of sliders) {
      const el = $('sl_' + s.id);
      if (s.rpm) { el.min = s.mm[0]; el.max = s.mm[1]; el.step = 1; el.value = s.get(); continue; }
      const [lo, hi] = s.mm;
      if (st.units === 'SI') { el.min = lo; el.max = hi; el.step = 1; } else { el.min = (lo / 25.4).toFixed(2); el.max = (hi / 25.4).toFixed(2); el.step = 0.05; }
      if (s.id === 'l') el.min = Math.max(parseFloat(el.min), u.L(K.minRod(st.r, st.e))).toFixed(2);
      el.value = u.L(s.get());
    }
    $('sl_F').max = st.units === 'SI' ? 2000 : 450; $('sl_F').step = st.units === 'SI' ? 10 : 5;
    $('sl_m').max = st.units === 'SI' ? 10 : 22; $('sl_m').step = st.units === 'SI' ? 0.1 : 0.25;
    $('sl_F').value = u.F(st.F); $('sl_m').value = u.M(st.m);
  }

  // ------------------------------------------------------------------ run / step
  let raf = 0, last = 0;
  function toggle() {
    st.playing = !st.playing;
    if (st.playing) { last = performance.now(); loop(last); } else render(true); // pausing refreshes every panel
    updatePills();
  }
  function step(dir, big) { st.playing = false; advance(dir * (big ? 10 : 1) * D2R); render(true); }
  function advance(dphase) {
    st.phase += dphase;
    st.th = K.thetaFromPhase(params(), st.inv, st.phase, st.th);
  }
  function loop(ts) {
    cancelAnimationFrame(raf);
    if (!st.playing || root.hidden) return;
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    advance(omegaOf() * dt * speedBoost());
    render(false);
    raf = requestAnimationFrame(loop);
  }
  // very slow inputs (the reference uses 20 rpm) are shown at real speed; nothing is sped up
  const speedBoost = () => 1;

  // ------------------------------------------------------------------ mechanism drawing
  let view = { s: 1, ox: W / 2, oy: H / 2 };
  const P = (q) => ({ x: view.ox + q.x * view.s, y: view.oy - q.y * view.s });
  function xform(th, k) {
    const p = params();
    if (st.inv === 2) { const a = 20 * D2R - th, c = Math.cos(a), s = Math.sin(a); return { f: (q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c }), rot: a }; }
    if (st.inv === 3) {
      const a = k.phi, c = Math.cos(a), s = Math.sin(a), A = { x: p.r * Math.cos(th), y: p.r * Math.sin(th) }, R = { x: -p.l / 2, y: 0 };
      return { f: (q) => ({ x: R.x + (q.x - A.x) * c - (q.y - A.y) * s, y: R.y + (q.x - A.x) * s + (q.y - A.y) * c }), rot: a };
    }
    if (st.inv === 4) { const B = { x: k.x, y: p.e }; return { f: (q) => ({ x: q.x - B.x, y: q.y - B.y }), rot: 0 }; }
    return { f: (q) => q, rot: 0 };
  }
  const ringR = () => Math.max(1.55 * st.r, st.r + 18);
  function fitView() {
    const p = params(), m = K.metrics(p, st.inv);
    const pts = [];
    const gp = 0.3 * p.r + 14;
    for (let t = 0; t < 360; t += 4) {
      const th = t * D2R, k = K.kin(p, th);
      if (!k) continue;
      const X = xform(th, k).f;
      for (const q of [{ x: 0, y: 0 }, { x: p.r * Math.cos(th), y: p.r * Math.sin(th) }, { x: k.x, y: p.e }, { x: m.xb - gp, y: p.e }, { x: m.xt + gp, y: p.e }, { x: k.x + 14, y: p.e + 12 }, { x: k.x - 14, y: p.e - 12 }]) pts.push(X(q));
    }
    if (st.inv === 1) { const R = ringR(); pts.push({ x: -R, y: -R }, { x: R, y: R }); }
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const mx = 70, my = 62;
    const s = Math.min((W - 2 * mx) / Math.max(1, x1 - x0), (H - 2 * my - 30) / Math.max(1, y1 - y0));
    view = { s, ox: W / 2 - ((x0 + x1) / 2) * s, oy: H / 2 - 14 + ((y0 + y1) / 2) * s };
  }
  const tag = (x, y, t, cls = '') => `<g class="tag ${cls}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><rect x="${-(t.length * 3.6 + 7)}" y="-10" width="${t.length * 7.2 + 14}" height="20" rx="5"/><text text-anchor="middle" y="4.5">${t}</text></g>`;
  const bar = (a, b, w, col, dark) => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${dark}" stroke-width="${w + 4}" stroke-linecap="round"/><line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  const pin = (q, r = 7) => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r}" fill="#e9edf4" stroke="#3b4252" stroke-width="2"/><circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r - 4}" fill="#566073"/>`;
  const ground = (q) => `<g transform="translate(${q.x.toFixed(1)} ${(q.y + 14).toFixed(1)})"><path d="M-16 0h32" stroke="#6f7b8f" stroke-width="2"/>${[-12, -4, 4, 12].map((x) => `<path d="M${x} 0l-6 8" stroke="#6f7b8f" stroke-width="2"/>`).join('')}</g>`;

  function mechSvg(sol) {
    const p = params(), th = sol.th, u = un();
    const m = K.metrics(p, st.inv);
    const T = xform(th, sol), X = T.f;
    const O = P(X({ x: 0, y: 0 })), A = P(X({ x: p.r * Math.cos(th), y: p.r * Math.sin(th) })), B = P(X({ x: sol.x, y: p.e }));
    const gp = 0.3 * p.r + 14;
    const G0 = P(X({ x: m.xb - gp, y: p.e })), G1 = P(X({ x: m.xt + gp, y: p.e }));
    let g = '';
    // protractor (frame 1 only: the angle scale belongs to the guide)
    if (st.inv === 1) {
      const R = ringR() * view.s;
      g += `<circle cx="${O.x}" cy="${O.y}" r="${R}" fill="none" stroke="#6b7a90" stroke-width="1.4"/>`;
      for (let d = 0; d < 360; d += 5) {
        const major = d % 30 === 0, mid = d % 10 === 0, a = d * D2R, c = Math.cos(a), s = -Math.sin(a), len = major ? 9 : mid ? 6 : 3.5;
        g += `<line x1="${O.x + c * R}" y1="${O.y + s * R}" x2="${O.x + c * (R - len)}" y2="${O.y + s * (R - len)}" stroke="#6b7a90" stroke-width="${major ? 1.6 : 1}"/>`;
        if (major) g += `<text x="${O.x + c * (R + 17)}" y="${O.y + s * (R + 17) + 4}" text-anchor="middle" class="deg">${d}°</text>`;
      }
    }
    // guide slot (link 1) and dead-centre markers
    g += `<line x1="${G0.x}" y1="${G0.y}" x2="${G1.x}" y2="${G1.y}" stroke="#4c5463" stroke-width="34" stroke-linecap="round"/><line x1="${G0.x}" y1="${G0.y}" x2="${G1.x}" y2="${G1.y}" stroke="#b8bdc8" stroke-width="30" stroke-linecap="round"/><line x1="${G0.x}" y1="${G0.y}" x2="${G1.x}" y2="${G1.y}" stroke="#2f3541" stroke-width="9" stroke-linecap="round"/>`;
    if (st.inv !== 3) {
      const Tt = P(X({ x: m.xt, y: p.e })), Bb = P(X({ x: m.xb, y: p.e }));
      const nx = (Tt.y - Bb.y), ny = -(Tt.x - Bb.x), nl = Math.hypot(nx, ny) || 1;
      const off = (q, d) => ({ x: q.x + (nx / nl) * d, y: q.y + (ny / nl) * d });
      g += `<g class="dc"><line x1="${off(Bb, -26).x}" y1="${off(Bb, -26).y}" x2="${off(Bb, -64).x}" y2="${off(Bb, -64).y}"/><line x1="${off(Tt, -26).x}" y1="${off(Tt, -26).y}" x2="${off(Tt, -64).x}" y2="${off(Tt, -64).y}"/>
        <line x1="${off(Bb, -56).x}" y1="${off(Bb, -56).y}" x2="${off(Tt, -56).x}" y2="${off(Tt, -56).y}" marker-start="url(#arr)" marker-end="url(#arr)"/>
        <text x="${off(Bb, -78).x}" y="${off(Bb, -78).y}" text-anchor="middle">BDC</text><text x="${off(Tt, -78).x}" y="${off(Tt, -78).y}" text-anchor="middle">TDC</text></g>`;
      const mid = off({ x: (Bb.x + Tt.x) / 2, y: (Bb.y + Tt.y) / 2 }, -56);
      g += tag(mid.x, mid.y, `stroke = ${num(u.L(m.stroke), 1)} ${u.len}`, 'dim');
    }
    // fixed-link symbol
    if (st.inv === 1 || st.inv === 2) g += ground(O);
    else if (st.inv === 3) g += ground(A) + ground(B);
    else g += ground(B);
    // links
    g += bar(O, A, 18, '#2ea898', '#17594f');
    g += bar(A, B, 16, '#8f64d8', '#47306f');
    // slider block (link 4)
    g += `<g transform="translate(${B.x.toFixed(1)} ${B.y.toFixed(1)}) rotate(${(-T.rot * R2D).toFixed(2)})"><rect x="-22" y="-15" width="44" height="30" rx="5" fill="#d3a92f" stroke="#6b5412" stroke-width="2.5"/><rect x="-16" y="-9" width="32" height="18" rx="3" fill="#e8c65a" opacity=".55"/></g>`;
    g += pin(O, 9) + pin(A, 7) + pin(B, 7);
    // labels
    const ang = Math.atan2(B.y - A.y, B.x - A.x) * R2D, flip = ang > 90 || ang < -90, la = flip ? ang + 180 : ang;
    g += `<text transform="translate(${(A.x + B.x) / 2} ${(A.y + B.y) / 2 + 4}) rotate(${la.toFixed(1)})" text-anchor="middle" class="linklbl">3 · l ${num(u.L(p.l), 1)} ${u.len}</text>`;
    const ca = Math.atan2(A.y - O.y, A.x - O.x) * R2D, cflip = ca > 90 || ca < -90;
    g += `<text transform="translate(${(O.x + A.x) / 2} ${(O.y + A.y) / 2 + 4}) rotate(${(cflip ? ca + 180 : ca).toFixed(1)})" text-anchor="middle" class="linklbl small">2 · r ${num(u.L(p.r), 1)}</text>`;
    g += tag(O.x - 26, O.y + 24, 'O₂', 'tl') + tag(A.x, A.y - 24, 'A') + tag(B.x + 22, B.y + 30, 'B');
    g += tag(B.x + 52, B.y - 44, `x = ${num(u.L(sol.x), 1)} ${u.len}`, 'xtag');
    // crank direction arrow at O
    g += `<path d="M ${O.x + 34} ${O.y + 6} a 34 34 0 0 0 -30 26" fill="none" stroke="#2ea898" stroke-width="2.4" marker-end="url(#arrT)"/>`;
    return `<defs><marker id="arr" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#c2551c"/></marker>
      <marker id="arrT" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#2ea898"/></marker>
      <pattern id="gridS" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3a4558" stroke-width=".6"/></pattern>
      <pattern id="gridL" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#gridS)"/><path d="M100 0H0V100" fill="none" stroke="#4a5870" stroke-width="1"/></pattern></defs>
      <rect width="${W}" height="${H}" rx="14" fill="#1b2231"/><rect width="${W}" height="${H}" rx="14" fill="url(#gridL)"/>${g}`;
  }

  // ------------------------------------------------------------------ readouts
  function readoutsHtml(s, m) {
    const u = un();
    const card = (cls, lbl, val) => `<div class="rd ${cls}"><div class="rl">${lbl}</div><div class="rv">${val}</div></div>`;
    return card('c1', 'Θ₂ (°)', num(((s.th * R2D) % 360 + 360) % 360, 1) + '°') + card('c2', 'Φ (°)', num(s.phi * R2D, 2) + '°') +
      card('c3', `X (${u.len.toUpperCase()})`, num(u.L(s.x), 2)) + card('c3', `V (${u.vel.toUpperCase()})`, sig(u.L(s.v))) +
      card('c3', `A (${u.acc.toUpperCase()})`, sig(u.L(s.a))) + card('c3', `STROKE (${u.len.toUpperCase()})`, num(u.L(m.stroke), 1)) +
      card('c4', 'N = L/R', num(m.N, 2)) + card('c4', 'TIME RATIO', num(m.ratio, 3));
  }

  // ------------------------------------------------------------------ graphs
  const GM = { l: 70, r: 20, t: 24, b: 36 };
  function curve() {
    const p = params(), om = omegaOf(), u = un();
    const pts = [];
    for (let t = 0; t <= 360; t += 1) {
      const s = K.solve(p, st.inv, t * D2R, om, load());
      if (!s) { pts.push(null); continue; }
      const y = st.graph === 'x' ? u.L(s.x) : st.graph === 'v' ? u.L(s.v) : st.graph === 'a' ? u.L(s.a) : u.T(s.T);
      pts.push(y);
    }
    return pts;
  }
  function niceTicks(lo, hi, n = 5) {
    if (hi - lo < 1e-9) { hi = lo + 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const stp = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / stp) * stp; v <= hi + stp * 1e-9; v += stp) out.push(Math.abs(v) < stp * 1e-9 ? 0 : v);
    return { ticks: out, step: stp };
  }
  const GCOL = { x: '#ff7a1a', v: '#2dd4a7', a: '#ffd43b', T: '#f783ac' };
  function graphSvg(s) {
    const u = un(), ys = curve(), valid = ys.filter((v) => v !== null);
    if (!valid.length) return '';
    let lo = Math.min(...valid), hi = Math.max(...valid);
    const padv = (hi - lo) * 0.1 || 1; lo -= padv; hi += padv;
    if (st.graph !== 'x') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const { ticks } = niceTicks(lo, hi);
    const iw = W - GM.l - GM.r, ih = 210 - GM.t - GM.b;
    const X = (deg) => GM.l + (deg / 360) * iw, Y = (v) => GM.t + ih - ((v - lo) / (hi - lo)) * ih;
    let g = `<rect width="${W}" height="210" rx="12" fill="#1b2231"/>`;
    for (const v of ticks) g += `<line x1="${GM.l}" x2="${W - GM.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? '#6b7a90' : '#33405a'}" stroke-width="${v === 0 ? 1.4 : 1}"/><text x="${GM.l - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${sig(v)}</text>`;
    for (let d = 0; d <= 360; d += 60) g += `<line x1="${X(d)}" x2="${X(d)}" y1="${GM.t}" y2="${GM.t + ih}" stroke="#33405a"/><text x="${X(d)}" y="${GM.t + ih + 18}" text-anchor="middle" class="ax">${d}°</text>`;
    let dpath = '', pen = false;
    ys.forEach((v, i) => { if (v === null) { pen = false; return; } dpath += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; });
    g += `<path d="${dpath}" fill="none" stroke="${GCOL[st.graph]}" stroke-width="2.6"/>`;
    const deg = ((s.th * R2D) % 360 + 360) % 360, idx = Math.round(deg), cy = ys[idx];
    g += `<line x1="${X(deg)}" x2="${X(deg)}" y1="${GM.t}" y2="${GM.t + ih}" stroke="#ffffff" stroke-opacity=".5" stroke-dasharray="4 4"/>`;
    if (cy !== null && cy !== undefined) g += `<circle cx="${X(deg)}" cy="${Y(cy)}" r="6" fill="${GCOL[st.graph]}" stroke="#fff" stroke-width="2"/>`;
    const title = { x: `x(θ) slider position [${u.len}]`, v: `v(θ) slider velocity [${u.vel}]`, a: `a(θ) slider acceleration [${u.acc}]`, T: `T(θ) crank torque [${u.tq}] for F = ${sig(u.F(st.F))} ${u.force}, m = ${sig(u.M(st.m))} ${u.mass}` }[st.graph];
    g += `<text x="${GM.l}" y="15" class="gtitle">${title}</text><text x="${W - GM.r}" y="15" text-anchor="end" class="gtitle dim">click the graph to set θ₂</text>`;
    return g;
  }

  // ------------------------------------------------------------------ the maths, with this moment's numbers
  function mathHtml(s, m) {
    const u = un(), p = params(), om = omegaOf(), inv = st.inv;
    const L = (mm) => sig(u.L(mm));
    const thDeg = ((s.th * R2D) % 360 + 360) % 360;
    const th = num(thDeg, 2) + '°';
    const sTh = Math.sin(s.th), cTh = Math.cos(s.th);
    const step = (n, title, body) => `<section class="ms"><h4><b>${n}</b> ${title}</h4>${body}</section>`;
    const f = (t) => `<div class="f">${t}</div>`;
    const v = (t) => `<div class="n">${t}</div>`;
    let h = '';
    h += step(1, 'Given', f('r = crank, l = rod, e = offset of the slider line, n = input speed') +
      v(`r = ${L(p.r)} ${u.len}, &nbsp; l = ${L(p.l)} ${u.len}, &nbsp; e = ${L(p.e)} ${u.len}, &nbsp; n = ${st.rpm} rpm`) +
      f('ω = 2π·n / 60') + v(`ω = 2π·${st.rpm} / 60 = <b>${sig(om)} rad/s</b>`) +
      f('N = l / r') + v(`N = ${L(p.l)} / ${L(p.r)} = <b>${num(m.N, 3)}</b>`) +
      f('the crank can only turn a full circle if l ≥ r + |e|') + v(`${L(p.l)} ${p.l >= p.r + Math.abs(p.e) ? '≥' : '<'} ${L(p.r + Math.abs(p.e))} ${p.l >= p.r + Math.abs(p.e) - 0.02 ? '✓' : '✗'}`));
    h += step(2, 'Crank pin A', f('A = ( r·cos θ , r·sin θ )') + v(`θ = ${th}`) +
      v(`A = ( ${L(p.r)}·${num(cTh, 4)} , ${L(p.r)}·${num(sTh, 4)} ) = <b>( ${L(p.r * cTh)} , ${L(p.r * sTh)} ) ${u.len}</b>`));
    h += step(3, 'Rod angle φ  (loop closure, y-direction)', f('l·sin φ = r·sin θ − e') + f('φ = sin⁻¹( (r·sin θ − e) / l )') +
      v(`sin φ = (${L(p.r)}·${num(sTh, 4)} − ${L(p.e)}) / ${L(p.l)} = ${num(s.s, 5)}`) + v(`φ = sin⁻¹(${num(s.s, 5)}) = <b>${num(s.phi * R2D, 3)}°</b>`));
    h += step(4, 'Slider position x  (x-direction)', f('x = r·cos θ + l·cos φ') +
      v(`x = ${L(p.r)}·${num(cTh, 4)} + ${L(p.l)}·${num(s.cp, 5)}`) + v(`x = ${L(p.r * cTh)} + ${L(p.l * s.cp)} = <b>${L(s.x)} ${u.len}</b>`));
    // velocity
    let vb = f('differentiate step 3:&nbsp; l·cos φ·φ′ = r·cos θ') + f('φ′ = dφ/dθ = r·cos θ / (l·cos φ)') +
      v(`φ′ = ${L(p.r)}·${num(cTh, 4)} / (${L(p.l)}·${num(s.cp, 5)}) = ${num(s.dphi, 5)}`) +
      f('differentiate step 4:&nbsp; x′ = dx/dθ = −r·sin θ − l·sin φ·φ′ &nbsp;=&nbsp; −r·sin(θ+φ) / cos φ') +
      v(`x′ = −${L(p.r)}·${num(sTh, 4)} − ${L(p.l)}·${num(s.s, 5)}·${num(s.dphi, 5)} = <b>${L(s.dx)} ${u.len}/rad</b>`);
    if (inv === 3) {
      vb += f('rod fixed: the crank angle from the rod, β = θ + φ, turns uniformly (β′ = ω), so') + f('θ̇ = ω / (1 + φ′)') +
        v(`β = ${num(s.beta * R2D, 2)}° &nbsp; θ̇ = ${sig(om)} / (1 + ${num(s.dphi, 4)}) = <b>${sig(s.thd)} rad/s</b>`) + f('θ is found from β = θ + φ(θ) by Newton iteration');
    } else {
      vb += f('θ̇ = ω (the crank angle turns uniformly)') + v(`θ̇ = <b>${sig(om)} rad/s</b>`);
    }
    vb += f('v = x′ · θ̇') + v(`v = ${L(s.dx)} · ${sig(s.thd)} = <b>${sig(u.L(s.v))} ${u.vel}</b>`);
    h += step(5, 'Slider velocity', vb);
    // acceleration
    let ab = f('φ″ = [ −r·sin θ·cos φ + r·cos θ·sin φ·φ′ ] / ( l·cos²φ )') + v(`φ″ = ${num(s.ddphi, 5)} rad⁻¹`) +
      f('x″ = −r·cos θ − l·cos φ·φ′² − l·sin φ·φ″') + v(`x″ = <b>${L(s.ddx)} ${u.len}/rad²</b>`);
    if (inv === 3) ab += f('θ̈ = −θ̇²·φ″ / (1 + φ′)') + v(`θ̈ = <b>${sig(s.thdd)} rad/s²</b>`);
    ab += f('a = x″·θ̇² + x′·θ̈') + v(`a = ${L(s.ddx)}·${sig(s.thd)}² ${inv === 3 ? `+ ${L(s.dx)}·${sig(s.thdd)} ` : ''}= <b>${sig(u.L(s.a))} ${u.acc}</b>`);
    h += step(6, 'Slider acceleration', ab);
    h += step(7, 'Rod angular motion', f('φ̇ = φ′·θ̇ &nbsp;&nbsp; φ̈ = φ″·θ̇² + φ′·θ̈') +
      v(`φ̇ = ${num(s.dphi, 4)}·${sig(s.thd)} = <b>${sig(s.phid)} rad/s</b> &nbsp; φ̈ = <b>${sig(s.phidd)} rad/s²</b>`));
    // dead centres
    let dc = f('dead centres: crank and rod in line') + f('x<sub>TDC</sub> = √( (l + r)² − e² ) &nbsp;&nbsp; x<sub>BDC</sub> = √( (l − r)² − e² )') +
      v(`x<sub>TDC</sub> = √(${L(p.l + p.r)}² − ${L(p.e)}²) = <b>${L(m.xt)}</b>`) + v(`x<sub>BDC</sub> = √(${L(p.l - p.r)}² − ${L(p.e)}²) = <b>${L(m.xb)}</b>`) +
      f('stroke = x<sub>TDC</sub> − x<sub>BDC</sub>') + v(`stroke = ${L(m.xt)} − ${L(m.xb)} = <b>${L(m.stroke)} ${u.len}</b> ${Math.abs(p.e) < 1e-9 ? ' (= 2r)' : ''}`);
    if (inv === 3) {
      dc += f('quick return (slotted lever): the lever swings between θ = ±90°; time ratio = larger / smaller part of the cycle') +
        v(`β from ${num((90 * D2R + Math.asin((p.r - p.e) / p.l)) * R2D, 2)}° to ${num((270 * D2R + Math.asin((-p.r - p.e) / p.l)) * R2D, 2)}° &nbsp;→&nbsp; ${num(m.fwd * R2D, 2)}° vs ${num(m.ret * R2D, 2)}°`) +
        f('Q = (180° + 2·sin⁻¹(r/l)) / (180° − 2·sin⁻¹(r/l)) &nbsp;(e = 0)') + v(`Q = <b>${num(m.ratio, 4)}</b>`);
    } else {
      dc += f('α = angle between the crank positions at the two dead centres, Q = (180° + α) / (180° − α)') +
        v(`α = sin⁻¹(e/(l−r)) − sin⁻¹(e/(l+r)) = <b>${num(m.alpha * R2D, 3)}°</b>`) + v(`Q = (180° + ${num(m.alpha * R2D, 2)}°) / (180° − ${num(m.alpha * R2D, 2)}°) = <b>${num(m.ratio, 4)}</b>`);
    }
    h += step(8, 'Stroke and time ratio', dc);
    h += step(9, 'Crank torque  (T(θ) graph)', f('power balance: T·θ̇ = F<sub>net</sub>·v &nbsp;⇒&nbsp; T = F<sub>net</sub>·dx/dθ') + f('F<sub>net</sub> = F − m·a (slider force minus inertia)') +
      v(`F<sub>net</sub> = ${sig(st.F)} − ${sig(st.m)}·${sig(s.a / 1000)} = ${sig(s.Fnet)} N`) + v(`T = ${sig(s.Fnet)} N · ${num(s.dx / 1000, 5)} m/rad = <b>${sig(u.T(s.T))} ${u.tq}</b>`));
    h += step(10, `Inversion ${inv}: ${INV_TEXT[inv]}`, `<div class="note">Fixing a different link does not change the <i>relative</i> motion of the chain — every inversion has the same θ, φ, x, v, a.
      What changes is which part you see standing still${inv === 3 ? '; with the rod fixed the quick-return effect appears because the uniform input is β = θ + φ, not θ' : ''}. Used in: ${INV_USE[inv]}.</div>`);
    return h;
  }

  // ------------------------------------------------------------------ orchestration
  let lastSlow = 0;
  function render(full) {
    if (!built || root.hidden) return;
    const p = params();
    let sol = K.solve(p, st.inv, st.th, omegaOf(), load());
    if (!sol) { st.th = 0; st.phase = 0; sol = K.solve(p, st.inv, 0, omegaOf(), load()); }
    const m = K.metrics(p, st.inv);
    $('simSvg').innerHTML = mechSvg(sol);
    const now = performance.now();
    if (full || !st.playing || now - lastSlow > 90) { // text panels refresh at ~11 fps while running
      lastSlow = now;
      $('readouts').innerHTML = readoutsHtml(sol, m);
      $('mathBody').innerHTML = mathHtml(sol, m);
      $('simGraph').innerHTML = st.showGraph ? graphSvg(sol) : '';
      updateVals();
    }
    updatePills();
  }
  function updateVals() {
    const u = un();
    $('val_r').textContent = `${num(u.L(st.r), st.units === 'SI' ? 0 : 2)} ${u.len}`;
    $('val_l').textContent = `${num(u.L(st.l), st.units === 'SI' ? 0 : 2)} ${u.len}`;
    $('val_e').textContent = `${num(u.L(st.e), st.units === 'SI' ? 0 : 2)} ${u.len}`;
    $('val_rpm').textContent = `${st.rpm} RPM`;
    $('val_F').textContent = `${sig(u.F(st.F))} ${u.force}`;
    $('val_m').textContent = `${sig(u.M(st.m))} ${u.mass}`;
  }
  function updatePills() {
    const pr = K.PRESETS[st.preset];
    $('pillInv').textContent = `${INV_NAME[st.inv]} inversion · ${INV_TEXT[st.inv]}`;
    $('pillIn').textContent = `${INPUT_TEXT[st.inv]} · ${pr ? pr.hint : INV_USE[st.inv]}`;
    $('pillRun').textContent = st.playing ? '▶ Running — click or Space to pause' : '❚❚ Paused — click or Space to run · ← → step';
    $('btnPlay').textContent = st.playing ? '❚❚ Pause' : '▶ Run';
    $('btnShow').textContent = st.showGraph ? '▾ Hide' : '▴ Show';
  }
  function syncAll() {
    $('segInv').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.inv === st.inv));
    $('segGraph').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.g === st.graph));
    $('segUnits').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.u === st.units));
    $('presets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.p === st.preset));
    $('graphCard').hidden = !st.showGraph;
  }
  /** something other than the animation changed */
  function changed(refit, soft) {
    if (!soft) st.th = K.thetaFromPhase(params(), st.inv, st.phase, st.th);
    if (K.kin(params(), st.th) === null) { st.th = 0; st.phase = 0; }
    fitView(); syncAll(); saveLocal();
    render(true);
  }

  // ------------------------------------------------------------------ open / close, keys
  function open() {
    build();
    root.hidden = false;
    applySliderRanges();
    const need = K.minRod(st.r, st.e);
    if (st.l < need) st.l = need;
    st.th = K.thetaFromPhase(params(), st.inv, st.phase, st.th);
    fitView(); syncAll(); render(true);
    root.focus();
  }
  function close() { st.playing = false; cancelAnimationFrame(raf); root.hidden = true; }
  document.addEventListener('keydown', (e) => { if (e.key === 'F3') { e.preventDefault(); if (root.hidden) open(); else close(); } }, true);
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    e.stopPropagation(); // the editor's tool shortcuts must not fire behind the simulator
    const tag = e.target.tagName, isRange = tag === 'INPUT' && e.target.type === 'range';
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (e.key === ' ' && !(tag === 'BUTTON')) { toggle(); e.preventDefault(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isRange) { step(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey); e.preventDefault(); }
  }, true);
  window.ShareVSim = { open, close };
})();
