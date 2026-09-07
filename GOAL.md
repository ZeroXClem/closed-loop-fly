# Closed-Loop Fly — Claude Code Build Plan

Goal: turn Xenova's `fruit-fly-simulation` (paint-to-stimulate, open loop, scripted motion)
into a sensorimotor loop where **rendered images drive the optic lobe, the wiring drives
the VNC, motor-neuron rates drive the body, and the body's new pose drives the next frame's
image.** No paintbrush, no lookup table, no `controller.js` deciding what "turn left" means.

Two upstream repos, deliberately combined — they solve different halves:

| | Xenova `fruit-fly-simulation` | AbijahKaj `fruit-fly-brain-research` |
|---|---|---|
| Graph | full MaleCNS, 166,700 units, 25.6M edges | optic-v2 subgraph, 65.8k units, 1.97M edges |
| Dynamics | LIF (Shiu 2024) — un-refit for MaleCNS | rate model, per-type τ/bias fitted on RTX 5090 |
| Sensory input | painted stimulation (LC9/LC4/DNa02 presets) | real: 6-face cube render → 1,771 column directions → lamina |
| Motor output | `controller.js` maps a few rates → scripted gait/flight | DNg02 population code → wing amp L/R → yaw/bank |
| Body | NeuroMechFly skeleton, IK tripod gait, Three.js | rigid-body cartoon fly, no legs |
| Feedback | none — body motion does not re-enter the net | closed: pose → eye |
| Runtime | `@huggingface/kernels`, sparse WGSL propagate | own WebGPU compute + worker fallback |

The plan: **AbijahKaj's eye + fitted optic lobe becomes the front end; Xenova's full graph +
body becomes the back end; the join happens at MaleCNS body IDs.** Nothing is invented at the
seam — the same neuron (by body ID) exists in both graphs.

---

## Ground rules for Claude Code

- Work in a fresh repo `closed-loop-fly/`. Vendor both upstreams as git submodules under
  `vendor/`; never edit them in place. All new code in `src/`.
- Keep Xenova's stack: vanilla JS, Vite, Three.js, `@huggingface/kernels`. AbijahKaj's app is
  TypeScript — port the *pieces we take* (eye sampler, graph loader, rate-net kernel) into
  `src/`, don't try to merge two build systems.
- Every phase ends with a runnable `npm run dev` and a `bench/` script that prints numbers.
  No phase is "done" on vibes. Acceptance criteria are listed per phase.
- Data: MaleCNS is CC-BY 4.0. Pull nothing from the EM volume. Reuse the derived graph files
  from `AbijahKaj/fruit-fly-brain` on HF and the gzipped bins in Xenova's `public/data/`.
  Write a `DATA-LICENSE.md` on day one.
- Licenses: MIT app code, keep every upstream NOTICE. Credit both authors in README.
- Log design decisions to `DECISIONS.md` as you go. Future-me and Bubba read these.

---

## Phase 0 — Reconnaissance (½ day)

1. Clone both. Read fully, in this order:
   - Xenova: `public/model.json`, `src/brain.js`, `src/brain-gpu.js`,
     `src/propagate-sparse.wgsl`, `src/stimulus.js`, `src/controller.js`, `src/worker.js`,
     `src/data-loader.js`.
   - AbijahKaj: `app/README.md`, `app/src/brain/rate-net.ts`, the eye/cube-map sampler,
     the HUD's HS/LC/DNg02 readout, `data/README.md` (DNg02 hop findings),
     `train/README.md`.
2. Produce `docs/recon.md` answering, with file:line refs:
   - How Xenova indexes neurons (array index ↔ MaleCNS body ID mapping — where is it?).
   - Xenova's LIF equation, dt, weight scaling, refractory handling, and how "pulse" injects
     external current per neuron. We need a per-neuron `I_ext` input path.
   - Which output rates `controller.js` reads today, and from which body IDs.
   - AbijahKaj's graph JSON schema; which units are sensory input (lamina/R1-R6 proxies) and
     which are readout (HS, LC4, LPLC2, DNg02, DNp, wing/haltere MNs) — by body ID.
   - Overlap: what fraction of AbijahKaj's 65.8k body IDs exist in Xenova's 166.7k. (Expect ~all.)
