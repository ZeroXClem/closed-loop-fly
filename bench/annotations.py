"""Phase 0 recon: what the MaleCNS annotation table knows that neither vendored graph carries
(subclass, class, neuromere/nerve columns). Emits body-ID tables for motor neurons and haltere
sensory neurons, cross-checked against Xenova's 166,700-row neuron list.

    npm run bench:annotations        (= nix develop -c python bench/annotations.py)

The table path comes from $MALECNS_ANNOTATIONS, set by the devShell to the fixed-output
fetch in nix/assets.nix (SHA-256 from Xenova's manifest). No ad-hoc downloads.
"""
from __future__ import annotations
import gzip, json, os, sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
TABLE = os.environ.get("MALECNS_ANNOTATIONS")
if not TABLE:
    sys.exit("MALECNS_ANNOTATIONS is not set: run under `nix develop` (npm run bench:annotations)")
ann = pd.read_feather(TABLE)
xen = json.load(gzip.open(ROOT / "vendor/fruit-fly-simulation/public/data/neurons.json.gz"))
xen_ids = {int(r[0]) for r in xen}
print(f"annotation rows: {len(ann)}   Xenova rows: {len(xen)}")
print("\ncolumns:")
for c in ann.columns:
    nn = int(ann[c].notna().sum())
    ex = ann[c].dropna().astype(str).unique()[:4].tolist()
    print(f"  {c:28} non-null {nn:7}  e.g. {ex}")

def vc(df, col, n=40):
    return df[col].fillna("<NA>").astype(str).value_counts().head(n)

for sc in ["vnc_motor", "cb_motor", "vnc_sensory", "descending_neuron"]:
    d = ann[ann.superclass == sc]
    print(f"\n== superclass {sc}: {len(d)} rows, {int(d.bodyId.isin(xen_ids).sum())} in Xenova")
    for col in ["class", "subclass"]:
        if col in d: print(f"-- {col}\n{vc(d, col).to_string()}")

# any string column mentioning haltere
print("\n== rows with 'halt' in any string column, by superclass/type/subclass:")
# pandas >= 3 stores text as a string dtype, not object: test for "string-like" explicitly
mask = pd.Series(False, index=ann.index)
for c in ann.columns:
    if pd.api.types.is_string_dtype(ann[c]) or ann[c].dtype == object:
        mask |= ann[c].astype(str).str.contains("halt", case=False, na=False).fillna(False).astype(bool)
h = ann[mask]
assert (h.subclass == "haltere").sum() == (ann.subclass == "haltere").sum(), "haltere subclass rows missed"
assert len(h) > 0, "no haltere rows found: string-dtype detection broke"

print(h.groupby(["superclass", "subclass"], dropna=False).size().sort_values(ascending=False).head(30).to_string())
print(f"  total {len(h)}; in Xenova {int(h.bodyId.isin(xen_ids).sum())}")

# neuromere / side columns that will drive the Phase 4 leg readout
cand = [c for c in ann.columns if any(k in c.lower() for k in ["neuromere", "nerve", "side", "hemilineage", "roi", "target", "origin"])]
print("\n== candidate neuromere/side columns:", cand)
mot = ann[ann.superclass.isin(["vnc_motor", "cb_motor"])].copy()
for c in cand:
    if c in mot: print(f"-- {c} (motor rows)\n{vc(mot, c, 25).to_string()}")

keep = ["bodyId", "type", "superclass", "class", "subclass", "somaSide"] + [c for c in cand if c not in ("somaSide",)]
keep = [c for c in keep if c in mot]
out = mot[keep].copy()
out["inXenova"] = out.bodyId.isin(xen_ids)
out = out.where(pd.notna(out), None)
(ROOT / "bench/out").mkdir(exist_ok=True)
out.to_json(ROOT / "bench/out/motor-neurons.json", orient="records")
hs = h[[c for c in keep if c in h]].copy(); hs["inXenova"] = hs.bodyId.isin(xen_ids)
hs.where(pd.notna(hs), None).to_json(ROOT / "bench/out/haltere-sensory.json", orient="records")
print(f"\nwrote bench/out/motor-neurons.json ({len(out)} rows), bench/out/haltere-sensory.json ({len(hs)} rows)")
