#!/usr/bin/env node
// Phase 3 step 1: AbijahKaj's optic-v2 rate net runs in our code. Load the graph and the
// fitted parameters, drive the lamina with the photoreceptor rest level (uniform grey), settle,
// print per-type rates and the cost per Euler step. Expected (their app): HS rest 0.5-0.9,
// L1/L2 near silent, T4/T5 quiet under static input.
//   node bench/optic-settle.mjs [--seconds 1] [--dt 0.004]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { fromV2, buildCSRWeighted, unitsWhere, typeName } from '../src/brain/optic/graph.js';
import { applyParams, isPooling, hasType, restV } from '../src/brain/optic/params.js';
import { RateNet } from '../src/brain/optic/rate-net.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', 1)), DT = Number(arg('dt', 0.004));
const D = join(ROOT, 'vendor/fruit-fly-brain');
const t0 = performance.now();
const H = JSON.parse(readFileSync(join(D, 'optic.json'), 'utf8'));
const bin = readFileSync(join(D, 'optic.bin'));
const g = fromV2(H, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const fv = JSON.parse(readFileSync(join(D, 'fitted-params.json'), 'utf8'));
const applied = applyParams(g, fv, 0.02, 0.001);
const csr = buildCSRWeighted(g.n, g.m, g.pre, g.post, applied.w);
const net = new RateNet(csr, applied.tau, { wScale: 1, rMax: 5 });
net.bias.set(applied.bias);
let nCov = 0; for (let i = 0; i < g.n; i++) nCov += applied.covered[i];
console.log(`graph ${g.n} units, ${g.m} edges, ${g.columns.count} columns; params "${fv.source.slice(0, 40)}…": ${applied.nCoveredTypes} types / ${applied.nCoveredEdges} edges / ${nCov} units covered; built in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// tonic input as OpticBrain.injectTonic: grey through the photoreceptors into L1/L2/L3, lptcBias on
// non-fitted LPTCs, dnBias on DNg02
const pr = fv.photoreceptor, rRest = Math.max(0, pr.restOffset + pr.stimGain * 0.5);
const LAMINA = /^L[123]$/, LPTC = /^(HS[ENST]|VS|VST1|VST2|VSm|H2|DCH|VCH)$/;
const fitted = fv.source.startsWith('fitted');
for (let i = 0; i < g.n; i++) {
  const t = typeName(g, i);
  if (LAMINA.test(t) && g.col[i] >= 0) net.ext[i] = (pr.laminaInput[t] ?? 0) * rRest;
  else if (LPTC.test(t) && !(fitted && hasType(fv, t))) net.ext[i] = 0.2;
  else if (/^DNg02_/.test(t)) net.ext[i] = 0.5;
}
// homeostat units: pooling cells whose type is not fitted
const homeo = [], targets = [];
for (let i = 0; i < g.n; i++) { const t = typeName(g, i); if (isPooling(g, i) && !(fitted && hasType(fv, t))) { homeo.push(i); targets.push(restV(fv, t) ?? 0.3); } }
console.log(`homeostat units (pooling, not fitted): ${homeo.length}`);
const t1 = performance.now();
const info = homeo.length ? net.homeostat(Int32Array.from(homeo), Float32Array.from(targets), 10, 0.25, 0.25, DT) : null;
if (info) console.log(`homeostat 10 rounds: mean |err| ${info.meanErr.toFixed(3)}, mean bias ${info.biasMean.toFixed(3)} (${((performance.now() - t1) / 1000).toFixed(1)} s)`);
const steps = Math.round(SECONDS / DT), t2 = performance.now();
for (let k = 0; k < steps; k++) net.step(DT);
const perStep = (performance.now() - t2) / steps;
console.log(`settled ${SECONDS} s (${steps} steps) at ${perStep.toFixed(2)} ms per step => ${(DT * 1000 / perStep).toFixed(2)}x realtime on CPU`);
const groups = { L1: /^L1$/, L2: /^L2$/, Mi1: /^Mi1$/, Mi4: /^Mi4$/, Mi9: /^Mi9$/, T4a: /^T4a$/, T4b: /^T4b$/, T5a: /^T5a$/, LPi: /^LPi/, HSL: [/^HS[ENS]$/, 'L'], HSR: [/^HS[ENS]$/, 'R'], VS: /^VS/, LC4L: [/^LC4$/, 'L'], LC4R: [/^LC4$/, 'R'], LPLC2L: [/^LPLC2$/, 'L'], LPLC2R: [/^LPLC2$/, 'R'], DNg02L: [/^DNg02_/, 'L'], DNg02R: [/^DNg02_/, 'R'], DNp: /^DNp0[1-6]$/, brain: [null, null, 'brain'], vnc: [null, null, 'vnc'], MN: [null, null, 'output'] };
console.log('\nmean rate per group after settling:');
let line = '';
for (const [k, v] of Object.entries(groups)) {
  const [re, side, role] = Array.isArray(v) ? v : [v];
  const idx = unitsWhere(g, (t, s, r) => (re ? re.test(t) : true) && (side ? s === side : true) && (role ? r === role : true));
  line += `${k} ${net.meanRate(idx).toFixed(3)} (${idx.length})   `;
  if (line.length > 100) { console.log('  ' + line); line = ''; }
}
if (line) console.log('  ' + line);
let atCeiling = 0, silent = 0; for (let i = 0; i < g.n; i++) { if (net.r[i] >= 5) atCeiling++; if (net.r[i] === 0) silent++; }
console.log(`\nunits at the rate ceiling ${atCeiling}, silent ${silent}, of ${g.n}`);
