# Phase 0 — Reconnaissance

Date: 2026-09-06. Submodule commits: `vendor/fruit-fly-simulation` @ 776d115,
`vendor/fruit-fly-brain-research` @ c28066a, `vendor/fruit-fly-brain` @ 4893ecf.
Numbers below come from `bench/overlap.mjs`, `bench/edges.mjs` and `bench/annotations.py`
(outputs in `bench/out/`). Path shorthands: **X** = `vendor/fruit-fly-simulation`,
**R** = `vendor/fruit-fly-brain-research`, **D** = `vendor/fruit-fly-brain`.

## 0. Answers in brief

| question | answer |
| --- | --- |
| How does Xenova index neurons? | Graph index *i* = row *i* of `neurons.json.gz`; row = `[bodyId, type, superclass, side, consensusNT, fastSign, somaLocation8nm]`. No explicit map; build `Map(bodyId → i)`. Rows are sorted by body ID. |
| LIF? | Shiu 2024 adapted: dt 0.1 ms, τm 20 ms, τs 5 ms, rest −52 mV, threshold −45 mV, 0.275 mV × synapse count × sign, delay 1.8 ms, refractory 2.2 ms. Exact-exponential update, event queue of 19 slots. |
| External input today? | Per-neuron **Poisson rate (Hz)**, refreshed every 10 ms batch; each event adds 68.75 mV, i.e. forces a spike. Driven neurons lose their refractory period. It is a rate clamp, not a current. There is **no additive current path** yet. |
| What does `controller.js` read? | Six channels, one Hz value each: mean rate of {DNp09, DNg100, DNg97} L/R, {DNa02, DNa11, DNg13} L/R, MDN, DNp01 (18 cells; body IDs in §1.6). |
| AbijahKaj's schema? | JSON header + one `.bin` of typed arrays: per unit bodyId/type/side/role/sign/column, per edge pre/post/synapse count, per column side/hex/az/el. Loader in `R/app/src/brain/graph.ts`. |
| Sensory input units? | None are photoreceptors. Light enters as `ext` on the 5,327 lamina cells L1/L2/L3 (one triple per column, 1,771 columns) from a virtual photoreceptor per column. |
| Readout units? | HS (6), LC4 (126), LPLC2 (185), DNg02 (29), DNp01–06 (12), wing MNs (67), haltere MNs (16). Body IDs in `bench/out/recon-ids.json`. |
| Overlap? | **100%**: 65,799 / 65,799 units, 1,967,771 / 1,967,771 edges, and every shared edge has an identical synapse count. |
| One network or two? | **Two.** See `DECISIONS.md`. |

## 1. Xenova `fruit-fly-simulation` — the back end

### 1.1 Neuron indexing (Q1)

- `X/public/data/manifest.json` describes the data: `neurons: 166700`, `edges: 25582938`,
  three gzipped `Uint32` arrays (`offsets` n+1, `sources` E, `counts` E) and one metadata file
  `neurons.json.gz` with `metadataColumns = [bodyId, type, superclass, side, consensusNT,
  fastSign, somaLocation8nm]`.
- `X/src/data-loader.js:123` parses `neurons.json.gz` into an array of rows; **array index =
  neuron index everywhere else**. `data-loader.js:128` builds `graph.sign` from column 5.
  Example row 0: `[10001, "DNp01", "descending_neuron", "R", "acetylcholine", 1, [37124, 22258, 36274]]`.
- The CSR is **incoming**: for target *j*, `sources[offsets[j] .. offsets[j+1])` are presynaptic
  indices (sorted ascending) and `counts[e]` is the synapse count
  (`data-loader.js:132-149`; transposed to outgoing in `X/src/brain.js:19-34`).
- Painting sends graph indices, not body IDs: `X/src/brain-view.js:78-84` loads the same
  rows for hit-testing, `X/src/main.js:125-131` posts `{type:'pulse', indices}`.
- Body IDs are unique (`bIndexByBody.size === 166700`, checked in `bench/overlap.mjs`) and
  the rows are sorted by body ID. Still use a Map; nothing upstream promises the order.
- Signs (`fastSign`, from `manifest.json` "assumptions" and `X/public/model.json`
  `neuralModel.signs`): ACh +1 (103,720 cells), GABA −1 (22,069), glutamate −1 (29,302),
  **histamine 0 (7,891)**, unclear/nan 0 (3,177). `X/src/worker.js:23-26` flips dopamine,
  octopamine and serotonin (541 cells) to +1 at load. Note: AbijahKaj gives histamine −1
  (§3.4).

