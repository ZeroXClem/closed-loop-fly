#!/usr/bin/env node
// Phase 0 recon: how much of AbijahKaj's optic-v2 graph [A] exists inside Xenova's
// MaleCNS graph [B], keyed by MaleCNS body ID. Also dumps the body-ID lists of every
// population either upstream reads or writes, so later phases never re-derive them.
//
//   node bench/overlap.mjs            prints the tables, writes bench/out/overlap.json
//                                     and bench/out/recon-ids.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const XENOVA = join(ROOT, 'vendor/fruit-fly-simulation/public/data');
const ABIJAH = join(ROOT, 'vendor/fruit-fly-brain');

// ---------- [B] Xenova: neurons.json.gz rows = [bodyId, type, superclass, side, consensusNT, fastSign, somaLocation8nm]
const manifest = JSON.parse(readFileSync(join(XENOVA, 'manifest.json'), 'utf8'));
const B = JSON.parse(gunzipSync(readFileSync(join(XENOVA, manifest.metadata))).toString());
if (B.length !== manifest.neurons) throw Error(`neurons.json rows ${B.length} != manifest ${manifest.neurons}`);
const bIndexByBody = new Map();
B.forEach((r, i) => bIndexByBody.set(Number(r[0]), i));
if (bIndexByBody.size !== B.length) throw Error('duplicate body IDs in Xenova neurons.json');

// ---------- [A] AbijahKaj optic-v2: JSON header + typed arrays in .bin
const H = JSON.parse(readFileSync(join(ABIJAH, 'optic.json'), 'utf8'));
const bin = readFileSync(join(ABIJAH, 'optic.bin'));
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const CT = { int8: Int8Array, int16: Int16Array, int32: Int32Array, float32: Float32Array, float64: Float64Array };
const arr = (k) => { const d = H.arrays[k]; return new CT[d.dtype](buf, d.offset, d.length); };
const A = {
  n: H.units.count, m: H.edges.count,
  bodyId: arr('units.bodyId'), type: arr('units.type'), side: arr('units.side'), role: arr('units.role'),
  sign: arr('units.sign'), col: arr('units.col'), pre: arr('edges.pre'), post: arr('edges.post'), weight: arr('edges.weight'),
};
const aType = (i) => H.types[A.type[i]].name;
const aSide = (i) => H.sides[A.side[i]];
const aRole = (i) => H.roles[A.role[i]];

// ---------- overlap
let hit = 0; const missing = [];
const byRole = {}; const byTypeMiss = {};
for (let i = 0; i < A.n; i++) {
  const bid = A.bodyId[i], role = aRole(i);
  byRole[role] ??= { total: 0, inB: 0 };
  byRole[role].total++;
  if (bIndexByBody.has(bid)) { hit++; byRole[role].inB++; }
  else { missing.push(i); byTypeMiss[aType(i)] = (byTypeMiss[aType(i)] || 0) + 1; }
}
// edges of [A] whose both ends exist in [B]
let edgeHit = 0;
for (let e = 0; e < A.m; e++)
  if (bIndexByBody.has(A.bodyId[A.pre[e]]) && bIndexByBody.has(A.bodyId[A.post[e]])) edgeHit++;

// type/side agreement where both have the cell
let typeAgree = 0, sideAgree = 0, compared = 0; const typeDisagree = {};
for (let i = 0; i < A.n; i++) {
  const j = bIndexByBody.get(A.bodyId[i]); if (j === undefined) continue;
  compared++;
  const bt = B[j][1], bs = B[j][3];
  if (bt === aType(i)) typeAgree++; else { const k = `${aType(i)} -> ${bt}`; typeDisagree[k] = (typeDisagree[k] || 0) + 1; }
  if (bs === aSide(i)) sideAgree++;
}

