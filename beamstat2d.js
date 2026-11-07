/* beamstat2d.js --------------------------------------------------------------
   Static load effects of design trains on a 2D beam, by influence lines: a port of
   BeamStat2D.m (2026-11-05); see its header for the method and the train models.
   Loads given in tonnes (SFS 1919, SoU 1938, SoU 1961, EN 15528) are converted with
   g = 10 m/s^2, 1 t = 10 kN, as BeamStat2D.m.

   BS.influenceLines(inp)         inp: L [m], EI (one or per span), dL, bc [[x, dir, K]],
                                  xp, loadDist, b_Q, onProgress (optional, fraction done)
   BS.loadEffect(IL, type, opt)   opt: dyn, v, alpha, both, fac
   BS.trainModel(type, Lneed)     train definition
   BS.loadDistribution(type, b_Q, dL)   {x, w}

   Influence lines: arrays of columns, IL.M[section][load position], Float64Array.
   Envelopes: LE.M = [lo, hi], per section.  LE.T is an array of train definitions, two
   for 85F and 60F.

   Andreas Andersson, 2026-11-02 (assisted by Claude)
---------------------------------------------------------------------------*/
(function (root) {
'use strict';

const BS = {};
const rnd = x => (x < 0 ? -Math.round(-x) : Math.round(x));      // as MATLAB round
const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const clip = (v, a, b) => Math.min(Math.max(v, a), b);

// number of elements: a short bridge gets at least 100
BS.nElements = (Ltot, dL) => { const n = rnd(Ltot / dL); return Ltot < 10 ? Math.max(n, 100) : n; };

// ================================================== influence lines
BS.influenceLines = function (inp) {
    const tol = inp.tol === undefined ? 1e-9 : inp.tol;
    const loadDist = inp.loadDist || '1-point', b_Q = inp.b_Q || 0;
    const L = inp.L, Ltot = sum(L);
    const nEL = BS.nElements(Ltot, inp.dL), dL = Ltot / nEL, n = nEL + 1, nDof = 2 * nEL + 2;
    const xn = new Float64Array(n); for (let i = 0; i < n; i++) xn[i] = i * dL;
    let bc = inp.bc && inp.bc.length ? inp.bc.map(b => [b[0], b[1] === undefined ? 1 : b[1], b[2] || 0]) : null;
    if (!bc) { bc = [[0, 1, 0]]; let s = 0; for (const l of L) { s += l; bc.push([s, 1, 0]); } }
    const xp = inp.xp ? Array.from(inp.xp) : Array.from(xn);

    // flexural rigidity per element
    const EI = Array.isArray(inp.EI) ? inp.EI : [inp.EI];
    const EIe = new Float64Array(nEL).fill(EI[0]);
    if (EI.length > 1) {
        let a = 0;
        L.forEach((l, i) => {
            const b = a + l;
            for (let e = 0; e < nEL; e++) { const xm = (xn[e] + xn[e + 1]) / 2; if (xm > a && xm <= b) EIe[e] = EI[i]; }
            a = b;
        });
    }

    // K as band rows, half bandwidth 3
    const hb = 3, K = new Float64Array(nDof * (2 * hb + 1));
    const ke = [12, 6 * dL, -12, 6 * dL, 6 * dL, 4 * dL * dL, -6 * dL, 2 * dL * dL,
                -12, -6 * dL, 12, -6 * dL, 6 * dL, 2 * dL * dL, -6 * dL, 4 * dL * dL];
    for (let e = 0; e < nEL; e++) {
        const f = EIe[e] / (dL * dL * dL), d0 = 2 * e;
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++)
            K[(d0 + a) * (2 * hb + 1) + (b - a) + hb] += f * ke[4 * a + b];
    }
    // boundary conditions
    for (const b of bc) if (b[0] < -1e-9 || b[0] > Ltot + 1e-9) throw new Error(`support positions must lie on the beam, 0 to ${Ltot} m`);
    const sn = bc.map(b => rnd(b[0] / dL));                      // support nodes
    const bdof = bc.map((b, i) => 2 * sn[i] + b[1] - 1);         // support dofs
    const rig = bc.map(b => !isFinite(b[2]) || b[2] <= 0);
    bc.forEach((b, i) => { if (!rig[i]) K[bdof[i] * (2 * hb + 1) + hb] += b[2]; });
    const fix = new Uint8Array(nDof);
    bc.forEach((b, i) => { if (rig[i]) fix[bdof[i]] = 1; });

    // band Cholesky of the free dofs, one factorisation for all the loads
    const fd = []; const map = new Int32Array(nDof).fill(-1);
    for (let i = 0; i < nDof; i++) if (!fix[i]) { map[i] = fd.length; fd.push(i); }
    const nf = fd.length, Lc = new Float64Array(nf * (hb + 1));   // Lc[i*(hb+1)+k]: L(i, i-k)
    for (let i = 0; i < nf; i++) {
        for (let k = hb; k >= 0; k--) {
            const j = i - k; if (j < 0) continue;
            const dd = fd[i] - fd[j];
            let v = dd <= hb ? K[fd[i] * (2 * hb + 1) - dd + hb] : 0;
            for (let m = 1; m <= hb - k; m++) {
                if (j - m < 0) break;
                v -= Lc[i * (hb + 1) + k + m] * Lc[j * (hb + 1) + m];
            }
            if (k === 0) {
                if (!(v > 1e-12 * K[fd[i] * (2 * hb + 1) + hb])) throw new Error('the beam is a mechanism: check the supports');
                Lc[i * (hb + 1)] = Math.sqrt(v);
            } else Lc[i * (hb + 1) + k] = v / Lc[j * (hb + 1)];
        }
    }

    // sections
    const ns = xp.length;
    const ie = new Int32Array(ns), ss = new Float64Array(ns);
    xp.forEach((xv, j) => {
        const t = xv / dL;
        ie[j] = Math.min(Math.max(Math.floor(t + 1e-9), 0), nEL - 1);
        ss[j] = clip(t - ie[j], 0, 1);
    });
    const col = () => Array.from({ length: ns }, () => new Float64Array(n));
    const M = col(), V = col(), d = col(), r = col();
    const RF = bc.map(() => new Float64Array(n));

    // unit downward load at every node.  Two steps of iterative refinement: the round-off of
    // the band Cholesky grows fast with the number of elements (midspan moment 3e-5 at 1300
    // elements, 6e-3 at 5000), after refinement below 1e-6 (2026-11-05)
    const D = new Float64Array(nDof), y = new Float64Array(nf), res = new Float64Array(nf);
    const solve = (z, i0) => {
        for (let i = i0; i < nf; i++) {
            let v = z[i];
            for (let k = 1; k <= hb && i - k >= 0; k++) v -= Lc[i * (hb + 1) + k] * z[i - k];
            z[i] = v / Lc[i * (hb + 1)];
        }
        for (let i = nf - 1; i >= 0; i--) {
            let v = z[i];
            for (let k = 1; k <= hb && i + k < nf; k++) v -= Lc[(i + k) * (hb + 1) + k] * z[i + k];
            z[i] = v / Lc[i * (hb + 1)];
        }
    };
    const prog = inp.onProgress, pStep = Math.max(1, Math.ceil(n / 100));   // optional callback, fraction done
    for (let c = 0; c < n; c++) {
        if (prog && c % pStep === 0) prog(c / n);
        y.fill(0);
        const k0 = map[2 * c];
        if (k0 >= 0) {
            y[k0] = -1;
            solve(y, k0);
            for (let it = 0; it < 2; it++) {
                for (let i = 0; i < nf; i++) {                   // residual F - K y of the free dofs
                    const g = fd[i];
                    let s = 0;
                    for (let k = -hb; k <= hb; k++) { const q = g + k; if (q >= 0 && q < nDof && map[q] >= 0) s += K[g * (2 * hb + 1) + k + hb] * y[map[q]]; }
                    res[i] = (i === k0 ? -1 : 0) - s;
                }
                solve(res, 0);
                for (let i = 0; i < nf; i++) y[i] += res[i];
            }
        }
        D.fill(0);
        for (let i = 0; i < nf; i++) D[fd[i]] = y[i];
        for (let j = 0; j < ns; j++) {
            const e = ie[j], s = ss[j], v1 = D[2 * e], f1 = D[2 * e + 1], v2 = D[2 * e + 2], f2 = D[2 * e + 3], EIs = EIe[e];
            M[j][c] = EIs / (dL * dL) * ((-6 + 12 * s) * v1 + dL * (-4 + 6 * s) * f1 + (6 - 12 * s) * v2 + dL * (-2 + 6 * s) * f2);
            V[j][c] = EIs / (dL * dL * dL) * (12 * (v1 - v2) + 6 * dL * (f1 + f2));
            d[j][c] = (1 - 3 * s * s + 2 * s * s * s) * v1 + dL * (s - 2 * s * s + s * s * s) * f1
                    + (3 * s * s - 2 * s * s * s) * v2 + dL * (-s * s + s * s * s) * f2;
            r[j][c] = (-6 * s + 6 * s * s) / dL * v1 + (1 - 4 * s + 3 * s * s) * f1
                    + (6 * s - 6 * s * s) / dL * v2 + (-2 * s + 3 * s * s) * f2;
        }
        bc.forEach((b, i) => {
            const g = bdof[i];
            if (rig[i]) {
                let v = 0;
                for (let k = -hb; k <= hb; k++) if (g + k >= 0 && g + k < nDof) v += K[g * (2 * hb + 1) + k + hb] * D[g + k];
                if (b[1] === 1 && sn[i] === c) v += 1;           // - F at the support dof
                RF[i][c] = v;
            } else RF[i][c] = -b[2] * D[g];
        });
    }

    // load distribution: a convolution of the point load influence lines
    const kn = BS.distKernel(loadDist, b_Q, dL), m = (kn.length - 1) / 2;
    const out = { xp, dL, Ltot, bc, supX: sn.map(s => s * dL), supDir: bc.map(b => b[1]), kn, sn, rig };
    const round0 = A => A.forEach(c => { for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) < tol) c[i] = 0; });
    out.pt = null;
    if (m > 0) {
        const cp = A => A.map(c => Float64Array.from(c));
        out.pt = { x: xn, M: cp(M), V: cp(V), d: cp(d), r: cp(r), RF: cp(RF) };
        round0(out.pt.M); round0(out.pt.V); round0(out.pt.RF);
        const cv = c => { const o = new Float64Array(n + 2 * m); for (let i = 0; i < n; i++) if (c[i] !== 0) for (let k = 0; k <= 2 * m; k++) o[i + k] += c[i] * kn[k]; return o; };
        out.M = M.map(cv); out.V = V.map(cv); out.d = d.map(cv); out.r = r.map(cv); out.RF = RF.map(cv);
        out.x = Float64Array.from({ length: n + 2 * m }, (_, i) => (i - m) * dL);
    } else {
        out.M = M; out.V = V; out.d = d; out.r = r; out.RF = RF; out.x = xn;
    }
    round0(out.M); round0(out.V); round0(out.RF);
    const on = new Float64Array(n + 2 * m);
    for (let i = 0; i < n; i++) for (let k = 0; k <= 2 * m; k++) on[i + k] += kn[k];
    out.qon = on;
    let chk = 0;
    for (let i = 0; i < on.length; i++) {
        let s = 0; bc.forEach((b, q) => { if (b[1] === 1) s += out.RF[q][i]; });
        chk = Math.max(chk, Math.abs(s - on[i]));
    }
    out.chk = chk;
    return out;
};

