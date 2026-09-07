# Follow-ups after publication

Date: 2026-09-07, evening. The two experiments HANDOFF.md queued first, run on the JavaScript
LIF on the dev VM (`bench/hs-inject.mjs --octopamine`, `bench/haltere-paths.mjs`,
`bench/haltere-inject.mjs`; outputs in `bench/out/`). Figures 17 and 18 in `docs/figures/`.

## 1. The octopamine hypothesis is dead

**The claim being tested** (docs/phase3.md, DECISIONS.md): HS reaches DNg02 through two relays
that cancel, PS080 (GABAergic, inhibits the contralateral DNg02) and OA-VUMa4 (octopaminergic,
+1 under the load-time monoamine fix, excites it); silence VUMa4 and PS080 should lateralise
DNg02.

**Setup.** Three left HS cells driven at 1.5 mV/ms, nothing else painted; DNg02 at a tonic
0.4 or 0.5 mV/ms; 1.5 s runs, the last 0.75 s averaged. Muting = −50 mV/ms on every cell of
the type. The monoamine condition keeps the sign Xenova's file gives the 541 dopamine,
octopamine and serotonin cells, which is **0** for all of them (101 octopaminergic); the +1
they get at load is the only thing that lets OA-VUMa4 transmit at all.

| condition | tonic | DNg02 L/R, HS off | DNg02 L/R, HS on | L−R shift | DSI on |
| --- | --- | --- | --- | --- | --- |
| baseline | 0.4 | 21.0 / 21.3 | 21.4 / 20.8 | +0.96 Hz | 0.01 |
| baseline | 0.5 | 31.4 / 31.0 | 31.6 / 30.8 | +0.34 Hz | 0.01 |
| OA-VUMa4 muted | 0.4 | 21.9 / 21.8 | 22.5 / 22.6 | −0.23 Hz | −0.00 |
| OA-VUMa4 muted | 0.5 | 31.1 / 31.3 | 31.0 / 31.3 | −0.08 Hz | −0.01 |
| PS080 muted | 0.4 | 24.0 / 23.9 | 21.6 / 21.6 | −0.10 Hz | 0.00 |
| PS080 muted | 0.5 | 29.8 / 27.9 | 32.3 / 33.8 | −3.44 Hz | −0.02 |
| both muted | 0.4 | 18.4 / 18.3 | 22.4 / 22.6 | −0.37 Hz | −0.01 |
| both muted | 0.5 | 29.6 / 28.9 | 31.6 / 31.5 | −0.75 Hz | 0.00 |
| monoamines at file sign (0) | 0.4 | 17.6 / 17.7 | 14.1 / 14.3 | −0.05 Hz | −0.01 |
| monoamines at file sign (0) | 0.5 | 26.4 / 26.6 | 21.8 / 21.7 | +0.30 Hz | 0.00 |

**Reading.** The prediction was a clear positive shift with VUMa4 out. It is −0.2 and −0.1 Hz.
With PS080 out, with both out, and with every monoamine cell silent, DNg02 left and right stay
within a hertz of each other; the one −3.4 Hz entry (PS080 muted, tonic 0.5, DSI −0.02) is
run-to-run chaos and points the wrong way for a PS080 story anyway. **Neither relay, alone or
together, moves DNg02.** The cancellation story is falsified, and the Phase 3 finding stands on
a simpler footing: in this un-refit LIF, DNg02 is set by its other 35,000 input synapses
(AN07B004, IB008, PS117, DNp54, PS041 …) and 324 relay synapses from HS cannot lateralise it.

DNa02, by contrast, lateralises in every one of the ten runs (36.6 / 5.3 Hz with VUMa4 muted,
34.0 / 9.4 with both muted, 17.2 / 1.3 with the monoamines silent). The labelled DNa02 readout
does not depend on either relay.

**Side result.** The +1 monoamine convention sets the network's excitability, not DNg02's
direction: at the file sign, DNa02 rests at 2 / 3 Hz instead of 13 / 12, and at tonic 0.5 it is
silent until HS drives it.

**What would move DNg02.** Not another relay. Either a biological tonic drive that puts DNg02
near threshold through its real inputs (AN07B004, the ascending flight-state candidate; a
`bench/hs-inject.mjs --drive AN07B004` run is the next probe) or a refit of synaptic gains, which
is outside the un-refit premise of this repo.

## 2. Haltere sign vs anatomy

*(filled in below once `bench/haltere-inject.mjs --currents 0.1,0.25,0.5,1` completes)*
