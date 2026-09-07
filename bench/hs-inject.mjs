#!/usr/bin/env node
// Isolate [B]'s HS -> relay -> DNg02 circuit: inject constant current into the left HS cells of
// Xenova's LIF (nothing else), with and without a tonic DNg02 drive, and report the relays.
//   node bench/hs-inject.mjs [--current 1.5] [--dnbias 0,0.5] [--seconds 1]
//        [--mute PS080,OA-VUMa4]   hold every cell of these types far below threshold (−50 mV/ms)
//        [--monoamines 0]          keep the file's sign for dopamine/octopamine/serotonin cells
//                                  instead of the +1 that worker.js sets at load
//   node bench/hs-inject.mjs --octopamine [--seconds 1.5] [--dnbias 0.4,0.5]
//        the hypothesis test (HANDOFF.md, step 1): baseline, OA-VUMa4 muted, PS080 muted, both
//        muted, monoamines at the file sign; writes bench/out/hs-inject-octopamine.json
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXenovaGraph, ROOT } from './lib/graph.mjs';
import { BrainCPU } from '../src/brain/brain.js';
import { RateMonitor } from '../src/brain/rates.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const I = Number(arg('current', 1.5)), SECONDS = Number(arg('seconds', 1)), MUTE_I = 50;
const OCTO = process.argv.includes('--octopamine');
const DRIVES = arg('drive', '') ? arg('drive', '').split(',').map((x) => { const [t, c] = x.split(':'); return { type: t, current: Number(c ?? 0.5) }; }) : [];
const DN = arg('dnbias', OCTO ? '0.4,0.5' : '0,0.5').split(',').map(Number);
const ADAPT = arg('adapt', '') ? arg('adapt', '').split(',').map(Number) : null;   // [mV per spike, tau ms]
const g = loadXenovaGraph({ monoamines: true });
const n = g.n, T = (i) => g.neurons[i][1], S = (i) => g.neurons[i][3], NT = (i) => g.neurons[i][4];
const idx = (pred) => { const o = []; for (let i = 0; i < n; i++) if (pred(T(i), S(i))) o.push(i); return o; };
const sets = {
  hsL: idx((t, s) => /^HS[ENS]$/.test(t) && s === 'L'), hsR: idx((t, s) => /^HS[ENS]$/.test(t) && s === 'R'),
  ps080L: idx((t, s) => t === 'PS080' && s === 'L'), ps080R: idx((t, s) => t === 'PS080' && s === 'R'),
  vuma4: idx((t) => t === 'OA-VUMa4'), gng286L: idx((t, s) => t === 'GNG286' && s === 'L'), gng286R: idx((t, s) => t === 'GNG286' && s === 'R'),
  dng02L: idx((t, s) => /^DNg02/.test(t) && s === 'L'), dng02R: idx((t, s) => /^DNg02/.test(t) && s === 'R'),
  dna02L: idx((t, s) => t === 'DNa02' && s === 'L'), dna02R: idx((t, s) => t === 'DNa02' && s === 'R'),
  dnp15L: idx((t, s) => t === 'DNp15' && s === 'L'), lpt114L: idx((t, s) => t === 'LPT114' && s === 'L'), ps321L: idx((t, s) => t === 'PS321' && s === 'L'),
};
// monoamine cells and the sign the file gives them (worker.js and graph.mjs set them to +1 at load)
const MONO = ['dopamine', 'octopamine', 'serotonin'];
const monoIdx = []; for (let i = 0; i < n; i++) if (MONO.includes(NT(i))) monoIdx.push(i);
const fileSign = Int32Array.from(monoIdx, (i) => g.neurons[i][5] | 0);
const fileSignHist = {}; for (const v of fileSign) fileSignHist[v] = (fileSignHist[v] || 0) + 1;
for (const d of DRIVES) console.log(`drive ${d.type}: ${idx((t) => t === d.type).length} cells at ${d.current} mV/ms`);