// the load distribution as a kernel on the node grid, sum 1
BS.distKernel = function (type, b_Q, dL) {
    if (type.toLowerCase() === 'triangular') {
        if (!(b_Q > 0)) return Float64Array.of(1);
        const m = Math.ceil(b_Q / (2 * dL)), kn = new Float64Array(2 * m + 1);
        const G = z => Math.sign(z) * (2 / b_Q) * (Math.abs(z) - z * z / b_Q);
        let s = 0;
        for (let i = -m; i <= m; i++) {
            const so = i * dL, ka = clip(so - dL / 2, -b_Q / 2, b_Q / 2), kb = clip(so + dL / 2, -b_Q / 2, b_Q / 2);
            kn[i + m] = G(kb) - G(ka); s += kn[i + m];
        }
        return kn.map(v => v / s);
    }
    const D = BS.loadDistribution(type, b_Q, dL);
    const m = Math.ceil(Math.max(...D.x.map(Math.abs)) / dL - 1e-9), kn = new Float64Array(2 * m + 1);
    D.x.forEach((xv, i) => {
        const t = xv / dL + m, j = Math.min(Math.floor(t + 1e-9), 2 * m), f = Math.max(t - j, 0);
        kn[j] += D.w[i] * (1 - f);
        if (f > 1e-9) kn[j + 1] += D.w[i] * f;
    });
    return kn;
};

