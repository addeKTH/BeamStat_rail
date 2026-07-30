/* ------------------------------------------------------------------------
   app.js - the interactive part, standing in for Main_gui_static.m

   Same architecture as the MATLAB GUI.  The influence lines are solved once
   per model over a whole grid of sections; the marker only picks a column
   out of that, and LoadEffect is run on that single column, which is a sweep
   over train positions and nothing else.  The envelope is run once per model
   and train over about 120 of the same columns, and gives the fixed axis
   limits and the critical sections.
   --------------------------------------------------------------------- */
(function () {
'use strict';

const $ = id => document.getElementById(id);
const NMAX = 1e6;                       // entries allowed in one cached matrix

const S = {
    L: [24, 30, 24], EI: [30e9], dL: 0.2, w: 0, shp: 'rect',
    clamped: [false, false, false, false],
    train: 'none', nWagon: 10, dyn: true,
    qty: 'd', peak: 'max', show: 'section', xp: 39
};

let ILa = null, grid = [], env = [], rng = {}, ENV = null;
let sIL = '', sEN = '', jx = 0, dragging = false, busy = false;

/* ---------------------------------------------------------------- units */
function unit(q) {
    switch (q) {
        case 'M':  return { sc: 1e3,  uv: 'kNm',  sy: 'M', il: 'Nm' };
        case 'V':  return { sc: 1e3,  uv: 'kN',   sy: 'V', il: 'N' };
        case 'd':  return { sc: 1e-3, uv: 'mm',   sy: '\u03b4', il: 'm' };
        case 'r':  return { sc: 1e-3, uv: 'mrad', sy: '\u03b8', il: 'rad' };
        case 'RF': return { sc: 1e3,  uv: 'kN',   sy: 'R', il: 'N' };
    }
    return { sc: 1, uv: '', sy: 'X', il: '' };
}
/* M, V and the reactions as whole kNm and kN, d and r to one decimal */
function fmt(q, v) {
    const u = unit(q);
    return (q === 'd' || q === 'r') ? (v / u.sc).toFixed(1) + ' ' + u.uv
                                    : (v / u.sc).toFixed(0) + ' ' + u.uv;
}
const SUB = { max: '\u2098\u2090\u2093', min: '\u2098\u1d62\u2099' };
const msg = (t, cls) => { const m = $('msg'); m.textContent = t; m.className = cls || ''; };

/* ------------------------------------------------------------ read input */
const num = s => (s || '').trim().split(/[\s,]+/).map(Number).filter(isFinite);

function readInput() {
    const L = num($('inL').value), EI = num($('inEI').value);
    const dL = +$('indL').value, w = +$('inW').value, nw = +$('inWag').value;
    if (!L.length || L.some(v => !(v > 0))) return false;
    if (!EI.length || EI.some(v => !(v > 0))) return false;
    if (EI.length !== 1 && EI.length !== L.length) return false;
    if (!(dL > 0) || dL > Math.min.apply(null, L)) return false;
    if (!(w >= 0) || !(nw >= 0)) return false;
    S.L = L; S.EI = EI; S.dL = dL; S.w = w; S.nWagon = Math.round(nw);
    S.shp   = $('inShp').value;
    S.train = $('inTrain').value;
    S.dyn   = $('inPhi').checked;
    S.qty   = $('inQty').value;
    S.peak  = $('inPeak').value;
    S.show  = $('inShow').value;
    const xv = +$('inXp').value;
    if (isFinite(xv)) S.xp = xv;
    if (S.clamped.length !== L.length + 1) S.clamped = new Array(L.length + 1).fill(false);
    $('inShp').disabled = !(w > 0);
    $('inWag').disabled = !Trains.usesWagons(S.train);
    $('inPhi').disabled = (S.train === 'none');
    return true;
}

const supX = () => { const o = [0]; S.L.forEach(v => o.push(o[o.length - 1] + v)); return o; };
const Ltot = () => S.L.reduce((a, b) => a + b, 0);
function bcRows() {
    const xs = supX(), bc = [];
    xs.forEach((x, i) => { bc.push([x, 1, 0]); if (S.clamped[i]) bc.push([x, 2, 0]); });
    return bc.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/* ------------------------------------------------------- influence lines */
function buildIL() {
    const sig = JSON.stringify([S.L, S.EI, S.dL, S.w, S.shp, S.clamped]);
    if (sig === sIL && ILa) return;
    const Lt = Ltot(), nEL = Math.round(Lt / S.dL), dL = Lt / nEL;
    const nc  = Math.max(Math.round(NMAX / (nEL + 1)), 120);
    const stp = Math.max(1, Math.ceil((nEL + 1) / nc));
    const xs  = supX(), spec = [];
    xs.forEach(v => spec.push(v, Math.max(v - dL, 0), Math.min(v + dL, Lt)));
    for (let i = 0; i < xs.length - 1; i++) spec.push((xs[i] + xs[i + 1]) / 2);
    const set = new Set();
    for (let i = 0; i <= nEL; i += stp) set.add(i);
    spec.forEach(v => set.add(Math.round(v / dL)));
    grid = Array.from(set).sort((a, b) => a - b).map(i => i * dL);

    const t0 = performance.now();
    ILa = Beam.influenceLine({ L: S.L, EI: S.EI, dL: S.dL, bc: bcRows(),
                               w: S.w, shp: S.shp, xp: grid });
    ILa.Ltot = Lt;
    grid = ILa.xp;
    sIL = sig; sEN = ''; ENV = null;

    rng = {};
    ['M', 'V', 'd', 'r'].forEach(q => {
        let a = Infinity, b = -Infinity;
        ILa[q].forEach(c => { for (let i = 0; i < c.length; i++) { if (c[i] < a) a = c[i]; if (c[i] > b) b = c[i]; } });
        rng[q] = [a, b];
    });
    { let a = Infinity, b = -Infinity;
      vsupIdx().forEach(i => { const c = ILa.RF[i];
          for (let k = 0; k < c.length; k++) { if (c[k] < a) a = c[k]; if (c[k] > b) b = c[k]; } });
      rng.RF = [a, b]; }

    const n2 = grid.length, st2 = Math.max(1, Math.round(n2 / 120));
    const e = new Set();
    for (let i = 0; i < n2; i += st2) e.add(i);
    e.add(n2 - 1);
    spec.forEach(v => { for (let k = 0; k < n2; k++) if (Math.abs(grid[k] - v) < 1e-9) e.add(k); });
    env = Array.from(e).sort((a, b) => a - b);

    let t = 'influence lines: ' + grid.length + ' sections, ' + (performance.now() - t0).toFixed(0) + ' ms';
    if (ILa.snap > 1e-6) t = 'supports snapped to the grid, by up to ' + ILa.snap.toFixed(3) + ' m';
    msg(t, ILa.snap > 1e-6 ? 'warn' : '');
    setSection(nearest(S.xp));
}
function vsupIdx() { const o = []; ILa.supDir.forEach((d, i) => { if (d === 1) o.push(i); }); return o; }
function vsupX()   { return vsupIdx().map(i => ILa.supX[i]); }
function nearest(x) {
    let j = 0, b = Infinity;
    for (let i = 0; i < grid.length; i++) { const d = Math.abs(grid[i] - x); if (d < b) { b = d; j = i; } }
    return j;
}
function setSection(j) {
    jx = Math.min(Math.max(j, 0), grid.length - 1);
    S.xp = grid[jx];
    $('inXp').value = Math.round(S.xp * 1e4) / 1e4;
}

/* an influence line struct holding only the given columns */
function ilAt(idx) {
    return { M: idx.map(i => ILa.M[i]), V: idx.map(i => ILa.V[i]),
             d: idx.map(i => ILa.d[i]), r: idx.map(i => ILa.r[i]), RF: ILa.RF,
             x: ILa.x, dL: ILa.dL, xp: idx.map(i => grid[i]),
             supX: ILa.supX, supDir: ILa.supDir, Ltot: ILa.Ltot };
}
const opts = () => ({ nWagon: S.nWagon, dyn: S.dyn });

/* --------------------------------------------------- the load effect */
function calcEnv() {
    const sig = sIL + '|' + S.train + '|' + S.nWagon + '|' + S.dyn;
    if (sig === sEN && ENV) return;
    if (S.train === 'none') { ENV = null; sEN = ''; return; }
    msg('computing envelope...', '');
    const t0 = performance.now();
    ENV = LoadEffect.loadEffect(ilAt(env), S.train, opts());
    sEN = sig;
    let t = ENV.type + ':  phi = ' + ENV.phi.toFixed(3) + '   L_phi = ' + ENV.Lphi.toFixed(1) +
            ' m   (' + (performance.now() - t0).toFixed(0) + ' ms)';
    msg(ENV.warn.length ? ENV.warn[0] : t, ENV.warn.length ? 'warn' : '');
}

/* the influence lines dressed as a LoadEffect output, so that the same
   drawing serves whether or not a train has been chosen */
function bareLE(q) {
    let h, xc;
    if (q === 'RF') {
        const iv = vsupIdx(), v = vsupX();
        let j = 0, b = Infinity;
        v.forEach((s, i) => { const d = Math.abs(s - S.xp); if (d < b) { b = d; j = i; } });
        h = ILa.RF[iv[j]]; xc = v[j];
    } else { h = ILa[q][jx]; xc = S.xp; }
    return { quant: q, h, x: xc, val: 0, q: 0, xa: [], Pa: [], emp: [],
             w: null, bare: true };
}

/* --------------------------------------------------------------- drawing */
function ylimFor(q, withTrain) {
    const r = rng[q], rg = Math.max(Math.abs(r[0]), Math.abs(r[1])) || 1;
    let hi = Math.max(r[1], 0);
    if (withTrain) hi = Math.max(hi, 0.30 * rg);
    return [Math.min(r[0], 0) - 0.10 * rg, hi + 0.12 * rg];
}
function peakName(LEp, q) {
    const n = q + S.peak;
    return (LEp && LEp.pos && LEp.pos[n]) ? n : q + 'max';
}

function render() {
    const Lt = Ltot(), qs = ['M', 'V', S.qty];
    const hasT = !!ENV && S.train !== 'none';
    const mode = (hasT || S.show === 'section') ? S.show : 'section';
    const xlim = [-0.02 * Lt, 1.02 * Lt];

    /* the critical sections, marked on the sketch */
    let peaks = [];
    if (hasT && mode !== 'section') {
        const nm = ['Mmax', 'Mmin', 'Vmax'];
        if (S.qty === 'RF') nm.push('RFmax', 'RFmin'); else nm.push(S.qty + 'max');
        peaks = nm.map(n => {
            const q = n.replace(/(max|min)$/, '');
            return { x: ENV.xpeak[n], label: unit(q).sy + SUB[n.slice(-3)] };
        });
    }
    Plot.beam($('cvBeam'), { L: S.L, xs: supX(), clamped: S.clamped, Ltot: Lt,
                             section: S.xp, showSection: mode === 'section', peaks });

    /* the load effect at the marker: one section, so it costs a sweep only */
    let LEs = null;
    if (hasT && mode === 'section') LEs = LoadEffect.loadEffect(ilAt([jx]), S.train, opts());

    const cv = ['cv1', 'cv2', 'cv3'].map($);
    for (let k = 0; k < 3; k++) {
        const q = qs[k], u = unit(q);
        const p = { xlim, xticks: k === 2, supports: vsupX(), section: null };

        if (mode === 'envelope') {
            const isR = q === 'RF';
            const xe = isR ? vsupX() : ENV.xp;
            const E  = ENV[q];
            const iv = isR ? vsupIdx().map((_, i) => i) : null;
            p.x  = xe;
            p.y  = Array.from(isR ? pickRows(E.max) : E.max, v => v / u.sc);
            p.y2 = Array.from(isR ? pickRows(E.min) : E.min, v => v / u.sc);
            p.fill = !isR; p.marks = isR;
            let a = Infinity, b = -Infinity;
            p.y.concat(p.y2).forEach(v => { a = Math.min(a, v); b = Math.max(b, v); });
            const rg2 = Math.max(b - a, 1e-12);
            p.ylim = [a - 0.12 * rg2, b + 0.18 * rg2];
            p.ylabel = u.sy + ' (' + u.uv + ')';
            let kx = 0, kn = 0;
            p.y.forEach((v, i) => { if (v > p.y[kx]) kx = i; });
            p.y2.forEach((v, i) => { if (v < p.y2[kn]) kn = i; });
            p.peaks = [{ x: xe[kx], y: p.y[kx], up: true }, { x: xe[kn], y: p.y2[kn], up: false }];
            p.title = u.sy + SUB.max + ' = ' + fmt(q, p.y[kx] * u.sc) + ' at x = ' + xe[kx].toFixed(1) +
                      ' m,   ' + u.sy + SUB.min + ' = ' + fmt(q, p.y2[kn] * u.sc) + ' at x = ' + xe[kn].toFixed(1) + ' m';
        } else {
            const LEp = (mode === 'critical') ? ENV : LEs;
            const C = hasT ? LEp.pos[peakName(LEp, q)] : bareLE(q);
            let rg = 0;
            for (let i = 0; i < C.h.length; i++) rg = Math.max(rg, Math.abs(C.h[i]));
            p.x = ILa.x; p.y = C.h; p.rg = rg || 1;
            p.ylim = ylimFor(q, hasT);
            p.ylabel = '\u03be' + u.sy + ' (' + u.il + ')';
            p.section = C.x;
            if (hasT) {
                p.axles = C.xa.map((v, i) => ({ x: v, P: C.Pa[i], emp: C.emp[i] }));
                if (C.q > 0) p.band = { w: C.w, q: C.q };
                p.title = unit(C.quant).sy + SUB[C.name.slice(-3)] + ' = ' + fmt(q, C.val) +
                          ' at x = ' + C.x.toFixed(1) + ' m';
            } else {
                p.title = 'influence line at x = ' + C.x.toFixed(1) + ' m';
            }
        }
        Plot.panel(cv[k], p);
    }
}
/* the RF envelope has one row per boundary condition; only the vertical
   supports are comparable, which is what LoadEffect uses for its peaks too */
function pickRows(a) { return vsupIdx().map(i => a[i]); }

/* ---------------------------------------------------------------- update */
function update(full) {
    if (busy) return;
    if (!readInput()) { msg('input error', 'warn'); return; }
    busy = true;
    try {
        if (full) buildIL();
        calcEnv();
        if (S.show !== 'section' && !ENV) { S.show = 'section'; $('inShow').value = 'section'; }
        render();
    } catch (e) {
        msg(e.message, 'warn');
    }
    busy = false;
}

/* ----------------------------------------------------------- interaction */
function beamHit(ev) {
    const cv = $('cvBeam'), r = cv.getBoundingClientRect();
    const Lt = Ltot(), x0 = -0.02 * Lt, x1 = 1.02 * Lt;
    return { x: x0 + (ev.clientX - r.left - Plot.ML) / (cv.clientWidth - Plot.ML - Plot.MR) * (x1 - x0),
             below: (ev.clientY - r.top) > r.height * 0.44 };
}
function onDown(ev) {
    if (busy) return;
    const hit = beamHit(ev), xs = supX();
    let j = 0, b = Infinity;
    xs.forEach((s, i) => { const d = Math.abs(s - hit.x); if (d < b) { b = d; j = i; } });
    if (b < 0.03 * Ltot() && (hit.below || ev.button === 2)) {
        S.clamped[j] = !S.clamped[j];
        sIL = '';
        update(true);
        return;
    }
    if (S.show !== 'section') return;
    dragging = true;
    $('cvBeam').setPointerCapture(ev.pointerId);
    onMove(ev);
}
function onMove(ev) {
    if (!dragging || busy) return;
    const j = nearest(beamHit(ev).x);
    if (j === jx) return;
    setSection(j);
    busy = true;
    try { render(); } catch (e) { msg(e.message, 'warn'); }
    busy = false;
}
function onUp(ev) {
    if (!dragging) return;
    dragging = false;
    try { $('cvBeam').releasePointerCapture(ev.pointerId); } catch (e) {}
}

/* ------------------------------------------------------------- save max */
function saveMax() {
    if (!ILa || busy) return;
    const models = Trains.TYPES.slice();
    const rows = [['Load model', 'Mmax (kNm)', 'x (m)', 'Mmin (kNm)', 'x (m)',
                   'Vmax (kN)', 'x (m)', 'dmax (mm)', 'x (m)', 'rmax (mrad)', 'x (m)',
                   'RFmax (kN)', 'phi (-)']];
    const ILe = ilAt(env);
    let i = 0, nb = 0;
    busy = true;
    $('btnMax').disabled = true;

    const step = () => {
        if (i >= models.length) {
            const info = [['L (m)', S.L.join(' ')], ['EI (Nm^2)', S.EI.join(' ')],
                          ['dL (m)', ILa.dL], ['w (m)', S.w], ['shape', S.shp],
                          ['supports (m)', supX().join(' ')],
                          ['support b.c.', S.clamped.map(c => c ? 'clamped' : 'pinned').join(' ')],
                          ['wagons', S.nWagon],
                          ['dynamic factor applied', S.dyn ? 'yes' : 'no'],
                          ['sections', env.length],
                          ['created', new Date().toISOString().slice(0, 16).replace('T', ' ')]];
            Xlsx.save([{ name: 'Peaks', rows }, { name: 'Model', rows: info }], 'peaks.xlsx');
            msg(nb ? 'saved peaks.xlsx, ' + nb + ' load model(s) failed' : 'saved peaks.xlsx',
                nb ? 'warn' : 'ok');
            busy = false; $('btnMax').disabled = false;
            return;
        }
        const name = models[i++];
        msg('save max:  ' + i + '/' + models.length + '  ' + name, '');
        const row = [name];
        try {
            const r = LoadEffect.loadEffect(ILe, name, opts());
            const one = (q, nm, withX) => {
                const u = unit(q), v = r[nm] / u.sc;
                row.push((q === 'd' || q === 'r') ? Math.round(v * 10) / 10 : Math.round(v));
                if (withX) row.push(Math.round(r.xpeak[nm] * 100) / 100);
            };
            one('M', 'Mmax', true);  one('M', 'Mmin', true);  one('V', 'Vmax', true);
            one('d', 'dmax', true);  one('r', 'rmax', true);  one('RF', 'RFmax', false);
            row.push(Math.round(r.phi * 1000) / 1000);
        } catch (e) { nb++; }
        rows.push(row);
        setTimeout(step, 0);                    // let the page breathe
    };
    setTimeout(step, 0);
}

/* ------------------------------------------------------------------ wire */
function init() {
    const T = $('inTrain');
    ['none'].concat(Trains.TYPES).forEach(n => {
        const o = document.createElement('option'); o.value = o.textContent = n; T.appendChild(o);
    });
    T.value = 'none';

    /* the heavier models take a moment; yield first so that the message
       shows before the envelope is computed */
    const deferred = () => { msg('computing...', ''); setTimeout(() => update(true), 0); };
    ['inL', 'inEI', 'indL', 'inW', 'inShp', 'inTrain', 'inWag', 'inPhi']
        .forEach(id => $(id).addEventListener('change', deferred));
    ['inQty', 'inPeak', 'inShow'].forEach(id => $(id).addEventListener('change', () => update(false)));
    $('inXp').addEventListener('change', () => { setSection(nearest(+$('inXp').value)); update(false); });

    const cv = $('cvBeam');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
        if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
        if (S.show !== 'section' || busy) return;
        const s = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft')  { setSection(jx - s); update(false); e.preventDefault(); }
        if (e.key === 'ArrowRight') { setSection(jx + s); update(false); e.preventDefault(); }
    });
    window.addEventListener('resize', () => { if (ILa && !busy) { busy = true; try { render(); } finally { busy = false; } } });
    $('btnMax').addEventListener('click', saveMax);
    $('btnReset').addEventListener('click', () => location.reload());

    update(true);
}
document.addEventListener('DOMContentLoaded', init);

})();
