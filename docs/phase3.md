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

RESULTS_TABLE

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

- The tonic DNg02 drive is a hand-set constant and the readout is threshold-sensitive.
- [A] on the CPU is now a third of the frame; its GPU port is Phase 5's first item.
- [B]'s HS cells fire at ~120 Hz under injection; LIF HS cells are a caricature of graded
  tangential cells, and the per-type gain table exists to tame that.
