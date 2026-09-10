#!/usr/bin/env node
// Step 0b, unit test: does the wingbeat CPG fire each steering MN once per cycle, and does
// the phase-encoded haltere create a L/R asymmetry in steering MN rates under yaw?
// CPU-only, runs in seconds.
//   node bench/wingbeat-unit.mjs [--cpgamp 0.2,0.5,0.8,1.2,1.6] [--haltamp 1.5] [--phasegain 0.1] [--yaw 0,1,2]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXenovaGraph, ROOT } from './lib/graph.mjs';
import { BrainCPU } from '../src/brain/brain.js';
import { RateMonitor } from '../src/brain/rates.js';
import { WingbeatCPG } from '../src/motor/wingbeat.js';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const CPG_AMPS = arg('cpgamp', '0.2,0.5,0.8,1.2,1.6').split(',').map(Number);
const HALT_AMP = Number(arg('haltamp', 1.5));
const PHASE_GAIN = Number(arg('phasegain', 0.1));
const YAWS = arg('yaw', '0,1,2').split(',').map(Number);
const SECONDS = Number(arg('seconds', 1.5));
const OUT = arg('out', 'bench/out/wingbeat-unit.json');
const DNBIAS = Number(arg('dnbias', 0.4));

const g = loadXenovaGraph();
const n = g.n;
const T = (i) => g.neurons[i][1];
const S = (i) => g.neurons[i][3];

// Load body IDs
const haltIds = JSON.parse(readFileSync(join(ROOT, 'src/bridge/haltere-ids.json')));
const steerIds = JSON.parse(readFileSync(join(ROOT, 'src/bridge/steering-ids.json')));

// Convert body IDs to neuron indices
const toIdx = (bodyIds) => Uint32Array.from(bodyIds.map((b) => g.bodyIndex.get(Number(b))).filter((i) => i != null));
const affL = toIdx(haltIds.left), affR = toIdx(haltIds.right);
const steer = {};
for (const [type, sides] of Object.entries(steerIds)) {
  if (type === 'source') continue;
  for (const [side, bids] of Object.entries(sides)) steer[type + side] = toIdx(bids);
}

// Also find DNg02 and DNa02 for context
const dng02L = [], dng02R = [], dna02L = [], dna02R = [];
for (let i = 0; i < n; i++) {
  const t = T(i), s = S(i);
  if (/^DNg02/.test(t)) (s === 'L' ? dng02L : dng02R).push(i);
  if (t === 'DNa02') (s === 'L' ? dna02L : dna02R).push(i);
}

// Readout population lists for all steering MN types
const mnTypes = ['b1', 'b2', 'b3', 'i1', 'i2', 'iii1', 'iii3', 'hg1', 'hg2', 'hg3', 'hg4'];
const mnPops = {};
for (const t of mnTypes) {
  for (const s of ['L', 'R']) {
    const key = t + s;
    mnPops[key] = steer[key] || new Uint32Array(0);
  }
}

console.log(`Haltere afferents: ${affL.length} L / ${affR.length} R`);
console.log(`Steering MNs: ${mnTypes.map((t) => `${t} ${(steer[t + 'L'] || []).length}L/${(steer[t + 'R'] || []).length}R`).join(', ')}`);
console.log(`DNg02: ${dng02L.length}L/${dng02R.length}R, DNa02: ${dna02L.length}L/${dna02R.length}R`);

const zero = new Float32Array(n);
const report = { cpgAmps: CPG_AMPS, haltAmp: HALT_AMP, phaseGain: PHASE_GAIN, yaws: YAWS, seconds: SECONDS, runs: [] };

for (const cpgAmp of CPG_AMPS) {
  for (const yawRate of YAWS) {
    const cpg = new WingbeatCPG({ cpgAmplitude: cpgAmp, haltereAmplitude: HALT_AMP, phaseGain: PHASE_GAIN }, affL, affR, steer);
    const brain = new BrainCPU(g);
    const mon = new RateMonitor(n);
    const kick = new Float32Array(n);
    const external = new Float32Array(n);

    // Tonic DNg02 bias (same as the loop's default)
    for (const i of dng02L) external[i] = DNBIAS;
    for (const i of dng02R) external[i] = DNBIAS;

    const cycleLen = cpg.periodTicks; // 50
    const totalCycles = Math.round(SECONDS * cpg.p.frequency);

    for (let c = 0; c < totalCycles; c++) {
      // Build kick: external (DNg02 tonic) + CPG + haltere
      for (let i = 0; i < n; i++) kick[i] = external[i] * 0.1; // mV/ms -> mV per 0.1ms tick
      cpg.fillCycleKick(yawRate, kick);
      const r = brain.batch(cycleLen, zero, false, kick);
      mon.update(r.counts, cycleLen);
    }

    // Read rates
    const row = { cpgAmp, yawRate };
    for (const t of mnTypes) {
      for (const s of ['L', 'R']) {
        const key = t + s;
        row[key] = +(mon.mean(mnPops[key]) || 0).toFixed(1);
      }
    }
    row.dng02L = +mon.mean(dng02L).toFixed(1);
    row.dng02R = +mon.mean(dng02R).toFixed(1);
    row.dna02L = +mon.mean(dna02L).toFixed(1);
    row.dna02R = +mon.mean(dna02R).toFixed(1);
    row.affL = +mon.mean(affL).toFixed(1);
    row.affR = +mon.mean(affR).toFixed(1);

    const agonistL = (row.b1L + row.b2L + row.b3L) / 3;
    const agonistR = (row.b1R + row.b2R + row.b3R) / 3;
    const antagL = (row.i1L + row.iii3L) / 2;
    const antagR = (row.i1R + row.iii3R) / 2;
    row.netL = +(agonistL - antagL).toFixed(1);
    row.netR = +(agonistR - antagR).toFixed(1);
    row.asymmetry = +(row.netL - row.netR).toFixed(1);

    report.runs.push(row);
    console.log(`\ncpgAmp ${cpgAmp}, yaw ${yawRate} rad/s:`);
    console.log(`  b1 ${row.b1L}/${row.b1R}, b2 ${row.b2L}/${row.b2R}, b3 ${row.b3L}/${row.b3R} Hz`);
    console.log(`  i1 ${row.i1L}/${row.i1R}, iii3 ${row.iii3L}/${row.iii3R} Hz`);
    console.log(`  haltere aff ${row.affL}/${row.affR} Hz`);
    console.log(`  agonist L/R ${agonistL.toFixed(1)}/${agonistR.toFixed(1)}, antag L/R ${antagL.toFixed(1)}/${antagR.toFixed(1)}`);
    console.log(`  net L/R ${row.netL}/${row.netR}, asymmetry ${row.asymmetry} Hz`);
    console.log(`  DNa02 ${row.dna02L}/${row.dna02R}, DNg02 ${row.dng02L}/${row.dng02R} Hz`);
  }
}

writeFileSync(join(ROOT, OUT), JSON.stringify(report, null, 1));
console.log('\nwrote ' + OUT);
