'use strict';
/* Calculator + unit-conversion engine (no DOM). Loaded by the editor and by test/calc.test.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalcCore = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  // ------------------------------------------------------------------ expression evaluator (no eval)
  const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };

  function gamma(z) { // Lanczos approximation
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }
  function factorial(n) {
    if (n < 0 && Number.isInteger(n)) throw new Error('Factorial of a negative number');
    if (Number.isInteger(n)) {
      if (n > 170) return Infinity;
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    }
    return gamma(n + 1);
  }

  function tokenize(src) {
    const s = String(src)
      .replace(/×|·|∗/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/π/g, ' pi ').replace(/√/g, ' sqrt ')
      .replace(/²/g, '^2').replace(/³/g, '^3').replace(/\*\*/g, '^');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let m = /^(?:\d+\.?\d*|\.\d+)/.exec(s.slice(i));
        if (!m) throw new Error('Syntax error');
        let text = m[0];
        const ex = /^[eE][+-]?\d+/.exec(s.slice(i + text.length)); // 1e3, 2E-5 (but "2e" alone is 2 * e)
        if (ex) text += ex[0];
        if (/^[.\d]/.test(s.slice(i + text.length))) throw new Error('Syntax error'); // e.g. 1..2
        out.push({ t: 'num', v: parseFloat(text) });
        i += text.length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(i));
        out.push({ t: 'id', v: m[0].toLowerCase() });
        i += m[0].length;
        continue;
      }
      if ('+-*/^(),!%'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
      throw new Error(`Unexpected "${ch}"`);
    }
    return out;
  }

  const FUNCS = {
    sin: (x, c) => c.trig(Math.sin(c.toRad(x))), cos: (x, c) => c.trig(Math.cos(c.toRad(x))), tan: (x, c) => c.trig(Math.tan(c.toRad(x))),
    asin: (x, c) => c.fromRad(Math.asin(x)), acos: (x, c) => c.fromRad(Math.acos(x)), atan: (x, c) => c.fromRad(Math.atan(x)),
    atan2: (y, x, c) => c.fromRad(Math.atan2(y, x)),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, exp: Math.exp,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
    fact: factorial, pow: Math.pow, min: Math.min, max: Math.max, hypot: Math.hypot,
    mod: (a, b) => a - b * Math.floor(a / b), nroot: (x, n) => (x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)),
    deg: (x) => (x * 180) / Math.PI, rad: (x) => (x * Math.PI) / 180,
  };

  const NEEDS_CTX = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2']); // angle-mode aware

  /** evaluate("2*sin(30)+3^2", {deg:true, ans:5, mem:0}) -> number. Throws Error('...') on bad input. */
  function evaluate(src, opts = {}) {
    const deg = !!opts.deg;
    const ctx = {
      toRad: (x) => (deg ? (x * Math.PI) / 180 : x),
      fromRad: (x) => (deg ? (x * 180) / Math.PI : x),
      trig: (r) => (Math.abs(r) < 1e-15 ? 0 : r),
    };
    const consts = { ...CONST, ans: opts.ans || 0, mem: opts.mem || 0 };
    const toks = tokenize(src);
    if (!toks.length) throw new Error('Empty');
    let pos = 0;
    const peek = () => toks[pos];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const eat = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); pos++; };

    function parseExpr() {
      let v = parseTerm();
      while (isOp('+') || isOp('-')) { const op = toks[pos++].v; const r = parseTerm(); v = op === '+' ? v + r : v - r; }
      return v;
    }
    function startsOperand() {
      const t = peek();
      if (!t) return false;
      if (t.t === 'num') return true;
      if (t.t === 'id') return t.v !== 'mod';
      return t.t === 'op' && t.v === '(';
    }
    function parseTerm() {
      let v = parseUnary();
      for (;;) {
        if (isOp('*') || isOp('/')) {
          const op = toks[pos++].v; const r = parseUnary(); v = op === '*' ? v * r : v / r;
        } else if (peek() && peek().t === 'id' && peek().v === 'mod') {
          pos++; const r = parseUnary(); v = v - r * Math.floor(v / r);
        } else if (startsOperand()) { // implicit multiplication: 2pi, 3(4+1), 2 sin(30)
          v *= parseUnary();
        } else break;
      }
      return v;
    }
    function parseUnary() {
      if (isOp('-')) { pos++; return -parseUnary(); }
      if (isOp('+')) { pos++; return parseUnary(); }
      return parsePower();
    }
    function parsePower() {
      const base = parsePostfix();
      if (isOp('^')) { pos++; return Math.pow(base, parseUnary()); } // right-associative, allows 2^-3
      return base;
    }
    function parsePostfix() {
      let v = parsePrimary();
      for (;;) {
        if (isOp('!')) { pos++; v = factorial(v); }
        else if (isOp('%')) { pos++; v /= 100; }
        else break;
      }
      return v;
    }
    function parsePrimary() {
      const t = toks[pos];
      if (!t) throw new Error('Unexpected end');
      if (t.t === 'num') { pos++; return t.v; }
      if (t.t === 'op' && t.v === '(') { pos++; const v = parseExpr(); eat(')'); return v; }
      if (t.t === 'id') {
        pos++;
        if (Object.prototype.hasOwnProperty.call(FUNCS, t.v)) {
          const fn = FUNCS[t.v];
          const args = [];
          if (isOp('(')) {
            pos++;
            if (!isOp(')')) { args.push(parseExpr()); while (isOp(',')) { pos++; args.push(parseExpr()); } }
            eat(')');
          } else args.push(parsePower()); // "sin 30", "sqrt 2"
          return NEEDS_CTX.has(t.v) ? fn(...args, ctx) : fn(...args);
        }
        if (Object.prototype.hasOwnProperty.call(consts, t.v)) return consts[t.v];
        throw new Error(`Unknown "${t.v}"`);
      }
      throw new Error(`Unexpected "${t.v}"`);
    }
    const result = parseExpr();
    if (pos < toks.length) throw new Error(`Unexpected "${toks[pos].v}"`);
    if (typeof result !== 'number' || Number.isNaN(result)) throw new Error('Math error');
    if (!Number.isFinite(result)) throw new Error(result > 0 ? 'Overflow / divide by zero' : 'Overflow / divide by zero');
    return result;
  }

  /** Human-friendly, copy-friendly number text. */
  function fmt(n, digits = 12) {
    if (!Number.isFinite(n)) return 'Error';
    if (n === 0) return '0';
    const a = Math.abs(n);
    if (a >= 1e15 || a < 1e-9) return n.toExponential(Math.min(digits - 1, 12)).replace(/\.?0+e/, 'e').replace('e+', 'e');
    return String(parseFloat(n.toPrecision(digits)));
  }

  // ------------------------------------------------------------------ unit conversion
  // Every non-temperature category lists the size of each unit in a base unit (f). s = symbol.
  const U = (f, s) => ({ f, s });
  const CATEGORIES = {
    Length: { base: 'm', units: {
      Micrometer: U(1e-6, 'µm'), Millimeter: U(1e-3, 'mm'), Centimeter: U(1e-2, 'cm'), Meter: U(1, 'm'), Kilometer: U(1e3, 'km'),
      Mil: U(2.54e-5, 'mil'), Inch: U(0.0254, 'in'), Foot: U(0.3048, 'ft'), Yard: U(0.9144, 'yd'), Mile: U(1609.344, 'mi'),
      'Nautical mile': U(1852, 'nmi') } },
    Mass: { base: 'kg', units: {
      Microgram: U(1e-9, 'µg'), Milligram: U(1e-6, 'mg'), Gram: U(1e-3, 'g'), Kilogram: U(1, 'kg'), 'Metric ton': U(1000, 't'),
      Ounce: U(0.028349523125, 'oz'), Pound: U(0.45359237, 'lb'), Stone: U(6.35029318, 'st'), 'US ton': U(907.18474, 'ton'),
      'UK ton': U(1016.0469088, 'long ton') } },
    Pressure: { base: 'Pa', units: {
      Pascal: U(1, 'Pa'), Hectopascal: U(100, 'hPa'), Kilopascal: U(1e3, 'kPa'), Megapascal: U(1e6, 'MPa'), Bar: U(1e5, 'bar'),
      Millibar: U(100, 'mbar'), PSI: U(6894.757293168, 'psi'), KSI: U(6894757.293168, 'ksi'), Atmosphere: U(101325, 'atm'),
      Torr: U(101325 / 760, 'Torr'), mmHg: U(133.322387415, 'mmHg'), inHg: U(3386.389, 'inHg'), inH2O: U(249.08891, 'inH₂O'),
      'kgf/cm²': U(98066.5, 'kgf/cm²') } },
    Speed: { base: 'm/s', units: {
      'Meter/second': U(1, 'm/s'), 'Kilometer/hour': U(1 / 3.6, 'km/h'), 'Mile/hour': U(0.44704, 'mph'), Knot: U(1852 / 3600, 'kn'),
      'Foot/second': U(0.3048, 'ft/s'), 'Millimeter/second': U(1e-3, 'mm/s'), 'Centimeter/second': U(1e-2, 'cm/s'),
      'Foot/minute': U(0.00508, 'ft/min'), Mach: U(340.29, 'Mach'), 'Speed of light': U(299792458, 'c') } },
    Temperature: { base: '°C', units: {
      Celsius: { s: '°C', to: (v) => v, from: (c) => c }, Fahrenheit: { s: '°F', to: (v) => (v - 32) * 5 / 9, from: (c) => c * 9 / 5 + 32 },
      Kelvin: { s: 'K', to: (v) => v - 273.15, from: (c) => c + 273.15 }, Rankine: { s: '°R', to: (v) => (v - 491.67) * 5 / 9, from: (c) => (c + 273.15) * 9 / 5 } } },
    Time: { base: 's', units: {
      Nanosecond: U(1e-9, 'ns'), Microsecond: U(1e-6, 'µs'), Millisecond: U(1e-3, 'ms'), Second: U(1, 's'), Minute: U(60, 'min'),
      Hour: U(3600, 'h'), Day: U(86400, 'd'), Week: U(604800, 'wk'), Month: U(2629800, 'mo'), Year: U(31557600, 'yr') } },
    Volume: { base: 'L', units: {
      Milliliter: U(1e-3, 'mL'), Liter: U(1, 'L'), 'Cubic meter': U(1000, 'm³'), 'Cubic centimeter': U(1e-3, 'cm³'),
      'Cubic inch': U(0.016387064, 'in³'), 'Cubic foot': U(28.316846592, 'ft³'), 'US teaspoon': U(0.00492892159375, 'tsp'),
      'US tablespoon': U(0.01478676478125, 'tbsp'), 'US fluid ounce': U(0.0295735295625, 'fl oz'), 'US cup': U(0.2365882365, 'cup'),
      'US pint': U(0.473176473, 'pt'), 'US quart': U(0.946352946, 'qt'), 'US gallon': U(3.785411784, 'gal'),
      'UK pint': U(0.56826125, 'UK pt'), 'UK gallon': U(4.54609, 'UK gal'), 'Oil barrel': U(158.987294928, 'bbl') } },
    'Air flow': { base: 'm³/s', units: {
      'Cubic ft/minute (CFM)': U(0.000471947443, 'CFM'), 'Cubic ft/hour (CFH)': U(0.028316846592 / 3600, 'CFH'),
      'Cubic ft/second': U(0.028316846592, 'ft³/s'), 'Cubic meter/hour': U(1 / 3600, 'm³/h'), 'Cubic meter/minute': U(1 / 60, 'm³/min'),
      'Cubic meter/second': U(1, 'm³/s'), 'Liter/second': U(1e-3, 'L/s'), 'Liter/minute': U(1e-3 / 60, 'L/min'),
      'US gallon/minute': U(3.785411784e-3 / 60, 'GPM') } },
    Torque: { base: 'N·m', units: {
      'Newton meter': U(1, 'N·m'), 'Newton centimeter': U(0.01, 'N·cm'), 'Newton millimeter': U(0.001, 'N·mm'), 'Kilonewton meter': U(1000, 'kN·m'),
      'Kilogram-force meter': U(9.80665, 'kgf·m'), 'Kilogram-force cm': U(0.0980665, 'kgf·cm'), 'Pound-force foot': U(1.3558179483314, 'lbf·ft'),
      'Pound-force inch': U(0.1129848290276, 'lbf·in'), 'Ounce-force inch': U(0.00706155181, 'ozf·in'), 'Dyne centimeter': U(1e-7, 'dyn·cm') } },
  };
  const DEFAULT_UNITS = {
    Length: ['Millimeter', 'Inch'], Mass: ['Kilogram', 'Pound'], Pressure: ['Bar', 'PSI'], Speed: ['Kilometer/hour', 'Mile/hour'],
    Temperature: ['Celsius', 'Fahrenheit'], Time: ['Hour', 'Minute'], Volume: ['Liter', 'US gallon'],
    'Air flow': ['Cubic meter/hour', 'Cubic ft/minute (CFM)'], Torque: ['Newton meter', 'Pound-force foot'],
  };

  function convert(value, cat, from, to) {
    const c = CATEGORIES[cat];
    if (!c) throw new Error('Unknown category');
    const a = c.units[from], b = c.units[to];
    if (!a || !b) throw new Error('Unknown unit');
    if (cat === 'Temperature') return b.from(a.to(value));
    return (value * a.f) / b.f;
  }
  const symbol = (cat, unit) => (CATEGORIES[cat] && CATEGORIES[cat].units[unit] ? CATEGORIES[cat].units[unit].s : unit);

  return { evaluate, fmt, CATEGORIES, DEFAULT_UNITS, convert, symbol, factorial };
}));