// PS080_L's inputs by type and sign
{
  const { offsets, sources, counts } = g; const by = new Map();
  for (const p of sets.ps080L) for (let e = offsets[p]; e < offsets[p + 1]; e++) { const q = sources[e]; const k = `${T(q) || 'untyped'}_${S(q)}${g.sign[q] > 0 ? '+' : g.sign[q] < 0 ? '-' : '0'}`; by.set(k, (by.get(k) || 0) + counts[e]); }
  const tot = [...by.values()].reduce((a, b) => a + b, 0);
  console.log(`PS080_L (${sets.ps080L.length} cell) input ${tot} synapses; top: ` + [...by].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}:${v}`).join('  '));
  let exc = 0, inh = 0; for (const [k, v] of by) (k.endsWith('+') ? (exc += v) : k.endsWith('-') ? (inh += v) : 0); console.log(`  excitatory ${exc}, inhibitory ${inh}`);
  console.log(`monoamine cells: ${monoIdx.length} (octopamine ${monoIdx.filter((i) => NT(i) === 'octopamine').length}); sign in Xenova's file: ${JSON.stringify(fileSignHist)}; +1 after the load-time fix`);
}

/** One run: HS_L at hsCurrent, DNg02 tonic dn, the given types muted, monoamine sign as asked. */
function run({ hsCurrent, dn, mute = [], monoamines = 1, seconds = SECONDS }) {
  for (let k = 0; k < monoIdx.length; k++) g.sign[monoIdx[k]] = monoamines ? 1 : fileSign[k];
  const brain = new BrainCPU(g);
  if (ADAPT) brain.setAdaptation(ADAPT[0], ADAPT[1] ?? 300);
  const zero = new Float32Array(n), kick = new Float32Array(n), mon = new RateMonitor(n);
  for (const i of sets.hsL) kick[i] = hsCurrent * 0.1;
  for (const i of [...sets.dng02L, ...sets.dng02R]) kick[i] += dn * 0.1;
  const muteSet = new Set(mute); let muted = 0;
  if (mute.length) for (let i = 0; i < n; i++) if (muteSet.has(T(i))) { kick[i] = -MUTE_I * 0.1; muted++; }
  let driven = 0;
  for (const d of DRIVES) for (let i = 0; i < n; i++) if (T(i) === d.type) { kick[i] += d.current * 0.1; driven++; }
  const batches = Math.round(seconds / 0.01);
  let spikes = 0; const acc = {}; let nAcc = 0;
  for (let b = 0; b < batches; b++) {
    const r = brain.batch(100, zero, false, kick);
    mon.update(r.counts, 100); spikes += r.total;
    if (b >= batches / 2) { for (const [k, v] of Object.entries(sets)) acc[k] = (acc[k] ?? 0) + mon.mean(v); nAcc++; }
  }
  const out = { hsCurrent, dn, mute, monoamines, seconds, spikes, muted, driven, drives: DRIVES };
  for (const k of Object.keys(sets)) out[k] = +(acc[k] / nAcc).toFixed(2);
  return out;
}
const line = (r) => `   HS L/R ${r.hsL.toFixed(1)}/${r.hsR.toFixed(1)}  PS080 L/R ${r.ps080L.toFixed(1)}/${r.ps080R.toFixed(1)}  OA-VUMa4 ${r.vuma4.toFixed(1)}  GNG286 L/R ${r.gng286L.toFixed(1)}/${r.gng286R.toFixed(1)}  DNp15_L ${r.dnp15L.toFixed(1)}  LPT114_L ${r.lpt114L.toFixed(1)}  PS321_L ${r.ps321L.toFixed(1)}\n   DNg02 L/R ${r.dng02L.toFixed(1)}/${r.dng02R.toFixed(1)}  DNa02 L/R ${r.dna02L.toFixed(1)}/${r.dna02R.toFixed(1)}`;

