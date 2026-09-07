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
