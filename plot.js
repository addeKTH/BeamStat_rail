/* ------------------------------------------------------------------------
   plot.js - the drawing, on plain canvas
   Stands in for PlotBeam2D.m and PlotLoadEffect.m.  Same picture: the
   influence line in blue, the axles as downward arrows scaled by their load,
   a dashed line at the section, filled triangles at the vertical supports.

   All four panels use the same left and right margin and the same x mapping,
   so the supports of the sketch line up with the plots below it, exactly as
   the pixel positions do in the MATLAB figure.
   --------------------------------------------------------------------- */
(function (global) {
'use strict';

const C = {
    il:   '#0059b3',        // influence line          (PlotLoadEffect cIL)
    load: '#bf1a1a',        // axle loads              (cLd)
    empty: '#ff8c8c',       // axles of a wagon running empty (cEm)
    sec:  '#404040',        // section marker          (cSe)
    beam: '#999999',
    axis: '#333333',
    grid: '#e6e6e6',
    text: '#222222',
    dim:  '#666666'
};
const ML = 62, MR = 14;                 // left and right margin, px
const FONT = '11px system-ui, "Segoe UI", Helvetica, Arial, sans-serif';
const FSM  = '10px system-ui, "Segoe UI", Helvetica, Arial, sans-serif';

/* --- canvas with the device pixel ratio taken care of ------------------ */
function setup(cv) {
    const r = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
        cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    return { ctx, w, h };
}

/* --- tick values, at most n of them, on round numbers ------------------ */
function ticks(a, b, n) {
    const span = b - a;
    if (!(span > 0)) return [a];
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const nrm = raw / mag;
    const st  = (nrm <= 1 ? 1 : nrm <= 2 ? 2 : nrm <= 5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(a / st) * st; v <= b + 1e-9 * span; v += st) out.push(v);
    return out;
}
function fmtTick(v, st) {
    const d = Math.max(0, -Math.floor(Math.log10(st || 1)));
    return Math.abs(v) < 1e-12 ? '0' : v.toFixed(Math.min(d, 6));
}

/* =======================================================================
   beam sketch
   m = {L, clamped[], Ltot, xs[], section, showSection, peaks:[{x,label}]}
   ==================================================================== */
function beam(cv, m) {
    const { ctx, w, h } = setup(cv);
    const Lt = m.Ltot;
    const x0 = -0.02 * Lt, x1 = 1.02 * Lt;
    const sx = v => ML + (v - x0) / (x1 - x0) * (w - ML - MR);
    const pw = w - ML - MR;
    const sc = pw / (x1 - x0);                       // px per m, 1:1 in y too
    const yb = h * 0.44;                             // the beam line
    const sy = v => yb - v * sc;

    ctx.lineWidth = 4; ctx.strokeStyle = C.beam;
    ctx.beginPath(); ctx.moveTo(sx(0), yb); ctx.lineTo(sx(Lt), yb); ctx.stroke();

    /* supports */
    ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
    for (let i = 0; i < m.xs.length; i++) {
        const X = sx(m.xs[i]);
        if (m.clamped[i]) {                          // clamped: a wall
            ctx.beginPath();
            ctx.moveTo(X, sy(0.03 * Lt)); ctx.lineTo(X, sy(-0.03 * Lt)); ctx.stroke();
            const s = (i === m.xs.length - 1) ? 1 : -1;
            for (let k = -3; k <= 3; k++) {
                const y = sy(k * 0.01 * Lt);
                ctx.beginPath(); ctx.moveTo(X, y);
                ctx.lineTo(X + s * 0.015 * Lt * sc, y - 0.015 * Lt * sc); ctx.stroke();
            }
        } else {                                     // pinned: a triangle
            ctx.beginPath();
            ctx.moveTo(X, yb);
            ctx.lineTo(X - 0.02 * Lt * sc, sy(-0.03 * Lt));
            ctx.lineTo(X + 0.02 * Lt * sc, sy(-0.03 * Lt));
            ctx.closePath(); ctx.stroke();
        }
    }

    /* dimension line */
    ctx.strokeStyle = C.dim; ctx.fillStyle = C.dim; ctx.lineWidth = 0.8;
    ctx.font = FSM; ctx.textAlign = 'center';
    const yd = sy(-0.075 * Lt);
    ctx.beginPath(); ctx.moveTo(sx(0), yd); ctx.lineTo(sx(Lt), yd); ctx.stroke();
    for (let i = 0; i < m.xs.length; i++) {
        const X = sx(m.xs[i]);
        ctx.beginPath(); ctx.moveTo(X, yd - 4); ctx.lineTo(X, yd + 4); ctx.stroke();
    }
    for (let i = 0; i < m.xs.length - 1; i++) {
        const Li = m.xs[i + 1] - m.xs[i];
        ctx.fillText(Li.toFixed(1), (sx(m.xs[i]) + sx(m.xs[i + 1])) / 2, yd - 9);
    }

    /* the section marker, above the beam, or the critical sections */
    if (m.showSection) {
        const X = sx(m.section), Y = sy(0.035 * Lt);
        ctx.strokeStyle = C.il; ctx.fillStyle = C.il; ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(X, yb); ctx.lineTo(X, Y); ctx.stroke();
        ctx.setLineDash([]);
        tri(ctx, X, Y, 6);
    }
    (m.peaks || []).forEach((p, i) => {
        const X = sx(p.x), Y = sy((0.014 + 0.023 * (i % 2)) * Lt);
        ctx.strokeStyle = C.load; ctx.fillStyle = C.load; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X, yb); ctx.lineTo(X, Y); ctx.stroke();
        tri(ctx, X, yb, 5);
        ctx.font = FSM; ctx.textAlign = 'center';
        ctx.fillText(p.label, X, Y - 7);
    });
    return { sx, xlim: [x0, x1] };
}

function tri(ctx, x, y, s) {          // a downward triangle, tip at (x,y)
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x - s * 0.7, y - s); ctx.lineTo(x + s * 0.7, y - s);
    ctx.closePath(); ctx.fill();
}

