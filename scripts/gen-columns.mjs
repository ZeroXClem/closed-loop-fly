#!/usr/bin/env node
// Regenerate src/eye/columns.json: the connectome's 1,771 optic-lobe columns (side, hex
// coordinates, azimuth, elevation) from AbijahKaj's optic-v2 graph. The directions were
// calibrated from the wiring (T4 Mi9 -> Mi4 offsets, vendor/fruit-fly-brain-research/data/
// extract_v2.py); we take them as they are. Derived from MaleCNS, CC BY 4.0 (DATA-LICENSE.md).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, 'vendor/fruit-fly-brain');
const H = JSON.parse(readFileSync(join(D, 'optic.json'), 'utf8'));
const bin = readFileSync(join(D, 'optic.bin'));
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const CT = { int8: Int8Array, int16: Int16Array, int32: Int32Array, float32: Float32Array, float64: Float64Array };
const arr = (k) => { const d = H.arrays[k]; return new CT[d.dtype](buf, d.offset, d.length); };
const side = arr('columns.side'), h1 = arr('columns.h1'), h2 = arr('columns.h2'), az = arr('columns.az'), el = arr('columns.el');
const n = H.columns.count;
const out = {
  source: `AbijahKaj/fruit-fly-brain optic.json v${H.version} (${H.source}); columns calibrated by data/extract_v2.py`,
  license: 'CC BY 4.0 (MaleCNS, Berg et al. 2026)',
  frame: 'azimuth radians, 0 = forward, positive = right; elevation radians, positive = up; side 0 = left eye, 1 = right eye',
  spacingDeg: H.extract.spacingDeg,
  count: n,
  side: Array.from(side),
  h1: Array.from(h1),
  h2: Array.from(h2),
  az: Array.from(az, (v) => +v.toFixed(6)),
  el: Array.from(el, (v) => +v.toFixed(6)),
};
writeFileSync(join(ROOT, 'src/eye/columns.json'), JSON.stringify(out));
const L = out.side.filter((s) => s === 0).length;
console.log(`wrote src/eye/columns.json: ${n} columns (${L} L, ${n - L} R), ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
