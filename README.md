# Railway Bridge Static Load Effects, 2D

Web version of `Main_gui.m` and `BeamStat2D.m`: influence lines of a multi-span 2D
Bernoulli-Euler beam, and the load effects of the design trains of EN 1991-2 (LM71, SW/0,
SW/2), EN 15528, TRVINFRA-00331 (TLM1-4) and the Swedish codes SoU 1938 and SoU 1961. Plain JavaScript, no libraries and no build step.

| File | Content |
|---|---|
| `index.html` | layout, as the MATLAB figure, 560 x 868 px |
| `app.js` | GUI: input, train tick boxes, plots, Run/Cancel, Reset, Export, Print |
| `beamstat2d.js` | solver, port of BeamStat2D.m |
| `solver.worker.js` | Web Worker, one train per job |
| `plot.js` | SVG plots and a LaTeX subset for the labels |
| `xlsx.js` | Excel writer |

The analysis of six or more new trains runs in Web Workers (up to 16). All 36 trains (the list had 36 when measured; now 27)
at dL 0.1 m take about 0.2 s against 1.4 s in the page, at dL 0.02 m 0.5 s against 5 s.
Fewer trains, and a page opened from `file://`, run in the page.

As the MATLAB version (2026-11-05): loads given in tonnes converted with g = 10 m/s², EI optionally
from the deflection limit of EN 1990:2023 A.2.9.4.3.2 (LM71, Figure A.2.3), input limits (dL 0.01 m to a
tenth of the shortest span, at most 5000 elements, total length 1-2000 m, alpha 0.75-1.46, v 0-200 km/h),
spans rounded to whole elements. The influence lines are solved with two steps of iterative refinement.

Print opens the browser's print preview: choose Save as PDF. The date and the page numbers
"N (M)" need Chrome or Edge 131 or newer.

When a file changes, raise `?v=` in `index.html`, `app.js` (VER) and
`solver.worker.js`, and "Last modified" in `index.html`.

## Disclaimer

This software is provided for research, education and preliminary assessment. It is provided "as is", without warranty of any kind, express or implied, including but not limited to accuracy, completeness, or fitness for a particular purpose.

The results have not been independently certified and do not replace the verification required by the applicable codes, regulations and infrastructure manager requirements. The user is responsible for checking that the method, the load models, the input and the assumptions suit the case at hand, and for verifying the results independently before using them in design, assessment or any other decision. Load models and dynamic factors are implemented as interpreted by the author and may differ from, or become out of date compared with, the current versions of the standards.

The author accepts no liability for any loss, damage or other consequence arising from the use of this software or its results.

Andreas Andersson, 2026-11-02 (assisted by Claude)
