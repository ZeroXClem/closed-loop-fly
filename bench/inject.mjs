#!/usr/bin/env node
// Phase 1 acceptance: does LC4 stimulation through the new inject (additive current) path
// reproduce the old Poisson "Fly" behaviour? Runs Xenova's JavaScript LIF on the full graph.
//
//   node bench/inject.mjs [--seconds 0.6] [--gains 1,0.5,2] [--strength 180] [--preset escape]
//
// Pass criterion: the DNp01 escape channel crosses the controller's 100 Hz takeoff trigger in
// both paths, and the inject path's peak escape rate is within 2x of the Poisson path's.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadXenovaGraph, ROOT } from './lib/graph.mjs';
import { BrainCPU } from '../src/brain/brain.js';
import { PulseBank, populations, decodeCounts, CHANNELS } from '../vendor/fruit-fly-simulation/src/stimulus.js';
import { FlyController } from '../vendor/fruit-fly-simulation/src/controller.js';
import { kickFromRates, rateToCurrent } from '../src/brain/inject.js';
import { RateMonitor } from '../src/brain/rates.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', 0.6)), STRENGTH = Number(arg('strength', 180)), PRESET = arg('preset', 'escape');
const GAINS = arg('gains', '1').split(',').map(Number);
const STEPS = 100; // ticks per batch, as in the worker (10 ms)

const t0 = performance.now();
const graph = loadXenovaGraph();
const groups = populations(graph.neurons);
const brain = new BrainCPU(graph);
console.log(`graph ${graph.n} neurons, ${graph.sources.length} edges; BrainCPU ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const target = groups[PRESET === 'escape' ? 'escapeInput' : PRESET], profile = PRESET === 'left' || PRESET === 'right' ? 'turn' : 'paint';
console.log(`preset "${PRESET}": ${target.length} neurons at ${STRENGTH} Hz (${profile} envelope); inject current for ${STRENGTH} Hz = ${rateToCurrent(STRENGTH).toFixed(3)} mV/ms`);

function run(name, gain) {
  brain.reset();
  const pulses = new PulseBank(graph.n), controller = new FlyController(), monitor = new RateMonitor(graph.n);
  const zero = new Float32Array(graph.n), kick = new Float32Array(graph.n);
  pulses.add(target, 0, STRENGTH, profile);
  const rows = [];
  let peak = 0, peakT = 0, trigger = null, spikes = 0, takeoffT = null;
  const wall0 = performance.now(), batches = Math.round((SECONDS * 10000) / STEPS);
  for (let b = 0; b < batches; b++) {
    const r = pulses.sample(brain.tick);
    let result;
    if (name === 'poisson') result = brain.batch(STEPS, r, false);
    else { kickFromRates(r, gain, null, kick); result = brain.batch(STEPS, zero, false, kick); }
    monitor.update(result.counts, STEPS);
    const ch = decodeCounts(result.counts, groups, STEPS);
    const pose = controller.advance(ch, STEPS * 0.0001);
    const t = brain.tick * 0.1; // ms
    spikes += result.total;
    if (ch[5] > peak) { peak = ch[5]; peakT = t; }
    if (trigger === null && ch[5] > 100) trigger = t;
    if (takeoffT === null && controller.takeoffs > 0) takeoffT = t;
    if (b % 10 === 9 || b === 0)
      rows.push({ ms: t, escapeHz: +ch[5].toFixed(1), walkHz: +(((ch[0] + ch[1]) / 2)).toFixed(1), stimHz: +monitor.mean(target).toFixed(1), dnp01Hz: +monitor.mean(groups.escape).toFixed(1), spikes: result.total, active: brain.activeCount, y: +pose.y.toFixed(2), behavior: pose.behavior });
  }
  const wall = (performance.now() - wall0) / 1000;
  return { name, gain, rows, peakEscapeHz: +peak.toFixed(1), peakAtMs: peakT, triggerMs: trigger, takeoffMs: takeoffT, takeoffs: controller.takeoffs, spikes, wallS: +wall.toFixed(1), realtime: +((SECONDS) / wall).toFixed(3) };
}

const scenarios = [run('poisson', 0), ...GAINS.map((g) => run('inject', g))];
for (const s of scenarios) {
  console.log(`\n== ${s.name}${s.name === 'inject' ? ` gain ${s.gain}` : ''}   ${SECONDS} s neural in ${s.wallS} s wall (${s.realtime}× realtime, CPU)`);
  console.log('   ms  escape Hz  walk Hz  stim Hz  DNp01 Hz  spikes/batch  active  y mm  behavior');
  for (const r of s.rows) console.log(`${String(r.ms).padStart(5)}  ${String(r.escapeHz).padStart(9)}  ${String(r.walkHz).padStart(7)}  ${String(r.stimHz).padStart(7)}  ${String(r.dnp01Hz).padStart(8)}  ${String(r.spikes).padStart(12)}  ${String(r.active).padStart(6)}  ${String(r.y).padStart(4)}  ${r.behavior}`);
  console.log(`   peak escape ${s.peakEscapeHz} Hz at ${s.peakAtMs} ms; >100 Hz first at ${s.triggerMs ?? 'never'} ms; takeoffs ${s.takeoffs}${s.takeoffMs !== null ? ` (at ${s.takeoffMs} ms)` : ''}; ${s.spikes} spikes`);
}
const ref = scenarios[0];
console.log('\nVERDICT');
for (const s of scenarios.slice(1)) {
  const ratio = ref.peakEscapeHz ? s.peakEscapeHz / ref.peakEscapeHz : NaN;
  const pass = ref.takeoffs > 0 && s.takeoffs > 0 && ratio >= 0.5 && ratio <= 2;
  console.log(`  inject gain ${s.gain}: peak ratio ${ratio.toFixed(2)}, takeoff ${s.takeoffs > 0 ? 'yes' : 'no'} (poisson ${ref.takeoffs > 0 ? 'yes' : 'no'}) -> ${pass ? 'PASS' : 'FAIL'}`);
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
writeFileSync(join(ROOT, 'bench/out/inject.json'), JSON.stringify({ seconds: SECONDS, strength: STRENGTH, preset: PRESET, scenarios }, null, 1));
console.log('wrote bench/out/inject.json');
