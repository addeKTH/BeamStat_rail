/* ------------------------------------------------------------------------
   xlsx.js - write a real .xlsx from the browser, with no library

   An xlsx file is a zip of a few XML parts.  Zip entries may be STORED
   rather than deflated, so nothing here has to compress: the whole writer is
   a CRC32, the local and central headers, and four small XML strings.  That
   avoids a CSV and the decimal-separator argument that comes with it.
   --------------------------------------------------------------------- */
(function (global) {
'use strict';

const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = s => new TextEncoder().encode(s);
const esc = s => String(s).replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function col(n) {                       // 0 -> A, 26 -> AA
    let s = '';
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
}

/* rows: array of arrays of number | string | null */
function sheetXml(rows) {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    rows.forEach((row, r) => {
        x += '<row r="' + (r + 1) + '">';
        row.forEach((v, c) => {
            if (v === null || v === undefined || v === '') return;
            const ref = col(c) + (r + 1);
            if (typeof v === 'number' && isFinite(v)) {
                x += '<c r="' + ref + '"><v>' + v + '</v></c>';
            } else {
                x += '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>';
            }
        });
        x += '</row>';
    });
    return x + '</sheetData></worksheet>';
}

function book(names) {
    let s = '', r = '';
    names.forEach((n, i) => {
        s += '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
        r += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/' +
             'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    });
    return {
        wb: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns=' +
            '"http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r=' +
            '"http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
            s + '</sheets></workbook>',
        rel: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns=' +
             '"http://schemas.openxmlformats.org/package/2006/relationships">' + r + '</Relationships>'
    };
}

/* sheets: [{name, rows}] -> Blob */
function write(sheets) {
    const names = sheets.map(s => s.name);
    const b = book(names);
    let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns=' +
             '"http://schemas.openxmlformats.org/package/2006/content-types">' +
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
             '<Default Extension="xml" ContentType="application/xml"/>' +
             '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-' +
             'officedocument.spreadsheetml.sheet.main+xml"/>';
    sheets.forEach((s, i) => {
        ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType=' +
              '"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    });
    ct += '</Types>';

    const files = [
        ['[Content_Types].xml', ct],
        ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns=' +
            '"http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" ' +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
            'Target="xl/workbook.xml"/></Relationships>'],
        ['xl/workbook.xml', b.wb],
        ['xl/_rels/workbook.xml.rels', b.rel]
    ];
    sheets.forEach((s, i) => files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows)]));

    /* zip, everything stored */
    const parts = [], central = [];
    let off = 0;
    files.forEach(([name, text]) => {
        const nb = enc(name), db = enc(text), c = crc32(db);
        const lh = new Uint8Array(30 + nb.length);
        const dv = new DataView(lh.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
        dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
        dv.setUint32(14, c, true);
        dv.setUint32(18, db.length, true); dv.setUint32(22, db.length, true);
        dv.setUint16(26, nb.length, true); dv.setUint16(28, 0, true);
        lh.set(nb, 30);
        parts.push(lh, db);

        const ch = new Uint8Array(46 + nb.length);
        const cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
        cv.setUint32(16, c, true);
        cv.setUint32(20, db.length, true); cv.setUint32(24, db.length, true);
        cv.setUint16(28, nb.length, true);
        cv.setUint32(42, off, true);
        ch.set(nb, 46);
        central.push(ch);
        off += lh.length + db.length;
    });
    let cs = 0; central.forEach(c => cs += c.length);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cs, true); ev.setUint32(16, off, true);

    return new Blob([...parts, ...central, end],
                    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function save(sheets, filename) {
    const url = URL.createObjectURL(write(sheets));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

global.Xlsx = { write, save, sheetXml, crc32 };

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).Xlsx;
