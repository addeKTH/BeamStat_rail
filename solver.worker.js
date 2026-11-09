/* solver.worker.js ----------------------------------------------------------
   One train per job.  The influence lines are sent once per model.

   {il}                   the influence lines of the sections of the envelope
   {id, name, opt}        reply {id, ok, LE} or {id, ok: false, message}
   {ilJob}                influence lines BS.influenceLines(ilJob), off the page (2026-11-07):
                          replies {prog} (fraction done), then {ok, IL} or {ok: false, message}

   Andreas Andersson, 2026-11-02 (assisted by Claude)
---------------------------------------------------------------------------*/
importScripts('beamstat2d.js?v=2026-11-09c');

let IL = null;

// the buffers of all typed arrays in o, to hand them over without a copy
function buffers(o, set) {
    if (ArrayBuffer.isView(o)) set.add(o.buffer);
    else if (o && typeof o === 'object') for (const k in o) buffers(o[k], set);
    return set;
}

self.onmessage = function (ev) {
    const job = ev.data;
    if (job.il) { IL = job.il; return; }
    if (job.ilJob) {
        try {
            const R = BS.influenceLines(Object.assign({}, job.ilJob, { onProgress: f => self.postMessage({ prog: f }) }));
            self.postMessage({ ok: true, IL: R }, [...buffers(R, new Set())]);
        } catch (e) {
            self.postMessage({ ok: false, message: e && e.message ? e.message : String(e) });
        }
        return;
    }
    try {
        self.postMessage({ id: job.id, ok: true, LE: BS.loadEffect(IL, job.name, job.opt) });
    } catch (e) {
        self.postMessage({ id: job.id, ok: false, message: e && e.message ? e.message : String(e) });
    }
};
