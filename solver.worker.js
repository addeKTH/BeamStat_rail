/* solver.worker.js ----------------------------------------------------------
   One train per job.  The influence lines are sent once per model.

   {il}                   the influence lines of the sections of the envelope
   {id, name, opt}        reply {id, ok, LE} or {id, ok: false, message}

   Andreas Andersson, 2026-11-02 (assisted by Claude)
---------------------------------------------------------------------------*/
importScripts('beamstat2d.js?v=2026-11-05a');

let IL = null;

self.onmessage = function (ev) {
    const job = ev.data;
    if (job.il) { IL = job.il; return; }
    try {
        self.postMessage({ id: job.id, ok: true, LE: BS.loadEffect(IL, job.name, job.opt) });
    } catch (e) {
        self.postMessage({ id: job.id, ok: false, message: e && e.message ? e.message : String(e) });
    }
};
