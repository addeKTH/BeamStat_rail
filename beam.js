/* ------------------------------------------------------------------------
   beam.js - influence lines for a straight 2D Euler-Bernoulli beam
   Port of InfluenceLine.m and LoadResponse.m (Andreas Andersson, KTH).

   Same conventions as the MATLAB suite: x runs along the beam to the right,
   displacement positive up, the travelling unit load acts DOWNWARDS, sagging
   moment positive, reactions positive up.  Influence matrices are stored as
   one Float64Array per section, i.e. M[k][j] is the effect at section k with
   the unit load standing at load position j - the transpose of nothing, just
   MATLAB's column k held as its own array.

   The stiffness matrix of a 2-node beam element is banded with half-bandwidth
   3 in the dof order (v1,f1,v2,f2,...), and stays banded when the fixed dofs
   are removed, so the whole solve is a banded Cholesky and one back
   substitution per load position.  No sparse library is needed.
   --------------------------------------------------------------------- */
(function (global) {
'use strict';

const HB = 3;                                   // half bandwidth

/* --- banded symmetric Cholesky, A stored as A[i*(m+1)+k] = K[i][i+k] --- */
function chol(A, n, m) {
    for (let j = 0; j < n; j++) {
        let s = A[j * (m + 1)];
        for (let k = Math.max(0, j - m); k < j; k++) {
            const v = A[k * (m + 1) + (j - k)];
            s -= v * v;
        }
        if (!(s > 0)) return false;             // not positive definite
        const d = Math.sqrt(s);
        A[j * (m + 1)] = d;
        const iMax = Math.min(j + m, n - 1);
        for (let i = j + 1; i <= iMax; i++) {
            let t = A[j * (m + 1) + (i - j)];
            for (let k = Math.max(0, i - m); k < j; k++) {
                t -= A[k * (m + 1) + (j - k)] * A[k * (m + 1) + (i - k)];
            }
            A[j * (m + 1) + (i - j)] = t / d;
        }
    }
    return true;
}

/* --- solve with the factor above, right hand side overwritten ---------- */
function cholSolve(A, n, m, b) {
    for (let i = 0; i < n; i++) {                       // forward, U'y = b
        let s = b[i];
        for (let k = Math.max(0, i - m); k < i; k++) s -= A[k * (m + 1) + (i - k)] * b[k];
        b[i] = s / A[i * (m + 1)];
    }
    for (let i = n - 1; i >= 0; i--) {                  // back, Ux = y
        let s = b[i];
        const kMax = Math.min(i + m, n - 1);
        for (let k = i + 1; k <= kMax; k++) s -= A[i * (m + 1) + (k - i)] * b[k];
        b[i] = s / A[i * (m + 1)];
    }
}

/* =======================================================================
   influenceLine(inp)

   inp.L    span lengths (m), an array; several entries give a continuous beam
   inp.EI   flexural rigidity (Nm^2), one number or one per span
   inp.bc   [[pos, dir, Ksup], ...], dir 1 = vertical, 2 = rotation,
            Ksup 0 or missing = rigid.  Default: pinned at every span boundary
   inp.dL   element size (m), default 0.1
   inp.xp   sections to evaluate (m), default every node
   inp.w    width of the load distribution (m), 0 or missing = point load
   inp.shp  'rect' or 'tri'
   inp.tol  values of M, V and RF below this are set to zero, default 1e-9

   Returns {x, xp, M, V, d, r, RF, qon, dL, Ltot, bc, supX, supDir, chk, snap}
   with M[k] etc. a Float64Array over the load positions x.
   ==================================================================== */
function influenceLine(inp) {
    const L    = inp.L.slice();
    const Ltot = L.reduce((a, b) => a + b, 0);
    const tol  = (inp.tol === undefined) ? 1e-9 : inp.tol;
    const nEL  = Math.max(1, Math.round(Ltot / (inp.dL || 0.1)));
    const dL   = Ltot / nEL;
    const nN   = nEL + 1;                       // nodes = load positions
    const nDof = 2 * nEL + 2;

    /* boundary conditions */
    let bc = inp.bc;
    if (!bc || !bc.length) {
        bc = [];
        let s = 0;  bc.push([0, 1, 0]);
        for (let i = 0; i < L.length; i++) { s += L[i]; bc.push([s, 1, 0]); }
    }
    bc = bc.map(r => [r[0], r.length > 1 ? r[1] : 1, r.length > 2 ? r[2] : 0]);

    /* flexural rigidity per element */
    const EI = Array.isArray(inp.EI) ? inp.EI : [inp.EI];
    const EIe = new Float64Array(nEL);
    if (EI.length === 1) {
        EIe.fill(EI[0]);
    } else {
        const edg = [0];
        for (let i = 0; i < L.length; i++) edg.push(edg[i] + L[i]);
        for (let e = 0; e < nEL; e++) {
            const xm = (e + 0.5) * dL;
            let k = 0;
            while (k < L.length - 1 && xm > edg[k + 1]) k++;
            EIe[e] = EI[Math.min(k, EI.length - 1)];
        }
    }

    /* global stiffness, upper band.  ke for EI = 1 */
    const ke = [
        [ 12,      6 * dL,   -12,      6 * dL],
        [ 6 * dL,  4 * dL * dL, -6 * dL, 2 * dL * dL],
        [-12,     -6 * dL,    12,     -6 * dL],
        [ 6 * dL,  2 * dL * dL, -6 * dL, 4 * dL * dL]
    ].map(row => row.map(v => v / (dL * dL * dL)));

    const Kb = new Float64Array(nDof * (HB + 1));
    for (let e = 0; e < nEL; e++) {
        const g0 = 2 * e, ei = EIe[e];
        for (let a = 0; a < 4; a++)
            for (let b = a; b < 4; b++)
                Kb[(g0 + a) * (HB + 1) + (b - a)] += ei * ke[a][b];
    }

    /* support dofs */
    let snap = 0;
    const bdof = [], rig = [];
    const supX = [], supDir = [];
    for (let i = 0; i < bc.length; i++) {
        const sn = Math.round(bc[i][0] / dL);           // 0-based support node
        snap = Math.max(snap, Math.abs(sn * dL - bc[i][0]));
        bdof.push(2 * sn + (bc[i][1] - 1));
        rig.push(!(bc[i][2] > 0));
        supX.push(sn * dL);
        supDir.push(bc[i][1]);
    }
    for (let i = 0; i < bc.length; i++)                 // flexible springs
        if (!rig[i]) Kb[bdof[i] * (HB + 1)] += bc[i][2];

    /* free dofs */
    const fixed = new Uint8Array(nDof);
    for (let i = 0; i < bc.length; i++) if (rig[i]) fixed[bdof[i]] = 1;
    const fdof = [], map = new Int32Array(nDof).fill(-1);
    for (let g = 0; g < nDof; g++) if (!fixed[g]) { map[g] = fdof.length; fdof.push(g); }
    const nf = fdof.length;

    /* free band, assembled straight from the global one */
    const Ab = new Float64Array(nf * (HB + 1));
    for (let f = 0; f < nf; f++) {
        const g = fdof[f];
        for (let k = 0; k <= HB && f + k < nf; k++) {
            const d = fdof[f + k] - g;
            Ab[f * (HB + 1) + k] = (d <= HB) ? Kb[g * (HB + 1) + d] : 0;
        }
    }
    if (!chol(Ab, nf, HB)) throw new Error('the beam is a mechanism - check the supports');

    /* One unit downward load per node, one factorisation for all of them.
       D is laid out dof-major, D[g*nN + j], so that reading one dof over all
       load positions - which is what the evaluation below does, four dofs at
       a time - runs straight through memory. */
    const D = new Float64Array(nDof * nN);
    const rhs = new Float64Array(nf);
    for (let j = 0; j < nN; j++) {
        rhs.fill(0);
        const g = 2 * j;
        if (map[g] >= 0) rhs[map[g]] = -1;              // on a rigid support: nothing
        cholSolve(Ab, nf, HB, rhs);
        for (let f = 0; f < nf; f++) D[fdof[f] * nN + j] = rhs[f];
    }

    /* sections */
    let xp = inp.xp;
    if (xp === undefined || xp === null) { xp = []; for (let j = 0; j < nN; j++) xp.push(j * dL); }
    if (!Array.isArray(xp)) xp = [xp];
    const nP = xp.length;

    const M = [], V = [], dd = [], rr = [];
    for (let p = 0; p < nP; p++) {
        const t  = xp[p] / dL;
        const e  = Math.min(Math.max(Math.floor(t + 1e-9), 0), nEL - 1);
        const s  = Math.min(Math.max(t - e, 0), 1);
        const ei = EIe[e], g0 = 2 * e;
        const cM = [ei / (dL * dL) * (-6 + 12 * s), ei / dL * (-4 + 6 * s),
                    ei / (dL * dL) * ( 6 - 12 * s), ei / dL * (-2 + 6 * s)];
        const cV = [ei / (dL * dL * dL) * 12, ei / (dL * dL) * 6,
                   -ei / (dL * dL * dL) * 12, ei / (dL * dL) * 6];
        const cD = [1 - 3 * s * s + 2 * s * s * s, dL * (s - 2 * s * s + s * s * s),
                    3 * s * s - 2 * s * s * s,     dL * (-s * s + s * s * s)];
        const cR = [(-6 * s + 6 * s * s) / dL, 1 - 4 * s + 3 * s * s,
                    ( 6 * s - 6 * s * s) / dL,    -2 * s + 3 * s * s];
        const m = new Float64Array(nN), v = new Float64Array(nN);
        const q = new Float64Array(nN), w = new Float64Array(nN);
        const o0 = g0 * nN, o1 = o0 + nN, o2 = o1 + nN, o3 = o2 + nN;
        for (let j = 0; j < nN; j++) {
            const a0 = D[o0 + j], a1 = D[o1 + j], a2 = D[o2 + j], a3 = D[o3 + j];
            m[j] = cM[0] * a0 + cM[1] * a1 + cM[2] * a2 + cM[3] * a3;
            v[j] = cV[0] * a0 + cV[1] * a1 + cV[2] * a2 + cV[3] * a3;
            q[j] = cD[0] * a0 + cD[1] * a1 + cD[2] * a2 + cD[3] * a3;
            w[j] = cR[0] * a0 + cR[1] * a1 + cR[2] * a2 + cR[3] * a3;
        }
        M.push(m); V.push(v); dd.push(q); rr.push(w);
    }

    /* support reactions.  K here is the global matrix with the springs in it,
       and D is zero at a rigid dof, so the row product needs no special case */
    const RF = [];
    for (let i = 0; i < bc.length; i++) {
        const g = bdof[i], out = new Float64Array(nN);
        if (rig[i]) {
            for (let k = -HB; k <= HB; k++) {
                const c = g + k;
                if (c < 0 || c >= nDof) continue;
                const kk = (k >= 0 ? Kb[g * (HB + 1) + k] : Kb[c * (HB + 1) - k]);
                if (kk === 0) continue;
                const off = c * nN;
                for (let j = 0; j < nN; j++) out[j] += kk * D[off + j];
            }
            if (g % 2 === 0 && g / 2 < nN) out[g / 2] += 1;     // -F on the loaded dof
        } else {
            const off = g * nN;
            for (let j = 0; j < nN; j++) out[j] = -bc[i][2] * D[off + j];
        }
        RF.push(out);
    }

    /* load positions */
    let x = new Float64Array(nN);
    for (let j = 0; j < nN; j++) x[j] = j * dL;

    /* load distribution: the same answer as spreading the load and solving
       again, by superposition, so it is done as a convolution.  The influence
       lines then reach w/2 beyond each end of the beam. */
    let kn = [1], mo = 0, shp = 'none', wid = 0;
    if (inp.w > 0) {
        wid = inp.w;
        shp = (inp.shp || 'rect').toLowerCase();
        mo  = Math.ceil(wid / (2 * dL));
        const clamp = z => Math.min(Math.max(z, -wid / 2), wid / 2);
        const G = (shp === 'tri')
            ? z => Math.sign(z) * (2 / wid) * (Math.abs(z) - z * z / wid)
            : z => z / wid;
        kn = [];
        let sum = 0;
        for (let i = -mo; i <= mo; i++) {
            const v = G(clamp(i * dL + dL / 2)) - G(clamp(i * dL - dL / 2));
            kn.push(v); sum += v;
        }
        kn = kn.map(v => v / sum);
        const conv = a => {
            const o = new Float64Array(a.length + 2 * mo);
            for (let i = 0; i < a.length; i++)
                for (let k = 0; k < kn.length; k++) o[i + k] += a[i] * kn[k];
            return o;
        };
        for (let p = 0; p < nP; p++) { M[p] = conv(M[p]); V[p] = conv(V[p]); dd[p] = conv(dd[p]); rr[p] = conv(rr[p]); }
        for (let i = 0; i < RF.length; i++) RF[i] = conv(RF[i]);
        x = new Float64Array(nN + 2 * mo);
        for (let i = 0; i < x.length; i++) x[i] = (i - mo) * dL;
    }
    const qon = new Float64Array(x.length);
    { const one = new Float64Array(nN).fill(1);
      for (let i = 0; i < nN; i++) for (let k = 0; k < kn.length; k++) qon[i + k] += one[i] * kn[k]; }

    /* round off the small values, not d and r - they are orders of magnitude
       smaller and an absolute limit would empty them */
    const clip = a => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) < tol) a[i] = 0; };
    M.forEach(clip); V.forEach(clip); RF.forEach(clip);

    /* the vertical reactions must carry the unit load */
    let chk = 0;
    for (let j = 0; j < x.length; j++) {
        let s = 0;
        for (let i = 0; i < bc.length; i++) if (bc[i][1] === 1) s += RF[i][j];
        chk = Math.max(chk, Math.abs(s - qon[j]));
    }

    return { x, xp, M, V, d: dd, r: rr, RF, qon, dL, Ltot, bc, supX, supDir,
             w: wid, shp, kn, chk, snap, nNode: nN };
}

