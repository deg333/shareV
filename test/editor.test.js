'use strict';
// Drives the real editor page in headless Chromium with a stubbed `window.api`.
// Run: npm test   (needs `playwright` resolvable, e.g. globally installed)
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

const SHOT = process.env.SHOT; // optional screenshot path

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript(() => {
    window.__saved = null;
    window.api = {
      capture() {}, init: async () => null, onLoad() {}, setEmpty() {}, setTitle() {},
      saveSvg: async (svg) => { window.__saved = svg; return '/tmp/x.svg'; },
      exportPng: async () => 'x.png', copyPng: async (d) => { window.__copied = d; return true; },
      openFile: async () => null, openFolder() {},
    };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'src', 'editor', 'index.html'));

  // fake "screenshot": gradient with some content
  const bg = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 560;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 900, 560); gr.addColorStop(0, '#3b6ea5'); gr.addColorStop(1, '#a5d6a7');
    g.fillStyle = gr; g.fillRect(0, 0, 900, 560);
    g.fillStyle = '#fff'; g.fillRect(60, 60, 360, 220); g.fillStyle = '#222'; g.font = '28px sans-serif'; g.fillText('Hello window', 90, 120);
    return c.toDataURL('image/png');
  });
  await page.evaluate((d) => window.__sharev.loadImage(d, 'test'), bg);

    const zoom = await page.evaluate(() => window.__state.zoom);
  let svgBox = await page.locator('#svg').boundingBox();
  const at = (x, y) => [svgBox.x + x * zoom, svgBox.y + y * zoom];
  const drag = async (tool, a, b) => {
    await page.keyboard.press(tool);
    const [x1, y1] = at(...a), [x2, y2] = at(...b);
    await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2); await page.mouse.move(x2, y2); await page.mouse.up();
  };
  const types = () => page.evaluate(() => window.__state.shapes.map((s) => s.type));

  await drag('r', [450, 50], [600, 130]);
  await drag('e', [620, 50], [760, 130]);
  await drag('l', [450, 160], [600, 200]);
  await drag('a', [620, 160], [780, 240]);
  await drag('h', [90, 95], [300, 130]);
  // freehand
  await page.keyboard.press('f');
  const pts = [[450, 300], [480, 340], [520, 290], [560, 350], [600, 300]].map((p) => at(...p));
  await page.mouse.move(...pts[0]); await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 4 });
  await page.mouse.up();

  // bezier pen: corner, curve (drag), corner, then Enter
  await page.keyboard.press('p');
  await page.check('#pHeadStart'); await page.check('#pHeadEnd'); await page.fill('#pHeadSize', '26');
  await page.fill('#pStrokeA', '60');
  const bz = [[100, 480], [200, 520], [300, 480]].map((q) => at(...q));
  await page.mouse.click(...bz[0]);
  await page.mouse.move(...bz[1]); await page.mouse.down(); await page.mouse.move(bz[1][0] + 40, bz[1][1] - 40, { steps: 4 }); await page.mouse.up();
  await page.mouse.click(...bz[2]);
  await page.keyboard.press('Enter');

  // text (click, type, ctrl+enter)
  await page.keyboard.press('t');
  await page.mouse.click(...at(80, 320));
  await page.keyboard.type('Plain text');
  await page.keyboard.press('Control+Enter');
  // text box
  await drag('b', [80, 380], [330, 450]);
  await page.keyboard.type('A text box that has to wrap onto several lines automatically.');
  await page.keyboard.press('Control+Enter');
  // balloon (single click => default size)
  await page.keyboard.press('c');
  await page.mouse.click(...at(500, 400));
  await page.keyboard.type('Look here!');
  await page.keyboard.press('Control+Enter');

  assert.deepStrictEqual(await types(), ['rect', 'ellipse', 'line', 'arrow', 'highlight', 'pen', 'bezier', 'text', 'textbox', 'balloon']);

  // step tool: numbered circles, tool stays active
  await page.keyboard.press('n');
  for (const pos of [[700, 400], [740, 400], [780, 400]]) await page.mouse.click(...at(...pos));
  const steps = await page.evaluate(() => window.__state.shapes.filter((s) => s.type === 'step').map((s) => [s.n, s.fill, s.tc]));
  assert.deepStrictEqual(steps, [[1, '#ff0000', '#ffffff'], [2, '#ff0000', '#ffffff'], [3, '#ff0000', '#ffffff']], 'steps number 1,2,3');
  assert.strictEqual(await page.inputValue('#pNum'), '4');
  await page.fill('#pNum', '10'); await page.press('#pNum', 'Enter');
  await page.mouse.click(...at(820, 400));
  assert.strictEqual(await page.evaluate(() => window.__state.shapes.at(-1).n), 10, 'next number can be overridden');
  await page.keyboard.press('Control+z');
  assert.strictEqual(await page.inputValue('#pNum'), '4', 'undo frees the number');

  // per-tool defaults
  const S = await page.evaluate(() => Object.fromEntries(window.__state.shapes.map((s) => [s.type, s])));
  assert.deepStrictEqual([S.rect.stroke, S.rect.fill, S.ellipse.stroke, S.ellipse.fill], ['#ff0000', 'none', '#ff0000', 'none']);
  assert.deepStrictEqual([S.text.tc, S.text.stroke], ['#ffffff', '#ff0000'], 'text: white fill, red outline');
  assert.deepStrictEqual([S.textbox.fill, S.textbox.tc, S.balloon.fill, S.balloon.tc], ['#ff0000', '#ffffff', '#ff0000', '#ffffff']);
  assert.strictEqual(S.highlight.fill, '#ffff00');
  assert.strictEqual(S.bezier.nodes.length, 3);
  assert.deepStrictEqual([S.bezier.hs, S.bezier.he, S.bezier.hz, S.bezier.sa], [true, true, 26, 0.6], 'bezier arrowheads + opacity');
  assert.deepStrictEqual([S.arrow.he, S.arrow.hs, S.line.he], [true, false, false], 'arrow head at end only by default');
  assert.strictEqual(S.highlight.fa, 0.5);
  assert.ok(S.pen.pts.length < 17 && S.pen.pts.length >= 3, 'freehand simplified/smoothed: ' + S.pen.pts.length);

  // each tool remembers its own options
  await page.keyboard.press('r');
  await page.fill('#pWidth', '9');
  await page.press('#pWidth', 'Tab');
  await page.keyboard.press('e');
  assert.strictEqual(await page.inputValue('#pWidth'), '4', 'ellipse keeps its own width');
  await page.keyboard.press('r');
  assert.strictEqual(await page.inputValue('#pWidth'), '9', 'rect remembered width');
  await page.fill('#pWidth', '4'); await page.press('#pWidth', 'Enter');

  // select + move the rectangle (toolbar height may change with the tool, so re-measure)
  svgBox = await page.locator('#svg').boundingBox();
  await page.keyboard.press('v');
  await page.mouse.click(...at(450, 70)); // left edge of rect (stroke)
  const before = await page.evaluate(() => ({ ...window.__state.shapes[0] }));
  await page.mouse.move(...at(450, 70)); await page.mouse.down(); await page.mouse.move(...at(470, 90), { steps: 3 }); await page.mouse.up();
  const after = await page.evaluate(() => ({ ...window.__state.shapes[0] }));
  assert.ok(Math.abs(after.x - before.x - 20) < 2 && Math.abs(after.y - before.y - 20) < 2, 'rect moved by drag');

  // multi-select: rubber-band both shapes, change an option for all, nudge them together
  await page.keyboard.press('Escape');
  svgBox = await page.locator('#svg').boundingBox();
  await page.mouse.move(...at(440, 40)); await page.mouse.down(); await page.mouse.move(...at(600, 100), { steps: 3 }); await page.mouse.move(...at(780, 155), { steps: 3 }); await page.mouse.up();
  const picked = await page.evaluate(() => window.__state.sels.map((id) => window.__state.shapes.find((s) => s.id === id).type).sort());
  assert.deepStrictEqual(picked, ['ellipse', 'rect'], 'marquee selects both');
  await page.fill('#pStroke', '#00ff00');
  const strokes = await page.evaluate(() => window.__state.shapes.filter((s) => ['rect', 'ellipse'].includes(s.type)).map((s) => s.stroke));
  assert.deepStrictEqual(strokes, ['#00ff00', '#00ff00'], 'option applied to all selected');
  await page.fill('#pWidth', '7'); await page.press('#pWidth', 'Enter');
  const widths = await page.evaluate(() => window.__state.shapes.filter((s) => ['rect', 'ellipse'].includes(s.type)).map((s) => s.sw));
  assert.deepStrictEqual(widths, [7, 7]);
  const x0 = await page.evaluate(() => window.__state.shapes.filter((s) => ['rect', 'ellipse'].includes(s.type)).map((s) => s.x));
  await page.keyboard.press('Shift+ArrowRight');
  const x1 = await page.evaluate(() => window.__state.shapes.filter((s) => ['rect', 'ellipse'].includes(s.type)).map((s) => s.x));
  assert.deepStrictEqual(x1, x0.map((x) => x + 10), 'nudged together');
  // shift-click toggles one out of the selection
  await page.keyboard.down('Shift'); await page.mouse.click(...at(480, 100)); await page.keyboard.up('Shift');
  assert.strictEqual(await page.evaluate(() => window.__state.sels.length), 1, 'shift-click removes from selection');
  await page.keyboard.press('Control+a');
  assert.strictEqual(await page.evaluate(() => window.__state.sels.length === window.__state.shapes.length), true, 'select all');
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(480, 100)); // re-select the rectangle for the delete/undo checks below

  // undo / redo
  const n = (await types()).length;
  await page.keyboard.press('Delete');
  assert.strictEqual((await types()).length, n - 1);
  await page.keyboard.press('Control+z');
  assert.strictEqual((await types()).length, n);
  await page.keyboard.press('Control+y');
  assert.strictEqual((await types()).length, n - 1);
  await page.keyboard.press('Control+z');

  // save -> real SVG vector content
  await page.keyboard.press('Control+s');
  const svg = await page.evaluate(() => window.__saved);
  assert.ok(svg && svg.startsWith('<?xml'), 'svg saved');
  for (const tag of ['<rect', '<ellipse', '<line', '<text', '<tspan', 'paint-order="stroke"', 'sharev-bg', 'sharev-data', 'mix-blend-mode']) {
    assert.ok(svg.includes(tag), 'svg contains ' + tag);
  }
  assert.ok(!svg.includes('class="hit"') && !svg.includes('data-id'), 'no editor-only helpers in saved svg');
  assert.ok((svg.match(/<path/g) || []).length >= 4, 'arrow head, pen and balloon paths present');

  // reload the saved svg: shapes come back editable
  await page.evaluate((s) => window.__sharev.loadSvgText(s, 'x.svg'), svg);
  assert.deepStrictEqual(await types(), ['rect', 'ellipse', 'line', 'arrow', 'highlight', 'pen', 'bezier', 'text', 'textbox', 'balloon', 'step', 'step', 'step']);
  assert.strictEqual(await page.evaluate(() => window.__saved === window.__sharev.buildSvg()), true, 'save/load roundtrip is stable');

  // PNG rendering of the SVG works (annotations are painted)
  const png = await page.evaluate(() => window.__sharev.renderPng());
  assert.ok(png.startsWith('data:image/png') && png.length > 5000, 'png rendered');

  if (SHOT) { await page.keyboard.press('Escape'); await page.screenshot({ path: SHOT }); }
  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('editor tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
