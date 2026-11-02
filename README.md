# Railway Bridge Static Load Effects, 2D

Web version of `Main_gui.m` and `BeamStat2D.m`: influence lines of a multi-span 2D
Bernoulli-Euler beam, and the load effects of the design trains of the Swedish codes
1919-1961, EN 1991-2 (LM71, SW/0, SW/2, unloaded train), EN 15528 and TRVINFRA-00331
(TLM1-3). Plain JavaScript, no libraries and no build step.

| File | Content |
|---|---|
| `index.html` | layout, as the MATLAB figure, 560 x 868 px |
| `app.js` | GUI: input, train tick boxes, plots, Run/Cancel, Reset, Export, Print |
| `beamstat2d.js` | solver, port of BeamStat2D.m |
| `solver.worker.js` | Web Worker, one train per job |
| `plot.js` | SVG plots and a LaTeX subset for the labels |
| `xlsx.js` | Excel writer |
| `pdf.js` | PDF writer for the report: vector figures, standard fonts, bookmarks |

The analysis of six or more new trains runs in Web Workers (up to 16). All 36 trains
at dL 0.1 m take about 0.2 s against 1.4 s in the page, at dL 0.02 m 0.5 s against 5 s.
Fewer trains, and a page opened from `file://`, run in the page.

Print writes a PDF file directly, with one bookmark per page, named `load_effect.pdf`, or
`LM71_load_effect.pdf` for one train. Chrome and Edge give a Save-as dialog, other browsers and
embedded browsers a download.

Test: `test/run_web_cases.m` in MATLAB writes `web_ref.js`, `test/compare_web.html` compares
(served over http). When a file changes, raise `?v=` in `index.html`, `app.js` (VER) and
`solver.worker.js`, and "Last modified" in `index.html`.

Andreas Andersson, 2026-11-02 (assisted by Claude)
