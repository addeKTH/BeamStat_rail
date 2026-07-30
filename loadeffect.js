/* ------------------------------------------------------------------------
   loadeffect.js - maximum load effects of a design train run over given
   influence lines.  Port of LoadEffect.m (Andreas Andersson, KTH).

   The locomotive group is stepped along the beam one element at a time.  At
   every position the wagons are added in the arrangement that is most
   unfavourable for the effect being sought, and only then is the envelope
   over all positions taken - the same order as the MATLAB version, and for
   the same reason: doing it that way costs nothing extra and cannot miss a
   position where a slightly weaker locomotive effect is more than made up
   for by the wagons.

   The wagon rules follow the codes without enumeration:
     1919   discrete wagons.  Each is independently loaded or empty, so the
            best choice is max(loaded,empty) wagon by wagon, and the best cut
            is the running extreme of the cumulative sum from the locomotive
            outwards.
     1931-  distributed wagons.  The intensity may switch anywhere, so the
            best arrangement uses q where the influence line is favourable
            and qe where it is not, which is the cumulative integral of
            q*max(eta,0) + qe*min(eta,0).
   The train standing clear of the bridge is always admissible, so the
   envelopes bracket zero.

   loadEffect(IL, type, opt) -> out, with the same fields as the MATLAB
   function.  Envelopes are {min, max} pairs of Float64Array, one entry per
   section.
   --------------------------------------------------------------------- */
