# Phase 3 — Two-network bridge

Date: 2026-09-07. Acceptance (GOAL.md): with the drum rotating, DNg02 L/R rates in [B] differ
in the direction AbijahKaj's HS readout predicts; looming sphere → LC4/LPLC2 → DNp fires in
[B]; a DSI-like index at DNg02 for CW vs CCW, target > 0.3 on first pass.

## What runs

```
eye (WebGL, main thread, per 16.7 ms frame)  ->  lum per column
   -> worker: [A] optic-v2 rate net (CPU, 4 ms Euler, AbijahKaj's fitted parameters)
              -> HS / LC4 / LPLC2 rates minus their rest, x bridgeGain -> current (mV/ms)
   ->         [B] Xenova's MaleCNS LIF (WebGPU, 0.1 ms ticks) at the same body IDs
              -> EMA rates of DNg02, DNp, HS, LC4, wing / haltere MNs, walk / turn DNs
```

| piece | file |
| --- | --- |
| optic-v2 graph loader, parameters, rate net (ports) | `src/brain/optic/graph.js`, `params.js`, `rate-net.js` |
| the optic brain: photoreceptors → lamina, tonic drives, calibration, readouts | `src/brain/optic/optic.js` |
| worker bridge mode: `init { optic, columns }`, `frame { dt, lumL, lumR }`, `bridge { config }` | `src/worker.js` |
| the loop page (scene, eye, worker; fixed-frame stepping; bench hook) | `loop.html`, `src/loop.js` |
| benches | `bench/optic-settle.mjs`, `bench/optic-drum.mjs`, `bench/paths.mjs`, `bench/bridge.mjs` |

Scene time advances in fixed 1/60 s frames only when the worker has integrated the previous
one, so runs are deterministic and neural time equals scene time whatever the wall clock does.

## Step 1 — [A] runs in our code

`bench/optic-settle.mjs`: 65,799 units, 1,967,771 edges, fitted parameters on 80 types /
1,615,358 edges; under uniform grey L1/L2 silent, T4/T5 at 0.01–0.03, HS rest 1.02 / 0.96,
LC4/LPLC2 at 0, DNg02 0.68 / 0.72, [A]'s DNp at the ceiling (4.9; its central-brain inputs run
unfitted, which is why DNp is not bridged). 6.8 ms per 4 ms step on the dev VM.

`bench/optic-drum.mjs` (synthetic 12-cycle drum per column, still-drum warm-up, ±1 rad/s):

| | still | ω = +1 | ω = −1 |
| --- | --- | --- | --- |
| HS L / R | 0.99 / 0.93 | 0.14 / 0.77 | 0.84 / 0.09 |
| turn signal dL − dR | 0.003 | −0.574 | +0.614 |
| T4a − T4b per ommatidium, L / R | −0.02 / −0.00 | −0.05 / +0.11 | +0.22 / −0.13 |
| LC4 L / R | 0 / 0 | 0.08 / 0.07 | 0.05 / 0.10 |

Their open-loop numbers: HS lateralise with the drum, T4a − T4b flips, looming cells quiet
under gratings, DNg02 nearly constant. Reproduced.

## Step 2 — the bridge

Rendered drum in the loop page, ±1 rad/s, still-drum warm-up of 3 s, 3 s windows.

### Looming → LC4/LPLC2 → DNp in [B]: met

Sphere approaching from −45° at 2 units/s (their assay), bridge gain 2, RTX 3070:

| | before | peak during the approach |
| --- | --- | --- |
| [A] looming readout, left eye (top-5 LC4/LPLC2 above rest) | 0 | 4.90 |
| [B] LC4 left | 0 Hz | 232 Hz |
| [B] LPLC2 left | 0 Hz | 145 Hz |
| [B] DNp01 (giant fiber) | 1 Hz | 207 Hz (241 Hz at gain 4) |
| [B] DNp01–06 | 0.2 Hz | 149 Hz |

### DNg02 lateralisation: direction sometimes, size never (DSI target > 0.3 not met)

Drum ±1 rad/s, 3 s windows, RTX 3070 unless noted. DSI = (CW − CCW)/(CW + CCW) per side.

