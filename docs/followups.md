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

## 3. The readout without the artefact: the stabiliser was the artefact

**The change** (DECISIONS.md, "Readout gate"): the turn command is scaled by
min(1, (L + R)/(restL + restR)), so a DNa02 pair that has gone silent commands nothing instead of
−(restL − restR)/floor; optionally the rest levels follow the rates with τ = 10 s. Both off by
default; `bench/ablate.mjs --gate 1 [--recenter 10]`. Tables: `docs/ablations-gated.md`,
`docs/ablations-gated-recenter.md`; figure 19.

| condition | original readout | gated | gated + re-centring τ 10 s |
| --- | --- | --- | --- |
| intact | −10.9°, 0 coll. | +203.6°, 1 coll. | +107.5°, 0 coll. |
| bridge-off | −67.4°, 0 | +187.7°, 0 | +73.7°, 0 |
| haltere-off | −342.2°, 0 | −5.1° (excursion 77°), 1 | +54.2°, 0 |
| central-brain-silenced | −1,608° | −2.3°, straight | — |
| recurrence-off, neck-cut, decapitated | −2,256° (readout saturated) | −2.3°, straight | — |

**What the gate fixed.** Every condition whose readout populations are silent now flies
straight (−2.3° over 20 s, yaw-rate sd 0.011 rad/s), which is what "no evidence, no command"
should do; the −2,256° rows of docs/ablations.md were the readout, as that page said.

**What the gate revealed.** With the artefact gone, the intact loop drifts +204° in 20 s and
clips one pillar; **haltere-off drifts −5°**; bridge-off drifts +188°. Read together with §2:
the 30× stabilisation reported in Phase 5 was the haltere clamp acting *through* the artefact
(right-afferent drive silences both DNa02 sides, the silent pair became a fixed right command
that opposed the left drift). Remove the artefact and the same haltere current is at best
neutral and at worst harmful (+204° with it, −5° without). And the visual bridge does not hold
heading either: intact and bridge-off differ by 16° out of 200. The optomotor response through
DNa02 is real (docs/phase4.md, drum following at correlation 0.84–0.98) but at bridge gain 2 it
is far too weak to cancel a self-generated ~10°/s drift, whose optic flow is a tenth of the
drum's.

**Re-centring** halves the drift in every condition (204 → 108, 188 → 74), which says roughly
half of the remaining drift is the DNa02 rest asymmetry wandering after capture (the Phase 5
suspicion) and the other half is a genuine standing bias in the loop.

**Standing of the published numbers.** The Phase 5 and Phase 6 tables are reproducible and
stay as written (original readout, defaults unchanged). Their interpretation changes: "haltere
feedback cuts drift 30×" is true of that readout and false of the loop's wiring; "vision matters"
(bridge-off 67° vs intact 11°) was also carried by the clamp and does not survive the gate. The
README caveats and the thread's post 10 should be read with this section.

**What would actually stabilise heading.** (a) A stronger or faster optomotor path: bridge
gain, or a turn gain fitted so that the loop's own rotational optic flow at ~0.2 rad/s produces
a counter-command of the size the drift needs; (b) a haltere model with phase-encoded afferents
onto the wing-steering motor neurons instead of a yaw-rate current into DNa02's neighbourhood;
(c) re-centring by default. None of these is a wiring result; all are readout or proxy design.

## 4. A biological tonic drive for DNg02: AN07B004 is two cells and they set the network on fire

**The idea** (§1, HANDOFF step 1): replace the hand-set DNg02 constant with drive through
DNg02's own largest excitatory input, AN07B004, and ask whether HS then lateralises DNg02.

**What AN07B004 is in this graph.** Two cells, one per side, with 1,193 synapses onto DNg02
between them and very large output elsewhere. `bench/hs-inject.mjs --drive AN07B004:<mV/ms>
--dnbias 0` (output `bench/out/hs-inject-an07b004.txt`):

