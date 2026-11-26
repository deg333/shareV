'use strict';
/* Sidebar: scientific calculator + unit converter, each with a reusable history. UI only - maths lives in calc-core.js. */
(() => {
  const C = window.CalcCore;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const KEY = 'sharev.calc';
  const MAX_HISTORY = 150;

  // ------------------------------------------------------------------ state (saved with the other settings)
  const st = {
    calc: { deg: true, memory: 0, history: [] },           // history: {expr, res, raw}
    conv: { cat: 'Length', from: 'Millimeter', to: 'Inch', val: '100', digits: 8, history: [] }, // history: {cat, from, to, a, b}
    tab: 'calc',
  };
  function loadLocal() { try { setState(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { /* ignore */ } }
  function getState() { return { calc: st.calc, conv: st.conv, tab: st.tab }; }
  function setState(o) {
    if (!o || typeof o !== 'object') return;
    const keep = (arr, ok) => (Array.isArray(arr) ? arr.filter(ok).slice(0, MAX_HISTORY) : []);
    if (o.calc) {
      st.calc.deg = o.calc.deg !== false;
      st.calc.memory = Number.isFinite(o.calc.memory) ? o.calc.memory : 0;
      st.calc.history = keep(o.calc.history, (h) => h && typeof h.expr === 'string' && typeof h.res === 'string');
    }
    if (o.conv) {
      const c = C.CATEGORIES[o.conv.cat] ? o.conv.cat : 'Length';
      st.conv.cat = c;
      const units = C.CATEGORIES[c].units;
      st.conv.from = units[o.conv.from] ? o.conv.from : C.DEFAULT_UNITS[c][0];
      st.conv.to = units[o.conv.to] ? o.conv.to : C.DEFAULT_UNITS[c][1];
      st.conv.val = typeof o.conv.val === 'string' ? o.conv.val : '1';
      st.conv.digits = [4, 6, 8, 10, 12].includes(o.conv.digits) ? o.conv.digits : 8;
      st.conv.history = keep(o.conv.history, (h) => h && C.CATEGORIES[h.cat] && typeof h.a === 'string' && typeof h.b === 'string');
    }
    if (o.tab === 'calc' || o.tab === 'conv') st.tab = o.tab;
    if (built) { syncCalc(); syncConv(); showTab(st.tab); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(getState())); } catch { /* ignore */ }
    if (window.__persist) window.__persist();
  }
  const copy = (text, what) => Promise.resolve(window.__copyText ? window.__copyText(text) : navigator.clipboard.writeText(text))
    .then(() => window.__flash && window.__flash(`${what} copied`)).catch(() => window.__flash && window.__flash('Could not copy'));

  // ------------------------------------------------------------------ build the panel
  let built = false;
  const panel = $('calcSide');
  const KEYS = [ // label, text to insert (or action), css class
    ['Deg', '@deg', 'fn'], ['(', '(', 'fn'], [')', ')', 'fn'], ['x²', '^2', 'fn'], ['xʸ', '^', 'fn'],
    ['sin', 'sin(', 'fn'], ['cos', 'cos(', 'fn'], ['tan', 'tan(', 'fn'], ['ln', 'ln(', 'fn'], ['log', 'log(', 'fn'],
    ['asin', 'asin(', 'fn'], ['acos', 'acos(', 'fn'], ['atan', 'atan(', 'fn'], ['√', 'sqrt(', 'fn'], ['n!', '!', 'fn'],
    ['π', 'pi', 'fn'], ['e', 'e', 'fn'], ['1/x', '^(-1)', 'fn'], ['%', '%', 'fn'], ['Ans', 'ans', 'fn'],
    ['7', '7', 'num'], ['8', '8', 'num'], ['9', '9', 'num'], ['÷', '/', 'op'], ['⌫', '@back', 'op'],
    ['4', '4', 'num'], ['5', '5', 'num'], ['6', '6', 'num'], ['×', '*', 'op'], ['AC', '@ac', 'op'],
    ['1', '1', 'num'], ['2', '2', 'num'], ['3', '3', 'num'], ['−', '-', 'op'], ['EXP', 'e', 'fn'],
    ['0', '0', 'num'], ['.', '.', 'num'], [',', ',', 'num'], ['+', '+', 'op'], ['=', '@eq', 'eq'],
  ];
  function build() {
    if (built) return;
    built = true;
    panel.innerHTML = `
      <div class="sidehead"><div class="tabs"><button data-tab="calc">Calculator</button><button data-tab="conv">Convert</button></div>
        <button id="calcClose" title="Close (F2)">&times;</button></div>

      <section id="viewCalc">
        <input id="calcIn" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="e.g. 2*sin(30)+3^2">
        <div class="preview"><span id="calcPrev"></span><button id="calcCopyNow" title="Copy the current result">&#10064;</button></div>
        <div class="memrow"><button data-m="mc" title="Memory clear">MC</button><button data-m="mr" title="Insert memory value (mem)">MR</button>
          <button data-m="m+" title="Add the current result to memory">M+</button><button data-m="m-" title="Subtract the current result from memory">M&minus;</button>
          <span id="memInd"></span></div>
        <div class="keys">${KEYS.map(([l, v, c]) => `<button class="k ${c}" data-k="${esc(v)}"${v === '@deg' ? ' id="degBtn"' : ''}>${esc(l)}</button>`).join('')}</div>
        <div class="histhead"><span>History</span><span class="hint">click a result to insert it &middot; click an expression to reload it</span><button id="calcClear">Clear</button></div>
        <div id="calcHist" class="hist"></div>
      </section>

      <section id="viewConv" hidden>
        <select id="cvCat"></select>
        <div class="cvrow">
          <div class="cvcol"><div class="cvin"><input id="cvA" type="text" inputmode="decimal" autocomplete="off"><button class="cp" data-cp="a" title="Copy value">&#10064;</button></div><select id="cvFrom"></select></div>
          <div class="eq"><div>=</div><button id="cvSwap" title="Swap units">&#8646;</button></div>
          <div class="cvcol"><div class="cvin"><input id="cvB" type="text" inputmode="decimal" autocomplete="off"><button class="cp" data-cp="b" title="Copy value">&#10064;</button></div><select id="cvTo"></select></div>
        </div>
        <div class="cvtools"><button id="cvSave" title="Add this conversion to the history (also on Enter)">&#9733; Save to history</button>
          <button id="cvCopyLine" title="Copy e.g. &quot;100 mm = 3.937 in&quot;">Copy &quot;a = b&quot;</button>
          <label>digits <select id="cvDigits">${[4, 6, 8, 10, 12].map((d) => `<option value="${d}">${d}</option>`).join('')}</select></label></div>
        <div class="histhead"><span>History</span><span class="hint">click an entry to reload it</span><button id="cvClear">Clear</button></div>
        <div id="cvHist" class="hist"></div>
      </section>`;
    wireCalc();
    wireConv();
    syncCalc();
    syncConv();
    showTab(st.tab);
  }

  function showTab(t) {
    st.tab = t;
    $('viewCalc').hidden = t !== 'calc';
    $('viewConv').hidden = t !== 'conv';
    panel.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  }

  // ------------------------------------------------------------------ calculator
  let ansRaw = 0;
  function histList(el, items, render) {
    el.innerHTML = items.length ? items.map(render).join('') : '<div class="empty">Nothing here yet.</div>';
  }
  function syncCalc() {
    $('degBtn').textContent = st.calc.deg ? 'Deg' : 'Rad';
    $('memInd').textContent = st.calc.memory ? `M = ${C.fmt(st.calc.memory)}` : '';
    histList($('calcHist'), st.calc.history, (h, i) =>
      `<div class="h" data-i="${i}"><div class="e" data-a="expr" title="Reload this expression">${esc(h.expr)}</div>
        <div class="r" data-a="res" title="Insert this result">= ${esc(h.res)}</div>
        <div class="b"><button data-a="cres" title="Copy result">&#10064;</button><button data-a="call" title="Copy &quot;expression = result&quot;">&#10064;=</button><button data-a="del" title="Delete">&times;</button></div></div>`);
    refreshPreview();
  }
  function tryEval(src) { return C.evaluate(src, { deg: st.calc.deg, ans: ansRaw, mem: st.calc.memory }); }
  function refreshPreview() {
    const src = $('calcIn').value.trim(), prev = $('calcPrev');
    prev.classList.remove('err');
    if (!src) { prev.textContent = ''; return; }
    try { prev.textContent = '= ' + C.fmt(tryEval(src)); } catch (e) { prev.textContent = ''; }
  }
  function commit() {
    const src = $('calcIn').value.trim();
    if (!src) return;
    try {
      const raw = tryEval(src), res = C.fmt(raw);
      ansRaw = raw;
      if (!st.calc.history.length || st.calc.history[0].expr !== src || st.calc.history[0].res !== res) {
        st.calc.history.unshift({ expr: src, res, raw });
        st.calc.history.length = Math.min(st.calc.history.length, MAX_HISTORY);
      }
      $('calcIn').value = res;
      save(); syncCalc();
    } catch (e) {
      const prev = $('calcPrev');
      prev.textContent = e.message; prev.classList.add('err');
    }
  }
  function insert(text) {
    const inp = $('calcIn'), a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a;
    inp.value = inp.value.slice(0, a) + text + inp.value.slice(b);
    const p = a + text.length;
    inp.setSelectionRange(p, p);
    inp.focus();
    refreshPreview();
  }
  function wireCalc() {
    const inp = $('calcIn');
    inp.addEventListener('input', refreshPreview);
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { inp.value = ''; refreshPreview(); }
    });
    panel.querySelector('.keys').addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret in the input
    panel.querySelector('.keys').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = b.dataset.k;
      if (k === '@deg') { st.calc.deg = !st.calc.deg; save(); syncCalc(); }
      else if (k === '@back') {
        const a = inp.selectionStart, z = inp.selectionEnd;
        if (a !== z) inp.setRangeText('', a, z, 'end'); else if (a > 0) inp.setRangeText('', a - 1, a, 'end');
        inp.focus(); refreshPreview();
      } else if (k === '@ac') { inp.value = ''; inp.focus(); refreshPreview(); }
      else if (k === '@eq') commit();
      else insert(k);
    });
    panel.querySelector('.memrow').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      let v = null;
      if (m !== 'mc' && m !== 'mr') { try { v = tryEval($('calcIn').value.trim() || '0'); } catch { return; } }
      if (m === 'mc') st.calc.memory = 0;
      else if (m === 'mr') { insert('mem'); return; }
      else if (m === 'm+') st.calc.memory += v;
      else st.calc.memory -= v;
      save(); syncCalc();
    });
    $('calcCopyNow').onclick = () => {
      const t = $('calcPrev').textContent.replace(/^=\s*/, '') || $('calcIn').value;
      if (t) copy(t, 'Result');
    };
    $('calcClear').onclick = () => { st.calc.history = []; save(); syncCalc(); };
    $('calcHist').addEventListener('click', (e) => {
      const row = e.target.closest('.h');
      const a = e.target.closest('[data-a]');
      if (!row || !a) return;
      const h = st.calc.history[+row.dataset.i];
      switch (a.dataset.a) {
        case 'expr': inp.value = h.expr; inp.focus(); refreshPreview(); break;
        case 'res': insert(h.res); break;
        case 'cres': copy(h.res, 'Result'); break;
        case 'call': copy(`${h.expr} = ${h.res}`, 'Calculation'); break;
        case 'del': st.calc.history.splice(+row.dataset.i, 1); save(); syncCalc(); break;
      }
    });
  }

  // ------------------------------------------------------------------ converter
  let lastSide = 'a';
  const cv = () => C.CATEGORIES[st.conv.cat];
  const num = (s) => {
    const t = String(s).trim().replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '');
    if (t === '' || t === '-' || t === '.') return NaN;
    try { return C.evaluate(t); } catch { return NaN; }
  };
  const fillUnits = (sel, current) => {
    sel.innerHTML = Object.keys(cv().units).map((u) => `<option value="${esc(u)}"${u === current ? ' selected' : ''}>${esc(u)}</option>`).join('');
  };
  function syncConv() {
    const catSel = $('cvCat');
    catSel.innerHTML = Object.keys(C.CATEGORIES).map((c) => `<option${c === st.conv.cat ? ' selected' : ''}>${esc(c)}</option>`).join('');
    fillUnits($('cvFrom'), st.conv.from);
    fillUnits($('cvTo'), st.conv.to);
    $('cvDigits').value = String(st.conv.digits);
    $('cvA').value = st.conv.val;
    lastSide = 'a';
    recompute();
    renderConvHist();
  }
  function recompute() {
    const { cat, from, to, digits } = st.conv;
    const A = $('cvA'), B = $('cvB');
    try {
      if (lastSide === 'a') {
        const v = num(A.value);
        B.value = Number.isNaN(v) ? '' : C.fmt(C.convert(v, cat, from, to), digits);
        st.conv.val = A.value;
      } else {
        const v = num(B.value);
        A.value = Number.isNaN(v) ? '' : C.fmt(C.convert(v, cat, to, from), digits);
        st.conv.val = A.value;
      }
    } catch { /* unknown unit while switching categories */ }
  }
  const convLine = (h) => `${h.a} ${C.symbol(h.cat, h.from)} = ${h.b} ${C.symbol(h.cat, h.to)}`;
  function renderConvHist() {
    histList($('cvHist'), st.conv.history, (h, i) =>
      `<div class="h cvh" data-i="${i}"><div class="e" data-a="load" title="Reload this conversion"><span class="tag">${esc(h.cat)}</span> ${esc(h.a)} ${esc(h.from)}</div>
        <div class="r" data-a="load" title="Reload this conversion">= ${esc(h.b)} ${esc(h.to)}</div>
        <div class="b"><button data-a="cb" title="Copy the result value">&#10064;</button><button data-a="cline" title="Copy &quot;${esc(convLine(h))}&quot;">&#10064;=</button><button data-a="del" title="Delete">&times;</button></div></div>`);
  }
  function saveConv() {
    const { cat, from, to } = st.conv;
    const a = $('cvA').value.trim(), b = $('cvB').value.trim();
    if (!a || !b || Number.isNaN(num(a))) return;
    const top = st.conv.history[0];
    if (!(top && top.cat === cat && top.from === from && top.to === to && top.a === a && top.b === b)) {
      st.conv.history.unshift({ cat, from, to, a, b });
      st.conv.history.length = Math.min(st.conv.history.length, MAX_HISTORY);
    }
    save(); renderConvHist();
  }
  function wireConv() {
    const A = $('cvA'), B = $('cvB');
    $('cvCat').addEventListener('change', (e) => {
      st.conv.cat = e.target.value;
      [st.conv.from, st.conv.to] = C.DEFAULT_UNITS[st.conv.cat];
      fillUnits($('cvFrom'), st.conv.from); fillUnits($('cvTo'), st.conv.to);
      lastSide = 'a'; recompute(); save();
    });
    $('cvFrom').addEventListener('change', (e) => { st.conv.from = e.target.value; recompute(); save(); });
    $('cvTo').addEventListener('change', (e) => { st.conv.to = e.target.value; recompute(); save(); });
    $('cvDigits').addEventListener('change', (e) => { st.conv.digits = +e.target.value; recompute(); save(); });
    for (const [inp, side] of [[A, 'a'], [B, 'b']]) {
      inp.addEventListener('input', () => { lastSide = side; recompute(); });
      inp.addEventListener('change', () => { saveConv(); });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); lastSide = side; recompute(); saveConv(); inp.select(); } });
      inp.addEventListener('focus', () => inp.select());
    }
    $('cvSwap').onclick = () => {
      [st.conv.from, st.conv.to] = [st.conv.to, st.conv.from];
      fillUnits($('cvFrom'), st.conv.from); fillUnits($('cvTo'), st.conv.to);
      lastSide = 'a'; recompute(); save();
    };
    $('cvSave').onclick = saveConv;
    $('cvCopyLine').onclick = () => {
      const h = { cat: st.conv.cat, from: st.conv.from, to: st.conv.to, a: A.value.trim(), b: B.value.trim() };
      if (h.a && h.b) copy(convLine(h), 'Conversion');
    };
    panel.querySelectorAll('.cp').forEach((b) => b.addEventListener('click', () => {
      const v = (b.dataset.cp === 'a' ? A : B).value.trim();
      if (v) copy(v, 'Value');
    }));
    $('cvClear').onclick = () => { st.conv.history = []; save(); renderConvHist(); };
    $('cvHist').addEventListener('click', (e) => {
      const row = e.target.closest('.h'), a = e.target.closest('[data-a]');
      if (!row || !a) return;
      const i = +row.dataset.i, h = st.conv.history[i];
      switch (a.dataset.a) {
        case 'load':
          st.conv.cat = h.cat; st.conv.from = h.from; st.conv.to = h.to; st.conv.val = h.a;
          syncConv(); save(); break;
        case 'cb': copy(h.b, 'Result'); break;
        case 'cline': copy(convLine(h), 'Conversion'); break;
        case 'del': st.conv.history.splice(i, 1); save(); renderConvHist(); break;
      }
    });
  }

  // ------------------------------------------------------------------ open / close
  function open(tab) {
    build();
    if (tab) showTab(tab);
    if (window.__openPanel) window.__openPanel('calc'); else panel.hidden = false;
    setTimeout(() => ($('viewCalc').hidden ? $('cvA') : $('calcIn')).focus(), 0);
  }
  loadLocal();
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('#calcSide [data-tab]');
    if (t) { showTab(t.dataset.tab); save(); setTimeout(() => ($('viewCalc').hidden ? $('cvA') : $('calcIn')).focus(), 0); }
    if (e.target.closest && e.target.closest('#calcClose')) { if (window.__openPanel) window.__openPanel(null); else panel.hidden = true; }
  });
  window.ShareVCalc = { open, getState, setState, build };
})();
