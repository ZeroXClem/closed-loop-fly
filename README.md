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

Phase 0 (reconnaissance) — see `GOAL.md` for the plan, `docs/recon.md` for what was found,
`DECISIONS.md` for why things are the way they are.

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

```sh
git clone --recurse-submodules <this repo>
# git-lfs is required for vendor/fruit-fly-simulation and vendor/fruit-fly-brain
npm run bench            # overlap + edge checks (Node only)
npm run setup:venv       # Python venv for the annotation-table script (uv)
npm run bench:annotations
```
