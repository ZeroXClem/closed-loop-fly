# Phase 2 — The eye

Date: 2026-09-07. Acceptance (GOAL.md): `bench/eye.mjs` renders a rotating drum and prints
per-column temporal contrast; a drum rotating right produces the expected rightward phase
progression across columns. Met, in both directions, on the software rasteriser and on the
GPU box (numbers below).

## What was built

| piece | file | what |
| --- | --- | --- |
| column table | `src/eye/columns.json` (from `scripts/gen-columns.mjs`) | the connectome's 1,771 columns: 879 left, 892 right, azimuth −159…−6° / 6…159°, elevation ±80°, 5° spacing; directions calibrated by AbijahKaj's extractor from T4 Mi9→Mi4 offsets, taken verbatim |
| lattice | `src/eye/ommatidia.js` | one ommatidium per column, unit direction in the fly frame (x right, y up, −z forward) |
| cube sampler | `src/eye/eye.js` | six 90° cameras on the head, 48 × 48 render targets, one (face, pixel) per ommatidium, Rec. 709 luminance of the 8-bit readback |
| photoreceptors | `src/eye/photoreceptor.js` | Weber adaptation (÷ running mean, τ 1 s, steady light → 0.5), first-order low-pass (τ 19.6 ms, fitted), rectified; parameters from `fitted-params.json` |
| facade | `src/eye/index.js` | `createEye({renderer, scene, head, columns})`; `frame(dt)` renders, samples both eyes, steps the photoreceptors; `lum.left/right`, `r.left/right` |
| test world | `src/world/scene.js`, `fly.js`, `loom.js` | striped drum (24 stripes, 30° period) re-centred on the fly, checker ground, 6 pillars, 40-pillar course, looming sphere, rigid-body fly hovering at altitude 2; same seeds and textures as upstream |
| demo | `eye.html`, `src/eye-demo.js` | third-person view, eye HUD (luminance / photoreceptor / stimulus), `[ ]` drum, `l` loom, `v` view; `?bench=1` exposes `window.__eye.step(dt)` for deterministic driving |

Output per frame: `Float32Array(879)` + `Float32Array(892)` luminance, and the same for
photoreceptor output. GOAL.md's "1,771 × 2" is 1,771 total across both eyes.

## Acceptance numbers, `bench/eye.mjs` (drum ω = ±1 rad/s, 120 Hz frames, 1.5 s adaptation, 2 s window)

| | dev VM, SwiftShader | GPU box, RTX 3070 |
| --- | --- | --- |
| columns mapped to a cube face | 879 / 879 and 892 / 892 | same |
| frame: render + sample | 3.35 + 0.05 ms → 295 Hz | see below |
| temporal contrast, equatorial columns (median / p90) | 0.88 / 0.97 | |
| photoreceptor mean output at rest | 1.258 (expected 1.271) | |
| phase slope, ω = +1 (leftward), L / R | +0.201 / +0.202 rad/° | |
| phase slope, ω = −1 (rightward), L / R | −0.190 / −0.192 rad/° | |
| expected magnitude (30° stripe period) | 0.209 rad/° | |
| columns with stripe signal on the equator | 61 / 84 left, 53 / 84 right (the rest look at pillars) | |

Verdict: PASS. The stripe wavefront reaches columns at larger azimuth later when the drum
turns right and earlier when it turns left, at the spatial frequency of the drum.

Method: for equatorial columns (|el| < 6°) the luminance time series is projected on the
stripe temporal frequency `12·|ω|/2π` = 1.91 Hz; columns whose amplitude there is under a
third of the median are dropped (they look at a pillar); the slope is the median wrapped
phase difference between kept neighbours less than 10° apart, so a gap of occluded columns
cannot break an unwrap chain.

## On the GPU box

| | GPU box, RTX 3070 |
| --- | --- |
| hardware WebGL, headless (`bench/eye.mjs` default there) | 0.6–1.2 ms per frame (850–1,600 Hz); slopes +0.200 / +0.202 and −0.191 / −0.192 rad/°; PASS |
| WebGL + WebGPU in one page, headed under Xvfb | 1.0–1.1 ms per frame, WebGPU adapter `nvidia/ampere` from the same page; PASS |

The ≥ 60 Hz requirement holds with a 50× margin on the GPU and a 5× margin in software.

The Phase 1 flag set that yields hardware WebGPU (`--enable-features=Vulkan
--disable-vulkan-surface` + Dawn blocklist off) loses every WebGL context at page start in
headless mode (`CONTEXT_LOST_WEBGL`); Phase 1's GPU runs therefore had a dead fly canvas,
which did not affect the network numbers. Plain hardware GL (ANGLE on Vulkan, no WebGPU
flags) runs the eye headless. Both together only work **headed on a display**, with
`--disable-vulkan-surface` removed: `xvfb-run -a` plus `launchCombinedBrowser()` in
`bench/lib/browser.mjs` (`scripts/gpu-box.sh runx …`). That is the configuration for Phase 3
onward. Found with `bench/eye.mjs --gl <variant> --verbose`.

## Open

- Nothing in the eye is fitted here; every constant is AbijahKaj's. Their own caveat carries
  over: the lattice is placed 5° apart centred at ±80°, and columns beyond the cube faces'
  overlap are sampled at one pixel with linear filtering, no acceptance angle.
- The eye samples after the frame's body step, the photoreceptors run at the frame rate. In
  Phase 5 the eye moves to the fixed neural substep.
