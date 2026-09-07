#!/usr/bin/env node
// Phase 0 recon: do the edges shared by [A] (AbijahKaj optic-v2) and [B] (Xenova MaleCNS)
// carry the same synapse counts? And how much extra input does [B] give the cells [A]
// exposes as readouts (i.e. what the bridge will add that [A] never saw)?
//
//   node bench/edges.mjs      (loads [B]'s full 25.6M-edge CSR; ~1 GB RAM, ~20 s)
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const XENOVA = join(ROOT, 'vendor/fruit-fly-simulation/public/data');
const ABIJAH = join(ROOT, 'vendor/fruit-fly-brain');
const t0 = performance.now();

// ---------- [B] incoming CSR exactly as data-loader.js builds it
const manifest = JSON.parse(readFileSync(join(XENOVA, 'manifest.json'), 'utf8'));
const B = JSON.parse(gunzipSync(readFileSync(join(XENOVA, manifest.metadata))).toString());
const bIndex = new Map(B.map((r, i) => [Number(r[0]), i]));
const load = (name) => {
  const a = manifest.arrays.find((x) => x.name === name);
  const out = new Uint32Array(a.length); let off = 0;
  for (const p of a.parts) { const c = new Uint32Array(gunzipSync(readFileSync(join(XENOVA, p.file))).buffer); out.set(c, off); off += c.length; }
  if (off !== a.length) throw Error('bad length ' + name);
  return out;
};
const offsets = load('offsets'), sources = load('sources'), counts = load('counts');
console.log(`[B] CSR loaded: n=${B.length} E=${sources.length}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
// sources within a target's range are sorted? check on the fly; fall back to linear scan if not
let sorted = true;
for (let j = 0; j < B.length && sorted; j++) for (let e = offsets[j] + 1; e < offsets[j + 1]; e++) if (sources[e] < sources[e - 1]) { sorted = false; break; }
console.log(`[B] sources sorted within each target row: ${sorted}`);
const findEdge = (i, j) => { // count of edge i->j in [B], or -1
  let lo = offsets[j], hi = offsets[j + 1] - 1;
  if (sorted) { while (lo <= hi) { const m = (lo + hi) >> 1; if (sources[m] === i) return counts[m]; if (sources[m] < i) lo = m + 1; else hi = m - 1; } return -1; }
  for (let e = lo; e <= hi; e++) if (sources[e] === i) return counts[e];
  return -1;
};

// ---------- [A]
const H = JSON.parse(readFileSync(join(ABIJAH, 'optic.json'), 'utf8'));
const bin = readFileSync(join(ABIJAH, 'optic.bin'));
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const CT = { int8: Int8Array, int16: Int16Array, int32: Int32Array, float32: Float32Array, float64: Float64Array };
const arr = (k) => { const d = H.arrays[k]; return new CT[d.dtype](buf, d.offset, d.length); };
const aBody = arr('units.bodyId'), aType = arr('units.type'), aSide = arr('units.side'), aRole = arr('units.role');
const pre = arr('edges.pre'), post = arr('edges.post'), w = arr('edges.weight');
const aToB = Int32Array.from(aBody, (b) => bIndex.get(b) ?? -1);
const inA = new Uint8Array(B.length); for (const j of aToB) if (j >= 0) inA[j] = 1;

// ---------- 1. shared edges: count agreement
let found = 0, equal = 0, missing = 0; const ratioHist = {}; let sumA = 0, sumB = 0; const missEx = [];
for (let e = 0; e < pre.length; e++) {
  const i = aToB[pre[e]], j = aToB[post[e]];
  const c = findEdge(i, j);
  if (c < 0) { missing++; if (missEx.length < 5) missEx.push({ pre: aBody[pre[e]], post: aBody[post[e]], wA: w[e] }); continue; }
  found++; sumA += w[e]; sumB += c;
  if (c === w[e]) equal++;
  const r = (c / w[e]).toFixed(2); ratioHist[r] = (ratioHist[r] || 0) + 1;
}
console.log(`\nSHARED EDGES  [A] edges found in [B]: ${found}/${pre.length} (${(100 * found / pre.length).toFixed(3)}%)  missing ${missing}`);
console.log(`              identical count: ${equal}/${found} (${(100 * equal / found).toFixed(3)}%)   Σcount A=${sumA} B=${sumB}`);
const top = Object.entries(ratioHist).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`              count ratio B/A histogram (top): ${top.map(([k, v]) => `${k}×${v}`).join('  ')}`);
if (missEx.length) console.log('              missing examples:', JSON.stringify(missEx));

// ---------- 2. what [B] adds onto [A]'s cells: incoming synapses from outside [A], per role / readout type
const typeName = (u) => H.types[aType[u]].name, roleName = (u) => H.roles[aRole[u]];
const groups = {
  HS: (u) => /^HS[ENS]$/.test(typeName(u)), LC4: (u) => typeName(u) === 'LC4', LPLC2: (u) => typeName(u) === 'LPLC2',
  DNg02: (u) => /^DNg02_/.test(typeName(u)), DNp: (u) => /^DNp0[1-6]$/.test(typeName(u)),
  T4T5: (u) => /^T[45][abcd]$/.test(typeName(u)), lamina: (u) => /^L[123]$/.test(typeName(u)),
  wingMN: (u) => roleName(u) === 'output' && !/^(hDVM|hi\d|hiii\d|MNhm)/.test(typeName(u)),
  haltereMN: (u) => roleName(u) === 'output' && /^(hDVM|hi\d|hiii\d|MNhm)/.test(typeName(u)),
  brainBridge: (u) => roleName(u) === 'brain', vncBridge: (u) => roleName(u) === 'vnc',
};
console.log('\nINPUT ONTO [A] CELLS IN [B]   (synapses from inside [A] vs from the rest of [B]; edge counts in parentheses)');
console.log('  group        cells   syn from A      syn from B\\A   edges A / B\\A    B\\A share');
const extra = {};
for (const [name, pred] of Object.entries(groups)) {
  let cells = 0, synIn = 0, synOut = 0, eIn = 0, eOut = 0;
  for (let u = 0; u < aBody.length; u++) {
    if (!pred(u)) continue; cells++;
    const j = aToB[u];
    for (let e = offsets[j]; e < offsets[j + 1]; e++) { if (inA[sources[e]]) { synIn += counts[e]; eIn++; } else { synOut += counts[e]; eOut++; } }
  }
  extra[name] = { cells, synIn, synOut, eIn, eOut };
  console.log(`  ${name.padEnd(12)} ${String(cells).padStart(5)}   ${String(synIn).padStart(10)}      ${String(synOut).padStart(10)}   ${String(eIn).padStart(7)} / ${String(eOut).padStart(7)}    ${(100 * synOut / Math.max(1, synIn + synOut)).toFixed(1)}%`);
}
// [A]'s own in-graph synapse totals differ from "syn from A" above because [A] drops edges < 2 (optic) / < 5 (central)
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
writeFileSync(join(ROOT, 'bench/out/edges.json'), JSON.stringify({ edgesA: pre.length, found, equal, missing, sumA, sumB, ratioHist, extra }, null, 1));
console.log('wrote bench/out/edges.json');
