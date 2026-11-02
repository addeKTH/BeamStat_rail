/* pdf.js --------------------------------------------------------------------
   A small PDF writer for the report, no libraries: A4 pages with the standard fonts
   Times and Symbol, text with the LaTeX subset of plot.js, paragraphs, tables, vector
   figures from SVG (line, path, polygon, circle, rect, text, clip), the date top right,
   page numbers "N (M)" and bookmarks.

   const D = new PDF.Doc('Title');  D.h1(s);  D.h2(s, {newPage, bookmark});  D.p(tex);
   D.table(caption, head, rows, align);  D.figure(svg, caption);  await D.blob();

   Text is measured with Times New Roman in a canvas, which has the metrics of Times.

   Andreas Andersson, 2026-11-02 (assisted by Claude)
---------------------------------------------------------------------------*/
(function (root) {
'use strict';

const PDF = {};
const PW = 595.28, PH = 841.89, MG = 70.87, TW = PW - 2 * MG;    // A4, margins 25 mm, text width 160 mm
const num = v => { const s = (Math.abs(v) < 1e-6 ? 0 : v).toFixed(3); return s.replace(/\.?0+$/, '') || '0'; };

// ------------------------------------------------------------------ text
const SYMB = { 'φ': 0x66, 'ϕ': 0x6A, 'ξ': 0x78, 'Φ': 0x46, 'α': 0x61, 'β': 0x62, 'ζ': 0x7A, '−': 0x2D, '′': 0xA2, '″': 0xB2 };
const WIN = { '–': 0x96, '—': 0x97, '·': 0xB7, '’': 0x92 };
const hex = c => c.toString(16).padStart(2, '0');
// a string as pieces of one font: [{sym, codes (hex), t}]
function encode(t) {
    const out = [];
    for (const ch of t) {
        if (ch === '​') continue;
        const cp = ch.codePointAt(0);
        let sym = false, code;
        if (SYMB[ch] !== undefined) { sym = true; code = SYMB[ch]; }
        else if (WIN[ch] !== undefined) code = WIN[ch];
        else if (cp === 0x2009 || cp === 0x2002 || cp === 0xA0) code = 0x20;
        else if (cp < 256) code = cp;
        else code = 0x3F;
        const last = out[out.length - 1];
        if (last && last.sym === sym) { last.codes += hex(code); last.t += ch; }
        else out.push({ sym, codes: hex(code), t: ch });
    }
    return out;
}
let mctx = null;
function width(t, size, it, bold) {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    mctx.font = `${it ? 'italic ' : ''}${bold ? 'bold ' : ''}100px "Times New Roman", Times, serif`;
    return mctx.measureText(t).width * size / 100;
}
// runs of PL.texRuns with their widths: size of a sub/superscript 0.72, shift 0.3
const runSize = (r, size) => (r.lvl ? size * 0.72 : size);
const runW = (r, size, bold) => width(r.t, runSize(r, size), r.it, bold);
const runsW = (runs, size, bold) => runs.reduce((a, r) => a + runW(r, size, bold), 0);

PDF.Doc = class {
    constructor(title) {
        this.title = title; this.pages = []; this.gs = new Map(); this.marks = [];
        this.date = new Date().toISOString().slice(0, 10);
        this.y = 0; this.nt = 0; this.nf = 0;
        this.newPage();
    }
    newPage() { this.pages.push([]); this.c = this.pages[this.pages.length - 1]; this.y = PH - MG; this.top = true; }
    room(h) { if (this.y - h < MG) this.newPage(); }

    // one piece of text at (x, y), up from the baseline; rot in degrees
    run(r, x, y, size, bold, col, rot) {
        const s = runSize(r, size), by = y + (r.lvl ? r.lvl * size * 0.3 : 0);
        let px = x;
        const cs = rot ? Math.cos(rot * Math.PI / 180) : 1, sn = rot ? Math.sin(rot * Math.PI / 180) : 0;
        for (const p of encode(r.t)) {
            const f = p.sym ? 'F4' : bold ? 'F3' : r.it ? 'F2' : 'F1', sk = p.sym && r.it ? 0.2 : 0;    // a slanted Greek
            const X = x + (px - x) * cs - (r.lvl ? r.lvl * size * 0.3 : 0) * sn, Y = rot ? y + (px - x) * sn : by;
            this.c.push(`BT /${f} ${num(s)} Tf ${col} rg ${num(cs)} ${num(sn)} ${num(sk * cs - sn)} ${num(sk * sn + cs)} ${num(X)} ${num(Y)} Tm <${p.codes}> Tj ET`);
            px += width(p.t, s, r.it, bold);
        }
        return px - x;
    }
    text(s, x, y, size, opt) {
        opt = opt || {};
        const runs = root.PL.texRuns(s), w = runsW(runs, size, opt.bold);
        let px = opt.align === 'c' ? x - w / 2 : opt.align === 'r' ? x - w : x;
        for (const r of runs) px += this.run(r, px, y, size, opt.bold, '0 0 0');
        return w;
    }
    h1(s) { this.text(s, MG, this.y - 16, 16); this.y -= 22; this.top = false; }
    h2(s, opt) {
        opt = opt || {};
        if (opt.newPage && !(this.top && this.pages.length === 1)) this.newPage();
        this.room(40);
        if (!this.top) this.y -= 14;
        this.text(s, MG, this.y - 14, 14, { bold: true });
        if (opt.bookmark) this.marks.push({ title: opt.bookmark, page: this.pages.length - 1, y: this.y });
        this.y -= 18; this.top = false;
    }
    // a paragraph: justified, the last line left; a line break only at a space in the text
    p(s) {
        const size = 11, lead = 14.3;
        const words = [];
        let cur = [];
        for (const r of root.PL.texRuns(s)) {
            const parts = r.lvl ? [r.t] : r.t.split(' ');
            parts.forEach((t, i) => {
                if (i > 0) { if (cur.length) words.push(cur); cur = []; }
                if (t) cur.push({ t, it: r.it, lvl: r.lvl });
            });
        }
        if (cur.length) words.push(cur);
        const wd = words.map(w => runsW(w, size)), sp = width(' ', size);
        let i = 0;
        while (i < words.length) {
            let j = i, w = wd[i];
            while (j + 1 < words.length && w + sp + wd[j + 1] <= TW) { j++; w += sp + wd[j]; }
            this.room(lead);
            const base = this.y - 10.5, gap = j < words.length - 1 && j > i ? sp + (TW - w) / (j - i) : sp;
            let px = MG;
            for (let k = i; k <= j; k++) {
                for (const r of words[k]) px += this.run(r, px, base, size, false, '0 0 0');
                px += gap;
            }
            this.y -= lead; this.top = false;
            i = j + 1;
        }
        this.y -= 6;
    }
    table(cap, head, rows, al) {
        const size = 11, pad = 7, rh = rows.length > 25 ? 12.6 : 14.3, nc = head.length, wc = new Array(nc).fill(0);
        for (const r of [head, ...rows]) r.forEach((c, i) => { wc[i] = Math.max(wc[i], runsW(root.PL.texRuns(String(c)), size) + 2 * pad); });
        const W = wc.reduce((a, b) => a + b, 0), x0 = MG + (TW - W) / 2;
        this.room(36 + rh * (rows.length + 1));
        this.y -= 4;
        this.text(`Table ${++this.nt}:  ${cap}`, PW / 2, this.y - 10.5, size, { align: 'c' });
        this.y -= 20;
        const rule = y => this.c.push(`0 0 0 RG 0.8 w ${num(x0)} ${num(y)} m ${num(x0 + W)} ${num(y)} l S`);
        rule(this.y);
        const row = (r) => {
            let x = x0;
            r.forEach((c, i) => {
                const s = String(c), xa = al[i] === 'r' ? x + wc[i] - pad : x + pad;
                this.text(s, xa, this.y - rh + 3.6, size, { align: al[i] === 'r' ? 'r' : 'l' });
                x += wc[i];
            });
            this.y -= rh;
        };
        row(head); this.y -= 1; rule(this.y); this.y -= 1;
        rows.forEach(row);
        this.y -= 1;
        rule(this.y);
        this.y -= 10; this.top = false;
    }
    figure(svg, cap) {
        const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number), sc = TW / vb[2], h = vb[3] * sc;
        this.room(h + 34);
        this.y -= 6;
        new SvgDraw(this, MG, this.y, sc).node(svg);
        this.y -= h + 6;
        if (cap) { this.text(`Figure ${++this.nf}:  ${cap}`, PW / 2, this.y - 10.5, 11, { align: 'c' }); this.y -= 14.3; }
        this.y -= 10; this.top = false;
    }
    gsName(alpha) {
        const k = alpha.toFixed(3);
        if (!this.gs.has(k)) this.gs.set(k, `G${this.gs.size + 1}`);
        return this.gs.get(k);
    }

    // the file: objects in order, offsets for the xref; streams deflated where the browser can
    async blob() {
        const n = this.pages.length, enc = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
        const objs = [];                                         // 1-based, strings or {dict, data}
        const add = o => { objs.push(o); return objs.length; };
        const cat = add(''), pagesObj = add('');
        const fonts = { F1: 'Times-Roman', F2: 'Times-Italic', F3: 'Times-Bold' };
        let fd = '';
        for (const f in fonts) fd += `/${f} ${add(`<< /Type /Font /Subtype /Type1 /BaseFont /${fonts[f]} /Encoding /WinAnsiEncoding >>`)} 0 R `;
        fd += `/F4 ${add('<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>')} 0 R`;
        let gd = '';
        this.gs.forEach((nm, k) => { gd += `/${nm} ${add(`<< /Type /ExtGState /ca ${k} >>`)} 0 R `; });
        const res = add(`<< /Font << ${fd} >> /ExtGState << ${gd} >> >>`);
        const kids = [], pageIds = [];
        for (let i = 0; i < n; i++) {
            const c = this.pages[i].slice();
            c.push(`BT /F1 11 Tf 0 0 0 rg ${num(PW - MG - width(this.date, 11))} ${num(PH - 48)} Td <${encode(this.date)[0].codes}> Tj ET`);
            const ft = `${i + 1} (${n})`;
            c.push(`BT /F1 11 Tf 0 0 0 rg ${num(PW / 2 - width(ft, 11) / 2)} 40 Td <${encode(ft)[0].codes}> Tj ET`);
            const data = await deflate(enc(c.join('\n')));
            const st = add({ dict: `/Length ${data.u.length}${data.z ? ' /Filter /FlateDecode' : ''}`, data: data.u });
            const pg = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources ${res} 0 R /Contents ${st} 0 R >>`);
            pageIds.push(pg); kids.push(`${pg} 0 R`);
        }
        objs[pagesObj - 1] = `<< /Type /Pages /Count ${n} /Kids [${kids.join(' ')}] >>`;

        // bookmarks, open beside the pages
        let outl = '';
        if (this.marks.length) {
            const root0 = add(''), ids = this.marks.map(() => add(''));
            this.marks.forEach((m, i) => {
                objs[ids[i] - 1] = `<< /Title <${pdfText(m.title)}> /Parent ${root0} 0 R` +
                    (i ? ` /Prev ${ids[i - 1]} 0 R` : '') + (i + 1 < ids.length ? ` /Next ${ids[i + 1]} 0 R` : '') +
                    ` /Dest [${pageIds[m.page]} 0 R /XYZ null ${num(m.y + 8)} null] >>`;
            });
            objs[root0 - 1] = `<< /Type /Outlines /First ${ids[0]} 0 R /Last ${ids[ids.length - 1]} 0 R /Count ${ids.length} >>`;
            outl = ` /Outlines ${root0} 0 R /PageMode /UseOutlines`;
        }
        objs[cat - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${outl} >>`;
        const info = add(`<< /Title <${pdfText(this.title)}> /Creator (BeamStat web) >>`);

        const chunks = [enc('%PDF-1.5\n')], off = [];
        let pos = chunks[0].length;
        const put = u => { chunks.push(u); pos += u.length; };
        objs.forEach((o, i) => {
            off.push(pos);
            if (typeof o === 'string') put(enc(`${i + 1} 0 obj\n${o}\nendobj\n`));
            else { put(enc(`${i + 1} 0 obj\n<< ${o.dict} >>\nstream\n`)); put(o.data); put(enc('\nendstream\nendobj\n')); }
        });
        const xr = pos;
        let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
        for (const o of off) x += `${String(o).padStart(10, '0')} 00000 n \n`;
        x += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${xr}\n%%EOF\n`;
        put(enc(x));
        return new Blob(chunks, { type: 'application/pdf' });
    }
};
const pdfText = t => 'FEFF' + Array.from(t, c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
async function deflate(u) {
    if (typeof CompressionStream === 'undefined') return { u, z: false };
    try {
        const s = new Blob([u]).stream().pipeThrough(new CompressionStream('deflate'));
        return { u: new Uint8Array(await new Response(s).arrayBuffer()), z: true };
    } catch (e) { return { u, z: false }; }
}

// ------------------------------------------------------------------ SVG
const COLS = new Map();
function rgb(c) {
    if (!c || c === 'none' || c === 'transparent') return null;
    if (COLS.has(c)) return COLS.get(c);
    let m, v = [0, 0, 0];
    if (c === '#fff' || c === 'white') v = [1, 1, 1];
    else if (c === '#000' || c === 'black') v = [0, 0, 0];
    else if ((m = /^#([0-9a-f]{3})$/i.exec(c))) v = [...m[1]].map(h => parseInt(h + h, 16) / 255);
    else if ((m = /^#([0-9a-f]{6})$/i.exec(c))) v = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
    const s = v.map(x => x.toFixed(3)).join(' ');
    COLS.set(c, s);
    return s;
}
class SvgDraw {
    constructor(doc, x0, y0, sc) { this.d = doc; this.x0 = x0; this.y0 = y0; this.s = sc; this.tx = 0; this.ty = 0; }
    X(x) { return this.x0 + (x + this.tx) * this.s; }
    Y(y) { return this.y0 - (y + this.ty) * this.s; }
    n(e, a) { return parseFloat(e.getAttribute(a)) || 0; }
    node(e) {
        const tag = e.tagName.toLowerCase();
        if (tag === 'clippath') return;
        if (tag === 'svg' || tag === 'g') {
            if (e.style && e.style.display === 'none') return;
            const c = this.d.c, sx = this.tx, sy = this.ty, tr = e.getAttribute('transform');
            let m;
            if (tr && (m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(tr))) { this.tx += parseFloat(m[1]); this.ty += parseFloat(m[2]); }
            const cp = e.getAttribute('clip-path');
            let clip = false;
            if (cp && (m = /url\(#(.+)\)/.exec(cp))) {
                const svg = e.ownerSVGElement || e, r = [...svg.querySelectorAll('clipPath')].find(k => k.id === m[1]);
                const q = r && r.querySelector('rect');
                if (q) {
                    const x = this.n(q, 'x'), y = this.n(q, 'y'), w = this.n(q, 'width'), h = this.n(q, 'height');
                    c.push(`q ${num(this.X(x))} ${num(this.Y(y + h))} ${num(w * this.s)} ${num(h * this.s)} re W n`);
                    clip = true;
                }
            }
            for (const k of e.children) this.node(k);
            if (clip) c.push('Q');
            this.tx = sx; this.ty = sy;
            return;
        }
        if (tag === 'text') { this.text(e); return; }
        let path = null;
        if (tag === 'line') path = `${num(this.X(this.n(e, 'x1')))} ${num(this.Y(this.n(e, 'y1')))} m ${num(this.X(this.n(e, 'x2')))} ${num(this.Y(this.n(e, 'y2')))} l`;
        else if (tag === 'rect') path = `${num(this.X(this.n(e, 'x')))} ${num(this.Y(this.n(e, 'y') + this.n(e, 'height')))} ${num(this.n(e, 'width') * this.s)} ${num(this.n(e, 'height') * this.s)} re`;
        else if (tag === 'polygon') {
            const v = e.getAttribute('points').trim().split(/[\s,]+/).map(Number);
            path = '';
            for (let i = 0; i + 1 < v.length; i += 2) path += `${num(this.X(v[i]))} ${num(this.Y(v[i + 1]))} ${i ? 'l' : 'm'} `;
            path += 'h';
        } else if (tag === 'circle') {
            const cx = this.X(this.n(e, 'cx')), cy = this.Y(this.n(e, 'cy')), r = this.n(e, 'r') * this.s, k = 0.5523 * r, P = (a, b) => `${num(a)} ${num(b)}`;
            path = `${P(cx + r, cy)} m ${P(cx + r, cy + k)} ${P(cx + k, cy + r)} ${P(cx, cy + r)} c ${P(cx - k, cy + r)} ${P(cx - r, cy + k)} ${P(cx - r, cy)} c ` +
                   `${P(cx - r, cy - k)} ${P(cx - k, cy - r)} ${P(cx, cy - r)} c ${P(cx + k, cy - r)} ${P(cx + r, cy - k)} ${P(cx + r, cy)} c h`;
        } else if (tag === 'path') path = this.pathData(e.getAttribute('d'));
        if (path === null || path === '') return;
        const fill = rgb(e.getAttribute('fill')), defaultFill = !e.hasAttribute('fill') && tag !== 'line';
        const stroke = rgb(e.getAttribute('stroke')), f = fill || (defaultFill ? '0 0 0' : null);
        const fa = parseFloat(e.getAttribute('fill-opacity'));
        const c = this.d.c;
        // a filled shape with a transparent face: the face first, then its outline
        if (f) {
            if (fa < 1) { c.push(`q /${this.d.gsName(fa)} gs ${f} rg ${path} f Q`); }
            else c.push(`${f} rg ${path} f`);
        }
        if (stroke) {
            const w = (parseFloat(e.getAttribute('stroke-width')) || 1) * this.s, da = e.getAttribute('stroke-dasharray');
            c.push(`${stroke} RG ${num(w)} w ${da ? `[${da.split(/[\s,]+/).map(v => num(parseFloat(v) * this.s)).join(' ')}] 0 d ` : ''}${path} S${da ? ' [] 0 d' : ''}`);
        }
    }
    pathData(d) {
        let out = '', x = 0, y = 0, x0 = 0, y0 = 0;
        const re = /([MLHVZ])([^MLHVZ]*)/gi;
        let m;
        while ((m = re.exec(d))) {
            const v = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number), cmd = m[1];
            if (cmd === 'M') { x = v[0]; y = v[1]; x0 = x; y0 = y; out += `${num(this.X(x))} ${num(this.Y(y))} m `; }
            else if (cmd === 'L') { x = v[0]; y = v[1]; out += `${num(this.X(x))} ${num(this.Y(y))} l `; }
            else if (cmd === 'H') { x = v[0]; out += `${num(this.X(x))} ${num(this.Y(y))} l `; }
            else if (cmd === 'V') { y = v[0]; out += `${num(this.X(x))} ${num(this.Y(y))} l `; }
            else { x = x0; y = y0; out += 'h '; }
        }
        return out.trim();
    }
    text(e) {
        const sz = (parseFloat(e.getAttribute('font-size')) || 14.7) * this.s, x = this.X(this.n(e, 'x'));
        let y = this.Y(this.n(e, 'y'));
        const base = e.getAttribute('dominant-baseline');
        const col = rgb(e.getAttribute('fill')) || '0 0 0';
        const shift = base === 'middle' ? 0.3 * sz : base === 'hanging' ? 0.75 * sz : base === 'text-after-edge' ? -0.22 * sz : 0;   // baseline below y
        const tr = e.getAttribute('transform'), rot = tr && /rotate\(-90/.test(tr);
        // the tspans as runs: their font size and dy in the SVG tell the level
        const runs = [];
        let lvl = 0;
        for (const t of e.children) {
            const dy = parseFloat(t.getAttribute('dy')) || 0;
            if (dy) lvl += dy < 0 ? 1 : -1;
            const s = t.textContent.replace(/​/g, '');
            if (s) runs.push({ t: s, it: t.getAttribute('font-style') === 'italic', lvl });
        }
        const w = runsW(runs, sz), an = e.getAttribute('text-anchor');
        let off = an === 'middle' ? -w / 2 : an === 'end' ? -w : 0;
        if (rot) {
            // rotated a quarter turn up: along +y in the page
            const X = x + shift;
            let py = y + off;
            for (const r of runs) py += this.d.run(r, X, py, sz, false, col, 90);
            return;
        }
        y -= shift;
        let px = x + off;
        for (const r of runs) px += this.d.run(r, px, y, sz, false, col);
    }
}
PDF.textWidth = width;

root.PDF = PDF;
})(typeof self !== 'undefined' ? self : this);
