#!/usr/bin/env node
// HANDOFF step 0, stage 2: does the un-refit LIF hold a heading bump on the EPG ring, and can PEN
// drive move it? Uses the ring angles from bench/compass-paths.mjs (bench/out/compass.json).
//   A. tonic drive on every EPG (sweep), a 300 ms pulse on the wedge around 0°, then 1.5 s free:
//      population vector length (PVL) and angle over time. A bump = PVL stays high and the angle
//      stays put after the pulse, with the ring firing.
//   B. with the best tonic, form the bump, then drive PEN on one side for 1 s: a shifter rotates
//      the bump, and the other side rotates it the other way.
//   node bench/compass-bump.mjs [--tonics 0.2,0.28,0.34] [--pulse 1] [--pen 0.5] [--adapt 0.1,300]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXenovaGraph, ROOT } from './lib/graph.mjs';
import { BrainCPU } from '../src/brain/brain.js';
import { RateMonitor } from '../src/brain/rates.js';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TONICS = arg('tonics', '0.2,0.28,0.34').split(',').map(Number), PULSE = Number(arg('pulse', 1)), PEN_I = Number(arg('pen', 0.5)), ADAPT = arg('adapt', '') ? arg('adapt', '').split(',').map(Number) : null, OUT = arg('out', 'bench/out/compass-bump.json'), NOPEN = process.argv.includes('--no-pen'), WEDGE_DEG = Number(arg('wedge', 0));
const g = loadXenovaGraph(); const n = g.n;
const cx = JSON.parse(readFileSync(join(ROOT, 'bench/out/compass.json')));
const epg = cx.ring.epg.map((e) => e.index), ang = cx.ring.epg.map((e) => (e.angleDeg * Math.PI) / 180);
const T = (i) => g.neurons[i][1], S = (i) => g.neurons[i][3];
const penL = [], penR = [], d7 = []; for (let i = 0; i < n; i++) { const t = T(i); if (/^PEN/.test(t)) (S(i) === 'L' ? penL : penR).push(i); else if (t === 'Delta7') d7.push(i); }
const W0 = (WEDGE_DEG * Math.PI) / 180, wedge = epg.filter((_, k) => Math.abs(Math.atan2(Math.sin(ang[k] - W0), Math.cos(ang[k] - W0))) < Math.PI / 8); // ±22.5° around --wedge
console.log(`EPG ${epg.length} (wedge ${wedge.length} cells around ${WEDGE_DEG}°), PEN ${penL.length} L / ${penR.length} R, Delta7 ${d7.length}${ADAPT ? `, adaptation ${ADAPT}` : ''}`);
const zero = new Float32Array(n);
function pv(mon) { let x = 0, y = 0, s = 0; const r = mon.read(epg); for (let k = 0; k < epg.length; k++) { x += r[k] * Math.cos(ang[k]); y += r[k] * Math.sin(ang[k]); s += r[k]; } return { pvl: s > 0 ? Math.hypot(x, y) / s : 0, angleDeg: (Math.atan2(y, x) * 180) / Math.PI, meanHz: s / epg.length }; }
/** Run a schedule of {seconds, tonic, pulseOn, penSide, label}; log PV every 100 ms. */
function run(schedule, label) {
  const brain = new BrainCPU(g); if (ADAPT) brain.setAdaptation(ADAPT[0], ADAPT[1] ?? 300);
  const mon = new RateMonitor(n), kick = new Float32Array(n), trace = [];
  let t = 0;
  for (const seg of schedule) {
    kick.fill(0);
    for (const i of epg) kick[i] = seg.tonic * 0.1;
    if (seg.pulse) for (const i of wedge) kick[i] += PULSE * 0.1;
    if (seg.pen === 'L') for (const i of penL) kick[i] += PEN_I * 0.1;
    if (seg.pen === 'R') for (const i of penR) kick[i] += PEN_I * 0.1;
    const batches = Math.round(seg.seconds / 0.01);
    for (let b = 0; b < batches; b++) {
      const r = brain.batch(100, zero, false, kick); mon.update(r.counts, 100); t += 0.01;
      if (b % 10 === 9) trace.push({ t: +t.toFixed(2), seg: seg.label, ...pv(mon), penL: mon.mean(penL), penR: mon.mean(penR), d7: mon.mean(d7), spikes: r.total });
    }
  }
  const at = (tt) => trace.reduce((best, x) => (Math.abs(x.t - tt) < Math.abs(best.t - tt) ? x : best), trace[0]);
  return { label, trace, at };
}
const report = { tonics: TONICS, pulse: PULSE, pen: PEN_I, adapt: ADAPT, wedge: wedge.length, wedgeDeg: WEDGE_DEG, A: [], B: [] };
const fmt = (p) => `PVL ${p.pvl.toFixed(2)} @ ${p.angleDeg.toFixed(0)}°, EPG ${p.meanHz.toFixed(1)} Hz, Δ7 ${p.d7.toFixed(1)} Hz, PEN ${p.penL.toFixed(1)}/${p.penR.toFixed(1)} Hz`;
for (const tonic of TONICS) {
  const r = run([{ seconds: 0.5, tonic, label: 'tonic' }, { seconds: 0.3, tonic, pulse: true, label: 'pulse' }, { seconds: 1.5, tonic, label: 'free' }], `tonic ${tonic}`);
  const rows = { before: r.at(0.5), pulseEnd: r.at(0.8), free05: r.at(1.3), free15: r.at(2.3) };
  const wrapd = (d) => ((d + 540) % 360) - 180;
  const bump = rows.free15.pvl > 0.3 && rows.free15.meanHz > 2 && Math.abs(wrapd(rows.free15.angleDeg - WEDGE_DEG)) < 45;
  report.A.push({ tonic, ...Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { pvl: +v.pvl.toFixed(3), angleDeg: +v.angleDeg.toFixed(1), meanHz: +v.meanHz.toFixed(2), d7: +v.d7.toFixed(2), penL: +v.penL.toFixed(2), penR: +v.penR.toFixed(2) }])), bump, trace: r.trace });
  console.log(`\n== A · EPG tonic ${tonic} mV/ms, wedge pulse +${PULSE} for 300 ms\n   before pulse: ${fmt(rows.before)}\n   pulse end:    ${fmt(rows.pulseEnd)}\n   +0.5 s free:  ${fmt(rows.free05)}\n   +1.5 s free:  ${fmt(rows.free15)}\n   → ${bump ? 'BUMP PERSISTS' : 'no persistent bump'}`);
  writeFileSync(join(ROOT, OUT), JSON.stringify(report));
}
const best = report.A.filter((a) => a.bump).sort((a, b) => b.free15.pvl - a.free15.pvl)[0] || report.A.sort((a, b) => b.pulseEnd.pvl - a.pulseEnd.pvl)[0];
for (const side of NOPEN ? [] : ['L', 'R']) {
  const r = run([{ seconds: 0.5, tonic: best.tonic, label: 'tonic' }, { seconds: 0.3, tonic: best.tonic, pulse: true, label: 'pulse' }, { seconds: 0.3, tonic: best.tonic, label: 'settle' }, { seconds: 1.0, tonic: best.tonic, pen: side, label: 'pen' }, { seconds: 0.5, tonic: best.tonic, label: 'after' }], `pen ${side}`);
  const a0 = r.at(1.1), a1 = r.at(1.6), a2 = r.at(2.1), a3 = r.at(2.6);
  const wrap = (d) => ((d + 540) % 360) - 180;
  const row = { side, tonic: best.tonic, start: { pvl: +a0.pvl.toFixed(3), angleDeg: +a0.angleDeg.toFixed(1) }, mid: { pvl: +a1.pvl.toFixed(3), angleDeg: +a1.angleDeg.toFixed(1) }, end: { pvl: +a2.pvl.toFixed(3), angleDeg: +a2.angleDeg.toFixed(1) }, after: { pvl: +a3.pvl.toFixed(3), angleDeg: +a3.angleDeg.toFixed(1) }, shiftDeg: +wrap(a2.angleDeg - a0.angleDeg).toFixed(1), trace: r.trace };
  report.B.push(row);
  console.log(`\n== B · PEN ${side} at ${PEN_I} mV/ms for 1 s on the tonic-${best.tonic} bump\n   before PEN: ${fmt(a0)}\n   +0.5 s:     ${fmt(a1)}\n   +1.0 s:     ${fmt(a2)}\n   +0.5 after: ${fmt(a3)}\n   → bump shift ${row.shiftDeg >= 0 ? '+' : ''}${row.shiftDeg}° over the PEN second`);
  writeFileSync(join(ROOT, OUT), JSON.stringify(report));
}
console.log('\nwrote ' + OUT);
