/* app.js --------------------------------------------------------------------
   Railway bridge static load effects, web version of Main_gui.m (2026-11-02):
   input, sketch and analysis of the ticked trains on every change (Web Workers from
   six trains), Section / Critical / Envelope, Run (Cancel after 5 s), Reset, Export
   (xlsx), Print (report, a PDF file with bookmarks, pdf.js).

   Andreas Andersson, 2026-11-02 (assisted by Claude)
---------------------------------------------------------------------------*/
(function () {
'use strict';
const $ = id => document.getElementById(id);
const VER = '2026-11-02l';

// ---------------------------------------------------------- default input
const def = { L: '20 20', EI: '35E9', dL: '0.1', bQType: '1-point', bQLast: '1-point', b_Q: '3.0',
              alpha: '1.33', v: '120', shw: 'Section' };
const bQTypes = ['1-point', '3-point', '5-point', 'Triangular'];
const shwList = ['Section', 'Critical', 'Envelope'];
const catList = ['A10', 'A12', 'A14', 'A1', 'B1', 'B2', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4', 'D5', 'E4', 'E5', 'E6', 'XLA', 'XLB'];
const mainList = ['LM71', 'SW/0', 'SW/2', 'UT', 'A1919', 'B1919', 'C1919', 'D1919', 'A', 'B', 'F', 'LG1', 'LG2', '85F', '60F', 'TLM1', 'TLM2', 'TLM3'];
const loadList = ['LM71', 'SW/0', 'SW/2', 'UT', 'A1919', 'B1919', 'C1919', 'D1919', 'A', 'B', 'F', 'LG1', 'LG2', '85F', '60F', ...catList, 'TLM1', 'TLM2', 'TLM3'];
const vList = ['A1919', 'B1919', 'C1919', 'D1919', 'F', 'LG1', 'LG2', '85F', '60F', ...catList];   // factor depends on v
const co = ['#0072BD', '#D95319'], cEm = '#f5b899', cCar = '#d90000', nMax = 2e6;

// shared state (as Main_gui)
let inp = {}, mdl = {}, ILa = null, IL = null, LE = null, sup = [], jx = 0, xp = 0, sig = '';
let xpAuto = true, sel = [], selAuto = true, allS = new Map(), allN = [], allR = [], modelMap = null, tProg = 0;
const ui = { bQType: def.bQType, bQLast: def.bQLast, bQVal: def.b_Q, busy: false, stopReq: false, stopOn: false, stopTimer: null, abort: null };

// ============================================================ helpers
// numbers as MATLAB str2num would read them: '20 20', '[10 15 10]', '15E3', simple expressions
function evalExpr(s) {
    let i = 0;
    const peek = () => s[i], ws = () => { while (s[i] === ' ') i++; };
    function num() {
        ws();
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
        if (m) { i += m[0].length; return parseFloat(m[0]); }
        if (peek() === '(') { i++; const v = add(); ws(); if (s[i++] !== ')') throw 0; return v; }
        if (peek() === '-') { i++; return -pow(); }
        if (peek() === '+') { i++; return pow(); }
        throw 0;
    }
    function pow() { let v = num(); ws(); while (peek() === '^') { i++; v = Math.pow(v, num()); ws(); } return v; }
    function mul() { let v = pow(); ws(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const w = pow(); v = o === '*' ? v * w : v / w; ws(); } return v; }
    function add() { let v = mul(); ws(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const w = mul(); v = o === '+' ? v + w : v - w; ws(); } return v; }
    const v = add(); ws();
    if (i !== s.length || !isFinite(v)) throw 0;
    return v;
}
function parseVec(str) {
    try {
        let s = String(str).trim().replace(/^\[|\]$/g, '').replace(/,/g, ' ').trim();
        if (!s) return null;
        s = s.replace(/([*/^+(-])\s+/g, '$1').replace(/\s+([*/^)])/g, '$1');
        return s.split(/\s+/).map(evalExpr);
    } catch (e) { return null; }
}
const scalar = s => { const v = parseVec(s); return v && v.length === 1 ? v[0] : null; };
const scalarOr = (id, d) => { const v = scalar($(id).value); return v !== null && v > 0 ? v : d; };
const gfmt = x => String(Number(x.toPrecision(6)));              // %g
const rnd = x => (x < 0 ? -Math.round(-x) : Math.round(x));
const nextFrame = () => new Promise(r => setTimeout(r, 0));
const RED = '#b30000';

// ============================================================ symbols
const C = { green: '#21963f', red: '#cc2626', grey: '#737373' };
const ICON = {
    run: `<circle cx="12" cy="12" r="11" fill="${C.green}"/><polygon points="9.5,7 9.5,17 17.5,12" fill="#fff"/>`,
    stop: `<circle cx="12" cy="12" r="11" fill="${C.red}"/><rect x="8" y="8" width="8" height="8" rx="1" fill="#fff"/>`,
    reset: `<path d="M18.06 8.5 A7 7 0 1 1 12 5" fill="none" stroke="${C.red}" stroke-width="3"/><polygon points="12,0.8 12,9.2 17.5,5" fill="${C.red}"/>`,
    print: `<rect x="7.5" y="3" width="9" height="6.5" fill="#fff" stroke="${C.grey}"/><rect x="2" y="8" width="20" height="10" rx="2" fill="#666b73"/>` +
           `<rect x="6" y="14" width="12" height="1.5" fill="#333338"/><rect x="7.5" y="15" width="9" height="6" fill="#fff" stroke="${C.grey}"/>` +
           `<path d="M9 17.5H15M9 19.5H15" stroke="${C.grey}"/><circle cx="18.5" cy="11" r="1" fill="#4dbf59"/>`,
    export: `<rect x="7" y="2" width="15" height="20" rx="1.5" fill="#219e59"/><path d="M14 7H22M14 12H22M14 17H22M18 2V22" stroke="#d9f2e0" stroke-width="1"/>` +
            `<rect x="2" y="6" width="13" height="13" rx="1.5" fill="#0f6636"/><path d="M5.56 8.3L11.44 16.7M11.44 8.3L5.56 16.7" stroke="#fff" stroke-width="2.1"/>`
};
const TIP = { run: 'Run: analysis of the ticked trains', stop: 'Cancel: ends the run' };
const SYMS = {
    sRun: ['run', TIP.run, () => (ui.stopOn ? onCancel() : onRun())],
    sRst: ['reset', 'Reset: default input, clears the results', () => onReset()],
    sExp: ['export', 'Export: results to *.xlsx', () => onExport()],
    sRep: ['print', 'Print: pdf report of the results', () => onReport()]
};
function setIcon(id, name) { $(id).innerHTML = `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`; }
for (const id in SYMS) {
    const [ic, tip, fcn] = SYMS[id], el = $(id);
    setIcon(id, ic);
    el.dataset.tip = tip;
    el.addEventListener('click', ev => {
        ev.stopPropagation();
        if (ui.busy && !(id === 'sRun' && ui.stopOn)) return;       // during a run: Cancel only
        hideTip(); fcn();
    });
    el.addEventListener('mouseenter', () => showTip(el));
    el.addEventListener('mouseleave', hideTip);
}
function showTip(el) {
    const t = $('tip');
    t.textContent = el.dataset.tip; t.style.display = 'block';
    t.style.left = Math.min(el.offsetLeft, 550 - t.offsetWidth) + 'px';
    t.style.top = (el.offsetTop + el.offsetHeight + 4) + 'px';
}
function hideTip() { $('tip').style.display = 'none'; }
function setMsg(s, col) { const m = $('msg'); m.textContent = s || ''; m.style.color = col || '#4d4d4d'; }
function setProg(fr) {
    if (fr === null) { $('pfill').style.width = '0'; $('pct').textContent = ''; return; }
    $('pfill').style.width = (100 * fr) + '%'; $('pct').textContent = Math.round(100 * fr) + ' %';
}
// a run or a report: the Run symbol becomes Cancel after 5 s
function progStart() {
    ui.stopReq = false; ui.busy = true; $('fig').classList.add('busy'); tProg = performance.now();
    clearTimeout(ui.stopTimer);
    ui.stopTimer = setTimeout(() => { ui.stopOn = true; setIcon('sRun', 'stop'); $('sRun').dataset.tip = TIP.stop; }, 5000);
}
function progEnd() {
    clearTimeout(ui.stopTimer);
    ui.stopOn = false; setIcon('sRun', 'run'); $('sRun').dataset.tip = TIP.run;
    ui.busy = false; $('fig').classList.remove('busy');
}
function onCancel() {
    ui.stopReq = true; setMsg('cancelling ...');
    if (ui.abort) ui.abort();
}
const msgDone = (stopped, t0) => {
    if (stopped) { setProg(null); setMsg('cancelled'); }
    else { setProg(1); setMsg(`done in ${((performance.now() - t0) / 1000).toFixed(1)} sec`); }
};

// ============================================================ input fields
for (const s of shwList) { const o = document.createElement('option'); o.textContent = s; $('iShw').appendChild(o); }
function setDefaults() {
    $('iL').value = def.L; $('iEI').value = def.EI; ui.dLset = def.dL;
    $('iAlpha').value = def.alpha; $('iV').value = def.v; $('iShw').value = def.shw;
    ui.bQType = def.bQType; ui.bQLast = def.bQLast; ui.bQVal = def.b_Q;
    $('tPhi').checked = true; $('tD').checked = true; $('tR').checked = false; $('tF').checked = false;
    selAuto = true; xpAuto = true; sup = []; sig = '';
}
for (const id of ['iL', 'iEI', 'iAlpha', 'iV']) $(id).addEventListener('change', () => updateModel());
$('idL').addEventListener('change', e => { ui.dLset = e.target.value.trim(); updateModel(); });
$('iXp').addEventListener('change', () => { xpAuto = false; updateModel(); });
$('iShw').addEventListener('change', () => { if (!ui.busy && ILa) updatePlots(); });
$('tPhi').addEventListener('change', () => updateModel());
for (const id of ['tD', 'tR', 'tF']) $(id).addEventListener('change', () => {
    for (const j of ['tD', 'tR', 'tF']) $(j).checked = j === id;
    if (!ui.busy && ILa) updatePlots();
});

// load distribution: 1-, 3-, 5-point by name (grey) or a typed b_Q (triangular, black);
// an empty field returns to the last point type
$('ibQ').addEventListener('change', e => {
    const s = e.target.value.trim();
    if (!s || bQTypes.slice(0, 3).includes(s)) ui.bQType = ui.bQLast;
    else { ui.bQType = 'Triangular'; ui.bQVal = s; }
    updateModel();
});
$('bbQ').addEventListener('click', ev => {
    ev.stopPropagation();
    const names = ['1-point   (axle load)', '3-point   25/50/25 % at 0.6 m', '5-point   Winkler beam, 100 MN/m'];
    const m = $('mBQ'); m.innerHTML = '';
    names.forEach((n, k) => addItem(m, n, ui.bQType === bQTypes[k], () => { ui.bQType = bQTypes[k]; ui.bQLast = bQTypes[k]; updateModel(); }));
    m.appendChild(document.createElement('hr'));
    addItem(m, 'Triangular (type b_Q)', ui.bQType === 'Triangular', () => { ui.bQType = 'Triangular'; $('ibQ').value = ui.bQVal; updateModel(); });
    m.style.left = $('bbQ').offsetLeft + 'px'; m.style.top = ($('bbQ').offsetTop + 22) + 'px'; m.style.display = 'block';
    $('mTrain').style.display = 'none';
});
function addItem(m, text, chk, fn) {
    const d = document.createElement('div');
    d.textContent = text; if (chk) d.className = 'chk';
    d.addEventListener('click', () => { m.style.display = 'none'; fn(); });
    m.appendChild(d);
}

// the train menu: tick boxes; left the models one by one, right EN 15528, one box for
// them all and one each.  A tick applies at once; what is calculated is kept.
const mT = $('mTrain'), tks = new Map();
function addTick(text, x, row, fn, bold) {
    const l = document.createElement('label'), c = document.createElement('input');
    c.type = 'checkbox'; c.dataset.train = text;
    l.style.left = x + 'px'; l.style.top = (4 + row * 17) + 'px';
    if (bold) l.className = 'b';
    l.appendChild(c); l.appendChild(document.createTextNode(text));
    c.addEventListener('change', () => fn(c));
    mT.appendChild(l);
    return c;
}
const tkAll = addTick('All trains', 6, 0, c => setSel(c.checked ? loadList : []), true);
const tkEN = addTick('EN 15528', 100, 0, c => setSel(c.checked ? [...sel, ...catList] : sel.filter(s => !catList.includes(s))), true);
const onTick = c => setSel(c.checked ? [...sel, c.dataset.train] : sel.filter(s => s !== c.dataset.train));
mainList.forEach((n, i) => tks.set(n, addTick(n, 6, i + 1, onTick)));
catList.forEach((n, i) => tks.set(n, addTick(n, 114, i + 1, onTick)));
{
    const b = document.createElement('button');
    b.textContent = 'Close'; b.addEventListener('click', () => { mT.style.display = 'none'; });
    mT.appendChild(b);
}
mT.addEventListener('click', ev => ev.stopPropagation());
const toggleTrain = ev => {
    ev.stopPropagation();
    if (ui.busy) return;
    $('mBQ').style.display = 'none';
    if (mT.style.display === 'block') { mT.style.display = 'none'; return; }
    mT.style.left = $('iLoad').offsetLeft + 'px'; mT.style.top = ($('iLoad').offsetTop + 23) + 'px'; mT.style.display = 'block';
};
$('iLoad').addEventListener('click', toggleTrain);
$('bLoad').addEventListener('click', toggleTrain);
document.addEventListener('click', () => {
    $('mBQ').style.display = 'none'; mT.style.display = 'none';
    if (ui.supJust) { ui.supJust = false; return; }              // the click that opened the support menu
    removeSupSel();
});

function setSel(names) {
    if (!ui.busy) { selAuto = false; sel = loadList.filter(n => names.includes(n)); }
    syncTicks();
    if (!ui.busy) updateModel();
}
function syncTicks() {
    tks.forEach((c, n) => { c.checked = sel.includes(n); });
    tkAll.checked = sel.length === loadList.length;
    tkEN.checked = catList.some(n => sel.includes(n));
    const st = !sel.length ? 'none' : sel.length === loadList.length ? 'All trains' : sel.length <= 2 ? sel.join(', ') : `${sel.length} trains`;
    $('iLoad').value = st;
    $('iLoad').title = sel.length ? sel.join(', ') : 'No train ticked: the influence lines alone';
}

// ============================================================ input / model
function readInput() {
    const L = parseVec($('iL').value), EI = parseVec($('iEI').value), dL = scalar(ui.dLset);
    // the field: as typed, or (grey) the length in use where a short bridge needs more
    // elements; the typed value returns when the bridge is longer again
    let dLshow = ui.dLset, dLgrey = false;
    if (L && L.every(v => v > 0) && dL > 0) {
        const s0 = L.reduce((a, b) => a + b, 0), ne = BS.nElements(s0, dL);
        if (ne !== rnd(s0 / dL)) { dLshow = gfmt(s0 / ne); dLgrey = true; }
    }
    $('idL').value = dLshow; $('idL').classList.toggle('auto', dLgrey);
    if (xpAuto && L) $('iXp').value = String(L[0] / 2);          // midspan of the first span, until moved by hand
    const xv = scalar($('iXp').value);
    inp.L = L; inp.EI = EI; inp.dL = dL;
    if (selAuto && L) sel = L.length > 1 ? ['LM71', 'SW/0'] : ['LM71'];
    syncTicks();
    inp.load = sel;
    inp.dyn = $('tPhi').checked;
    const onA = sel.includes('LM71'), onV = inp.dyn && sel.some(n => vList.includes(n));
    $('iAlpha').style.display = onA ? '' : 'none'; $('lAlpha').style.display = onA ? '' : 'none';
    $('iV').style.display = onV ? '' : 'none'; $('lV').style.display = onV ? '' : 'none';
    inp.alpha = onA ? scalar($('iAlpha').value) : 1;
    inp.v = onV ? scalar($('iV').value) : null;
    inp.loadDist = ui.bQType;
    if (ui.bQType === 'Triangular') {
        let s = $('ibQ').value.trim();
        if (bQTypes.includes(s)) s = ui.bQVal;
        $('ibQ').value = s; $('ibQ').classList.remove('auto');
        inp.b_Q = scalar(s); ui.bQVal = s;
    } else {
        $('ibQ').value = ui.bQType; $('ibQ').classList.add('auto');
        inp.b_Q = 0;
    }
    $('ibQ').title = `Load distribution of each axle, ${ui.bQType.toLowerCase()}: pick 1-, 3- or 5-point with the button, or type the base b_Q (m) of a triangle; empty = back to the point distribution. LM71: 1-point = the 4 axle loads, any other = evenly distributed on 6.4 m`;
    const ok = L && L.every(v => v > 0) && EI && EI.every(v => v > 0) && (EI.length === 1 || EI.length === L.length)
        && dL !== null && dL > 0 && dL <= Math.min(...L) && inp.b_Q !== null && inp.b_Q >= 0 && xv !== null
        && inp.alpha !== null && inp.alpha > 0 && (!onV || (inp.v !== null && inp.v > 0));
    if (ok) {
        xp = Math.min(Math.max(xv, 0), L.reduce((a, b) => a + b, 0));
        $('tPhi').disabled = !sel.length;
    } else setMsg('input error', RED);
    return !!ok;
}

function updateModel() {
    if (ui.busy) return false;
    if (!readInput()) return false;
    let s0 = 0; const xs = [0, ...inp.L.map(l => (s0 += l))];
    if (sup.length !== xs.length) sup = xs.map(() => false);
    inp.bc = [];
    xs.forEach((x, i) => { inp.bc.push([x, 1, 0]); if (sup[i]) inp.bc.push([x, 2, 0]); });
    mdl.xs = xs; mdl.Ltot = s0; mdl.dL = s0 / BS.nElements(s0, inp.dL);

    // a new model: new analysis; otherwise only the section has changed
    const s = [inp.dL, inp.loadDist, inp.b_Q, inp.dyn, scalarOr('iAlpha', 1.33), scalarOr('iV', 120), inp.L.join(' '), inp.EI.join(' '), sup.join('')].join('|');
    const isNew = s !== sig;
    if (isNew) { sig = s; sectionGrid(); allS = new Map(); ILa = null; sendKey = null; setProg(null); }
    setSection(null);
    plotBeam();
    if ($('msg').style.color === 'rgb(179, 0, 0)') setMsg('');
    if (isNew || sel.join() !== allN.join()) return analyse(isNew);
    updatePlots();
    return true;
}

// the sections the influence lines are solved at: every node while that fits in nMax
// entries per matrix, always with the supports, the element either side, the mid-spans
function sectionGrid() {
    const nEL = rnd(mdl.Ltot / mdl.dL), stp = Math.max(1, Math.ceil((nEL + 1) / Math.max(rnd(nMax / (nEL + 1)), 120)));
    const sx = mdl.xs, spc = [...sx, ...sx.map(x => Math.max(x - mdl.dL, 0)), ...sx.map(x => Math.min(x + mdl.dL, mdl.Ltot))];
    for (let i = 1; i < sx.length; i++) spc.push((sx[i] + sx[i - 1]) / 2);
    const set = new Set();
    for (let i = 0; i <= nEL; i += stp) set.add(i);
    for (const v of spc) set.add(rnd(v / mdl.dL));
    mdl.xa = [...set].sort((a, b) => a - b).map(i => i * mdl.dL);
    mdl.spc = spc;
}
function setSection(j) {
    if (j === null) { let b = Infinity; mdl.xa.forEach((x, i) => { const d = Math.abs(x - xp); if (d < b) { b = d; j = i; } }); }
    jx = Math.min(Math.max(Math.round(j), 0), mdl.xa.length - 1);
    xp = mdl.xa[jx];
    $('iXp').value = String(Number(xp.toPrecision(4)));
    if (modelMap && modelMap.mk) moveMarker();
}
const showMode = () => $('iShw').value;

// ============================================================ analysis
function buildIL() {
    ILa = BS.influenceLines({ L: inp.L, EI: inp.EI.length === 1 ? inp.EI[0] : inp.EI, dL: inp.dL, bc: inp.bc, xp: mdl.xa, loadDist: inp.loadDist, b_Q: inp.b_Q });
    const Ir = ILa.pt || ILa, iv = ILa.bc.map((b, i) => (b[1] === 1 ? i : -1)).filter(i => i >= 0);
    const rng = A => { let a = Infinity, b = -Infinity; for (const c of A) for (let i = 0; i < c.length; i++) { if (c[i] < a) a = c[i]; if (c[i] > b) b = c[i]; } return [a, b]; };
    mdl.rng = { M: rng(Ir.M), V: rng(Ir.V), d: rng(Ir.d), r: rng(Ir.r), RF: rng(iv.map(i => Ir.RF[i])) };
    const n2 = mdl.xa.length, st2 = Math.max(1, rnd(n2 / 120)), e = new Set([n2 - 1]);
    for (let i = 0; i < n2; i += st2) e.add(i);
    const ix = mdl.xa.map(x => rnd(x / mdl.dL));
    for (const v of mdl.spc) { const k = ix.indexOf(rnd(v / mdl.dL)); if (k >= 0) e.add(k); }
    mdl.env = [...e].sort((a, b) => a - b);
}
function ilAt(j) {
    const pick = (A, B) => { A.xp = j.map(i => ILa.xp[i]); for (const q of ['M', 'V', 'd', 'r']) A[q] = j.map(i => B[q][i]); return A; };
    const o = pick(Object.assign({}, ILa), ILa);
    if (ILa.pt) { o.pt = Object.assign({}, ILa.pt); for (const q of ['M', 'V', 'd', 'r']) o.pt[q] = j.map(i => ILa.pt[q][i]); }
    return o;
}
function leOpt(name) {
    const o = { dyn: inp.dyn, v: null, alpha: 1 };
    if (name === 'LM71') o.alpha = scalarOr('iAlpha', 1.33);
    if (vList.includes(name)) o.v = scalarOr('iV', 120);
    return o;
}

// ---- the worker pool: one train per job; the influence lines once per model
const nWorkers = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 2) - 1));
let pool = null, sendKey = null;
function makePool() {
    try { pool = Array.from({ length: nWorkers }, () => new Worker(`solver.worker.js?v=${VER}`)); }
    catch (e) { pool = null; }
}
function killPool() { if (pool) pool.forEach(w => w.terminate()); pool = null; sendKey = null; }
// several trains: resolved with true when cancelled
function runPool(names, ILe, show) {
    return new Promise((resolve, reject) => {
        if (sendKey !== sig) { pool.forEach(w => w.postMessage({ il: ILe })); sendKey = sig; }
        let next = 0, done = 0, over = false;
        ui.abort = () => { if (!over) { over = true; ui.abort = null; killPool(); resolve(true); } };
        const feed = w => {
            if (over || next >= names.length) return;
            const k = next++, name = names[k];
            w.onmessage = ev => {
                if (over) return;
                const r = ev.data;
                if (!r.ok) { over = true; killPool(); reject(new Error(r.message)); return; }
                allS.set(name, r.LE); done++;
                if (show) { setProg(done / names.length); setMsg(`${name}: ${done}/${names.length}`); }
                if (done === names.length) { over = true; ui.abort = null; resolve(false); } else feed(w);
            };
            w.onerror = e => { if (!over) { over = true; killPool(); reject(new Error(e.message || 'worker error')); } };
            w.postMessage({ id: k, name, opt: leOpt(name) });
        };
        pool.forEach(feed);
    });
}
// the same in the page: few trains, or no workers (a page opened from file://)
async function runSerial(names, ILe, show) {
    for (let k = 0; k < names.length; k++) {
        if (show) { setProg(k / names.length); setMsg(`${names[k]}: ${k + 1}/${names.length}`); await nextFrame(); }
        if (ui.stopReq) return true;
        allS.set(names[k], BS.loadEffect(ILe, names[k], leOpt(names[k])));
    }
    return false;
}
// envelope over the beam per ticked train, once per model and train, and over the ticked
// trains (LE).  Cancelled: the trains not calculated are unticked.
async function calcEnv(prog) {
    const nw = sel.filter(n => !allS.has(n)), show = prog || nw.length > 2;
    let stopped = false;
    if (nw.length) {
        const ILe = ilAt(mdl.env);
        if (nw.length >= 6 && window.__noWorkers !== true) { if (!pool) makePool(); }
        if (nw.length >= 6 && pool && window.__noWorkers !== true) stopped = await runPool(nw, ILe, show);
        else stopped = await runSerial(nw, ILe, show);
    }
    if (stopped) { sel = sel.filter(n => allS.has(n)); selAuto = false; syncTicks(); }
    allN = sel.slice(); allR = sel.map(n => allS.get(n));
    LE = mergeSel(allN, allR);
    return stopped;
}
// the load effects of the trains as one: the envelopes over them, and each peak with the
// arrangement of the train that governs it (LM71 may stand on other influence lines)
function mergeSel(N, R) {
    if (!R.length) return null;
    if (R.length === 1) return R[0];
    const M = Object.assign({}, R[0], { xpeak: {}, pos: {} });
    for (const q of ['M', 'V', 'd', 'r', 'RF']) {
        const m = R[0][q][0].length, lo = new Float64Array(m), hi = new Float64Array(m);
        for (let j = 0; j < m; j++) {
            let a = Infinity, b = -Infinity;
            for (const L of R) { if (L[q][0][j] < a) a = L[q][0][j]; if (L[q][1][j] > b) b = L[q][1][j]; }
            lo[j] = a; hi[j] = b;
        }
        M[q] = [lo, hi];
    }
    for (const [n, c] of [['Mmax', 1], ['Mmin', -1], ['Vmax', 0], ['dmax', 0], ['rmax', 0], ['RFmax', 1], ['RFmin', -1]]) {
        let k = 0, b = c < 0 ? Infinity : -Infinity;
        R.forEach((L, i) => {
            const v = c === 0 ? Math.abs(L[n]) : L[n];
            if (c < 0 ? v < b : v > b) { b = v; k = i; }
        });
        M[n] = R[k][n]; M.xpeak[n] = R[k].xpeak[n];
        M.pos[n] = Object.assign({}, R[k].pos[n], { xIL: R[k].x, train: N[k] });
    }
    M.snap = Math.max(...R.map(L => L.snap));
    return M;
}

