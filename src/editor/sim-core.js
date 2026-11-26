'use strict';
/* Slider-crank kinematics (no DOM). Loaded by the simulator UI and by test/sim.test.js.

   Frame 1 (link 1 fixed) conventions, all lengths in mm, angles in radians:
     O = (0,0) crank pivot, crank OA of length r at angle th (counter-clockwise),
     slider guide is the horizontal line y = e, rod AB has length l, B = (x, e).
       sin(phi) = (r sin th - e) / l           (phi = angle of the rod below the guide)
       x        = r cos th + l cos phi
   Every other inversion is the same relative motion seen from another fixed link. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SimCore = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const TAU = 2 * Math.PI;
  const mod = (a, n) => ((a % n) + n) % n;

  /** Position solution and its derivatives with respect to the crank angle th. Returns null if the rod cannot reach. */
  function kin(p, th) {
    const { r, l, e } = p;
    const s = (r * Math.sin(th) - e) / l;
    if (Math.abs(s) > 1) return null;
    const phi = Math.asin(s), cp = Math.cos(phi);
    const dphi = (r * Math.cos(th)) / (l * cp);                                  // dphi/dth
    const ddphi = (-r * Math.sin(th) * cp + r * Math.cos(th) * s * dphi) / (l * cp * cp); // d2phi/dth2
    const x = r * Math.cos(th) + l * cp;
    const dx = -r * Math.sin(th) - l * s * dphi;                                  // dx/dth  (= -r sin(th+phi)/cos(phi))
    const ddx = -r * Math.cos(th) - l * cp * dphi * dphi - l * s * ddphi;         // d2x/dth2
    return { th, s, phi, cp, x, dx, ddx, dphi, ddphi };
  }

  /** The angle that turns uniformly. Inversions 1, 2, 4: the crank angle th itself. Inversion 3 (rod fixed): the angle of the
   *  crank relative to the rod, beta = th + phi. Returns th-dot and th-double-dot for input speed omega (rad/s). */
  function drive(inv, k, omega) {
    if (inv === 3) {
      const g = 1 + k.dphi;
      const thd = omega / g;
      return { thd, thdd: (-thd * thd * k.ddphi) / g };
    }
    return { thd: omega, thdd: 0 };
  }

  /** Full state at crank angle th. Forces: F (N, pushes the slider towards +x), m (kg). Lengths mm, rad/s. */
  function solve(p, inv, th, omega, load = {}) {
    const k = kin(p, th);
    if (!k) return null;
    const d = drive(inv, k, omega);
    const v = k.dx * d.thd;                                   // mm/s
    const a = k.ddx * d.thd * d.thd + k.dx * d.thdd;          // mm/s^2
    const phid = k.dphi * d.thd;                              // rad/s
    const phidd = k.ddphi * d.thd * d.thd + k.dphi * d.thdd;  // rad/s^2
    const F = load.F || 0, m = load.m || 0;
    const Fnet = F - m * (a / 1000);                          // N (inertia force opposes acceleration)
    const T = Fnet * (k.dx / 1000);                           // N*m : power balance T*thd = Fnet * v
    return { ...k, ...d, v, a, phid, phidd, Fnet, T, beta: th + k.phi };
  }

  /** Solve th from the uniformly turning input angle `phase` (continuation from guess). Inversion 3 needs Newton. */
  function thetaFromPhase(p, inv, phase, guess) {
    if (inv !== 3) return phase;
    let th = Number.isFinite(guess) ? guess : phase;
    // keep the guess on the same revolution as the phase
    th += Math.round((phase - th) / TAU) * TAU;
    for (let i = 0; i < 40; i++) {
      const k = kin(p, th);
      if (!k) return phase;                  // unreachable: fall back to uniform th
      const f = th + k.phi - phase, fp = 1 + k.dphi;
      if (Math.abs(f) < 1e-12) return th;
      if (fp < 0.02) return phase;           // lever turns back: not a monotonic drive
      th -= Math.max(-0.5, Math.min(0.5, f / fp));
    }
    return th;
  }

  /** Dead centres (slider extremes), stroke, quick-return time ratio, N = l/r. */
  function metrics(p, inv) {
    const { r, l, e } = p;
    const xt = Math.sqrt(Math.max(0, (l + r) * (l + r) - e * e));   // TDC: crank and rod in line
    const xb = Math.sqrt(Math.max(0, (l - r) * (l - r) - e * e));   // BDC: crank folded back onto the rod
    const stroke = xt - xb;
    const thT = Math.asin(Math.max(-1, Math.min(1, e / (l + r))));
    const thB = Math.PI + Math.asin(Math.max(-1, Math.min(1, l - r > 1e-9 ? e / (l - r) : 0)));
    let fwd, ret;
    if (inv === 3) { // lever (guide) extremes at th = +-90 deg; the rod-relative crank angle beta turns uniformly
      const f1 = Math.asin(Math.max(-1, Math.min(1, (r - e) / l))), f2 = Math.asin(Math.max(-1, Math.min(1, (-r - e) / l)));
      fwd = Math.PI + f2 - f1;
    } else {
      fwd = mod(thB - thT, TAU);          // th from TDC to BDC
    }
    ret = TAU - fwd;
    const ratio = Math.max(fwd, ret) / Math.min(fwd, ret);
    return { xt, xb, stroke, thT, thB, alpha: Math.abs(fwd - Math.PI), fwd, ret, ratio, N: l / r };
  }

  /** Shortest rod that lets the crank turn all the way round. */
  const minRod = (r, e) => r + Math.abs(e) + 0.01;

  const PRESETS = {
    'IC Engine': { inv: 1, r: 40, l: 120, e: 0, rpm: 20, hint: 'IC engine, reciprocating compressor' },
    'Offset Engine': { inv: 1, r: 40, l: 120, e: 25, rpm: 20, hint: 'offset slider-crank: longer working stroke, quick return' },
    'Quick Return': { inv: 3, r: 40, l: 85, e: 0, rpm: 20, hint: 'crank & slotted-lever quick-return mechanism' },
    'Rotary Engine': { inv: 2, r: 40, l: 120, e: 0, rpm: 20, hint: 'Gnome rotary engine / Whitworth: crank fixed, cylinder rotates' },
    'Osc. Cylinder': { inv: 3, r: 40, l: 120, e: 0, rpm: 20, hint: 'oscillating cylinder engine' },
    'Hand Pump': { inv: 4, r: 40, l: 120, e: 0, rpm: 20, hint: 'hand pump / Bull engine: slider fixed' },
  };

  return { kin, drive, solve, thetaFromPhase, metrics, minRod, PRESETS, TAU, mod };
}));