| AN07B004 current | DNg02 tonic | HS off: DNg02 L/R, spikes/1.5 s | HS on: DNg02 L/R, spikes/1.5 s |
| --- | --- | --- | --- |
| 0.5 | 0 | 1.2 / 0.0, 1,217,000 (storm) | 8.0 / 8.5, 140,000 |
| 1 | 0 | 1.2 / 0.0, 1,223,000 (storm) | 1.2 / 0.0, 1,248,000 (storm) |
| 2 | 0 | 11.2 / 11.9, 211,000 | 5.3 / 3.3, 1,244,000 (storm) |
| 2 | 0.4 | 20.8 / 15.3, 1,280,000 (storm) | 17.4 / 12.6, 1,274,000 (storm) |

For scale: with no drive at all this LIF is silent; with the DNg02 constant at 0.4 mV/ms it
makes about 33,000 spikes per second, and with the three HS cells driven on top 60,000–80,000
(`bench/out/hs-inject.txt`). Driving the two AN07B004 cells at 0.5 mV/ms or more tips most runs into a
network-wide storm of over a million spikes in which DNa02 and the relays read zero and DNg02
reads about 1 Hz; in the runs that stay out of the storm, DNg02 left and right move together
(8.0 / 8.5; 11.2 / 11.9) and HS drive changes the difference by no more than it did with the
constant. So the biological tonic route is not available in the un-refit LIF either: AN07B004's
output is strong enough that any current that makes it fire regularly destabilises the whole
network before DNg02 sits near threshold. Same verdict as §1, one level up: DNg02's steering
is not reachable by injecting current at any single point of this graph; it needs a fitted
network, which is outside this repo's premise.

## 5. The optic-v2 rate net on the GPU (HANDOFF step 3)

`src/brain/optic/rate-net-gpu.js` is AbijahKaj's two WGSL kernels (`drive` over 64-edge chunks of
the post-unit CSR, `integrate` per unit) on the same GPUDevice as Xenova's LIF. The CPU RateNet
still settles and runs the homeostat; `useGPU()` then uploads x, r, ext and bias once. Per frame
the worker submits the four substeps without waiting, queues a copy of r into a staging buffer,
runs the LIF batch (whose readback is the frame's only fence) and then maps r. The bridge current
for a frame is therefore built from the previous frame's rates: one frame (16.7 ms) of extra
visual latency, the price of not adding a second fence (a fence under Xvfb costs ~45 ms,
DECISIONS "rate hold per frame"). Opt in with `loop.html?optic=gpu`; the default stays on the
CPU so every number in the docs reproduces.

`bench/optic-gpu.mjs`, drum assay on both backends (RTX 3070, headed under Xvfb):

| | CPU rate net | GPU rate net |
| --- | --- | --- |
| wall per frame | 107.3 ms (optic 26.9, LIF 79.5) | 83.2 ms (optic 0.7, LIF 81.4) |
| realtime | 0.156× | 0.201× |
| [A] HS L/R, drum CW | 1.83 / 0.086 | 1.83 / 0.086 |
| [A] HS L/R, drum CCW | 0.309 / 1.237 | 0.309 / 1.237 |
| [B] HS L/R, CW / CCW | 129.8 / 0.1 · 8.5 / 68.6 Hz | 129.3 / 0 · 8.8 / 68.4 Hz |

The rate net's own output is identical to three decimals on both backends (max |Δ| in the HS
means 0.000), and the injected HS cells in [B] match to within a hertz; DNa02 differs
run to run as it always does (the LIF is chaotic past 30 ms, docs/phase1.md). The optic step
drops from 26.9 ms to 0.7 ms per frame, a ×1.29 frame speed-up. **The ceiling is now the LIF**: at
81.4 ms per 160 ticks it alone caps the loop near 0.2× realtime. HANDOFF's 0.4× target needs Xenova's
propagate/advance kernels to get faster (fewer, larger dispatches per tick, or a tick batch that
does not synchronise per step), not anything on the optic side.

