# Closed-Loop Fly

A sensorimotor loop through the male *Drosophila* connectome, in the browser: rendered
images drive the optic lobe, the wiring drives the ventral nerve cord, motor-neuron rates
drive the body, and the body's new pose drives the next frame's image.

Two upstream projects, combined at MaleCNS body IDs:

- **Front end:** [AbijahKaj/fruit-fly-brain-research](https://github.com/AbijahKaj/fruit-fly-brain-research) —
  the compound eye sampled at the connectome's 1,771 column directions and a rate model of
  the 65.8k-unit optic lobe with parameters fitted on an RTX 5090.
- **Back end:** [Xenova/fruit-fly-simulation](https://huggingface.co/spaces/Xenova/fruit-fly-simulation) —
  the full 166.7k-neuron, 25.6M-edge MaleCNS graph as a leaky integrate-and-fire network on
  WebGPU, plus the NeuroMechFly body.

Credit for everything that works belongs to those two authors and to the FlyEM MaleCNS
team. See `DATA-LICENSE.md`.

## Status

Phase 1 done: Xenova's demo boots from `src/`, the worker has `inject` (additive current)
and `rates` (EMA) APIs, and the Fly preset through `inject` matches the original on both the
JavaScript and WebGPU backends (`docs/phase1.md`). Phase 0 findings are in `docs/recon.md`,
reasons in `DECISIONS.md`, the plan in `GOAL.md`.

## Layout

```
GOAL.md            the build plan
docs/recon.md      Phase 0 findings, with file:line references into vendor/
DECISIONS.md       design log
DATA-LICENSE.md    what data is used and under which license
bench/             scripts that print numbers; every claim in this README gets one
vendor/            upstream repos as git submodules, never edited in place
src/               new code (from Phase 1)
```

## Setup

Everything runs through the Nix flake (`flake.nix`); the only host requirements are Nix with
flakes and, for GPU work, Brave plus the NVIDIA Vulkan driver (see `DECISIONS.md`).

```sh
git clone --recurse-submodules <this repo>     # git-lfs pulls the data; or see below
nix develop                                    # node >= 22.12, git-lfs, python + pyarrow/pandas
npm install
npm run bench                                  # overlap, edge and annotation-table checks (CPU)
npm run bench:inject                           # Phase 1 acceptance on the JavaScript LIF (CPU)
npm run dev                                    # Xenova's demo booted from src/ (WebGPU in the browser)
npm run bench:gpu                              # headless Brave + WebGPU on the GPU box
nix develop -c node bench/parity.mjs           # full-graph CPU-vs-GPU parity (GPU box)
nix build '.?submodules=1'                     # pure dist/ (npm deps and data by hash)
```

Without git-lfs, the same data assets come from the flake as fixed-output fetches:
`cp -r $(nix build '.?submodules=1#assets' --print-out-paths)/vendor/. vendor/`.

The GPU box is driven from a checkout via `scripts/gpu-box.sh sync|run` (rsync mirror; `run`
executes inside `nix develop` there).
