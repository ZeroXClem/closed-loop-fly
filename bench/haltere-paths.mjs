#!/usr/bin/env node
// HANDOFF step 4: what do the 205 haltere afferents reach in [B], and on which side? Direct
// targets by superclass and side, then signed two-hop drive onto DNa02, DNg02, wing and haltere
// motor neurons, per afferent side. Decides whether haltere sign −1 (right afferents driven during
// a left yaw) is corrective by anatomy or only by experiment.
//   node bench/haltere-paths.mjs        -> bench/out/haltere-paths.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXenovaGraph, ROOT } from './lib/graph.mjs';
const g = loadXenovaGraph();
const n = g.n, { offsets, sources, counts, neurons } = g;
const outOff = new Uint32Array(n + 1); for (let e = 0; e < sources.length; e++) outOff[sources[e] + 1]++;
for (let i = 0; i < n; i++) outOff[i + 1] += outOff[i];
const cur = outOff.slice(0, n), outT = new Uint32Array(sources.length), outC = new Uint32Array(sources.length);
for (let j = 0; j < n; j++) for (let e = offsets[j]; e < offsets[j + 1]; e++) { const i = sources[e]; outT[cur[i]] = j; outC[cur[i]] = counts[e]; cur[i]++; }
const T = (i) => neurons[i][1] || 'untyped', SC = (i) => neurons[i][2], S = (i) => neurons[i][3], SG = (i) => g.sign[i], NT = (i) => neurons[i][4];
const idx = (pred) => { const o = []; for (let i = 0; i < n; i++) if (pred(T(i), S(i), SC(i))) o.push(i); return o; };
const ids = JSON.parse(readFileSync(join(ROOT, 'src/bridge/haltere-ids.json')));
const aff = { L: ids.left.map((b) => g.bodyIndex.get(b)), R: ids.right.map((b) => g.bodyIndex.get(b)) };
const recon = JSON.parse(readFileSync(join(ROOT, 'bench/out/recon-ids.json')));
const byBody = (list) => list.map((b) => g.bodyIndex.get(Number(b))).filter((i) => i != null);
const targets = {
  'DNa02 L': idx((t, s) => t === 'DNa02' && s === 'L'), 'DNa02 R': idx((t, s) => t === 'DNa02' && s === 'R'),
  'DNg02 L': idx((t, s) => /^DNg02/.test(t) && s === 'L'), 'DNg02 R': idx((t, s) => /^DNg02/.test(t) && s === 'R'),
  'wing MN L': byBody(recon['A.wingMN.L'].bodyIds), 'wing MN R': byBody(recon['A.wingMN.R'].bodyIds),
  'haltere MN L': byBody(recon['A.haltereMN.L'].bodyIds), 'haltere MN R': byBody(recon['A.haltereMN.R'].bodyIds),
};
const tIndex = new Map(); for (const [k, list] of Object.entries(targets)) for (const i of list) tIndex.set(i, k);
const sum = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
const report = { afferents: { L: aff.L.length, R: aff.R.length }, sign: {}, direct: {}, twoHop: {}, mediators: {} };
for (const side of ['L', 'R']) {
  const A = aff[side];
  const signs = new Map(); for (const i of A) sum(signs, `${NT(i)}:${SG(i)}`, 1); report.sign[side] = Object.fromEntries(signs);
  // direct targets by superclass × side, and onto the named populations
  const bySc = new Map(), onto = new Map(); let total = 0;
  for (const i of A) for (let e = outOff[i]; e < outOff[i + 1]; e++) { const j = outT[e], c = outC[e]; total += c; sum(bySc, `${SC(j)} ${S(j)}`, c); const k = tIndex.get(j); if (k) sum(onto, k, c); }
  report.direct[side] = { total, bySuperclassSide: Object.fromEntries([...bySc].sort((a, b) => b[1] - a[1]).slice(0, 14)), onto: Object.fromEntries(onto) };
  console.log(`\n== ${side} haltere afferents (${A.length} cells, ${total} output synapses; signs ${JSON.stringify(report.sign[side])})`);
  console.log('   direct, by superclass × side: ' + [...bySc].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log('   direct onto: ' + Object.entries(targets).map(([k]) => `${k} ${onto.get(k) || 0}`).join(' · '));
  // two-hop signed drive: afferent -> j (count c1, afferent sign) -> target (count c2, sign of j)
  const drive = new Map(), med = new Map();
  const in1 = new Map(); for (const i of A) for (let e = outOff[i]; e < outOff[i + 1]; e++) sum(in1, outT[e], outC[e] * SG(i));
  for (const [j, c1] of in1) for (let e = outOff[j]; e < outOff[j + 1]; e++) {
    const k = tIndex.get(outT[e]); if (!k) continue;
    const w = c1 * outC[e] * SG(j); sum(drive, k, w);
    if (k.startsWith('DNa02')) sum(med, `${T(j)}_${S(j)}${SG(j) > 0 ? '+' : SG(j) < 0 ? '-' : '0'} → ${k}`, w);
  }
  report.twoHop[side] = Object.fromEntries(drive);
  report.mediators[side] = Object.fromEntries([...med].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 12));
  console.log('   two-hop signed drive (Σ c1·c2·sign): ' + Object.keys(targets).map((k) => `${k} ${((drive.get(k) || 0) / 1000).toFixed(1)}k`).join(' · '));
  console.log('   strongest mediators onto DNa02: ' + [...med].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8).map(([k, v]) => `${k}:${(v / 1000).toFixed(1)}k`).join('  '));
}
// the question in one line: does driving the RIGHT afferents (haltere sign −1 during a left yaw) favour DNa02 R over L?
const two = report.twoHop;
const verdict = { rightAfferents_DNa02_RminusL: (two.R['DNa02 R'] || 0) - (two.R['DNa02 L'] || 0), leftAfferents_DNa02_LminusR: (two.L['DNa02 L'] || 0) - (two.L['DNa02 R'] || 0),
  rightAfferents_wingMN_RminusL: (two.R['wing MN R'] || 0) - (two.R['wing MN L'] || 0), leftAfferents_wingMN_LminusR: (two.L['wing MN L'] || 0) - (two.L['wing MN R'] || 0) };
report.verdict = verdict;
console.log(`\n== ipsilateral bias of two-hop drive (positive = same side as the afferents)\n   DNa02:   L afferents ${(verdict.leftAfferents_DNa02_LminusR / 1000).toFixed(1)}k, R afferents ${(verdict.rightAfferents_DNa02_RminusL / 1000).toFixed(1)}k\n   wing MN: L afferents ${(verdict.leftAfferents_wingMN_LminusR / 1000).toFixed(1)}k, R afferents ${(verdict.rightAfferents_wingMN_RminusL / 1000).toFixed(1)}k`);
writeFileSync(join(ROOT, 'bench/out/haltere-paths.json'), JSON.stringify(report, null, 1));
console.log('\nwrote bench/out/haltere-paths.json');