// offsets x_i (m) from the axle and weights w_i (sum 1) of one axle load
BS.loadDistribution = function (type, b_Q) {
    const a = 0.6;
    switch (type.toLowerCase()) {
        case '1-point': return { x: [0], w: [1] };
        case '3-point': return { x: [-a, 0, a], w: [0.25, 0.5, 0.25] };
        case '5-point': {
            const Ks = 100E6, EIr = 210E9 * 30.38E-6, be = Math.cbrt(Ks / (8 * EIr));
            const x = [-2, -1, 0, 1, 2].map(i => a * i);
            const w = x.map(v => { const t = be * Math.abs(v); return Math.exp(-t) * (Math.cos(t) + Math.sin(t)); });
            const s = sum(w);
            return { x, w: w.map(v => v / s) };
        }
        default: return { x: [0], w: [1] };
    }
};

// ================================================== load effect
BS.loadEffect = function (IL, type, opt0) {
    const opt = Object.assign({ v: null, dyn: true, dynDisp: false, both: true, Lphi: null, fac: 1, alpha: 1 }, opt0 || {});

    // combined load models: both alternatives, the larger effect (the same factor)
    const cmb = { '85F': [['F', 'LG1'], [0.85, 1]], '60F': [['F', 'LG2'], [0.60, 1]] };
    const up = type.toUpperCase().replace(/^0(\d\dF)$/, '$1');         // '085F' = '85F'
    if (cmb[up]) {
        const o = cmb[up][0].map((t, k) => BS.loadEffect(IL, t, Object.assign({}, opt, { fac: opt.fac * cmb[up][1][k] })));
        return mergeLE(o[0], o[1], up);
    }

    let T = BS.trainModel(type, IL.x[IL.x.length - 1] - IL.x[0]);
    T.lead = T.x.length ? 0 : null;
    if (opt.fac !== 1) { T.P = T.P.map(v => v * opt.fac); T.Pe = T.Pe.map(v => v * opt.fac); T.q *= opt.fac; T.qe *= opt.fac; }
    if (opt.alpha !== 1) { T.P = T.P.map(v => v * opt.alpha); T.q *= opt.alpha; }
    let Z = IL;
    if (up === 'LM71' && IL.pt) {                                // evenly on 6.4 m
        Z = Object.assign({}, IL, { x: IL.pt.x, M: IL.pt.M, V: IL.pt.V, d: IL.pt.d, r: IL.pt.r, RF: IL.pt.RF });
        T = lm71Block(T, IL.dL);
    }

    // snap the train to the element grid once
    const x0 = T.x.slice(), dL = IL.dL;
    T.x = T.x.map(v => rnd(v / dL) * dL);
    T.qseg = T.qseg.map(s => s.map(v => (isFinite(v) ? rnd(v / dL) * dL : v)));
    if (T.x.length) T.Ltrain = T.x[T.x.length - 1] - T.x[0];
    let snap = 0; T.x.forEach((v, i) => { snap = Math.max(snap, Math.abs(v - x0[i])); });
    const x = Z.x;

    // sweep every quantity, in one or both running directions
    const Td = [T]; if (opt.both) Td.push(mirror(T));
    const Q = ['M', 'V', 'd', 'r', 'RF'], S = {}, Pp = {}, G = {};
    const prep = Td.map(t => sweepPrep(x, dL, t));
    for (const q of Q) {
        const cols = Z[q], m = cols.length;
        const lo = new Float64Array(m), hi = new Float64Array(m), plo = new Float64Array(m), phi = new Float64Array(m),
              dlo = new Uint8Array(m).fill(1), dhi = new Uint8Array(m).fill(1);
        for (let j = 0; j < m; j++) {
            for (let k = 0; k < Td.length; k++) {
                const e = sweep(cols[j], x, dL, Td[k], prep[k]);
                if (k === 0) { lo[j] = e[0]; hi[j] = e[1]; plo[j] = e[2]; phi[j] = e[3]; }
                else {
                    if (e[1] > hi[j]) { hi[j] = e[1]; phi[j] = e[3]; dhi[j] = 2; }
                    if (e[0] < lo[j]) { lo[j] = e[0]; plo[j] = e[2]; dlo[j] = 2; }
                }
            }
        }
        S[q] = [lo, hi]; Pp[q] = [plo, phi]; G[q] = [dlo, dhi];
    }

    // determinant length and dynamic factor, one value for the bridge
    const sup = [...new Set(IL.supX.filter((_, i) => IL.supDir[i] === 1))].sort((a, b) => a - b);
    const Ls = []; for (let i = 1; i < sup.length; i++) Ls.push(sup[i] - sup[i - 1]);
    if (!Ls.length) Ls.push(x[x.length - 1] - x[0]);
    const ns = Ls.length;
    const Lphi = opt.Lphi === null ? Math.max(sum(Ls) / ns * (1 + 0.1 * Math.min(ns, 5) * (ns > 1 ? 1 : 0)), Math.max(...Ls)) : opt.Lphi;
    const vv = opt.v === null ? 100 : opt.v, fc = factors(T);
    let phi;
    if (!opt.dyn) phi = 1;
    else if (opt.v === null || !fc.epsv) phi = fc.eps(Lphi);
    else phi = fc.epsv(Lphi, opt.v);
    const pd = opt.dynDisp ? phi : 1;
    const out = {};
    for (const q of Q) {
        const f = (q === 'd' || q === 'r') ? pd : phi;
        out[q] = [S[q][0].map(v => v * f), S[q][1].map(v => v * f)];
    }
    out.xp = IL.xp; out.x = x; out.supX = IL.supX; out.supDir = IL.supDir;
    out.stat = S; out.phi = phi;
    out.phiParts = opt.dyn && fc.parts ? fc.parts(Lphi, vv) : null;
    out.Lphi = Lphi; out.Lspan = Ls; out.p = Pp; out.dir = G; out.type = up;
    out.T = [T]; out.snap = snap;

    // peak values, and the arrangement behind each
    out.xpeak = {}; out.pos = {}; out.chk = 0;
    const pk = [['Mmax', 'M', 1], ['Mmin', 'M', -1], ['Vmax', 'V', 0], ['dmax', 'd', 0], ['rmax', 'r', 0], ['RFmax', 'RF', 1], ['RFmin', 'RF', -1]];
    for (const [nm, qn, c] of pk) {
        const E = out[qn];
        let xq, iv;
        if (qn === 'RF') {
            xq = IL.supX;
            iv = IL.supDir.map((d, i) => (d === 1 ? i : -1)).filter(i => i >= 0);
            if (!iv.length) iv = xq.map((_, i) => i);
        } else { xq = IL.xp; iv = xq.map((_, i) => i); }
        let k = iv[0], sd = c >= 0 ? 1 : 0, v;
        if (c > 0) { v = -Infinity; for (const i of iv) if (E[1][i] > v) { v = E[1][i]; k = i; } }
        else if (c < 0) { v = Infinity; for (const i of iv) if (E[0][i] < v) { v = E[0][i]; k = i; } }
        else {
            let best = -1;
            for (const s of [0, 1]) for (const i of iv) if (Math.abs(E[s][i]) > best) { best = Math.abs(E[s][i]); k = i; sd = s; }
            v = E[sd][k];
        }
        out[nm] = v; out.xpeak[nm] = xq[k];
        const Tc = G[qn][sd][k] === 2 ? Td[1] : T;
        const C = config(Z[qn][k], x, dL, Tc, Pp[qn][sd][k], 2 * sd - 1);
        C.name = nm; C.quant = qn; C.x = xq[k];
        C.p = Pp[qn][sd][k]; C.dir = G[qn][sd][k];
        C.h = Z[qn][k]; C.val = v; C.valStat = S[qn][sd][k]; C.q = T.q;
        out.chk = Math.max(out.chk, Math.abs(C.sum - C.valStat) / Math.max(Math.abs(C.valStat), Number.EPSILON));
        delete C.sum;
        out.pos[nm] = C;
    }
    return out;
};

