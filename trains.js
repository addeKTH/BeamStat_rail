/* ------------------------------------------------------------------------
   trains.js - train load models of the Swedish railway bridge design codes
   Port of TrainLoadSOU.m (Andreas Andersson, KTH).  Vertical traffic load
   only.

   build(type, nWagon) returns the same T as the MATLAB function:
     x      axle positions (m), the leading axle at 0
     P      axle loads with the wagons loaded (N)
     Pe     the same with the wagons empty
     veh    vehicle number of each axle
     isW    true for an axle belonging to a wagon
     q, qe  distributed wagon load, loaded and empty (N/m)
     qseg   [x1 x2] rows saying where the distributed load may act, in the
            same coordinate as x.  -Infinity and Infinity mean it continues
            indefinitely; how far it actually reaches is decided later by the
            load effect, since it depends on the influence line
     eps    dynamic factor as a function of the loaded length l, returning
            1 + eps/100 so that it multiplies the static response
     epsv   the same at a lower speed, epsn with the natural frequency given

   The axle loads of the Swedish codes are given in tonnes and converted with
   g = 9.81; the EN models are given in kN.
   --------------------------------------------------------------------- */
(function (global) {
'use strict';

const g = 9.81;

/* one vehicle: front overhang, internal spacings, rear overhang */
function mkv(ohF, s, ohR, P, Pe, isW) {
    s = Array.isArray(s) ? s : [s];
    const xa = [ohF];
    let c = ohF;
    for (const v of s) { c += v; xa.push(c); }
    if (xa.length !== P.length)
        throw new Error('vehicle has ' + xa.length + ' axles but ' + P.length + ' loads');
    return { xa, L: ohF + s.reduce((a, b) => a + b, 0) + ohR,
             P, Pe: (Pe && Pe.length) ? Pe : P.slice(), isW: !!isW };
}
const rep  = (v, n) => { const o = []; for (let i = 0; i < n; i++) o.push(v); return o; };
const fill = (v, n) => { const o = []; for (let i = 0; i < n; i++) o.push(v); return o; };

/* EN 15528 Annex A table A.1: name, P (t), front, internal, rear */
const CAT = [
    ['A10', 10.0, 2.0, [1.7, 12.6, 1.7], 2.0],
    ['A12', 12.0, 2.0, [1.7, 12.6, 1.7], 2.0],
    ['A14', 14.0, 2.0, [1.7, 12.6, 1.7], 2.0],
    ['A1',  16.0, 1.5, [1.8, 6.20, 1.8], 1.5],
    ['B1',  18.0, 1.5, [1.8, 7.80, 1.8], 1.5],
    ['B2',  18.0, 1.5, [1.8, 4.65, 1.8], 1.5],
    ['C2',  20.0, 1.5, [1.8, 5.90, 1.8], 1.5],
    ['C3',  20.0, 1.5, [1.8, 4.50, 1.8], 1.5],
    ['C4',  20.0, 1.5, [1.8, 3.40, 1.8], 1.5],
    ['D2',  22.5, 1.5, [1.8, 7.45, 1.8], 1.5],
    ['D3',  22.5, 1.5, [1.8, 5.90, 1.8], 1.5],
    ['D4',  22.5, 1.5, [1.8, 4.65, 1.8], 1.5],
    ['D5',  22.5, 1.5, [1.8, 3.62, 1.8], 1.5],
    ['E4',  25.0, 1.5, [1.8, 5.90, 1.8], 1.5],
    ['E5',  25.0, 1.5, [1.8, 4.75, 1.8], 1.5],
    ['E6',  25.0, 1.5, [1.7, 1.7, 5.2, 1.7, 1.7], 1.5],
    ['XLA', 20.0, 1.5, [1.5, 1.5, 6.0, 1.5, 1.5], 1.5],
    ['XLB', 22.5, 2.2, [1.7, 2.0, 6.5, 2.0, 1.7], 2.2]
];

/* everything LoadEffect accepts, in the order of the pull-down */
const TYPES = ['A1919', 'B1919', 'C1919', 'D1919', 'A', 'B', 'F', 'LG1', 'LG2',
               '85F', '60F', 'LM71', 'SW0', 'SW2', 'UT'].concat(CAT.map(c => c[0]));

/* the combined models of SOU 1961:12 - the larger effect of two alternatives */
const COMB = { '85F': { of: ['F', 'LG1'], fac: [0.85, 1] },
               '60F': { of: ['F', 'LG2'], fac: [0.60, 1] } };

function build(type, nWagon) {
    type = String(type).toUpperCase();
    nWagon = (nWagon === undefined || nWagon === null) ? 10 : Math.max(0, Math.round(nWagon));

    let q = 0, qe = 0, qseg = [], vs = null, code, cv = 1e3 * g;
    let xa = [], Pa = [], Pea = [], vi = [], iw = [];
    let vmax = null, annexD = false, Lg = null;

    if (/^[ABCD]1919$/.test(type)) {
        code = 1919; vmax = 100;
        const lok = P => mkv(2.0, [2.6, 1.4, 1.4, 1.4], 2.5, P, null, false);
        const ten = P => mkv(1.4, [1.6, 1.6], 1.8, P, null, false);
        let wg;
        switch (type[0]) {
            case 'A': vs = [lok([15, 20, 20, 20, 20]), ten([18, 18, 18])];
                      wg = mkv(2.0, [1.6, 1.6], 2.0, [20, 20, 20], [4, 4, 4], true); break;
            case 'B': vs = [lok([13.5, 18, 18, 18, 18]), ten([16.2, 16.2, 16.2])];
                      wg = mkv(1.6, [3.3], 1.6, [14, 14], [3, 3], true); break;
            case 'C': vs = [lok([10.5, 14, 14, 14, 14]), ten([12.6, 12.6, 12.6])];
                      wg = mkv(1.6, [3.3], 1.6, [14, 14], [3, 3], true); break;
            default: {
                const lk = mkv(1.0, [1.0, 1.0, 1.0, 1.0], 1.0, [3, 5, 5, 5, 3], null, false);
                vs = [lk, lk];
                wg = mkv(1.0, [1.0, 3.0, 1.0], 1.0, [4, 4, 4, 4], null, true);
            }
        }
        if (type[0] !== 'D') vs = vs.concat(vs);          // Lok Tender Lok Tender
        vs = vs.concat(rep(wg, nWagon));

    } else if (type === 'A' || type === 'B') {
        code = 1938; vmax = 100;
        const lok = P => mkv(2.0, [2.6, 1.5, 1.5, 1.5], 2.5, P, null, false);
        const ten = P => mkv(1.4, [1.6, 1.6], 1.8, P, null, false);
        if (type === 'A') { vs = [lok([15, 20, 20, 20, 20]), ten([18, 18, 18])]; q = 8.5; qe = 1.0; }
        else              { vs = [lok([13.5, 18, 18, 18, 18]), ten([16.2, 16.2, 16.2])]; q = 5.0; qe = 1.0; }
        vs = vs.concat(vs);

    } else if (type === 'F' || type === 'LG1' || type === 'LG2') {
        code = 1961; vmax = 120;
        if (type === 'F') {
            for (let i = 0; i < 6; i++) xa.push(1.6 + i * 1.6);
            for (let i = 0; i < 6; i++) xa.push(12.8 + i * 1.6);   // 3.2 m between units
            Pa = fill(25, 12);
            vi = fill(1, 6).concat(fill(2, 6));
            Lg = 22.4; q = 8.5; qe = 1.25;
            qseg = [[-Infinity, 0], [Lg, Infinity]];               // wagons on both sides
        } else if (type === 'LG1') {
            for (let i = 0; i < 5; i++) xa.push(i * 1.6);
            Pa = fill(25, 5); vi = fill(1, 5); Lg = xa[xa.length - 1];
        } else {
            for (let i = 0; i < 4; i++) xa.push(i * 1.6);
            Pa = fill(20, 4); vi = fill(1, 4); Lg = xa[xa.length - 1];
        }
        Pea = Pa.slice(); iw = fill(false, xa.length);

    } else if (/^FT([1-9]|1[0-2])$/.test(type)) {
        code = 1991; cv = 1e3; annexD = true;             // loads given in kN
        const lokA = mkv(1.4, [2.2, 2.2, 6.9, 2.2, 2.2], 1.4, fill(225, 6), null, false);
        const lokB = mkv(2.0, [2.1, 2.1, 4.4, 2.1, 2.1], 2.0, fill(225, 6), null, false);
        switch (type) {
            case 'FT1': vmax = 200;
                vs = [lokA].concat(rep(mkv(1.8, [2.6, 11.5, 2.6], 1.8, fill(110, 4), null, false), 12)); break;
            case 'FT2': vmax = 160;
                vs = [mkv(1.4, [3.3, 6.7, 3.3], 1.4, fill(225, 4), null, false)]
                     .concat(rep(mkv(2.5, [2.5, 16.5, 2.5], 2.5, fill(110, 4), null, false), 10)); break;
            case 'FT3': vmax = 250;
                vs = [mkv(4.7, [3, 8.46, 3], 2.0, fill(200, 4), null, false)]
                     .concat(rep(mkv(2.5, [2.45, 16.5, 2.45], 2.5, fill(150, 4), null, false), 13),
                             [mkv(2.0, [3, 8.46, 3], 4.7, fill(200, 4), null, false)]); break;
            case 'FT4': vmax = 250;
                vs = [mkv(3.5, [3, 11, 3], 1.65, fill(170, 4), null, false),
                      mkv(1.65, [3, 15.7], 1.5, fill(170, 3), null, false)]
                     .concat(rep(mkv(1.5, [15.7], 1.5, fill(170, 2), null, false), 8),
                             [mkv(1.5, [15.7, 3], 1.65, fill(170, 3), null, false),
                              mkv(1.65, [3, 11, 3], 3.5, fill(170, 4), null, false)]); break;
            case 'FT5': vmax = 80;
                vs = [lokB].concat(rep(mkv(2.0, [1.8, 1.8, 5.7, 1.8, 1.8], 2.0, fill(225, 6), null, false), 15)); break;
            case 'FT6': {
                vmax = 100;
                const wA = mkv(1.9, [6.5], 1.9, fill(70, 2), null, false);
                const wB = mkv(1.8, [1.8, 12.8, 1.8], 1.8, fill(225, 4), null, false);
                const wC = mkv(1.6, [1.8, 8.0, 1.8], 1.6, fill(225, 4), null, false);
                vs = [lokB];
                for (const ch of 'AABACCABBBAACCABCAACCB')
                    vs.push(ch === 'A' ? wA : ch === 'B' ? wB : wC);
                break;
            }
            case 'FT7': vmax = 120;
                vs = [lokA].concat(rep(mkv(1.6, [1.8, 11, 1.8], 1.6, fill(225, 4), null, false), 10)); break;
            case 'FT8': vmax = 100;
                vs = [lokA].concat(rep(mkv(2.1, [5.5], 2.1, fill(225, 2), null, false), 20)); break;
            case 'FT9': {
                vmax = 120;
                const cA = mkv(2.15, [2.5, 14.0, 2.5], 2.15, fill(130, 4), null, false);
                const cB = mkv(2.15, [2.5, 11.5, 2.5], 2.15, fill(110, 4), null, false);
                vs = [cA, cB, cA, cA, cB, cA]; break;
            }
            case 'FT10': {
                vmax = 120;
                const uA = mkv(1.75, [2.4, 7.9, 2.4], 1.75, [150, 100, 100, 150], null, false);
                const uB = mkv(1.75, [2.4, 7.9, 2.4], 1.75, fill(100, 4), null, false);
                vs = [uA, uB, uB, uA, uA, uB, uB, uA]; break;
            }
            case 'FT11': vmax = 120;
                vs = [lokA].concat(rep(mkv(1.5, [2.0, 11, 2.0], 1.5, fill(250, 4), null, false), 10)); break;
            default: vmax = 100;                          // FT12
                vs = [lokA].concat(rep(mkv(2.1, [5.5], 2.1, fill(250, 2), null, false), 20)); break;
        }

    } else if (CAT.some(c => c[0] === type)) {
        code = 15528;                                     // EN 15528 line categories
        const W = CAT.find(c => c[0] === type);
        const P0 = W[1], ohF = W[2], sp = W[3], ohR = W[4];
        const na = sp.length + 1;
        const Lw = ohF + sp.reduce((a, b) => a + b, 0) + ohR;
        const Pe0 = (10 / g) * Lw / na;                   // empty wagon, 10 kN/m
        vs = rep(mkv(ohF, sp, ohR, fill(P0, na), fill(Pe0, na), true), Math.max(nWagon, 1));

    } else if (type === 'LM71' || type === 'SW0' || type === 'SW2' || type === 'UT') {
        code = 1991; cv = 1e3;                            // loads given in kN
        if (type === 'LM71') {
            xa = [0, 1.6, 3.2, 4.8]; Pa = fill(250, 4);
            Pea = fill(0, 4);                             // up to four loads: any may go
            vi = [1, 2, 3, 4]; iw = fill(true, 4);
            q = 80; qe = 10;                              // 10 kN/m between loaded
            qseg = [[-Infinity, -0.8], [5.6, Infinity]];  // 6.4 m excluded
        } else if (type === 'SW0') {
            q = 133; qe = 133;
            qseg = [[0, 15.0], [20.3, 35.3]];             // a = 15.0, c = 5.3 m
        } else if (type === 'SW2') {
            q = 150; qe = 150;
            qseg = [[0, 25.0], [32.0, 57.0]];             // a = 25.0, c = 7.0 m
        } else {
            q = 10; qe = 0;
            qseg = [[-Infinity, Infinity]];               // any number of lengths
        }

    } else {
        throw new Error('unknown load model "' + type + '"');
    }

    /* assemble the vehicles */
    if (vs) {
        let x0 = 0;
        for (let k = 0; k < vs.length; k++) {
            const V = vs[k];
            V.xa.forEach(v => xa.push(x0 + v));
            V.P.forEach(v => Pa.push(v));
            V.Pe.forEach(v => Pea.push(v));
            for (let i = 0; i < V.P.length; i++) { vi.push(k + 1); iw.push(V.isW); }
            x0 += V.L;
        }
        Lg = x0;
        if (q > 0) qseg = [[Lg, Infinity]];               // wagons behind the train
    }

    let sh;
    if (!xa.length) {
        const f = [];
        qseg.forEach(r => r.forEach(v => { if (isFinite(v)) f.push(v); }));
        sh = f.length ? Math.min.apply(null, f) : 0;
    } else {
        sh = xa[0];                                       // leading axle at x = 0
    }
    xa = xa.map(v => v - sh);
    qseg = qseg.map(r => [r[0] - sh, r[1] - sh]);

    const T = {
        x: xa, P: Pa.map(v => v * cv), Pe: Pea.map(v => v * cv),
        veh: vi.slice(), isW: iw.map(Boolean),
        q: q * cv, qe: qe * cv, qseg,
        code, type, Ltrain: xa.length ? xa[xa.length - 1] : 0,
        nWagon: (code === 1919 ? nWagon : 0) + (code === 15528 ? Math.max(nWagon, 1) : 0),
        g, vmax, Lbuf: Lg
    };

    /* dynamic factor, as a multiplier on the static response */
    const pp = K => (K < 0.76) ? K / (1 - K + K * K * K * K) : 1.325;
    if (annexD) {
        const kD = (l, v) => (v / 3.6) / (l <= 20 ? 160 : 47.16 * Math.pow(Math.max(l, 1e-9), 0.408));
        const p2 = l => 0.56 * Math.exp(-l * l / 100);
        T.eps  = l => 1 + 0.5 * (pp(kD(l, vmax)) + 0.5 * p2(l));
        T.epsv = (l, v) => 1 + 0.5 * (pp(kD(l, v)) + 0.5 * p2(l));
        T.epsn = null;
        T.epsTxt = "EN 1991-2 Annex D  1 + 0.5*(phi' + 0.5*phi''), fatigue, at " + vmax + ' km/h';
        return T;
    }
    switch (code) {
        case 1919: {
            const e = l => 1000 / (13 + 0.7 * l);
            T.eps  = l => 1 + 0.01 * e(l);
            T.epsv = (l, v) => 1 + 0.01 * (v / 100) * e(l);
            T.epsTxt = 'SFS 1919:193  phi = 1 + 10/(13+0.7l), at 100 km/h';
            break;
        }
        case 1938: {
            const e = l => 1765 / (20 + l);
            T.eps  = l => 1 + 0.01 * e(l);
            T.epsv = null;
            T.epsTxt = 'SOU 1938:37  phi = 1 + 17.65/(20+l), at 100 km/h';
            break;
        }
        case 15528: {
            const f0 = l => (l <= 20) ? 80 / Math.max(l, 1e-9)
                                      : 23.58 * Math.pow(Math.max(l, 1e-9), -0.592);
            const kk = (l, v, f) => (v / 3.6) / (2 * Math.max(l, 1e-9) * f);
            T.eps  = l => 1 + pp(kk(l, 100, f0(l)));      // default 100 km/h
            T.epsv = (l, v) => 1 + pp(kk(l, v, f0(l)));
            T.epsn = (l, v, f) => 1 + pp(kk(l, v, f));    // given natural frequency
            T.epsTxt = "EN 1991-2 Annex C  1 + phi', n0 from the lower limit of formula (8.3)";
            break;
        }
        case 1991:
            T.eps  = l => Math.min(Math.max(1.44 / Math.sqrt(Math.max(l - 0.2, 1e-9)) + 0.82, 1.00), 1.67);
            T.epsv = null;
            T.epsTxt = 'EN 1991-2  Phi2 = 1.44/sqrt(L-0.2)+0.82, 1.00 to 1.67';
            if (type === 'UT') {                          // no dynamic factor, 8.4.5.1(4)
                T.eps = () => 1;
                T.epsTxt = 'EN 1991-2  no dynamic factor for the unloaded train';
            }
            break;
        case 1961: {
            const e = l => Math.max((2200 + 11 * l) / (25 + l), 20);
            T.eps  = l => 1 + 0.01 * e(l);
            T.epsv = (l, v) => 1 + 0.01 * (0.75 * Math.min(v, 120) + 10) / 100 * e(l);
            T.epsTxt = 'SOU 1961:12  phi = 1 + 0.01*max((2200+11l)/(25+l),20), new bridge';
            break;
        }
    }
    if (!T.epsn) T.epsn = null;
    return T;
}

/* the models for which the wagon count means anything */
function usesWagons(type) {
    const t = String(type).toUpperCase();
    return /^[ABCD]1919$/.test(t) || CAT.some(c => c[0] === t);
}

global.Trains = { build, mkv, TYPES, COMB, CAT, usesWagons, g };

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).Trains;
