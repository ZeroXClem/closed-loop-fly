# Phase 1 — Skeleton: Xenova's simulation runs from this repo, with `inject` and `rates`

Date: 2026-09-07. Acceptance (GOAL.md): painting still works through the new `inject` path;
`bench/inject.mjs` shows LC4 stimulation via `inject` reproduces the old "Fly" behaviour
within tolerance. Both met; numbers below. Everything runs under `nix develop`.

## What was built

| piece | file | what |
| --- | --- | --- |
| app | `index.html`, `src/main.js`, `vite.config.js` | Xenova's UI unchanged; `main.js` is a copy with imports pointed at `vendor/` plus a test hook and `?stimulus=inject\|poisson&gain=&steps=` URL parameters; Vite serves the vendored `public/` |
| LIF, JavaScript | `src/brain/brain.js` | `BrainCPU.batch(steps, rates, silenced, kick)`: `kick[i]` (mV per tick) is added to `v` every tick the neuron is not refractory, after the Poisson kick and before reset |
| LIF, WebGPU | `src/brain/brain-gpu.js`, `src/brain/propagate-sparse.wgsl` | same addition as storage binding 8, rewritten each batch |
| parity test | `src/brain/gpu-check.js` | Xenova's 257-neuron CPU-vs-GPU fixture, now also run with current alone and current + Poisson; runs at every WebGPU start |
| current ↔ rate | `src/brain/inject.js` | `rateToCurrent(hz)`: the constant current at which an isolated LIF (τm 20 ms, θ 7 mV, 2.2 ms refractory) fires at `hz`; `kickFromRates()` turns painted pulse rates into current |
| rate monitor | `src/brain/rates.js` | per-neuron EMA of batch counts, τ = 20 ms |
| worker | `src/worker.js` | Xenova's protocol plus `inject`, `watch`, `rates`, `parity` messages; `init` takes `stimulus`, `injectGain`, `steps` |

Worker API (body IDs, not indices):

```js
worker.postMessage({ type: 'inject', bodyIds, values });   // mV/ms per neuron, held until changed
worker.postMessage({ type: 'inject', current });           // full Float32Array(n)
worker.postMessage({ type: 'inject', clear: true });
worker.postMessage({ type: 'watch', bodyIds });            // every result then carries `watched` (Hz)
worker.postMessage({ type: 'rates', bodyIds, id });        // -> { type: 'rates', id, values }
```

Units: `inject` values are membrane-scaled current in mV/ms; a constant `I` settles at
`I·τm` above rest, so `I > 0.35` mV/ms fires an isolated cell. The painted pulse rate `R` Hz
maps to `rateToCurrent(R)` (180 Hz → 2.27 mV/ms), times `injectGain`.

## Acceptance numbers

### JavaScript LIF, `bench/inject.mjs` (gpu-box i9-12900, `--seconds 0.6`)

Fly preset: 126 LC4 cells, 180 Hz paint envelope. Escape channel = mean DNp01 rate.

| path | peak escape | > 100 Hz at | takeoff at | spikes (0.6 s) | wall |
| --- | --- | --- | --- | --- | --- |
| Poisson (Xenova) | 300 Hz @ 30 ms | 10 ms | 40 ms | 66,902 | 5.3 s |
| inject, gain 1 | 300 Hz @ 40 ms | 10 ms | 50 ms | 74,660 | 5.0 s |
| inject, gain 0.5 | 250 Hz @ 30 ms | 20 ms | 50 ms | 42,418 | 5.1 s |
| inject, gain 2 | 300 Hz @ 20 ms | 10 ms | 50 ms | 228,072 | 5.6 s |

Verdict: PASS at every gain (takeoff in both paths, peak ratio 0.83–1.0). Over 2 s the
Poisson path totals 90,694 spikes and inject gain 1 120,555: the additive current recruits
somewhat more downstream activity, as expected for input that sums with recurrence instead
of clamping the cell. Gain 2 drives the network into Xenova's known sustained-activity regime
(9,000 spikes per 10 ms by 500 ms).

### WebGPU, `bench/browser.mjs` (gpu-box RTX 3070, headless Brave 151, `--seconds 1.5`)

| | Poisson | inject, gain 1 |
| --- | --- | --- |
| backend | gpu | gpu |
| parity fixture at start | 257 neurons × 4,800 ticks, 38,706 spikes, max \|Δv\| 5.7e-5 mV | same |
| escape peak | 300 Hz @ 30 ms | 300 Hz @ 50 ms |
| > 100 Hz at / takeoff | 20 ms / yes | 20 ms / yes |
| spikes per 10 ms batch, first 500 ms / after | 4,441 / 8,711 | 4,978 / 8,754 |