function mergeLE(a, b, type) {
    const out = Object.assign({}, a, { type, xpeak: Object.assign({}, a.xpeak), pos: Object.assign({}, a.pos) });
    for (const f of ['M', 'V', 'd', 'r', 'RF']) {
        out[f] = [Float64Array.from(a[f][0]), Float64Array.from(a[f][1])];
        out.stat = out.stat === a.stat ? Object.assign({}, a.stat) : out.stat;
        out.stat[f] = [Float64Array.from(a.stat[f][0]), Float64Array.from(a.stat[f][1])];
        for (let j = 0; j < a[f][1].length; j++) {
            if (b[f][1][j] > a[f][1][j]) { out[f][1][j] = b[f][1][j]; out.stat[f][1][j] = b.stat[f][1][j]; }
            if (b[f][0][j] < a[f][0][j]) { out[f][0][j] = b[f][0][j]; out.stat[f][0][j] = b.stat[f][0][j]; }
        }
    }
    for (const [n, c] of [['Mmax', 1], ['Mmin', -1], ['Vmax', 0], ['dmax', 0], ['rmax', 0], ['RFmax', 1], ['RFmin', -1]]) {
        if ((c > 0 && b[n] > a[n]) || (c < 0 && b[n] < a[n]) || (c === 0 && Math.abs(b[n]) > Math.abs(a[n]))) {
            out[n] = b[n]; out.xpeak[n] = b.xpeak[n]; out.pos[n] = b.pos[n];
        }
    }
    out.T = [a.T[0], b.T[0]];
    out.snap = Math.max(a.snap, b.snap);
    out.chk = Math.max(a.chk, b.chk);
    return out;
}

