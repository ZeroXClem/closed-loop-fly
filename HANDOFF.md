# HANDOFF — closed-loop-fly, as of 2026-09-07 evening (EDT)

For the next agent. Everything here was learned the hard way in one overnight session; the
phase docs carry the science, this file carries how to work. Read `README.md`, then this,
then `DECISIONS.md`. Every number quoted below lives in `bench/out/`.

## State in one paragraph

All six GOAL.md phases have been run once. What works: Xenova's LIF with an additive-current
inject API on both backends (Phase 1); AbijahKaj's eye and optic-v2 rate net ported and
reproducing their open-loop numbers (Phases 2–3); the bridge by body ID, with looming going
eye → LC4/LPLC2 → giant fiber in the full graph (Phase 3); a closed loop that flies the pillar
course with zero collisions (Phase 5); seven ablations (Phase 6). What does not: DNg02 never
lateralises in the un-refit LIF (DSI ≤ 0.08), so the published DNg02 flight code cannot steer
(Phase 4). The closed loop runs on a **labelled deviation**, the DNa02 readout. Heading drift
is 35° over 30 s against a 20° target. Throughput 0.17× realtime on the RTX 3070 (0.20× with
the rate net on the GPU, `?optic=gpu`).

**Evening follow-ups (docs/followups.md, all pushed; the thread is public):** the octopamine
cancellation story is dead (§1); the haltere proxy's 30× was an anti-spin clamp riding on the
readout treating a silent DNa02 pair as a turn (§2); with that artefact gated out (`?gate=1`,
default off) the intact loop drifts ~200° in 20 s and haltere-off −5°, so the loop has **no real
stabiliser** (§3); a biological tonic drive through AN07B004 storms the network (§4); the rate net
runs on the GPU with identical output (§5). Later the same evening (§6–7): a flight-state (octopamine)
gain on the LPTC synapses raises the drive and does not stabilise heading (one 9° run, replicates
at 175°; §6), and a potassium-like adaptation term in both LIFs stops the storms but mutes DNa02 and
DNg02 alike (§7). **The open problem is still a stabiliser**, and the two cheap ideas are now spent:
what is left is a real heading signal (the central complex, never read here) or a phase-encoded
haltere model onto the wing-steering MNs. Do not present the Phase 5/6 drift numbers without §3
next to them, and never quote a single closed-loop run: the loop is chaotic, one run is one sample
(§6 is the cautionary tale).

## Machines

| | dev VM (this checkout) | GPU box `user@gpu-box` |
| --- | --- | --- |
| GPU | virtio, no Vulkan; SwiftShader WebGL only | RTX 3070 8 GB, NVIDIA 610.57, Vulkan OK |
| Nix | 2.23, flakes on; `/etc/nix/nix.conf` lists `ssh-ng://user@gpu-box` as a substituter the daemon cannot reach → always run Nix with `NIX_CONFIG="substituters = https://cache.nixos.org"` (export it once per shell) | 2.35, flakes on, hive substituter |
| browsers | Brave (software GL works) | Brave 151 (WebGPU via flags), Firefox, Xvfb |
| agents | this Claude | `pi` (`pi -p "<prompt>"`, has sudo) |
| access | — | SSH key, BatchMode OK; **the SSH link periodically demands re-auth**: a hung ssh/rsync printing a login URL means ask the user to click it |

- **Real machine names are not in this repo.** `user@gpu-box` is a placeholder; the real
  host lives in the git-ignored `scripts/gpu-box.local` (`GPU_BOX_HOST=user@host`, sourced by
  `scripts/gpu-box.sh`) and in the agent memory notes outside the checkout.
