# Railway bridge — static analysis, web version

A browser port of `Main_gui_static.m`: influence lines for a multi-span
Euler–Bernoulli beam, the load effects of the design trains of the Swedish
railway bridge codes and of the Eurocode, the governing load arrangement, and
the envelopes along the beam. No build step, no dependencies, no server-side
anything.

## Publishing

Commit these seven files to a repository and turn on GitHub Pages
(*Settings → Pages → Branch: main, folder `/` or `/docs`*):

```
index.html   beam.js   trains.js   loadeffect.js   plot.js   xlsx.js   app.js
```

The page is then at `https://<user>.github.io/<repo>/`. Everything is loaded
with plain `<script>` tags rather than ES modules, so opening `index.html`
straight off the disk works too — no local server needed.

## What each file is

| file | port of | what it does |
|---|---|---|
| `beam.js` | `InfluenceLine.m`, `LoadResponse.m` | the FE beam and the influence lines |
| `trains.js` | `TrainLoadSOU.m` | all 33 load models and their dynamic factors |
| `loadeffect.js` | `LoadEffect.m` | the sweep, the wagon arrangement, the peaks |
| `plot.js` | `PlotBeam2D.m`, `PlotLoadEffect.m` | the sketch and the three panels, on canvas |
| `xlsx.js` | `writecell` | writes a real `.xlsx` in the browser |
| `app.js` | the body of `Main_gui_static.m` | state, caching, events |
| `index.html` | the `uipanel` and the axes | the controls and the layout |

## Load models

Everything `LoadEffect.m` accepts, with the same names in the same order:

* **SFS 1919:193** — `A1919`, `B1919`, `C1919`, `D1919`, discrete wagons, each
  independently loaded or empty, the train shortened at the rear
* **SOU 1931:30 / 1938:37** — `A`, `B`, distributed wagons at 8.5 or 5.0 t/m,
  1.0 t/m empty
* **SOU 1961:12** — `F`, `LG1`, `LG2`, and the combined `85F` (0.85 × F against
  load group 1) and `60F` (0.60 × F against load group 2), the larger effect
  kept section by section
* **EN 1991-2:2024** — `LM71`, `SW/0`, `SW/2`, and the unloaded train `UT`
* **EN 15528:2021** — the eighteen line categories `A10` … `XLB`, with empty
  wagons at 10 kN/m and 1 + φ′ from EN 1991-2 Annex C

The Annex D fatigue trains are deliberately absent, as in the MATLAB GUI —
those are run over the influence lines directly, not through `LoadEffect`.

## The numerics

Both ports are faithful, not approximations. `beam.js` reproduces
`InfluenceLine.m` line for line, and `loadeffect.js` reproduces the whole
arrangement logic: the loaded-or-empty choice vehicle by vehicle, the running
extreme that decides where to cut the train, the omitted leading axle of the
1919 and 1938 models, the axle-by-axle shortening of 1961, the cumulative
integral that places the distributed wagons where the influence line is
unfavourable, the fixed blocks of SW/0 and SW/2, and the rule that a wagon
region at the surviving end stays with a truncated train while one at the cut
end does not. Sign conventions are unchanged throughout.

Checked against closed forms and against itself:

* PL/4, PL³/48EI, the 13/32, 22/32, −3/32 reactions and −3PL/32 support moment
  of a two-span beam, cantilever root moment and tip rotation — nine
  significant figures
* SW/2 and UT on a simply supported span give exactly qL²/8; a bare axle group
  (`LG2`) matches the hand sum of P·η exactly
* `out.chk`, the mismatch between the reconstructed arrangement and the swept
  envelope, comes out at 10⁻¹⁵ for every model — the same self-check the
  MATLAB version reports
* the one-section run used while dragging agrees **bit for bit** with the
  envelope at that section

The one deliberate difference is bookkeeping. MATLAB's `K(fdof,fdof)\F` is a
banded Cholesky here — in the dof order (v₁,φ₁,v₂,φ₂,…) the matrix has
half-bandwidth 3 and keeps it when the fixed dofs are removed, so no sparse
library is needed. And `align` drops its intermediate array: once the axles
sit on the element grid it is just a shifted accumulation,
`R[r] = Σ P·Z[r + round(off/dL) − kA]`.

## Speed

On a 24 + 30 + 24 m bridge at dL = 0.2 m, in Node on a laptop:

| | |
|---|---|
| influence lines, all 391 sections | ~60 ms |
| envelope over 137 sections, type `A` | ~1.0 s |
| envelope, `LM71` / `D2` / `SW0` | 0.2–0.7 s |
| one section — what a drag frame costs | 4–5 ms |

The envelope runs once per model and train, and the marker costs a sweep on
one column, which is why dragging stays smooth even with the wagons being
rearranged at every step.

## Using it

* **Drag the blue marker** along the beam to move the section; the arrow keys
  step it one grid point, shift ten.
* **Click a support symbol** — on or below the beam line — to switch it
  between pinned and clamped. Right-click near it does the same.
* **show** — `section` follows the marker and draws the train in the
  arrangement that is worst for that section; `critical` jumps each panel to
  the section where its own effect is largest and labels those sections on the
  sketch; `envelope` draws max and min along the beam in kNm, kN and mm.
* **Save max** runs all 33 load models over the current bridge and downloads
  `peaks.xlsx` with the same columns as the MATLAB button, plus a second sheet
  recording the bridge.

Axis limits are fixed from the extremes over all sections, so nothing rescales
while the marker moves. M, V and the reactions are shown as whole kNm and kN,
displacements and rotations to one decimal in mm and mrad.