3. Decide and record: **do we run one network or two?** Default answer is two (see Phase 3),
   because fitted rate dynamics and un-fitted LIF dynamics won't coexist in one update rule.

Acceptance: `docs/recon.md` exists, all questions answered with refs, overlap number printed
by `bench/overlap.mjs`.

## Phase 1 — Skeleton: Xenova's sim runs from our repo (½ day)

- `src/` boots Xenova's demo unchanged, loading assets from `vendor/`. Same UI.
- Add an `I_ext` injection API to the worker: `brain.inject(Float32Array indexed by neuron)`
  applied every substep, replacing the pulse-envelope stimulus path (keep the old path behind a
  flag for regression).
- Add a rate readout API: `brain.rates(bodyIds[]) → Float32Array` (EMA of spikes, τ≈20 ms).

Acceptance: painting still works through the new `inject` path; `bench/inject.mjs` shows
LC4 stimulation via `inject` reproduces the old "Fly" behavior within tolerance.

## Phase 2 — The eye (1 day)

Port AbijahKaj's eye into `src/eye/`:
- Offscreen 6-face cube render of the Three.js scene from the fly's head pose.
- Sample at the connectome's **1,771 column directions per eye** (take their calibrated
  direction table; it's derived from T4 Mi9→Mi4 offsets — don't recompute).
- Photoreceptor front end: log-luminance, high-pass in time, per their app.
- Output: `Float32Array(1771 × 2)` per frame at ≥60 Hz.

Add a test world: striped drum, pillars, one approaching sphere (same as theirs, so their
tuning transfers). Fly starts hovering.

Acceptance: `bench/eye.mjs` renders a rotating drum and prints per-column temporal contrast;
a drum rotating right produces the expected rightward phase progression across columns.

## Phase 3 — Two-network bridge (2 days) ← the real work

Run **both** networks in the worker, same substep:

```
eye (1771×2) → [A] AbijahKaj optic-v2 rate net (65.8k, fitted)
                    ↓ rates at bridge body IDs
               [B] Xenova full LIF (166.7k) ← I_ext = gain · rate at those same body IDs
                    ↓ spike rates at VNC motor neurons
               body
```

- Port `rate-net.ts` to a WGSL kernel in `@huggingface/kernels` (or reuse their WebGPU
  shader) so both nets share one queue. If porting stalls, run [A] on their worker-fallback
  path first — correctness before speed.
- Bridge set (`src/bridge/ids.json`): start with the cells AbijahKaj already validated —
  HS (both), LC4, LPLC2, DNg02 population, DNp. Later expand to every optic-lobe output
  neuron with a fitted parameter.
- **Inject, don't clamp**: [A]'s rate becomes external current into [B]'s copy of the same
  neuron. [B]'s own recurrent optic lobe stays live; document in `DECISIONS.md` why (so [B]'s
  central brain still sees the LIF version of the lobe, and so we can A/B: bridge on/off).
- One global `bridgeGain` + per-type gain table. Expect to tune two or three globals before
  anything moves — AbijahKaj's README warns raw weights saturate; assume the same here.

Acceptance: `bench/bridge.mjs` — with the drum rotating, DNg02 L/R rates in [B] differ in
the direction AbijahKaj's HS readout predicts. Looming sphere → LC4/LPLC2 → DNp fires in [B].
Print DSI-like index at DNg02 for CW vs CCW drum; target > 0.3 on first pass.

## Phase 4 — Motor readout from the VNC (1–2 days)