async function analyse(isNew) {
    progStart();
    const t0 = performance.now();
    try {
        if (isNew) { await nextFrame(); buildIL(); setSection(null); }
        const stopped = await calcEnv(false);
        if (stopped) { ui.busy = false; readInput(); ui.busy = true; }
        updatePlots();
        setHead();
        msgDone(stopped, t0);
    } catch (e) {
        ILa = null; LE = null; allN = []; allR = [];
        clearPlots(); $('dynT').innerHTML = '';
        setMsg(e && e.message ? e.message : 'error', RED);
        console.error(e);
    }
    progEnd();
    return true;
}
function setHead() {
    $('dynT').innerHTML = PL.texHTML(dynText());
    let tip = 'Element length; axles stand on nodes, so spacings it does not divide are rounded';
    if (LE && LE.snap > 1e-9) tip += `; now by up to ${gfmt(Number(LE.snap.toPrecision(2)))} m`;
    $('idL').title = tip;
}
async function onRun() {
    if (updateModel() === false) return;
    while (ui.busy) await new Promise(r => setTimeout(r, 20));
    if (!ILa) return;
    progStart();
    const t0 = performance.now();
    try {
        const sel0 = sel.slice(), auto0 = selAuto, S0 = allS;
        allS = new Map();
        setProg(0);
        const stopped = await calcEnv(true);
        if (stopped) {                                           // as before the Run
            sel = sel0; selAuto = auto0; allS = S0;
            syncTicks();
            await calcEnv(false);
        }
        updatePlots();
        setHead();
        msgDone(stopped, t0);
    } catch (e) { setProg(null); setMsg(e && e.message ? e.message : 'error', RED); console.error(e); }
    progEnd();
}
function onReset() { mT.style.display = 'none'; setDefaults(); updateModel(); }

