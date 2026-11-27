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
    preset: 'IC Engine', in2: 'link1', phase: 18 * D2R, th: 18 * D2R, playing: false,
  };
  /** which angle turns uniformly (3 = the crank-to-rod angle beta, otherwise theta); see sim-core.js driveOf */
  const drv = () => K.driveOf(st.inv, st.in2);
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
  const inputText = () => (st.inv === 2 && st.in2 === 'link3' ? 'input: link 3 turns about A (β = θ + φ)'
    : ['', 'input: crank turns at O₂', 'input: link 1 turns about the fixed crank O₂', 'input: crank turns about A relative to the fixed rod (β = θ + φ)', 'input: crank turns, the guide slides through the fixed block'][st.inv]);

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
    try { localStorage.setItem(KEY, JSON.stringify({ inv: st.inv, graph: st.graph, showGraph: st.showGraph, units: st.units, r: st.r, l: st.l, e: st.e, rpm: st.rpm, F: st.F, m: st.m, preset: st.preset, in2: st.in2 })); } catch { /* ignore */ }
  }
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o) for (const k of ['inv', 'graph', 'showGraph', 'units', 'r', 'l', 'e', 'rpm', 'F', 'm', 'preset', 'in2']) if (o[k] !== undefined) st[k] = o[k];
  } catch { /* ignore */ }
  // the "Whole tool SVG" export starts the stand-alone copy in the state it was exported from
  if (window.__SIM_INITIAL) for (const k of ['inv', 'graph', 'showGraph', 'units', 'r', 'l', 'e', 'rpm', 'F', 'm', 'preset', 'in2']) if (window.__SIM_INITIAL[k] !== undefined) st[k] = window.__SIM_INITIAL[k];
  const STANDALONE = !!window.__SIM_INITIAL;

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
            <div id="simToast" class="toast" hidden></div>
          </div>
          <div class="card ctrl">
            <div class="row"><span class="lbl">INVERSION</span><div class="seg" id="segInv">${[1, 2, 3, 4].map((i) => `<button data-inv="${i}">${INV_NAME[i]}</button>`).join('')}</div>
              <span class="lbl in2" id="in2Lbl">INPUT</span><div class="seg in2" id="segIn2"><button data-in2="link1" title="Link 1 (the slotted body) turns uniformly about the fixed crank - rotary engine">link 1 · O₂</button><button data-in2="link3" title="Link 3 turns uniformly about A - Whitworth quick return">link 3 · A</button></div>
              <span class="lbl">GRAPH</span><div class="seg" id="segGraph"><button data-g="x">x(θ)</button><button data-g="v">v(θ)</button><button data-g="a">a(θ)</button><button data-g="T">T(θ)</button></div>
              <button id="btnShow" class="toggle"></button>
              <span class="lbl">UNITS</span><div class="seg" id="segUnits"><button data-u="SI">SI</button><button data-u="Imperial">Imperial</button></div></div>
            <div class="row"><span class="lbl">PRESETS</span><div class="presets" id="presets">${Object.keys(K.PRESETS).map((n) => `<button data-p="${n}">${n}</button>`).join('')}</div>
              <button id="btnPlay" class="play">▶ Run</button><button id="btnStepB" title="Step back">⏮</button><button id="btnStepF" title="Step forward">⏭</button>
              </div>
            <div class="row"><span class="lbl">EXPORT</span><button id="btnExport" class="export" title="Save this frame as a clean, heavily commented SVG file">⇩ Export SVG</button><button id="btnExportAnim" class="export" title="Save an animated SVG with play/pause, direction, speed and angle controls (open it in a browser)">⇩ Animated SVG</button><button id="btnExportSmil" class="export" title="Save a looping animated SVG that needs no script (plays in img tags and many viewers; no controls)">⇩ No-script SVG</button><button id="btnExportTool" class="export" title="Save this whole interactive simulator as ONE svg file (open it in a browser)">⇩ Whole tool SVG</button></div>
          </div>
          <div class="card sliders" id="sliders">${sliders.map((s) => `
            <div class="sl ${s.color}"><span class="chip">${s.chip}</span><span class="nm">${s.label}${s.sym ? ` <i>${s.sym}</i>` : ''}</span>
              <input type="range" id="sl_${s.id}"><span class="val" id="val_${s.id}"></span></div>`).join('')}
            <div class="sl gold"><span class="chip">F</span><span class="nm">Slider force <i>F</i></span><input type="range" id="sl_F" min="0" max="2000" step="10"><span class="val" id="val_F"></span></div>
            <div class="sl gold"><span class="chip">m</span><span class="nm">Slider mass <i>m</i></span><input type="range" id="sl_m" min="0" max="10" step="0.1"><span class="val" id="val_m"></span></div>
          </div>
          <div class="cards" id="readouts"></div>
          <div class="card graphcard" id="graphCard"><svg id="simGraph" viewBox="0 0 ${W} 176"></svg></div>
        </div>
        <aside class="simmath card">
          <div class="mtabs"><button data-mt="work" class="on">The maths</button><button data-mt="theory">Theory</button><button data-mt="pros">Pros &amp; cons</button></div>
          <div class="mpane" id="paneWork"><div class="msub">worked through with your current numbers — updates live</div><div id="mathBody"></div></div>
          <div class="mpane" id="paneTheory" hidden><div id="theoryBody"></div></div>
          <div class="mpane" id="panePros" hidden><div id="prosBody"></div></div>
        </aside>
      </div>`;
    wire();
    applySliderRanges();
    syncAll();
  }

  function wire() {
    $('simClose').onclick = close;
    $('segInv').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.inv = +b.dataset.inv; st.preset = ''; st.th = K.thetaFromPhase(params(), drv(), st.phase, st.th); changed(true); } };
    $('segIn2').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.in2 = b.dataset.in2; st.preset = ''; st.phase = st.th; if (drv() === 3) { const k = K.kin(params(), st.th); if (k) st.phase = st.th + k.phi; } changed(true); } };
    $('segGraph').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.graph = b.dataset.g; changed(); } };
    $('segUnits').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.units = b.dataset.u; applySliderRanges(); changed(); } };
    $('btnShow').onclick = () => { st.showGraph = !st.showGraph; changed(); };
    $('presets').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const p = K.PRESETS[b.dataset.p];
      Object.assign(st, { inv: p.inv, in2: p.in2 || 'link1', r: p.r, l: p.l, e: p.e, rpm: p.rpm, preset: b.dataset.p });
      st.phase = 18 * D2R; st.th = st.phase;
      applySliderRanges();
      changed(true);
    };
    $('btnPlay').onclick = toggle;
    $('btnStepB').onclick = () => step(-1);
    $('btnStepF').onclick = () => step(1);
    $('simSvg').addEventListener('click', toggle);
    $('simGraph').addEventListener('click', (e) => {
      if (!gInfo) return;
      const r = $('simGraph').getBoundingClientRect();
      const x = e.clientX - r.left;                       // the graph's viewBox is its pixel size, so no scaling is needed
      const th = Math.max(0, Math.min(1, (x - GM.l) / (gInfo.gw - GM.l - GM.r))) * 2 * Math.PI;
      st.th = th;
      const k = K.kin(params(), th);
      st.phase = drv() === 3 && k ? th + k.phi : th;
      st.playing = false; render(true);
    });
    $('btnExport').onclick = doExport;
    $('btnExportAnim').onclick = doExportAnimated;
    $('btnExportSmil').onclick = doExportSmil;
    $('btnExportTool').onclick = doExportTool;
    if (STANDALONE) $('btnExportTool').hidden = true; // this already IS the exported tool
    root.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.id !== 'simClose') b.blur(); }); // keep Space = run/pause after clicking any button
    root.querySelector('.mtabs').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      root.querySelectorAll('.mtabs button').forEach((x) => x.classList.toggle('on', x === b));
      for (const [k, id] of [['work', 'paneWork'], ['theory', 'paneTheory'], ['pros', 'panePros']]) $(id).hidden = b.dataset.mt !== k;
      if (b.dataset.mt !== 'work') buildTheory();
    };
    if (window.ResizeObserver) new ResizeObserver(() => { if (!root.hidden && st.showGraph) { gKey = ''; const s = K.solve(params(), drv(), st.th, omegaOf(), load()); if (s) drawGraph(s); } }).observe($('graphCard'));
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
    st.th = K.thetaFromPhase(params(), drv(), st.phase, st.th);
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

  // ------------------------------------------------------------------ mechanism drawing helpers
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
    const p = params(), m = K.metrics(p, drv());
    const pts = [];
    const gp = 0.3 * p.r + 14;
    for (let t = 0; t < 360; t += 4) {
      const th = t * D2R, k = K.kin(p, th);
      if (!k) continue;
      const X = xform(th, k).f;
      for (const q of [{ x: 0, y: 0 }, { x: p.r * Math.cos(th), y: p.r * Math.sin(th) }, { x: k.x, y: p.e }, { x: Math.min(0, m.xb - gp), y: p.e }, { x: m.xt + gp, y: p.e }, { x: k.x + 14, y: p.e + 12 }, { x: k.x - 14, y: p.e - 12 }]) pts.push(X(q));
    }
    if (st.inv === 1) { const R = ringR(); pts.push({ x: -R, y: -R }, { x: R, y: R }); }
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const ml = Math.abs(p.e) > 0.5 ? 170 : 70, mr = 70, my = 62; // room on the left for the offset dimension
    const s = Math.min((W - ml - mr) / Math.max(1, x1 - x0), (H - 2 * my - 30) / Math.max(1, y1 - y0));
    view = { s, ox: ml + (W - ml - mr) / 2 - ((x0 + x1) / 2) * s, oy: H / 2 - 14 + ((y0 + y1) / 2) * s };
  }
  const tag = (x, y, t, cls = '') => `<g class="tag ${cls}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><rect x="${-(t.length * 3.6 + 7)}" y="-10" width="${t.length * 7.2 + 14}" height="20" rx="5"/><text text-anchor="middle" y="4.5">${t}</text></g>`;
  const bar = (a, b, w, col, dark) => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${dark}" stroke-width="${w + 4}" stroke-linecap="round"/><line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  const pin = (q, r = 7) => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r}" fill="#e9edf4" stroke="#3b4252" stroke-width="2"/><circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r - 4}" fill="#566073"/>`;

  /** Returns the pieces of the drawing back-to-front. Each piece has a title and a plain-English note (used as
   *  comments in the exported file) and the SVG markup itself, in screen pixels. */
  function mechSections(sol) {
    const p = params(), th = sol.th, u = un();
    const m = K.metrics(p, drv());
    const T = xform(th, sol), X = T.f;
    const O = P(X({ x: 0, y: 0 })), A = P(X({ x: p.r * Math.cos(th), y: p.r * Math.sin(th) })), B = P(X({ x: sol.x, y: p.e }));
    const gp = 0.3 * p.r + 14;
    const G0 = P(X({ x: Math.min(0, m.xb - gp), y: p.e })), G1 = P(X({ x: m.xt + gp, y: p.e })), Oe = P(X({ x: 0, y: p.e }));
    const hasE = Math.hypot(Oe.x - O.x, Oe.y - O.y) > 4;
    const ln = (a, b, w, c) => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
    const secs = [];
    const add = (id, title, note, svg) => secs.push({ id, title, note, svg });
    const pxs = (q) => `(${q.x.toFixed(1)}, ${q.y.toFixed(1)}) px`;
    const mm = (v) => `${num(u.L(v), st.units === 'SI' ? 2 : 3)} ${u.len}`;

    // ---- protractor (frame 1 only: the angle scale belongs to the guide)
    if (st.inv === 1) {
      const R = ringR() * view.s;
      let g = `<circle cx="${O.x.toFixed(1)}" cy="${O.y.toFixed(1)}" r="${R.toFixed(1)}" fill="none" stroke="#6b7a90" stroke-width="1.4"/>`;
      for (let d = 0; d < 360; d += 5) {
        const major = d % 30 === 0, mid = d % 10 === 0, a = d * D2R, c = Math.cos(a), s = -Math.sin(a), len = major ? 9 : mid ? 6 : 3.5;
        g += `<line x1="${(O.x + c * R).toFixed(1)}" y1="${(O.y + s * R).toFixed(1)}" x2="${(O.x + c * (R - len)).toFixed(1)}" y2="${(O.y + s * (R - len)).toFixed(1)}" stroke="#6b7a90" stroke-width="${major ? 1.6 : 1}"/>`;
        if (major) g += `<text x="${(O.x + c * (R + 17)).toFixed(1)}" y="${(O.y + s * (R + 17) + 4).toFixed(1)}" text-anchor="middle" class="deg">${d}°</text>`;
      }
      add('protractor', 'PROTRACTOR', `Angle scale centred on the crank pivot O2 at ${pxs(O)}. A tick every 5 degrees, longer every 10, labelled every 30. Angles are measured counter-clockwise from the slider guide (the +x direction).`, g);
    }

    // ---- link 1: one rigid body made of the pivot boss, the (optional) offset connector and the slotted bar
    {
      const parts = (w, c) => ln(G0, G1, w, c) + (hasE ? ln(O, Oe, w, c) : '') + `<circle cx="${O.x.toFixed(1)}" cy="${O.y.toFixed(1)}" r="${w / 2 + 2}" fill="${c}"/>`;
      let g = parts(38, '#454c5b') + parts(34, '#b8bdc8');        // dark outline pass first, light fill pass on top: the union looks like one casting
      const tb = P(X({ x: m.xb, y: p.e })), tt = P(X({ x: m.xt, y: p.e }));
      const dx = G1.x - G0.x, dy = G1.y - G0.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
      g += ln({ x: tb.x - ux * 22, y: tb.y - uy * 22 }, { x: tt.x + ux * 22, y: tt.y + uy * 22 }, 10, '#2f3541'); // the groove the slider runs in
      const stepMm = st.units === 'SI' ? 10 : 12.7;
      for (let xm = Math.ceil(m.xb / stepMm) * stepMm; xm <= m.xt + 1e-6; xm += stepMm) {            // ruler ticks along the groove
        const q = P(X({ x: xm, y: p.e })), major = Math.round(xm / stepMm) % 5 === 0;
        g += `<line x1="${(q.x - uy * (major ? 12 : 8)).toFixed(1)}" y1="${(q.y + ux * (major ? 12 : 8)).toFixed(1)}" x2="${(q.x - uy * 17).toFixed(1)}" y2="${(q.y + ux * 17).toFixed(1)}" stroke="#2f3541" stroke-width="${major ? 1.6 : 1}"/>`;
      }
      g += `<text x="${(G1.x - ux * 2).toFixed(1)}" y="${(G1.y + 4).toFixed(1)}" class="linklbl small" text-anchor="middle">1</text>`;
      add('link-1-frame', 'LINK 1 - FRAME / GUIDE', `One rigid grey body: a round boss around the crank pivot O2 ${pxs(O)}${hasE ? `, a connector to the slider line (offset e = ${mm(p.e)})` : ''} and the slotted bar from ${pxs(G0)} to ${pxs(G1)}. It is drawn twice - a wider dark stroke first, then a narrower light stroke - so the pieces merge into one outline. The dark groove is the slot the slider block runs in; its ends are the dead centres (BDC at x = ${mm(m.xb)}, TDC at x = ${mm(m.xt)} measured along the guide from O2).`, g);
    }

    // ---- dimensions
    {
      let g = '', note = '';
      if (st.inv !== 3) {
        const Tt = P(X({ x: m.xt, y: p.e })), Bb = P(X({ x: m.xb, y: p.e }));
        const nx = (Tt.y - Bb.y), ny = -(Tt.x - Bb.x), nl = Math.hypot(nx, ny) || 1;
        const off = (q, d) => ({ x: q.x + (nx / nl) * d, y: q.y + (ny / nl) * d });
        g += `<g class="dc"><line x1="${off(Bb, -26).x.toFixed(1)}" y1="${off(Bb, -26).y.toFixed(1)}" x2="${off(Bb, -66).x.toFixed(1)}" y2="${off(Bb, -66).y.toFixed(1)}"/><line x1="${off(Tt, -26).x.toFixed(1)}" y1="${off(Tt, -26).y.toFixed(1)}" x2="${off(Tt, -66).x.toFixed(1)}" y2="${off(Tt, -66).y.toFixed(1)}"/><line x1="${off(Bb, -56).x.toFixed(1)}" y1="${off(Bb, -56).y.toFixed(1)}" x2="${off(Tt, -56).x.toFixed(1)}" y2="${off(Tt, -56).y.toFixed(1)}" marker-start="url(#arr)" marker-end="url(#arr)"/><text x="${off(Bb, -80).x.toFixed(1)}" y="${off(Bb, -80).y.toFixed(1)}" text-anchor="middle">BDC</text><text x="${off(Tt, -80).x.toFixed(1)}" y="${off(Tt, -80).y.toFixed(1)}" text-anchor="middle">TDC</text></g>`;
        const mid = off({ x: (Bb.x + Tt.x) / 2, y: (Bb.y + Tt.y) / 2 }, -56);
        g += tag(mid.x, mid.y, `stroke = ${num(u.L(m.stroke), 1)} ${u.len}`, 'dim');
        note += `Stroke dimension: two extension lines at the dead centres and a dimension line between them. The arrow tips end exactly on the extension lines (the marker's reference point is its tip). stroke = x_TDC - x_BDC = ${mm(m.stroke)}. `;
      }
      if (hasE) {
        const sx = P(X({ x: -1, y: 0 })), nx = sx.x - O.x, ny = sx.y - O.y, nl = Math.hypot(nx, ny) || 1, ux = nx / nl, uy = ny / nl;
        const q = (pt, d) => ({ x: pt.x + ux * d, y: pt.y + uy * d });
        const a = q(O, 52), b = q(Oe, 52), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        g += `<g class="dc e"><line x1="${q(O, 24).x.toFixed(1)}" y1="${q(O, 24).y.toFixed(1)}" x2="${q(O, 60).x.toFixed(1)}" y2="${q(O, 60).y.toFixed(1)}"/><line x1="${q(Oe, 24).x.toFixed(1)}" y1="${q(Oe, 24).y.toFixed(1)}" x2="${q(Oe, 60).x.toFixed(1)}" y2="${q(Oe, 60).y.toFixed(1)}"/><line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" marker-start="url(#arrE)" marker-end="url(#arrE)"/></g>` + tag(mid.x + ux * 44, mid.y + uy * 4, `e ${num(u.L(p.e), 2)} ${u.len}`, 'edim');
        note += `Offset dimension e = ${mm(p.e)}: the distance between the crank-pivot axis through O2 and the slider line (teal, drawn on the side away from the slot).`;
      }
      if (g) add('dimensions', 'DIMENSIONS', note.trim(), g);
    }

    // ---- links 2, 3 and the slider block 4
    add('link-2-crank', 'LINK 2 - CRANK  (O2 to A)', `Teal bar from the fixed pivot O2 ${pxs(O)} to the crank pin A ${pxs(A)}. In millimetres A = (r cos(theta), r sin(theta)) = (${num(p.r * Math.cos(th), 2)}, ${num(p.r * Math.sin(th), 2)}) with r = ${mm(p.r)} and theta = ${num(th * R2D, 2)} deg. Drawn as a dark wide line under a coloured narrower line.`, bar(O, A, 18, '#2ea898', '#17594f'));
    add('link-3-rod', 'LINK 3 - CONNECTING ROD  (A to B)', `Purple bar from A ${pxs(A)} to the slider pin B ${pxs(B)}; its length is l = ${mm(p.l)} and it leans phi = ${num(sol.phi * R2D, 2)} deg to the guide (sin(phi) = (r sin(theta) - e) / l).`, bar(A, B, 16, '#8f64d8', '#47306f'));
    add('link-4-slider', 'LINK 4 - SLIDER BLOCK', `Gold block centred on B ${pxs(B)}, rotated ${num(-T.rot * R2D, 2)} deg so it always lies along the guide. B is x = ${mm(sol.x)} from O2 along the guide: x = r cos(theta) + l cos(phi).`,
      `<g transform="translate(${B.x.toFixed(1)} ${B.y.toFixed(1)}) rotate(${(-T.rot * R2D).toFixed(2)})"><rect x="-22" y="-15" width="44" height="30" rx="5" fill="#d3a92f" stroke="#6b5412" stroke-width="2.5"/><rect x="-16" y="-9" width="32" height="18" rx="3" fill="#e8c65a" opacity=".55"/></g>`);
    add('pins', 'PIN JOINTS', 'Three revolute pins drawn last so they sit on top of the links: O2 (frame-crank), A (crank-rod) and B (rod-slider).', pin(O, 9) + pin(A, 7) + pin(B, 7));

    // ---- labels
    {
      const ang = Math.atan2(B.y - A.y, B.x - A.x) * R2D, la = ang > 90 || ang < -90 ? ang + 180 : ang;
      const ca = Math.atan2(A.y - O.y, A.x - O.x) * R2D, cl = ca > 90 || ca < -90 ? ca + 180 : ca;
      let g = `<text transform="translate(${((A.x + B.x) / 2).toFixed(1)} ${((A.y + B.y) / 2 + 4).toFixed(1)}) rotate(${la.toFixed(1)})" text-anchor="middle" class="linklbl">3 · l ${num(u.L(p.l), 1)} ${u.len}</text>`;
      g += `<text transform="translate(${((O.x + A.x) / 2).toFixed(1)} ${((O.y + A.y) / 2 + 4).toFixed(1)}) rotate(${cl.toFixed(1)})" text-anchor="middle" class="linklbl small">2 · r ${num(u.L(p.r), 1)}</text>`;
      g += tag(O.x - 26, O.y + 24, 'O₂', 'tl') + (st.inv === 3 ? tag(A.x + 6, A.y + 28, 'A') : tag(A.x, A.y - 24, 'A')) + tag(B.x + 22, B.y + 30, 'B');
      g += tag(B.x + 52, B.y - 44, `x = ${num(u.L(sol.x), 1)} ${u.len}`, 'xtag');
      add('labels', 'LABELS', 'Link-length labels run along the bars (flipped when they would be upside-down), small tags name the pivots, and the x tag reads the slider position from O2.', g);
    }

    // ---- input arrow: centred exactly on the pivot the input turns about
    {
      const atA = drv() === 3, C = atA ? A : O, R = 30, ccw = st.inv !== 2;
      const [a1, a2] = atA ? [55, 125] : [-125, -55];
      const pt = (deg) => ({ x: C.x + R * Math.cos(deg * D2R), y: C.y - R * Math.sin(deg * D2R) });
      const s0 = ccw ? pt(a1) : pt(a2), s1 = ccw ? pt(a2) : pt(a1);
      add('input-arrow', 'INPUT ROTATION ARROW', `A circular arc of radius ${R} px centred exactly on the pivot the input turns about (${atA ? 'A, because link 3 turns about A relative to the crank' : 'O2'} at ${pxs(C)}), drawn ${ccw ? 'counter-clockwise' : 'clockwise'}. The arrow head sits at the end of the arc.`,
        `<path d="M ${s0.x.toFixed(1)} ${s0.y.toFixed(1)} A ${R} ${R} 0 0 ${ccw ? 0 : 1} ${s1.x.toFixed(1)} ${s1.y.toFixed(1)}" fill="none" stroke="#2ea898" stroke-width="2.6" marker-end="url(#arrT)"/>`);
    }
    return { secs, O, A, B, m, hasE };
  }

  const MARKERS = `<marker id="arr" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#c2551c"/></marker>
      <marker id="arrE" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#2ea898"/></marker>
      <marker id="arrT" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L8 4L0 8z" fill="#2ea898"/></marker>`;
  const GRID = `<pattern id="gridS" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3a4558" stroke-width=".6"/></pattern>
      <pattern id="gridL" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#gridS)"/><path d="M100 0H0V100" fill="none" stroke="#4a5870" stroke-width="1"/></pattern>`;
  function mechSvg(sol) {
    const { secs } = mechSections(sol);
    return `<defs>${MARKERS}${GRID}</defs><rect width="${W}" height="${H}" rx="14" fill="#1b2231"/><rect width="${W}" height="${H}" rx="14" fill="url(#gridL)"/>${secs.map((s) => s.svg).join('')}`;
  }

  // ---- SVG export: the same drawing, but laid out as a readable, heavily commented file
  const SVG_CSS = `
    /* text styles (the drawing itself uses plain presentation attributes so it renders anywhere) */
    text        { font-family: "Segoe UI", Arial, sans-serif; }
    .deg        { fill: #8e9bb3; font-size: 11px; }                       /* protractor numbers            */
    .dc line    { stroke: #c2551c; stroke-width: 1.5; }                   /* dimension / extension lines   */
    .dc text    { fill: #e26b2a; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
    .dc.e line  { stroke: #2ea898; }                                      /* offset dimension is teal      */
    .tag rect   { fill: #1d2538; stroke: #36456a; }                       /* small label boxes             */
    .tag text   { fill: #e8eefb; font-size: 12px; font-weight: 700; }
    .tag.dim rect  { fill: #2a1d18; stroke: #7a3a1c; }  .tag.dim text  { fill: #ffb98a; }
    .tag.edim rect { fill: #14302c; stroke: #2ea898; }  .tag.edim text { fill: #8fe3d4; }
    .tag.xtag rect { fill: #2a2e3c; stroke: #566080; }
    .linklbl    { fill: #fff; font-size: 13px; font-weight: 700; paint-order: stroke; stroke: rgba(0,0,0,.35); stroke-width: 2px; }
    .linklbl.small { font-size: 11px; }`;
  function exportSvg() {
    const sol = K.solve(params(), drv(), st.th, omegaOf(), load());
    if (!sol) return '';
    const p = params(), u = un(), m = K.metrics(p, drv());
    const { secs } = mechSections(sol);
    const pretty = (s) => s.replace(/></g, '>\n      <');
    const deg = (v) => num(v * R2D, 2) + ' deg';
    const date = new Date().toISOString().slice(0, 10);
    const head = `<!--
  ===========================================================================================
  CRANK & SLIDER MECHANISM  -  one frame, exported from ShareV on ${date}
  ===========================================================================================

  WHAT YOU ARE LOOKING AT
    A slider-crank chain: four links joined by three pin joints and one sliding joint.
      link 1  frame / guide (grey)        link 3  connecting rod (purple)
      link 2  crank         (teal)        link 4  slider block (gold)
    This file shows the ${INV_NAME[st.inv]} inversion: ${INV_TEXT[st.inv]}.  (${INV_USE[st.inv]})
    Fixing a different link does not change the relative motion, only what looks still.

  INPUTS
    crank length        r = ${num(u.L(p.r), 3)} ${u.len}
    connecting rod      l = ${num(u.L(p.l), 3)} ${u.len}
    offset              e = ${num(u.L(p.e), 3)} ${u.len}   (distance of the slider line from the crank pivot)
    input speed         n = ${st.rpm} rpm  ->  omega = 2*pi*n/60 = ${num(omegaOf(), 4)} rad/s
    slider force / mass F = ${num(u.F(st.F), 2)} ${u.force}, m = ${num(u.M(st.m), 3)} ${u.mass}   (only used for the torque graph)

  THE EQUATIONS (frame 1, angles counter-clockwise from the guide direction)
    loop closure  :  l*sin(phi) = r*sin(theta) - e        ->  phi = asin( (r*sin(theta) - e) / l )
    slider x      :  x = r*cos(theta) + l*cos(phi)
    velocity      :  v = dx/dt = -r*omega*sin(theta + phi) / cos(phi)
    acceleration  :  a = d2x/dt2   (differentiate again; see the maths panel in ShareV)
    dead centres  :  x_TDC = sqrt((l+r)^2 - e^2),  x_BDC = sqrt((l-r)^2 - e^2),  stroke = x_TDC - x_BDC
    time ratio    :  Q = (180 + alpha) / (180 - alpha)   with alpha the crank angle between the dead centres

  VALUES AT THIS INSTANT
    theta = ${deg(sol.th)}    phi = ${deg(sol.phi)}
    x = ${num(u.L(sol.x), 3)} ${u.len}    v = ${num(u.L(sol.v), 3)} ${u.vel}    a = ${num(u.L(sol.a), 3)} ${u.acc}
    stroke = ${num(u.L(m.stroke), 3)} ${u.len}    N = l/r = ${num(m.N, 3)}    time ratio = ${num(m.ratio, 4)}

  HOW THE DRAWING IS BUILT
    1. Geometry is computed in millimetres with the crank pivot O2 as origin and y pointing UP.
    2. It is converted to screen pixels (y pointing DOWN) with  px = OX + x*S   py = OY - y*S
       where S = ${view.s.toFixed(4)} px per mm, OX = ${view.ox.toFixed(1)}, OY = ${view.oy.toFixed(1)}.
    3. The layers below are listed back to front, so later layers paint over earlier ones.
    4. Every bar is two <line>s with round caps: a dark wide one (the outline) under a coloured narrower one.
    5. For the inversions where another link is fixed, every point is first transformed by the rigid motion
       that holds that link still (a rotation and/or translation) - the shapes themselves never change.
  ===========================================================================================
-->`;
    const body = secs.map((s) => `
  <!-- ${'~'.repeat(86)}
       ${s.title}
       ${s.note.replace(/--+/g, '-').replace(/(.{1,92})(\s|$)/g, '$1\n       ').trim()}
       ${'~'.repeat(86)} -->
  <g id="${s.id}">
      ${pretty(s.svg)}
  </g>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
${head}
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <title>Crank and slider mechanism - ${INV_NAME[st.inv]} inversion</title>
  <desc>Slider-crank chain: r = ${num(u.L(p.r), 2)} ${u.len}, l = ${num(u.L(p.l), 2)} ${u.len}, e = ${num(u.L(p.e), 2)} ${u.len}, theta = ${deg(sol.th)}.</desc>

  <style>${SVG_CSS}
  </style>

  <!-- Reusable bits: arrow heads for dimension lines (their reference point is the TIP, so the tip lands exactly
       on the line end) and the background grid pattern (20 px minor, 100 px major squares). -->
  <defs>
      ${pretty(MARKERS)}
      ${pretty(GRID)}
  </defs>

  <!-- BACKGROUND: dark panel with the grid pattern painted over it -->
  <rect width="${W}" height="${H}" rx="14" fill="#1b2231"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#gridL)"/>
${body}
</svg>
`;
  }
  const exportName = () => `crank-slider_${INV_NAME[st.inv]}-inversion_r${Math.round(st.r)}_l${Math.round(st.l)}_e${Math.round(st.e)}.svg`;
  function doExport() {
    const text = exportSvg();
    if (!text) return;
    const done = (where) => toast(where ? `Saved ${where}` : 'Export cancelled');
    if (window.api && window.api.saveFile) window.api.saveFile(exportName(), 'svg', 'SVG image', text).then(done).catch((e) => toast('Export failed: ' + (e && e.message || e)));
    else { // plain browser fallback
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      a.download = exportName(); a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Exported ' + exportName());
    }
  }
  /** animated, interactive SVG (see sim-export.js): the same drawing, moved by a small commented script, with a few controls */
  function exportAnimated() {
    const p = params(), u = un(), m = K.metrics(p, drv());
    const sol = K.solve(p, drv(), st.th, omegaOf(), load());
    if (!sol || !window.SimExport) return '';
    const gp = 0.3 * p.r + 14;
    const { secs, hasE } = mechSections(sol);
    const prot = secs.find((s) => s.id === 'protractor');
    return window.SimExport.animatedSvg({
      r: p.r, l: p.l, e: p.e, inv: st.inv, beta: drv() === 3, rpm: st.rpm, theta: st.th, phase: st.phase,
      view: { s: view.s, ox: view.ox, oy: view.oy }, gl: Math.min(0, m.xb - gp), gr: m.xt + gp, xb: m.xb, xt: m.xt, hasE,
      units: { len: u.len, k: u.L(1) }, protractor: prot ? prot.svg.replace(/></g, '>\n    <') : '', metrics: m,
      texts: { date: new Date().toISOString().slice(0, 10), invName: INV_NAME[st.inv], invText: INV_TEXT[st.inv], invUse: INV_USE[st.inv] },
    });
  }
  /** looping SMIL animation without any script (plays inside <img>, many viewers and e-mail) */
  function exportSmil() {
    const p = params(), u = un(), m = K.metrics(p, drv());
    const sol = K.solve(p, drv(), st.th, omegaOf(), load());
    if (!sol || !window.SimExport) return '';
    const gp = 0.3 * p.r + 14;
    const { secs, hasE } = mechSections(sol);
    const prot = secs.find((x) => x.id === 'protractor');
    return window.SimExport.smilSvg({
      r: p.r, l: p.l, e: p.e, inv: st.inv, beta: drv() === 3, rpm: st.rpm, theta: st.th, phase: st.phase,
      view: { s: view.s, ox: view.ox, oy: view.oy }, gl: Math.min(0, m.xb - gp), gr: m.xt + gp, xb: m.xb, xt: m.xt, hasE,
      units: { len: u.len, k: u.L(1) }, protractor: prot ? prot.svg.replace(/></g, '>\n    <') : '', metrics: m,
      texts: { date: new Date().toISOString().slice(0, 10), invName: INV_NAME[st.inv], invText: INV_TEXT[st.inv], invUse: INV_USE[st.inv] },
    }, K);
  }
  function doExportSmil() {
    const text = exportSmil();
    if (!text) return;
    const name = exportName().replace(/\.svg$/, '_loop-no-script.svg');
    const done = (where) => toast(where ? `Saved ${where} — a looping animation with no script` : 'Export cancelled');
    if (window.api && window.api.saveFile) window.api.saveFile(name, 'svg', 'SVG image', text).then(done).catch((e) => toast('Export failed: ' + (e && e.message || e)));
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Exported ' + name);
    }
  }
  /** The whole simulator as ONE svg file (see tool-export.js). The source text comes from sim-bundle.js, loaded on demand. */
  function loadBundle() {
    if (window.SIM_BUNDLE) return Promise.resolve(window.SIM_BUNDLE);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'sim-bundle.js';
      s.onload = () => (window.SIM_BUNDLE ? resolve(window.SIM_BUNDLE) : reject(new Error('sim-bundle.js did not define SIM_BUNDLE')));
      s.onerror = () => reject(new Error('could not load sim-bundle.js'));
      document.head.appendChild(s);
    });
  }
  async function doExportTool() {
    try {
      toast('Building the whole tool…');
      const bundle = await loadBundle();
      const p = params(), u = un();
      const sol = K.solve(p, drv(), st.th, omegaOf(), load());
      if (!sol || !window.ToolExport) return;
      const init = { inv: st.inv, graph: st.graph, showGraph: st.showGraph, units: st.units, r: st.r, l: st.l, e: st.e, rpm: st.rpm, F: st.F, m: st.m, preset: st.preset, in2: st.in2 };
      const text = window.ToolExport.build(bundle, init, `<style>${SVG_CSS}</style>` + mechSvg(sol), {
        date: new Date().toISOString().slice(0, 10), invName: INV_NAME[st.inv],
        params: `r = ${num(u.L(p.r), 2)} ${u.len}, l = ${num(u.L(p.l), 2)} ${u.len}, e = ${num(u.L(p.e), 2)} ${u.len}, ${st.rpm} rpm`,
      });
      const name = 'crank-slider-simulator_whole-tool.svg';
      const done = (where) => toast(where ? `Saved ${where} — open it in a browser` : 'Export cancelled');
      if (window.api && window.api.saveFile) await window.api.saveFile(name, 'svg', 'SVG image', text).then(done);
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Exported ' + name);
      }
    } catch (e) { toast('Export failed: ' + (e && e.message || e)); }
  }
  function doExportAnimated() {
    const text = exportAnimated();
    if (!text) return;
    const name = exportName().replace(/\.svg$/, '_animated.svg');
    const done = (where) => toast(where ? `Saved ${where} — open it in a browser to play it` : 'Export cancelled');
    if (window.api && window.api.saveFile) window.api.saveFile(name, 'svg', 'SVG image', text).then(done).catch((e) => toast('Export failed: ' + (e && e.message || e)));
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Exported ' + name);
    }
  }
  let toastT = 0;
  function toast(msg) { const el = $('simToast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4000); }

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
  // The curve and axes are drawn once (and again only when something they depend on changes); each animation frame only moves
  // the cursor line and the dot. The SVG's viewBox is the real pixel size of the card, so the dot is always a true circle.
  const GM = { l: 62, r: 16, t: 26, b: 28 };
  const GH = 176;
  let gKey = '', gInfo = null;
  const gWidth = () => Math.max(300, Math.round($('graphCard').clientWidth - 12)) || 900;
  const GCOL = { x: '#ff7a1a', v: '#2dd4a7', a: '#ffd43b', T: '#f783ac' };
  const gValue = (s) => { const u = un(); return st.graph === 'x' ? u.L(s.x) : st.graph === 'v' ? u.L(s.v) : st.graph === 'a' ? u.L(s.a) : u.T(s.T); };
  function niceTicks(lo, hi, n = 4) {
    if (hi - lo < 1e-9) hi = lo + 1;
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const stp = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / stp) * stp; v <= hi + stp * 1e-9; v += stp) out.push(Math.abs(v) < stp * 1e-9 ? 0 : v);
    return out;
  }
  function drawGraphStatic(gw) {
    const u = un(), p = params(), om = omegaOf();
    const ys = [];
    for (let t = 0; t <= 360; t += 1) { const s = K.solve(p, drv(), t * D2R, om, load()); ys.push(s ? gValue(s) : null); }
    const valid = ys.filter((v) => v !== null);
    if (!valid.length) { $('simGraph').innerHTML = ''; gInfo = null; return; }
    let lo = Math.min(...valid), hi = Math.max(...valid);
    const padv = (hi - lo) * 0.1 || 1; lo -= padv; hi += padv;
    if (st.graph !== 'x') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const iw = gw - GM.l - GM.r, ih = GH - GM.t - GM.b;
    const X = (deg) => GM.l + (deg / 360) * iw, Y = (v) => GM.t + ih - ((v - lo) / (hi - lo)) * ih;
    let g = `<rect width="${gw}" height="${GH}" rx="10" fill="#141c2e"/>`;
    for (const v of niceTicks(lo, hi)) g += `<line x1="${GM.l}" x2="${gw - GM.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${v === 0 ? '#6b7a90' : '#2c3853'}" stroke-width="${v === 0 ? 1.4 : 1}"/><text x="${GM.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="ax">${sig(v)}</text>`;
    for (let d = 0; d <= 360; d += 60) g += `<line x1="${X(d).toFixed(1)}" x2="${X(d).toFixed(1)}" y1="${GM.t}" y2="${GM.t + ih}" stroke="#2c3853"/><text x="${X(d).toFixed(1)}" y="${GM.t + ih + 17}" text-anchor="middle" class="ax">${d}°</text>`;
    let d = '', pen = false;
    ys.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${GCOL[st.graph]}" stroke-width="2.4" stroke-linejoin="round"/>`;
    const title = { x: `x(θ)  slider position [${u.len}]`, v: `v(θ)  slider velocity [${u.vel}]`, a: `a(θ)  slider acceleration [${u.acc}]`, T: `T(θ)  crank torque [${u.tq}]  for F = ${sig(u.F(st.F))} ${u.force}, m = ${sig(u.M(st.m))} ${u.mass}` }[st.graph];
    g += `<text x="${GM.l}" y="16" class="gtitle">${title}</text><text x="${gw - GM.r}" y="16" text-anchor="end" class="gtitle dim">click the graph to set θ₂</text>`;
    g += `<line id="gCur" x1="0" x2="0" y1="${GM.t}" y2="${GM.t + ih}" stroke="#fff" stroke-opacity=".45" stroke-dasharray="4 4"/><circle id="gDot" cx="-20" cy="-20" r="5.5" fill="${GCOL[st.graph]}" stroke="#fff" stroke-width="2"/>`;
    const svgEl = $('simGraph');
    svgEl.setAttribute('viewBox', `0 0 ${gw} ${GH}`);
    svgEl.setAttribute('height', GH);
    svgEl.innerHTML = g;
    gInfo = { X, Y, gw };
  }
  /** cheap per-frame update: only the cursor and the dot move; the y comes from the exact solution, not a rounded sample */
  function updateGraphMarker(sol) {
    if (!gInfo || !st.showGraph) return;
    const deg = (((sol.th * R2D) % 360) + 360) % 360, cur = $('gCur'), dot = $('gDot');
    if (!cur || !dot) return;
    const x = gInfo.X(deg).toFixed(2);
    cur.setAttribute('x1', x); cur.setAttribute('x2', x);
    dot.setAttribute('cx', x); dot.setAttribute('cy', gInfo.Y(gValue(sol)).toFixed(2));
  }
  function drawGraph(sol) {
    if (!st.showGraph) return;
    const gw = gWidth();
    const key = [st.inv, st.graph, st.units, st.r, st.l, st.e, st.rpm, st.F, st.m, gw].join('|');
    if (key !== gKey) { gKey = key; drawGraphStatic(gw); }
    updateGraphMarker(sol);
  }

  // ------------------------------------------------------------------ the maths (KaTeX), with this moment's numbers
  // Colour code used for every symbol and number: crank (link 2) teal, connecting rod (link 3) purple,
  // offset (link 1 / guide) grey, slider (link 4) gold, input speed orange, torque pink.
  const COL = { crank: '#35d0b8', rod: '#b794f6', off: '#b8c2d6', slider: '#ffcf5a', speed: '#ff9a4d', torque: '#f783ac' };
  const MACROS = {
    '\\Rk': `\\textcolor{${COL.crank}}{r}`, '\\Th': `\\textcolor{${COL.crank}}{\\theta}`,
    '\\Lr': `\\textcolor{${COL.rod}}{l}`, '\\Ph': `\\textcolor{${COL.rod}}{\\varphi}`,
    '\\Eo': `\\textcolor{${COL.off}}{e}`,
    '\\Xs': `\\textcolor{${COL.slider}}{x}`, '\\Vs': `\\textcolor{${COL.slider}}{v}`, '\\As': `\\textcolor{${COL.slider}}{a}`,
    '\\Om': `\\textcolor{${COL.speed}}{\\omega}`, '\\Tq': `\\textcolor{${COL.torque}}{T}`,
  };
  const tex = (s, display = true) => {
    if (!window.katex) return `<code>${s}</code>`;
    try { return window.katex.renderToString(s, { displayMode: display, throwOnError: false, macros: { ...MACROS }, strict: 'ignore', trust: false }); } catch { return `<code>${s}</code>`; }
  };
  const cn = (kind, txt) => `\\textcolor{${COL[kind]}}{${txt}}`;

  /** the working as a flat list of items: {h: title} | {eq: tex} | {note: html} */
  function mathItems(s, m) {
    const u = un(), p = params(), om = omegaOf(), inv = st.inv, beta = drv() === 3;
    const L = (mm) => sig(u.L(mm));
    const thDeg = ((s.th * R2D) % 360 + 360) % 360, th = num(thDeg, 2);
    const sTh = Math.sin(s.th), cTh = Math.cos(s.th);
    const un_ = `\\,\\text{${u.len}}`, vu = `\\,\\text{${u.vel}}`, au = `\\,\\text{${u.len}/s}^{2}`;
    const r = cn('crank', L(p.r)), l = cn('rod', L(p.l)), e = cn('off', L(p.e)), ph = cn('rod', num(s.phi * R2D, 3));
    const items = [];
    const H = (n, title) => items.push({ h: `${n}`, title });
    const Q = (t) => items.push({ eq: t });
    const N = (html) => items.push({ note: html });

    H(1, 'Given');
    Q(`\\Rk=${r}${un_},\\quad \\Lr=${l}${un_},\\quad \\Eo=${e}${un_}`);
    Q(`\\Om=\\dfrac{2\\pi\\,n}{60}=\\dfrac{2\\pi\\cdot ${st.rpm}}{60}=${cn('speed', sig(om))}\\ \\text{rad/s}`);
    Q(`N=\\dfrac{\\Lr}{\\Rk}=\\dfrac{${l}}{${r}}=${num(m.N, 3)}`);
    const okAsm = p.l >= p.r + Math.abs(p.e) - 0.02;
    Q(`\\text{full turn needs}\\ \\Lr\\ge\\Rk+|\\Eo|:\\quad ${L(p.l)}\\ge ${L(p.r + Math.abs(p.e))}\\ ${okAsm ? '\\checkmark' : '\\times'}`);

    H(2, 'Crank pin A');
    Q(`A=\\left(\\Rk\\cos\\Th,\\ \\Rk\\sin\\Th\\right)\\quad\\text{with}\\ \\Th=${cn('crank', th + '^\\circ')}`);
    Q(`A=\\left(${r}\\cdot ${num(cTh, 4)},\\ ${r}\\cdot ${num(sTh, 4)}\\right)=\\left(${L(p.r * cTh)},\\ ${L(p.r * sTh)}\\right)${un_}`);

    H(3, 'Rod angle φ — loop closure, y-direction');
    Q(`\\Lr\\sin\\Ph=\\Rk\\sin\\Th-\\Eo\\ \\Rightarrow\\ \\Ph=\\sin^{-1}\\!\\left(\\dfrac{\\Rk\\sin\\Th-\\Eo}{\\Lr}\\right)`);
    Q(`\\sin\\Ph=\\dfrac{${r}\\cdot ${num(sTh, 4)}-${e}}{${l}}=${num(s.s, 5)}`);
    Q(`\\Ph=\\sin^{-1}(${num(s.s, 5)})=${ph}^\\circ`);

    H(4, 'Slider position x — loop closure, x-direction');
    Q(`\\Xs=\\Rk\\cos\\Th+\\Lr\\cos\\Ph`);
    Q(`\\Xs=${r}\\cdot ${num(cTh, 4)}+${l}\\cdot ${num(s.cp, 5)}=${L(p.r * cTh)}+${L(p.l * s.cp)}=${cn('slider', L(s.x))}${un_}`);

    H(5, 'Slider velocity');
    Q(`\\text{differentiate step 3:}\\quad \\Lr\\cos\\Ph\\,\\Ph'=\\Rk\\cos\\Th\\ \\Rightarrow\\ \\Ph'=\\dfrac{d\\Ph}{d\\Th}=\\dfrac{\\Rk\\cos\\Th}{\\Lr\\cos\\Ph}`);
    Q(`\\Ph'=\\dfrac{${r}\\cdot ${num(cTh, 4)}}{${l}\\cdot ${num(s.cp, 5)}}=${num(s.dphi, 5)}`);
    Q(`\\text{differentiate step 4:}\\quad \\Xs'=\\dfrac{d\\Xs}{d\\Th}=-\\Rk\\sin\\Th-\\Lr\\sin\\Ph\\,\\Ph'=-\\dfrac{\\Rk\\sin(\\Th+\\Ph)}{\\cos\\Ph}`);
    Q(`\\Xs'=-${r}\\cdot ${num(sTh, 4)}-${l}\\cdot ${num(s.s, 5)}\\cdot ${num(s.dphi, 5)}=${cn('slider', L(s.dx))}${un_}/\\text{rad}`);
    if (beta) {
      Q(`\\text{rod fixed: } \\beta=\\Th+\\Ph\\ \\text{turns uniformly}\\ (\\dot\\beta=\\Om)\\ \\Rightarrow\\ \\dot\\Th=\\dfrac{\\Om}{1+\\Ph'}`);
      Q(`\\beta=${num(s.beta * R2D, 2)}^\\circ,\\quad \\dot\\Th=\\dfrac{${cn('speed', sig(om))}}{1+${num(s.dphi, 4)}}=${sig(s.thd)}\\ \\text{rad/s}`);
      N('θ is found from β = θ + φ(θ) by Newton iteration each frame.');
    } else {
      Q(`\\dot\\Th=\\Om=${cn('speed', sig(om))}\\ \\text{rad/s}\\quad(\\text{the crank angle turns uniformly})`);
    }
    Q(`\\Vs=\\Xs'\\,\\dot\\Th=${L(s.dx)}\\cdot ${sig(s.thd)}=${cn('slider', sig(u.L(s.v)))}${vu}`);

    H(6, 'Slider acceleration');
    Q(`\\Ph''=\\dfrac{-\\Rk\\sin\\Th\\cos\\Ph+\\Rk\\cos\\Th\\sin\\Ph\\,\\Ph'}{\\Lr\\cos^{2}\\Ph}=${num(s.ddphi, 5)}`);
    Q(`\\Xs''=-\\Rk\\cos\\Th-\\Lr\\cos\\Ph\\,\\Ph'^{2}-\\Lr\\sin\\Ph\\,\\Ph''=${cn('slider', L(s.ddx))}${un_}/\\text{rad}^{2}`);
    if (beta) Q(`\\ddot\\Th=\\dfrac{-\\dot\\Th^{2}\\,\\Ph''}{1+\\Ph'}=${sig(s.thdd)}\\ \\text{rad/s}^2`);
    Q(`\\As=\\Xs''\\,\\dot\\Th^{2}${beta ? '+\\Xs\'\\,\\ddot\\Th' : ''}=${L(s.ddx)}\\cdot ${sig(s.thd)}^{2}${beta ? `+${L(s.dx)}\\cdot ${sig(s.thdd)}` : ''}=${cn('slider', sig(u.L(s.a)))}${au}`);

    H(7, 'Rod angular motion');
    Q(`\\dot\\Ph=\\Ph'\\,\\dot\\Th=${num(s.dphi, 4)}\\cdot ${sig(s.thd)}=${cn('rod', sig(s.phid))}\\ \\text{rad/s},\\qquad \\ddot\\Ph=\\Ph''\\dot\\Th^{2}+\\Ph'\\ddot\\Th=${cn('rod', sig(s.phidd))}\\ \\text{rad/s}^2`);

    H(8, 'Dead centres, stroke and time ratio');
    Q(`\\Xs_{TDC}=\\sqrt{(\\Lr+\\Rk)^2-\\Eo^2}=${cn('slider', L(m.xt))}${un_},\\qquad \\Xs_{BDC}=\\sqrt{(\\Lr-\\Rk)^2-\\Eo^2}=${cn('slider', L(m.xb))}${un_}`);
    Q(`\\text{stroke}=\\Xs_{TDC}-\\Xs_{BDC}=${cn('slider', L(m.stroke))}${un_}${Math.abs(p.e) < 1e-9 ? '\\ (=2\\Rk)' : ''}`);
    if (beta) {
      Q(`\\text{lever swings between}\\ \\Th=\\pm 90^\\circ:\\quad \\beta\\ \\text{goes}\\ ${num(m.fwd * R2D, 2)}^\\circ\\ \\text{one way,}\\ ${num(m.ret * R2D, 2)}^\\circ\\ \\text{back}`);
      Q(`Q=\\dfrac{180^\\circ+2\\sin^{-1}(\\Rk/\\Lr)}{180^\\circ-2\\sin^{-1}(\\Rk/\\Lr)}\\ (e=0)\\quad\\Rightarrow\\quad Q=${num(m.ratio, 4)}`);
    } else {
      Q(`\\alpha=\\sin^{-1}\\!\\dfrac{\\Eo}{\\Lr-\\Rk}-\\sin^{-1}\\!\\dfrac{\\Eo}{\\Lr+\\Rk}=${num(m.alpha * R2D, 3)}^\\circ`);
      Q(`Q=\\dfrac{180^\\circ+\\alpha}{180^\\circ-\\alpha}=\\dfrac{180^\\circ+${num(m.alpha * R2D, 2)}^\\circ}{180^\\circ-${num(m.alpha * R2D, 2)}^\\circ}=${num(m.ratio, 4)}`);
    }

    H(9, 'Crank torque — the T(θ) graph');
    Q(`\\Tq\\,\\dot\\Th=F_{net}\\,\\Vs\\ \\Rightarrow\\ \\Tq=F_{net}\\,\\dfrac{d\\Xs}{d\\Th},\\qquad F_{net}=F-m\\,\\As`);
    Q(`F_{net}=${sig(st.F)}-${sig(st.m)}\\cdot ${sig(s.a / 1000)}=${sig(s.Fnet)}\\ \\text{N}`);
    Q(`\\Tq=${sig(s.Fnet)}\\ \\text{N}\\cdot ${num(s.dx / 1000, 5)}\\ \\text{m/rad}=${cn('torque', sig(u.T(s.T)))}\\ \\text{${u.tq}}`);

    H(10, `Inversion ${inv}: ${INV_TEXT[inv]}`);
    N(`Fixing a different link does not change the <i>relative</i> motion of the chain — every inversion has the same θ, φ, x, v, a. What changes is which part you see standing still${beta ? '; with the rod fixed the quick-return effect appears because the uniform input is β = θ + φ, not θ' : ''}. Used in: ${INV_USE[inv]}.`);
    return items;
  }

  // The panel keeps its DOM between frames: only equations whose TeX text changed are re-rendered.
  let mathKey = '';
  function renderMath(items) {
    const body = $('mathBody');
    const key = items.map((i) => (i.h ? 'h' + i.title : i.eq ? 'e' : 'n' + i.note)).join('|');
    if (key !== mathKey || !body.firstChild) {
      mathKey = key;
      const legend = `<div class="legend"><span style="--c:${COL.crank}">crank <b>r, θ</b></span><span style="--c:${COL.rod}">con-rod <b>l, φ</b></span><span style="--c:${COL.off}">offset <b>e</b></span><span style="--c:${COL.slider}">slider <b>x, v, a</b></span><span style="--c:${COL.speed}">input <b>ω</b></span></div>`;
      let h = legend, open = false;
      for (const it of items) {
        if (it.h) { if (open) h += '</section>'; h += `<section class="ms"><h4><b>${it.h}</b> ${it.title}</h4>`; open = true; }
        else if (it.eq) h += '<div class="eqn"></div>';
        else h += `<div class="note">${it.note}</div>`;
      }
      body.innerHTML = h + (open ? '</section>' : '');
      body._nodes = [...body.querySelectorAll('.eqn')];
      body._tex = [];
    }
    let i = 0;
    for (const it of items) {
      if (!it.eq) continue;
      if (body._tex[i] !== it.eq) { body._tex[i] = it.eq; body._nodes[i].innerHTML = tex(it.eq); }
      i++;
    }
  }

  // ------------------------------------------------------------------ theory and pros / cons (static, rendered once)
  let theoryDone = false;
  function buildTheory() {
    if (theoryDone) return;
    theoryDone = true;
    const T = (s) => tex(s, true), t = (s) => tex(s, false);
    $('theoryBody').innerHTML = `
      <section class="ms"><h4><b>A</b> What is a slider-crank?</h4>
        <p>Four rigid links joined by three pin (revolute) joints and one sliding (prismatic) joint: a <b style="color:${COL.crank}">crank</b> turning about a fixed pivot,
        a <b style="color:${COL.rod}">connecting rod</b> and a <b style="color:${COL.slider}">slider</b> that is forced to move along a straight guide. It turns rotation into straight-line motion
        (engines, compressors, presses) or the reverse (pumps, saws, steam locomotives), and it is the most widely used mechanism in machinery.</p></section>
      <section class="ms"><h4><b>B</b> Degrees of freedom (Grübler)</h4>
        ${T('M=3(n-1)-2j_1-j_2=3(4-1)-2(4)-0=1')}
        <p>n = 4 links and j₁ = 4 one-degree joints give <b>one</b> degree of freedom: choose the crank angle and every other position is fixed. That is why a single input (a motor or a gas force) is enough.</p></section>
      <section class="ms"><h4><b>C</b> Exact position, velocity, acceleration</h4>
        ${T('\\sin\\varphi=\\dfrac{r\\sin\\theta-e}{l},\\qquad x=r\\cos\\theta+l\\cos\\varphi')}
        ${T('v=-\\dfrac{r\\omega\\sin(\\theta+\\varphi)}{\\cos\\varphi}')}
        <p>These are the formulas the simulator uses (steps 3–6 of the working). They hold for any ratio l/r and any offset.</p></section>
      <section class="ms"><h4><b>D</b> The famous approximation (e = 0, N = l/r ≳ 3)</h4>
        <p>Expanding the square root gives a first term at crank frequency and a small second term at <b>twice</b> the crank frequency:</p>
        ${T('x\\approx l-\\dfrac{r^2}{4l}+r\\cos\\theta+\\dfrac{r^2}{4l}\\cos2\\theta')}
        ${T('v\\approx-r\\omega\\left(\\sin\\theta+\\dfrac{r}{2l}\\sin2\\theta\\right)')}
        ${T('a\\approx-r\\omega^2\\left(\\cos\\theta+\\dfrac{r}{l}\\cos2\\theta\\right)')}
        <p>A long rod (large N) makes the slider move almost like a pure cosine (simple harmonic motion); a short rod adds a visible second harmonic, which is why the slider is faster on the outward half of the cycle. Peak slider speed is a little more than ${t('r\\omega')}; the mean speed is ${t('\\bar v=2\\cdot\\text{stroke}\\cdot n/60=4rn/60')}.</p></section>
      <section class="ms"><h4><b>E</b> Forces and what the guide has to carry</h4>
        ${T('F_{rod}=\\dfrac{F}{\\cos\\varphi},\\qquad F_{side}=F\\tan\\varphi,\\qquad T=F\\,\\dfrac{r\\sin(\\theta+\\varphi)}{\\cos\\varphi}')}
        <p>A force F pushing the slider is carried by the rod at angle φ. The rod force is a bit larger than F, and the sideways component ${t('F\\tan\\varphi')} is pressed into the guide (piston wall) and causes friction and wear. The torque on the crank is zero at both dead centres (θ + φ = 0° or 180°) and largest when the rod is roughly at right angles to the crank. A short rod (small N) means a larger φ, larger side thrust.</p></section>
      <section class="ms"><h4><b>F</b> Inertia and balancing</h4>
        ${T('F_{inertia}=m\\,a\\approx m\\,r\\omega^2\\left(\\cos\\theta+\\dfrac{\\cos2\\theta}{N}\\right)')}
        <p>The reciprocating mass m produces a shaking force that grows with the <b>square of the speed</b>. The first (crank-frequency) part can be cancelled by counterweights on the crank; the second (double-frequency) part cannot be cancelled by a simple counterweight and is why multi-cylinder engines are arranged in firing and balancing orders.</p></section>
      <section class="ms"><h4><b>G</b> Offset and quick return</h4>
        <p>Moving the guide off the crank axis by e makes the two strokes take different times:</p>
        ${T('Q=\\dfrac{180^\\circ+\\alpha}{180^\\circ-\\alpha},\\quad\\alpha=\\sin^{-1}\\dfrac{e}{l-r}-\\sin^{-1}\\dfrac{e}{l+r}')}
        <p>Used where the return stroke should be fast and the working stroke slow (shapers, slotting machines). An offset also reduces side thrust on the power stroke of an engine, at the cost of more on the return.</p></section>
      <section class="ms"><h4><b>H</b> The four inversions</h4>
        <table class="inv"><tr><th>Fixed link</th><th>Name</th><th>Examples</th></tr>
        <tr><td>1 · frame</td><td>slider-crank</td><td>IC engine, reciprocating compressor, steam engine, press</td></tr>
        <tr><td>2 · crank</td><td>Whitworth / rotary</td><td>Whitworth quick-return, Gnome rotary engine</td></tr>
        <tr><td>3 · connecting rod</td><td>slotted lever / oscillating</td><td>crank-and-slotted-lever quick return, oscillating-cylinder engine</td></tr>
        <tr><td>4 · slider</td><td>pendulum / Bull</td><td>hand pump, Bull engine</td></tr></table>
        <p>All four share the same relative motion; only the choice of fixed link, and therefore the useful output, changes.</p></section>
      <section class="ms"><h4><b>I</b> Design rules of thumb</h4>
        <ul><li>Engines use l/r ≈ 3.5–5: a compromise between height and side thrust.</li>
        <li>For a full turn of the crank the rod must satisfy ${t('l\\ge r+|e|')}; otherwise the linkage only rocks.</li>
        <li>Stroke = 2r with no offset; raise the stroke by lengthening the crank, not the rod.</li>
        <li>Use a flywheel (or several cylinders) to carry the crank through the dead centres where the torque is zero.</li></ul></section>`;
    $('prosBody').innerHTML = `
      <div class="pc">
        <section class="good"><h4>👍 Advantages</h4><ul>
          <li><b>Simple and cheap:</b> only four links; turning and sliding pairs are easy to manufacture.</li>
          <li><b>Handles heavy loads:</b> all joints are lower pairs (surface contact), giving low contact stress and good lubrication.</li>
          <li><b>Reversible:</b> works as an engine (linear → rotary) or as a pump/compressor (rotary → linear).</li>
          <li><b>Compact and robust</b> for the force it transmits; decades of proven design data.</li>
          <li><b>Easy to tune:</b> stroke = 2r; offset adds a quick-return ratio; rod ratio sets the side thrust.</li>
          <li><b>Closed-form kinematics:</b> position, velocity and acceleration are exact and cheap to compute.</li>
          <li><b>One input, one output:</b> a single degree of freedom makes control and timing straightforward.</li>
          <li><b>Four inversions</b> give a whole family of mechanisms from the same four links.</li></ul></section>
        <section class="bad"><h4>👎 Disadvantages</h4><ul>
          <li><b>Uneven motion:</b> slider speed and acceleration vary strongly (and contain a second harmonic).</li>
          <li><b>Inertia forces ∝ ω²:</b> shaking forces and vibration limit speed; they cannot be fully balanced by counterweights.</li>
          <li><b>Side thrust</b> on the guide or cylinder wall: friction, wear, and ovalising of cylinders (worse for a short rod).</li>
          <li><b>Dead centres:</b> zero torque at TDC/BDC, so it cannot start from there and needs a flywheel or multiple cylinders.</li>
          <li><b>Stroke is limited to 2r:</b> a long stroke needs a big crank and a bulky housing.</li>
          <li><b>Torque and mechanical advantage vary</b> through the revolution (pulsating torque).</li>
          <li><b>Clearance and backlash</b> in the pins cause noise and impact loads at reversal.</li>
          <li><b>No dwell:</b> the slider cannot rest at the end of its stroke without extra linkage or a cam.</li></ul></section>
      </div>
      <h4 class="pch">By inversion</h4>
      <table class="inv pcinv"><tr><th></th><th>Pros</th><th>Cons</th></tr>
        <tr><td><b>1st</b> slider-crank</td><td>Most efficient and well understood; ideal for engines, compressors and presses.</td><td>Side thrust; zero torque at dead centres; shaking forces.</td></tr>
        <tr><td><b>2nd</b> Whitworth / rotary</td><td>Large quick-return ratio in a compact space; rotary engines are air-cooled and smooth.</td><td>Rotating masses cause gyroscopic effects; lubrication and cooling are awkward; rare today.</td></tr>
        <tr><td><b>3rd</b> slotted lever / oscillating</td><td>Smooth quick return with adjustable stroke; oscillating-cylinder engines need no valve gear (the ports are in the pivot).</td><td>Sliding block in the slot wears; port leakage lowers efficiency; moderate loads only.</td></tr>
        <tr><td><b>4th</b> hand pump / Bull</td><td>Gives the operator mechanical advantage; very simple and reliable.</td><td>Low efficiency and not suited to high speed.</td></tr></table>`;
  }

  // ------------------------------------------------------------------ orchestration
  let lastSlow = 0, lastMath = 0;
  function render(full) {
    if (!built || root.hidden) return;
    const p = params();
    let sol = K.solve(p, drv(), st.th, omegaOf(), load());
    if (!sol) { st.th = 0; st.phase = 0; sol = K.solve(p, drv(), 0, omegaOf(), load()); }
    const m = K.metrics(p, drv());
    $('simSvg').innerHTML = mechSvg(sol);
    drawGraph(sol);                                     // every frame, but only the dot and cursor move
    const now = performance.now();
    if (full || !st.playing || now - lastSlow > 66) { // numeric readouts: ~15 fps while running
      lastSlow = now;
      $('readouts').innerHTML = readoutsHtml(sol, m);
      updateVals();
    }
    if (full || !st.playing || now - lastMath > 250) { // KaTeX panel: ~4 fps while running, instant when paused
      lastMath = now;
      renderMath(mathItems(sol, m));
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
    $('pillIn').textContent = `${inputText()} · ${pr ? pr.hint : INV_USE[st.inv]}`;
    $('pillRun').textContent = st.playing ? '▶ Running — click or Space to pause' : '❚❚ Paused — click or Space to run · ← → step';
    $('btnPlay').textContent = st.playing ? '❚❚ Pause' : '▶ Run';
    $('btnShow').textContent = st.showGraph ? '▾ Hide' : '▴ Show';
  }
  function syncAll() {
    $('segInv').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.inv === st.inv));
    $('segIn2').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.in2 === st.in2));
    $('segIn2').hidden = $('in2Lbl').hidden = st.inv !== 2;
    $('segGraph').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.g === st.graph));
    $('segUnits').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.u === st.units));
    $('presets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.p === st.preset));
    $('graphCard').hidden = !st.showGraph;
    gKey = '';
  }
  /** something other than the animation changed */
  function changed(refit, soft) {
    if (!soft) st.th = K.thetaFromPhase(params(), drv(), st.phase, st.th);
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
    st.th = K.thetaFromPhase(params(), drv(), st.phase, st.th);
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
