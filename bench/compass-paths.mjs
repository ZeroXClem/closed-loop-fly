#!/usr/bin/env node
// HANDOFF step 0, stage 1: the central-complex compass in the MaleCNS graph. Which compass cells
// exist (EPG, PEN, Delta7, PEG, PFL, ring neurons), whether the EPG ring can be ordered from its own
// wiring (spectral embedding of the PEN/PEG-mediated two-hop excitation), what reaches PEN and the
// ring neurons from the inputs this loop already has (haltere afferents, bridged LPTC/LC cells,
// MeTu), and whether PFL3 -> DNa02, the fly's heading-to-steering path, is in the graph.
//   node bench/compass-paths.mjs  -> bench/out/compass.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXenovaGraph, ROOT } from './lib/graph.mjs';
const g = loadXenovaGraph();
const n = g.n, { offsets, sources, counts, neurons } = g;
const outOff = new Uint32Array(n + 1); for (let e = 0; e < sources.length; e++) outOff[sources[e] + 1]++;
for (let i = 0; i < n; i++) outOff[i + 1] += outOff[i];
const cur = outOff.slice(0, n), outT = new Uint32Array(sources.length), outC = new Uint32Array(sources.length);
for (let j = 0; j < n; j++) for (let e = offsets[j]; e < offsets[j + 1]; e++) { const i = sources[e]; outT[cur[i]] = j; outC[cur[i]] = counts[e]; cur[i]++; }
const T = (i) => neurons[i][1] || 'untyped', S = (i) => neurons[i][3], SG = (i) => g.sign[i], NT = (i) => neurons[i][4], SC = (i) => neurons[i][2];
const idx = (pred) => { const o = []; for (let i = 0; i < n; i++) if (pred(T(i), S(i))) o.push(i); return o; };
const sum = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
const sets = {
  EPG: idx((t) => t === 'EPG'), EPGt: idx((t) => t === 'EPGt'), PEN: idx((t) => /^PEN/.test(t)), PEN_L: idx((t, s) => /^PEN/.test(t) && s === 'L'), PEN_R: idx((t, s) => /^PEN/.test(t) && s === 'R'),
  Delta7: idx((t) => t === 'Delta7'), PEG: idx((t) => t === 'PEG'), EL: idx((t) => t === 'EL'), PFL1: idx((t) => t === 'PFL1'), PFL2: idx((t) => t === 'PFL2'), PFL3: idx((t) => t === 'PFL3'),
  ER: idx((t) => /^ER\d/.test(t)), ExR: idx((t) => /^ExR/.test(t)), LNO: idx((t) => /^(LNO|GLNO|LCNO|LNa)/.test(t)), MeTu: idx((t) => /^MeTu/.test(t)), TuBu: idx((t) => /^TuBu/.test(t)),
  DNa02_L: idx((t, s) => t === 'DNa02' && s === 'L'), DNa02_R: idx((t, s) => t === 'DNa02' && s === 'R'),
};
const ids = JSON.parse(readFileSync(join(ROOT, 'src/bridge/haltere-ids.json')));
sets.haltere_L = ids.left.map((b) => g.bodyIndex.get(b)); sets.haltere_R = ids.right.map((b) => g.bodyIndex.get(b));
const recon = JSON.parse(readFileSync(join(ROOT, 'bench/out/recon-ids.json')));
for (const k of ['HS', 'LC4', 'LPLC2']) for (const side of ['L', 'R']) sets[`${k}_${side}`] = recon[`A.${k}.${side}`].bodyIds.map((b) => g.bodyIndex.get(Number(b))).filter((i) => i != null);
const report = { counts: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length])), signs: {} };
for (const k of ['EPG', 'PEN', 'Delta7', 'PEG', 'PFL3', 'ER', 'MeTu']) { const m = new Map(); for (const i of sets[k]) sum(m, `${NT(i)}:${SG(i)}`, 1); report.signs[k] = Object.fromEntries(m); }
console.log('== compass cells: ' + Object.entries(report.counts).filter(([k]) => !/_[LR]$/.test(k)).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('   signs: ' + Object.entries(report.signs).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(' · '));

// ---- EPG ring order from its wiring: two-hop excitation EPG -> {PEN, PEG, EL, EPG} -> EPG, symmetrised, spectral angle
const E = sets.EPG, ne = E.length, pos = new Map(E.map((i, k) => [i, k]));
const relayTypes = new Set(['PEN_a', 'PEN_b', 'PEN', 'PEG', 'EL']);
const A = Array.from({ length: ne }, () => new Float64Array(ne));
const relaySum = new Map();
for (let a = 0; a < ne; a++) {
  const i = E[a];
  for (let e = outOff[i]; e < outOff[i + 1]; e++) {
    const k = outT[e], c1 = outC[e];
    if (pos.has(k)) { A[a][pos.get(k)] += c1; continue; }
    if (!(relayTypes.has(T(k)) || /^PEN/.test(T(k))) || SG(k) <= 0) continue;
    for (let f = outOff[k]; f < outOff[k + 1]; f++) { const j = outT[f]; if (pos.has(j)) { A[a][pos.get(j)] += c1 * outC[f]; sum(relaySum, T(k), c1 * outC[f]); } }
  }
}
for (let a = 0; a < ne; a++) for (let b = a + 1; b < ne; b++) { const v = A[a][b] + A[b][a]; A[a][b] = v; A[b][a] = v; }
for (let a = 0; a < ne; a++) A[a][a] = 0;
// normalised adjacency, power iteration for the top 3 eigenvectors (deflating the trivial one)
const deg = A.map((row) => row.reduce((s, v) => s + v, 0));
const N = A.map((row, a) => row.map((v, b) => v / Math.sqrt(Math.max(1e-9, deg[a] * deg[b]))));
const matvec = (v) => N.map((row) => row.reduce((s, x, b) => s + x * v[b], 0));
const dot = (u, v) => u.reduce((s, x, k) => s + x * v[k], 0);
const normalise = (v) => { const l = Math.sqrt(dot(v, v)) || 1; return v.map((x) => x / l); };
const vecs = [normalise(deg.map(Math.sqrt))];
for (let m = 0; m < 2; m++) {
  let v = normalise(Array.from({ length: ne }, (_, k) => Math.sin(1 + 7 * k + 3 * m)));
  for (let it = 0; it < 3000; it++) { v = matvec(v); for (const u of vecs) { const d = dot(v, u); v = v.map((x, k) => x - d * u[k]); } v = normalise(v); }
  vecs.push(v);
}
const angle = E.map((_, k) => Math.atan2(vecs[2][k], vecs[1][k]));
// ring quality: share of each cell's symmetrised excitation landing on its 4 nearest angular neighbours
const order = [...E.keys()].sort((a, b) => angle[a] - angle[b]);
let localShare = 0;
for (let r = 0; r < ne; r++) {
  const a = order[r], neigh = [order[(r + 1) % ne], order[(r + 2) % ne], order[(r + ne - 1) % ne], order[(r + ne - 2) % ne]];
  const tot = deg[a] || 1; localShare += neigh.reduce((s, b) => s + A[a][b], 0) / tot;
}
localShare /= ne;
report.ring = { epg: E.map((i, k) => ({ index: i, bodyId: neurons[i][0], side: S(i), angleDeg: +((angle[k] * 180) / Math.PI).toFixed(1) })), localShare4: +localShare.toFixed(3), relayWeight: Object.fromEntries(relaySum) };
console.log(`== EPG ring (${ne} cells): spectral order from ${[...relaySum].map(([k, v]) => `${k} ${(v / 1000).toFixed(0)}k`).join(', ')} two-hop weight; ${(localShare * 100).toFixed(0)}% of each cell's excitation lands on its 4 angular neighbours (a perfect ring ~100%, a random graph ~${((4 / (ne - 1)) * 100).toFixed(0)}%)`);
const bySide = { L: E.filter((i) => S(i) === 'L').length, R: E.filter((i) => S(i) === 'R').length }; console.log(`   EPG sides ${bySide.L} L / ${bySide.R} R; angles cover ${Math.min(...angle).toFixed(2)}..${Math.max(...angle).toFixed(2)} rad`);
// ---- Delta7 and PEN structure relative to the ring: for each PEN cell, the mean angle of its EPG inputs vs its EPG outputs (the offset that shifts the bump)
const circMean = (angs, w) => { let x = 0, y = 0; angs.forEach((t, k) => { x += w[k] * Math.cos(t); y += w[k] * Math.sin(t); }); return Math.atan2(y, x); };
const penOffsets = [];
for (const k of sets.PEN) {
  const inA = [], inW = [], outA = [], outW = [];
  for (let e = offsets[k]; e < offsets[k + 1]; e++) if (pos.has(sources[e])) { inA.push(angle[pos.get(sources[e])]); inW.push(counts[e]); }
  for (let e = outOff[k]; e < outOff[k + 1]; e++) if (pos.has(outT[e])) { outA.push(angle[pos.get(outT[e])]); outW.push(outC[e]); }
  if (inA.length && outA.length) { const d = outA.length ? circMean(outA, outW) - circMean(inA, inW) : NaN; penOffsets.push({ index: k, side: S(k), type: T(k), offsetDeg: +(((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI).toFixed(1), inSyn: inW.reduce((a, b) => a + b, 0), outSyn: outW.reduce((a, b) => a + b, 0) }); }
}
report.penOffsets = penOffsets;
const offBySide = { L: penOffsets.filter((p) => p.side === 'L').map((p) => p.offsetDeg), R: penOffsets.filter((p) => p.side === 'R').map((p) => p.offsetDeg) };
const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN;
console.log(`== PEN: ${penOffsets.length} cells with EPG in and out; median output−input angle offset L ${med(offBySide.L)}°, R ${med(offBySide.R)}° (a working shifter has opposite signs on the two sides)`);
// ---- what reaches the compass from the loop's inputs: two-hop signed drive onto PEN L/R, ER, EPG
const targets = { 'PEN L': sets.PEN_L, 'PEN R': sets.PEN_R, EPG: sets.EPG, ER: sets.ER, Delta7: sets.Delta7, 'DNa02 L': sets.DNa02_L, 'DNa02 R': sets.DNa02_R };
const tIndex = new Map(); for (const [k, list] of Object.entries(targets)) for (const i of list) tIndex.set(i, k);
report.drive = {};
for (const src of ['haltere_L', 'haltere_R', 'HS_L', 'HS_R', 'LC4_L', 'LPLC2_L', 'MeTu', 'TuBu', 'PFL3', 'EPG']) {
  const direct = new Map(), two = new Map(), in1 = new Map();
  for (const i of sets[src]) for (let e = outOff[i]; e < outOff[i + 1]; e++) { const j = outT[e]; const k = tIndex.get(j); if (k) sum(direct, k, outC[e]); sum(in1, j, outC[e] * SG(i)); }
  for (const [j, c1] of in1) for (let e = outOff[j]; e < outOff[j + 1]; e++) { const k = tIndex.get(outT[e]); if (k) sum(two, k, c1 * outC[e] * SG(j)); }
  report.drive[src] = { direct: Object.fromEntries(direct), twoHop: Object.fromEntries(two) };
  console.log(`== ${src} (${sets[src].length} cells) → direct: ${Object.keys(targets).map((k) => `${k} ${direct.get(k) || 0}`).join(' · ')}\n     two-hop signed (k): ${Object.keys(targets).map((k) => `${k} ${((two.get(k) || 0) / 1000).toFixed(1)}`).join(' · ')}`);
}
// ---- MeTu in the optic-v2 graph?
try {
  const h = JSON.parse(readFileSync(join(ROOT, 'vendor/fruit-fly-brain/optic.json')));
  const metu = h.types.filter((t) => /^MeTu/.test(t.name)); report.opticV2MeTu = metu.map((t) => ({ name: t.name, count: t.count }));
  console.log(`== optic-v2 has ${metu.length} MeTu types, ${metu.reduce((s, t) => s + t.count, 0)} units (the anterior visual pathway starts there: MeTu → TuBu → ER)`);
} catch (e) { console.log('optic.json header not readable: ' + e.message); }
writeFileSync(join(ROOT, 'bench/out/compass.json'), JSON.stringify(report, null, 1));
console.log('wrote bench/out/compass.json');