### 1.2 The LIF model (Q2)

Parameters `X/src/brain.js:2-12` (ms, mV; ticks = 0.1 ms):

| | value | where |
| --- | --- | --- |
| dt | 0.1 ms | `brain.js:3`, `model.json neuralModel.dtMs` |
| rest / threshold | −52 / −45 mV | `brain.js:4-5`; literals in `propagate-sparse.wgsl:62,67,77` |
| τm / τs | 20 / 5 ms | `brain.js:6-7` |
| refractory | 22 ticks = 2.2 ms | `brain.js:8` |
| delay | 18 ticks = 1.8 ms, queue of 19 slots | `brain.js:9,54,96,125-126` |
| synapse | 0.275 mV per synapse count | `brain.js:10`; `wgsl:70` |
| Poisson kick | 68.75 mV | `brain.js:11`; `wgsl:72` |
| seed | 1 | `brain.js:41`; `brain-gpu.js:184` |

Update per tick, when not refractory (`brain.js:87-91`, `wgsl:59-64`):

```
EM = exp(−dt/τm),  ES = exp(−dt/τs),  C = τs/(τm−τs) · (EM − ES)      // brain.js:35-37
v ← rest + (v − rest)·EM + g·C
g ← g·ES
spike if v > threshold   (checked before this tick's events, brain.js:90 / wgsl:66-67)
```

Synaptic input: a spike of *i* at tick *t* is queued to slot `(t+18) % 19`; at delivery
`g[j] += counts[e] · sign[i] · 0.275` for every outgoing edge, **skipped if j is refractory**
(`brain.js:98-109`; on GPU integer atomics into `currents`, `wgsl:39-44`, then
`g += current · 0.275`, `wgsl:68-70`). `silenced` suppresses delivery, not spiking
(`brain.js:98`, `brain-gpu.js:199`).

Reset (`brain.js:119-124`, `wgsl:76-80`): `v = rest`, `g = 0`, `counts[i]++`, and
`until = t + (rates[i] > 0 ? 0 : 22)` — **a neuron with a non-zero external rate has no
refractory period.** Only neurons with sign ≠ 0 and outgoing edges are queued
(`wgsl:84`).

Weight scaling: none beyond count × 0.275 mV × sign. Nothing is fitted to MaleCNS
(`manifest.json` "0.275 mV per synapse from Shiu et al., adapted to MaleCNS without fitting").

### 1.3 External input today: the pulse path, and what `inject` needs

- The only input is `rates: Float32Array(n)` in **Hz**, passed to `brain.batch(steps, rates)`
  (`brain.js:130-137`, `brain-gpu.js:174-181` writes it to the `rates` storage buffer).
- Each tick, for each neuron with `rates[i] > 0` and not refractory: if
  `hash(i, t, seed) / 2³² < rates[i] · dt / 1000` then `v += 68.75` (`brain.js:110-118`;
  `wgsl:71-73`). 68.75 mV is ten times the 7 mV gap to threshold, so **every external event
  produces a spike on the next tick**. Combined with the zero refractory period, a driven
  neuron fires at ≈ `rates[i]` Hz plus whatever its recurrent input adds. Semantically this is
  a rate clamp.
- Rates are refreshed once per batch of 100 ticks = 10 ms (`worker.js:60-61`) from
  `PulseBank.sample(tick)` (`X/src/stimulus.js:23-36`): per pulse,
  `rate = strength · exp(−max(0, age − hold) / decay)`, envelopes `paint {80 ms hold, 180 ms
  decay, 1 s}` and `turn {650, 220, 2.5 s}` (`stimulus.js:2-5`), default strength 180 Hz
  (`stimulus.js:12`), rates < 1 Hz dropped (`stimulus.js:32`). At most 32 pulses retained.
- Presets (`model.json neuralModel.pulse.actionTargets`, `stimulus.js:62-66`): Walk = LC9
  both sides (219 cells), Left/Right = LC9 + DNa02 same side, Fly = LC4 both sides (126).
- Determinism: the RNG is a hash of (index, tick, seed) (`brain.js:13-18`, `wgsl:21-26`),
  identical on CPU and GPU, so runs are reproducible given the same rates.

