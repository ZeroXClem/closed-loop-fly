# Data license

Application code in this repository is MIT (`LICENSE`). Everything under `vendor/` keeps its
own license and NOTICE files; nothing there is edited. The data files this project runs on are
derived works of third-party datasets and carry those datasets' licenses.

## MaleCNS v1.0 — CC BY 4.0

All connectivity, cell-type, side, and transmitter data come from the male *Drosophila* CNS
connectome (FlyEM, HHMI Janelia / Google Research / Cambridge / MRC LMB). Only the public
flat tables are used. **No EM imagery, segmentation, or synapse-position volumes are pulled
into this repository, ever.**

Derived files, and where they come from:

| file | derived by | contents |
| --- | --- | --- |
| `vendor/fruit-fly-simulation/public/data/*.bin.gz`, `neurons.json.gz` | Xenova (`manifest.json` lists the source tables and SHA-256s) | 166,700-neuron induced graph, incoming CSR, synapse counts, per-neuron type/superclass/side/transmitter/sign/soma |
| `vendor/fruit-fly-brain/optic.json`, `optic.bin` | AbijahKaj (`data/extract_v2.py` in `vendor/fruit-fly-brain-research`) | 65,799-unit optic-lobe-to-wing subgraph with column retinotopy |
| `vendor/fruit-fly-brain/fitted-params.json` | AbijahKaj (`train/`) | per-type τ/bias and per-pair strengths fitted on that graph |
| `nix/assets.nix` → `packages.annotations` | fixed-output fetch of the MaleCNS annotation table, SHA-256 from Xenova's manifest | cell annotations incl. subclass and neuromere, used for motor-neuron tables |
| `nix/assets.nix` → `packages.assets` | fixed-output fetches of every git-lfs asset above, SHA-256 = the LFS oid | same bytes as the submodules, for LFS-less builds |
| `bench/out/*.json`, `src/bridge/ids.json` | this repo's `bench/` scripts | body-ID lists and overlap statistics |
| `src/eye/columns.json` | `scripts/gen-columns.mjs` from AbijahKaj's `optic.json`/`optic.bin` | the 1,771 optic-lobe columns: eye, hex coordinates, azimuth, elevation (retinotopy calibrated from the wiring by their `extract_v2.py`) |

Required citation for any of the above:

> Berg, S. et al. (2026). *Sexual dimorphism in the complete connectome of the Drosophila male
> central nervous system.* Cell 189(18): 5504–5526. https://doi.org/10.1016/j.cell.2026.08.015
> Data: https://male-cns.janelia.org/ (CC BY 4.0)

## flyvis — MIT

`vendor/fruit-fly-brain/flyvis-params.json` is transferred from a released flyvis model.

> Lappalainen, J. K. et al. (2024). *Connectome-constrained networks predict neural activity
> across the fly visual system.* Nature. https://github.com/TuragaLab/flyvis

## Neuron model

The leaky integrate-and-fire parameters in Xenova's `public/model.json` are adapted from

> Shiu, P. K. et al. (2024). *A Drosophila computational brain model reveals sensorimotor
> processing.* Nature. https://www.nature.com/articles/s41586-024-07763-9

## Body

Fly meshes and kinematic tree are NeuroMechFly (NeLy-EPFL), Apache-2.0 meshes and MIT
kinematic code; see `vendor/fruit-fly-simulation/public/body/assets/NOTICE`. Fonts are Inter
(OFL 1.1). WebGPU kernel packages are Apache-2.0
(`vendor/fruit-fly-simulation/licenses/`).

## Upstream projects

- Xenova, *Fruit Fly Simulation* (Neural Canvas), MIT app code —
  https://huggingface.co/spaces/Xenova/fruit-fly-simulation
- AbijahKaj, *fruit-fly-brain-research*, MIT app code; data CC BY 4.0 —
  https://github.com/AbijahKaj/fruit-fly-brain-research and
  https://huggingface.co/AbijahKaj/fruit-fly-brain