// the governing arrangement at one section, by the same rules as sweep
function config(h, x, dL, T, p, sg) {
    const n = x.length, na = T.x.length;
    let P = [], grp = [], cs = [0], bt = 0, nk = 0, e = [];
    if (na) {
        const hv = new Float64Array(na);
        T.x.forEach((v, i) => { const j = rnd((p + v - x[0]) / dL); if (j >= 0 && j < n) hv[i] = h[j]; });
        const nv = Math.max(...T.veh), al = new Float64Array(nv + 1), ae = new Float64Array(nv + 1), aw = new Uint8Array(nv + 1);
        for (let i = 0; i < na; i++) { al[T.veh[i]] += T.P[i] * hv[i]; ae[T.veh[i]] += T.Pe[i] * hv[i]; if (T.isW[i]) aw[T.veh[i]] = 1; }
        P = T.P.slice();
        e = T.veh.map(v => aw[v] === 1 && sg * ae[v] > sg * al[v]);
        for (let i = 0; i < na; i++) if (e[i]) P[i] = T.Pe[i];
        const c = P.map((v, i) => v * hv[i]);
        grp = T.code === 1961 ? T.x.map((_, i) => i + 1) : T.veh.slice();
        if (T.code <= 1938) {
            let s = 0; for (let i = 0; i < na; i++) if (grp[i] === grp[T.lead]) s += c[i];
            if (sg * (s - c[T.lead]) > sg * s) { P[T.lead] = 0; c[T.lead] = 0; }
        }
        const mg = Math.max(...grp), ag = new Float64Array(mg + 1);
        for (let i = 0; i < na; i++) ag[grp[i]] += c[i];
        cs = [0]; for (let g = 1; g <= mg; g++) cs.push(cs[g - 1] + ag[g]);
        let b = -Infinity, kt = 0;
        cs.forEach((v, i) => { if (sg * v > b) { b = sg * v; kt = i; } });
        bt = sg * b; nk = kt;
    }

    const w = new Float64Array(n);
    if (T.q > 0) {
        const wf = new Float64Array(n), G = new Float64Array(n);
        for (let i = 0; i < n; i++) wf[i] = sg * h[i] >= 0 ? T.q : T.qe;
        for (let i = 1; i < n; i++) G[i] = G[i - 1] + (x[i] - x[i - 1]) * (wf[i] * h[i] + wf[i - 1] * h[i - 1]) / 2;
        const nq = T.qseg.length, ab = [], dvi = new Float64Array(nq), fr = [];
        const kL = !na || keyLeft(T, grp);
        T.qseg.forEach((s, i) => {
            fr[i] = (!isFinite(s[0]) && kL) || (!isFinite(s[1]) && !kL);
            let a, b;
            if (!isFinite(s[0])) {
                b = clip(rnd((p + s[1] - x[0]) / dL), 0, n - 1);
                let v = Infinity; a = 0;
                for (let j = 0; j <= b; j++) if (sg * G[j] < v) { v = sg * G[j]; a = j; }
            } else if (!isFinite(s[1])) {
                a = clip(rnd((p + s[0] - x[0]) / dL), 0, n - 1);
                let v = -Infinity; b = a;
                for (let j = a; j < n; j++) if (sg * G[j] > v) { v = sg * G[j]; b = j; }
            } else {
                a = clip(rnd((p + s[0] - x[0]) / dL), 0, n - 1);
                b = clip(rnd((p + s[1] - x[0]) / dL), 0, n - 1);
            }
            ab[i] = [a, b];
            if (b > a) dvi[i] = G[b] - G[a];
        });
        const dAll = sum(dvi); let dFr = 0; fr.forEach((f, i) => { if (f) dFr += dvi[i]; });
        let on;
        if (sg * (cs[cs.length - 1] + dAll) > sg * (bt + dFr)) {
            nk = na ? Math.max(...grp) : 0; bt = cs[cs.length - 1] + dAll; on = fr.map(() => true);
        } else { bt += dFr; on = fr; }
        on.forEach((f, i) => { if (f && ab[i][1] > ab[i][0]) for (let j = ab[i][0]; j <= ab[i][1]; j++) w[j] = wf[j]; });
        for (let i = 0; i < n; i++)                               // a stretch of one node carries nothing
            if (w[i] > 0 && (i === 0 || w[i - 1] <= 0) && (i === n - 1 || w[i + 1] <= 0)) w[i] = 0;
    }

    const C = { xa: [], Pa: [], Pl: [], emp: [], vb: [], vbf: [], blk: [], qb: T.qb, w, sum: bt };
    const seen = new Set();
    for (let i = 0; i < na; i++) {
        if (grp[i] <= nk && P[i] !== 0) {
            C.xa.push(p + T.x[i]); C.Pa.push(P[i]); C.Pl.push(T.P[i]); C.emp.push(e[i]); seen.add(T.veh[i]);
        }
    }
    const vs = [...seen].sort((a, b) => a - b);
    if (T.vb.length && C.xa.length) {
        for (const v of vs) {
            let pv = 0, pl = 0;
            for (let i = 0; i < na; i++) if (T.veh[i] === v) { pv = Math.max(pv, P[i]); pl = Math.max(pl, T.P[i]); }
            C.vb.push([p + T.vb[v - 1][0], p + T.vb[v - 1][1]]); C.vbf.push(pv / pl);
        }
    }
    if (T.blk.length && C.xa.length) C.blk = vs.map(v => [p + T.blk[v - 1][0], p + T.blk[v - 1][1]]);
    return C;
}

// is the group that survives a shortening at the left?
function keyLeft(T, grp) {
    const lo = Math.min(...grp), hi = Math.max(...grp);
    let a = 0, na = 0, b = 0, nb = 0;
    grp.forEach((g, i) => { if (g === lo) { a += T.x[i]; na++; } if (g === hi) { b += T.x[i]; nb++; } });
    return a / na <= b / nb;
}

function sweepPrep(x, dL, T) {
    let A = T.x.length ? Math.max(...T.x, 0) : 0, B = T.x.length ? Math.max(-Math.min(...T.x), 0) : 0;
    for (const s of T.qseg) for (const v of s) if (isFinite(v)) { A = Math.max(A, v); B = Math.max(B, -v); }
    const kA = rnd(A / dL), nR = rnd((A + x[x.length - 1] - x[0] + B) / dL) + 1;
    const grp = T.code === 1961 ? T.x.map((_, i) => i + 1) : T.veh;
    const gv = [...new Set(grp)].sort((a, b) => a - b);
    const groups = gv.map(v => {
        const ix = []; grp.forEach((g, i) => { if (g === v) ix.push(i); });
        const off = ix.map(i => T.x[i]), o = Math.min(...off), kk = off.map(f => rnd((f - o) / dL)), m = Math.max(...kk);
        const s = rnd((Math.max(...off) - o) / dL) + rnd(o / dL) - kA;
        return { P: ix.map(i => T.P[i]), Pe: ix.map(i => T.Pe[i]), anyW: ix.some(i => T.isW[i]),
                 sh: kk.map(k => s - (m - k)) };
    });
    let lead = null;
    if (T.code <= 1938 && T.x.length) {
        const f = T.x[T.lead];
        lead = { P: T.P[T.lead], sh: rnd(f / dL) - kA };
    }
    const kL = !T.x.length || keyLeft(T, grp);
    const qs = T.qseg.map(s => {
        const opL = !isFinite(s[0]), opR = !isFinite(s[1]);
        return { opL, opR, k1: opL ? 0 : rnd(s[0] / dL) - kA, k2: opR ? 0 : rnd(s[1] / dL) - kA, front: (opL && kL) || (opR && !kL) };
    });
    const buf = () => new Float64Array(nR);
    return { kA, nR, groups, lead, qs, p0: x[0] - A, Rx: buf(), Re: buf(), Cx: buf(), Cn: buf(), Wx: buf(), Wn: buf(),
             DxF: buf(), DnF: buf(), DxB: buf(), DnB: buf(), n: x.length };
}