/* =======================================================================
   loadResponse(Z, x, F)

   Z    array of Float64Array, one per section - e.g. IL.M
   x    load positions of the influence lines
   F    axle loads [[x1,P1], ...], x from the leading axle (m), P down (N)

   Returns {R, x0}: R[k] is the response of section k at every train
   position, x0 the position of the train reference point for each of them.
   The train is stepped one element at a time, so the axles land on the nodes
   of the influence line and nothing is interpolated.
   ==================================================================== */
function loadResponse(Z, x, F) {
    const dL = x[1] - x[0], n = x.length;
    let o = Infinity;
    for (const f of F) o = Math.min(o, f[0]);
    const k = F.map(f => Math.round((f[0] - o) / dL));
    const m = Math.max.apply(null, k);
    const R = Z.map(() => new Float64Array(n + m));
    for (let i = 0; i < F.length; i++) {
        const sh = m - k[i], P = F[i][1];
        for (let s = 0; s < Z.length; s++) {
            const z = Z[s], out = R[s];
            for (let j = 0; j < n; j++) out[sh + j] += P * z[j];
        }
    }
    const x0 = new Float64Array(n + m);
    for (let i = 0; i < n + m; i++) x0[i] = x[0] - o + (i - m) * dL;
    return { R, x0 };
}