if (!OCTO) {
  const mute = arg('mute', '') ? arg('mute', '').split(',') : [], monoamines = Number(arg('monoamines', 1));
  for (const dn of DN) for (const hsCurrent of [0, I]) {
    const r = run({ hsCurrent, dn, mute, monoamines });
    console.log(`\n== DNg02 tonic ${dn} mV/ms, HS_L current ${hsCurrent} mV/ms (${SECONDS} s, ${r.spikes} spikes${r.muted ? `, ${r.muted} cells muted [${mute}]` : ''}${monoamines ? '' : ', monoamines at file sign'}${r.driven ? `, ${r.driven} cells driven [${DRIVES.map((d) => `${d.type} ${d.current} mV/ms`).join(', ')}]` : ''}${ADAPT ? `, adaptation ${ADAPT[0]} mV/spike τ ${ADAPT[1] ?? 300} ms` : ''})`);
    console.log(line(r));
  }
} else {
  // The hypothesis: PS080 (GABA, −) and OA-VUMa4 (octopamine, +1 after the fix) both carry HS to
  // the contralateral DNg02 and cancel. Predictions if true: muting VUMa4 lets PS080 lateralise
  // DNg02 (right < left under left-HS drive); muting PS080 lets VUMa4 lateralise it the other way;
  // muting both, or removing the +1, returns to no lateralisation or PS080-only behaviour.
  const conditions = [
    { name: 'baseline', mute: [], monoamines: 1 },
    { name: 'OA-VUMa4 muted', mute: ['OA-VUMa4'], monoamines: 1 },
    { name: 'PS080 muted', mute: ['PS080'], monoamines: 1 },
    { name: 'both muted', mute: ['OA-VUMa4', 'PS080'], monoamines: 1 },
    { name: 'monoamines at file sign', mute: [], monoamines: 0 },
  ];
  const report = { seconds: SECONDS, hsCurrent: I, dnBias: DN, fileSignHist, monoamineCells: monoIdx.length, rows: [] };
  const t0 = Date.now();
  for (const c of conditions) for (const dn of DN) {
    const off = run({ hsCurrent: 0, dn, mute: c.mute, monoamines: c.monoamines });
    const on = run({ hsCurrent: I, dn, mute: c.mute, monoamines: c.monoamines });
    const lat = (r) => r.dng02L - r.dng02R, dsi = (r) => (r.dng02L - r.dng02R) / Math.max(1e-6, r.dng02L + r.dng02R);
    const row = { condition: c.name, dn, off, on, dLR: +(lat(on) - lat(off)).toFixed(2), dsiOn: +dsi(on).toFixed(3), dsiOff: +dsi(off).toFixed(3) };
    report.rows.push(row);
    console.log(`\n== ${c.name} · DNg02 tonic ${dn} mV/ms · ${((Date.now() - t0) / 1000).toFixed(0)} s elapsed`);
    console.log(`   HS off: DNg02 ${off.dng02L.toFixed(1)}/${off.dng02R.toFixed(1)}  PS080 ${off.ps080L.toFixed(1)}/${off.ps080R.toFixed(1)}  VUMa4 ${off.vuma4.toFixed(1)}  DNa02 ${off.dna02L.toFixed(1)}/${off.dna02R.toFixed(1)}`);
    console.log(`   HS on : DNg02 ${on.dng02L.toFixed(1)}/${on.dng02R.toFixed(1)}  PS080 ${on.ps080L.toFixed(1)}/${on.ps080R.toFixed(1)}  VUMa4 ${on.vuma4.toFixed(1)}  DNa02 ${on.dna02L.toFixed(1)}/${on.dna02R.toFixed(1)}  HS ${on.hsL.toFixed(0)}/${on.hsR.toFixed(0)}`);
    console.log(`   DNg02 L−R shift from HS: ${row.dLR >= 0 ? '+' : ''}${row.dLR} Hz   DSI on/off ${row.dsiOn}/${row.dsiOff}${on.muted ? `   (${on.muted} cells muted)` : ''}`);
    writeFileSync(join(ROOT, 'bench/out/hs-inject-octopamine.json'), JSON.stringify(report, null, 1));
  }
  console.log('\n| condition | tonic | DNg02 L/R, HS off | DNg02 L/R, HS on | L−R shift | DSI on |\n| --- | --- | --- | --- | --- | --- |');
  for (const r of report.rows) console.log(`| ${r.condition} | ${r.dn} | ${r.off.dng02L.toFixed(1)} / ${r.off.dng02R.toFixed(1)} | ${r.on.dng02L.toFixed(1)} / ${r.on.dng02R.toFixed(1)} | ${r.dLR >= 0 ? '+' : ''}${r.dLR} Hz | ${r.dsiOn.toFixed(2)} |`);
}
