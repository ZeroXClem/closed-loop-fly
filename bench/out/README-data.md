# closed-loop-fly data pack (2026-09-07)

Read in this order:

1. `docs/ablations.md` + `docs/ablations-*.svg` + `bench/out/ablate-dna02.json` — Phase 6, seven ablations on the 20 s pillar-course cruise (DNa02 readout, haltere sign −1).
2. `bench/out/dng02-sweep.md` — every DNg02 injection sweep (GPU and JS LIF, tonic 0.36–0.5, gains 2/4, validated vs full input set), the relay readouts, the isolated three-HS-cell experiment with the PS080 input breakdown by presynaptic type and sign (`bench/out/hs-inject.txt`), and the two-hop wiring HS → relay → DNg02 in Xenova's graph (octopaminergic OA-VUMa4 route included). Raw GPU run: `bench/out/bridge-gpu.json`.
3. `DECISIONS.md` — the bridge set, gains, tonic drive, haltere sign, and every other hand-set number, with reasons; `docs/phase3.md` has the bridge table.
4. `docs/recon.md` — Phase 0 (overlap, edge parity, LIF equations, body-ID tables).
5. `docs/phase5.md` + `bench/out/cruise-dna02.json` + `docs/cruise-intact-dna02.webm` — the 30 s cruises (haltere off / sign −1 / sign +1) and the 20 s intact recording.

Everything else: `docs/phase1.md`, `phase2.md`, `phase4.md`, `bench/out/*.json` (overlap, edges, parity, eye, inject, browser, motor, optic-drum), `bench/out/motor-neurons.json`, `haltere-sensory.json`, `recon-ids.json`.