global.Beam = { influenceLine, loadResponse };

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).Beam;

/* ------------------------------------------------------------------------
   sweep(Z, x, F, both)

   Envelope of a FIXED train over every position, section by section.  The
   train may run in either direction, and standing clear of the bridge is
   always admissible, so the envelopes bracket zero - the same convention as
   LoadEffect.m.  A fixed train has no arrangement to choose, so this is the
   whole of the load effect: no truncation, no loaded/empty decision.

   Returns arrays over the sections: emin, emax, and for each of them the
   train reference position p and the running direction d (1 or 2).
   --------------------------------------------------------------------- */
function mirrorTrain(F) {
    let L = 0;
    for (const f of F) L = Math.max(L, f[0]);
    return F.map(f => [L - f[0], f[1]]).sort((a, b) => a[0] - b[0]);
}

function sweep(Z, x, F, both) {
    const n = Z.length;
    const emin = new Float64Array(n), emax = new Float64Array(n);
    const pmin = new Float64Array(n), pmax = new Float64Array(n);
    const dmin = new Int8Array(n).fill(1), dmax = new Int8Array(n).fill(1);
    const sets = both ? [F, mirrorTrain(F)] : [F];
    for (let s = 0; s < sets.length; s++) {
        const { R, x0 } = Beam.loadResponse(Z, x, sets[s]);
        for (let k = 0; k < n; k++) {
            const r = R[k];
            for (let i = 0; i < r.length; i++) {
                if (r[i] > emax[k]) { emax[k] = r[i]; pmax[k] = x0[i]; dmax[k] = s + 1; }
                if (r[i] < emin[k]) { emin[k] = r[i]; pmin[k] = x0[i]; dmin[k] = s + 1; }
            }
        }
    }
    return { emin, emax, pmin, pmax, dmin, dmax };
}

(typeof window !== 'undefined' ? window : globalThis).Beam.sweep = sweep;
(typeof window !== 'undefined' ? window : globalThis).Beam.mirrorTrain = mirrorTrain;