Delete the semantics of `controller.js`. Replace with `src/motor/readout.js`:
- Flight: read **wing motor neurons + DNg02** from [B] (body IDs from AbijahKaj's extraction
  + MaleCNS annotation table). Population code → wing amplitude L/R → thrust / yaw / bank,
  exactly the Namiki 2022 mapping they use. This is the only hand-written map allowed, and it
  is a published one.
- Walking: read **leg motor neurons by leg + joint** from [B]'s VNC (annotation table:
  `class == "motor neuron"`, neuropil = T1/T2/T3 left/right). Map each MN group's rate to a
  joint torque target in Xenova's IK skeleton. Keep Xenova's tripod-gait generator as a
  fallback behind a flag; the goal is to make it unnecessary.
- Remove speed/turn "gains chosen for the demo" from the semantics path. Physical gains
  (rate → torque) stay, and are the tunables.

Acceptance: with the bridge on and no scripted actions, drum rotation makes the hovering fly
yaw with the drum (optomotor). Looming sphere makes it bank away. `bench/motor.mjs` logs
heading vs drum phase; correlation > 0.5.

## Phase 5 — Close the loop + stability (1–2 days)

- Body pose from Phase 4 feeds the eye in Phase 2 next frame. Fixed 4 ms neural substep,
  render at vsync, decouple via worker + SharedArrayBuffer.
- Expect the wobble AbijahKaj reports (~0.2 rad/s hover oscillation, 10–50° cruise drift).
  Mitigations to try, in order, logging each: (1) slower motor stage (first-order lag on wing
  amplitude), (2) gain schedule on `bridgeGain` vs. flight speed, (3) haltere proxy — inject
  angular-velocity-proportional current into haltere sensory neurons if they're in [B]
  (they are in MaleCNS; check `recon.md`).
- Add proprioceptive feedback for walking: leg joint angles → leg sensory neuron `I_ext`.
  Cheap, and it's the same principle: body state re-enters the graph.

Acceptance: 30 s autonomous cruise through the pillar course, zero collisions, heading drift
< 20°. Record a video to `docs/`.

## Phase 6 — Ablations (the point of the whole thing) (1 day)

Now the sim can answer questions instead of just looking good. Add a `bench/ablate.mjs`
that runs the pillar course under each condition and reports collisions + drift:

- bridge off (Xenova's raw LIF lobe only) — expect failure; this is the null.
- recurrent transmission in [B] off — does the VNC still produce a gait from DN drive alone?
- [B] central brain silenced (only optic lobe + VNC live) — reflex-only fly.
- haltere feedback off.
- neck connective cut (zero the edges brain→VNC) — the animal is decapitated; does the VNC
  CPG hold a rhythm?

Write results to `docs/ablations.md` with plots. This is the artifact worth posting.

---

## Performance budget

- Xenova's kernel already does 166.7k LIF at ~0.6× realtime on a laptop GPU. Adding [A]
  (~0.9 ms / 4 ms substep on their numbers) plus the eye render should keep us near that.
- If we drop below 0.3× realtime, first fix: run [A] at 4 ms and [B] at 2 ms with
  rate hold, not shrink the graph.
- Target hardware: 8 GB GPU. 25.6M edges in CSR at fp16 weights + int32 indices ≈ 150 MB.
  Fine.

## Out of scope (say no)

- Refitting Xenova's LIF parameters on MaleCNS. That's a PyTorch job on a 5090 and it's
  AbijahKaj's roadmap, not ours. We consume their fits.
- Aerodynamics, muscle models, MuJoCo. The body stays a cartoon until Phase 6 says the
  cartoon is the bottleneck.
- Odor, central-complex navigation, courtship. Reflexes only.

## Deliverables

- `closed-loop-fly/` repo, runs on `npm run dev`, deploys as a static HF Space.
- `docs/recon.md`, `DECISIONS.md`, `docs/ablations.md`, one video.
- A `bench/` folder where every claim in the README has a number next to it.
