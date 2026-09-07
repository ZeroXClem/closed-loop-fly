# Phase 4 — Motor readout from the VNC

Date: 2026-09-07. Acceptance (GOAL.md): with the bridge on and no scripted actions, drum
rotation makes the hovering fly yaw with the drum (optomotor); a looming sphere makes it bank
away; `bench/motor.mjs` logs heading vs drum phase, correlation > 0.5.

## What was built

| piece | file |
| --- | --- |
| the readout: [B] DNg02 L/R and wing-MN rates → wing amplitudes | `src/motor/readout.js` |
| wing amplitudes → thrust, yaw torque, bank, sideslip (port) | `src/motor/wings.js` |
| motor mode in the loop page: `?motor=vnc` applies the forces to the body every 1 ms | `src/loop.js` |
| bench | `bench/motor.mjs` |

`controller.js`'s semantics (six hand-chosen thresholds and gains on 18 descending cells) are
gone from this path. What remains hand-written is the published DNg02 population code
([Namiki et al. 2022](https://www.cell.com/current-biology/fulltext/S0960-9822(22)00019-7)):
DNg02 activity is positively correlated with the contralateral wing's beat amplitude and
negatively with the ipsilateral one, and the population level sets the bilateral amplitude.
So

```
diff  = −turnSign · turnGain · (ΔDNg02_L − ΔDNg02_R) / (DNg02_L + DNg02_R + floor)   (Δ = minus rest)
left  = base + diff/2,  right = base − diff/2,   yaw torque = −16 · (left − right)
```

with `turnSign = +1`: a left-dominant DNg02 population softens the left wing and hardens the
right, which yaws the fly left. That is also what the wiring does under a drum turning left
(left HS → PS080 → the right DNg02 is silenced), so following the drum needs no fitted sign.
The one first-order lag (`motorTau` 50 ms) stands in for the wing hinge.

Physical gains kept as tunables: `turnGain`, `thrustGain` (0 while hovering), `motorTau`,
and the wing model's `yawGain` / `bankGain` / `sideGain` from upstream.

## Results

RESULTS

## Walking

Leg motor neurons by leg and joint are available from [B] by body ID (381 cells, `bench/out/
motor-neurons.json`, subclass fl/ml/hl × T1/T2/T3 × side, typed by muscle: tibia flexor /
extensor, trochanter flexor / extensor, sternal rotators, tarsal depressor, …). The map from
their rates to joint targets in Xenova's IK skeleton is not built in this pass: nothing in
the loop drives the leg VNC yet (the fly hovers; the walking DNs are silent), so there would
be nothing to validate it against. Xenova's tripod generator remains the fallback, and the
worker's `watch` API already exposes every leg-MN group's rate for when it is.