- **Nightly poweroff on the GPU box**: `nightly-poweroff.timer` at 01:20 EDT. Do not `sudo`
  yourself (the auto-mode classifier blocks it and the user prefers you don't); ask pi:
  `ssh user@gpu-box 'pi -p "stop nightly-poweroff.timer; systemd-run --on-calendar=... a
  one-shot that starts nightly-poweroff.timer then nightly-poweroff.service"'`. On 2026-09-07
  pi created `clf-delayed-poweroff-2.timer` for 10:00 EDT. Check with
  `systemctl list-timers --all | grep poweroff`.
- In-app file cards (`SendUserFile`) returned 403 for everything this session. Deliver files
  by rsync/scp; the user has both machines.

## Workflow that works

- Source of truth is this checkout. The GPU box holds an rsync mirror at
  `~/projects/closedloopfly/`. `scripts/gpu-box.sh sync` mirrors (excludes node_modules,
  dist, result, `bench/out/`, `docs/*.webm`, and **deletes** anything else not present
  locally, so pull remote outputs before you sync). `run <cmd>` executes inside
  `nix develop`; `runx <cmd>` also under `xvfb-run` (needed whenever a page uses WebGL and
  WebGPU together, i.e. `loop.html`); `raw <cmd>` skips the devShell; `pull <path>` copies back.
- **Never edit `src/` while a local bench is running**: Vite hot-reloads the bench page and
  the run dies with "Execution context was destroyed". **Never sync to the GPU box mid-run**
  for the same reason. Bench outputs land in `bench/out/` on whichever machine ran them;
  rsync them back (`rsync -az user@gpu-box:projects/closedloopfly/bench/out/X.json bench/out/`).
- Long remote benches: run in the background and poll the task output file; pipe through
  `grep --line-buffered` on the remote side, and note that a plain `grep` on the local
  side of the ssh pipe block-buffers until exit (you see nothing until the end).
- `startVite()` in `bench/lib/browser.mjs` picks a random port, so benches can run side by side.
- CPU benches (overlap, edges, optic-settle, optic-drum, hs-inject, inject, paths) run here
  in seconds to minutes. Anything with `--gl software --backend cpu` also runs here (JS LIF,
  ~0.3× realtime while [B] is quiet, slower when it isn't). GPU truth comes from the GPU box.
- Scripts: `npm run bench:*` wraps `nix develop -c`; see `package.json`. `npm run dev`
  serves `index.html` (Xenova's paint demo on our worker), `eye.html`, `loop.html`.

## Repo map (what to touch for what)

| path | what |
| --- | --- |
| `src/worker.js` | the whole brain side: init (loads [B] Xenova graph + [A] optic-v2), messages `pulse`, `inject`, `watch`, `rates`, `bridge`, `frame`, `mute`, `parity`, `step`, `reset`; bridge pairs, tonic DNg02 drive, readout sets by body ID, per-frame rate hold; `requestAdapter` retry shim at the top |
| `src/brain/brain.js`, `brain-gpu.js`, `propagate-sparse.wgsl`, `gpu-check.js` | Xenova's LIF with the `kick` (mV per tick) buffer at binding 8; CPU and WGSL must stay in the same float order; parity fixture runs at every GPU start |
| `src/brain/inject.js` | rate ↔ current for an isolated LIF (θ 7 mV, τm 20 ms, refractory 2.2 ms); `kickFromRates` |
| `src/brain/rates.js` | EMA rate monitor (τ 20 ms) over batch counts |
| `src/brain/optic/` | AbijahKaj ports: `graph.js` (v2 loader, CSR by post), `params.js` (fitted params → weights), `rate-net.js` (Euler, CPU), `optic.js` (OpticBrain: photoreceptors → lamina, tonic drives, calibration offsets, readouts, LC receptive fields) |
| `src/eye/` | `columns.json` (1,771 column directions from the vendored graph; regenerate with `scripts/gen-columns.mjs`), `ommatidia.js`, `eye.js` (6×48² cube sampler), `photoreceptor.js` (Weber + fitted low-pass), `index.js`, `hud.js` |
| `src/world/` | drum arena, rigid-body fly, looming sphere (ports, same seeds as upstream) |
| `src/motor/readout.js`, `wings.js` | DNg02 population code (Namiki 2022) → wing amplitudes; `source: 'dna02'` is the deviation; `source: 'steering'` is the step 0b fitted stage; wing forces port |
| `src/motor/wingbeat.js` | step 0b: 200 Hz wingbeat CPG + phase-encoded haltere (fitted stage) |
| `src/bridge/steering-ids.json` | wing steering MN body IDs by type (b1/b2/b3/i1/iii3/...) and side |
| `src/loop.js` + `loop.html` | scene + eye + worker; fixed 1/60 s frames gated on the worker (deterministic); `window.__loop` bench hook; URL params below |
| `src/main.js` + `index.html` | Xenova's UI, imports pointed at vendor/, `window.__closedLoop` hook |
| `src/bridge/haltere-ids.json` | 205 haltere afferents by body ID, sided by `rootSide` |
| `bench/` | one script per claim; `bench/lib/{graph,browser,cruise}.mjs` shared |
| `nix/assets.nix` | 50 fixed-output fetches (LFS oids); regenerate with `scripts/gen-assets.sh` after bumping a submodule; `scripts/check-pins.sh` verifies submodule commits == flake input revs; `nix/npm-deps-hash` via `npm run npm-deps-hash` after any package-lock change |
| `vendor/` | three submodules, never edited: Xenova's HF Space, AbijahKaj's GitHub repo, AbijahKaj's HF data repo |

`loop.html` URL params: `bench=1` (no rAF; driven by `__loop.run(n)`), `backend=gpu|cpu`,
`gain=` (bridge gain, mV/ms per rate unit), `set=validated|inputs`, `dnbias=` (tonic DNg02,
mV/ms), `hold=frame|substep`, `motor=hover|vnc`, `readout=dng02|dna02|steering`, `gate=0|1`, `recenter=<s>`, `optic=cpu|gpu`, `flight=<LPTC gain>`, `adapt=<mV/spike>,<tau ms>`, `turngain=`,
`turnsign=`, `haltere=on|phase`, `halteregain=`, `halteresign=±1`, `cpgamp=`, `haltamp=`,
`phasegain=`, `course=1`, `bridge=off`, `stimulus=inject|poisson`, `frame=` (dt).

## The hand-set numbers (all in DECISIONS.md with reasons)

| knob | value | where |
| --- | --- | --- |
| bridge set | HS + LC4 + LPLC2 (317); `inputs` = 1,114 | worker `buildPairs` |
| bridge gain | 2 mV/ms per (r − rest); type gains all 1 | worker `bridge` |
| tonic DNg02 drive | 0.4 mV/ms (0.5 in the Phase 3 GPU run) | worker `applyDnBias` |
| rate hold | per 16.7 ms frame (one GPU fence) | worker `frame` |
| readout | DNg02 code: base 0.5, turnGain 1–20 (never steers); DNa02 deviation: turnGain 2 | `src/motor/readout.js` |
| motor lag | 50 ms | readout |
| cruise | base amplitude 0.7 → 0.78 units/s | `bench/lib/cruise.mjs` |
| haltere proxy (DC) | gain 2 mV/ms per rad/s, cap 3, **sign −1** (left afferents for rightward rotation) | `src/loop.js` |
| haltere (phase) | cpgAmp 0.8, haltAmp 1.5, phaseGain 0.1, sign −1 (all fitted) | `src/motor/wingbeat.js` |
| mute current | −50 mV/ms | worker `mute` |
| eye | 48 px faces, Weber τ 1 s, photoreceptor τ 19.6 ms (fitted) | `src/eye/` |

## Results to remember (details in docs/phase*.md, docs/ablations.md)

- Overlap 100% units and edges, identical synapse counts (Phase 0). Wing MNs = subclass
  `wm` 67, haltere `hm` 16; leg MNs 381 by T1–T3 × side in `bench/out/motor-neurons.json`.
- Xenova's Poisson path is a rate clamp (no refractory); the additive current is ours.
  CPU and GPU spike identically for 36 ms then diverge by float order into matched statistics;
  the same stimulus at another absolute tick can land in a sustained-activity regime (RNG is
  tick-seeded). Judge population statistics over several realisations.
- LIF throughput: 33–45 ms per 100 ticks on the 3070 (fixed per-tick dispatch cost), 0.24×
  alone, 0.17× with [A] on the CPU (25–38 ms per frame).
- Optic net at rest: L1/L2 silent, T4/T5 quiet, HS ~1, LC4/LPLC2 0, [A]'s DNp saturated at
  the ceiling (unfitted central inputs) → never bridge DNp/DNg02/MNs.
- Looming −45° → [B] LC4 232 Hz, LPLC2 145 Hz, DNp01 207 Hz. Bridge off → [B] silent.
- DNg02: three left HS at 129 Hz are 6% of PS080's 4,495 input synapses; DNg02 L−R stays
  within ±1 Hz at any tonic drive 0.36–1 **and with either or both relays muted and with the
  monoamines at sign 0** (followups §1): not a cancellation, just 324 relay synapses against
  35,000. AN07B004 (2 cells) as a tonic drive storms the network (§4). DNa02 (HSS → DNa02
  direct, 36–47 synapses) lateralises 26/6 Hz from HS alone, under every condition tried.
- Cruise 30 s: 0 collisions always; drift 1,064° (no haltere) → 35° (sign −1) → spin (sign +1).
  Intact 20 s: −10.9°. **But** (followups §2–3): the afferents are ipsilateral and do not steer
  DNa02 by side; sign −1 works only at large yaw rates through the silent-pair artefact; with the
  gate on, intact +204° / haltere-off −5° / bridge-off +188° in 20 s.
- Ablations: in recurrence-off / neck-cut / decapitated the readout populations are silent,
  the rest-subtracted command saturates and the fly spins identically — an artefact of the
  readout; read the rates for those conditions. With `--gate 1` those conditions fly straight
  (−2.3°), `docs/ablations-gated.md`.

## Next steps, in the order I would take them

0. **A stabiliser that is not a readout trick** (everything below §3 of docs/followups.md points
   here). (a) ~~read heading from the central complex~~ **tried 2026-09-07 night, closed** (§8):
   the compass is complete in the graph (EPG 46, PEN 42, Δ7 42, PFL3 → DNa02 736 synapses, ring
   order recoverable from the wiring), but nothing the loop carries reaches it, optic-v2 has no
   MeTu, and the un-refit LIF's ring is a fixed point at one wedge (~52° on the spectral ring)
   for any pulse position and any tonic drive: no bump, no memory. Making it a compass means
   tuning EPG–PEN–Δ7 gains, i.e. a fitted stage. `bench/compass-paths.mjs`, `bench/compass-bump.mjs`.
   (b) **implemented 2026-09-09 (fitted stage)**: `?haltere=phase` — 200 Hz wingbeat CPG drives
   steering MNs, haltere afferents fire once per cycle with L/R amplitude modulated by yaw rate.
   All constants hand-set (labeled in `DEFAULT_WINGBEAT`). CPU: `bench/wingbeat-unit.mjs`; GPU:
   `bench/haltere-phase.mjs`. The readout is `source='steering'` (agonist−antagonist asymmetry).
   Preliminary cruise: lowest wobble (0.110 rad/s) of the three conditions, comparable drift.
   docs/followups.md §9, DECISIONS.md.


1. ~~Kill or confirm the octopamine hypothesis~~ **Done 2026-09-07 evening, killed**:
   `bench/hs-inject.mjs --octopamine` (options `--mute <types>`, `--monoamines 0`) mutes each
   relay, both, and sets the 541 monoamine cells to their file sign (0). DNg02 L−R stays within
   ±1 Hz in all ten runs; DNa02 lateralises in all ten. docs/followups.md §1, DECISIONS.md.
   The biological-tonic-drive probe (`--drive AN07B004:<mV/ms>`) is also done: AN07B004 is two
   cells whose drive throws the network into a >1M-spike storm before DNg02 nears threshold;
   docs/followups.md §4. DNg02 steering is not reachable by injection anywhere in this graph.
2. ~~Readout without rest subtraction~~ **Done 2026-09-07 evening**: `gate` and `recenterTau` in
   `src/motor/readout.js` (off by default), `bench/ablate.mjs --gate 1 [--recenter 10] --tag …`.
   Silent conditions now fly straight; the intact loop drifts +204° (re-centring: +108°) and
   haltere-off −5°: the 30× stabilisation was the clamp through the artefact. docs/followups.md §3,
   docs/ablations-gated*.md, figure 19. **Open**: a real stabiliser (stronger/faster optomotor
   path or a phase-encoded haltere model onto the wing-steering MNs), and re-centring by default. (or with a slow re-centring like their `offsetTau`)
   so silent populations command straight flight; rerun `bench/ablate.mjs`.
3. ~~GPU port of the rate net~~ **Done 2026-09-07 evening**: `src/brain/optic/rate-net-gpu.js`,
   `loop.html?optic=gpu` (default CPU), `bench/optic-gpu.mjs`. 107 → 83 ms/frame (0.16× → 0.20×),
   output identical; the bridge lags one frame instead of adding a fence. docs/followups.md §5.
   **The LIF (81 ms per frame) is now the entire budget**; the 0.4× target needs Xenova's
   propagate/advance kernels sped up, not the optic side.
4. ~~Haltere sign vs anatomy~~ **Done 2026-09-07 evening**: `bench/haltere-paths.mjs`,
   `bench/haltere-inject.mjs --currents …`, `bench/haltere-loop.mjs`. The afferents are
   ipsilateral and inhibit their own DNa02 via PS059 (predicts the wrong sign); the real effect
   is a current-dependent switch that only becomes side-asymmetric above 0.8 mV/ms, and sign −1
   works as an anti-spin clamp at large yaw rates through the readout's silence-as-command
   artefact. docs/followups.md §2, figure 18. This makes step 2 the most load-bearing item.
5. Walking: leg MN → joint map (Phase 4 leftover) once something drives the leg VNC; DNa02
   is the natural turn signal there. Xenova's `gait.js` IK is the skeleton to drive. **Not started**:
   nothing in the loop drives the leg VNC (the walking DNs are silent in flight), so a leg readout
   would read zeros; it needs a walking state first (a DNp09/DNg100 drive, or a landing).
6. (Superseded by followups §3: the haltere "before/after" contrast was the readout artefact.)
   Re-record `docs/cruise-dna02.webm` (haltere off) if a before/after video is wanted:
   `scripts/gpu-box.sh runx "node bench/cruise.mjs --readout dna02 --record"`, then pull
   `docs/*.webm` **before** the next sync.

## Figures (added 2026-09-07 afternoon)

`docs/figures/` holds the 18-image set for the thread and its `README.md` (what each shows, which bench
output feeds it, how to regenerate). `docs/figures/make.py` renders the charts from `bench/out/*.json`;
`bench/figures-capture.mjs` and `bench/filmstrip-capture.mjs` produce the per-frame traces and 1080p
screenshots on the GPU box (`scripts/gpu-box.sh bg …`, log in `bench/out/bg.log` there; `XVFB_SCREEN`
sets the virtual display so 1920 × 1080 viewports fit). The loop page gained `__loop.eye()`,
`courseLayout()`, `ui(show)` and `drawHud()` for this. Xenova's presets are `walk|left|right|escape`
(there is no `fly`). `bench/video-capture.mjs` makes the HD cruise video: one 1080p still per simulated
frame, assembled at 60 fps on the box with ffmpeg (`docs/cruise-intact-1080p.mp4`, 9.5 MB, X-ready H.264).
X rejects WebM; the MP4s in docs/ are the ones to post.

## Gotchas that cost time

- Headless Brave + WebGPU flags lose every WebGL context; WebGL + WebGPU in one page only
  works headed under Xvfb with `--disable-vulkan-surface` dropped (`launchCombinedBrowser`).
  Dawn's adapter blocklist rejects NVIDIA ≥ 570 (`--enable-dawn-features=disable_adapter_blocklist`).
  First `requestAdapter` in a fresh GPU process returns null; a plain first request locks in
  SwiftShader; the worker shim retries `high-performance`.
- Inside `nix develop`, `XDG_DATA_DIRS` must include `/usr/share` or the host Vulkan loader
  finds no ICD; the flake's shellHook does this.
- Vite 8 serves `.gz` with `Content-Encoding: gzip`; `vite.config.js` serves `/data/*.gz` raw.
  The worker is the only importer of `@huggingface/kernels`; it is pre-bundled to stop
  dev-server reloads mid-boot.
- `nix build .` needs the flake inputs (not `?submodules=1`); a dirty tree is fine, but new
  files must be `git add`ed before Nix sees them.
- `Object.assign` copies a getter's value, not the accessor: define hook accessors with
  `Object.defineProperty` (bit me on `__loop.omega`).
- Two local benches on port 5173 collide; fixed with random ports, but a leftover Vite on
  5173/5174 from a killed run needs `pkill -f 'vite --port'`.
