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

## 2. Haltere sign vs anatomy: the proxy is an anti-spin clamp, not a reflex

**The claim being tested** (docs/phase5.md, DECISIONS.md): haltere sign −1 (yaw left → current on
the *right* afferents) is "corrective"; +1 spins the fly. Was that anatomy or luck?

**Anatomy** (`bench/haltere-paths.mjs`). The 205 afferents are cholinergic (+1; three
serotonergic) and project mostly to their own side: left afferents put 24k synapses on left VNC
interneurons, 11k on left ascending neurons, 1,966 directly on left wing motor neurons against 36
on the right. Their two-hop signed drive onto DNa02 is dominated by one GABAergic
posterior-slope cell per side, PS059 (−58k left, −72k right), i.e. **each side's afferents
inhibit their own DNa02**. Under the readout (DNa02 L > R → yaw left) that predicts right-afferent
drive → DNa02 L > R → a *left* command during a left yaw: positive feedback. The two-hop count
predicts the opposite of the experiment.

**Steady state** (`bench/haltere-inject.mjs`, one side's afferents at a constant current, DNg02
tonic 0.4, rest 13.2 / 12.3 Hz, readout gain 2, floor 5; command > 0 = yaw right):

| current, mV/ms | left afferents: DNa02 L/R → command | right afferents: DNa02 L/R → command |
| --- | --- | --- |
| 0.1, 0.25 | 13.2 / 12.3 → 0 (below threshold) | same |
| 0.3 | 7.1 / 8.7 → +0.24 | 4.8 / 7.5 → +0.41 |
| 0.4 | 8.0 / 16.0 → +0.50 | 15.8 / 11.0 → −0.25 |
| 0.5 | 18.4 / 6.7 → −0.50 | 16.7 / 5.3 → −0.50 |
| 0.6 | 24.6 / 2.6 → −0.50 | 13.0 / 15.5 → +0.20 |
| 0.8, 1, 2 | 0 / 0 → +0.34 | 0 / 0 → +0.34 |
| 1.5 | 15.5 / 0 → −0.50 | 0 / 0 → +0.34 |
| 3 | 5.4 / 0 → −0.50 | 0 / 0 → +0.34 |

Three things to read off. Below 0.3 mV/ms the afferents do not fire, so nothing happens. From
0.3 to 0.6 the command flips sign with every step, on both sides: this is a whole-network
response through PS059 (46 → 110 Hz, bilateral), not a mirrored reflex. From 0.8 mV/ms up the
sides differ in one systematic way: **right afferents silence both DNa02 populations**, which the
rest-subtracted readout turns into a fixed *right* command (+0.34, the "silent readout" artefact
of docs/ablations.md), while **left afferents keep the left DNa02 alive** at 1.5 and 3 mV/ms, a
*left* command. So at large currents each side commands a turn toward itself.

**The closed loop** (`bench/haltere-loop.mjs`, intact cruise, every frame). Sign −1: drift
−10.9°, |yaw rate| p50 0.28 and p90 0.69 rad/s; 29% of frames below the afferent threshold, 31%
in the flipping band, 40% at ≥ 0.7 mV/ms; the command against yaw rate has slope −0.18 (mean
−0.06 during left yaws, +0.08 during right yaws), i.e. weakly the *wrong* way on average, yet the
heading stays within ±20°. Sign +1: the body sits at its yaw-rate limit (2.0 rad/s, right) for
99% of frames with the command pinned at +0.49; drift −2,206°.

**Reconciliation.** The sign decides what happens at the *high-current end*, which is the only
regime that matters for a spin. Under sign −1 a fast right yaw drives the left afferents (3 mV/ms
→ left command) and a fast left yaw drives the right afferents (→ right command): both push back,
so no spin can lock in, and the fly chatters inside the flipping band instead. Under sign +1 a fast
right yaw drives the right afferents → right command → the spin sustains itself, which is exactly
the saturated state the loop measured. Nothing in this is a haltere reflex: it is a side
asymmetry in how hard the two afferent sets shut DNa02 down, converted into commands by a readout
that treats silence as a turn.

**Verdict.** "Corrective" is retracted as an anatomical statement and kept as an empirical one:
sign −1 is an anti-spin clamp that works at large yaw rates through PS059 saturation and the
rest-subtraction artefact. The 30× drift reduction is real; its mechanism is not the one the thread
implies. Two consequences for the queue: HANDOFF step 2 (a readout that does not turn silence into
a command) is now the first thing to fix, because it is load-bearing here; and a haltere model
worth the name needs phase-encoded afferent activity (Coriolis) and the wing-steering motor
neurons, not a yaw-rate current on 205 cells.