// add P * z stepped over the train positions: R[t] += P z[t + sh]
function addLoad(R, z, n, nR, P, sh) {
    if (P === 0) return;
    const t0 = Math.max(0, -sh), t1 = Math.min(nR, n - sh);
    for (let t = t0; t < t1; t++) R[t] += P * z[t + sh];
}

// envelope of one influence line over every train position: [lo, hi, p of lo, p of hi]
function sweep(z, x, dL, T, Q) {
    const { nR, n, Rx, Re, Cx, Cn, Wx, Wn } = Q;
    Cx.fill(0); Cn.fill(0); Wx.fill(0); Wn.fill(0);
    Q.groups.forEach((g, gi) => {
        Rx.fill(0);
        g.P.forEach((P, i) => addLoad(Rx, z, n, nR, P, g.sh[i]));
        if (g.anyW) {
            Re.fill(0);
            g.Pe.forEach((P, i) => addLoad(Re, z, n, nR, P, g.sh[i]));
        }
        for (let t = 0; t < nR; t++) {
            let rx = Rx[t], rn = rx;
            if (g.anyW) { const re = Re[t]; if (re < rn) rn = re; if (re > rx) rx = re; }
            if (gi === 0 && Q.lead) {
                const zi = t + Q.lead.sh, r1 = zi >= 0 && zi < n ? Q.lead.P * z[zi] : 0;
                rn = Math.min(rn, rn - r1); rx = Math.max(rx, rx - r1);
            }
            Cx[t] += rx; if (Cx[t] > Wx[t]) Wx[t] = Cx[t];
            Cn[t] += rn; if (Cn[t] < Wn[t]) Wn[t] = Cn[t];
        }
    });

    if (T.q > 0) {
        const { DxF, DnF, DxB, DnB } = Q;
        DxF.fill(0); DnF.fill(0); DxB.fill(0); DnB.fill(0);
        const Gp = new Float64Array(n), Gm = new Float64Array(n);
        let cp = 0, cm = 0;
        for (let i = 0; i < n; i++) {
            if (i > 0) {
                const a = z[i - 1], b = z[i], dx = (x[i] - x[i - 1]) / 2;
                cp += dx * (Math.max(a, 0) + Math.max(b, 0));
                cm += dx * (Math.min(a, 0) + Math.min(b, 0));
            }
            Gp[i] = T.q * cp + T.qe * cm;
            Gm[i] = T.qe * cp + T.q * cm;
        }
        const Sx = Float64Array.from(Gp), Sn = Float64Array.from(Gm), Px = Float64Array.from(Gp), Pn = Float64Array.from(Gm);
        for (let i = n - 2; i >= 0; i--) { if (Sx[i + 1] > Sx[i]) Sx[i] = Sx[i + 1]; if (Sn[i + 1] < Sn[i]) Sn[i] = Sn[i + 1]; }
        for (let i = 1; i < n; i++) { if (Px[i - 1] < Px[i]) Px[i] = Px[i - 1]; if (Pn[i - 1] > Pn[i]) Pn[i] = Pn[i - 1]; }
        for (const s of Q.qs) {
            const Dx = s.front ? DxF : DxB, Dn = s.front ? DnF : DnB;
            for (let t = 0; t < nR; t++) {
                if (s.opL) {
                    const j = clip(t + s.k2, 0, n - 1);
                    Dx[t] += Gp[j] - Px[j]; Dn[t] += Gm[j] - Pn[j];
                } else if (s.opR) {
                    const j = clip(t + s.k1, 0, n - 1);
                    Dx[t] += Sx[j] - Gp[j]; Dn[t] += Sn[j] - Gm[j];
                } else {
                    const a = clip(t + s.k1, 0, n - 1), b = clip(t + s.k2, 0, n - 1);
                    Dx[t] += Gp[b] - Gp[a]; Dn[t] += Gm[b] - Gm[a];
                }
            }
        }
        for (let t = 0; t < nR; t++) {
            Wx[t] = Math.max(Wx[t] + DxF[t], Cx[t] + DxF[t] + DxB[t]);
            Wn[t] = Math.min(Wn[t] + DnF[t], Cn[t] + DnF[t] + DnB[t]);
        }
    }

    let hi = -Infinity, lo = Infinity, ih = nR, il = nR;
    for (let t = 0; t < nR; t++) {
        if (Wx[t] > hi) { hi = Wx[t]; ih = t; }
        if (Wn[t] < lo) { lo = Wn[t]; il = t; }
    }
    if (0 > hi) { hi = 0; ih = nR - 1; }                          // train clear of the bridge
    if (0 < lo) { lo = 0; il = nR - 1; }
    return [lo, hi, Q.p0 + il * dL, Q.p0 + ih * dL];
}