## 6. Neuromodulation as flight state: more drive, no stability

**The idea** (review §4.4, DECISIONS "Flight state as a gain"): octopamine roughly doubles the
gain of the lobula-plate tangential cells in flight. Scale every synapse onto an LPTC in the optic
net by a flight gain (`?flight=`, 44,581 synapses), change nothing else, readout gated and
re-centred (§3), and ask whether the loop now holds heading and whether DNg02 lateralises.

**Drum assay** (`bench/flight-gain.mjs`, drum ±1 rad/s):

| flight gain | [A] HS L/R, CW | [B] HS L/R, CW (Hz) | DNa02 DSI L/R | DNg02 DSI L/R |
| --- | --- | --- | --- | --- |
| 1 | 1.723 / 0.087 | 122.5 / 0 | 0.184 / -0.111 | -0.035 / -0.043 |
| 2 | 2.042 / 0.165 | 174.9 / 10.1 | 0.174 / -0.177 | 0.023 / -0.003 |
| 3 | 2.414 / 0.226 | 195.1 / 28.5 | 0.198 / -0.403 | -0.003 / -0.011 |

The gain does what it says: HS in the optic lobe rises 1.72 → 2.41 and HS in the spiking net
122 → 195 Hz. DNg02 stays at zero selectivity at every gain (§1 and §4 said it would). DNa02's
selectivity grows on the right side only (−0.11 → −0.40), which is the ipsilateral bias the
haltere work found (§2), now visible under visual drive.

**Cruise, 20 s, three realisations per gain** (the loop is chaotic past 30 ms, so one run is
one sample; the realisations differ only in warm-up length, 3, 4, 5 s):

| flight gain | warm 3 s | warm 4 s | warm 5 s |
| --- | --- | --- | --- |
| 1 | +108° / 0 coll. | +87° / 0 coll. | +92° / 0 coll. |
| 2 | +171° / 1 coll. | — | — |
| 3 | +9° / 0 coll. | +175° / 2 coll. | +175° / 1 coll. |
| 4 | — | +170° / 1 coll. | — |

**Reading.** The first gain-3 run came in at +9° with no collisions and looked like the answer.
Its two replicates came in at +175° with one and two collisions, and gain 4 at +170° with one.
Gain 1 sits at 87–108° in all three. So the honest summary is: **raising the motion pathway to
flight strength adds drive and adds nothing to stability**; if anything the stronger loop hits
pillars more. The 9° run is what a single lucky realisation of a chaotic loop looks like, and it
is exactly the kind of number the thread would have quoted.

**Why it fails.** The optomotor path through DNa02 is a *rotation* reflex; the drift it would
have to cancel is a slow, self-generated ~5–10°/s turn whose optic flow at the eye is a tenth of
the drum's, and the readout's own dynamics (turn gain 2, rest re-centring at 10 s) add a slow
bias of their own. Doubling the LPTC gain scales the response to the drum, not the loop's
sensitivity to its own slow rotation, and the extra drive lands on DNa02's right-side bias.
Neuromodulation set as a gain is therefore not the stabiliser either; what is missing is a
proper heading signal (the central complex, which this loop never reads) or a haltere model that
encodes rotation rather than a yaw-rate current.

## 7. The ionic layer, one variable: adaptation stops the storms and mutes the responses

**The change** (review §4.5, DECISIONS "potassium-like adaptation"): one state variable per
neuron, a threshold shift that grows by `inc` mV on every spike and decays with `tau` (300 ms),
in both LIF backends (`?adapt=inc,tau`, default off). `bench/adapt-check.mjs`: with it on, the
JavaScript and WebGPU LIF still spike identically for the first four frames (0, 0, 47, 398
spikes against 0, 0, 47, 409 without it), so the term is the same on both backends and inert at
zero.

