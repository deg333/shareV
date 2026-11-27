'use strict';
const assert = require('assert');
const S = require('../src/editor/sim-core.js');
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);
const deg = (x) => (x * Math.PI) / 180;

// ---- reference values from the reference simulator screenshot: r=40, l=120, e=0, 20 rpm, theta=18 deg
{
  const omega = (2 * Math.PI * 20) / 60;
  const s = S.solve({ r: 40, l: 120, e: 0 }, 1, deg(18), omega);
  near((s.phi * 180) / Math.PI, 5.91, 5e-4);
  near(s.x, 157.41, 1e-4);
  near(s.v, -34.1, 2e-3);
  near(s.a, -215, 4e-3);
  const m = S.metrics({ r: 40, l: 120, e: 0 }, 1);
  near(m.stroke, 80);
  near(m.N, 3);
  near(m.ratio, 1);
}

// ---- derivatives agree with finite differences of x(theta)
function fd(p, inv, th0, omega) {
  const h = 1e-5;
  const a = S.solve(p, inv, th0 - h, omega), b = S.solve(p, inv, th0 + h, omega), c = S.solve(p, inv, th0, omega);
  return { c, dx: (b.x - a.x) / (2 * h), ddx: (b.x - 2 * c.x + a.x) / (h * h), dphi: (b.phi - a.phi) / (2 * h), ddphi: (b.phi - 2 * c.phi + a.phi) / (h * h) };
}
for (const p of [{ r: 40, l: 120, e: 0 }, { r: 30, l: 90, e: 25 }, { r: 50, l: 80, e: -20 }]) {
  for (const th of [0.1, 1, 2.2, 3.5, 5, 6.1]) {
    const f = fd(p, 1, th, 2);
    near(f.c.dx, f.dx, 1e-5); near(f.c.ddx, f.ddx, 1e-3); near(f.c.dphi, f.dphi, 1e-5); near(f.c.ddphi, f.ddphi, 1e-3);
    near(f.c.dx, -p.r * Math.sin(th + f.c.phi) / Math.cos(f.c.phi), 1e-9); // closed form: x' = -r sin(th+phi)/cos(phi)
  }
}

// ---- time derivative checks: v = dx/dt, a = dv/dt for a uniformly driven crank (inversions 1,2,4)
{
  const p = { r: 40, l: 120, e: 15 }, omega = 3, dt = 1e-6;
  for (const th of [0.4, 2, 4.4]) {
    const a = S.solve(p, 1, th - omega * dt, omega), b = S.solve(p, 1, th + omega * dt, omega), c = S.solve(p, 1, th, omega);
    near(c.v, (b.x - a.x) / (2 * dt), 1e-5);
    near(c.a, (b.v - a.v) / (2 * dt), 1e-4);
  }
}

// ---- inversion 3: the rod-relative crank angle beta turns uniformly; theta follows from Newton's method
{
  const p = { r: 40, l: 85, e: 0 }, omega = 2, dt = 1e-6;
  let th = 0;
  for (let beta = 0; beta < 14; beta += 0.37) {
    th = S.thetaFromPhase(p, 3, beta, th);
    const k = S.kin(p, th);
    near(th + k.phi, beta, 1e-9);
  }
  // v and a really are time derivatives when beta = omega * t
  for (const beta of [0.5, 2, 4, 5.5]) {
    const th0 = S.thetaFromPhase(p, 3, beta, beta);
    const sa = S.solve(p, 3, S.thetaFromPhase(p, 3, beta - omega * dt, th0), omega);
    const sb = S.solve(p, 3, S.thetaFromPhase(p, 3, beta + omega * dt, th0), omega);
    const sc = S.solve(p, 3, th0, omega);
    near(sc.v, (sb.x - sa.x) / (2 * dt), 1e-5);
    near(sc.a, (sb.v - sa.v) / (2 * dt), 1e-4);
  }
}

// ---- dead centres, stroke and quick-return ratio
{
  const p = { r: 40, l: 120, e: 25 };
  const m = S.metrics(p, 1);
  // brute force the true extremes of x(theta)
  let xmax = -1e9, xmin = 1e9;
  for (let t = 0; t < 360; t += 0.01) { const k = S.kin(p, deg(t)); xmax = Math.max(xmax, k.x); xmin = Math.min(xmin, k.x); }
  near(m.xt, xmax, 1e-7); near(m.xb, xmin, 1e-7); near(m.stroke, xmax - xmin, 1e-7);
  // time ratio = (180 + alpha) / (180 - alpha), alpha = angle between the crank positions at the dead centres
  const alpha = Math.asin(25 / 80) - Math.asin(25 / 160);
  near(m.ratio, (Math.PI + alpha) / (Math.PI - alpha), 1e-9);
  assert.ok(m.ratio > 1);
  const q = S.metrics({ r: 40, l: 85, e: 0 }, 3); // slotted lever: (180 + 2a)/(180 - 2a), sin a = r/l
  const a2 = Math.asin(40 / 85);
  near(q.ratio, (Math.PI + 2 * a2) / (Math.PI - 2 * a2), 1e-9);
  near(S.metrics({ r: 40, l: 120, e: 0 }, 4).ratio, 1);
}

// ---- torque: power balance T * thetadot = Fnet * v, with inertia
{
  const p = { r: 40, l: 120, e: 10 }, omega = 5;
  const s = S.solve(p, 1, 1.1, omega, { F: 200, m: 0.8 });
  near(s.T * s.thd, s.Fnet * (s.v / 1000), 1e-9);
  near(s.Fnet, 200 - 0.8 * (s.a / 1000), 1e-12);
}

// ---- reachability and presets
assert.strictEqual(S.kin({ r: 100, l: 50, e: 0 }, Math.PI / 2), null);
assert.ok(S.minRod(40, 25) > 65);
for (const [name, pr] of Object.entries(S.PRESETS)) {
  assert.ok(pr.l >= S.minRod(pr.r, pr.e) - 0.02, `${name}: rod long enough to turn the crank round`);
  for (let t = 0; t < 360; t += 5) assert.ok(S.kin(pr, deg(t)), `${name} reachable at ${t}`);
}
// ---- Whitworth quick return preset (crank fixed, input = link 3 about A): matches the reference simulator
{
  const pr = S.PRESETS['Quick Return'];
  assert.strictEqual(pr.inv, 2); assert.strictEqual(pr.in2, 'link3');
  assert.strictEqual(S.driveOf(pr.inv, pr.in2), 3, 'beta (crank-to-rod angle) turns uniformly');
  assert.strictEqual(S.driveOf(2, 'link1'), 2, 'rotary-engine input keeps theta uniform');
  assert.strictEqual(S.driveOf(1, 'link3'), 1);
  near(pr.l / pr.r, 1.79, 5e-3);                                   // N = 1.79
  near(S.metrics(pr, S.driveOf(pr.inv, pr.in2)).ratio, 2.215, 1e-3); // time ratio 2.215
  const s = S.solve(pr, 3, deg(295.7), 2 * Math.PI * pr.rpm / 60);
  near((s.phi * 180) / Math.PI, -30.29, 1e-3);                      // phi at theta = 295.7 deg
  near(s.x / 25.4, 6.23, 2e-3);                                      // X = 6.23 in
}
console.log('sim tests passed');
