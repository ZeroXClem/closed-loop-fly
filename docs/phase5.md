# Phase 5 — Close the loop and stability

Date: 2026-09-07. Acceptance (GOAL.md): 30 s autonomous cruise through the pillar course,
zero collisions, heading drift < 20°; a video in `docs/`.

## What runs

Body pose → eye → [A] → bridge → [B] → DNg02 / DNa02 → wings → body, every frame (`src/loop.js`,
`?motor=vnc&course=1`). Cruise = base wing amplitude 0.7 (thrust 6·(0.7 − 0.5) against drag
1.5 → 0.8 units/s), the 40-pillar course visible, collisions counted as body-to-pillar
contact within 0.9 units. Haltere proxy: `?haltere=on` (DECISIONS.md, Phase 5).

## Results

`bench/cruise.mjs`, RTX 3070, DNa02 readout (deviation, see docs/phase4.md; the DNg02 code
does not steer), bridge gain 2, DNg02 tonic 0.4 mV/ms, turn gain 2, 30 s, 40-pillar course.

| haltere proxy | collisions | heading drift | max excursion | wobble (yaw-rate sd) | distance | outcome |
| --- | --- | --- | --- | --- | --- | --- |
| off | 0 | −1,064° | 1,064° | 0.80 rad/s | 38.1 units | a slow persistent left turn (~0.6 rad/s): the DNa02 rest asymmetry wanders after calibration |
| on, sign −1 (left afferents for **rightward** rotation), gain 2 | 0 | **−35°** | 42° | 0.42 rad/s | 24.7 units | within ±20° for 22 s, then −35° |
| on, sign +1 (left afferents for leftward rotation), gain 2 | 0 | −3,352° | 3,352° | 0.19 rad/s | 80.4 units | steady spin at 2 rad/s: positive feedback |

Zero collisions in all three; drift < 20° in none of the 30 s runs (the 20 s intact run of
`bench/ablate.mjs` came in at −10.9°, so the target is met over 20 s and missed over 30 s),
but the mirrored haltere proxy cuts the
drift thirtyfold (1,064° → 35°) and halves the wobble. That is the wiring speaking: the
haltere afferents (205 cells entering through DMetaN) reach the wing motor in a way that
opposes rotation for exactly one sign of the afferent-side convention and reinforces it for
the other. Which sign the real haltere uses is a question about Coriolis mechanics this
cartoon does not model; the proxy is recorded as the corrective sign, not as biology.

Heading per second, haltere sign −1: 0, −1, −1, −8, −1, −9, −15, −5, 3, 9, −4, 0, −16,
−20, −15, −6, −14, −13, −17, −17, −11, −13, −23, −21, −22, −6, −14, −24, −31, −34.


First run (motor rest taken while the motor was already on, which turned the fly during its
own calibration second; kept for the record):

| haltere proxy | collisions | heading drift | wobble (yaw-rate sd) | distance | outcome |
| --- | --- | --- | --- | --- | --- |
| off | 0 | −105° | 0.60 rad/s | 26.6 units | crosses the course untouched, wanders ±30° for 20 s, then veers |
| on, sign +1 (left afferents for leftward rotation), gain 2 | 0 | −2,947° | 0.68 rad/s | 75.4 units | continuous spin: positive feedback through the wiring |

The zero-collision half of the acceptance holds; the drift target (< 20°) does not. With the
proxy at sign +1 the VNC turns haltere input into more of the same rotation, so that sign is
the wrong one for a stabiliser; the mirrored sign is measured in the table above.


## Video

`docs/cruise-intact-dna02.webm`, recorded by `bench/ablate.mjs --record` on the intact
condition (bridge on, DNa02 readout, haltere proxy sign −1, 20 s). Third-person view, eye
HUD top-left. (A recording of the haltere-off run was lost to a mirror sync before it was
pulled; `bench/cruise.mjs --record` regenerates it.)

## Verdict

Zero collisions: met (all runs). Drift < 20°: not met (35° best). Video: recorded.

## Open

- Drift: the wing command is built on a DNa02 rest asymmetry that is captured once; a slow
  re-centring of the rest (their `offsetTau`) or the haltere gain schedule are the next
  levers, both hand-set.
- All of Phase 5 stands on the DNa02 deviation; through the published DNg02 code the loop
  does not steer (docs/phase4.md).
- [A] on the CPU still costs a third of every frame (0.17× realtime); the GPU port of the
  rate net is the first performance item, then a GPU-side bridge to drop the per-frame fence.