**Implication for Phase 1.** `brain.inject(Float32Array)` cannot be built on the `rates`
buffer if it is to be additive. Two candidates, both to be implemented in `BrainCPU.advance`
*and* the WGSL `advance` because `worker.js:64-71` cross-checks GPU against CPU population
rates every batch at 1e-3 relative tolerance:

1. **Poisson-rate injection** (reuse `rates`): zero kernel work, but clamp semantics and no
   refractory. Keep as the regression path for painting.
2. **Additive current** (new `iext: array<f32>` binding, mV per tick, added to `v` when the
   neuron can integrate): sums with recurrent input, keeps the refractory period. With
   τm = 20 ms and dt = 0.1 ms the steady state is `Δv = iext · 200`, so `iext > 0.035` mV/tick
   reaches threshold alone; a bridge gain maps [A]'s rate (0–5) into that range. This is the
   path the plan's "inject, don't clamp" needs.

### 1.4 Worker protocol and batch structure

`X/src/worker.js`: messages `init` (loads graph, tries `BrainGPU`, falls back to
`BrainCPU`, `worker.js:17-46`), `pulse`, `reset`, `clear`, `step`. A `step` runs 100 ticks
(`worker.js:60`), decodes the six channels (`stimulus.js:82-88`: mean count per cell in the
group × 10000 / steps → Hz), posts `rates` (6 floats), `firing` indices and `counts`
(`worker.js:82-95`). The page calls `controller.advance(m.rates, m.steps · 0.0001)`
(`main.js:251`), i.e. dt = 10 ms.