/* =======================================================================
   one result panel
   p = {xlim, ylim, ylabel, title, x, y, y2, fill, section, axles, supports,
        xticks, xlabel}
   ==================================================================== */
function panel(cv, p) {
    const { ctx, w, h } = setup(cv);
    const MT = 20, MB = p.xticks ? 32 : 10;
    const [xa, xb] = p.xlim, [ya, yb] = p.ylim;
    const sx = v => ML + (v - xa) / (xb - xa) * (w - ML - MR);
    const sy = v => MT + (yb - v) / (yb - ya) * (h - MT - MB);

    /* frame and ticks */
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    const ty = ticks(ya, yb, 4), tx = ticks(xa, xb, 8);
    const sty = ty.length > 1 ? ty[1] - ty[0] : 1, stx = tx.length > 1 ? tx[1] - tx[0] : 1;
    ctx.beginPath();
    ty.forEach(v => { ctx.moveTo(ML, sy(v)); ctx.lineTo(w - MR, sy(v)); });
    tx.forEach(v => { ctx.moveTo(sx(v), MT); ctx.lineTo(sx(v), h - MB); });
    ctx.stroke();
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
    ctx.strokeRect(ML + 0.5, MT + 0.5, w - ML - MR - 1, h - MT - MB - 1);

    ctx.fillStyle = C.text; ctx.font = FSM;
    ctx.textAlign = 'right';
    ty.forEach(v => ctx.fillText(fmtTick(v, sty), ML - 5, sy(v)));
    if (p.xticks) {
        ctx.textAlign = 'center';
        tx.forEach(v => ctx.fillText(fmtTick(v, stx), sx(v), h - MB + 11));
        ctx.fillText(p.xlabel || 'x (m)', (ML + w - MR) / 2, h - 8);
    }
    /* y label, turned */
    ctx.save();
    ctx.translate(12, (MT + h - MB) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.font = FONT; ctx.fillText(p.ylabel, 0, 0);
    ctx.restore();
    /* title */
    if (p.title) {
        ctx.textAlign = 'right'; ctx.font = FSM; ctx.fillStyle = C.text;
        ctx.fillText(p.title, w - MR, MT / 2);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(ML, MT, w - ML - MR, h - MT - MB); ctx.clip();

    /* zero line */
    ctx.strokeStyle = C.beam; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(ML, sy(0)); ctx.lineTo(w - MR, sy(0)); ctx.stroke();

    /* band between two curves, for the envelope */
    if (p.fill) {
        ctx.fillStyle = 'rgba(0,89,179,0.12)';
        ctx.beginPath();
        for (let i = 0; i < p.x.length; i++)
            (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p.x[i]), sy(p.y[i]));
        for (let i = p.x.length - 1; i >= 0; i--) ctx.lineTo(sx(p.x[i]), sy(p.y2[i]));
        ctx.closePath(); ctx.fill();
    }

    /* The distributed wagon load, drawn first so the influence line stays on
       top.  One polygon per stretch that actually carries load, so nothing is
       drawn where the train is not, and the height is scaled by the loaded
       intensity, so empty wagons always show at qe/q of the full band. */
    const rg = p.rg || Math.max(Math.abs(ya), Math.abs(yb)) || 1;
    if (p.band && p.band.q > 0) {
        const w = p.band.w, qH = 0.15 * rg;
        let i = 0;
        while (i < w.length) {
            if (!(w[i] > 0)) { i++; continue; }
            let j = i; while (j + 1 < w.length && w[j + 1] > 0) j++;
            ctx.beginPath();
            ctx.moveTo(sx(p.x[i]), sy(0));
            for (let k = i; k <= j; k++) ctx.lineTo(sx(p.x[k]), sy(w[k] * qH / p.band.q));
            ctx.lineTo(sx(p.x[j]), sy(0));
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,102,102,0.35)'; ctx.fill();
            ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 0.8; ctx.stroke();
            i = j + 1;
        }
    }

    /* the axles, arrows pointing down onto the beam, empty wagons lighter */
    if (p.axles && p.axles.length) {
        let Pm = 0;
        p.axles.forEach(a => Pm = Math.max(Pm, Math.abs(a.P)));
        const aH = 0.30 * rg;
        for (const emp of [false, true]) {
            const set = p.axles.filter(a => !!a.emp === emp);
            if (!set.length) continue;
            const cc = emp ? C.empty : C.load;
            ctx.strokeStyle = cc; ctx.fillStyle = cc; ctx.lineWidth = 1.1;
            ctx.beginPath();
            set.forEach(a => {
                const X = sx(a.x);
                ctx.moveTo(X, sy(0)); ctx.lineTo(X, sy(aH * Math.abs(a.P) / Pm));
            });
            ctx.stroke();
            set.forEach(a => tri(ctx, sx(a.x), sy(0) + 5, 4));
        }
    }

    /* the curves */
    const line = (yy, wd) => {
        ctx.strokeStyle = C.il; ctx.lineWidth = wd; ctx.beginPath();
        for (let i = 0; i < p.x.length; i++)
            (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p.x[i]), sy(yy[i]));
        ctx.stroke();
    };
    if (p.marks) {                                  // one value per support
        ctx.strokeStyle = C.il; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = 0; i < p.x.length; i++) {
            ctx.moveTo(sx(p.x[i]), sy(p.y[i])); ctx.lineTo(sx(p.x[i]), sy(p.y2[i]));
        }
        ctx.stroke();
        ctx.fillStyle = C.il;
        for (let i = 0; i < p.x.length; i++) {
            dot(ctx, sx(p.x[i]), sy(p.y[i]), 3, true);
            dot(ctx, sx(p.x[i]), sy(p.y2[i]), 3, false);
        }
    } else {
        line(p.y, 1.6);
        if (p.y2) line(p.y2, 1.6);
    }

    /* section and supports */
    if (p.section !== undefined && p.section !== null) {
        ctx.strokeStyle = C.sec; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(sx(p.section), MT); ctx.lineTo(sx(p.section), h - MB);
        ctx.stroke(); ctx.setLineDash([]);
    }
    (p.supports || []).forEach(v => {
        ctx.fillStyle = '#595959'; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8;
        const X = sx(v), Y = sy(0);
        ctx.beginPath();
        ctx.moveTo(X, Y - 8); ctx.lineTo(X - 5, Y); ctx.lineTo(X + 5, Y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    (p.peaks || []).forEach(q => {
        ctx.fillStyle = C.load;
        tri(ctx, sx(q.x), sy(q.y) + (q.up ? -3 : 9), 5);
    });
    ctx.restore();
    return { sx };
}

function dot(ctx, x, y, r, solid) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    if (solid) { ctx.fill(); } else { ctx.save(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore(); ctx.stroke(); }
}

global.Plot = { setup, beam, panel, ticks, C, ML, MR };

})(window);