| bridge | gain | DNg02 tonic (mV/ms) | [B] HS L/R, CW | DNg02 L/R, CW | DNg02 L/R, CCW | DNg02 L−R, CW / CCW | DSI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| validated | 2 | 0.5 | 124 / 0 Hz | 30.7 / 30.4 | 30.5 / 30.2 | +0.31 / +0.37 Hz | 0.00 |
| validated | 4 | 0.5 | 175 / 0.5 Hz | 29.8 / 28.8 | 29.5 / 28.9 | +0.96 / +0.54 Hz | 0.00 |
| off (control) | – | 0.5 | 0 / 0 Hz | 30.4 / 29.8 | 29.9 / 29.5 | +0.67 / +0.41 Hz | 0.01 |
| validated (JS LIF) | 2 | 0.36 | 118 / 0 Hz | 14.4 / 15.1 | 16.2 / 17.8 | −0.70 / −1.56 Hz | 0.06–0.08 |
| validated (JS LIF) | 2 | 0.40 | 118 / 0 Hz | 19.3 / 20.0 | 20.1 / 19.8 | −0.66 / +0.30 Hz | 0.02 |
| validated (JS LIF) | 2 | 0.44 | 118 / 0 Hz | | | +0.55 / −0.48 Hz | 0.02 |
| inputs, 1,114 cells (JS LIF) | 2 | 0.5 | 116 / 0 Hz | 30.6 / 30.8 | | | 0.00 |

[A]'s own turn signal in the same runs: +1.40 (CW) / −0.73 (CCW). The injected HS cells in [B]
fire 118–175 Hz on the side [A] predicts and stay silent on the other; the bridge itself works.
DNg02 does not follow because its input from HS is diluted and cancelled:

| what `bench/hs-inject.mjs` measures (three left HS cells at 129 Hz, nothing else painted) | value |
| --- | --- |
| PS080_L input synapses / of which from HS | 4,495 / 259 (6%) |
| PS080 L/R | 24 / 12 Hz |
| spikes recruited network-wide by the three HS cells | 59,611 per second |
| DNg02 L/R, no tonic drive | 2.7 / 3.5 Hz |
| DNg02 L/R, tonic 0.4 | 19.2 / 18.4 Hz (17.4 / 17.4 without HS) |
| DNa02 L/R, tonic 0.4 | 24.4 / 13.8 Hz (2.8 / 6.8 without HS) |

The GABAergic relay gets as much recurrent inhibition (PS118, PS057, PS090, LAL061, …) as HS
gives it excitation, and the octopaminergic OA-VUMa4 route (HSS → VUMa4 → DNg02, 91–125 / 28
synapses, +1 under Shiu's monoamine convention) excites the contralateral DNg02 that PS080
inhibits. In the un-refit LIF the two cancel to within 1 Hz. Meanwhile DNa02, which HSS
reaches directly (36–47 synapses), lateralises 26 / 6 Hz from HS alone.

**Verdict:** looming criterion PASS; DNg02 direction criterion marginal (the sign of L−R
follows [A] in some runs and not others, within ±1 Hz of noise); DSI 0.00–0.08 against a
0.3 target: FAIL, and a finding rather than a bug. It is the same DNg02 hop AbijahKaj
report as open, now shown from the other side of the seam.


Wiring behind the numbers (`bench/paths.mjs`, [B]): no direct HS → DNg02 synapse. HSS/HSN →
PS080 (GABAergic; 112–168 synapses) → contralateral DNg02 (152–172 synapses over 14–15 cells)
is the strongest two-hop route, exactly AbijahKaj's finding; HSS also drives DNa02 directly
(36–47 synapses), Xenova's "turn" channel. DNg02's real drive: IB008, DNp54, PS117 (inhibitory)
and AN07B004 (ascending, excitatory, the top excitatory input), PS041, GNG544, LAL197.

## Throughput (RTX 3070, headed under Xvfb)

| coupling | wall per 16.7 ms frame | realtime |
| --- | --- | --- |
| per 4 ms substep (4 GPU fences per frame) | 213 ms (optic 27, LIF 182) | 0.08× |
| rate held per frame (1 fence) | 95 ms | 0.18× |

## Open

- The tonic DNg02 drive is a hand-set constant; it sets DNg02's rate but not its
  lateralisation, at any level between 0.36 and 1 mV/ms.
- [A] on the CPU is now a third of the frame; its GPU port is Phase 5's first item.
- [B]'s HS cells fire at ~120 Hz under injection; LIF HS cells are a caricature of graded
  tangential cells, and the per-type gain table exists to tame that.
