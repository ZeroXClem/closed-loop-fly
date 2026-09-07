# Decisions

Append-only log. Newest at the bottom. Each entry: date, decision, why, what it rules out.

## 2026-09-06 — Repo lives in `closedloopfly/`, not a new `closed-loop-fly/`

GOAL.md says "fresh repo `closed-loop-fly/`". The directory this plan was dropped into is
`closedloopfly/`. Same thing; initialised git here rather than nesting a second repo.

## 2026-09-06 — Three submodules, not two

Xenova's simulation is not on GitHub; it is the Hugging Face Space
`Xenova/fruit-fly-simulation` (git + LFS). AbijahKaj's code is on GitHub but the graph and
fitted parameters are also published as the HF model repo `AbijahKaj/fruit-fly-brain`. All
three are vendored:

| path | upstream | why |
| --- | --- | --- |
| `vendor/fruit-fly-simulation` | HF Space Xenova/fruit-fly-simulation | full graph, LIF kernel, body, UI |
| `vendor/fruit-fly-brain-research` | GitHub AbijahKaj/fruit-fly-brain-research | eye, rate net, extraction and trainer source |
| `vendor/fruit-fly-brain` | HF model AbijahKaj/fruit-fly-brain | the same graph + params as the research repo's `app/public/graphs/`, but versioned as a data release |

The research repo already carries `optic-v2.bin` (25 MB) in git, so the HF data repo is
redundant today. It is kept because it is the artifact AbijahKaj will re-publish when the fit
changes, and because loading data from `vendor/fruit-fly-brain/` decouples us from the app's
directory layout.

LFS: `git-lfs` was not installed and there is no root on this box. The 3.8.0 binary was put
in `~/.local/bin` and registered with `git lfs install --skip-repo`. The Xenova Space carries
a full copy of every asset under both `public/` and `dist/`; the submodule's config sets
`lfs.fetchexclude = dist/**` so only `public/` blobs are pulled (83 MB instead of 167 MB).

## 2026-09-06 — Two networks, not one (Phase 0 question 3)

Run both: [A] AbijahKaj's fitted rate model on the 65.8k optic-v2 subgraph, and [B] Xenova's
unfitted LIF on the full 166.7k graph, joined by body ID.

Why not one network:

- The two update rules are incompatible. [A] is `τ dx/dt = −x + wScale·Σ w r + I_ext + bias`
  with per-type τ (10–60 ms), per-pair strengths and a clamp; [B] is a 0.1 ms-tick LIF with a
  single 0.275 mV synapse weight, 1.8 ms delay, 2.2 ms refractory. The fitted parameters of
  [A] only mean something inside [A]'s equation.
- [A] contains hand-written pieces [B] cannot host: virtual photoreceptors with Weber
  adaptation, the lamina-input weights, the pooling-cell input scale, the tonic DNg02 drive.
- [B] has the cells [A] lacks: the central brain, the leg VNC, all leg/neck/abdominal motor
  neurons, haltere and leg sensory neurons.
- `bench/overlap.mjs` shows every [A] unit and every [A] edge exists in [B], so the bridge
  needs no invented cells: [A]'s rate for body ID *b* becomes external input to [B]'s
  neuron *b*.

What this rules out: refitting [B] (out of scope, GOAL.md), or transplanting [A]'s
parameters into [B]'s LIF.

## 2026-09-06 — Inject, don't clamp (recorded now, implemented in Phase 3)

[A]'s rate enters [B] as external current on the same body ID; [B]'s own optic lobe keeps
running. Reasons: [B]'s central brain then still sees the LIF version of the lobe; bridge
on/off is an A/B test with nothing else changed; clamping would silence [B]'s recurrent
input onto those cells, which is a different network. The one open question is *which*
external-input path in [B] to use; see `docs/recon.md` §2.4 for the two candidates.

## 2026-09-06 — Wing vs haltere motor neurons are classified by name, for now

Neither graph carries MaleCNS `subclass` (`wm` / `hm`), which is what AbijahKaj's extractor
used to pick the 83 output cells. `bench/overlap.mjs` splits them by MANC muscle
nomenclature (haltere = `hDVM`, `hi1`, `hi2`, `hiii2`, `MNhm*`; the rest are wing). The
annotation table (`data/raw/body-annotations.feather`, SHA-256 verified) is the ground truth
and Phase 4's leg-MN readout will be generated from it, not from type-name regexes.

## 2026-09-06 — The bridge set must include DNg02 and the wing MNs, not just HS/LC