`BrainGPU.batch` (`brain-gpu.js:174-252`) accepts 1–200 steps (`brain-gpu.js:176`), writes one
256-byte uniform block per step (`:182-189`), submits 20 steps per command buffer (`:190-214`,
propagate skipped while `tick < delay`), gathers the 18 motor cells into a `MatMul` kernel
(`:216-226`, `prepareReadout :282-301`, weights from `stimulus.js:72-81`), then **maps
`counts` (n × 4 B = 667 KB) back to the host every batch** (`:227-247`). A rate readout at
higher time resolution (Phase 1's `brain.rates`, EMA τ ≈ 20 ms) can be built on that
readback if the batch is shortened to 40 ticks (4 ms), or computed on the GPU.

### 1.5 GPU buffer layout (`brain-gpu.js:79-103`)

| buffer | contents | size |
| --- | --- | --- |
| `graph` | `offsets` (n+1) ‖ `sign` (n) ‖ outgoing `targets` (E), all u32 | 103.7 MB |
| `edgeCounts` | outgoing counts, u32 | 102.3 MB |
| `state` | `{v: f32, g: f32, until: u32, pad}` per neuron | 2.7 MB |
| `history` | 19 slots × n spike ids + 19 atomic sizes | 12.7 MB |
| `indirect` | 19 × dispatch args | — |
| `rates`, `counts`, `currents` | n × f32 / f32 / atomic i32 | 0.7 MB each |
| `uniform` | 256 B × 200 steps | 51 KB |

≈ 225 MB resident; requires `maxStorageBufferBindingSize ≥ 103.7 MB`
(`brain-gpu.js:59-64`). Two pipelines: `propagate` (4 spiking sources per 128-lane workgroup,
32 lanes per source, `wgsl:28-45`) and `advance` (one lane per neuron, `wgsl:47-92`). The
device comes from `@huggingface/kernels` (`brain-gpu.js:36-55`); kernels are pinned by
revision (`Identity 88a09b2…`, `MatMul 16a3da1…`) and vendored under `X/public/kernels/`.

### 1.6 What `controller.js` reads (Q3)

Groups built by type and side in `X/src/stimulus.js:42-69`; channels
`[walkLeft, walkRight, turnLeft, turnRight, reverse, escape]` (`stimulus.js:70`). Body IDs,
with [B] index after `@`:

| channel | types | body IDs |
| --- | --- | --- |
| walkLeft | DNg100, DNp09, DNg97 (L) | 10045@36, 10783@725, 13805@3548 |
| walkRight | same (R) | 10056@46, 11177@1087, 230783@122339 |
| turnLeft | DNa11, DNg13, DNa02 (L) | 10971@898, 11074@993, 523769@131957 |
| turnRight | same (R) | 10360@332, 11233@1142, 512006@125880 |
| reverse | MDN (4) | 10763, 11288, 11332, 12348 |
| escape | DNp01 (giant fiber, 2) | 10001@0 (R), 10010@6 (L) |

`X/src/controller.js:49-56`: EMA τ = 80 ms on each channel; `walking = max(0, (wl+wr)/2 − 6)`,
`reverse = max(0, back − 25)`, `turn = max(0, tl − 15) − max(0, tr − 15)`;
`groundSpeed = 8·tanh(walking/30) − 4·tanh(reverse/90)` mm/s;
`yawRate → 3.8·tanh(turn/45)` rad/s with τ = 40 ms. `escape > 100` Hz triggers a scripted
takeoff (`controller.js:58-66`); flight is an authored altitude/speed controller
(`:77-108`) that lands after 0.35–0.9 s. Gait phase advances with speed (`:132-133`); the
tripod gait and IK live in `X/src/gait.js` and are driven by the pose only. **Nothing about
the body ever re-enters the network** (`model.json controller.sensoryFeedback: "None"`).

This is the whole "semantics" layer Phase 4 deletes: 18 cells → 6 Hz values → three
hand-chosen thresholds and tanh gains.

## 2. AbijahKaj `fruit-fly-brain-research` — the front end

### 2.1 Graph schema (Q4)

`D/optic.json` (= `R/app/public/graphs/optic-v2.json`) is a v2 header
(`R/app/src/brain/graph.ts:90-100`) with `units.count = 65799`, `edges.count = 1967771`,
`columns.count = 1771`, `roles = [input, brain, dn, vnc, output, optic]`,
`sides = [L, R, M]`, `types[317]` = `{name, superclass, count, nt, tau}`, and `arrays` =
name → `{dtype, offset, length}` into `optic.bin` (24.9 MB):

| array | dtype | meaning |
| --- | --- | --- |
| `units.bodyId` | f64 | MaleCNS body ID (sorted ascending, `R/data/extract_v2.py:116`) |
| `units.type` | i32 | index into `types` |
| `units.side` | i8 | index into `sides` |
| `units.role` | i8 | index into header `roles` (remapped to `ROLES` order, `graph.ts:122-124`) |
| `units.sign` | i8 | +1 ACh; −1 GABA, glutamate, **histamine**; 0 amines/unclear (`extract_v2.py:57`) |
| `units.col` | i32 | column index or −1 |
| `edges.pre`, `edges.post` | i32 | unit indices |
| `edges.weight` | f32 | raw synapse count (≥ 2 in the optic lobe, ≥ 5 elsewhere, `extract_v2.py:52-53`) |
| `columns.side/h1/h2` | i8/i16/i16 | eye and hex coordinates |
| `columns.az`, `columns.el` | f32 | radians; az 0 = forward, + = right; el + = up (`R/app/src/eye/ommatidia.ts:5-8`) |

Columns: 879 left, 892 right; azimuth ±6°…±159°, elevation ±80°, 5° spacing centred at
±80° (`extract_v2.py:206`). Loader `graph.ts:115-149`; CSR by post unit
`graph.ts:60-82`. Roles (`extract_v2.py:116-132`, counts from `bench/overlap.mjs`):
optic 63,963 · input 1,114 (LPTCs + LC4/LPLC2) · brain 300 (one-hop relays input→DN) ·
dn 41 (DNg02 a–g, DNp01–06) · vnc 298 (one-hop relays DN→MN) · output 83 (MaleCNS
`subclass ∈ {wm, hm}`, `extract_v2.py:86`).

### 2.2 Rate model and parameters

`R/app/src/brain/rate-net.ts:53-70` and the WGSL twin `R/app/src/brain/gpu-net.ts:59-80`:

```
τ_i dx_i/dt = −x_i + wScale · Σ_j w_ji r_j + ext_i + bias_i      (forward Euler, gpu-net.ts:76)
r_i = clamp(x_i, 0, rMax)
```

- `netDt = 4 ms`, `rMax = 5`, `wScale = 1` (`R/app/src/brain/optic.ts:89-95`).
- Weights `R/app/src/brain/flyvis.ts:71-105`: for the 1,545 fitted type pairs
  `w = count · sign · strength`; otherwise `count · sign · scale` with `scale = 0.001` onto
  pooling cells (role `input` or `LPi*`, `flyvis.ts:62-64`) and `0.02` elsewhere
  (`optic.ts:82-83`).
- Per-type τ and bias for 93 types from `D/fitted-params.json` (e.g. τ L1 28.7 ms, Mi1
  4.9, Mi4 146, Mi9 5.0, T4a 16.6, HSE 46.8, LC4 4.9 ms). Types without fitted parameters
  keep the extractor's τ (`extract_v2.py:60-67`) and get a homeostatic bias
  (`optic.ts:284-302`, `net.worker.ts:88-116`). DNg02 and the VNC run unbiased except for
  `dnBias = 0.5` on DNg02 (`optic.ts:54,86,346-347`).
- GPU backend: two dispatches per step, `drive` (64-edge chunks, `gpu-net.ts:34-57`) and
  `integrate`; 0.86 ms per step on an M-series GPU; `pendingDt` capped at 0.1 s
  (`gpu-net.ts:137,249`); readback lags one to two frames.

### 2.3 Sensory input: eye → photoreceptor → lamina

- Eye (`R/app/src/eye/eye.ts`): six 90° cameras, 48 × 48 px each, parented to the level
  `flyRoot` (yaw only; the body banks separately, `R/app/src/world/scene.ts:19`,
  `R/app/src/world/fly.ts:74-80`); the fly's own meshes are on layer 1 and invisible to it
  (`eye.ts:53`). Per ommatidium a `(face, pixel)` is precomputed (`eye.ts:68-89`); luminance =
  Rec.709 of the 8-bit readback (`eye.ts:114`). One ommatidium per column
  (`ommatidia.ts:37-50`).
- Photoreceptor + lamina (`optic.ts:351-375`): per column, Weber adaptation
  `stim = min(1.5, 0.5·lum / runningMean)` (τ = 1 s), virtual R cell
  `τ dV/dt = −V + 0.776 + 0.99·stim` (τ = 19.6 ms), `r = relu(V)`, then
  `ext[L1] = −1.657·r`, `ext[L2] = −1.617·r`, `ext[L3] = −0.314·r`
  (`D/fitted-params.json photoreceptor.laminaInput`). **There are no photoreceptor units in
  the graph** (`extract_v2.py:41-42`). Sensory input by body ID = the 5,327 lamina cells
  (2,650 L, 2,677 R; lists in `bench/out/recon-ids.json` as `A.lamina.L/R`).
- Tonic `ext` (`optic.ts:336-348`): grey-level lamina drive at rest, `lptcBias = 0.2` on
  non-fitted LPTC types, `dnBias = 0.5` on DNg02.

### 2.4 Readouts by body ID

Body IDs and [B] indices for the small groups; full lists in `bench/out/recon-ids.json`.

| readout | cells | body IDs | used where |
| --- | --- | --- | --- |
| HS left | HSE, HSN, HSS | 10034@26, 10181@163, 10419@386 | optomotor turn, `optic.ts:454-459` |
| HS right | HSN, HSE, HSS | 10015@10, 10016@11, 10023@17 | same |
| LC4 | 71 L, 55 R | `A.LC4.L/R` | looming, top-5 per eye, `optic.ts:407-408,423-443` |
| LPLC2 | 94 L, 91 R | `A.LPLC2.L/R` | same |
| DNg02 | 15 L, 14 R (a–g) | `A.DNg02.L/R` | telemetry; optional readout `"dng02"` |
| DNp01–06 | 12 | 10001, 10010, 10117, 10197, 10228, 10584, 10752, 10989, 11020, 11137, 524001, 531898 | telemetry `dnp` |
| wing MNs | 33 L, 34 R | `A.wingMN.L/R` | HUD group `MN` only |
| haltere MNs | 8 L, 8 R | `A.haltereMN.L/R` | same |

The HUD (`R/app/src/ui/hud.ts`) shows per-column luminance or T4a − T4b, a heat strip of
`optic.groups` (`optic.ts:252-283`: L1, Mi1/4/9, T4a–d, T5a/b, LPi, HS, VS, LC4, LPLC2, DNp,
DNg02, MN) and the telemetry block (`optic.ts:479-518`: `hsL/hsR`, `dng02L/R`, `lc4L/R`,
`lplc2L/R`, `loomL/R`, `dnp`).

### 2.5 Motor map

`optic.ts:396-420`: each side's HS deviation from its warm-up rest, relative to rest
(`dL = gainL·(hsL − offsetL)/(offsetL + 0.2)`), `turn = clamp(−0.25·(dL − dR) + 5·(loomL −
loomR + 0.5·min(loomL, loomR)), ±0.5)`, `left = 0.5 − brake + turn/2`, `right = 0.5 − brake −
turn/2`. `R/app/src/motor/wings.ts:39-48`: `thrust = 6·(mean − 0.5)`, `yawTorque = −16·diff`,
`bank = −diff`, `sideForce = 8·diff`. Rigid body `R/app/src/world/fly.ts:54-67` (yaw damping
4, drag 1.5, altitude fixed at 2, max speed 6), 1 ms substeps (`R/app/src/main.ts:450-457`).
Per-side gains come from a drum calibration (`main.ts:240-315`) after a 2.5 s warm-up.

### 2.6 The DNg02 hop (from `R/data/README.md`, confirmed by `bench/edges.mjs`)

No direct LPTC → DNg02 synapses; the route is HS → posterior slope (PS080 GABAergic, PS126,
PS311) → DNg02, and DNg02 → wing MN output is bilateral. In [A], DNg02 receives 1,629
synapses from inside the subgraph and **33,578 from cells [A] does not contain** (95%);
wing MNs 81% external, haltere MNs 93%, DNp 52%, whereas HS gets 94% of its input inside [A]
(`bench/out/edges.json`). That is why the steering readout had to stay at HS, and why the
bridge into [B] is the right way to reach DNg02 and the MNs.

## 3. The seam (Q5)

### 3.1 Units — `bench/overlap.mjs`

| | |
| --- | --- |
| [A] units found in [B] by body ID | **65,799 / 65,799 (100%)** |
| per role | optic 63,963, input 1,114, brain 300, dn 41, vnc 298, output 83 — all 100% |
| type name agrees | 65,793 / 65,799 (the 6 others are untyped in both, labelled `untyped_*` in [A]) |
| side agrees | 65,799 / 65,799 |
| readout populations identical in both graphs | HS 6, LC4 126, LPLC2 185, DNg02 29, DNp01–06 12 |

### 3.2 Edges — `bench/edges.mjs`

| | |
| --- | --- |
| [A] edges present in [B] | **1,967,771 / 1,967,771 (100%)** |
| identical synapse count | 1,967,771 / 1,967,771; Σ = 13,444,332 in both |

Both were cut from the same `minconf-0.5` weight table; [A] additionally drops edges below
2 (optic) / 5 (central) synapses and cells outside its seed set. So [B] ⊇ [A] exactly, and
"the same neuron by body ID exists in both graphs" holds with no exceptions.

### 3.3 What [B] adds onto [A]'s cells

Incoming synapses onto [A] populations, split by whether the presynaptic cell is in [A]:

| group | cells | from [A] | from [B]∖[A] | outside share |
| --- | --- | --- | --- | --- |
| HS | 6 | 97,542 | 6,242 | 6.0% |
| LC4 | 126 | 202,101 | 103,472 | 33.9% |
| LPLC2 | 185 | 258,994 | 92,440 | 26.3% |
| DNp01–06 | 12 | 69,731 | 75,902 | 52.1% |
| DNg02 | 29 | 1,629 | 33,578 | 95.4% |
| T4/T5 | 13,580 | 2,406,324 | 735,593 | 23.4% |
| lamina L1–3 | 5,327 | 422,826 | 539,774 | 56.1% (photoreceptors, absent in [A]) |
| wing MNs | 67 | 113,167 | 491,356 | 81.3% |
| haltere MNs | 16 | 4,260 | 57,300 | 93.1% |
| brain bridge | 300 | 401,413 | 874,486 | 68.5% |
| VNC bridge | 298 | 86,214 | 626,330 | 87.9% |

### 3.4 Conventions that differ

| | [A] AbijahKaj | [B] Xenova |
| --- | --- | --- |
| histamine sign | −1 | 0 (7,891 cells, incl. photoreceptors and T1, never transmit) |
| amines | 0 | +1 (set at load) |
| edge threshold | ≥ 2 optic / ≥ 5 central | none |
| time step | 4 ms Euler, rate units | 0.1 ms, spikes |
| external input | additive `ext` | Poisson rate clamp |
| index ↔ body ID | `units.bodyId` array | row order of `neurons.json.gz` |

## 4. One network or two (Q6)

Two. The update rules are incompatible, the fitted parameters only mean something inside
[A]'s equation, [A] has hand-written pieces [B] cannot host (photoreceptors, lamina input
weights, pooling scale, tonic drives), and [B] has the central brain, VNC and sensory cells
[A] lacks. §3 shows the join costs nothing. Recorded in `DECISIONS.md`.