Verdict: PASS. The painted "Fly" button goes through `inject` by default in the UI.

### Full-graph parity, `bench/parity.mjs`

JavaScript reference and WebGPU stepped from reset with the same stimulus, per-neuron
counts compared every batch:

| batch | identical until | then |
| --- | --- | --- |
| 100 ticks | 30 ms (3 batches); first differing neuron at 40 ms | totals stay matched: ≤ 500 ms 61,784 vs 64,517; > 500 ms 5,118 vs 4,903 |
| 40 ticks | 36 ms (9 batches); first differing neuron at 40 ms | same picture |

The divergence point is the same neural time at both batch sizes, so it is float
accumulation order (the CPU sums deliveries sequentially, the GPU sums integers and scales
once), not a kernel bug. The network is chaotic after ~40 ms; only population statistics are
comparable between backends.

The start tick matters more than the backend. Xenova's Poisson RNG is seeded by the absolute
tick, so the same stimulus at another tick is another realisation. With 30 silent batches
first (stimulus at tick 3,000, `bench/out/parity-warm30.json`) **both** backends settle into
the sustained-activity regime together: ≤ 500 ms 275,430 (CPU) vs 286,161 (GPU) spikes,
> 500 ms 83,835 vs 83,689, about 8,300 per 10 ms batch, again identical for the first 30 ms.
Stimulated at tick 0 the same network decays to ~5,000 spikes per 500 ms. That is the
difference between the live `bench/browser.mjs` runs (stimulus after a baseline) and the
Node runs (stimulus at tick 0); it is Xenova's documented "some pulses lead to sustained
recurrent activity", not a Phase 1 artefact.

### Throughput on the RTX 3070

| condition | compute per batch | realtime capacity |
| --- | --- | --- |
| 100-tick batches, network silent | 33 ms | 0.30× |
| 100-tick batches, escape activity | 42 ms | 0.24× |
| 40-tick batches, silent / active | 15.7 / 21.5 ms | 0.25× / 0.19× |
| JavaScript backend, active | 100 ms | 0.10× |

The cost is dominated by the fixed per-tick dispatches (≈ 0.33 ms per 0.1 ms tick over
166,700 neurons), not by spikes. This is below GOAL.md's 0.3× floor before [A] and the eye
are added; the kernel's per-tick overhead is the first target when Phase 5 looks at
performance. Xenova's readback fence per batch is part of it.

## Getting WebGPU in headless Brave on gpu-box (impure, see DECISIONS.md)

Found with `bench/webgpu-probe.mjs`; the flags live in `bench/lib/browser.mjs`.

1. Dawn keeps an adapter blocklist separate from Chrome's `--ignore-gpu-blocklist`, and it
   rejects NVIDIA Linux drivers ≥ 570 (this box: 610.57). Without
   `--enable-dawn-features=disable_adapter_blocklist` every configuration returns
   SwiftShader while chrome://gpu still says "WebGPU: Hardware accelerated".
2. The hardware adapter only appears with `--enable-features=Vulkan --disable-vulkan-surface`
   on top of `--use-gl=angle --use-angle=vulkan`.
3. Under those flags `requestAdapter({ powerPreference: 'high-performance' })` returns null
   while the plain request returns `nvidia/ampere` (and `low-power` the Intel iGPU). The
   kernel runtime hard-codes high-performance, so `src/worker.js` retries without it.
4. Inside `nix develop`, `mkShell` replaces `XDG_DATA_DIRS`; the host Vulkan loader then finds
   no ICD. The shellHook appends `/usr/local/share:/usr/share`.
5. Vite 8's static middleware serves `.gz` files with `Content-Encoding: gzip`; the browser
   inflates them and the app's own gunzip fails as "Failed to fetch". `vite.config.js` serves
   `/data/*.gz` as stored bytes (Xenova's README states the requirement).
6. The worker is the only importer of `@huggingface/kernels`; pre-bundling it stops the dev
   server from re-optimising and reloading the page mid-boot.

## Open

- Sensitivity: the same Fly stimulus decays in some runs and settles into sustained activity
  in others depending on the start tick and the backend's rounding. Phase 3's bridge gain
  tuning has to be judged on population statistics over several realisations, not one run.
- Throughput at 0.24× realtime before the front end exists.
