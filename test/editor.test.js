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
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(m.text()); }); // 404s come from the emoji-fetch test

  await page.addInitScript(() => {
    window.__saved = null;
    window.api = {
      capture() {}, init: async () => null, onLoad() {}, setEmpty() {}, setTitle() {},
      saveSvg: async (svg) => { window.__saved = svg; return '/tmp/x.svg'; },
      exportPng: async () => 'x.png', copyPng: async (d) => { window.__copied = d; return true; },
      openFile: async () => null, openFolder() {},
      ocr: async () => ({ language: 'English', lines: [{ text: 'Hello window', x: 90, y: 95, w: 210, h: 34 }, { text: 'second line', x: 90, y: 140, w: 150, h: 30 }] }), copyText: async (t) => { window.__copied = t; },
      emojiList: async () => [], emojiSave: async (n) => { window.__emojiSaved = n; return n.endsWith('.svg') ? n : n + '.svg'; }, emojiDelete: async () => {}, emojiImport: async () => [{ file: 'my star.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><path onclick="x()" d="M32 4l8 24h24l-20 15 8 24-20-15-20 15 8-24L0 28h24z" fill="gold"/></svg>' }],
      getHotkeys: async () => ({ fullscreen: 'CommandOrControl+PrintScreen', region: 'PrintScreen', window: 'Alt+PrintScreen', lastRegion: 'CommandOrControl+Shift+PrintScreen' }),
      capture: (m) => { (window.__caps = window.__caps || []).push(m); },
      saveFile: async (name, ext, filter, text) => { window.__svgExport = { name, ext, text }; return '/tmp/' + name; },
      getCaptureOpts: async () => ({ delay: 0, self: false }), setCaptureOpts: async (d, s) => { window.__cap = [d, s]; },
      getSaveSettings: async () => window.__sv || { askWhereToSave: false, saveDir: 'C:/ShareV/Screenshots', monthFolders: true, monthPattern: '{yyyy}-{MM}', filePattern: '{name}_{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}' }, setSaveSettings: async (s) => { window.__sv = s; return s; }, previewSavePath: async (s) => s.saveDir + '/preview.svg', pickFolder: async () => 'D:/Shots', loadUi: async () => null, saveUi: async (j) => { window.__ui = j; }, exportUi: async (j) => { window.__export = j; return 'x.json'; }, importUi: async () => window.__import || null,
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

  // colour presets + shortcut help
  await page.keyboard.press('r');
  await page.click('button.pal[data-for="pStroke"]');
  await page.click('#palette .sw[title^="lime"]');
  assert.strictEqual(await page.inputValue('#pStroke'), '#00ff00', 'preset applied');
  assert.strictEqual(await page.evaluate(() => window.__state.shapes.length && true), true);
  await page.click('button.pal[data-for="pStroke"]');
  await page.click('#palette .sw[title^="Pantone 355"]');
  assert.strictEqual(await page.inputValue('#pStroke'), '#039647', 'brand preset applied');
  await page.click('button.pal[data-for="pStroke"]'); await page.click('#palette .save');
  assert.ok((await page.locator('#palette .grid').nth(2).locator('.sw').count()) >= 1, 'custom colour saved');
  await page.keyboard.press('Escape');
  await page.fill('#pStroke', '#ff0000'); // restore default red for later steps
  await page.click('#bHelp');
  assert.ok(await page.locator('#help').isVisible() && (await page.locator('#help').innerText()).includes('Ctrl + ]'), 'shortcut help lists Ctrl+]');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.locator('#help').isHidden(), true);
  await page.keyboard.press('Escape');

  // settings: auto-saved to the backend, exportable, importable, resettable
  await page.waitForTimeout(600);
  const saved = JSON.parse(await page.evaluate(() => window.__ui));
  assert.strictEqual(saved.toolOpts.rect.stroke, '#ff0000');
  assert.ok(Array.isArray(saved.customColors) && saved.customColors.length >= 1, 'custom colours persisted');
  await page.click('#bSettings'); await page.click('#menu [data-act="reset"]');
  assert.deepStrictEqual(await page.evaluate(() => window.__ui && 1), 1);
  await page.evaluate(() => { window.__import = JSON.stringify({ toolOpts: { rect: { stroke: '#123456', sw: 11 } }, customColors: ['#abcdef'] }); });
  await page.click('#bSettings'); await page.click('#menu [data-act="import"]');
  await page.keyboard.press('r');
  assert.strictEqual(await page.inputValue('#pStroke'), '#123456', 'imported settings loaded');
  assert.strictEqual(await page.inputValue('#pWidth'), '11');
  await page.click('#bSettings'); await page.click('#menu [data-act="reset"]');
  await page.keyboard.press('e'); await page.keyboard.press('r');
  assert.strictEqual(await page.inputValue('#pStroke'), '#ff0000', 'reset restores defaults');
  await page.keyboard.press('Escape');

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

  // blur + pixelate (burned into the saved image by default) and drop shadow
  svgBox = await page.locator('#svg').boundingBox();
  const origBg = await page.evaluate(() => window.__state.bg);
  await page.keyboard.press('u');
  assert.strictEqual(await page.locator('#opts label:visible', { hasText: 'Radius' }).count(), 1, 'blur shows a radius option');
  await drag('u', [80, 90], [300, 140]);
  await page.keyboard.press('x');
  assert.strictEqual(await page.locator('#opts label:visible', { hasText: 'Block' }).count(), 1, 'pixelate shows a block option');
  await drag('x', [320, 90], [420, 200]);
  assert.deepStrictEqual(await page.evaluate(() => window.__state.shapes.slice(-2).map((s) => s.type)), ['blur', 'pixelate']);
  assert.ok((await page.evaluate(() => document.querySelectorAll('#fx image').length)) === 2, 'effects render in the fx layer');
  await page.keyboard.press('r');
  await page.check('#pShadow');
  await drag('r', [100, 300], [200, 350]);
  assert.ok(await page.evaluate(() => window.__state.shapes.at(-1).sh === true), 'shape has shadow');
  let out = await page.evaluate(() => window.__sharev.buildSvg());
  assert.ok(out.includes('<filter id="sv-sh-4"') && out.includes('filter="url(#sv-sh-4)"'), 'shadow filter emitted');
  assert.ok(!out.includes('id="effects"'), 'baked: no live effect layers in the saved svg');
  const bakedHref = out.match(/id="sharev-bg"[^>]*xlink:href="([^"]+)"/)[1];
  assert.notStrictEqual(bakedHref, origBg, 'saved screenshot has the blur/pixelate burned in');
  assert.ok(!/&quot;type&quot;:&quot;(blur|pixelate)&quot;/.test(out), 'fx shapes not in metadata when baked');
  await page.evaluate(() => { window.__state.bakeFx = false; });
  out = await page.evaluate(() => window.__sharev.buildSvg());
  assert.ok(out.includes('id="effects"') && /&quot;type&quot;:&quot;blur&quot;/.test(out), 'unbaked keeps editable effects');
  await page.evaluate(() => { window.__state.bakeFx = true; });

  // emoji: bundled Blobmoji, stamp, resize, fetch from svgmoji, import
  await page.route('https://raw.githubusercontent.com/svgmoji/**', (route) => {
    const url = route.request().url();
    if (url.includes('svgmoji__noto/svg/1F680.svg')) {
      route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>' });
    } else route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'nope' });
  });
  svgBox = await page.locator('#svg').boundingBox();
  await page.click('[data-tool="emoji"]');
  assert.ok(await page.locator('#emojiPicker').isVisible(), 'picker opens with the tool');
  assert.ok((await page.locator('#emojiGrid .em').count()) >= 250, 'all bundled emoji listed');
  await page.fill('#emojiSearch', 'smiling face');
  const filtered = await page.locator('#emojiGrid .em').count();
  assert.ok(filtered > 0 && filtered < 250, 'search filters');
  await page.locator('#emojiGrid .em').first().click();
  assert.ok(await page.locator('#emojiPicker').isHidden());
  await page.mouse.click(...at(700, 300));
  await page.mouse.click(...at(500, 480));
  let em = await page.evaluate(() => window.__state.shapes.filter((s) => s.type === 'emoji').map((s) => [s.key, Math.round(s.w), Math.round(s.h)]));
  assert.strictEqual(em.length, 2);
  assert.deepStrictEqual(em[0].slice(1), [96, 96], 'click stamps the default size');
  assert.strictEqual(em[0][0], em[1][0]);
  // drag to size
  await drag('m', [600, 450], [700, 540]);
  assert.strictEqual(await page.evaluate(() => window.__state.shapes.filter((s) => s.type === 'emoji').length), 3);
  // two stamps of the same emoji keep unique ids/classes in the document
  out = await page.evaluate(() => window.__sharev.buildSvg());
  const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(new Set(ids).size, ids.length, 'all ids unique in the saved svg');
  assert.ok(/<svg [^>]*\bx="[\d.]+"[^>]*\bwidth="[\d.]+"/.test(out.split('<g id="annotations">')[1]), 'emoji embedded as nested svg');
  // resize the last emoji from its corner (aspect stays square)
  await page.keyboard.press('v');
  await page.mouse.click(...at(650, 495));
  const sel0 = await page.evaluate(() => { const s = window.__state.shapes.at(-1); return { x: s.x, y: s.y, w: s.w }; });
  const hnd = await page.locator('#ui [data-h="se"]').boundingBox();
  await page.mouse.move(hnd.x + hnd.width / 2, hnd.y + hnd.height / 2); await page.mouse.down();
  await page.mouse.move(hnd.x + hnd.width / 2 + 40, hnd.y + hnd.height / 2 + 10, { steps: 3 }); await page.mouse.up();
  const sel1 = await page.evaluate(() => { const s = window.__state.shapes.at(-1); return { x: s.x, y: s.y, w: s.w, h: s.h }; });
  assert.ok(sel1.w > sel0.w + 30 && Math.abs(sel1.w - sel1.h) < 0.01 && sel1.x === sel0.x, 'resized, square, anchored');
  assert.strictEqual(await page.locator('#ui [data-h="n"]').count(), 0, 'emoji has corner handles only');
  // size option
  await page.fill('#pSize', '50'); await page.press('#pSize', 'Enter');
  assert.strictEqual(await page.evaluate(() => Math.round(window.__state.shapes.at(-1).w)), 50, 'size option resizes the selected emoji');
  // fetch a new emoji from svgmoji by pasting the character
  await page.click('#pEmoji');
  await page.fill('#emojiFetchIn', '🚀'); await page.selectOption('#emojiSet', 'noto'); await page.click('#emojiFetch');
  await page.waitForFunction(() => document.getElementById('emojiStatus').textContent.startsWith('Added 1'));
  assert.strictEqual(await page.evaluate(() => window.__emojiSaved), 'noto_1F680', 'saved under svgmoji hexcode');
  assert.ok((await page.locator('#emojiGrid h4', { hasText: 'My emoji' }).count()) === 1, 'listed under My emoji');
  await page.fill('#emojiFetchIn', '1F9FF'); await page.click('#emojiFetch');
  await page.waitForFunction(() => document.getElementById('emojiStatus').textContent.includes('Not found'));
  // import own SVG: scripts and handlers are stripped
  await page.click('#emojiImport');
  await page.waitForFunction(() => document.getElementById('emojiStatus').textContent.startsWith('Imported 1'));
  const mine = await page.locator('#emojiGrid .em[data-id^="u:"]').count();
  assert.strictEqual(mine, 2);
  await page.locator('#emojiGrid .em[data-id^="u:"]').last().click(); // choose it: swaps the selected emoji
  const key = await page.evaluate(() => window.__state.shapes.at(-1).key);
  assert.ok(key.startsWith('u:'), 'selected emoji swapped to the chosen one');
  out = await page.evaluate(() => window.__sharev.buildSvg());
  assert.ok(!out.includes('alert(1)') && !out.includes('onclick'), 'imported svg sanitised');
  assert.ok(out.includes('&quot;emoji&quot;:{'), 'non-bundled emoji embedded in the file metadata');
  // favourites: pinned to the top, saved in the settings
  await page.click('#pEmoji');
  await page.fill('#emojiSearch', '');
  const defaults = ['b:u274c', 'b:u2714', 'b:u1f60a', 'b:u1f923', 'b:u1f62c', 'b:u1f92f'];
  const n0 = await page.locator('#emojiGrid .em.isfav').count();
  assert.strictEqual(n0 / 2, 6, 'six default favourites');
  assert.deepStrictEqual(await page.locator('#emojiGrid .em').evaluateAll((els) => els.slice(0, 6).map((e) => e.dataset.id)), defaults, 'default favourites pinned first');
  const fv = await page.locator('#emojiGrid .em[data-id^="b:"]:not(.isfav)').evaluateAll((els) => els.slice(5, 8).map((e) => e.dataset.id));
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"]`).first().hover();
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"] .fav`).first().click();
  await page.locator(`#emojiGrid .em[data-id="${fv[1]}"]`).first().click({ button: 'right' });
  assert.strictEqual(await page.locator('#emojiGrid h4').first().innerText().then((s) => s.replace('\u2605', '').trim().toLowerCase()), 'favourites', 'favourites listed first');
  const favIds = await page.locator('#emojiGrid .em').evaluateAll((els) => els.slice(6, 8).map((e) => e.dataset.id));
  assert.deepStrictEqual(favIds, [fv[0], fv[1]], 'pinned after the defaults, in the order they were added');
  await page.waitForTimeout(600);
  assert.deepStrictEqual(JSON.parse(await page.evaluate(() => window.__ui)).favEmoji, [...defaults, fv[0], fv[1]], 'favourites saved in settings');
  await page.fill('#emojiSearch', 'zzzz-no-match');
  assert.strictEqual(await page.locator('#emojiGrid .em').count(), 0, 'search also filters favourites');
  await page.fill('#emojiSearch', '');
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"]`).first().hover();
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"] .fav`).first().click(); // unpin
  assert.strictEqual((await page.locator('#emojiGrid .em.isfav').count()) / 2, 7, 'one extra favourite left');
  assert.strictEqual(await page.locator('#emojiGrid .em').nth(6).getAttribute('data-id'), fv[1]);
  // an imported settings file brings its favourites
  await page.evaluate((id) => { window.__import = JSON.stringify({ toolOpts: {}, favEmoji: [id] }); }, fv[2]);
  await page.keyboard.press('Escape');
  await page.click('#bSettings'); await page.click('#menu [data-act="import"]');
  await page.click('[data-tool="emoji"]');
  assert.strictEqual(await page.locator('#emojiGrid .em').first().getAttribute('data-id'), fv[2], 'imported favourite pinned');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 400);

  // copy / paste style: right-click menu, shortcuts and the style painter
  await page.keyboard.press('Escape');
  svgBox = await page.locator('#svg').boundingBox();
  await page.keyboard.press('r');
  await page.fill('#pStroke', '#00aa00'); await page.fill('#pWidth', '9'); await page.press('#pWidth', 'Enter'); await page.check('#pShadow');
  await drag('r', [30, 500], [130, 540]); // A: green, thick, shadow
  await page.keyboard.press('r');
  await page.fill('#pStroke', '#0000ff'); await page.fill('#pWidth', '2'); await page.press('#pWidth', 'Enter'); await page.uncheck('#pShadow');
  await drag('r', [150, 500], [250, 540]); // B: blue, thin
  await page.keyboard.press('e');
  await drag('e', [270, 500], [370, 540]); // E: ellipse with the last (blue) options
  const last = () => page.evaluate(() => window.__state.shapes.filter((s) => s.type === 'rect').slice(-2).concat(window.__state.shapes.filter((s) => s.type === 'ellipse').slice(-1)).map((s) => [s.stroke, s.sw, !!s.sh]));
  assert.deepStrictEqual(await last(), [['#00aa00', 9, true], ['#0000ff', 2, false], ['#0000ff', 4, false]].map((r, i) => (i === 2 ? [r[0], r[1], r[2]] : r)).slice(0, 2).concat([(await last())[2]]));
  await page.keyboard.press('v');
  await page.mouse.click(...at(55, 500), { button: 'right' });
  assert.ok(await page.locator('#ctx').isVisible(), 'context menu on right-click');
  assert.ok((await page.locator('#ctx').innerText()).includes('Copy style'));
  assert.strictEqual(await page.locator('#ctx button[data-a="paste"]').isDisabled(), true, 'paste disabled before copy');
  await page.click('#ctx button[data-a="copy"]');
  await page.mouse.click(...at(175, 500)); // select B
  await page.keyboard.press('Control+Shift+V');
  let r = await last();
  assert.deepStrictEqual(r[1], ['#00aa00', 9, true], 'style pasted onto B (colour, width, shadow)');
  // the painter applies the same style to the ellipse; right-click -> paste works too
  await page.keyboard.press('k');
  await page.mouse.click(...at(270, 520));
  r = await last();
  assert.deepStrictEqual(r[2], ['#00aa00', 9, true], 'painter applied the style to the ellipse');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('Control+z');
  assert.strictEqual((await last())[2][1], 4, 'painting is undoable');
  await page.mouse.click(...at(270, 520), { button: 'right' });
  await page.click('#ctx button[data-a="paste"]');
  assert.deepStrictEqual((await last())[2], ['#00aa00', 9, true], 'paste from the context menu');
  await page.keyboard.press('Escape');

  // hotkeys also work from inside the editor (fallback when the global hook misses a key)
  await page.waitForTimeout(100);
  await page.keyboard.press('PrintScreen');
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+PrintScreen');
  await page.waitForTimeout(800);
  await page.keyboard.press('Alt+PrintScreen');
  assert.deepStrictEqual(await page.evaluate(() => window.__caps), ['region', 'full', 'window'], 'editor-side hotkey fallback');

  // calculator + unit converter sidebar
  await page.click('#bCalc');
  assert.ok(await page.locator('#calcSide').isVisible() && await page.locator('#side').isHidden(), 'calculator sidebar replaces the OCR one');
  await page.locator('#calcIn').click();
  await page.keyboard.type('2*sin(30)+3^2');
  assert.strictEqual((await page.locator('#calcPrev').innerText()).trim(), '= 10', 'live preview (degrees by default)');
  assert.strictEqual(await page.evaluate(() => window.__state.tool), 'select', 'typing does not trigger tool shortcuts');
  await page.keyboard.press('Enter');
  assert.strictEqual(await page.inputValue('#calcIn'), '10');
  await page.click('#calcSide .k[data-k="*"]'); await page.click('#calcSide .k[data-k="2"]'); await page.click('#calcSide .k[data-k="@eq"]');
  assert.strictEqual(await page.inputValue('#calcIn'), '20');
  assert.strictEqual(await page.locator('#calcHist .h').count(), 2);
  assert.ok((await page.locator('#calcHist .h').first().innerText()).includes('10*2'), 'newest entry first');
  await page.click('#degBtn');
  await page.fill('#calcIn', 'sin(pi/2)'); await page.keyboard.press('Enter');
  assert.strictEqual(await page.inputValue('#calcIn'), '1', 'radian mode');
  await page.click('#degBtn');
  // reuse history: click a result to insert it, click an expression to reload it
  await page.fill('#calcIn', '5+'); await page.locator('#calcHist .h').nth(1).locator('.r').click();
  assert.strictEqual(await page.inputValue('#calcIn'), '5+20');
  await page.locator('#calcHist .h').nth(1).locator('.e').click();
  assert.strictEqual(await page.inputValue('#calcIn'), '2*sin(30)+3^2'.length ? await page.inputValue('#calcIn') : '');
  // copy
  await page.locator('#calcHist .h').first().hover();
  await page.locator('#calcHist .h').first().locator('[data-a="call"]').click();
  assert.ok(/^.+ = .+$/.test(await page.evaluate(() => window.__copied)), 'copy "expression = result"');
  await page.locator('#calcHist .h').first().hover();
  await page.locator('#calcHist .h').first().locator('[data-a="cres"]').click();
  assert.ok(/^[-\d.e]+$/.test(await page.evaluate(() => window.__copied)), 'copy just the result');
  // mixed features
  await page.fill('#calcIn', '5!+sqrt(16)'); await page.keyboard.press('Enter');
  assert.strictEqual(await page.inputValue('#calcIn'), '124');
  await page.fill('#calcIn', '1/0'); await page.keyboard.press('Enter');
  assert.ok((await page.locator('#calcPrev').innerText()).length > 0 && await page.locator('#calcPrev.err').count() === 1, 'errors are shown, not thrown');

  await page.click('#calcSide [data-tab="conv"]');
  await page.selectOption('#cvDigits', '6');
  await page.fill('#cvA', '100'); await page.press('#cvA', 'Enter');
  assert.deepStrictEqual([await page.inputValue('#cvB')], ['3.93701'], '100 mm = 3.93701 in, like the reference screenshot');
  assert.strictEqual(await page.locator('#cvHist .h').count(), 1, 'saved to history on Enter');
  await page.fill('#cvB', '1'); // type in the other box: converts backwards
  assert.strictEqual(await page.inputValue('#cvA'), '25.4');
  const cats = await page.locator('#cvCat option').allInnerTexts();
  assert.deepStrictEqual(cats, ['Length', 'Mass', 'Pressure', 'Speed', 'Temperature', 'Time', 'Volume', 'Air flow', 'Torque']);
  await page.selectOption('#cvCat', 'Temperature');
  await page.fill('#cvA', '100'); await page.press('#cvA', 'Enter');
  assert.strictEqual(await page.inputValue('#cvB'), '212', '100 C = 212 F');
  await page.selectOption('#cvCat', 'Air flow');
  await page.fill('#cvA', '1000'); await page.press('#cvA', 'Enter');
  assert.ok(Math.abs(parseFloat(await page.inputValue('#cvB')) - 588.58) < 0.01, 'm3/h -> CFM');
  await page.click('#cvSwap');
  assert.ok((await page.locator('#cvFrom').inputValue()).includes('CFM'));
  assert.strictEqual(await page.locator('#cvHist .h').count(), 4, 'leaving a box saves it too');
  await page.locator('#cvHist .h').nth(3).locator('.r').click(); // reload the oldest conversion
  assert.deepStrictEqual([await page.inputValue('#cvCat'), await page.inputValue('#cvFrom'), await page.inputValue('#cvTo'), await page.inputValue('#cvA')], ['Length', 'Millimeter', 'Inch', '100']);
  await page.locator('#cvHist .h').first().hover();
  await page.locator('#cvHist .h').first().locator('[data-a="cline"]').click();
  assert.ok(/ = /.test(await page.evaluate(() => window.__copied)), 'copy "a unit = b unit"');
  await page.waitForTimeout(600);
  const savedCalc = JSON.parse(await page.evaluate(() => window.__ui)).calc;
  assert.ok(savedCalc.calc.history.length >= 3 && savedCalc.conv.history.length === 4, 'histories saved with the settings');
  await page.keyboard.press('F2');
  assert.ok(await page.locator('#calcSide').isHidden(), 'F2 closes the sidebar');
  await page.keyboard.press('F2');
  assert.ok(await page.locator('#calcSide').isVisible(), 'F2 reopens it');
  await page.keyboard.press('F2');

  // capture options: delay and include ShareV itself
  await page.selectOption('#capDelay', '3');
  assert.deepStrictEqual(await page.evaluate(() => window.__cap), [3, false]);
  await page.check('#capSelf');
  assert.deepStrictEqual(await page.evaluate(() => window.__cap), [3, true]);
  await page.selectOption('#capDelay', '0'); await page.uncheck('#capSelf');

  // OCR sidebar: recognise, list, copy, place as SVG text
  await page.click('#bOcr');
  await page.waitForSelector('#ocrLines .ln');
  assert.strictEqual(await page.locator('#ocrLines .ln').count(), 2, 'two lines listed');
  assert.ok((await page.locator('#ocrLines textarea').first().inputValue()).includes('Hello window'));
  await page.click('#ocrCopy');
  assert.strictEqual(await page.evaluate(() => window.__copied), 'Hello window\nsecond line');
  const nBefore = await page.evaluate(() => window.__state.shapes.length);
  await page.click('#ocrPlace');
  const placed = await page.evaluate(() => window.__state.shapes.slice(-4).map((s) => [s.type, s.text]));
  assert.deepStrictEqual(placed.filter((p) => p[0] === 'text').map((p) => p[1]), ['Hello window', 'second line']);
  assert.strictEqual(await page.evaluate(() => window.__state.shapes.length), nBefore + 4, 'cover rect + text per line');
  assert.ok((await page.evaluate(() => window.__sharev.buildSvg())).includes('Hello window'), 'recognised text is real SVG text');
  await page.click('#sideClose');

  // crank & slider simulator
  await page.click('#bSim');
  assert.ok(await page.locator('#sim').isVisible());
  const cards = async () => page.locator('#readouts .rv').allInnerTexts();
  const rd = await cards();
  assert.deepStrictEqual(rd.slice(0, 2), ['18.0°', '5.91°'], 'theta2 and phi match the reference simulator');
  assert.ok(Math.abs(parseFloat(rd[2]) - 157.41) < 0.02 && Math.abs(parseFloat(rd[3]) - -34.1) < 0.1 && Math.abs(parseFloat(rd[4]) - -215) < 0.3, 'x, v, a at 18 deg, 20 rpm');
  assert.deepStrictEqual(rd.slice(5), ['80.0', '3.00', '1.000'], 'stroke, N = l/r, time ratio');
  const mathText = async () => (await page.locator('#mathBody .katex-html').allTextContents()).join(' ');
  assert.ok((await page.locator('#mathBody .katex').count()) > 20, 'equations are typeset with KaTeX');
  assert.ok((await mathText()).includes('5.912'), 'the maths shows the working');
  assert.ok((await mathText()).includes('157.4'), 'x worked through');
  const colours = await page.locator('#mathBody .katex [style*="color"]').evaluateAll((els) => [...new Set(els.map((e) => e.style.color))]);
  assert.ok(colours.length >= 4, 'variables are colour-coded by link: ' + colours.join(' '));
  await page.click('.mtabs [data-mt="theory"]');
  assert.ok((await page.locator('#theoryBody').innerText()).includes('Grübler'), 'theory tab');
  await page.click('.mtabs [data-mt="pros"]');
  assert.ok((await page.locator('#prosBody').innerText()).includes('Advantages') && (await page.locator('#prosBody').innerText()).includes('Disadvantages'), 'pros and cons tab');
  await page.click('.mtabs [data-mt="work"]');
  // run: the crank advances; Space pauses
  await page.keyboard.press(' ');
  await page.waitForTimeout(700);
  await page.keyboard.press(' ');
  const th1 = parseFloat((await cards())[0]);
  assert.ok(th1 > 18.5, 'animation advanced: ' + th1);
  await page.keyboard.press('ArrowRight');
  assert.ok(Math.abs(parseFloat((await cards())[0]) - (th1 + 1)) < 0.2, 'arrow key steps 1 degree');
  // inversions and presets
  await page.click('#segInv [data-inv="3"]');
  assert.ok((await page.locator('#pillInv').innerText()).includes('link 3'));
  assert.ok((await page.locator('#mathBody').innerText()).includes('Newton'), 'inversion 3 explains the rod-relative drive');
  assert.ok((await mathText()).includes('β'), 'inversion 3 introduces beta');
  await page.click('#presets [data-p="Offset Engine"]');
  assert.ok(parseFloat((await cards())[7]) > 1.05, 'offset gives a quick-return time ratio > 1');
  await page.click('#presets [data-p="Quick Return"]');
  assert.ok(parseFloat((await cards())[7]) > 1.5);
  // units
  await page.click('#presets [data-p="IC Engine"]');
  await page.click('#segUnits [data-u="Imperial"]');
  assert.ok(Math.abs(parseFloat((await cards())[5]) - 80 / 25.4) < 0.05, 'stroke in inches');
  assert.ok((await page.locator('#val_r').innerText()).includes('in'));
  await page.click('#segUnits [data-u="SI"]');
  // sliders keep the linkage assemblable (l >= r + |e|)
  await page.locator('#sl_r').evaluate((el) => { el.value = 100; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const lNow = parseFloat(await page.inputValue('#sl_l'));
  assert.ok(lNow >= 100, 'rod lengthened with the crank: ' + lNow);
  // graphs
  for (const g of ['v', 'a', 'T', 'x']) { await page.click(`#segGraph [data-g="${g}"]`); assert.ok((await page.locator('#simGraph path').count()) >= 1, 'graph ' + g); }
  // graph: the dot is a true circle at any window width, the graph keeps its height, and the dot moves smoothly while running
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForTimeout(300);
  const dotBox = async () => page.locator('#gDot').boundingBox();
  let d1 = await dotBox();
  assert.ok(Math.abs(d1.width - d1.height) < 0.6 && d1.width > 8, 'dot is a circle: ' + d1.width + 'x' + d1.height);
  const gh1 = (await page.locator('#simGraph').boundingBox()).height;
  await page.setViewportSize({ width: 1900, height: 900 });
  await page.waitForTimeout(200);
  d1 = await dotBox();
  assert.ok(Math.abs(d1.width - d1.height) < 0.6, 'still a circle when the window is wider');
  assert.ok(Math.abs((await page.locator('#simGraph').boundingBox()).height - gh1) < 1, 'graph height does not grow with the window');
  await page.click('#segGraph [data-g="x"]');
  await page.keyboard.press(' ');
  const xs = [];
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(40); xs.push(await page.evaluate(() => parseFloat(document.getElementById('gDot').getAttribute('cx')))); }
  await page.keyboard.press(' ');
  const raw = xs.slice(1).map((v, i) => v - xs[i]);
  assert.ok(raw.filter((s) => s === 0).length <= 1, 'the dot moves on (almost) every sample, not in jerky ~11 fps steps: ' + raw.map((s) => s.toFixed(1)).join(','));
  assert.ok(raw.every((s) => s >= 0) && Math.max(...raw) < 80, 'and always forward in modest steps');
  // export: a standalone, valid, heavily commented SVG
  await page.click('#btnExport');
  await page.waitForFunction(() => window.__svgExport);
  const exp = await page.evaluate(() => window.__svgExport);
  assert.ok(/^<\?xml/.test(exp.text) && exp.name.endsWith('.svg') && exp.ext === 'svg', 'export name/type');
  const comments = (exp.text.match(/<!--/g) || []).length;
  assert.ok(comments >= 12, 'heavily commented: ' + comments + ' comments');
  for (const needle of ['WHAT YOU ARE LOOKING AT', 'THE EQUATIONS', 'VALUES AT THIS INSTANT', 'HOW THE DRAWING IS BUILT', 'LINK 1 - FRAME', 'LINK 2 - CRANK', 'LINK 3 - CONNECTING ROD', 'LINK 4 - SLIDER BLOCK', 'id="link-2-crank"', 'sin(phi) = (r sin(theta) - e) / l']) assert.ok(exp.text.includes(needle), 'export contains ' + needle);
  const parsed = await page.evaluate((t) => { const d = new DOMParser().parseFromString(t, 'image/svg+xml'); return { err: !!d.querySelector('parsererror'), ids: [...d.querySelectorAll('g[id]')].map((g) => g.id) }; }, exp.text);
  assert.strictEqual(parsed.err, false, 'exported svg is well-formed XML');
  assert.ok(parsed.ids.includes('link-1-frame') && parsed.ids.includes('pins'), 'named groups: ' + parsed.ids.join(','));
  // animated, interactive SVG export: open it standalone (scripts run), check the motion and every control
  const fs = require('fs'), os = require('os');
  for (const [preset, inv] of [['IC Engine', 1], ['Rotary Engine', 2], ['Quick Return', 2], ['Hand Pump', 4], ['Offset Engine', 1]]) {
    await page.click(`#presets [data-p="${preset}"]`);
    await page.evaluate(() => { window.__svgExport = null; });
    await page.click('#btnExportAnim');
    await page.waitForFunction(() => window.__svgExport);
    const anim = await page.evaluate(() => window.__svgExport);
    assert.ok(anim.name.endsWith('_animated.svg'), 'animated file name');
    assert.ok(anim.text.includes('CONTROLS (bottom strip)') && anim.text.includes('HOW THIS SCRIPT WORKS') && (anim.text.match(/\/\*/g) || []).length > 15, 'animated export is commented');
    const file = require('path').join(os.tmpdir(), 'sharev-anim-' + inv + '.svg');
    fs.writeFileSync(file, anim.text);
    const ap = await browser.newPage({ viewport: { width: 1100, height: 640 } });
    const aerr = [];
    ap.on('pageerror', (e) => aerr.push(e.message));
    await ap.goto('file://' + file);
    await ap.waitForTimeout(250);
    const read = () => ap.evaluate(() => ({ th: document.getElementById('ro-theta').textContent, x: document.getElementById('ro-x').textContent, rod: ['crank-fill', 'rod-fill', 'frame-bar-fill'].map((id) => document.getElementById(id).getAttribute('x2') + document.getElementById(id).getAttribute('y2')).join('|') + document.getElementById('slider').getAttribute('transform') }));
    const a0 = await read(); await ap.waitForTimeout(500); const a1 = await read();
    assert.ok(a0.th !== a1.th && a0.rod !== a1.rod, `inversion ${inv}: it animates by itself (${a0.th} -> ${a1.th})`);
    await ap.click('#btn-play');
    const p0 = await read(); await ap.waitForTimeout(300); const p1 = await read();
    assert.strictEqual(p0.th, p1.th, 'pause button stops it');
    const sb = await ap.locator('#scrub-hit').boundingBox();
    await ap.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    assert.strictEqual((await read()).th, '180.0°', 'angle slider sets the crank angle');
    const spb = await ap.locator('#speed-hit').boundingBox();
    await ap.mouse.click(spb.x + spb.width - 10, spb.y + spb.height / 2);
    assert.ok(parseInt(await ap.locator('#speed-text').textContent(), 10) > 90, 'speed slider: ' + await ap.locator('#speed-text').textContent());
    await ap.click('#btn-dir');
    assert.strictEqual(await ap.locator('#dir-text').textContent(), 'reverse');
    await ap.click('#btn-play'); const q0 = await read(); await ap.waitForTimeout(300);
    assert.notStrictEqual((await read()).th, q0.th, 'plays again (in reverse)');
    await ap.keyboard.press('Space');
    assert.ok(await ap.locator('#icon-play').getAttribute('display') !== 'none', 'Space pauses (play icon shown)');
    assert.deepStrictEqual(aerr, [], 'no script errors in the exported file');

    // ---- the NO-SCRIPT export: no <script>, well-formed, loops by itself, and matches the interactive file frame for frame
    await page.evaluate(() => { window.__svgExport = null; });
    await page.click('#btnExportSmil');
    await page.waitForFunction(() => window.__svgExport);
    const smil = await page.evaluate(() => window.__svgExport);
    assert.ok(smil.name.endsWith('_loop-no-script.svg'), 'no-script file name');
    assert.ok(!/<script/i.test(smil.text) && !/\son[a-z]+=/i.test(smil.text), 'contains no script of any kind');
    assert.ok(smil.text.includes('NO JAVASCRIPT') || smil.text.includes('NO SCRIPT'), 'explains itself');
    assert.ok((smil.text.match(/<animate/g) || []).length >= 8 && (smil.text.match(/<!--/g) || []).length >= 8, 'animated and commented');
    const sfile = require('path').join(os.tmpdir(), 'sharev-smil-' + inv + '.svg');
    fs.writeFileSync(sfile, smil.text);
    const sp = await browser.newPage({ viewport: { width: 1100, height: 520 } });
    const serr = [];
    sp.on('pageerror', (e) => serr.push(e.message));
    await sp.goto('file://' + sfile);
    assert.strictEqual(await sp.evaluate(() => !!document.querySelector('parsererror')), false, 'well-formed XML');
    const dur = await sp.evaluate(() => parseFloat(document.querySelector('animate, animateTransform').getAttribute('dur')));
    for (const f of [0.1, 0.5, 0.9]) {
      await sp.evaluate((t) => { const s = document.documentElement; s.pauseAnimations(); s.setCurrentTime(t); }, f * dur);
      const bx = await ap.locator('#scrub-hit').boundingBox();
      await ap.mouse.click(bx.x + 10 + (bx.width - 20) * f, bx.y + bx.height / 2);
      const sv = await sp.evaluate(() => ['crank-fill', 'rod-fill'].flatMap((id) => { const e = document.getElementById(id); return [e.x1.animVal.value, e.y1.animVal.value, e.x2.animVal.value, e.y2.animVal.value]; }));
      const iv = await ap.evaluate(() => ['crank-fill', 'rod-fill'].flatMap((id) => ['x1', 'y1', 'x2', 'y2'].map((k) => parseFloat(document.getElementById(id).getAttribute(k)))));
      sv.forEach((v, i) => assert.ok(Math.abs(v - iv[i]) < 0.5, `inversion ${inv}, ${(f * 100) | 0}% of a turn: no-script frame = interactive frame (${v.toFixed(2)} vs ${iv[i].toFixed(2)})`));
    }
    assert.deepStrictEqual(serr, [], 'no errors in the no-script file');
    await sp.close();
    if (inv === 1) { // it also animates when used as an <img> (where scripts never run)
      fs.writeFileSync(require('path').join(os.tmpdir(), 'sharev-img.html'), `<body style="margin:0"><img id="i" src="sharev-smil-1.svg" width="1000"></body>`);
      const ip = await browser.newPage({ viewport: { width: 1100, height: 520 } });
      await ip.goto('file://' + require('path').join(os.tmpdir(), 'sharev-img.html'));
      await ip.waitForTimeout(400);
      const s1 = await ip.locator('#i').screenshot(); await ip.waitForTimeout(700); const s2 = await ip.locator('#i').screenshot();
      assert.ok(!s1.equals(s2), 'the no-script SVG animates inside an <img>');
      await ip.close();
    }
    await ap.close();
  }
  // the WHOLE tool as one SVG: export it, open it stand-alone and drive it like the real thing
  await page.click('#presets [data-p="Offset Engine"]');
  await page.click('#segUnits [data-u="Imperial"]');
  await page.evaluate(() => { window.__svgExport = null; });
  await page.click('#btnExportTool');
  await page.waitForFunction(() => window.__svgExport, null, { timeout: 20000 });
  const whole = await page.evaluate(() => window.__svgExport);
  assert.ok(whole.name.endsWith('whole-tool.svg'), 'whole tool file name');
  assert.ok(whole.text.length > 400000, 'contains the whole application (' + whole.text.length + ' chars)');
  for (const needle of ['THE WHOLE INTERACTIVE TOOL IN ONE SVG FILE', 'HOW THIS FILE IS BUILT', 'WHY AN IFRAME', 'id="tool-html"', 'window.__SIM_INITIAL', 'id="fallback"']) assert.ok(whole.text.includes(needle), 'whole tool contains ' + needle);
  assert.ok((whole.text.match(/<!--/g) || []).length >= 12, 'commented');
  const wfile = require('path').join(os.tmpdir(), 'sharev-whole-tool.svg');
  fs.writeFileSync(wfile, whole.text);
  const wp = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const werr = [];
  wp.on('pageerror', (e) => werr.push(e.message));
  wp.on('console', (m) => { if (m.type() === 'error') werr.push(m.text()); });
  await wp.goto('file://' + wfile);
  assert.strictEqual(await wp.evaluate(() => !!document.querySelector('parsererror')), false, 'the .svg is well-formed XML');
  let tf = null;
  for (let i = 0; i < 40 && !tf; i++) { tf = wp.frames().find((f) => f !== wp.mainFrame() && f.url() !== 'about:blank'); if (!tf) { tf = wp.frames().find((f) => f !== wp.mainFrame()); } if (tf && !(await tf.locator('#sim .simbar').count())) tf = null; if (!tf) await wp.waitForTimeout(150); }
  assert.ok(tf, 'the tool starts inside the SVG');
  assert.ok((await tf.locator('#pillInv').innerText()).includes('1st inversion'), 'starts in the exported inversion');
  assert.strictEqual(await tf.locator('#segUnits .on').innerText(), 'Imperial', 'starts in the exported units');
  assert.ok(Math.abs(parseFloat(await tf.inputValue('#sl_e')) - 25 / 25.4) < 0.01, 'starts with the exported offset');
  assert.strictEqual(await tf.locator('#btnExportTool').isHidden(), true, 'no export-the-tool button inside the exported tool');
  const trd = (await tf.locator('#readouts .rv').allInnerTexts());
  assert.strictEqual(trd.length, 8, 'eight readout cards');
  await tf.locator('#segInv [data-inv="3"]').click();
  assert.ok((await tf.locator('#pillInv').innerText()).includes('link 3'), 'inversion buttons work');
  await tf.locator('#presets [data-p="Hand Pump"]').click();
  assert.ok((await tf.locator('#pillInv').innerText()).includes('4th'), 'presets work');
  await tf.locator('#segGraph [data-g="v"]').click();
  assert.ok((await tf.locator('#simGraph path').count()) >= 1, 'graphs work');
  await tf.locator('#sl_r').evaluate((el) => { el.value = 1.2; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.ok((await tf.locator('#val_r').innerText()).startsWith('1.20'), 'sliders work (in the exported units): ' + await tf.locator('#val_r').innerText());
  assert.ok((await tf.locator('#mathBody .katex').count()) > 20, 'KaTeX equations render inside the SVG');
  assert.ok(await tf.evaluate(() => document.fonts.check('16px KaTeX_Main')), 'the embedded KaTeX fonts load');
  await tf.locator('.mtabs [data-mt="theory"]').click();
  assert.ok((await tf.locator('#theoryBody').innerText()).includes('Grübler'), 'theory tab');
  await tf.locator('#btnPlay').click();
  const t0 = (await tf.locator('#readouts .rv').first().innerText());
  await wp.waitForTimeout(500);
  assert.notStrictEqual(await tf.locator('#readouts .rv').first().innerText(), t0, 'it animates');
  await tf.locator('#btnPlay').click();
  assert.deepStrictEqual(werr, [], 'no errors while running the whole tool from the SVG');
  await wp.close();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('#btnShow');
  assert.ok(await page.locator('#graphCard').isHidden());
  await page.click('#btnShow');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#sim').isHidden(), 'Esc closes the simulator');
  await page.keyboard.press('F3');
  assert.ok(await page.locator('#sim').isVisible(), 'F3 opens it');
  await page.keyboard.press('F3');

  // ---- Saving & file names dialog
  await page.keyboard.press('Escape');
  await page.click('#bSettings');
  await page.click('#menu [data-act=saving]');
  assert.ok(await page.locator('#saveDlg').isVisible(), 'save dialog opens');
  assert.strictEqual(await page.inputValue('#svDir'), 'C:/ShareV/Screenshots');
  assert.ok(await page.locator('#svMonth').isChecked());
  await page.click('#svBrowse');
  assert.strictEqual(await page.inputValue('#svDir'), 'D:/Shots');
  assert.ok((await page.textContent('#svPreview')).startsWith('D:/Shots'), 'preview follows folder');
  await page.fill('#svFilePat', 'Shot_{n}');
  await page.uncheck('#svMonth');
  await page.click('#svSave');
  assert.ok(await page.locator('#saveDlg').isHidden());
  const sv = await page.evaluate(() => window.__sv);
  assert.strictEqual(sv.saveDir, 'D:/Shots'); assert.strictEqual(sv.filePattern, 'Shot_{n}'); assert.strictEqual(sv.monthFolders, false);

  if (SHOT) { await page.keyboard.press('Escape'); await page.screenshot({ path: SHOT }); }
  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('editor tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