function mirror(T0) {
    const T = Object.assign({}, T0), L = T.Ltrain;
    const ord = T.x.map((v, i) => [L - v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    T.x = ord.map(o => o[0]);
    const k = ord.map(o => o[1]);
    T.P = k.map(i => T0.P[i]); T.Pe = k.map(i => T0.Pe[i]); T.veh = k.map(i => T0.veh[i]); T.isW = k.map(i => T0.isW[i]);
    T.lead = T0.lead === null ? null : k.indexOf(T0.lead);
    T.qseg = T0.qseg.map(s => [L - s[1], L - s[0]]);
    T.vb = T0.vb.map(s => [L - s[1], L - s[0]]);
    T.blk = T0.blk.map(s => [L - s[1], L - s[0]]);
    return T;
}

// the four axle loads of LM71 evenly on 6.4 m, one vehicle: whole or not at all
function lm71Block(T0, dL) {
    const T = Object.assign({}, T0), m = Math.ceil(6.4 / dL - 1e-9), Ptot = sum(T0.P);
    const x = [], P = [];
    for (let i = 0; i <= m; i++) {
        const xn = i * dL, s = Math.max(Math.min(xn + dL / 2, 6.4) - Math.max(xn - dL / 2, 0), 0) / 6.4;
        if (s > 1e-12) { x.push(xn); P.push(Ptot * s); }
    }
    T.x = x; T.P = P; T.Pe = P.map(() => 0); T.veh = P.map(() => 1); T.isW = P.map(() => true);
    T.qseg = T0.qseg.map(s => s.map(v => v + 0.8));
    T.blk = [[0, 6.4]];
    T.qb = sum(P) / 6.4;
    return T;
}

// ================================================== train models
function mkv(ohF, s, ohR, P, Pe, isW) {
    let c = 0; const xa = [ohF + 0];                             // ohF + cumsum(s), as MATLAB
    s.forEach(v => { c += v; xa.push(ohF + c); });
    return { xa, L: ohF + sum(s) + ohR, P, Pe: Pe || P, isW };
}
const rep = (v, n) => new Array(n).fill(v);

BS.trainModel = function (type0, Lneed) {
    Lneed = Lneed || 0;
    const g = 10, type = type0.toUpperCase().replace('/', '').replace('-', '');   // 1 t = 10 kN; 'SW/0' = 'SW0', 'xL-a' = 'XLA'
    let q = 0, qe = 0, qseg = [], vs = [], nWagon = 0, xa = [], Pa = [], Pea = [], vi = [], iw = [], vb = [];
    let cv = 1e3 * g, vmax = null, Lg = null, code;
    const nw = Lw => Math.ceil(Lneed / Lw) + 1;
    const lok19 = P => mkv(2.0, [2.6, 1.4, 1.4, 1.4], 2.5, P, null, false);
    const ten = P => mkv(1.4, [1.6, 1.6], 1.8, P, null, false);
    const lok38 = P => mkv(2.0, [2.6, 1.5, 1.5, 1.5], 2.5, P, null, false);
    const W15528 = {
        A10: [10.0, 2.0, [1.7, 12.6, 1.7], 2.0], A12: [12.0, 2.0, [1.7, 12.6, 1.7], 2.0], A14: [14.0, 2.0, [1.7, 12.6, 1.7], 2.0],
        A1: [16.0, 1.5, [1.8, 6.20, 1.8], 1.5], B1: [18.0, 1.5, [1.8, 7.80, 1.8], 1.5], B2: [18.0, 1.5, [1.8, 4.65, 1.8], 1.5],
        C2: [20.0, 1.5, [1.8, 5.90, 1.8], 1.5], C3: [20.0, 1.5, [1.8, 4.50, 1.8], 1.5], C4: [20.0, 1.5, [1.8, 3.40, 1.8], 1.5],
        D2: [22.5, 1.5, [1.8, 7.45, 1.8], 1.5], D3: [22.5, 1.5, [1.8, 5.90, 1.8], 1.5], D4: [22.5, 1.5, [1.8, 4.65, 1.8], 1.5],
        D5: [22.5, 1.5, [1.8, 3.62, 1.8], 1.5], E4: [25.0, 1.5, [1.8, 5.90, 1.8], 1.5], E5: [25.0, 1.5, [1.8, 4.75, 1.8], 1.5],
        E6: [25.0, 1.5, [1.7, 1.7, 5.2, 1.7, 1.7], 1.5], XLA: [20.0, 1.5, [1.5, 1.5, 6.0, 1.5, 1.5], 1.5],
        XLB: [22.5, 2.2, [1.7, 2.0, 6.5, 2.0, 1.7], 2.2] };

    if (['A1919', 'B1919', 'C1919', 'D1919'].includes(type)) {
        code = 1919; vmax = 100;
        let wg;
        if (type[0] === 'A') { vs = [lok19([15, 20, 20, 20, 20]), ten([18, 18, 18])]; wg = mkv(2.0, [1.6, 1.6], 2.0, [20, 20, 20], [4, 4, 4], true); }
        else if (type[0] === 'B') { vs = [lok19([13.5, 18, 18, 18, 18]), ten([16.2, 16.2, 16.2])]; wg = mkv(1.6, [3.3], 1.6, [14, 14], [3, 3], true); }
        else if (type[0] === 'C') { vs = [lok19([10.5, 14, 14, 14, 14]), ten([12.6, 12.6, 12.6])]; wg = mkv(1.6, [3.3], 1.6, [14, 14], [3, 3], true); }
        else { const lk = mkv(1.0, [1.0, 1.0, 1.0, 1.0], 1.0, [3, 5, 5, 5, 3], null, false); vs = [lk, lk]; wg = mkv(1.0, [1.0, 3.0, 1.0], 1.0, [4, 4, 4, 4], null, true); }
        if (type[0] !== 'D') vs = vs.concat(vs);
        nWagon = nw(wg.L);
        vs = vs.concat(rep(wg, nWagon));
    } else if (type === 'A' || type === 'B') {
        code = 1938; vmax = 100;
        if (type === 'A') { vs = [lok38([15, 20, 20, 20, 20]), ten([18, 18, 18])]; q = 8.5; qe = 1.0; }
        else { vs = [lok38([13.5, 18, 18, 18, 18]), ten([16.2, 16.2, 16.2])]; q = 5.0; qe = 1.0; }
        vs = vs.concat(vs);
    } else if (['F', 'LG1', 'LG2'].includes(type)) {
        code = 1961; vmax = 120;
        if (type === 'F') {
            for (let i = 0; i < 6; i++) xa.push(1.6 + i * 1.6);
            for (let i = 0; i < 6; i++) xa.push(12.8 + i * 1.6);
            Pa = rep(25, 12); vi = [...rep(1, 6), ...rep(2, 6)]; Lg = 22.4;
            q = 8.5; qe = 1.25; qseg = [[-Infinity, 0], [Lg, Infinity]]; vb = [[0, 11.2], [11.2, 22.4]];
        } else if (type === 'LG1') {
            xa = [0, 1, 2, 3, 4].map(i => i * 1.6); Pa = rep(25, 5); vi = rep(1, 5); Lg = xa[4];
        } else {
            xa = [0, 1, 2, 3].map(i => i * 1.6); Pa = rep(20, 4); vi = rep(1, 4); Lg = xa[3];
        }
        Pea = Pa.slice(); iw = xa.map(() => false);
    } else if (W15528[type]) {
        code = 15528;
        const [P0, ohF, sp, ohR] = W15528[type], na = sp.length + 1, Lw = ohF + sum(sp) + ohR, Pe0 = (10 / g) * Lw / na;
        nWagon = nw(Lw);
        vs = rep(mkv(ohF, sp, ohR, rep(P0, na), rep(Pe0, na), true), nWagon);
    } else if (['TLM1', 'TLM2', 'TLM3'].includes(type)) {
        code = 2025; cv = 1e3; vmax = 120;
        let wg;
        if (type === 'TLM1') wg = mkv(2.0, [9.0], 2.0, [250, 250], [50, 50], true);
        else if (type === 'TLM2') wg = mkv(1.5, [1.8, 5.9, 1.8], 1.5, rep(250, 4), rep(50, 4), true);
        else { wg = mkv(0.8, [1.75, 4.9, 1.75], 0.8, rep(250, 4), rep(50, 4), true); vmax = 60; }
        nWagon = nw(wg.L);
        vs = rep(wg, nWagon);
    } else if (type === 'TLM4') {                                 // two blocks, a fixed pattern
        code = 2025; cv = 1e3; vmax = 30;
        q = 150; qe = 150; qseg = [[0, 22.5], [38.3, 60.8]];
    } else if (['LM71', 'SW0', 'SW2', 'UT'].includes(type)) {
        code = 1991; cv = 1e3;
        if (type === 'LM71') {
            xa = [0, 1, 2, 3].map(i => i * 1.6); Pa = rep(250, 4); Pea = rep(0, 4); vi = [1, 2, 3, 4]; iw = rep(true, 4);
            q = 80; qe = 10; qseg = [[-Infinity, -0.8], [5.6, Infinity]];
        } else if (type === 'SW0') { q = 133; qe = 133; qseg = [[0, 15], [20.3, 35.3]]; }
        else if (type === 'SW2') { q = 150; qe = 150; qseg = [[0, 25], [32, 57]]; }
        else { q = 10; qe = 0; qseg = [[-Infinity, Infinity]]; }
    } else throw new Error(`unknown load model '${type0}'`);

    if (vs.length) {
        let x0 = 0;
        vb = [];
        vs.forEach((V, k) => {
            V.xa.forEach((v, i) => { xa.push(x0 + v); Pa.push(V.P[i]); Pea.push(V.Pe[i]); vi.push(k + 1); iw.push(V.isW); });
            vb.push([x0, x0 + V.L]);
            x0 += V.L;
        });
        Lg = x0;
        if (q > 0) qseg = [[Lg, Infinity]];
    }

    let sh;
    if (!xa.length) { const f = qseg.flat().filter(isFinite); sh = f.length ? Math.min(...f) : 0; }
    else sh = xa[0];
    xa = xa.map(v => v - sh);
    qseg = qseg.map(s => s.map(v => v - sh));
    vb = vb.map(s => s.map(v => v - sh));
    return { x: xa, P: Pa.map(v => v * cv), Pe: Pea.map(v => v * cv), veh: vi, isW: iw, vb, blk: [], qb: 0,
             q: q * cv, qe: qe * cv, qseg, code, type, Ltrain: xa.length ? xa[xa.length - 1] : 0, nWagon, g, vmax, Lbuf: Lg };
};

// the dynamic factors of a train (functions, so not part of the train data)
function factors(T) {
    const vmax = T.vmax;
    switch (T.code) {
        case 1919: { const e = l => 1000 / (13 + 0.7 * l);
            return { eps: l => 1 + 0.01 * e(l), epsv: (l, v) => 1 + 0.01 * (Math.min(v, 100) / 100) * e(l) }; }
        case 1938: return { eps: l => 1 + 0.01 * (1765 / (20 + l)) };
        case 15528: return { parts: (l, v) => realTrain(l, v), eps: l => 1 + sum(realTrain(l, 100)), epsv: (l, v) => 1 + sum(realTrain(l, v)) };
        case 2025: return { parts: l => realTrain(l, vmax, 23.76), eps: l => 1 + sum(realTrain(l, vmax, 23.76)), epsv: l => 1 + sum(realTrain(l, vmax, 23.76)) };
        case 1991: return T.type === 'UT' ? { eps: () => 1 } : { eps: l => Math.min(Math.max(1.44 / Math.sqrt(Math.max(l - 0.2, 1e-9)) + 0.82, 1.00), 1.67) };
        case 1961: { const e = l => Math.max((2200 + 11 * l) / (25 + l), 20);
            return { eps: l => 1 + 0.01 * e(l), epsv: (l, v) => 1 + 0.01 * (0.75 * Math.min(v, 120) + 10) / 100 * e(l) }; }
    }
    throw new Error('no dynamic factor');
}

// [phi', 0.5 phi''] of a real train, EN 1991-2:2024 Annex C, the larger sum of the
// upper and lower limit of n0; cL: 23.58 in (C.10), 23.76 in TRVINFRA-00331 (8-17)
function realTrain(L, v, cL) {
    cL = cL || 23.58;
    const vs = v / 3.6, nL = L <= 20 ? 80 / L : cL * Math.pow(L, -0.592), n0 = [nL, 94.76 * Math.pow(L, -0.748)];
    let pp = [-Infinity, -Infinity];
    for (const n of n0) {
        const K = vs / (2 * L * n), p1 = K < 0.76 ? K / (1 - K + K * K * K * K) : 1.325, av = Math.min(vs / 22, 1);
        const p2 = Math.max(av / 100 * (56 * Math.exp(-((L / 10) ** 2)) + 50 * (L * n / 80 - 1) * Math.exp(-((L / 20) ** 2))), 0);
        if (p1 + 0.5 * p2 > pp[0] + pp[1]) pp = [p1, 0.5 * p2];
    }
    return pp;
}

root.BS = BS;
})(typeof self !== 'undefined' ? self : this);
