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

`bench/motor.mjs`, RTX 3070, bridge gain 2, DNg02 tonic 0.4 mV/ms, drum ±1 rad/s for 6 s,
then a sphere from ±45° at 2 units/s.

| readout | ω = +1 | ω = −1 | loom −45° | loom +45° | verdict |
| --- | --- | --- | --- | --- | --- |
| **DNg02** (the published code), turn gain 20 | yaw +0.32 rad/s, corr 0.995 | yaw **+0.13** rad/s, corr −0.90 | roll +15°, yaw +0.23 | roll +15°, yaw +0.38 | FAIL: turns left whatever the drum does |
| DNa02 (deviation, see DECISIONS), turn gain 2 | yaw +0.15 rad/s, corr 0.84 | yaw −0.53 rad/s, corr 0.98 | roll −25°, yaw −0.30 (away) | roll −25°, yaw −0.17 (toward) | optomotor PASS; loom: same-sign roll both sides, not "away" |

With the DNg02 readout the wing command is the amplified rest asymmetry of two populations
whose difference the drum never modulates (docs/phase3.md), so the fly drifts one way at a
turn gain of 20 and would drift the other at a different rest. The optomotor acceptance is
therefore **not met through the published flight code**.

With DNa02 the loop closes and the fly follows the drum in both directions (correlation
0.84 / 0.98 against the > 0.5 target). Looming makes the giant fiber fire (DNp01 200–237 Hz)
and the fly rolls 25°, but with the same sign for both approach directions, and it yaws away
from a left loom and toward a right one, so "banks away" is not established. This readout
is a deviation from the plan and is marked as such wherever it is used; it exists so that
Phases 5 and 6 can exercise the closed loop while the DNg02 result stands.


## Walking

Leg motor neurons by leg and joint are available from [B] by body ID (381 cells, `bench/out/
motor-neurons.json`, subclass fl/ml/hl × T1/T2/T3 × side, typed by muscle: tibia flexor /
extensor, trochanter flexor / extensor, sternal rotators, tarsal depressor, …). The map from
their rates to joint targets in Xenova's IK skeleton is not built in this pass: nothing in
the loop drives the leg VNC yet (the fly hovers; the walking DNs are silent), so there would
be nothing to validate it against. Xenova's tripod generator remains the fallback, and the
worker's `watch` API already exposes every leg-MN group's rate for when it is.