`bench/edges.mjs` counts, for each [A] readout population, how many of its input synapses in
[B] come from cells that are *not* in [A]:

| population | synapses from inside [A] | from the rest of [B] | outside share |
| --- | --- | --- | --- |
| HS (6) | 97,542 | 6,242 | 6% |
| LC4 (126) | 202,101 | 103,472 | 34% |
| LPLC2 (185) | 258,994 | 92,440 | 26% |
| DNp01–06 (12) | 69,731 | 75,902 | 52% |
| DNg02 (29) | 1,629 | 33,578 | **95%** |
| wing MNs (67) | 113,167 | 491,356 | **81%** |
| haltere MNs (16) | 4,260 | 57,300 | 93% |

So [A] is a faithful optic lobe (HS sees 94% of its real input) but its DNg02 and motor
neurons are nearly disconnected stubs, which is exactly AbijahKaj's "DNg02 sits at a constant
rate" finding. The plan's bridge (inject [A]'s HS / LC4 / LPLC2 / DNp rates into [B], read
DNg02 and MNs from [B]) is therefore the right shape: the descending and motor circuitry is
read from the graph that actually contains it. Bridge cells are the *inputs* to that
circuitry, never DNg02 or the MNs themselves.

## 2026-09-06 — Nix: dist is pure, the GPU bench is impure by design

`flake.nix` wraps the repo. What is pure and what is not:

| | how | pure? |
| --- | --- | --- |
| `packages.default` (`dist/`) | `buildNpmPackage`, npm deps by hash (`nix/npm-deps-hash`), every large data asset by SHA-256 (`nix/assets.nix`, generated from the git-lfs oids and Xenova's manifest), `vite build` offline | yes |
| `packages.annotations` | fixed-output `fetchurl` of the MaleCNS annotation table | yes |
| `devShells.default` | node ≥ 22.12, git-lfs, rsync, python with pyarrow + pandas; `$MALECNS_ANNOTATIONS` points into the store | yes |
| CPU benches (`npm run bench*`) | `nix develop -c node …` | yes (given the vendored data) |
| `bench/browser.mjs`, `npm run dev` with WebGPU | the **host's** Brave and NVIDIA Vulkan driver; nothing GPU-related is packaged | **no** |

Why the GPU side is impure: gpu-box is Arch with the proprietary NVIDIA driver. Packaging a
browser or Vulkan in Nix on a non-NixOS host means fighting the driver ICD and glibc (nixGL
territory) for no scientific gain; the numbers come from the host stack and are recorded as
such. The devShell warns when `brave` or `vulkaninfo` are not on PATH so CPU-only machines
(the dev VM) still run everything else; `bench/lib/browser.mjs` fails with a clear message.

Consequences: `data/raw/` and the Python venv are gone (the table is a store path; the Python
env is the devShell's). `nix build` needs `'.?submodules=1'` because the vendored trees are
git submodules. `scripts/gpu-box.sh run` executes remote commands inside `nix develop`.

## 2026-09-06 — Upstreams are flake inputs as well as submodules; the devShell restores XDG dirs

Two things learned wrapping the repo:

- `nix build '.?submodules=1'` on Nix 2.23 handed the derivation a source tree with empty
  `vendor/` directories while `nix eval` of the same ref showed them populated. Rather than
  depend on that, the three upstreams are also **non-flake inputs pinned by rev** (the HF Space
  and HF model repo over `git+https`, the research repo from GitHub). The build assembles
  `vendor/` from them and overlays the fixed-output data. `scripts/check-pins.sh` fails if a
  submodule and its input drift. `nix build .` now works from any checkout, no git-lfs.
- `mkShell` sets `XDG_DATA_DIRS` to store paths only, so inside `nix develop` the host Vulkan
  loader no longer searches `/usr/share/vulkan/icd.d` and `vulkaninfo` reports "Found no
  drivers". The shellHook appends `/usr/local/share:/usr/share` (and `/etc/xdg`) back. This
  is the one place the impure GPU path touches the shell.

## 2026-09-07 — Phase 1: additive current, not a Poisson rate, is the injection primitive

`brain.inject()` adds a per-neuron current to `v` every tick (kick = I·dt, mV per tick), in
both the JavaScript and WGSL kernels at the same point of the update (after the Poisson kick,
before reset, float32 adds in the same order). Xenova's existing `rates` path was kept
untouched for painting regression (`?stimulus=poisson`) and for the bridge's A/B.

Why not reuse `rates`: it forces one spike per event (68.75 mV kicks) and removes the
refractory period, so it is a rate clamp, and the bridge is specified as "inject, don't
clamp". Painted pulses in Hz reach the new path through `rateToCurrent()`, the current at
which an isolated LIF fires at that rate; it reproduces the Fly preset (docs/phase1.md).

Verification: Xenova's CPU-vs-GPU fixture extended with current (exact match), a full-graph
parity bench (identical for 36 ms, then float-order chaos with matched statistics), and the
Fly preset on both backends.

## 2026-09-07 — Host quirks handled in code, recorded here, not hidden

- Vite dev server: `/data/*.gz` served as stored bytes (`vite.config.js`), else the app's own
  gunzip fails.
- `navigator.gpu.requestAdapter` shim in `src/worker.js`: retry without `powerPreference`
  when the high-performance request returns null (Brave 151 + NVIDIA 610 under the flags in
  `bench/lib/browser.mjs`).
- Dawn adapter blocklist off, Skia-Vulkan on, no Vulkan surface: the only headless
  configuration that yields the RTX 3070 (`bench/webgpu-probe.mjs` documents the search).

## 2026-09-07 — Phase 2: the eye is AbijahKaj's, ported, not reinterpreted

- The column directions are taken verbatim from their graph (`src/eye/columns.json`,
  generated by `scripts/gen-columns.mjs`; 879 left, 892 right, 1,771 total — GOAL.md's
  "1,771 per eye" is a slip). Nothing is recomputed from Mi9→Mi4 offsets here.
- The photoreceptor stage runs what their fitted parameters were trained with: divisive
  (Weber) adaptation against a 1 s running mean, then a first-order low-pass with the fitted
  photoreceptor τ (19.6 ms), rectified. GOAL.md's "log-luminance, high-pass in time" is the
  same idea in different words; implementing it literally would move the network off the
  operating point the fit assumed. `src/eye/photoreceptor.js` documents the equations.
- The eye's output is luminance per column and photoreceptor output per column, per eye
  (`Float32Array(879)` + `Float32Array(892)`), as `EyeInput` upstream. The lamina weights
  (R → L1/L2/L3) belong to Phase 3's network, not to the eye.
- The eye hangs on the level `flyRoot` (position + yaw), never on the banking body: their
  finding that a banked eye collapses both HS sides and locks the loop in a spin.
- The test world is a port of theirs with the same seeds, textures and geometry so their
  tuning transfers; the cartoon fly stays until Phase 4 swaps in Xenova's body.
- Bench columns are amplitude-gated: an equatorial column looking at a pillar carries no
  stripe signal, and unwrapping phase across it is meaningless.

## 2026-09-07 — The closed loop runs headed under Xvfb on the GPU box

Headless Brave cannot hold a WebGL context and a hardware WebGPU adapter in one page: the
Skia-Vulkan flags Dawn needs lose every WebGL context at page start, and without them Dawn
returns SwiftShader. With an X display (Xvfb is enough) and `--disable-vulkan-surface`
dropped, both live: eye at about 1 ms per frame on WebGL, net on the RTX 3070 via WebGPU
(`bench/lib/browser.mjs` `launchCombinedBrowser`, `scripts/gpu-box.sh runx`). WebGL-only
benches stay headless on plain ANGLE/Vulkan; WebGPU-only benches stay headless on the Phase 1
set. Still impure, still host Brave + host driver; nothing packaged.

Also: the first `requestAdapter` in a fresh GPU process fails while Dawn initialises, and a
plain first request locks in SwiftShader (`bench/webgpu-retry-probe.mjs`). The worker's shim
now retries the same `high-performance` request before relaxing it.

## 2026-09-07 — Phase 3: what is bridged, what is held, what is hand-set

- **Bridge set = HS, LC4, LPLC2 (317 cells), option `inputs` = every LPTC and looming LC
  (1,114).** Not DNp, not DNg02, not motor neurons: in [A] those are stubs (DNp sits at the
  rate ceiling at rest because its central-brain inputs run unfitted), and Phase 0 showed [B]
  holds 81–95% of their real input. `[A].r − rest` (rest captured after the 2.5 s warm-up)
  times `bridgeGain · typeGain` becomes current (mV/ms) on the same body ID in [B].
- **[A] stays on the CPU** (their worker-fallback path, 27–38 ms per 16.7 ms frame). Their
  WGSL kernel is two small dispatches and the shared `GPUDevice` is at hand; porting it is
  Phase 5 performance work, after correctness.
- **Rate hold per frame.** Per-substep coupling costs one GPU fence per 4 ms; headed under
  Xvfb a fence is ~45 ms, so a frame took 213 ms (0.08×). With the injected current held at
  [A]'s end-of-frame rates and one [B] batch of 160 ticks per frame, one fence per frame.
  GOAL.md names this as the first fix below 0.3×.
- **Tonic DNg02 drive (`dnBias`, mV/ms on [B]'s 29 DNg02 cells through the inject API).**
  `bench/paths.mjs` shows why it is needed: in [B] there are zero direct HS → DNg02 synapses;
  the route is HSS/HSN → PS080 (GABAergic, 112–168 synapses) → contralateral DNg02 (152–172
  synapses spread over 14–15 cells). Inhibition can only lateralise a DNg02 that is already
  firing. In the animal that drive comes from ascending neurons (AN07B004, the top excitatory
  input) and the rest of the flight circuit; here it is one constant, the same trick as
  AbijahKaj's `dnBias`, and the loudest hand-written number in the model. Its size is a
  threshold problem: ~10 synapses × 0.275 mV per DNg02 cell of PS080 inhibition is worth
  about 1.4 mV mean, so DNg02 lateralises only when the tonic drive keeps it within a few mV
  of threshold.
- **Xenova's stimulus path stays live** in the loop worker: painting still injects, and the
  Phase 1 A/B (`?stimulus=poisson`) still works.

## 2026-09-07 — Phase 4: DNg02 code with the published sign; DNa02 noted, not used

`src/motor/readout.js` turns [B]'s DNg02 L/R into wing amplitudes with the Namiki 2022
population code and no fitted sign (the wiring's PS080 route and the published
contralateral-amplitude effect agree on the optomotor direction). `bench/paths.mjs` also
shows HSS → DNa02 directly (36–47 synapses), and in the bridge runs [B]'s DNa02 lateralises
far more than DNg02. DNa02 is Xenova's walking-turn channel and a walking DN in the
literature, so it stays out of the flight readout; it is the obvious signal for the walking
readout when the leg VNC is driven.

## 2026-09-07 — Phase 5: what "closing the loop" means here, and the haltere proxy

- The loop was closed the moment Phase 4 applied forces: the eye hangs on the body's root,
  so the next frame's image already comes from the new pose. Scene time advances in fixed
  1/60 s frames gated on the worker (4 ms neural substeps inside), which is the "fixed
  substep, render at vsync" split without a SharedArrayBuffer: at 0.17× realtime a
  free-running renderer would only show stale frames, and gating makes every bench
  deterministic. A free-running mode is a UI nicety for later, not a scientific step.
- Wobble mitigations in GOAL.md's order: (1) the motor lag exists (`motorTau` 50 ms);
  (2) a gain schedule was not needed to hover; (3) the haltere proxy is implemented: the
  body's yaw rate becomes current on [B]'s 205 haltere afferents (`src/bridge/haltere-ids.json`,
  sided by `rootSide`, all entering through DMetaN), left afferents for leftward rotation,
  right for rightward, gain 2 mV/ms per rad/s, capped at 3. Whether the wiring turns that
  into a corrective wing asymmetry is measured, not assumed (`bench/cruise.mjs`, haltere
  off vs on).
- Walking proprioception (leg joint angles → leg sensory neurons) is not built: nothing
  drives the leg VNC yet (docs/phase4.md), so there is no joint angle to feed back.

## 2026-09-07 — Phase 6: ablations are currents, not edge deletions

The ablation primitive is the worker's `mute` message: a −50 mV/ms current on every neuron
of the chosen superclasses (or body IDs) through the existing inject path. That silences
them completely (the LIF cannot climb 7 mV against 1,000 mV/s) without new kernel code, and
it composes with the bridge, the haltere proxy and Xenova's `silenced` flag (recurrent
transmission off). A silenced cell still exists: its incoming synapses are wasted, its
outgoing ones never fire. "Neck connective cut" is therefore "descending neurons silenced",
and "decapitated" is "everything in the brain silenced"; both are recorded as such in
`docs/ablations.md`.

## 2026-09-07 — The haltere proxy's sign is empirical, and it matters thirtyfold

`bench/cruise.mjs`: with the proxy driving the left haltere afferents for leftward rotation
the loop spins at 2 rad/s (positive feedback); with the mirrored convention the 30 s drift
falls from 1,064° to 35° and the wobble halves. So the connectome path from the 205 haltere
afferents to the wing motor opposes rotation for one sign of the input and reinforces it for
the other. The proxy ships with the corrective sign (−1) and says so; the real haltere's
Coriolis encoding is not modelled. Drift stays above GOAL.md's 20°.