// the dynamic factor and the determinant length, above the model.  Several trains: the
// one line where they share the factor, else its range
function dynText() {
    if (!LE || !inp.dyn) return '';
    const ph = allR.map(L => L.phi);
    if (Math.max(...ph) - Math.min(...ph) < 5e-3) return dynOne(allR[0]);
    return `$\\Phi$ = ${Math.min(...ph).toFixed(2)} to ${Math.max(...ph).toFixed(2)} depending on the train, $L_\\Phi$ = ${LE.Lphi.toFixed(1)} m`;
}
function dynOne(L) {
    const Tt = L.T[0], la = `$L_\\Phi$ = ${L.Lphi.toFixed(1)} m`, v = scalarOr('iV', 120);
    switch (Tt.code) {
        case 1991:
            if (Tt.type === 'UT') return 'No dynamic factor';
            return `$\\Phi_2$ = ${L.phi.toFixed(2)}, ${la}`;
        case 15528: case 2025: {
            const vt = Tt.code === 2025 ? `, $v$ = ${gfmt(Tt.vmax)} km/h` : '';
            return `$1 + \\varphi' + 0.5\\varphi''$ = 1 + ${L.phiParts[0].toFixed(2)} + ${L.phiParts[1].toFixed(2)} = ${L.phi.toFixed(2)}, ${la}${vt}`;
        }
        case 1919: {
            const fv = v < 100 ? `(${gfmt(v)}/100)\\,` : '';
            return `$\\varphi = 1 + ${fv}10/(13 + 0.7\\,l)$ = ${L.phi.toFixed(2)}, $l$ = ${L.Lphi.toFixed(1)} m`;
        }
        case 1938: return `$\\varphi = 1 + 17.65/(20 + l)$ = ${L.phi.toFixed(2)}, $l$ = ${L.Lphi.toFixed(1)} m`;
        case 1961: {
            const fv = v < 120 ? `${((0.75 * v + 10) / 100).toFixed(2)}\\cdot` : '';
            return `$\\varphi = 1 + ${fv}0.01\\max((2200 + 11\\,l)/(25 + l),\\,20)$ = ${L.phi.toFixed(2)}, $l$ = ${L.Lphi.toFixed(1)} m`;
        }
    }
    return '';
}