// ---------- population body-ID lists (both graphs)
const HALTERE_MN = /^(hDVM|hi\d|hiii\d|MNhm)/;
const groups = {};
const addA = (name, pred) => { const ids = []; for (let i = 0; i < A.n; i++) if (pred(aType(i), aSide(i), aRole(i))) ids.push(A.bodyId[i]); groups[name] = { source: 'A', bodyIds: ids }; };
const addB = (name, pred) => { const ids = []; for (let i = 0; i < B.length; i++) if (pred(B[i][1], B[i][3], B[i][2])) ids.push(Number(B[i][0])); groups[name] = { source: 'B', bodyIds: ids }; };
for (const s of ['L', 'R']) {
  addA(`A.HS.${s}`, (t, sd) => /^HS[ENS]$/.test(t) && sd === s);
  addA(`A.LC4.${s}`, (t, sd) => t === 'LC4' && sd === s);
  addA(`A.LPLC2.${s}`, (t, sd) => t === 'LPLC2' && sd === s);
  addA(`A.DNg02.${s}`, (t, sd) => /^DNg02_/.test(t) && sd === s);
  // MaleCNS subclass (wm/hm) is not in either graph; split by MANC muscle nomenclature instead:
  // haltere = hDVM, hi1/hi2, hiii2, MNhm*; everything else in role "output" is a wing MN
  // (DLMn/DVMn power muscles, b1-3, i1-2, iii1-3, hg1-4 steering, ps1-2, tp1-2/tpn, TTMn, STTMm, MNwm*).
  addA(`A.wingMN.${s}`, (t, sd, r) => r === 'output' && !HALTERE_MN.test(t) && sd === s);
  addA(`A.haltereMN.${s}`, (t, sd, r) => r === 'output' && HALTERE_MN.test(t) && sd === s);
  addA(`A.VS.${s}`, (t, sd) => /^VS/.test(t) && sd === s);
  addA(`A.lamina.${s}`, (t, sd) => /^L[123]$/.test(t) && sd === s);
  addB(`B.LC9.${s}`, (t, sd) => t === 'LC9' && sd === s);
  addB(`B.LC4.${s}`, (t, sd) => t === 'LC4' && sd === s);
  addB(`B.walkDN.${s}`, (t, sd) => ['DNp09', 'DNg100', 'DNg97'].includes(t) && sd === s);
  addB(`B.turnDN.${s}`, (t, sd) => ['DNa02', 'DNa11', 'DNg13'].includes(t) && sd === s);
  addB(`B.HS.${s}`, (t, sd) => /^HS[ENS]$/.test(t) && sd === s);
  addB(`B.DNg02.${s}`, (t, sd) => /^DNg02/.test(t) && sd === s);
}
addA('A.DNp01-06', (t) => /^DNp0[1-6]$/.test(t));
addA('A.output.all', (_t, _s, r) => r === 'output');
addB('B.MDN', (t) => t === 'MDN');
addB('B.DNp01', (t) => t === 'DNp01');
addB('B.motor.all', (_t, _s, sc) => /motor/i.test(sc));
addB('B.haltere.sensory', (t, _s, sc) => /halt/i.test(t) && /sensory/.test(sc));
for (const t of ['DNg02_a','DNg02_b','DNg02_c','DNg02_d','DNg02_e','DNg02_f','DNg02_g','DNp01','DNp02','DNp03','DNp04','DNp05','DNp06','DNa02','DNa11','DNg13','DNp09','DNg100','DNg97','MDN','LC9','LC4','LPLC2','HSE','HSN','HSS','VS','H2','DCH','VCH','LC10a','LC10b','LC10c','LC10d','LC11','LC12','LC15','LC17','LC6','LC16','LPLC1','LPLC4']) addB(`B.type.${t}`, (tt) => tt === t);

// ---------- [B] superclass histogram and motor neuron survey (for Phase 4)
const superclass = {}; const motorTypes = {};
for (const r of B) { superclass[r[2]] = (superclass[r[2]] || 0) + 1; if (/motor/i.test(r[2])) motorTypes[r[1]] = (motorTypes[r[1]] || 0) + 1; }
const outputTypesA = {}; for (let i = 0; i < A.n; i++) if (aRole(i) === 'output') outputTypesA[aType(i)] = (outputTypesA[aType(i)] || 0) + 1;

