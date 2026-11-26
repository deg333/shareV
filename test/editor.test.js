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

  const svgBox = await page.locator('#svg').boundingBox();
  const zoom = await page.evaluate(() => window.__state.zoom);
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
  await page.keyboard.press('p');
  const pts = [[450, 300], [480, 340], [520, 290], [560, 350], [600, 300]].map((p) => at(...p));
  await page.mouse.move(...pts[0]); await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 4 });
  await page.mouse.up();

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

  assert.deepStrictEqual(await types(), ['rect', 'ellipse', 'line', 'arrow', 'highlight', 'pen', 'text', 'textbox', 'balloon']);

  // select + move the rectangle
  await page.keyboard.press('v');
  await page.mouse.click(...at(450, 70)); // left edge of rect (stroke)
  const before = await page.evaluate(() => ({ ...window.__state.shapes[0] }));
  await page.mouse.move(...at(450, 70)); await page.mouse.down(); await page.mouse.move(...at(470, 90), { steps: 3 }); await page.mouse.up();
  const after = await page.evaluate(() => ({ ...window.__state.shapes[0] }));
  assert.ok(Math.abs(after.x - before.x - 20) < 2 && Math.abs(after.y - before.y - 20) < 2, 'rect moved by drag');

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
  for (const tag of ['<rect', '<ellipse', '<line', '<text', '<tspan', 'sharev-bg', 'sharev-data', 'mix-blend-mode']) {
    assert.ok(svg.includes(tag), 'svg contains ' + tag);
  }
  assert.ok(!svg.includes('class="hit"') && !svg.includes('data-id'), 'no editor-only helpers in saved svg');
  assert.ok((svg.match(/<path/g) || []).length >= 3, 'arrow head, pen and balloon paths present');

  // reload the saved svg: shapes come back editable
  await page.evaluate((s) => window.__sharev.loadSvgText(s, 'x.svg'), svg);
  assert.deepStrictEqual(await types(), ['rect', 'ellipse', 'line', 'arrow', 'highlight', 'pen', 'text', 'textbox', 'balloon']);
  assert.strictEqual(await page.evaluate(() => window.__saved === window.__sharev.buildSvg()), true, 'save/load roundtrip is stable');

  // PNG rendering of the SVG works (annotations are painted)
  const png = await page.evaluate(() => window.__sharev.renderPng());
  assert.ok(png.startsWith('data:image/png') && png.length > 5000, 'png rendered');

  if (SHOT) { await page.keyboard.press('Escape'); await page.screenshot({ path: SHOT }); }
  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('editor tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