## 5. Populations for Phases 4–5 (from the annotation table)

the MaleCNS annotation table (`packages.annotations` in the flake, SHA-256 from Xenova's manifest) carries
what neither graph does: `subclass`, `somaNeuromere`, `exitNerve`, `class`. Every motor and
haltere-sensory cell below exists in [B]. Tables: `bench/out/motor-neurons.json` (815 rows),
`bench/out/haltere-sensory.json` (205 rows).

| MaleCNS `vnc_motor` subclass | cells | note |
| --- | --- | --- |
| `fl` / `ml` / `hl` (leg) | 135 / 116 / 130 | somaNeuromere T1 / T2 / T3, side L/R: fl 68+67, ml 58+58, hl 66+64 |
| `wm` (wing) | 67 | = [A]'s wing MNs exactly (name-based split 67/67 correct) |
| `hm` (haltere) | 16 | = [A]'s haltere MNs exactly (16/16) |
| `nm` (neck) | 24 | |
| `ad` (abdominal) | 214 | |
| `xm` | 6 | |
| `cb_motor` | 107 | proboscis/pharynx `pm` 67, neck `nm` 20, antenna `am` 13, `rm` 7 |

Leg MN types are muscle names (`Ti flexor MN`, `Tr extensor MN`, `Fe reductor MN`, …), so
Phase 4's "MN group → joint torque" map can be generated from `type × somaNeuromere ×
somaSide`. Haltere sensory: `subclass = haltere`, 56 `vnc_sensory` + 149 `sensory_ascending`
(Phase 5's haltere proxy has a target). Also present: `campaniform sensilla` 175,
`chordotonal organ` 403, `hair plate` 112, `leg` 858 + `leg bristle` 688 proprioceptive/tactile
cells for the walking feedback.

## 6. Consequences for the next phases

- **Phase 1 `inject`:** add an additive-current buffer to both backends (§1.3, option 2);
  keep the Poisson `rates` buffer for painting and regression. The GPU-vs-CPU check in
  `worker.js:64-71` is the test harness for free.
- **Phase 1 `rates(bodyIds)`:** batch the LIF at 40 ticks (4 ms) so one [B] batch equals one
  [A] substep; EMA the per-batch counts with τ ≈ 20 ms.
- **Phase 3 bridge:** injection set = HS (6), LC4 (126), LPLC2 (185), DNp (12), later all
  role-`input` cells (1,114). Do **not** inject DNg02 or MNs — [B] computes those from the
  circuitry [A] lacks (§3.3). Index translation is `Map(bodyId → B index)` built once.
  If both nets share one `GPUDevice`, the rate → current copy can be a 1,329-element gather
  kernel with no host round trip.
- **Phase 4:** wing readout = `wm` 67 + DNg02 29 from [B]; leg readout = 381 leg MNs by
  neuromere × side from `bench/out/motor-neurons.json`.
- **Phase 5:** haltere proxy targets 205 haltere sensory cells; walking proprioception has
  ~2,200 leg sensory cells to choose from.
- **Sign convention:** decide in Phase 3 whether [B] keeps histamine at 0 (Shiu/Xenova
  convention). It only affects [B]'s own optic lobe and T1, neither of which is on the bridge
  path.

## 7. Environment

| | this VM | GPU box (`user@gpu-box`) |
| --- | --- | --- |
| GPU | virtio, no Vulkan, **no WebGPU** | RTX 3070 8 GB, driver 610.57, Vulkan OK |
| CPU / RAM | 4 cores / 7 GB | i9-12900 24 threads / 31 GB |
| Node / npm | 25.9 / 11.13 | 26.7 / 12.0 |
| git / git-lfs | 2.54 / 3.8.0 (user-local) | 2.55 / 3.7.1 |
| browsers | none | Brave (Chromium ⇒ WebGPU), Firefox; no graphical session |
| Python | from the Nix devShell (pyarrow, pandas) | same |

CPU-only benches (`bench/*.mjs`) run here; anything that touches WebGPU (Phase 1 onward)
runs on the GPU box, headless Brave with `--enable-unsafe-webgpu --use-angle=vulkan` or via
SSH port-forwarded Vite for the interactive demo.