// units: symbol, unit and scale of a peak, the same of the envelope plots, influence line
const UNIT = {
    M: { sy: 'M', uv: 'kNm', sc: 1e3, uE: 'MNm', sE: 1e6, kI: 1, uI: 'm' },
    V: { sy: 'V', uv: 'kN', sc: 1e3, uE: 'MN', sE: 1e6, kI: 1, uI: '-' },
    d: { sy: 'd', uv: 'mm', sc: 1e-3, uE: 'mm', sE: 1e-3, kI: 1e9, uI: 'mm/MN' },
    r: { sy: '\\phi', uv: 'mrad', sc: 1e-3, uE: 'mrad', sE: 1e-3, kI: 1e9, uI: 'mrad/MN' },
    RF: { sy: 'R', uv: 'kN', sc: 1e3, uE: 'MN', sE: 1e6, kI: 1, uI: '-' }
};
const fmtVal = (q, v) => { const U = UNIT[q], w = v / U.sc, s = ['M', 'V', 'RF'].includes(q) ? w.toFixed(0) : w.toFixed(1); return `${s} ${U.uv}`.replace(/^-0 /, '0 '); };
const qtyName = () => ($('tD').checked ? 'd' : $('tR').checked ? 'r' : 'RF');

// ============================================================ model plot
function drawModel(svg, box, opt) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const L = mdl.Ltot, yd = -0.075 * L, yr = [yd - 0.035 * L, 0.12 * L], xl = [-0.02 * L, 1.02 * L];
    const ysp = Math.max((xl[1] - xl[0]) * box.h / box.w, yr[1] - yr[0]), ym = (yr[0] + yr[1]) / 2, yl = [ym - ysp / 2, ym + ysp / 2];
    const X = x => box.x + (x - xl[0]) / (xl[1] - xl[0]) * box.w, Y = y => box.y + box.h - (y - yl[0]) / (yl[1] - yl[0]) * box.h;
    const sc = box.w / (xl[1] - xl[0]), line = (x1, y1, x2, y2, c, w) => PL.el('line', { x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), stroke: c, 'stroke-width': w }, svg);
    line(0, 0, L, 0, '#8c8c8c', 4);
    mdl.xs.forEach((x, i) => {
        if (sup[i]) line(x, -0.03 * L, x, 0.03 * L, '#000', 1);
        else {
            const a = 0.02 * L * sc, b = 0.03 * L * sc;
            PL.el('polygon', { points: `${X(x) - a},${Y(0) + b} ${X(x) + a},${Y(0) + b} ${X(x)},${Y(0)}`, fill: '#fff', stroke: '#000', 'stroke-width': 0.7 }, svg);
            PL.el('circle', { cx: X(x), cy: Y(0), r: 2, fill: '#000' }, svg);
        }
    });
    line(0, yd, L, yd, '#000', 0.4);
    mdl.xs.forEach(x => {
        line(x, yd - 0.016 * L, x, yd + 0.024 * L, '#000', 0.4);
        line(x - 0.012 * L, yd - 0.012 * L, x + 0.012 * L, yd + 0.012 * L, '#000', 0.4);
    });
    for (let i = 0; i + 1 < mdl.xs.length; i++)
        PL.text(svg, (mdl.xs[i + 1] - mdl.xs[i]).toFixed(1), X((mdl.xs[i] + mdl.xs[i + 1]) / 2), Y(yd + 0.004 * L) - 2, { size: opt.size, anchor: 'middle', baseline: 'text-after-edge' });
    return { X, Y, L, xl, yl, box };
}
function plotBeam() {
    const m = drawModel($('model'), { x: 48, y: 0, w: 410, h: 95 }, { size: 14.7 });
    m.mk = PL.el('g', {}, $('model'));
    modelMap = m;
    drawMarker(m);
    moveMarker();
}
function drawMarker(m) {
    const b = 0.045 * m.L * m.box.w / (m.xl[1] - m.xl[0]);
    PL.el('line', { x1: 0, y1: 0, x2: 0, y2: -b, stroke: co[0], 'stroke-width': 0.8 }, m.mk);
    PL.el('polygon', { points: `0,${-b} -4,${-b - 7} 4,${-b - 7}`, fill: co[0] }, m.mk);
}
function moveMarker() { modelMap.mk.setAttribute('transform', `translate(${modelMap.X(xp)} ${modelMap.Y(0)})`); }
// the critical sections on the sketch; they replace the marker
function markPeaks(on, m, svg) {
    m = m || modelMap; svg = svg || $('model');
    svg.querySelectorAll('.xpk').forEach(e => e.remove());
    if (m.mk) m.mk.style.display = on ? 'none' : '';
    if (!on || !LE) return;
    peakNames().forEach((n, i) => {
        const U = UNIT[n.replace(/(max|min)$/, '')], xq = LE.xpeak[n], L = m.L, sc = m.box.w / (m.xl[1] - m.xl[0]);
        const yl = (0.014 + 0.03 * (i % 2)) * L * sc, px = m.X(xq), py = m.Y(0), g = PL.el('g', { class: 'xpk' }, svg);
        PL.el('line', { x1: px, y1: py, x2: px, y2: py - yl, stroke: co[1], 'stroke-width': 0.8 }, g);
        PL.el('polygon', { points: `${px},${py} ${px - 3},${py - 5} ${px + 3},${py - 5}`, fill: co[1] }, g);
        PL.text(g, `$${U.sy}_\\mathrm{${n.slice(-3)}}$`, px, py - yl - 1, { size: 12, anchor: 'middle', fill: co[1], baseline: 'text-after-edge' });
    });
}
// on or below the beam line and near a support: the pull-down for that support; a right
// click near a support at any height; anywhere else grab the marker
const mdlPoint = ev => {
    const r = $('model').getBoundingClientRect(), m = modelMap;
    const x = m.xl[0] + (ev.clientX - r.left - m.box.x) / m.box.w * (m.xl[1] - m.xl[0]);
    const y = m.yl[0] + (m.box.y + m.box.h - (ev.clientY - r.top)) / m.box.h * (m.yl[1] - m.yl[0]);
    return { x, y };
};
$('model').addEventListener('contextmenu', ev => ev.preventDefault());
$('model').addEventListener('click', ev => ev.stopPropagation());
$('model').addEventListener('mousedown', ev => {
    ev.stopPropagation(); ev.preventDefault();
    if (ui.busy || !ILa) return;
    removeSupSel(); mT.style.display = 'none'; $('mBQ').style.display = 'none';
    const P = mdlPoint(ev), alt = ev.button === 2;
    let bi = 0, bd = Infinity;
    mdl.xs.forEach((x, i) => { const d = Math.abs(x - P.x); if (d < bd) { bd = d; bi = i; } });
    if (bd < 0.03 * mdl.Ltot && (alt || P.y <= 0)) { supMenu(bi); return; }
    if (alt) return;
    const move = e => {
        const Q = mdlPoint(e);
        let b = Infinity, j = jx;
        mdl.xa.forEach((x, i) => { const d = Math.abs(x - Q.x); if (d < b) { b = d; j = i; } });
        if (j === jx) return;
        xpAuto = false;
        setSection(j);
        if (showMode() === 'Section') requestPlots();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    move(ev);
});
function supMenu(bi) {
    const s = document.createElement('select');
    s.id = 'supsel';
    for (const t of ['pinned', 'clamped']) { const o = document.createElement('option'); o.textContent = t; s.appendChild(o); }
    s.value = sup[bi] ? 'clamped' : 'pinned';
    s.style.left = (10 + modelMap.X(mdl.xs[bi]) - 32) + 'px';
    s.style.top = (214 + modelMap.Y(0) + 8) + 'px';
    s.addEventListener('click', e => e.stopPropagation());
    s.addEventListener('mousedown', e => e.stopPropagation());
    s.addEventListener('change', () => { sup[bi] = s.value === 'clamped'; removeSupSel(); updateModel(); });
    $('fig').appendChild(s);
    ui.supJust = true;                                           // the mouse button is still down
    s.focus();
}
function removeSupSel() { const s = $('supsel'); if (s) s.remove(); }
// arrow keys step the section one grid point, ten with shift; not while typing
document.addEventListener('keydown', ev => {
    const a = document.activeElement;
    if (ui.busy || !ILa || (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT'))) return;
    const s = ev.shiftKey ? 10 : 1;
    if (ev.key === 'ArrowLeft') setSection(jx - s);
    else if (ev.key === 'ArrowRight') setSection(jx + s);
    else return;
    xpAuto = false;
    if (showMode() === 'Section') requestPlots();
});
let plotReq = false;
function requestPlots() {
    if (plotReq) return;
    plotReq = true;
    requestAnimationFrame(() => { plotReq = false; updatePlots(); });
}

// ============================================================ result plots
// a set of n axes on a shared x axis: GUI (in #res) or report
function guiSet(n) {
    const svg = $('res');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const gp = 6, ytop = 10, h = (510 - 52 - (n - 1) * gp) / n;
    return Array.from({ length: n }, (_, k) => {
        const ax = new PL.Axes(svg, { x: 48, y: ytop + k * (h + gp), w: 410, h }, { xTickLabels: k === n - 1 });
        ax.xlim = [-0.02 * mdl.Ltot, 1.02 * mdl.Ltot];
        if (k === n - 1) ax.xlabel = '$x$ (m)';
        return ax;
    });
}
function clearPlots() {
    const A = guiSet(4);
    A.forEach(ax => { ax.ylim = [0, 1]; ax.draw(); });
}
const peakNames = () => ['Mmax', 'Mmin', 'Vmax', qtyName() + 'max'];
function topText(ax, str) {
    ax.top = g => PL.text(g, str, ax.box.x + 3, ax.box.y + 11, { size: 13.3 });
}
const triangle = (g, ax, x, y, dr, fc, ec) => {
    const px = ax.X(x), py = ax.Y(y);
    PL.el('polygon', { points: `${px},${py} ${px - 3.5},${py - dr * 6} ${px + 3.5},${py - dr * 6}`, fill: fc, stroke: ec, 'stroke-width': 0.5 }, g);
};
function supports(g, ax, LEp, xc, yc) {
    LEp.supX.forEach((xs, i) => {
        if (LEp.supDir[i] !== 1) return;
        let y0 = 0;
        if (xc) {                                                // the tip on the curve
            const k = Math.round((xs - xc[0]) / (xc[1] - xc[0]));
            if (k >= 0 && k < xc.length) y0 = yc[k];
        }
        triangle(g, ax, xs, y0, -1, '#fff', '#000');
    });
}
function drawLoad(ax, LEp, C, q, bare, nm) {
    const U = UNIT[q], x = Array.from(C.xIL || LEp.x), h = Array.from(C.h, v => v * U.kI), rr = mdl.rng[q].map(v => v * U.kI);
    let rg = Math.max(Math.abs(rr[0]), Math.abs(rr[1])); if (rg === 0) rg = 1;
    const aH = 0.30 * rg, qH = 0.15 * rg, bH = 1.12 * aH, lo = Math.min(rr[0], 0) - 0.08 * rg;
    const hi = (bare ? Math.max(rr[1], 0) : Math.max(rr[1], bH)) + 0.05 * rg;
    ax.ylim = [lo, hi + 0.22 * (hi - lo)];
    ax.ylabel = `$\\xi_{${U.sy}}$ (${U.uI})`;
    const Lt = mdl.Ltot;
    ax.under = g => {
        PL.el('line', { x1: ax.X(-0.02 * Lt), y1: ax.Y(0), x2: ax.X(1.02 * Lt), y2: ax.Y(0), stroke: '#808080', 'stroke-width': 0.5 }, g);
        // distributed wagon load: one polygon per stretch that carries load
        for (let i = 0; i < C.w.length; i++) {
            if (!(C.w[i] > 0)) continue;
            let j = i; while (j + 1 < C.w.length && C.w[j + 1] > 0) j++;
            let pts = '';
            for (let k = i; k <= j; k++) pts += `${ax.X(x[k]).toFixed(2)},${ax.Y(C.w[k] * qH / C.q).toFixed(2)} `;
            pts += `${ax.X(x[j]).toFixed(2)},${ax.Y(0).toFixed(2)} ${ax.X(x[i]).toFixed(2)},${ax.Y(0).toFixed(2)}`;
            PL.el('polygon', { points: pts, fill: co[1], 'fill-opacity': 0.25, stroke: co[1], 'stroke-width': 0.5 }, g);
            i = j;
        }
        // LM71 evenly distributed on 6.4 m, at the scale of the wagon band
        for (const b of C.blk) {
            const yb = qH * C.qb / C.q;
            PL.el('polygon', { points: `${ax.X(b[0])},${ax.Y(0)} ${ax.X(b[0])},${ax.Y(yb)} ${ax.X(b[1])},${ax.Y(yb)} ${ax.X(b[1])},${ax.Y(0)}`,
                               fill: co[1], 'fill-opacity': 0.25, stroke: co[1], 'stroke-width': 0.5 }, g);
        }
        // each car a red dotted box; an empty wagon's lower in proportion to its axle load
        const ins = 0.004 * Lt;
        C.vb.forEach((b, i) => {
            if (!(b[1] > -0.02 * Lt && b[0] < 1.02 * Lt)) return;
            const hb = bH * C.vbf[i], a = ax.X(b[0] + ins), c = ax.X(b[1] - ins), y0 = ax.Y(0), y1 = ax.Y(hb);
            PL.el('path', { d: `M${a} ${y0}V${y1}H${c}V${y0}H${a}`, fill: 'none', stroke: cCar, 'stroke-width': 0.8, 'stroke-dasharray': '1 2' }, g);
        });
        // the section
        const sx = ax.X(C.x);
        PL.el('line', { x1: sx, y1: ax.box.y, x2: sx, y2: ax.box.y + ax.box.h, stroke: '#999', 'stroke-width': 0.5 }, g);
        // axle loads, the tip of the head on the zero line
        if (!C.blk.length && C.xa.length) {
            let Pm = 0;
            C.xa.forEach((v, i) => { if (v >= x[0] - 1e-9 && v <= x[x.length - 1] + 1e-9) Pm = Math.max(Pm, C.Pl[i]); });
            C.xa.forEach((v, i) => {
                if (!(v >= x[0] - 1e-9 && v <= x[x.length - 1] + 1e-9)) return;
                const c = C.emp[i] ? cEm : co[1], px = ax.X(v), y0 = ax.Y(0);
                PL.el('line', { x1: px, y1: y0, x2: px, y2: ax.Y(aH * C.Pa[i] / Pm), stroke: c, 'stroke-width': 0.8 }, g);
                PL.el('polygon', { points: `${px},${y0} ${px - 2},${y0 - 4} ${px + 2},${y0 - 4}`, fill: c }, g);
            });
        }
    };
    ax.plot(x, h, { color: co[0], width: 1 });
    ax.over = g => supports(g, ax, LEp, x, h);
    ax.onTipText = (xv, yv) => [`x = ${Number(xv.toPrecision(4))} m`, `${Number(yv.toPrecision(4))} ${U.uI}`];
    if (bare) topText(ax, `Influence line at $x$ = ${C.x.toFixed(1)} m`);
    else {
        let v = C.val;
        if (nm !== 'Mmin' && q !== 'RF') v = Math.abs(v);
        topText(ax, `$${U.sy}_\\mathrm{${nm.slice(-3)}}$ = ${fmtVal(q, v)} at $x$ = ${C.x.toFixed(1)} m${C.train ? ', ' + C.train : ''}`);
    }
}
function drawPos(LEp, bare, set) {
    let nms = peakNames();
    if (bare) nms = [nms[0], nms[2], nms[3]];
    const A = set(nms.length);
    nms.forEach((n, k) => {
        const q = n.replace(/(max|min)$/, '');
        drawLoad(A[k], LEp, LEp.pos[n], q, bare, n);
        A[k].draw();
    });
}
function ilLE() {
    const x = IL.x, LEx = { x, supX: IL.supX, supDir: IL.supDir, pos: {} };
    for (const f of ['M', 'V', qtyName()]) {
        let h = f === 'RF' ? null : IL[f][0], xc = xp;
        if (f === 'RF') {
            let b = Infinity, k = 0;
            IL.bc.forEach((c, i) => { if (c[1] === 1) { const d = Math.abs(IL.supX[i] - xp); if (d < b) { b = d; k = i; } } });
            h = IL.RF[k]; xc = IL.supX[k];
        }
        const C = { quant: f, h, x: xc, val: 0, q: 1, xa: [], Pa: [], Pl: [], emp: [], vb: [], vbf: [], blk: [], qb: 0, w: new Float64Array(x.length) };
        LEx.pos[f + 'max'] = C; LEx.pos[f + 'min'] = C;
    }
    return LEx;
}
// the envelopes along the beam: one train; several: over them, with the governing train
function envAxis(ax, q, xe, hi, lo, E1, E2, Lr, txt) {
    const U = UNIT[q];
    let vx = -Infinity, ix = 0, vn = Infinity, inn = 0;
    hi.forEach((v, i) => { if (v > vx) { vx = v; ix = i; } });
    lo.forEach((v, i) => { if (v < vn) { vn = v; inn = i; } });
    const rg = Math.max(vx - vn, Number.EPSILON);
    ax.ylim = [vn - 0.10 * rg, vx + 0.28 * rg];
    ax.ylabel = `$${U.sy}$ (${U.uE})`;
    const Lt = mdl.Ltot;
    ax.under = g => {
        PL.el('line', { x1: ax.X(-0.02 * Lt), y1: ax.Y(0), x2: ax.X(1.02 * Lt), y2: ax.Y(0), stroke: '#808080', 'stroke-width': 0.5 }, g);
        if (q !== 'RF' && E1) {
            let pts = '';
            xe.forEach((v, i) => { pts += `${ax.X(v).toFixed(2)},${ax.Y(hi[i]).toFixed(2)} `; });
            for (let i = xe.length - 1; i >= 0; i--) pts += `${ax.X(xe[i]).toFixed(2)},${ax.Y(lo[i]).toFixed(2)} `;
            PL.el('polygon', { points: pts, fill: co[0], 'fill-opacity': 0.12 }, g);
        }
    };
    if (q === 'RF') {
        ax.over = g => {
            xe.forEach((v, i) => {
                PL.el('line', { x1: ax.X(v), y1: ax.Y(lo[i]), x2: ax.X(v), y2: ax.Y(hi[i]), stroke: co[0], 'stroke-width': 1 }, g);
                PL.el('circle', { cx: ax.X(v), cy: ax.Y(hi[i]), r: 2.5, fill: co[0] }, g);
                PL.el('circle', { cx: ax.X(v), cy: ax.Y(lo[i]), r: 2.5, fill: '#fff', stroke: co[0], 'stroke-width': 0.7 }, g);
            });
            triangle(g, ax, xe[ix], vx, 1, co[1], co[1]);
            triangle(g, ax, xe[inn], vn, -1, co[1], co[1]);
            supports(g, ax, Lr);
        };
    } else {
        ax.plot(xe, hi, { color: co[0] }); ax.plot(xe, lo, { color: co[0] });
        ax.over = g => {
            triangle(g, ax, xe[ix], vx, 1, co[1], co[1]);
            triangle(g, ax, xe[inn], vn, -1, co[1], co[1]);
            supports(g, ax, Lr);
        };
    }
    ax.onTipText = (xv, yv) => [`x = ${Number(xv.toPrecision(4))} m`, `${Number(yv.toPrecision(4))} ${U.uE}`];
    topText(ax, txt(vx * U.sE, xe[ix], vn * U.sE, xe[inn], ix, inn));
}
function drawEnv(LEp, set) {
    const qs = ['M', 'V', qtyName()], A = set(3);
    qs.forEach((q, k) => {
        const U = UNIT[q];
        let xe = Array.from(LEp.xp), hi = Array.from(LEp[q][1], v => v / U.sE), lo = Array.from(LEp[q][0], v => v / U.sE);
        if (q === 'RF') {
            const iv = LEp.supDir.map((d, i) => (d === 1 ? i : -1)).filter(i => i >= 0);
            xe = iv.map(i => LEp.supX[i]); hi = iv.map(i => LEp[q][1][i] / U.sE); lo = iv.map(i => LEp[q][0][i] / U.sE);
        }
        envAxis(A[k], q, xe, hi, lo, true, null, LEp, (vx, xx, vn, xn) =>
            `$${U.sy}_\\mathrm{max}$ = ${fmtVal(q, vx)} at $x$ = ${xx.toFixed(1)} m, $${U.sy}_\\mathrm{min}$ = ${fmtVal(q, vn)} at $x$ = ${xn.toFixed(1)} m`);
        A[k].draw();
    });
}
function drawAll(set) {
    const qs = ['M', 'V', qtyName()], A = set(3), Lr = allR[0];
    qs.forEach((q, k) => {
        const U = UNIT[q];
        let iv = Lr[q][0].map ? Array.from(Lr[q][0], (_, i) => i) : [], xe = Array.from(Lr.xp);
        if (q === 'RF') { iv = Lr.supDir.map((d, i) => (d === 1 ? i : -1)).filter(i => i >= 0); xe = iv.map(i => Lr.supX[i]); }
        const hi = iv.map(i => Math.max(...allR.map(L => L[q][1][i])) / U.sE), lo = iv.map(i => Math.min(...allR.map(L => L[q][0][i])) / U.sE);
        const tr = (i, side, val) => allN[allR.findIndex(L => L[q][side][iv[i]] / U.sE === val)];
        envAxis(A[k], q, xe, hi, lo, false, null, Lr, (vx, xx, vn, xn, ix, inn) =>
            `$${U.sy}_\\mathrm{max}$ = ${fmtVal(q, vx)}, ${tr(ix, 1, hi[ix])}, $${U.sy}_\\mathrm{min}$ = ${fmtVal(q, vn)}, ${tr(inn, 0, lo[inn])}`);
        A[k].draw();
    });
}
function render(md, set) {
    if (md !== 'Section' && !LE) md = 'Section';
    if (md === 'Section') {
        if (!sel.length) drawPos(ilLE(), true, set);
        else drawPos(mergeSel(sel, sel.map(n => BS.loadEffect(IL, n, leOpt(n)))), false, set);
    } else if (md === 'Critical') drawPos(LE, false, set);
    else if (allR.length > 1) drawAll(set);
    else drawEnv(LE, set);
}
function updatePlots() {
    if (!ILa) return;
    IL = ilAt([jx]);
    let md = showMode();
    if (md !== 'Section' && !LE) md = 'Section';
    markPeaks(md !== 'Section');
    render(md, guiSet);
}

// ============================================================ export
// Chrome, Edge: a Save-as dialog, opened first (it needs the click); embedded browsers
// (Electron apps) open the dialog but write an empty file, so they get a plain download.
// null = cancelled.  A write that fails downloads the file, without a second dialog.
const TYPES = { xlsx: ['Excel workbook', { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }],
                pdf: ['PDF report', { 'application/pdf': ['.pdf'] }] };
async function pickFile(name, kind) {
    if (window.__saveHook) return { name };
    const embedded = /Electron|Claude\//.test(navigator.userAgent);
    if (window.showSaveFilePicker && !embedded) {
        try {
            const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: TYPES[kind][0], accept: TYPES[kind][1] }] });
            return { name: h.name, h };
        } catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    return { name };
}
function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// true: written, or downloaded as asked; false: downloaded after a failed write
async function writeFile(f, blob) {
    if (window.__saveHook) { await window.__saveHook(blob, f.name); return true; }
    if (!f.h) { download(blob, f.name); return true; }
    try {
        const w = await f.h.createWritable();
        await w.write(await blob.arrayBuffer());
        await w.close();
        if ((await f.h.getFile()).size === blob.size) return true;
    } catch (e) { console.error(e); }
    download(blob, f.name);
    return false;
}
const speedOf = (name, L1) => {
    if (!inp.dyn) return '-';
    if (L1.T[0].code === 2025) return L1.T[0].vmax;
    if (vList.includes(name)) { const v = scalarOr('iV', 120); return L1.T[0].code === 1919 ? Math.min(v, 100) : v; }
    return '-';
};
const lm71Rows = () => (inp.loadDist === '1-point' ? '4 point loads' : 'evenly distributed on 6.4 m');
const round = (v, d) => Number(v.toFixed(d));
// with an exponent in steps of three: 35E9
const expFmt = x => { const p = 3 * Math.floor(Math.log10(Math.abs(x)) / 3); return `${gfmt(x / 10 ** p)}E${p}`; };
async function onExport() {
    if (!ILa) return;
    const f = await pickFile('BeamStat.xlsx', 'xlsx');
    if (!f) return;
    try {
        const I0 = [['Quantity', 'Value', 'Unit'],
            ['Span lengths L', inp.L.map(gfmt).join(' '), 'm'],
            ['Flexural rigidity EI', inp.EI.map(expFmt).join(' '), 'Nm^2'],
            ['Element size dL', mdl.dL, 'm'],
            ['Load distribution', inp.loadDist, '-'],
            ['Triangle base b_Q', inp.b_Q, 'm'],
            ['LM71 axle loads', lm71Rows(), '-'],
            ['Clamped supports', sup.map((c, i) => (c ? i + 1 : 0)).filter(Boolean).join(' '), '-'],
            ['Dynamic factor applied', inp.dyn ? 'on' : 'off', '-'],
            ['alpha, LM71', scalarOr('iAlpha', 1.33), '-'],
            ['Speed v, where the factor depends on it', scalarOr('iV', 120), 'km/h']];
        const hd = ['Train', 'Phi (-)', 'L_phi (m)', 'v (km/h)', 'Wagons', 'M_max (kNm)', 'x (m)', 'M_min (kNm)', 'x (m)',
                    'V_max (kN)', 'x (m)', 'd_max (mm)', 'x (m)', 'phi_max (mrad)', 'x (m)', 'R_max (kN)', 'x (m)'];
        const T = allR.map((L, k) => [allN[k], round(L.phi, 2), round(L.Lphi, 2), speedOf(allN[k], L), L.T[0].nWagon,
            round(L.Mmax / 1e3, 0), L.xpeak.Mmax, round(L.Mmin / 1e3, 0), L.xpeak.Mmin,
            round(Math.abs(L.Vmax) / 1e3, 0), L.xpeak.Vmax, round(Math.abs(L.dmax) * 1e3, 1), L.xpeak.dmax,
            round(Math.abs(L.rmax) * 1e3, 1), L.xpeak.rmax, round(L.RFmax / 1e3, 0), L.xpeak.RFmax]);
        const res = [...I0, [], hd, ...T];

        const ILc = isOnlyLM71() && IL.pt ? Object.assign({}, IL, IL.pt) : IL;
        const iv = ILc.bc.map((b, i) => (b[1] === 1 ? i : -1)).filter(i => i >= 0);
        const il = [['Section x_p (m)', xp], [], ['x (m)', 'xi_M (m)', 'xi_V (-)', 'xi_d (mm/MN)', 'xi_phi (mrad/MN)', ...iv.map(i => `xi_R at x = ${gfmt(ILc.supX[i])} m (-)`)]];
        ILc.x.forEach((x, i) => il.push([x, ILc.M[0][i], ILc.V[0][i], ILc.d[0][i] * 1e9, ILc.r[0][i] * 1e9, ...iv.map(b => ILc.RF[b][i])]));

        const ff = [['M', 'kNm', 1e3, 0], ['V', 'kN', 1e3, 0], ['d', 'mm', 1e-3, 1], ['r', 'mrad', 1e-3, 1]];   // quantity, unit, scale, decimals
        const env = [];
        if (allR.length) {
            const he = ['x (m)'], Lr = allR[0];
            allN.forEach(n => ff.forEach(f => { he.push(`${n} ${f[0]}_min (${f[1]})`, `${n} ${f[0]}_max (${f[1]})`); }));
            env.push(he);
            Array.from(Lr.xp).forEach((x, j) => {
                const r = [x];
                allR.forEach(L => ff.forEach(f => r.push(round(L[f[0]][0][j] / f[2], f[3]), round(L[f[0]][1][j] / f[2], f[3]))));
                env.push(r);
            });
            env.push([]);
            const ivs = Lr.supDir.map((d, i) => (d === 1 ? i : -1)).filter(i => i >= 0);
            const hr = ['Support x (m)']; allN.forEach(n => hr.push(`${n} R_min (kN)`, `${n} R_max (kN)`));
            env.push(hr);
            ivs.forEach(i => { const r = [Lr.supX[i]]; allR.forEach(L => r.push(round(L.RF[0][i] / 1e3, 0), round(L.RF[1][i] / 1e3, 0))); env.push(r); });
        }
        const blob = XLSX.write([{ name: 'Results', rows: res }, { name: 'InfluenceLines', rows: il }, { name: 'Envelopes', rows: env }]);
        setMsg(await writeFile(f, blob) ? 'saved' : `could not write ${f.name}, downloaded instead`);
    } catch (e) { setMsg('export failed', RED); console.error(e); }
}
const isOnlyLM71 = () => sel.length === 1 && sel[0] === 'LM71';

