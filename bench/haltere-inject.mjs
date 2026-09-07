#!/usr/bin/env node
// HANDOFF step 4, the direct test: drive the left or the right haltere afferents with a constant
// current in Xenova's LIF (DNg02 at its tonic drive, nothing else) and read the steering
// populations. Compares with the two-hop anatomy in bench/haltere-paths.mjs.
//   node bench/haltere-inject.mjs [--current 1] [--dnbias 0.4] [--seconds 1.5]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXenovaGraph, ROOT } from './lib/graph.mjs';
import { BrainCPU } from '../src/brain/brain.js';
import { RateMonitor } from '../src/brain/rates.js';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const CURRENTS = arg('currents', arg('current', '1')).split(',').map(Number), DN = Number(arg('dnbias', 0.4)), SECONDS = Number(arg('seconds', 1.5));
const g = loadXenovaGraph();
const n = g.n, T = (i) => g.neurons[i][1], S = (i) => g.neurons[i][3];
const idx = (pred) => { const o = []; for (let i = 0; i < n; i++) if (pred(T(i), S(i))) o.push(i); return o; };
const ids = JSON.parse(readFileSync(join(ROOT, 'src/bridge/haltere-ids.json')));
const recon = JSON.parse(readFileSync(join(ROOT, 'bench/out/recon-ids.json')));
const byBody = (list) => list.map((b) => g.bodyIndex.get(Number(b))).filter((i) => i != null);
const sets = {
  affL: ids.left.map((b) => g.bodyIndex.get(b)), affR: ids.right.map((b) => g.bodyIndex.get(b)),
  dna02L: idx((t, s) => t === 'DNa02' && s === 'L'), dna02R: idx((t, s) => t === 'DNa02' && s === 'R'),
  dng02L: idx((t, s) => /^DNg02/.test(t) && s === 'L'), dng02R: idx((t, s) => /^DNg02/.test(t) && s === 'R'),
  wingL: byBody(recon['A.wingMN.L'].bodyIds), wingR: byBody(recon['A.wingMN.R'].bodyIds),
  halMnL: byBody(recon['A.haltereMN.L'].bodyIds), halMnR: byBody(recon['A.haltereMN.R'].bodyIds),
  ps059L: idx((t, s) => t === 'PS059' && s === 'L'), ps059R: idx((t, s) => t === 'PS059' && s === 'R'),
  turnL: byBody(recon['B.turnDN.L'].bodyIds), turnR: byBody(recon['B.turnDN.R'].bodyIds),
};
function run(drive, I = 0) {
  const brain = new BrainCPU(g), zero = new Float32Array(n), kick = new Float32Array(n), mon = new RateMonitor(n);
  for (const i of [...sets.dng02L, ...sets.dng02R]) kick[i] += DN * 0.1;
  if (drive) for (const i of sets[drive]) kick[i] += I * 0.1;
  const batches = Math.round(SECONDS / 0.01); const acc = {}; let nAcc = 0, spikes = 0;
  for (let b = 0; b < batches; b++) { const r = brain.batch(100, zero, false, kick); mon.update(r.counts, 100); spikes += r.total; if (b >= batches / 2) { for (const [k, v] of Object.entries(sets)) acc[k] = (acc[k] ?? 0) + mon.mean(v); nAcc++; } }
  const out = { drive: drive || 'none', current: drive ? I : 0, spikes }; for (const k of Object.keys(sets)) out[k] = +(acc[k] / nAcc).toFixed(2); return out;
}
const rows = [run(null)]; for (const I of CURRENTS) { rows.push(run('affL', I)); rows.push(run('affR', I)); }
const f = (r, a, b) => `${r[a].toFixed(1)}/${r[b].toFixed(1)}`;
console.log(`haltere afferents ${sets.affL.length} L / ${sets.affR.length} R; DNg02 tonic ${DN} mV/ms; ${SECONDS} s, last half averaged; currents ${CURRENTS.join(', ')} mV/ms\n`);
console.log('| drive | DNa02 L/R | DNa02 L−R | turn DN L/R | DNg02 L/R | wing MN L/R | haltere MN L/R | PS059 L/R |\n| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.drive === 'none' ? 'none' : (r.drive === 'affL' ? 'left' : 'right') + ` afferents ${r.current} mV/ms`} | ${f(r, 'dna02L', 'dna02R')} | ${(r.dna02L - r.dna02R).toFixed(1)} | ${f(r, 'turnL', 'turnR')} | ${f(r, 'dng02L', 'dng02R')} | ${f(r, 'wingL', 'wingR')} | ${f(r, 'halMnL', 'halMnR')} | ${f(r, 'ps059L', 'ps059R')} |`);
writeFileSync(join(ROOT, arg('out', 'bench/out/haltere-inject.json')), JSON.stringify({ currents: CURRENTS, dnBias: DN, seconds: SECONDS, rows }, null, 1));
console.log('\nwrote ' + arg('out', 'bench/out/haltere-inject.json'));