**The AN07B004 probe again, with 0.5 mV per spike** (`bench/hs-inject.mjs --drive AN07B004:I
--adapt 0.5,300`, `bench/out/hs-inject-an07b004-adapt.txt`):

| AN07B004 current | DNg02 tonic | HS off: DNg02 L/R, spikes/1.5 s | HS on: DNg02 L/R, spikes/1.5 s | HS on: DNa02 L/R |
| --- | --- | --- | --- | --- |
| 0.5 | 0 | 0.7 / 1.4, 47,000 | 1.2 / 2.4, 176,000 | 6.7 / 5.3 |
| 1 | 0 | 2.7 / 4.2, 66,000 | 2.6 / 3.2, 235,000 | 10.7 / 9.3 |
| 2 | 0 | 4.2 / 5.8, 340,000 | 4.7 / 6.3, 322,000 | 6.7 / 5.3 |
| 0.5 | 0.4 | 11.4 / 12.8, 51,000 | 13.6 / 13.9, 312,000 | 5.0 / 3.2 |
| 1 | 0.4 | 14.0 / 14.3, 273,000 | 13.9 / 15.0, 331,000 | 10.9 / 6.7 |
| 2 | 0.4 | 16.7 / 18.8, 141,000 | 16.2 / 18.6, 82,000 | 11.0 / 6.7 |

**Reading.** The storms are gone: the worst run makes 340,000 spikes in 1.5 s where the same
drive made 1.2 million before, and no run pins at the ceiling. That is the ionic layer doing
what the review says it does, with one variable. But the same term takes the responses with
it: DNg02 under AN07B004 alone reaches 4–6 Hz, not threshold; with the constant back on it sits
at 11–19 Hz and HS shifts left minus right by at most 2 Hz, in the wrong direction; and DNa02,
which lateralised 26 / 6 Hz from HS with no adaptation, now manages 11 / 7 at best. At 0.5 mV
per spike a cell at 30 Hz carries a 4.5 mV threshold shift, most of the 7 mV gap, so the term
is a brake on every population, not only on runaway ones. A strength sweep (0.1, 0.2, 0.5 mV
per spike, `bench/out/hs-inject-adapt-sweep.txt`):

| adaptation, mV/spike | HS alone (tonic 0.4): DNa02 L/R, HS off → on | AN07B004 1 mV/ms, no constant: spikes/1.5 s | AN07B004 1 + tonic 0.4: DNa02 L/R, HS off → on |
| --- | --- | --- | --- |
| 0 (reference) | 2.8 / 6.8 → 24.4 / 13.8 | 1,223,000 (storm) | — |
| 0.1 | 5.4 / 5.4 → 14.9 / 8.6 | 781,000 (storm) | 14.4 / 19.7 → 26.4 / 12.0 |
| 0.2 | 6.4 / 5.5 → 11.2 / 8.3 | 579,000 (storm) | 11.7 / 9.4 → 2.7 / 0.0 (storm with HS) |
| 0.5 | 4.0 / 10.7 → 9.3 / 5.3 | 66,000 | 5.3 / 11.0 → 10.9 / 6.7 |

There is no strength that does both jobs. At 0.1 mV per spike DNa02 keeps most of its
optomotor response (+6 Hz left − right from HS; +14 with AN07B004 and the constant on) but the
AN07B004 storm is only trimmed, not stopped; at 0.5 the storms are gone and so is most of the
response; 0.2 sits in between and still storms once HS is added. DNg02 is flat at every
strength (24.0 / 25.2 → 24.2 / 25.3 in the best-driven case). A single global brake trades
storms for responses because it is global; the real fly's extracellular potassium is local,
which is the next variable up and not one this repo can set from its data.

**Verdict.** Same as §4 by another route: DNg02 is not reachable by injecting current at any
one point of this graph, with or without the ionic brake. The brake itself is worth keeping as
an option: it is the first hand-set constant in this repo that makes the network *less*
willing to do something implausible rather than more, and any future run that drives strong
cells should have it on.
