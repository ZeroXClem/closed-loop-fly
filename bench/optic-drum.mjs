#!/usr/bin/env node
// Phase 3 step 2: the ported optic brain sees a synthetic striped drum (no WebGL: luminance per
// column is computed from azimuth), rotating each way. Prints HS L/R, T4a-T4b per eye, LC4/LPLC2,
// DNg02, for comparison with AbijahKaj's open-loop numbers (HS lateralise with drum direction;
// T4a-T4b flips sign; looming cells stay quiet under gratings).
//   node bench/optic-drum.mjs [--omega 1] [--seconds 2] [--warm 2.5] [--dt 0.004]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { fromV2 } from '../src/brain/optic/graph.js';
import { OpticBrain } from '../src/brain/optic/optic.js';
import { eyesFromColumns } from '../src/eye/ommatidia.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OMEGA = Number(arg('omega', 1)), SECONDS = Number(arg('seconds', 2)), WARM = Number(arg('warm', 2.5)), DT = Number(arg('dt', 0.004));
const D = join(ROOT, 'vendor/fruit-fly-brain');
const H = JSON.parse(readFileSync(join(D, 'optic.json'), 'utf8'));
const bin = readFileSync(join(D, 'optic.bin'));
const g = fromV2(H, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const fv = JSON.parse(readFileSync(join(D, 'fitted-params.json'), 'utf8'));
const columns = JSON.parse(readFileSync(join(ROOT, 'src/eye/columns.json'), 'utf8'));
const omm = eyesFromColumns(columns);
const t0 = performance.now();
const brain = new OpticBrain(g, fv, omm.left, omm.right);
console.log(brain.name, `(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
brain.settle(0.5);

// synthetic drum: 12 dark/light cycles around 360 deg, dark 0.08, light 0.95 (their textures),
// pattern angle advances by omega*t; a column at azimuth az sees stripe phase 12*(az - omega*t)
const lum = (o, t, omega, out) => { for (let k = 0; k < o.count; k++) out[k] = Math.sin(12 * (o.az[k] - omega * t)) > 0 ? 0.95 : 0.08; return out; };
const lumL = new Float32Array(omm.left.count), lumR = new Float32Array(omm.right.count);
const dirL = new Float32Array(omm.left.count), dirR = new Float32Array(omm.right.count);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const results = [];
for (const omega of [0, OMEGA, -OMEGA]) {
  brain.reset();
  brain.settle(0.5);
  let t = 0;
  const warmSteps = Math.round(WARM / DT), steps = Math.round(SECONDS / DT);
  const w0 = performance.now();
  // warm up with the drum still (their app calibrates the rest offsets on a static view), then rotate
  for (let k = 0; k < warmSteps; k++) { brain.step(lum(omm.left, 0, 0, lumL), lum(omm.right, 0, 0, lumR), DT); }
  const acc = {}; let n = 0;
  for (let k = 0; k < steps; k++) {
    brain.step(lum(omm.left, t, omega, lumL), lum(omm.right, t, omega, lumR), DT); t += DT;
    if (k % 5 === 0) { const r = brain.readouts(); for (const [key, v] of Object.entries(r)) if (typeof v === 'number') acc[key] = (acc[key] ?? 0) + v; n++; }
  }
  for (const k of Object.keys(acc)) acc[k] /= n;
  brain.directionMap('L', dirL); brain.directionMap('R', dirR);
  const wall = (performance.now() - w0) / 1000;
  const row = { omega, ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +v.toFixed(3)])), t4abL: +mean(dirL).toFixed(4), t4abR: +mean(dirR).toFixed(4), msPerStep: +((wall * 1000) / (warmSteps + steps)).toFixed(2) };
  results.push(row);
  console.log(`\n== drum ω = ${omega} rad/s  (${WARM} s warm-up, ${SECONDS} s window; ${row.msPerStep} ms per ${DT * 1000} ms step)`);
  console.log(`   HS L ${row.hsL} R ${row.hsR}  (rest offsets ${row.offsetL} / ${row.offsetR})  relative dL ${row.dL} dR ${row.dR}  turn ${row.turn}`);
  console.log(`   T4a−T4b per ommatidium, mean  L ${row.t4abL}  R ${row.t4abR};  T4a/T4b L ${row.T4aL}/${row.T4bL} R ${row.T4aR}/${row.T4bR}; T5a/T5b L ${row.T5aL}/${row.T5bL}`);
  console.log(`   LC4 L ${row.lc4L} R ${row.lc4R}  LPLC2 L ${row.lplc2L} R ${row.lplc2R}  loom L ${row.loomL} R ${row.loomR}   DNg02 L ${row.dng02L} R ${row.dng02R}   DNp ${row.dnp}`);
}
const [still, cw, ccw] = results;
console.log(`\nSUMMARY  turn signal (dL−dR): still ${still.turn}, ω=+${OMEGA} ${cw.turn}, ω=−${OMEGA} ${ccw.turn};  T4a−T4b L: ${cw.t4abL} vs ${ccw.t4abL}, R: ${cw.t4abR} vs ${ccw.t4abR}`);
const pass = Math.sign(cw.turn) !== Math.sign(ccw.turn) && Math.abs(cw.turn) > 0.05 && Math.abs(ccw.turn) > 0.05 && Math.sign(cw.t4abL) !== Math.sign(ccw.t4abL) && Math.sign(cw.t4abR) !== Math.sign(ccw.t4abR);
console.log(`VERDICT ${pass ? 'PASS' : 'FAIL'}: HS turn signal and T4a−T4b flip with drum direction`);
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
writeFileSync(join(ROOT, 'bench/out/optic-drum.json'), JSON.stringify({ omega: OMEGA, seconds: SECONDS, warm: WARM, dt: DT, results, pass }, null, 1));
