'use strict';
/* Builds the ANIMATED, interactive SVG export of the crank & slider simulator.
   Pure string building - no DOM - so it can be unit tested. The produced file is self-contained: the drawing, a few controls
   (play/pause, direction, speed, angle scrubber) and a small commented script that moves the parts.                          */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SimExport = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const W = 1000, H = 400, PANEL = 92; // drawing area and the control strip underneath it

  /* The script that lives inside the exported file. It is kept as ordinary, readable code (not minified) and is written for
     someone who wants to understand how the linkage is driven. __CONFIG__ is replaced by the numbers of the exported frame. */
  const SCRIPT = String.raw`
/* ============================================================================================================
   HOW THIS SCRIPT WORKS
   1. CONFIG holds the numbers of the mechanism (lengths in millimetres) and how millimetres map to screen pixels.
   2. kin(theta) solves the linkage: given the crank angle it returns the rod angle phi and the slider position x.
   3. render(theta) turns that into positions, applies the inversion (which link is held still) and moves every
      element of the drawing by changing its attributes (x1, y1, cx, transform ...).
   4. A requestAnimationFrame loop advances the input angle while "playing"; the controls change the same variables.
   ============================================================================================================ */
(function () {
  "use strict";

  var CFG = __CONFIG__;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ---- tiny DOM helpers -------------------------------------------------------------------------------- */
  function el(id) { return document.getElementById(id); }
  function attrs(id, a) { var e = el(id); for (var k in a) { e.setAttribute(k, a[k]); } }
  function line(id, p, q) { attrs(id, { x1: p.x.toFixed(1), y1: p.y.toFixed(1), x2: q.x.toFixed(1), y2: q.y.toFixed(1) }); }
  function at(id, p, extra) { el(id).setAttribute("transform", "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ")" + (extra || "")); }
  function fmt(v, d) { var s = v.toFixed(d); return s === "-0" || /^-0\.0*$/.test(s) ? s.slice(1) : s; }

  /* ---- 1. kinematics (frame 1: guide fixed, crank pivot O at the origin, y up, angles counter-clockwise) ---- */
  // sin(phi) = (r sin(theta) - e) / l      x = r cos(theta) + l cos(phi)
  function kin(th) {
    var s = (CFG.r * Math.sin(th) - CFG.e) / CFG.l;
    if (Math.abs(s) > 1) { return null; }                       // the rod cannot reach: not a valid pose
    var phi = Math.asin(s), cp = Math.cos(phi);
    var dphi = CFG.r * Math.cos(th) / (CFG.l * cp);              // d(phi)/d(theta)
    return {
      th: th, s: s, phi: phi,
      x: CFG.r * Math.cos(th) + CFG.l * cp,                      // slider position along the guide
      dx: -CFG.r * Math.sin(th) - CFG.l * s * dphi,              // dx/d(theta)  (so that v = dx/dt = dx * theta-dot)
      dphi: dphi
    };
  }

  /* For the 3rd inversion (rod fixed) the angle that turns uniformly is beta = theta + phi, so theta has to be found
     from beta by Newton's method.  For the other inversions theta itself turns uniformly. */
  function thetaFromPhase(phase, guess) {
    if (CFG.inv !== 3) { return phase; }
    var th = guess;
    th += Math.round((phase - th) / (2 * Math.PI)) * 2 * Math.PI;        // stay on the same revolution
    for (var i = 0; i < 40; i++) {
      var k = kin(th);
      if (!k) { return phase; }
      var f = th + k.phi - phase, fp = 1 + k.dphi;
      if (Math.abs(f) < 1e-12) { return th; }
      if (fp < 0.02) { return phase; }
      th -= Math.max(-0.5, Math.min(0.5, f / fp));
    }
    return th;
  }

  /* ---- 2. which link is held still? A rigid motion of the whole drawing does the inversion ---------------------- */
  function makeTransform(k) {
    var r = CFG.r, th = k.th;
    if (CFG.inv === 2) {                                    // crank fixed: rotate everything so the crank stays at 20 degrees
      var a = 20 * D2R - th, c = Math.cos(a), s = Math.sin(a);
      return { rot: a, f: function (q) { return { x: q.x * c - q.y * s, y: q.x * s + q.y * c }; } };
    }
    if (CFG.inv === 3) {                                    // rod fixed: rotate by phi about A, then put A at (-l/2, 0)
      var A = { x: r * Math.cos(th), y: r * Math.sin(th) }, c3 = Math.cos(k.phi), s3 = Math.sin(k.phi);
      return { rot: k.phi, f: function (q) {
        var dx = q.x - A.x, dy = q.y - A.y;
        return { x: -CFG.l / 2 + dx * c3 - dy * s3, y: dx * s3 + dy * c3 };
      } };
    }
    if (CFG.inv === 4) {                                    // slider fixed: translate so B stays at the origin
      return { rot: 0, f: function (q) { return { x: q.x - k.x, y: q.y - CFG.e }; } };
    }
    return { rot: 0, f: function (q) { return q; } };      // 1st inversion: nothing moves the frame
  }

  /* mm (y up)  ->  screen pixels (y down), using the scale chosen when the file was exported */
  function px(q) { return { x: CFG.ox + q.x * CFG.s, y: CFG.oy - q.y * CFG.s }; }

  /* ---- 3. draw one frame ------------------------------------------------------------------------------------ */
  var state = { phase: CFG.phase0, th: CFG.theta0, playing: true, dir: 1, rpm: CFG.rpm };

  function render(th) {
    var k = kin(th);
    if (!k) { return; }
    var T = makeTransform(k), X = T.f;
    var O  = px(X({ x: 0, y: 0 })),
        A  = px(X({ x: CFG.r * Math.cos(th), y: CFG.r * Math.sin(th) })),
        B  = px(X({ x: k.x, y: CFG.e })),
        Oe = px(X({ x: 0, y: CFG.e })),                    // point on the slider line above/below O (for the offset connector)
        G0 = px(X({ x: CFG.gl, y: CFG.e })), G1 = px(X({ x: CFG.gr, y: CFG.e })),   // ends of the slotted bar
        Tb = px(X({ x: CFG.xb, y: CFG.e })), Tt = px(X({ x: CFG.xt, y: CFG.e }));   // dead centres (BDC, TDC)

    /* link 1: slotted bar + optional offset connector + boss around O (outline pass, then fill pass, then groove) */
    var dxg = G1.x - G0.x, dyg = G1.y - G0.y, dl = Math.hypot(dxg, dyg) || 1, ux = dxg / dl, uy = dyg / dl;
    line("frame-bar-outline", G0, G1);  line("frame-bar-fill", G0, G1);
    line("frame-conn-outline", O, Oe);  line("frame-conn-fill", O, Oe);
    at("frame-boss-outline", O);        at("frame-boss-fill", O);
    line("frame-groove", { x: Tb.x - ux * 22, y: Tb.y - uy * 22 }, { x: Tt.x + ux * 22, y: Tt.y + uy * 22 });
    at("frame-label", { x: G1.x - ux * 2, y: G1.y + 4 });

    /* links 2 and 3 */
    line("crank-outline", O, A);  line("crank-fill", O, A);
    line("rod-outline", A, B);    line("rod-fill", A, B);

    /* slider block: rotate by the same angle the inversion rotated the guide by */
    at("slider", B, " rotate(" + (-T.rot * R2D).toFixed(2) + ")");

    /* pins */
    at("pin-O", O); at("pin-A", A); at("pin-B", B);

    /* labels along the bars (flip them when they would be upside down) */
    var ang = Math.atan2(B.y - A.y, B.x - A.x) * R2D, ca = Math.atan2(A.y - O.y, A.x - O.x) * R2D;
    el("rod-label").setAttribute("transform", "translate(" + ((A.x + B.x) / 2).toFixed(1) + " " + ((A.y + B.y) / 2 + 4).toFixed(1) + ") rotate(" + ((ang > 90 || ang < -90) ? ang + 180 : ang).toFixed(1) + ")");
    el("crank-label").setAttribute("transform", "translate(" + ((O.x + A.x) / 2).toFixed(1) + " " + ((O.y + A.y) / 2 + 4).toFixed(1) + ") rotate(" + ((ca > 90 || ca < -90) ? ca + 180 : ca).toFixed(1) + ")");
    at("tag-O", { x: O.x - 26, y: O.y + 24 });
    at("tag-A", CFG.inv === 3 ? { x: A.x + 6, y: A.y + 28 } : { x: A.x, y: A.y - 24 });
    at("tag-B", { x: B.x + 22, y: B.y + 30 });
    var xt = "x = " + fmt(k.x * CFG.k, 1) + " " + CFG.len;                // the x tag grows with its text
    el("xtag-text").textContent = xt;
    attrs("xtag-rect", { x: -(xt.length * 3.6 + 7), width: xt.length * 7.2 + 14 });
    at("xtag", { x: B.x + 52, y: B.y - 44 });

    /* dimension lines: extension lines at the dead centres + a dimension line between them (not for the 3rd inversion) */
    if (CFG.inv !== 3) {
      var nx = Tt.y - Tb.y, ny = -(Tt.x - Tb.x), nl = Math.hypot(nx, ny) || 1;
      var off = function (q, d) { return { x: q.x + nx / nl * d, y: q.y + ny / nl * d }; };
      line("ext-bdc", off(Tb, -26), off(Tb, -66));  line("ext-tdc", off(Tt, -26), off(Tt, -66));
      line("dim-stroke", off(Tb, -56), off(Tt, -56));
      at("lbl-bdc", off(Tb, -80));  at("lbl-tdc", off(Tt, -80));
      at("tag-stroke", off({ x: (Tb.x + Tt.x) / 2, y: (Tb.y + Tt.y) / 2 }, -56));
    }
    /* offset dimension e: between the axis through O and the slider line, on the side away from the slot */
    if (CFG.hasE) {
      var sx = px(X({ x: -1, y: 0 })), mx = sx.x - O.x, my = sx.y - O.y, ml = Math.hypot(mx, my) || 1, vx = mx / ml, vy = my / ml;
      var q = function (p, d) { return { x: p.x + vx * d, y: p.y + vy * d }; };
      line("ext-e0", q(O, 24), q(O, 60));  line("ext-e1", q(Oe, 24), q(Oe, 60));
      line("dim-e", q(O, 52), q(Oe, 52));
      at("tag-e", { x: (q(O, 52).x + q(Oe, 52).x) / 2 + vx * 44, y: (q(O, 52).y + q(Oe, 52).y) / 2 + vy * 4 });
    }

    /* input arrow: an arc centred exactly on the pivot the input turns about (A when the rod is fixed, else O) */
    var C = CFG.inv === 3 ? A : O, R = 30, ccw = CFG.inv !== 2;
    var a1 = CFG.inv === 3 ? 55 : -125, a2 = CFG.inv === 3 ? 125 : -55;
    var pa = function (d) { return { x: C.x + R * Math.cos(d * D2R), y: C.y - R * Math.sin(d * D2R) }; };
    var s0 = ccw ? pa(a1) : pa(a2), s1 = ccw ? pa(a2) : pa(a1);
    el("input-arrow").setAttribute("d", "M " + s0.x.toFixed(1) + " " + s0.y.toFixed(1) + " A " + R + " " + R + " 0 0 " + (ccw ? 0 : 1) + " " + s1.x.toFixed(1) + " " + s1.y.toFixed(1));

    /* readouts: v = dx/dt = (dx/d theta) * theta-dot;  theta-dot = omega, except for the 3rd inversion where it is omega / (1 + phi') */
    var omega = 2 * Math.PI * state.rpm / 60 * state.dir;
    var thd = CFG.inv === 3 ? omega / (1 + k.dphi) : omega;
    el("ro-theta").textContent = fmt(((th * R2D) % 360 + 360) % 360, 1) + "°";
    el("ro-phi").textContent = fmt(k.phi * R2D, 2) + "°";
    el("ro-x").textContent = fmt(k.x * CFG.k, 2) + " " + CFG.len;
    el("ro-v").textContent = fmt(k.dx * thd * CFG.k, 1) + " " + CFG.len + "/s";

    /* scrubber knob follows the angle */
    el("scrub-knob").setAttribute("cx", (CFG.sc.x + (((th * R2D) % 360 + 360) % 360) / 360 * CFG.sc.w).toFixed(1));
  }

  /* ---- 4. animation loop -------------------------------------------------------------------------------------- */
  var last = null;
  function step(ts) {
    if (last !== null && state.playing) {
      var dt = Math.min(0.1, (ts - last) / 1000);
      advance(2 * Math.PI * state.rpm / 60 * state.dir * dt);
    }
    last = ts;
    window.requestAnimationFrame(step);
  }
  function advance(dphase) {                       // move the uniformly turning input angle and re-solve theta
    state.phase += dphase;
    state.th = thetaFromPhase(state.phase, state.th);
    render(state.th);
  }
  function setPlaying(on) {
    state.playing = on;
    el("icon-play").setAttribute("display", on ? "none" : "inline");
    el("icon-pause").setAttribute("display", on ? "inline" : "none");
  }

  /* ---- 5. controls ---------------------------------------------------------------------------------------------- */
  /* Generic horizontal slider: pressing or dragging anywhere on its hit area calls onValue(fraction 0..1). */
  function makeSlider(hitId, x0, w, onValue) {
    var hit = el(hitId), dragging = false;
    function pick(ev) {
      var svg = el("root"), pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      var local = pt.matrixTransform(svg.getScreenCTM().inverse());          // browser pixels -> drawing coordinates
      onValue(Math.max(0, Math.min(1, (local.x - x0) / w)));
    }
    hit.addEventListener("pointerdown", function (ev) { dragging = true; hit.setPointerCapture(ev.pointerId); pick(ev); });
    hit.addEventListener("pointermove", function (ev) { if (dragging) { pick(ev); } });
    hit.addEventListener("pointerup",   function ()   { dragging = false; });
  }

  el("btn-play").addEventListener("click", function () { setPlaying(!state.playing); });
  el("btn-dir").addEventListener("click", function () {
    state.dir = -state.dir;
    el("dir-text").textContent = state.dir > 0 ? "forward" : "reverse";
  });
  makeSlider("speed-hit", CFG.sp.x, CFG.sp.w, function (f) {              // speed: 1 .. 120 rpm (log-ish feel)
    state.rpm = Math.round(1 + f * 119);
    el("speed-knob").setAttribute("cx", (CFG.sp.x + f * CFG.sp.w).toFixed(1));
    el("speed-text").textContent = state.rpm + " rpm";
  });
  makeSlider("scrub-hit", CFG.sc.x, CFG.sc.w, function (f) {              // scrubber: set the crank angle directly
    setPlaying(false);
    state.phase = f * 2 * Math.PI;
    state.th = thetaFromPhase(state.phase, state.th);
    render(state.th);
  });
  document.addEventListener("keydown", function (ev) {                    // Space = play/pause, arrows = step 1 degree
    if (ev.key === " ") { setPlaying(!state.playing); ev.preventDefault(); }
    else if (ev.key === "ArrowRight") { setPlaying(false); advance(D2R); }
    else if (ev.key === "ArrowLeft")  { setPlaying(false); advance(-D2R); }
  });

  /* start: show the exported frame, set the controls to the exported speed, and begin playing */
  var f0 = (state.rpm - 1) / 119;
  el("speed-knob").setAttribute("cx", (CFG.sp.x + f0 * CFG.sp.w).toFixed(1));
  el("speed-text").textContent = state.rpm + " rpm";
  setPlaying(true);
  render(state.th);
  window.requestAnimationFrame(step);
}());
`;

  /**
   * @param c configuration of the exported frame:
   *   r,l,e (mm), inv (1-4), rpm, theta (rad), phase (rad), view {s,ox,oy}, gl, gr, xb, xt (mm), hasE,
   *   units {len, k} (k = display units per mm), texts {...}, metrics {...}
   */
  function animatedSvg(c) {
    const num = (v, d = 2) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
    const len = c.units.len, k = c.units.k;
    // control strip geometry (pixels)
    const sp = { x: 625, w: 140 }, sc = { x: 820, w: 140 };
    const cfg = {
      r: c.r, l: c.l, e: c.e, inv: c.inv, rpm: c.rpm, theta0: c.theta, phase0: c.phase,
      s: c.view.s, ox: c.view.ox, oy: c.view.oy, gl: c.gl, gr: c.gr, xb: c.xb, xt: c.xt, hasE: !!c.hasE,
      len, k, sp, sc,
    };
    const cfgText = JSON.stringify(cfg, null, 2).replace(/\n/g, '\n  ');
    const script = SCRIPT.replace('__CONFIG__', cfgText);
    if (script.includes(']]>')) throw new Error('script contains a CDATA terminator');
    const t = c.texts;
    const link = (id, w, col, dark) => `
    <line id="${id}-outline" stroke="${dark}" stroke-width="${w + 4}" stroke-linecap="round"/>
    <line id="${id}-fill" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
    const tag = (id, text, cls = '') => `<g id="${id}" class="tag ${cls}"><rect x="${-(text.length * 3.6 + 7)}" y="-10" width="${text.length * 7.2 + 14}" height="20" rx="5"/><text text-anchor="middle" y="4.5">${text}</text></g>`;
    const pin = (id, r) => `<g id="${id}"><circle r="${r}" fill="#e9edf4" stroke="#3b4252" stroke-width="2"/><circle r="${r - 4}" fill="#566073"/></g>`;
    const bossR = (w) => w / 2 + 2;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  ===========================================================================================
  CRANK & SLIDER MECHANISM  -  ANIMATED + INTERACTIVE  -  exported from ShareV on ${t.date}
  ===========================================================================================

  OPEN THIS FILE DIRECTLY IN A BROWSER (Chrome, Edge, Firefox, Safari).  It animates itself and has controls.
  Viewers that do not run SVG scripts (an <img> tag, Inkscape, most editors, e-mail previews) show the still
  picture of the exported frame instead - use ShareV's plain "Export SVG" if you need a static drawing.

  CONTROLS (bottom strip)
    play / pause button   start or stop the motion            (keyboard: Space)
    direction button      forward / reverse
    speed slider          1 - 120 rpm of the input
    angle slider          drag to set the crank angle by hand (pauses the animation)   (keyboard: Left / Right = 1 degree)

  WHAT YOU ARE LOOKING AT
    A slider-crank chain: link 1 frame/guide (grey), link 2 crank (teal), link 3 connecting rod (purple),
    link 4 slider block (gold).  This is the ${t.invName} inversion: ${t.invText}.  (${t.invUse})
    r = ${num(c.r * k, 3)} ${len}   l = ${num(c.l * k, 3)} ${len}   e = ${num(c.e * k, 3)} ${len}   start speed ${c.rpm} rpm
    stroke = ${num(c.metrics.stroke * k, 3)} ${len}    N = l/r = ${num(c.metrics.N, 3)}    time ratio = ${num(c.metrics.ratio, 4)}

  THE EQUATIONS THE SCRIPT SOLVES (frame 1, angles counter-clockwise)
    sin(phi) = (r sin(theta) - e) / l        x = r cos(theta) + l cos(phi)
    v = dx/dt = -r omega sin(theta + phi) / cos(phi)
    3rd inversion: beta = theta + phi turns uniformly, so theta is found from beta by Newton iteration.

  HOW THE FILE IS ORGANISED (top to bottom)
    <style>     colours and text styles for the labels
    <defs>      arrow heads and the grid pattern
    static art  background, protractor (1st inversion only)
    moving art  every moving part has an id (frame-*, crank-*, rod-*, slider, pin-*, tag-*, dim-* ...);
                it is drawn once here WITHOUT coordinates and the script fills the coordinates in every frame
    controls    the strip under the drawing (buttons and sliders)
    <script>    kinematics -> inversion transform -> move the elements -> animation loop -> control handlers
  ===========================================================================================
-->
<svg id="root" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + PANEL}" viewBox="0 0 ${W} ${H + PANEL}">
  <title>Crank and slider mechanism - ${t.invName} inversion (animated)</title>
  <desc>Interactive slider-crank simulation: play/pause, direction, speed and crank-angle controls.</desc>

  <style>
    text        { font-family: "Segoe UI", Arial, sans-serif; }
    .deg        { fill: #8e9bb3; font-size: 11px; }
    .dc line    { stroke: #c2551c; stroke-width: 1.5; }
    .dc text    { fill: #e26b2a; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
    .dc.e line  { stroke: #2ea898; }
    .tag rect   { fill: #1d2538; stroke: #36456a; }
    .tag text   { fill: #e8eefb; font-size: 12px; font-weight: 700; }
    .tag.dim rect  { fill: #2a1d18; stroke: #7a3a1c; }  .tag.dim text  { fill: #ffb98a; }
    .tag.edim rect { fill: #14302c; stroke: #2ea898; }  .tag.edim text { fill: #8fe3d4; }
    .tag.xtag rect { fill: #2a2e3c; stroke: #566080; }
    .linklbl    { fill: #fff; font-size: 13px; font-weight: 700; paint-order: stroke; stroke: rgba(0,0,0,.35); stroke-width: 2px; }
    .linklbl.small { font-size: 11px; }
    .ctl        { cursor: pointer; }                       /* the clickable parts of the control strip */
    .ctl-text   { fill: #cfd8ea; font-size: 12px; }
    .ctl-val    { fill: #ffcf8a; font-size: 12px; font-weight: 700; }
    .ro-label   { fill: #7f8db0; font-size: 10px; letter-spacing: .08em; }
    .ro-value   { fill: #ffffff; font-size: 14px; font-weight: 700; font-family: Consolas, monospace; }
  </style>

  <defs>
    <!-- arrow heads: the reference point (refX) is the TIP, so the tip lands exactly on the end of the line -->
    <marker id="arr" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#c2551c"/></marker>
    <marker id="arrE" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#2ea898"/></marker>
    <marker id="arrT" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L8 4L0 8z" fill="#2ea898"/></marker>
    <!-- background grid: 20 px minor squares, 100 px major squares -->
    <pattern id="gridS" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3a4558" stroke-width=".6"/></pattern>
    <pattern id="gridL" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#gridS)"/><path d="M100 0H0V100" fill="none" stroke="#4a5870" stroke-width="1"/></pattern>
  </defs>

  <!-- ======================= STATIC ART ======================= -->
  <rect width="${W}" height="${H + PANEL}" rx="14" fill="#1b2231"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#gridL)"/>
${c.protractor ? `
  <!-- PROTRACTOR (1st inversion): the angle scale belongs to the guide, so it never moves. Ticks every 5 degrees. -->
  <g id="protractor">
    ${c.protractor}
  </g>
` : ''}
  <!-- ======================= MOVING ART =======================
       Everything below is only a TEMPLATE: the numbers (x1, y1, transform ...) are written by the script each frame. -->

  <!-- LINK 1 - FRAME / GUIDE: one rigid grey body. Each piece is drawn twice, first a wider dark stroke (the outline),
       then a narrower light stroke on top, so the pieces merge into a single casting. -->
  <g id="frame">
    <line id="frame-bar-outline" stroke="#454c5b" stroke-width="38" stroke-linecap="round"/>      <!-- slotted bar -->
    <line id="frame-conn-outline" stroke="#454c5b" stroke-width="38" stroke-linecap="round"/>     <!-- connector to the offset line (zero length when e = 0) -->
    <circle id="frame-boss-outline" r="${bossR(38)}" fill="#454c5b"/>                              <!-- boss around the crank pivot -->
    <line id="frame-bar-fill" stroke="#b8bdc8" stroke-width="34" stroke-linecap="round"/>
    <line id="frame-conn-fill" stroke="#b8bdc8" stroke-width="34" stroke-linecap="round"/>
    <circle id="frame-boss-fill" r="${bossR(34)}" fill="#b8bdc8"/>
    <line id="frame-groove" stroke="#2f3541" stroke-width="10" stroke-linecap="round"/>            <!-- the groove the slider runs in -->
    <text id="frame-label" class="linklbl small" text-anchor="middle">1</text>
  </g>

  <!-- DIMENSIONS: extension lines + dimension line for the stroke, and for the offset e when there is one -->
${c.inv !== 3 ? `  <g class="dc">
    <line id="ext-bdc"/><line id="ext-tdc"/>
    <line id="dim-stroke" marker-start="url(#arr)" marker-end="url(#arr)"/>
    <text id="lbl-bdc" text-anchor="middle">BDC</text><text id="lbl-tdc" text-anchor="middle">TDC</text>
  </g>
  ${tag('tag-stroke', `stroke = ${num(c.metrics.stroke * k, 1)} ${len}`, 'dim')}` : '  <!-- (no stroke dimension in the 3rd inversion: the rod is the fixed link and the slider has no dead centres to dimension) -->'}
${c.hasE ? `  <g class="dc e"><line id="ext-e0"/><line id="ext-e1"/><line id="dim-e" marker-start="url(#arrE)" marker-end="url(#arrE)"/></g>
  ${tag('tag-e', `e ${num(c.e * k, 2)} ${len}`, 'edim')}` : ''}

  <!-- LINK 2 - CRANK (teal) and LINK 3 - CONNECTING ROD (purple) -->
${link('crank', 18, '#2ea898', '#17594f')}
${link('rod', 16, '#8f64d8', '#47306f')}

  <!-- LINK 4 - SLIDER BLOCK (gold), drawn around its own origin; the script moves and rotates it onto B -->
  <g id="slider"><rect x="-22" y="-15" width="44" height="30" rx="5" fill="#d3a92f" stroke="#6b5412" stroke-width="2.5"/><rect x="-16" y="-9" width="32" height="18" rx="3" fill="#e8c65a" opacity=".55"/></g>

  <!-- PIN JOINTS, drawn last so they sit on top of the links -->
  ${pin('pin-O', 9)}
  ${pin('pin-A', 7)}
  ${pin('pin-B', 7)}

  <!-- LABELS: lengths along the bars, tags on the pivots, and the live x tag -->
  <text id="rod-label" class="linklbl" text-anchor="middle">3 · l ${num(c.l * k, 1)} ${len}</text>
  <text id="crank-label" class="linklbl small" text-anchor="middle">2 · r ${num(c.r * k, 1)}</text>
  ${tag('tag-O', 'O₂')}
  ${tag('tag-A', 'A')}
  ${tag('tag-B', 'B')}
  <g id="xtag" class="tag xtag"><rect id="xtag-rect" y="-10" height="20" rx="5"/><text id="xtag-text" text-anchor="middle" y="4.5"></text></g>

  <!-- INPUT ARROW: an arc centred exactly on the pivot the input turns about -->
  <path id="input-arrow" fill="none" stroke="#2ea898" stroke-width="2.6" marker-end="url(#arrT)"/>

  <!-- ======================= CONTROL STRIP ======================= -->
  <g id="controls" transform="translate(0 ${H})">
    <rect x="12" y="6" width="${W - 24}" height="${PANEL - 14}" rx="10" fill="#111a2e" stroke="#243455"/>

    <!-- play / pause: two icons on top of each other, the script shows the right one -->
    <g id="btn-play" class="ctl" transform="translate(52 ${48})">
      <circle r="22" fill="#1f6f3d"/>
      <path id="icon-play" d="M-7 -11 L12 0 L-7 11 Z" fill="#fff" display="none"/>
      <g id="icon-pause" fill="#fff"><rect x="-9" y="-10" width="6" height="20" rx="1.5"/><rect x="3" y="-10" width="6" height="20" rx="1.5"/></g>
    </g>

    <!-- direction toggle -->
    <g id="btn-dir" class="ctl" transform="translate(122 48)">
      <rect x="-36" y="-18" width="72" height="36" rx="8" fill="#172139" stroke="#243455"/>
      <text id="dir-text" class="ctl-text" text-anchor="middle" y="4.5">forward</text>
    </g>

    <!-- live readouts -->
    <g transform="translate(176 0)">
      <text class="ro-label" x="0" y="34">ANGLE θ₂</text><text id="ro-theta" class="ro-value" x="0" y="54"></text>
      <text class="ro-label" x="82" y="34">ROD φ</text><text id="ro-phi" class="ro-value" x="82" y="54"></text>
      <text class="ro-label" x="168" y="34">SLIDER x</text><text id="ro-x" class="ro-value" x="168" y="54"></text>
      <text class="ro-label" x="282" y="34">SLIDER v</text><text id="ro-v" class="ro-value" x="282" y="54"></text>
    </g>

    <!-- speed slider: track, knob, and a transparent hit area that receives the mouse -->
    <text class="ctl-text" x="${sp.x}" y="28">input speed</text><text id="speed-text" class="ctl-val" x="${sp.x + sp.w}" y="28" text-anchor="end"></text>
    <rect x="${sp.x}" y="44" width="${sp.w}" height="6" rx="3" fill="#2c3850"/>
    <circle id="speed-knob" cx="${sp.x}" cy="47" r="9" fill="#ffb347" stroke="#fff" stroke-width="2"/>
    <rect id="speed-hit" class="ctl" x="${sp.x - 10}" y="34" width="${sp.w + 20}" height="26" fill="transparent"/>

    <!-- crank-angle slider -->
    <text class="ctl-text" x="${sc.x}" y="28">crank angle  0° – 360°</text>
    <rect x="${sc.x}" y="44" width="${sc.w}" height="6" rx="3" fill="#2c3850"/>
    <circle id="scrub-knob" cx="${sc.x}" cy="47" r="9" fill="#35d0b8" stroke="#fff" stroke-width="2"/>
    <rect id="scrub-hit" class="ctl" x="${sc.x - 10}" y="34" width="${sc.w + 20}" height="26" fill="transparent"/>
  </g>

  <!-- ======================= THE SCRIPT ======================= -->
  <script type="application/ecmascript"><![CDATA[
${script.replace(/^\n/, '')}
  ]]></script>
</svg>
`;
  }


  // ================================================================================================================
  // NO-SCRIPT VERSION: a looping SMIL animation (no JavaScript, so it also plays inside <img>, in many viewers and in e-mail).
  // The motion is sampled at FRAMES crank positions; every moving attribute gets an <animate> with that list of values.
  // ================================================================================================================
  const FRAMES = 120;                                     // keyframes per revolution (3 degrees apart)

  /** Positions of every part (screen pixels) at crank angle th - the same geometry the interactive script computes. */
  function geometry(c, K, th) {
    const p = { r: c.r, l: c.l, e: c.e };
    const k = K.kin(p, th);
    if (!k) return null;
    const D2R = Math.PI / 180;
    let f = (q) => q, rot = 0;
    if (c.inv === 2) { const a = 20 * D2R - th, cs = Math.cos(a), sn = Math.sin(a); rot = a; f = (q) => ({ x: q.x * cs - q.y * sn, y: q.x * sn + q.y * cs }); }
    else if (c.inv === 3) {
      const A0 = { x: c.r * Math.cos(th), y: c.r * Math.sin(th) }, cs = Math.cos(k.phi), sn = Math.sin(k.phi); rot = k.phi;
      f = (q) => { const dx = q.x - A0.x, dy = q.y - A0.y; return { x: -c.l / 2 + dx * cs - dy * sn, y: dx * sn + dy * cs }; };
    } else if (c.inv === 4) f = (q) => ({ x: q.x - k.x, y: q.y - c.e });
    const px = (q) => ({ x: c.view.ox + q.x * c.view.s, y: c.view.oy - q.y * c.view.s });
    const O = px(f({ x: 0, y: 0 })), A = px(f({ x: c.r * Math.cos(th), y: c.r * Math.sin(th) })), B = px(f({ x: k.x, y: c.e })), Oe = px(f({ x: 0, y: c.e }));
    const G0 = px(f({ x: c.gl, y: c.e })), G1 = px(f({ x: c.gr, y: c.e })), Tb = px(f({ x: c.xb, y: c.e })), Tt = px(f({ x: c.xt, y: c.e }));
    const dl = Math.hypot(G1.x - G0.x, G1.y - G0.y) || 1, ux = (G1.x - G0.x) / dl, uy = (G1.y - G0.y) / dl;
    const R2D = 180 / Math.PI;
    const ang = Math.atan2(B.y - A.y, B.x - A.x) * R2D, ca = Math.atan2(A.y - O.y, A.x - O.x) * R2D;
    const g = {
      th, k, O, A, B, Oe, G0, G1, Tb, Tt, rotDeg: -rot * R2D,
      grooveA: { x: Tb.x - ux * 22, y: Tb.y - uy * 22 }, grooveB: { x: Tt.x + ux * 22, y: Tt.y + uy * 22 },
      frameLbl: { x: G1.x - ux * 2, y: G1.y + 4 },
      rodLbl: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 + 4, a: ang > 90 || ang < -90 ? ang + 180 : ang },
      crankLbl: { x: (O.x + A.x) / 2, y: (O.y + A.y) / 2 + 4, a: ca > 90 || ca < -90 ? ca + 180 : ca },
      tagO: { x: O.x - 26, y: O.y + 24 }, tagA: c.inv === 3 ? { x: A.x + 6, y: A.y + 28 } : { x: A.x, y: A.y - 24 }, tagB: { x: B.x + 22, y: B.y + 30 },
    };
    if (c.inv !== 3) {
      const nx = Tt.y - Tb.y, ny = -(Tt.x - Tb.x), nl = Math.hypot(nx, ny) || 1;
      const off = (q, d) => ({ x: q.x + nx / nl * d, y: q.y + ny / nl * d });
      Object.assign(g, { extB: [off(Tb, -26), off(Tb, -66)], extT: [off(Tt, -26), off(Tt, -66)], dimS: [off(Tb, -56), off(Tt, -56)],
        lblB: off(Tb, -80), lblT: off(Tt, -80), tagS: off({ x: (Tb.x + Tt.x) / 2, y: (Tb.y + Tt.y) / 2 }, -56) });
    }
    if (c.hasE) {
      const sx = px(f({ x: -1, y: 0 })), mx = sx.x - O.x, my = sx.y - O.y, ml = Math.hypot(mx, my) || 1, vx = mx / ml, vy = my / ml;
      const q = (p0, d) => ({ x: p0.x + vx * d, y: p0.y + vy * d });
      Object.assign(g, { e0: [q(O, 24), q(O, 60)], e1: [q(Oe, 24), q(Oe, 60)], dimE: [q(O, 52), q(Oe, 52)],
        tagE: { x: (q(O, 52).x + q(Oe, 52).x) / 2 + vx * 44, y: (q(O, 52).y + q(Oe, 52).y) / 2 + vy * 4 } });
    }
    const C = c.inv === 3 ? A : O, R = 30, ccw = c.inv !== 2, a1 = c.inv === 3 ? 55 : -125, a2 = c.inv === 3 ? 125 : -55;
    const pa = (d) => ({ x: C.x + R * Math.cos(d * D2R), y: C.y - R * Math.sin(d * D2R) });
    const s0 = ccw ? pa(a1) : pa(a2), s1 = ccw ? pa(a2) : pa(a1);
    g.arrow = `M ${s0.x.toFixed(1)} ${s0.y.toFixed(1)} A ${R} ${R} 0 0 ${ccw ? 0 : 1} ${s1.x.toFixed(1)} ${s1.y.toFixed(1)}`;
    return g;
  }

  /** @param c  same configuration as animatedSvg plus K (the SimCore solver) */
  function smilSvg(c, K) {
    const n1 = (v) => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1);
    const num = (v, d = 2) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
    const len = c.units.len, k = c.units.k, t = c.texts;
    const dur = Math.max(2, Math.min(12, 60 / c.rpm));                // seconds per revolution (clamped to something watchable)
    const D = `${dur}s`;

    // sample one revolution of the uniformly turning input angle (beta for the 3rd inversion, theta otherwise)
    const frames = [];
    let th = c.theta;
    for (let i = 0; i <= FRAMES; i++) {
      const phase = (i / FRAMES) * 2 * Math.PI;
      th = K.thetaFromPhase({ r: c.r, l: c.l, e: c.e }, c.inv, phase, i === 0 ? phase : th);
      const g = geometry(c, K, th);
      frames.push(g || frames[frames.length - 1]);
    }

    /* ---- tiny builders: a value that never changes is written as a plain attribute, otherwise as <animate> ---- */
    const same = (vals) => vals.every((v) => v === vals[0]);
    const anim = (name, vals, extra = '') => `<animate attributeName="${name}" values="${vals.join(';')}" dur="${D}" repeatCount="indefinite"${extra}/>`;
    /** <line> whose two end points come from pick(g) = [p, q] */
    const lineEl = (id, style, pick) => {
      const pts = frames.map(pick);
      const names = [['x1', (a) => n1(a[0].x)], ['y1', (a) => n1(a[0].y)], ['x2', (a) => n1(a[1].x)], ['y2', (a) => n1(a[1].y)]];
      let at = '', kids = '';
      for (const [nm, fn] of names) { const v = pts.map(fn); if (same(v)) at += ` ${nm}="${v[0]}"`; else kids += `\n      ${anim(nm, v)}`; }
      return kids ? `<line id="${id}"${at} ${style}>${kids}\n    </line>` : `<line id="${id}"${at} ${style}/>`;
    };
    /** <g> positioned with translate(pick(g)), optional rotation list rot(g) (degrees) for labels / the slider block */
    const moveEl = (id, cls, inner, pick, rot, rotDiscrete) => {
      const pts = frames.map(pick), first = pts[0];
      const rots = rot ? frames.map(rot) : null;
      const posSame = same(pts.map((p) => `${n1(p.x)} ${n1(p.y)}`)), rotSame = !rots || same(rots.map((a) => a.toFixed(1)));
      let tr = '', kids = '';
      if (posSame && rotSame) tr = ` transform="translate(${n1(first.x)} ${n1(first.y)})${rots ? ` rotate(${rots[0].toFixed(1)})` : ''}"`;
      else {
        if (!posSame) kids += `\n      <animateTransform attributeName="transform" type="translate" values="${pts.map((p) => `${n1(p.x)} ${n1(p.y)}`).join(';')}" dur="${D}" repeatCount="indefinite"/>`;
        else tr = ` transform="translate(${n1(first.x)} ${n1(first.y)})"`;
        if (rots && !rotSame) kids += `\n      <animateTransform attributeName="transform" type="rotate" values="${rots.map((a) => a.toFixed(1)).join(';')}" additive="sum" dur="${D}" repeatCount="indefinite"${rotDiscrete ? ' calcMode="discrete"' : ''}/>`;
        else if (rots) tr = tr.replace(')"', `) rotate(${rots[0].toFixed(1)})"`);
      }
      if (rots && rotSame && !posSame && Math.abs(rots[0]) > 0.05) inner = `<g transform="rotate(${rots[0].toFixed(1)})">${inner}</g>`; // constant rotation, moving position
      return `<g id="${id}"${cls ? ` class="${cls}"` : ''}${tr}>${kids}\n      ${inner}\n    </g>`;
    };
    const textMove = (id, cls, text, pick, rot) => {
      const e = moveEl(id, '', `<text class="${cls}" text-anchor="middle">${text}</text>`, pick, rot, true);
      return e;
    };
    const tag = (id, text, cls, pick) => moveEl(id, `tag ${cls}`, `<rect x="${-(text.length * 3.6 + 7)}" y="-10" width="${text.length * 7.2 + 14}" height="20" rx="5"/><text text-anchor="middle" y="4.5">${text}</text>`, pick);
    const pin = (id, r, pick) => moveEl(id, '', `<circle r="${r}" fill="#e9edf4" stroke="#3b4252" stroke-width="2"/><circle r="${r - 4}" fill="#566073"/>`, pick);
    const bar = (id, w, col, dark, pick) => `${lineEl(id + '-outline', `stroke="${dark}" stroke-width="${w + 4}" stroke-linecap="round"`, pick)}\n    ${lineEl(id + '-fill', `stroke="${col}" stroke-width="${w}" stroke-linecap="round"`, pick)}`;
    const pathEl = (id, style, get) => { const v = frames.map(get); return same(v) ? `<path id="${id}" d="${v[0]}" ${style}/>` : `<path id="${id}" d="${v[0]}" ${style}>\n      ${anim('d', v)}\n    </path>`; };

    const hasStroke = c.inv !== 3;
    const frameBlock = `
  <!-- LINK 1 - FRAME / GUIDE: one rigid grey body (a dark outline stroke under a light fill stroke, so the pieces merge). -->
  <g id="frame">
    ${lineEl('frame-bar-outline', 'stroke="#454c5b" stroke-width="38" stroke-linecap="round"', (g) => [g.G0, g.G1])}
    ${lineEl('frame-conn-outline', 'stroke="#454c5b" stroke-width="38" stroke-linecap="round"', (g) => [g.O, g.Oe])}
    ${moveEl('frame-boss-outline', '', `<circle r="21" fill="#454c5b"/>`, (g) => g.O)}
    ${lineEl('frame-bar-fill', 'stroke="#b8bdc8" stroke-width="34" stroke-linecap="round"', (g) => [g.G0, g.G1])}
    ${lineEl('frame-conn-fill', 'stroke="#b8bdc8" stroke-width="34" stroke-linecap="round"', (g) => [g.O, g.Oe])}
    ${moveEl('frame-boss-fill', '', `<circle r="19" fill="#b8bdc8"/>`, (g) => g.O)}
    ${lineEl('frame-groove', 'stroke="#2f3541" stroke-width="10" stroke-linecap="round"', (g) => [g.grooveA, g.grooveB])}
    ${textMove('frame-label', 'linklbl small', '1', (g) => g.frameLbl)}
  </g>`;
    const dims = hasStroke ? `
  <!-- STROKE DIMENSION: extension lines at the dead centres and a dimension line between them. -->
  <g class="dc">
    ${lineEl('ext-bdc', '', (g) => g.extB)}
    ${lineEl('ext-tdc', '', (g) => g.extT)}
    ${lineEl('dim-stroke', 'marker-start="url(#arr)" marker-end="url(#arr)"', (g) => g.dimS)}
    ${moveEl('lbl-bdc', '', '<text text-anchor="middle">BDC</text>', (g) => g.lblB)}
    ${moveEl('lbl-tdc', '', '<text text-anchor="middle">TDC</text>', (g) => g.lblT)}
  </g>
  ${tag('tag-stroke', `stroke = ${num(c.metrics.stroke * k, 1)} ${len}`, 'dim', (g) => g.tagS)}` : '\n  <!-- (no stroke dimension in the 3rd inversion) -->';
    const dimE = c.hasE ? `
  <!-- OFFSET DIMENSION e -->
  <g class="dc e">
    ${lineEl('ext-e0', '', (g) => g.e0)}
    ${lineEl('ext-e1', '', (g) => g.e1)}
    ${lineEl('dim-e', 'marker-start="url(#arrE)" marker-end="url(#arrE)"', (g) => g.dimE)}
  </g>
  ${tag('tag-e', `e ${num(c.e * k, 2)} ${len}`, 'edim', (g) => g.tagE)}` : '';

    // progress marker along the bottom: shows where in the revolution the crank is
    const pb = { x: 60, w: 220, y: H - 26 };
    const progress = `
  <!-- PROGRESS: the dot travels along this track once per revolution of the input -->
  <text class="ctl-text" x="${pb.x}" y="${pb.y - 12}">crank angle</text>
  <rect x="${pb.x}" y="${pb.y - 3}" width="${pb.w}" height="6" rx="3" fill="#2c3850"/>
  ${[0, 90, 180, 270, 360].map((d) => `<text class="deg" x="${pb.x + d / 360 * pb.w}" y="${pb.y + 18}" text-anchor="middle">${d}°</text>`).join('')}
  <circle cx="${pb.x}" cy="${pb.y}" r="8" fill="#35d0b8" stroke="#fff" stroke-width="2">
    <animate attributeName="cx" values="${pb.x};${pb.x + pb.w}" dur="${D}" repeatCount="indefinite"/>
  </circle>`;

    const sliderBlock = moveEl('slider', '', `<rect x="-22" y="-15" width="44" height="30" rx="5" fill="#d3a92f" stroke="#6b5412" stroke-width="2.5"/><rect x="-16" y="-9" width="32" height="18" rx="3" fill="#e8c65a" opacity=".55"/>`, (g) => g.B, (g) => g.rotDeg, false);

    return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  ===========================================================================================
  CRANK & SLIDER MECHANISM  -  LOOPING ANIMATION, NO SCRIPT  -  exported from ShareV on ${t.date}
  ===========================================================================================

  This file contains NO JavaScript.  The motion is a SMIL animation, so it also plays when the file is used as an
  <img>, as a CSS background, in many viewers and in e-mail.  It cannot have buttons or sliders: for those use ShareV's
  "Animated SVG" export (which needs a browser that runs SVG scripts).

  HOW THE ANIMATION WORKS
    The linkage was solved once per ${360 / FRAMES} degrees of crank rotation (${FRAMES} positions + the first one again to close the loop).
    Every part that moves has an <animate> (or <animateTransform>) with the list of its ${FRAMES + 1} values, played over
    ONE revolution and repeated forever; the browser blends smoothly between the values.
    A value that never changes (for example the whole frame in the 1st inversion) is written as an ordinary attribute.
      - one revolution takes   dur="${D}"   (the input speed in ShareV was ${c.rpm} rpm, limited to 2 - 12 s so it is watchable)
        TO CHANGE THE SPEED: search for  dur="${D}"  and replace every occurrence with another time.
      - the rotation of the text labels uses calcMode="discrete" so they never spin through 180 degrees when they flip.

  WHAT YOU ARE LOOKING AT
    A slider-crank chain: link 1 frame/guide (grey), link 2 crank (teal), link 3 connecting rod (purple), link 4 slider (gold).
    This is the ${t.invName} inversion: ${t.invText}.  (${t.invUse})
    r = ${num(c.r * k, 3)} ${len}   l = ${num(c.l * k, 3)} ${len}   e = ${num(c.e * k, 3)} ${len}
    stroke = ${num(c.metrics.stroke * k, 3)} ${len}    N = l/r = ${num(c.metrics.N, 3)}    time ratio = ${num(c.metrics.ratio, 4)}

  THE EQUATIONS BEHIND THE KEYFRAMES (frame 1, angles counter-clockwise)
    sin(phi) = (r sin(theta) - e) / l        x = r cos(theta) + l cos(phi)
    3rd inversion: the angle that turns uniformly is beta = theta + phi, so theta is found from beta by Newton iteration.

  HOW THE FILE IS ORGANISED
    <style>, <defs>   colours, arrow heads, grid pattern
    background        panel and grid
    moving parts      frame (link 1), dimensions, crank, rod, slider, pins, labels, input arrow - each with its animations
    progress          a dot that runs along a track once per revolution
  ===========================================================================================
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <title>Crank and slider mechanism - ${t.invName} inversion (looping animation, no script)</title>
  <desc>Slider-crank chain animated with SMIL, no scripting. r = ${num(c.r * k, 2)} ${len}, l = ${num(c.l * k, 2)} ${len}, e = ${num(c.e * k, 2)} ${len}.</desc>

  <style>
    text        { font-family: "Segoe UI", Arial, sans-serif; }
    .deg        { fill: #8e9bb3; font-size: 11px; }
    .dc line    { stroke: #c2551c; stroke-width: 1.5; }
    .dc text    { fill: #e26b2a; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
    .dc.e line  { stroke: #2ea898; }
    .tag rect   { fill: #1d2538; stroke: #36456a; }
    .tag text   { fill: #e8eefb; font-size: 12px; font-weight: 700; }
    .tag.dim rect  { fill: #2a1d18; stroke: #7a3a1c; }  .tag.dim text  { fill: #ffb98a; }
    .tag.edim rect { fill: #14302c; stroke: #2ea898; }  .tag.edim text { fill: #8fe3d4; }
    .linklbl    { fill: #fff; font-size: 13px; font-weight: 700; paint-order: stroke; stroke: rgba(0,0,0,.35); stroke-width: 2px; }
    .linklbl.small { font-size: 11px; }
    .ctl-text   { fill: #cfd8ea; font-size: 12px; }
  </style>

  <defs>
    <!-- arrow heads: refX is the TIP so the tip lands exactly on the end of the line -->
    <marker id="arr" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#c2551c"/></marker>
    <marker id="arrE" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#2ea898"/></marker>
    <marker id="arrT" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L8 4L0 8z" fill="#2ea898"/></marker>
    <pattern id="gridS" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#3a4558" stroke-width=".6"/></pattern>
    <pattern id="gridL" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#gridS)"/><path d="M100 0H0V100" fill="none" stroke="#4a5870" stroke-width="1"/></pattern>
  </defs>

  <!-- BACKGROUND -->
  <rect width="${W}" height="${H}" rx="14" fill="#1b2231"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#gridL)"/>
${c.protractor ? `
  <!-- PROTRACTOR (1st inversion): the angle scale belongs to the guide, so it never moves. -->
  <g id="protractor">
    ${c.protractor}
  </g>
` : ''}${frameBlock}
${dims}${dimE}

  <!-- LINK 2 - CRANK (teal) and LINK 3 - CONNECTING ROD (purple) -->
  ${bar('crank', 18, '#2ea898', '#17594f', (g) => [g.O, g.A])}
  ${bar('rod', 16, '#8f64d8', '#47306f', (g) => [g.A, g.B])}

  <!-- LINK 4 - SLIDER BLOCK (gold): translated onto B and rotated with the guide -->
  ${sliderBlock}

  <!-- PIN JOINTS -->
  ${pin('pin-O', 9, (g) => g.O)}
  ${pin('pin-A', 7, (g) => g.A)}
  ${pin('pin-B', 7, (g) => g.B)}

  <!-- LABELS (lengths along the bars; small tags on the pivots) -->
  ${moveEl('rod-label', '', `<text class="linklbl" text-anchor="middle">3 · l ${num(c.l * k, 1)} ${len}</text>`, (g) => ({ x: g.rodLbl.x, y: g.rodLbl.y }), (g) => g.rodLbl.a, true)}
  ${moveEl('crank-label', '', `<text class="linklbl small" text-anchor="middle">2 · r ${num(c.r * k, 1)}</text>`, (g) => ({ x: g.crankLbl.x, y: g.crankLbl.y }), (g) => g.crankLbl.a, true)}
  ${tag('tag-O', 'O₂', '', (g) => g.tagO)}
  ${tag('tag-A', 'A', '', (g) => g.tagA)}
  ${tag('tag-B', 'B', '', (g) => g.tagB)}

  <!-- INPUT ARROW: an arc centred exactly on the pivot the input turns about -->
  ${pathEl('input-arrow', 'fill="none" stroke="#2ea898" stroke-width="2.6" marker-end="url(#arrT)"', (g) => g.arrow)}
${progress}
</svg>
`;
  }

  return { animatedSvg, smilSvg, geometry, SCRIPT, W, H, PANEL, FRAMES };
}));