(function (global) {
'use strict';

const QS = ['M', 'V', 'd', 'r', 'RF'];

/* ---------------------------------------------------------------- helpers */
function cumtrapz(x, y) {
    const o = new Float64Array(y.length);
    for (let i = 1; i < y.length; i++) o[i] = o[i - 1] + 0.5 * (x[i] - x[i - 1]) * (y[i] + y[i - 1]);
    return o;
}
function clampi(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* the response of one load group on the common train-position grid.
   R[r] = sum_a P_a * Z[r + round(off_a/dL) - kA], which is what
   LoadResponse followed by the index shift of align() comes to once the
   axle positions sit on the element grid. */
function align(Z, n, dL, off, Ps, nR, kA, out) {
    for (let a = 0; a < off.length; a++) {
        const P = Ps[a];
        if (P === 0) continue;
        const sh = Math.round(off[a] / dL) - kA;
        const lo = Math.max(0, -sh), hi = Math.min(nR, n - sh);
        for (let k = 0; k < Z.length; k++) {
            const z = Z[k], o = out[k];
            for (let r = lo; r < hi; r++) o[r] += P * z[r + sh];
        }
    }
}
function zeros2(m, nR) { const o = []; for (let k = 0; k < m; k++) o.push(new Float64Array(nR)); return o; }

/* node index of the offset o for every train position, clipped to the beam */
function idxOf(o, dL, kA, nR, n) {
    const j = new Int32Array(nR);
    const K = Math.round(o / dL) - kA;
    for (let r = 0; r < nR; r++) j[r] = clampi(r + K, 0, n - 1);
    return j;
}

/* the same train running the other way */
function mirror(T) {
    const L = T.Ltrain;
    const ord = T.x.map((v, i) => i).sort((a, b) => (L - T.x[a]) - (L - T.x[b]));
    const M = Object.assign({}, T);
    M.x   = ord.map(i => L - T.x[i]);
    M.P   = ord.map(i => T.P[i]);
    M.Pe  = ord.map(i => T.Pe[i]);
    M.veh = ord.map(i => T.veh[i]);
    M.isW = ord.map(i => T.isW[i]);
    M.lead = (T.lead === null || T.lead === undefined) ? null : ord.indexOf(T.lead);
    M.qseg = T.qseg.map(r => [L - r[1], L - r[0]]);
    return M;
}

/* =======================================================================
   Envelope of one influence matrix over every position of the train
   ==================================================================== */
function sweep(Z, x, dL, T) {
    const n = x.length, m = Z.length;
    let A = 0, B = 0;
    for (const v of T.x) { if (v > A) A = v; if (-v > B) B = -v; }
    for (const r of T.qseg) for (const v of r) {         // a finite block must
        if (isFinite(v)) { if (v > A) A = v; if (-v > B) B = -v; }   // clear the beam
    }
    const kA = Math.round(A / dL);
    const nR = Math.round((A + x[n - 1] - x[0] + B) / dL) + 1;
    const p  = new Float64Array(nR);
    for (let r = 0; r < nR; r++) p[r] = x[0] - A + r * dL;

    /* the train may be shortened from the rear: vehicle by vehicle in 1919
       and 1938, axle by axle in 1961, which allows any shortening */
    const grp = (T.code === 1961) ? T.x.map((_, i) => i + 1) : T.veh;
    const gv  = Array.from(new Set(grp)).sort((a, b) => a - b);

    const Cx = zeros2(m, nR), Cn = zeros2(m, nR);
    const Wx = zeros2(m, nR), Wn = zeros2(m, nR);

    for (let gi = 0; gi < gv.length; gi++) {
        const v = gv[gi], sel = [];
        for (let i = 0; i < grp.length; i++) if (grp[i] === v) sel.push(i);
        const off = sel.map(i => T.x[i]);
        const hasW = sel.some(i => T.isW[i]);
        const lead = (gi === 0 && T.code <= 1938 && T.lead !== null && T.lead !== undefined);

        let Rx = zeros2(m, nR), Rn;
        align(Z, n, dL, off, sel.map(i => T.P[i]), nR, kA, Rx);
        if (hasW) {                                      // loaded or empty
            const Re = zeros2(m, nR);
            align(Z, n, dL, off, sel.map(i => T.Pe[i]), nR, kA, Re);
            Rn = zeros2(m, nR);
            for (let k = 0; k < m; k++) {
                const a = Rx[k], b = Re[k], mn = Rn[k];
                for (let r = 0; r < nR; r++) {
                    const lo = Math.min(a[r], b[r]), hi = Math.max(a[r], b[r]);
                    mn[r] = lo; a[r] = hi;
                }
            }
        } else {
            Rn = lead ? Rx.map(a => Float64Array.from(a)) : Rx;
        }
        if (lead) {                                      // leading axle may be omitted
            const R1 = zeros2(m, nR);
            align(Z, n, dL, [T.x[T.lead]], [T.P[T.lead]], nR, kA, R1);
            for (let k = 0; k < m; k++) {
                const a = Rn[k], b = Rx[k], c = R1[k];
                for (let r = 0; r < nR; r++) {
                    a[r] = Math.min(a[r], a[r] - c[r]);
                    b[r] = Math.max(b[r], b[r] - c[r]);
                }
            }
        }
        for (let k = 0; k < m; k++) {
            const cx = Cx[k], wx = Wx[k], cn = Cn[k], wn = Wn[k], rx = Rx[k], rn = Rn[k];
            for (let r = 0; r < nR; r++) {
                cx[r] += rx[r]; if (cx[r] > wx[r]) wx[r] = cx[r];
                cn[r] += rn[r]; if (cn[r] < wn[r]) wn[r] = cn[r];
            }
        }
    }

    if (T.q > 0) {                                       // distributed wagons
        const kL = (!T.x.length) || meanOf(T.x, grp, Math.min.apply(null, gv))
                                 <= meanOf(T.x, grp, Math.max.apply(null, gv));
        const DxF = zeros2(m, nR), DnF = zeros2(m, nR);
        const DxB = zeros2(m, nR), DnB = zeros2(m, nR);
        for (let k = 0; k < m; k++) {
            const z = Z[k];
            const zp = new Float64Array(n), zm = new Float64Array(n);
            for (let i = 0; i < n; i++) { zp[i] = Math.max(z[i], 0); zm[i] = Math.min(z[i], 0); }
            const Cp = cumtrapz(x, zp), Cm = cumtrapz(x, zm);
            const Gp = new Float64Array(n), Gm = new Float64Array(n);
            for (let i = 0; i < n; i++) {
                Gp[i] = T.q * Cp[i] + T.qe * Cm[i];
                Gm[i] = T.qe * Cp[i] + T.q * Cm[i];
            }
            /* running extremes: Sx/Sn from the right, Px/Pn from the left */
            const Sx = new Float64Array(n), Sn = new Float64Array(n);
            const Px = new Float64Array(n), Pn = new Float64Array(n);
            Sx[n - 1] = Gp[n - 1]; Sn[n - 1] = Gm[n - 1];
            for (let i = n - 2; i >= 0; i--) {
                Sx[i] = Math.max(Sx[i + 1], Gp[i]);
                Sn[i] = Math.min(Sn[i + 1], Gm[i]);
            }
            Px[0] = Gp[0]; Pn[0] = Gm[0];
            for (let i = 1; i < n; i++) {
                Px[i] = Math.min(Px[i - 1], Gp[i]);
                Pn[i] = Math.max(Pn[i - 1], Gm[i]);
            }
            for (let i = 0; i < T.qseg.length; i++) {
                const opL = !isFinite(T.qseg[i][0]), opR = !isFinite(T.qseg[i][1]);
                let dx, dn;
                if (opL) {                               // open to the left
                    const j = idxOf(T.qseg[i][1], dL, kA, nR, n);
                    dx = r => Gp[j[r]] - Px[j[r]];  dn = r => Gm[j[r]] - Pn[j[r]];
                } else if (opR) {                        // open to the right
                    const j = idxOf(T.qseg[i][0], dL, kA, nR, n);
                    dx = r => Sx[j[r]] - Gp[j[r]];  dn = r => Sn[j[r]] - Gm[j[r]];
                } else {                                 // a fixed block
                    const ja = idxOf(T.qseg[i][0], dL, kA, nR, n);
                    const jb = idxOf(T.qseg[i][1], dL, kA, nR, n);
                    dx = r => Gp[jb[r]] - Gp[ja[r]];  dn = r => Gm[jb[r]] - Gm[ja[r]];
                }
                /* a region at the surviving end stays with every truncated
                   train; one at the cut end, and any fixed block, goes with
                   the complete train only */
                const front = (opL && kL) || (opR && !kL);
                const ax = front ? DxF[k] : DxB[k], an = front ? DnF[k] : DnB[k];
                for (let r = 0; r < nR; r++) { ax[r] += dx(r); an[r] += dn(r); }
            }
        }
        for (let k = 0; k < m; k++) {
            const wx = Wx[k], wn = Wn[k], cx = Cx[k], cn = Cn[k];
            const xf = DxF[k], xb = DxB[k], nf = DnF[k], nb = DnB[k];
            for (let r = 0; r < nR; r++) {
                wx[r] = Math.max(wx[r] + xf[r], cx[r] + xf[r] + xb[r]);
                wn[r] = Math.min(wn[r] + nf[r], cn[r] + nf[r] + nb[r]);
            }
        }
    }

    /* the train clear of the bridge is always admissible */
    const emin = new Float64Array(m), emax = new Float64Array(m);
    const pmin = new Float64Array(m), pmax = new Float64Array(m);
    for (let k = 0; k < m; k++) {
        const wx = Wx[k], wn = Wn[k];
        let bx = wx[0], ix = 0, bn = wn[0], iN = 0;
        for (let r = 1; r < nR; r++) {
            if (wx[r] > bx) { bx = wx[r]; ix = r; }
            if (wn[r] < bn) { bn = wn[r]; iN = r; }
        }
        if (0 > bx) { bx = 0; ix = nR; }
        if (0 < bn) { bn = 0; iN = nR; }
        emax[k] = bx; pmax[k] = p[Math.min(ix, nR - 1)];
        emin[k] = bn; pmin[k] = p[Math.min(iN, nR - 1)];
    }
    return { emin, emax, pmin, pmax };
}
function meanOf(x, grp, v) {
    let s = 0, c = 0;
    for (let i = 0; i < grp.length; i++) if (grp[i] === v) { s += x[i]; c++; }
    return c ? s / c : 0;
}

/* =======================================================================
   Rebuild the arrangement the sweep found at one section, for plotting.
   Follows exactly the same rules as sweep.
   ==================================================================== */
function config(h, x, dL, T, p, sg) {
    const n = x.length;
    let P = [], grp = [], cs = [0], bt = 0, nk = 0, e = [], hv = [], mg = 0;

    if (T.x.length) {
        hv = T.x.map(v => {
            const k = Math.round((p + v - x[0]) / dL);
            return (k >= 0 && k < n) ? h[k] : 0;
        });
        const nv = Math.max.apply(null, T.veh);
        const al = new Float64Array(nv + 1), ae = new Float64Array(nv + 1);
        const aw = new Float64Array(nv + 1);
        for (let i = 0; i < T.veh.length; i++) {
            al[T.veh[i]] += T.P[i]  * hv[i];
            ae[T.veh[i]] += T.Pe[i] * hv[i];
            if (T.isW[i]) aw[T.veh[i]] += 1;
        }
        const ew = [];
        for (let v = 0; v <= nv; v++) ew[v] = aw[v] > 0 && sg * ae[v] > sg * al[v];
        P = T.P.slice();
        e = T.veh.map(v => !!ew[v]);
        for (let i = 0; i < P.length; i++) if (e[i]) P[i] = T.Pe[i];
        const c = P.map((v, i) => v * hv[i]);

        grp = (T.code === 1961) ? T.x.map((_, i) => i + 1) : T.veh;
        if (T.code <= 1938 && T.lead !== null && T.lead !== undefined) {
            const gl = grp[T.lead];
            let s1 = 0;
            for (let i = 0; i < c.length; i++) if (grp[i] === gl) s1 += c[i];
            if (sg * (s1 - c[T.lead]) > sg * s1) { P[T.lead] = 0; c[T.lead] = 0; }
        }
        mg = Math.max.apply(null, grp);
        const acc = new Float64Array(mg + 1);
        for (let i = 0; i < c.length; i++) acc[grp[i]] += c[i];
        cs = [0];
        for (let v = 1; v <= mg; v++) cs.push(cs[v - 1] + acc[v]);
        let bv = sg * cs[0];
        nk = 0;
        for (let i = 1; i < cs.length; i++) if (sg * cs[i] > bv) { bv = sg * cs[i]; nk = i; }
        bt = cs[nk];                                     // best truncation
    }

    const w = new Float64Array(n);
    if (T.q > 0) {
        const wf = new Float64Array(n);
        for (let i = 0; i < n; i++) wf[i] = (sg * h[i] >= 0) ? T.q : T.qe;
        const wh = new Float64Array(n);
        for (let i = 0; i < n; i++) wh[i] = wf[i] * h[i];
        const G = cumtrapz(x, wh);
        const nq = T.qseg.length, ab = [], dvi = new Float64Array(nq);
        const gvv = Array.from(new Set(grp)).sort((a, b) => a - b);
        const kL = (!T.x.length) || meanOf(T.x, grp, gvv[0])
                                 <= meanOf(T.x, grp, gvv[gvv.length - 1]);
        const fr = T.qseg.map(r => (!isFinite(r[0]) && kL) || (!isFinite(r[1]) && !kL));
        for (let i = 0; i < nq; i++) {
            let a, b;
            if (!isFinite(T.qseg[i][0])) {               // open to the left
                b = clampi(Math.round((p + T.qseg[i][1] - x[0]) / dL), 0, n - 1);
                a = 0; let bv = sg * G[0];
                for (let k = 1; k <= b; k++) if (sg * G[k] < bv) { bv = sg * G[k]; a = k; }
            } else if (!isFinite(T.qseg[i][1])) {        // open to the right
                a = clampi(Math.round((p + T.qseg[i][0] - x[0]) / dL), 0, n - 1);
                b = a; let bv = sg * G[a];
                for (let k = a + 1; k < n; k++) if (sg * G[k] > bv) { bv = sg * G[k]; b = k; }
            } else {                                     // a fixed block
                a = clampi(Math.round((p + T.qseg[i][0] - x[0]) / dL), 0, n - 1);
                b = clampi(Math.round((p + T.qseg[i][1] - x[0]) / dL), 0, n - 1);
            }
            ab.push([a, b]);
            if (b > a) dvi[i] = G[b] - G[a];
        }
        let sAll = 0, sFr = 0;
        for (let i = 0; i < nq; i++) { sAll += dvi[i]; if (fr[i]) sFr += dvi[i]; }
        let on;
        if (sg * (cs[cs.length - 1] + sAll) > sg * (bt + sFr)) {
            nk = mg; bt = cs[cs.length - 1] + sAll;      // complete train plus wagons
            on = fr.map(() => true);
        } else {
            bt = bt + sFr;                               // the trailing wagons were cut
            on = fr;
        }
        for (let i = 0; i < nq; i++) {
            if (!on[i] || ab[i][1] <= ab[i][0]) continue;
            for (let k = ab[i][0]; k <= ab[i][1]; k++) w[k] = wf[k];
        }
        /* a stretch one node long sits on a zero of the influence line and
           carries nothing */
        let i0 = -1;
        for (let i = 0; i <= n; i++) {
            const on1 = i < n && w[i] > 0;
            if (on1 && i0 < 0) i0 = i;
            if (!on1 && i0 >= 0) { if (i - 1 === i0) w[i0] = 0; i0 = -1; }
        }
    }

    const keep = [];
    for (let i = 0; i < P.length; i++) if (grp[i] <= nk && P[i] !== 0) keep.push(i);
    return { xa: keep.map(i => p + T.x[i]), Pa: keep.map(i => P[i]),
             emp: keep.map(i => e[i]), w, sum: bt };
}

/* =======================================================================
   loadEffect(IL, type, opt)
   ==================================================================== */
function loadEffect(IL, type, opt) {
    const D = { nWagon: 10, v: null, dyn: true, dynDisp: false, both: true,
                Lphi: null, fac: 1, n0: null };
    opt = Object.assign({}, D, opt || {});
    type = String(type).toUpperCase();

    /* combined models: run both alternatives and keep the larger effect */
    if (Trains.COMB[type]) {
        const c = Trains.COMB[type];
        const o = c.of.map((t, k) => loadEffect(IL, t, Object.assign({}, opt, { fac: opt.fac * c.fac[k] })));
        return mergeLE(o[0], o[1], type);
    }

    const T = Trains.build(type, opt.nWagon);
    T.lead = T.x.length ? 0 : null;                      // leading locomotive axle
    if (opt.fac !== 1) {
        T.P = T.P.map(v => v * opt.fac);  T.Pe = T.Pe.map(v => v * opt.fac);
        T.q *= opt.fac;  T.qe *= opt.fac;
    }

    /* snap the train to the element grid once, so that the sweep and the
       reconstruction see exactly the same positions */
    const dL = IL.dL, x = IL.x;
    let snap = 0;
    T.x = T.x.map(v => { const s = Math.round(v / dL) * dL; snap = Math.max(snap, Math.abs(s - v)); return s; });
    T.qseg = T.qseg.map(r => r.map(v => isFinite(v) ? Math.round(v / dL) * dL : v));
    if (T.x.length) T.Ltrain = T.x[T.x.length - 1] - T.x[0];

    const warn = [];
    if (snap > 1e-9) warn.push('axle positions snapped to the ' + dL + ' m grid, by up to ' + snap.toFixed(3) + ' m');
    if (T.q === 0 && T.isW.some(Boolean) && T.Ltrain < IL.Ltot)
        warn.push('the train is ' + T.Ltrain.toFixed(1) + ' m and the beam ' +
                  IL.Ltot.toFixed(1) + ' m - raise the wagon count');

    /* sweep every quantity, in one or both running directions */
    const Td = opt.both ? [T, mirror(T)] : [T];
    const S = {}, P = {}, G = {};
    for (const q of QS) {
        const Z = IL[q];
        let emin, emax, pmin, pmax, dmin, dmax;
        for (let k = 0; k < Td.length; k++) {
            const s = sweep(Z, x, dL, Td[k]);
            if (k === 0) {
                emin = s.emin; emax = s.emax; pmin = s.pmin; pmax = s.pmax;
                dmin = new Int8Array(emin.length).fill(1);
                dmax = new Int8Array(emin.length).fill(1);
            } else {
                for (let i = 0; i < emin.length; i++) {
                    if (s.emax[i] > emax[i]) { emax[i] = s.emax[i]; pmax[i] = s.pmax[i]; dmax[i] = 2; }
                    if (s.emin[i] < emin[i]) { emin[i] = s.emin[i]; pmin[i] = s.pmin[i]; dmin[i] = 2; }
                }
            }
        }
        S[q] = { min: emin, max: emax };
        P[q] = { min: pmin, max: pmax };
        G[q] = { min: dmin, max: dmax };
    }

    /* determinant length and dynamic factor, one value for the whole bridge */
    const sv = [];
    IL.supDir.forEach((d, i) => { if (d === 1) sv.push(IL.supX[i]); });
    const us = Array.from(new Set(sv)).sort((a, b) => a - b);
    let Ls = [];
    for (let i = 1; i < us.length; i++) Ls.push(us[i] - us[i - 1]);
    if (!Ls.length) Ls = [x[x.length - 1] - x[0]];
    const ns = Ls.length;
    const Lphi = (opt.Lphi !== null && opt.Lphi !== undefined) ? opt.Lphi
        : (Ls.reduce((a, b) => a + b, 0) / ns) * (1 + 0.1 * Math.min(ns, 5) * (ns > 1 ? 1 : 0));
    const vv = (opt.v === null || opt.v === undefined) ? 100 : opt.v;
    let phi;
    if (!opt.dyn) phi = 1;
    else if (opt.n0 && T.epsn) phi = T.epsn(Lphi, vv, opt.n0);
    else if ((opt.v === null || opt.v === undefined) || !T.epsv) phi = T.eps(Lphi);
    else phi = T.epsv(Lphi, opt.v);
    const pd = opt.dynDisp ? phi : 1;                    // displacements stay static

    const out = { xp: IL.xp, x, supX: IL.supX, supDir: IL.supDir,
                  stat: S, p: P, dir: G, phi, Lphi, Lspan: Ls,
                  type, T, warn, xpeak: {}, pos: {}, chk: 0 };
    for (const q of QS) {
        const f = (q === 'd' || q === 'r') ? pd : phi;
        out[q] = { min: Float64Array.from(S[q].min, v => v * f),
                   max: Float64Array.from(S[q].max, v => v * f) };
    }

    /* peak values */
    const PK = [['Mmax', 'M', 1], ['Mmin', 'M', -1], ['Vmax', 'V', 0], ['dmax', 'd', 0],
                ['rmax', 'r', 0], ['RFmax', 'RF', 1], ['RFmin', 'RF', -1]];
    for (const [nm, qn, c] of PK) {
        const E = out[qn];
        let iv = [], xq;
        if (qn === 'RF') {                               // vertical reactions only
            xq = IL.supX;
            IL.supDir.forEach((d, i) => { if (d === 1) iv.push(i); });
            if (!iv.length) iv = IL.supX.map((_, i) => i);
        } else {
            xq = IL.xp;
            iv = []; for (let i = 0; i < E.max.length; i++) iv.push(i);
        }
        let k = iv[0], sd = 1, val;
        if (c > 0) {
            val = -Infinity;
            iv.forEach(i => { if (E.max[i] > val) { val = E.max[i]; k = i; } });
            sd = 2;
        } else if (c < 0) {
            val = Infinity;
            iv.forEach(i => { if (E.min[i] < val) { val = E.min[i]; k = i; } });
            sd = 1;
        } else {
            let best = -Infinity;
            iv.forEach(i => {
                if (Math.abs(E.max[i]) > best) { best = Math.abs(E.max[i]); k = i; sd = 2; }
                if (Math.abs(E.min[i]) > best) { best = Math.abs(E.min[i]); k = i; sd = 1; }
            });
            val = (sd === 2) ? E.max[k] : E.min[k];
        }
        out[nm] = val;
        out.xpeak[nm] = xq[k];

        /* replay the arrangement that produced this peak */
        const side = (sd === 2) ? 'max' : 'min';
        const Tc = (G[qn][side][k] === 2) ? mirror(T) : T;
        const C = config(IL[qn][k], x, dL, Tc, P[qn][side][k], 2 * sd - 3);
        C.name = nm; C.quant = qn; C.x = xq[k];
        C.p = P[qn][side][k]; C.dir = G[qn][side][k];
        C.h = IL[qn][k];
        C.val = val; C.valStat = S[qn][side][k]; C.q = T.q;
        out.chk = Math.max(out.chk, Math.abs(C.sum - C.valStat) / Math.max(Math.abs(C.valStat), 1e-300));
        delete C.sum;
        out.pos[nm] = C;
    }
    return out;
}

/* two alternatives: keep the larger effect at every section and peak */
function mergeLE(a, b, type) {
    const out = Object.assign({}, a);
    out.type = type;
    for (const q of QS) {
        out[q] = { min: Float64Array.from(a[q].min), max: Float64Array.from(a[q].max) };
        out.stat[q] = { min: Float64Array.from(a.stat[q].min), max: Float64Array.from(a.stat[q].max) };
        out.p[q]   = { min: Float64Array.from(a.p[q].min),   max: Float64Array.from(a.p[q].max) };
        out.dir[q] = { min: Int8Array.from(a.dir[q].min),    max: Int8Array.from(a.dir[q].max) };
        for (let i = 0; i < out[q].max.length; i++) {
            if (b[q].max[i] > out[q].max[i]) {
                out[q].max[i] = b[q].max[i]; out.stat[q].max[i] = b.stat[q].max[i];
                out.p[q].max[i] = b.p[q].max[i]; out.dir[q].max[i] = b.dir[q].max[i];
            }
            if (b[q].min[i] < out[q].min[i]) {
                out[q].min[i] = b[q].min[i]; out.stat[q].min[i] = b.stat[q].min[i];
                out.p[q].min[i] = b.p[q].min[i]; out.dir[q].min[i] = b.dir[q].min[i];
            }
        }
    }
    out.xpeak = Object.assign({}, a.xpeak);
    out.pos   = Object.assign({}, a.pos);
    const PK = [['Mmax', 1], ['Mmin', -1], ['Vmax', 0], ['dmax', 0], ['rmax', 0],
                ['RFmax', 1], ['RFmin', -1]];
    for (const [nm, c] of PK) {
        if ((c > 0 && b[nm] > a[nm]) || (c < 0 && b[nm] < a[nm]) ||
            (c === 0 && Math.abs(b[nm]) > Math.abs(a[nm]))) {
            out[nm] = b[nm]; out.xpeak[nm] = b.xpeak[nm]; out.pos[nm] = b.pos[nm];
        }
    }
    out.T = [a.T, b.T];
    out.warn = a.warn.concat(b.warn);
    out.chk = Math.max(a.chk, b.chk);
    return out;
}

global.LoadEffect = { loadEffect, sweep, config, mirror };

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).LoadEffect;
