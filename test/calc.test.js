'use strict';
const assert = require('assert');
const { evaluate, fmt, convert, CATEGORIES, DEFAULT_UNITS, symbol } = require('../src/editor/calc-core.js');
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);

// ---- expressions
near(evaluate('1+2*3'), 7);
near(evaluate('(1+2)*3'), 9);
near(evaluate('2^3^2'), 512, 0);                       // right-associative
near(evaluate('-2^2'), -4);                            // unary minus binds looser than ^
near(evaluate('2^-3'), 0.125);
near(evaluate('10/4'), 2.5);
near(evaluate('7 mod 3'), 1);
near(evaluate('-7 mod 3'), 2);
near(evaluate('50%'), 0.5);
near(evaluate('200*15%'), 30);
near(evaluate('5!'), 120);
near(evaluate('0!'), 1);
near(evaluate('4.5!'), 52.34277778455352, 1e-8);       // gamma
near(evaluate('sqrt(16)+cbrt(27)'), 7);
near(evaluate('sqrt 9'), 3);
near(evaluate('√(81)'), 9);
near(evaluate('2π'), 2 * Math.PI);
near(evaluate('2 pi'), 2 * Math.PI);
near(evaluate('3(4+1)'), 15);
near(evaluate('2sin(30)', { deg: true }), 1);
near(evaluate('sin(pi/2)'), 1);
near(evaluate('sin(180)', { deg: true }), 0, 0);       // snapped to exactly 0
near(evaluate('cos(90)', { deg: true }), 0, 0);
near(evaluate('asin(1)', { deg: true }), 90);
near(evaluate('atan2(1,1)', { deg: true }), 45);
near(evaluate('ln(e)'), 1);
near(evaluate('log(1000)'), 3);
near(evaluate('log2(8)'), 3);
near(evaluate('1e3+2E-1'), 1000.2);
near(evaluate('2e'), 2 * Math.E);                      // "2e" is 2 * e, not an exponent
near(evaluate('ans*2', { ans: 21 }), 42);
near(evaluate('mem+1', { mem: 4 }), 5);
near(evaluate('max(1,5,3)+min(4,2)'), 7);
near(evaluate('nroot(-8,3)'), -2);
near(evaluate('hypot(3,4)'), 5);
near(evaluate('3×4÷2−1'), 5);
near(evaluate('2²+3³'), 31);
for (const bad of ['', '1/0', '2+', '(1', 'foo(2)', '1..2', '$', 'sqrt(-1)', '1 2 +']) {
  if (bad === '1 2 +') continue; // implicit multiplication then dangling +
  assert.throws(() => evaluate(bad), Error, `"${bad}" should fail`);
}
assert.throws(() => evaluate('1 2 +'), Error);

// ---- formatting
assert.strictEqual(fmt(0.1 + 0.2), '0.3');
assert.strictEqual(fmt(1 / 3), '0.333333333333');
assert.strictEqual(fmt(1234567), '1234567');
assert.strictEqual(fmt(1e20), '1e20');
assert.strictEqual(fmt(1.5e-12), '1.5e-12');
assert.strictEqual(fmt(NaN), 'Error');

// ---- unit conversion (reference values)
near(convert(100, 'Length', 'Millimeter', 'Inch'), 3.937007874, 1e-9);
assert.strictEqual(fmt(convert(100, 'Length', 'Millimeter', 'Inch'), 6), '3.93701');   // matches the screenshot
near(convert(1, 'Length', 'Mile', 'Kilometer'), 1.609344);
near(convert(12, 'Length', 'Inch', 'Foot'), 1);
near(convert(1, 'Mass', 'Pound', 'Kilogram'), 0.45359237);
near(convert(16, 'Mass', 'Ounce', 'Pound'), 1, 1e-9);
near(convert(1, 'Pressure', 'Atmosphere', 'Kilopascal'), 101.325);
near(convert(1, 'Pressure', 'Bar', 'PSI'), 14.5037738, 1e-7);
near(convert(760, 'Pressure', 'Torr', 'Atmosphere'), 1);
near(convert(60, 'Speed', 'Mile/hour', 'Kilometer/hour'), 96.56064);
near(convert(1, 'Speed', 'Knot', 'Kilometer/hour'), 1.852);
near(convert(0, 'Temperature', 'Celsius', 'Fahrenheit'), 32);
near(convert(100, 'Temperature', 'Celsius', 'Fahrenheit'), 212);
near(convert(-40, 'Temperature', 'Fahrenheit', 'Celsius'), -40);
near(convert(0, 'Temperature', 'Celsius', 'Kelvin'), 273.15);
near(convert(32, 'Temperature', 'Fahrenheit', 'Kelvin'), 273.15);
near(convert(491.67, 'Temperature', 'Rankine', 'Celsius'), 0, 1e-9);
near(convert(2, 'Time', 'Hour', 'Minute'), 120);
near(convert(1, 'Time', 'Day', 'Second'), 86400);
near(convert(1, 'Volume', 'US gallon', 'Liter'), 3.785411784);
near(convert(1, 'Volume', 'Cubic meter', 'Liter'), 1000);
near(convert(1, 'Volume', 'US quart', 'US pint'), 2, 1e-9);
near(convert(1, 'Air flow', 'Cubic ft/minute (CFM)', 'Cubic meter/hour'), 1.69901082, 1e-7);
near(convert(100, 'Air flow', 'Liter/second', 'Cubic meter/hour'), 360);
near(convert(1, 'Torque', 'Pound-force foot', 'Newton meter'), 1.3558179483314);
near(convert(1, 'Torque', 'Kilogram-force meter', 'Newton meter'), 9.80665);
near(convert(12, 'Torque', 'Pound-force inch', 'Pound-force foot'), 1, 1e-9);

// every category: defaults exist, round trips are exact, symbols are defined
for (const [cat, def] of Object.entries(DEFAULT_UNITS)) {
  assert.ok(CATEGORIES[cat] && CATEGORIES[cat].units[def[0]] && CATEGORIES[cat].units[def[1]], `defaults for ${cat}`);
  for (const a of Object.keys(CATEGORIES[cat].units)) {
    assert.ok(symbol(cat, a), `${cat}/${a} has a symbol`);
    for (const b of Object.keys(CATEGORIES[cat].units)) near(convert(convert(37.5, cat, a, b), cat, b, a), 37.5, 1e-9);
  }
}
for (const cat of ['Length', 'Mass', 'Pressure', 'Speed', 'Temperature', 'Time', 'Volume', 'Air flow', 'Torque']) assert.ok(CATEGORIES[cat], cat);
console.log('calc tests passed');