// ---------- report
const pct = (a, b) => (100 * a / b).toFixed(2) + '%';
console.log(`[A] AbijahKaj optic-v2 : ${A.n} units, ${A.m} edges   (${H.source})`);
console.log(`[B] Xenova MaleCNS     : ${B.length} neurons, ${manifest.edges} edges   (${manifest.dataset})`);
console.log(`\nOVERLAP  A∩B = ${hit} / ${A.n} units = ${pct(hit, A.n)}   missing ${missing.length}`);
console.log(`         A edges with both ends in B = ${edgeHit} / ${A.m} = ${pct(edgeHit, A.m)}`);
console.log(`         type agrees ${typeAgree}/${compared}, side agrees ${sideAgree}/${compared}`);
console.log('\nby role:'); for (const [r, v] of Object.entries(byRole)) console.log(`  ${r.padEnd(7)} ${String(v.inB).padStart(6)} / ${String(v.total).padStart(6)}  ${pct(v.inB, v.total)}`);
if (missing.length) { console.log('\nmissing from B, by A type:'); for (const [t, c] of Object.entries(byTypeMiss).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${t.padEnd(12)} ${c}`); }
const dis = Object.entries(typeDisagree).sort((a, b) => b[1] - a[1]);
if (dis.length) { console.log('\ntype-name disagreements (A -> B), top 15:'); for (const [k, c] of dis.slice(0, 15)) console.log(`  ${k.padEnd(28)} ${c}`); }
console.log('\npopulations (count of body IDs):');
for (const [k, v] of Object.entries(groups)) console.log(`  ${k.padEnd(20)} ${String(v.bodyIds.length).padStart(6)}`);
console.log('\n[A] output types:', outputTypesA);
console.log('\n[B] superclass histogram:'); for (const [k, v] of Object.entries(superclass).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(22)} ${v}`);
const mt = Object.entries(motorTypes).sort((a, b) => b[1] - a[1]);
console.log(`\n[B] motor-neuron types: ${mt.length} types, ${mt.reduce((s, [, c]) => s + c, 0)} cells; top 25:`); for (const [k, v] of mt.slice(0, 25)) console.log(`  ${String(k).padEnd(22)} ${v}`);
const sens = {}; for (const r of B) if (/sensory/.test(r[2]) && /halt|campan|wing|neck|prosternal/i.test(r[1])) sens[`${r[2]}:${r[1]}`] = (sens[`${r[2]}:${r[1]}`] || 0) + 1;
console.log('\n[B] sensory types mentioning haltere/campaniform/wing/neck:'); for (const [k, v] of Object.entries(sens).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(50)} ${v}`);
console.log('\nsample [B] rows:', JSON.stringify(B.slice(0, 2)));

// ---------- cross-check the name-based wing/haltere split against MaleCNS subclass (bench/annotations.py output)
try {
  const mn = JSON.parse(readFileSync(join(ROOT, 'bench/out/motor-neurons.json'), 'utf8'));
  const sub = new Map(mn.map((r) => [Number(r.bodyId), r.subclass]));
  const wm = mn.filter((r) => r.subclass === 'wm').map((r) => Number(r.bodyId)), hm = mn.filter((r) => r.subclass === 'hm').map((r) => Number(r.bodyId));
  const aOut = new Set(groups['A.output.all'].bodyIds);
  const wmInA = wm.filter((b) => aOut.has(b)).length, hmInA = hm.filter((b) => aOut.has(b)).length;
  let wingOk = 0, halOk = 0, wingN = 0, halN = 0;
  for (const s of ['L', 'R']) { for (const b of groups[`A.wingMN.${s}`].bodyIds) { wingN++; if (sub.get(b) === 'wm') wingOk++; } for (const b of groups[`A.haltereMN.${s}`].bodyIds) { halN++; if (sub.get(b) === 'hm') halOk++; } }
  console.log(`\nsubclass cross-check: MaleCNS wm=${wm.length} (in A: ${wmInA}), hm=${hm.length} (in A: ${hmInA}); A.output=${aOut.size}`);
  console.log(`  name-based split agrees with subclass: wing ${wingOk}/${wingN}, haltere ${halOk}/${halN}`);
  const leg = {}; for (const r of mn) if (['fl', 'ml', 'hl'].includes(r.subclass)) { const k = `${r.subclass}.${r.somaSide}.${r.somaNeuromere}`; leg[k] = (leg[k] || 0) + 1; }
  console.log('  leg MNs by subclass.side.neuromere:', JSON.stringify(leg));
} catch (e) { console.log('\n(no bench/out/motor-neurons.json; run bench/annotations.py for the subclass cross-check)'); }

mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
writeFileSync(join(ROOT, 'bench/out/overlap.json'), JSON.stringify({
  A: { units: A.n, edges: A.m, source: H.source }, B: { neurons: B.length, edges: manifest.edges, dataset: manifest.dataset },
  unitsInB: hit, unitsMissing: missing.length, edgesInB: edgeHit, typeAgree, sideAgree, compared, byRole, byTypeMiss, typeDisagree,
  missingBodyIds: missing.map((i) => ({ bodyId: A.bodyId[i], type: aType(i), side: aSide(i), role: aRole(i) })),
}, null, 1));
writeFileSync(join(ROOT, 'bench/out/recon-ids.json'), JSON.stringify(groups));
console.log('\nwrote bench/out/overlap.json, bench/out/recon-ids.json');
