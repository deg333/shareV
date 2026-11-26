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
      loadUi: async () => null, saveUi: async (j) => { window.__ui = j; }, exportUi: async (j) => { window.__export = j; return 'x.json'; }, importUi: async () => window.__import || null,
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
  const fv = await page.locator('#emojiGrid .em[data-id^="b:"]').evaluateAll((els) => els.slice(5, 8).map((e) => e.dataset.id));
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"]`).first().hover();
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"] .fav`).first().click();
  await page.locator(`#emojiGrid .em[data-id="${fv[1]}"]`).first().click({ button: 'right' });
  assert.strictEqual(await page.locator('#emojiGrid h4').first().innerText().then((s) => s.replace('\u2605', '').trim().toLowerCase()), 'favourites', 'favourites listed first');
  const favIds = await page.locator('#emojiGrid .em').evaluateAll((els) => els.slice(0, 2).map((e) => e.dataset.id));
  assert.deepStrictEqual(favIds, [fv[0], fv[1]], 'pinned in the order they were added');
  await page.waitForTimeout(600);
  assert.deepStrictEqual(JSON.parse(await page.evaluate(() => window.__ui)).favEmoji, [fv[0], fv[1]], 'favourites saved in settings');
  await page.fill('#emojiSearch', 'zzzz-no-match');
  assert.strictEqual(await page.locator('#emojiGrid .em').count(), 0, 'search also filters favourites');
  await page.fill('#emojiSearch', '');
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"]`).first().hover();
  await page.locator(`#emojiGrid .em[data-id="${fv[0]}"] .fav`).first().click(); // unpin
  assert.strictEqual(await page.locator('#emojiGrid .em.isfav').count(), 2, 'one favourite left (shown in Favourites and in its own group)');
  assert.strictEqual(await page.locator('#emojiGrid .em').first().getAttribute('data-id'), fv[1]);
  // an imported settings file brings its favourites
  await page.evaluate((id) => { window.__import = JSON.stringify({ toolOpts: {}, favEmoji: [id] }); }, fv[2]);
  await page.keyboard.press('Escape');
  await page.click('#bSettings'); await page.click('#menu [data-act="import"]');
  await page.click('[data-tool="emoji"]');
  assert.strictEqual(await page.locator('#emojiGrid .em').first().getAttribute('data-id'), fv[2], 'imported favourite pinned');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 400);

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

  if (SHOT) { await page.keyboard.press('Escape'); await page.screenshot({ path: SHOT }); }
  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('editor tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