// ============================================================ print
// several trains: with a page per train, or only the model and the results table
function askReport() {
    return new Promise(resolve => {
        const d = $('dlg');
        d.innerHTML = '<p>Report with the plots of each load model, or only the model and the results table?</p><div></div>';
        for (const t of ['Full report', 'Results table', 'Cancel']) {
            const b = document.createElement('button');
            b.textContent = t;
            b.addEventListener('click', ev => { ev.stopPropagation(); d.style.display = 'none'; resolve(t); });
            d.lastChild.appendChild(b);
        }
        d.addEventListener('click', ev => ev.stopPropagation());
        d.style.display = 'block';
    });
}
const newSvg = (w, h) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return svg;
};
// the results of a train at its critical sections, with the reaction as a plot of its own
function critSvg(L1) {
    let q4 = qtyName(); if (q4 === 'RF') q4 = 'd';
    const nms = ['Mmax', 'Mmin', 'Vmax', q4 + 'max', 'RFmax'], np = nms.length, gp = 10, y0 = 52, hp = 106, H = y0 + np * hp + (np - 1) * gp + 6;
    const svg = newSvg(700, H);
    nms.forEach((n, i) => {
        const ax = new PL.Axes(svg, { x: 80, y: 6 + i * (hp + gp), w: 590, h: hp }, { xTickLabels: i === np - 1, pick: false });
        ax.xlim = [-0.02 * mdl.Ltot, 1.02 * mdl.Ltot];
        if (i === np - 1) ax.xlabel = '$x$ (m)';
        drawLoad(ax, L1, L1.pos[n], n.replace(/(max|min)$/, ''), false, n);
        ax.draw();
    });
    return svg;
}
// the load model: axle loads as arrows with their value (kN), distributed loads as bands,
// cars as red dotted boxes, dimension lines below (m)
function trainSvg(name) {
    let rows = [[name, 1, '']];
    if (name === '85F') rows = [['F', 0.85, '0.85 F, or'], ['LG1', 1, 'LG1']];
    if (name === '60F') rows = [['F', 0.60, '0.60 F, or'], ['LG2', 1, 'LG2']];
    const hr = 150 - (rows.length > 1 ? 30 : 0), svg = newSvg(700, rows.length * hr);
    rows.forEach((r, i) => drawTrain(svg, { x: 20, y: i * hr + 2, w: 660, h: hr - 4 }, BS.trainModel(r[0], 0), r[1], r[2], r[0] === 'LM71' && inp.loadDist !== '1-point'));
    return svg;
}
function drawTrain(svg, b, T, fac, lbl, blk) {
    let xa = T.x.slice(), Pa = T.P.map(v => fac * v / 1e3), Pe = T.Pe.map(v => fac * v / 1e3);
    const q = fac * T.q / 1e3, qe = fac * T.qe / 1e3;
    let bk = [], qb = 0;
    if (blk) { bk = [xa[0] - 0.8, xa[xa.length - 1] + 0.8]; qb = Pa.reduce((p, c) => p + c, 0) / (bk[1] - bk[0]); xa = []; Pa = []; Pe = []; }
    const sg = q === 0 ? [] : T.qseg, fin = sg.flat().filter(isFinite), vb = T.vb;
    let pts = [...xa, ...vb.flat(), ...fin, ...bk];
    if (!pts.length) pts = [0, 10];
    let a = Math.min(...pts), c = Math.max(...pts);
    if (!vb.length && !sg.length) { a -= 1; c += 1; }
    const ext = Math.max(0.15 * (c - a), 2.5);
    const xl = [a - (sg.some(s => !isFinite(s[0])) ? ext : 0), c + (sg.some(s => !isFinite(s[1])) ? ext : 0)];
    const wd = xl[1] - xl[0], X0 = xl[0] - 0.01 * wd, X1 = xl[1] + 0.01 * wd, dx = (X1 - X0) / b.w, Ylo = -1.15, Yhi = 1.75, dy = (Yhi - Ylo) / b.h;
    const X = x => b.x + (x - X0) / (X1 - X0) * b.w, Y = y => b.y + b.h - (y - Ylo) / (Yhi - Ylo) * b.h;
    const line = (x1, y1, x2, y2, col, w, dash) => {
        const o = { x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), stroke: col, 'stroke-width': w };
        if (dash) o['stroke-dasharray'] = dash;
        PL.el('line', o, svg);
    };
    const txt = (s, x, y, anchor, base) => PL.text(svg, s, X(x), Y(y), { size: 12, anchor: anchor || 'middle', baseline: base || 'text-after-edge' });
    line(xl[0], 0, xl[1], 0, '#808080', 0.5);
    const hq = 0.45 * q / Math.max(q, qb, Number.EPSILON);
    sg.forEach(s => {
        const x1 = Math.max(s[0], xl[0]), x2 = Math.min(s[1], xl[1]);
        if (x2 <= x1) return;
        PL.el('polygon', { points: `${X(x1)},${Y(0)} ${X(x1)},${Y(hq)} ${X(x2)},${Y(hq)} ${X(x2)},${Y(0)}`, fill: co[1], 'fill-opacity': 0.25 }, svg);
        line(x1, hq, x2, hq, co[1], 0.5);
        if (isFinite(s[0])) line(x1, 0, x1, hq, co[1], 0.5);
        if (isFinite(s[1])) line(x2, 0, x2, hq, co[1], 0.5);
        if ((x2 - x1) / dx > 45) {
            const two = qe > 0 && qe !== q, xm = (x1 + x2) / 2;
            if (two) { txt(`empty ${gfmt(Number(qe.toFixed(1)))} kN/m`, xm, hq + 3 * dy); txt(`${gfmt(Number(q.toFixed(1)))} kN/m`, xm, hq + 16 * dy); }
            else txt(`${gfmt(Number(q.toFixed(1)))} kN/m`, xm, hq + 3 * dy);
        }
    });
    if (bk.length) {
        PL.el('polygon', { points: `${X(bk[0])},${Y(0)} ${X(bk[0])},${Y(0.9)} ${X(bk[1])},${Y(0.9)} ${X(bk[1])},${Y(0)}`, fill: co[1], 'fill-opacity': 0.25, stroke: co[1], 'stroke-width': 0.5 }, svg);
        txt(`${gfmt(qb)} kN/m`, (bk[0] + bk[1]) / 2, 0.9 + 3 * dy);
    }
    if (xa.length) {
        const Pm = Math.max(...Pa);
        xa.forEach((v, i) => {
            const aL = Pa[i] / Pm;
            line(v, aL, v, 0, co[1], 0.8);
            PL.el('polygon', { points: `${X(v)},${Y(0)} ${X(v) - 2},${Y(0) - 5} ${X(v) + 2},${Y(0) - 5}`, fill: co[1] }, svg);
            txt(Pa[i].toFixed(0), v, aL + 2 * dy);
        });
    }
    vb.forEach((s, i) => {
        const x1 = X(s[0]) + 2, x2 = X(s[1]) - 2, y1 = Y(1.35), y0 = Y(0);
        PL.el('path', { d: `M${x1} ${y0}V${y1}H${x2}V${y0}H${x1}`, fill: 'none', stroke: cCar, 'stroke-width': 0.8, 'stroke-dasharray': '1 2' }, svg);
        let ew = false, pe = 0;
        T.veh.forEach((v, k) => { if (v === i + 1 && T.isW[k] && Pe[k] > 0 && Pe[k] !== Pa[k]) { ew = true; pe = Math.max(pe, Pe[k]); } });
        if (ew) txt(`empty ${pe.toFixed(0)} kN/axle`, (s[0] + s[1]) / 2, 1.38);
    });
    if (lbl) PL.text(svg, lbl, X(xl[0]), Y(1.72), { size: 13.3, baseline: 'hanging' });
    const chain = (pos, y) => {
        if (pos.length < 2) return;
        line(pos[0], y, pos[pos.length - 1], y, '#000', 0.4);
        pos.forEach(p => {
            PL.el('line', { x1: X(p), y1: Y(y) + 5, x2: X(p), y2: Y(y) - 7, stroke: '#000', 'stroke-width': 0.4 }, svg);
            PL.el('line', { x1: X(p) - 3, y1: Y(y) + 3, x2: X(p) + 3, y2: Y(y) - 3, stroke: '#000', 'stroke-width': 0.4 }, svg);
        });
        for (let i = 0; i + 1 < pos.length; i++) txt(gfmt(Number((pos[i + 1] - pos[i]).toFixed(2))), (pos[i] + pos[i + 1]) / 2, y + dy);
    };
    const uq = A => [...new Set(A.map(v => Number(v.toFixed(3))))].sort((p, r) => p - r);
    chain(uq(pts), -0.42);
    if (vb.length) chain(uq(vb.flat()), -0.92);
}
function loadDistTex() {
    const w = BS.loadDistribution(inp.loadDist, inp.b_Q).w.map(x => (100 * x).toFixed(1)).join('/');
    let s;
    switch (inp.loadDist) {
        case '1-point': s = 'Axle loads as point loads.'; break;
        case '3-point': s = `Each axle load distributed by the rail over three sleepers at 0.6 m, ${w} % (EN 1991-2:2024, 8.3.6.2).`; break;
        case '5-point': s = `Each axle load distributed over five sleepers at 0.6 m as the deflection of the rail on an elastic (Winkler) foundation, rail 60E1, track stiffness 100 MN/m per rail, ${w} %.`; break;
        default: s = `Each axle load distributed as a triangle of base $b_Q$ = ${gfmt(inp.b_Q)} m.`;
    }
    if (inp.loadDist !== '1-point') s += ' LM71 instead has its four axle loads evenly distributed on 6.4 m.';
    return s;
}
async function onReport() {
    if (!ILa) return;
    let full = true;
    if (allN.length > 1) {
        const a = window.__reportChoice || await askReport();
        if (a === 'Cancel') return;
        full = a === 'Full report';
    }
    const f = await pickFile(allN.length === 1 ? `${allN[0].replace('/', '')}_load_effect.pdf` : 'load_effect.pdf', 'pdf');
    if (!f) return;
    progStart();
    setProg(null); setMsg('writing the report ...');
    await nextFrame();
    let msg = 'report saved', col;
    try {
        const D = await buildReport(full);
        if (D === null) { setProg(null); msg = 'cancelled'; }
        else {
            const ok = await writeFile(f, await D.blob());
            if (!ok) msg = `could not write ${f.name}, downloaded instead`;
        }
    } catch (e) { msg = 'report failed'; col = RED; console.error(e); }
    progEnd();
    setMsg(msg, col);
}
// the report as a PDF document; one bookmark per page.  null: cancelled
async function buildReport(full) {
    const multi = allR.length > 1, clamped = sup.map((c, i) => (c ? i + 1 : 0)).filter(Boolean);
    const num = x => gfmt(Number(x.toPrecision(3)));
    const sci = x => { const p = Math.floor(Math.log10(Math.abs(x))); return p >= -2 && p <= 3 ? num(x) : `$${gfmt(Number((x / 10 ** p).toFixed(4)))} \\cdot 10^{${p}}$`; };
    const D = new PDF.Doc('Railway Bridge Static Load Effects');
    D.h1('Railway Bridge Static Load Effects');
    D.h2('Basis', { bookmark: 'Basis, model and input' });
    D.p('Static load effects of a railway bridge from influence lines: peak bending moment, shear force, displacement, end rotation and support reaction of each train load model over all train positions and both running directions. Wagons are loaded or empty, the train is shortened, and distributed loads are placed, in the most unfavourable way allowed by each model, with as many wagons as the bridge needs.');
    D.p(inp.dyn
        ? "The dynamic factor of each model is applied, not on displacement and rotation: $\\Phi_2$ for LM71, SW/0 and SW/2 (EN 1991-2:2024, 8.4.5.2); $1 + \\varphi' + 0.5\\varphi''$ for the EN 15528 wagons (Annex C) and TLM1–3 (TRVINFRA-00331, 8.3.3.2.5), with the larger sum of the upper and lower limit of the natural frequency; the formula of the standard for the older models. Determinant length $L_\\Phi$ from EN 1991-2:2024 Table 8.2, 5.2, and used as the length $l$ of the older standards."
        : 'No dynamic factor is applied.');

    const stx = clamped.length ? `support${clamped.length > 1 ? 's' : ''} ${clamped.join(', ')} clamped, the others pinned` : 'all supports pinned';
    D.h2('Structural model');
    D.p(`2D Bernoulli-Euler beam, ${rnd(mdl.Ltot / mdl.dL)} elements of ${num(mdl.dL)} m, ${stx}. The influence lines are exact at the nodes, and the axles stand on nodes, so that axle spacings the element length does not divide are rounded. ${loadDistTex()} Model in figure 1.`);
    const sm = newSvg(700, 170), mm = drawModel(sm, { x: 20, y: 5, w: 660, h: 160 }, { size: 14.7 });
    markPeaks(showMode() !== 'Section', mm, sm);
    if (showMode() === 'Section') { mm.mk = PL.el('g', { transform: `translate(${mm.X(xp)} ${mm.Y(0)})` }, sm); drawMarker(mm); }
    D.figure(sm, 'Model, dimensions in m.');

    const rows = [['Spans, $L$', inp.L.map(gfmt).join(' + '), 'm'], ['Flexural rigidity, $EI$', inp.EI.map(sci).join(', '), 'Nm$^2$'],
                  ['Element length, d$L$', num(mdl.dL), 'm'], ['Load distribution', inp.loadDist.toLowerCase(), '–']];
    if (inp.loadDist === 'Triangular') rows.push(['Triangle base, $b_Q$', num(inp.b_Q), 'm']);
    if (allN.includes('LM71')) rows.push(['Load classification factor LM71, $\\alpha$', gfmt(scalarOr('iAlpha', 1.33)), '–']);
    if (inp.dyn && allN.some(n => vList.includes(n))) rows.push(['Train speed, $v$', gfmt(scalarOr('iV', 120)), 'km/h']);
    D.h2('Input');
    D.table('Bridge and train load.', ['', 'Value', 'Unit'], rows, ['', 'r', '']);

    D.h2('Results', { newPage: true, bookmark: 'Results' });
    const vt = (() => {
        if (!sel.length) return `influence lines at $x$ = ${num(xp)} m`;
        const tr = sel[0];
        if (showMode() === 'Envelope') return `envelopes of train ${tr}`;
        if (showMode() === 'Critical') return `influence lines and governing arrangement of train ${tr} at the critical sections`;
        return `influence lines and governing arrangement of train ${tr} at $x$ = ${num(xp)} m`;
    })();
    if (multi) D.p(`Peak values over the bridge per train load model in table ${D.nt + 1}, ${full ? 'each load model on the following pages' : 'influence lines at the critical sections on the next page'}.`);
    else if (!allR.length) D.p(`No train is ticked: ${vt} in figure ${D.nf + 1}.`);
    else D.p(`Peak values over the bridge per train load model in table ${D.nt + 1}, ${vt} in figure ${D.nf + 1}.`);
    if (allR.length) {
        const neg = v => (v < 0 ? '−' + (-v).toFixed(0) : v.toFixed(0));
        D.table('Peak values.', ['Train', '$\\Phi$', '$M_\\mathrm{max}$ (kNm)', '$M_\\mathrm{min}$ (kNm)', '$V_\\mathrm{max}$ (kN)', '$d_\\mathrm{max}$ (mm)', '$\\phi_\\mathrm{max}$ (mrad)', '$R_\\mathrm{max}$ (kN)'],
            allR.map((L, k) => [allN[k], L.phi.toFixed(2), (L.Mmax / 1e3).toFixed(0), neg(L.Mmin / 1e3), (Math.abs(L.Vmax) / 1e3).toFixed(0), (Math.abs(L.dmax) * 1e3).toFixed(1), (Math.abs(L.rmax) * 1e3).toFixed(1), (L.RFmax / 1e3).toFixed(0)]),
            ['', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
    }
    if (multi && !full) {
        D.h2('Critical sections', { newPage: true, bookmark: 'Critical sections' });
        D.figure(critSvg(LE), 'Influence lines and governing train at the critical sections.');
    } else if (multi) {
        for (let k = 0; k < allR.length; k++) {
            setProg(k / allR.length); setMsg(`${allN[k]}: ${k + 1}/${allR.length}`);
            await nextFrame();
            if (ui.stopReq) return null;
            const L1 = allR[k], t = `Load model ${allN[k]}`;
            D.h2(t, { newPage: true, bookmark: t });
            D.figure(trainSvg(allN[k]), 'Load model, axle loads in kN, dimensions in m.');
            let fx = inp.dyn ? (dynOne(L1) + '.') : `No dynamic factor applied, $L_\\Phi$ = ${L1.Lphi.toFixed(1)} m.`;
            if (allN[k] === 'LM71') fx += ` Load classification factor $\\alpha$ = ${gfmt(scalarOr('iAlpha', 1.33))} on the loads.`;
            D.p(fx);
            D.figure(critSvg(L1), 'Influence lines and governing arrangement at the critical sections.');
        }
        setProg(1);
    } else {
        // the plots as shown, stacked
        let md = showMode(); if (md !== 'Section' && !LE) md = 'Section';
        const set = n => {
            const hp = Math.round((130 * 4 + 12 * 3 - 12 * (n - 1)) / n), H0 = 8 + n * hp + (n - 1) * 12 + 52, svg = newSvg(700, H0);
            set.svg = svg;
            return Array.from({ length: n }, (_, k) => {
                const ax = new PL.Axes(svg, { x: 80, y: 8 + k * (hp + 12), w: 590, h: hp }, { xTickLabels: k === n - 1, pick: false });
                ax.xlim = [-0.02 * mdl.Ltot, 1.02 * mdl.Ltot];
                if (k === n - 1) ax.xlabel = '$x$ (m)';
                return ax;
            });
        };
        render(md, set);
        D.figure(set.svg, vt[0].toUpperCase() + vt.slice(1) + '.');
    }
    return D;
}

// ============================================================ start
window.__beamstat = { get state() { return { inp, mdl, sel, allN, allR, LE, IL, ILa, xp, jx, busy: ui.busy, stopOn: ui.stopOn, nWorkers }; }, onCancel };
setDefaults();
readInput();

(async () => {
    await updateModel();
    setProg(null); setMsg('');                                   // the start-up run is not one the user asked for
})();
})();
