# Figures

Eighteen 3200 × 1800 images for the write-up and the thread. Every number in them is read from a bench
output at render time; the only hand-typed content is labels. Dark, 16:9, `Liberation Sans` (charts) and
`Inter` (diagrams).

| file | what it shows | data |
| --- | --- | --- |
| `loop-ring.png` | the loop, one frame: render → eye → optic lobe → bridge → whole CNS → DNs → body → eye | diagram (`loop-ring.html`) |
| `01-same-fly.png` | optic-v2 is an exact subset of the whole-CNS graph: 65,799 / 65,799 units, 1,967,771 / 1,967,771 connections, counts identical | `bench/out/overlap.json`, `edges.json` |
| `02-dng02-never-steers.png` | DNg02 direction selectivity at every tuning, both backends, against the 0.3 target; the bridge works (HS 124 / 0 Hz) | `docs/phase3.md`, `bench/out/dng02-sweep.md`, `bridge-gpu.json` |
| `03-dng02-inputs.png` | what actually drives DNg02: top presynaptic types by synapse count and sign; the whole HS relay for scale | `bench/out/dng02-sweep.md` |
| `dng02-wiring.png` | HS → PS080 (−) and HS → OA-VUMa4 (+) meet on DNg02; HS → DNa02 is direct | diagram (`dng02-wiring.html`) |
| `04-ablations.png` | heading drift per ablation on a log axis, with DNa02 / wing MN rates; hatched = readout silent | `bench/out/ablate-dna02.json` |
| `05-haltere-sign.png` | heading over 30 s: no haltere current, sign +1 (spin), sign −1 (stable) | `bench/out/cruise-dna02.json` |
| `06-cpu-gpu-chaos.png` | JavaScript vs WebGPU LIF: identical for 30 ms, then divergence with matched statistics | `bench/out/parity.json` |
| `07-loom-reflex.png` | LC4 / LPLC2 / DNp01 rates as a sphere looms from −45°, bridge on vs off | `bench/out/figures.json` |
| `08-optomotor-drum.png` | HS, DNa02, DNg02 left/right under a CW then CCW drum, per frame | `bench/out/figures.json` |
| `09-trajectories.png` | top-down paths through the pillar course: intact, bridge off, haltere off | `bench/out/figures.json` |
| `10-eye-maps.png` | 1,771 columns at their connectome azimuth / elevation, coloured by luminance and photoreceptor output | `bench/out/figures.json`, `src/eye/columns.json` |
| `11-frame-budget.png` | 98 ms of wall time per 16.7 ms frame: rate net 24, LIF 73, rest 1; per-frame counts | `bench/out/figures.json` |
| `12-filmstrip.png` | eight 1080p stills of the intact cruise, 2.5 s apart | `shots/strip-*.png` |
| `17-octopamine-test.png` | DNg02 L−R shift under left-HS drive with OA-VUMa4 / PS080 / both muted and with monoamines at the file sign: never leaves ±1 Hz | `bench/out/hs-inject-octopamine.json` |
| `18-haltere-anatomy.png` | two-hop anatomy of the haltere afferents, their steady-state effect on DNa02 vs current, and the closed loop's turn command vs yaw rate for both signs | `bench/out/haltere-paths.json`, `haltere-inject*.json`, `haltere-loop.json` |
| `19-ablations-gated.png` | the ablation drifts under the original readout, the gated readout, and gated + re-centring | `bench/out/ablate-dna02*.json` |
| `13-shot-loom.png` … `16-shot-brain.png` | captioned 1080p screenshots: the looming sphere, the loop page with HUD, the drum assay, Xenova's brain view firing through the inject path | `shots/*.png` |

## Regenerate

```
XVFB_SCREEN=2560x1440x24 scripts/gpu-box.sh bg "node bench/figures-capture.mjs"    # traces + shots, ~10 min on the GPU box
XVFB_SCREEN=2560x1440x24 scripts/gpu-box.sh bg "node bench/filmstrip-capture.mjs"  # clean stills + brain view, ~4 min
scripts/gpu-box.sh pull bench/out/figures.json && scripts/gpu-box.sh pull docs/figures/shots/
python3 docs/figures/make.py          # needs matplotlib + numpy; a font with a real bold (Liberation Sans)
docs/figures/render-diagrams.sh       # needs a Chromium-family browser on PATH
```

The captures are fresh runs, not the runs behind the docs: `09-trajectories.png` shows one collision in its
bridge-off run, where the ablation table's bridge-off run had none. Both are true; say "intact runs" when
quoting zero collisions.
