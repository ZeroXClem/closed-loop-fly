#!/usr/bin/env node
// Isolate [B]'s HS -> relay -> DNg02 circuit: inject constant current into the left HS cells of
// Xenova's LIF (nothing else), with and without a tonic DNg02 drive, and report the relays.
//   node bench/hs-inject.mjs [--current 1.5] [--dnbias 0,0.5] [--seconds 1]
import { loadXenovaGraph } from './lib/graph.mjs';
import { BrainCPU } from '../src/brain/brain.js';
import { RateMonitor } from '../src/brain/rates.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const I = Number(arg('current', 1.5)), DN = arg('dnbias', '0,0.5').split(',').map(Number), SECONDS = Number(arg('seconds', 1));
const g = loadXenovaGraph();
const n = g.n, T = (i) => g.neurons[i][1], S = (i) => g.neurons[i][3];
const idx = (pred) => { const o = []; for (let i = 0; i < n; i++) if (pred(T(i), S(i))) o.push(i); return o; };
const sets = {
  hsL: idx((t, s) => /^HS[ENS]$/.test(t) && s === 'L'), hsR: idx((t, s) => /^HS[ENS]$/.test(t) && s === 'R'),
  ps080L: idx((t, s) => t === 'PS080' && s === 'L'), ps080R: idx((t, s) => t === 'PS080' && s === 'R'),
  vuma4: idx((t) => t === 'OA-VUMa4'), gng286L: idx((t, s) => t === 'GNG286' && s === 'L'), gng286R: idx((t, s) => t === 'GNG286' && s === 'R'),
  dng02L: idx((t, s) => /^DNg02/.test(t) && s === 'L'), dng02R: idx((t, s) => /^DNg02/.test(t) && s === 'R'),
  dna02L: idx((t, s) => t === 'DNa02' && s === 'L'), dna02R: idx((t, s) => t === 'DNa02' && s === 'R'),
  dnp15L: idx((t, s) => t === 'DNp15' && s === 'L'), lpt114L: idx((t, s) => t === 'LPT114' && s === 'L'), ps321L: idx((t, s) => t === 'PS321' && s === 'L'),
};
// PS080_L's inputs by type and sign
{
  const { offsets, sources, counts } = g; const by = new Map();
  for (const p of sets.ps080L) for (let e = offsets[p]; e < offsets[p + 1]; e++) { const q = sources[e]; const k = `${T(q) || 'untyped'}_${S(q)}${g.sign[q] > 0 ? '+' : g.sign[q] < 0 ? '-' : '0'}`; by.set(k, (by.get(k) || 0) + counts[e]); }
  const tot = [...by.values()].reduce((a, b) => a + b, 0);
  console.log(`PS080_L (${sets.ps080L.length} cell) input ${tot} synapses; top: ` + [...by].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}:${v}`).join('  '));
  let exc = 0, inh = 0; for (const [k, v] of by) (k.endsWith('+') ? (exc += v) : k.endsWith('-') ? (inh += v) : 0); console.log(`  excitatory ${exc}, inhibitory ${inh}`);
}
const brain = new BrainCPU(g);
const zero = new Float32Array(n);
for (const dn of DN) {
  for (const hsCurrent of [0, I]) {
    brain.reset();
    const mon = new RateMonitor(n), kick = new Float32Array(n);
    for (const i of sets.hsL) kick[i] = hsCurrent * 0.1;
    for (const i of [...sets.dng02L, ...sets.dng02R]) kick[i] += dn * 0.1;
    const batches = Math.round(SECONDS / 0.01);
    let spikes = 0;
    const acc = {}; let nAcc = 0;
    for (let b = 0; b < batches; b++) {
      const r = brain.batch(100, zero, false, kick);
      mon.update(r.counts, 100); spikes += r.total;
      if (b >= batches / 2) { for (const [k, v] of Object.entries(sets)) acc[k] = (acc[k] ?? 0) + mon.mean(v); nAcc++; }
    }
    const f = (k) => (acc[k] / nAcc).toFixed(1);
    console.log(`\n== DNg02 tonic ${dn} mV/ms, HS_L current ${hsCurrent} mV/ms (${SECONDS} s, ${spikes} spikes)`);
    console.log(`   HS L/R ${f('hsL')}/${f('hsR')}  PS080 L/R ${f('ps080L')}/${f('ps080R')}  OA-VUMa4 ${f('vuma4')}  GNG286 L/R ${f('gng286L')}/${f('gng286R')}  DNp15_L ${f('dnp15L')}  LPT114_L ${f('lpt114L')}  PS321_L ${f('ps321L')}`);
    console.log(`   DNg02 L/R ${f('dng02L')}/${f('dng02R')}  DNa02 L/R ${f('dna02L')}/${f('dna02R')}`);
  }
}
