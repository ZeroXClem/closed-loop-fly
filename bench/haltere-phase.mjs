#!/usr/bin/env node
// Step 0b GPU bench: phase-encoded haltere via wingbeat CPG vs DC proxy vs none.
// (A) Static drum: does the CPG produce a steering-MN rate asymmetry under drum rotation?
// (B) Cruise 20 s × 3 realisations: phase haltere vs DC proxy vs no haltere.
// FITTED STAGE: all CPG constants are hand-set (see src/motor/wingbeat.js).
//   scripts/gpu-box.sh runx "node bench/haltere-phase.mjs [--seconds 20] [--reps 3] [--cpgamp 0.8] [--haltamp 1.5] [--phasegain 0.1]"
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchCombinedBrowser } from './lib/browser.mjs';
import { startVite } from './lib/browser.mjs';
import { openLoop, cruise, fmt, frames } from './lib/cruise.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', 20));
const REPS = Number(arg('reps', 3));
const CPGAMP = Number(arg('cpgamp', 0.8));
const HALTAMP = Number(arg('haltamp', 1.5));
const PHASEGAIN = Number(arg('phasegain', 0.1));
const DNBIAS = Number(arg('dnbias', 0.4));
const TURNGAIN = Number(arg('turngain', 2));
const BASEAMP = Number(arg('baseamp', 0.7));
const OMEGA = Number(arg('omega', 1));
const DRUM_SECONDS = Number(arg('drumseconds', 6));
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

const vite = await startVite();
const browser = await launchCombinedBrowser();
const report = { cpgAmp: CPGAMP, haltAmp: HALTAMP, phaseGain: PHASEGAIN, seconds: SECONDS, reps: REPS, dnBias: DNBIAS, turnGain: TURNGAIN, baseAmp: BASEAMP, drum: [], cruise: [] };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => console.log('   pageerror: ' + e.message));

  // ---- (A) Static drum rotation: phase haltere steering MN rates ----
  console.log('\n==== (A) Static drum rotation: phase haltere, steering MN readout ====');
  const STEER_KEYS = ['b_b1L', 'b_b1R', 'b_b2L', 'b_b2R', 'b_b3L', 'b_b3R', 'b_i1L', 'b_i1R', 'b_iii3L', 'b_iii3R'];
  const RATE_KEYS = ['b_dng02L', 'b_dng02R', 'b_dna02L', 'b_dna02R', ...STEER_KEYS];

  // Open with phase haltere, readout='steering' to test the full path
  const bootPhase = await openLoop(page, vite.url, { readout: 'dng02', dnBias: DNBIAS, turnGain: TURNGAIN, haltere: 'phase', haltereSign: -1, cpgAmp: CPGAMP, haltAmp: HALTAMP, phaseGain: PHASEGAIN, course: false });
  console.log(`boot: ${bootPhase.backend}, ${bootPhase.config?.pairs} bridge cells`);

  // Warm up
  await page.evaluate((n) => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; return window.__loop.run(n); }, frames(3));

  for (const omega of [0, OMEGA, -OMEGA]) {
    const rows = await page.evaluate(async (omega, n) => { window.__loop.omega = omega; window.__loop.frames.length = 0; await window.__loop.run(n); window.__loop.omega = 0; return window.__loop.frames; }, omega, frames(DRUM_SECONDS));
    const row = { omega };
    for (const k of RATE_KEYS) row[k.replace('b_', '')] = +mean(rows.map((r) => r[k])).toFixed(1);
    // Compute steering asymmetry
    const agL = (row.b1L + row.b2L + row.b3L) / 3, agR = (row.b1R + row.b2R + row.b3R) / 3;
    const antL = (row.i1L + row.iii3L) / 2, antR = (row.i1R + row.iii3R) / 2;
    row.netL = +(agL - antL).toFixed(1);
    row.netR = +(agR - antR).toFixed(1);
    row.asymmetry = +(row.netL - row.netR).toFixed(1);
    report.drum.push(row);
    console.log(`  omega ${omega}: b1 ${row.b1L}/${row.b1R}, b2 ${row.b2L}/${row.b2R}, b3 ${row.b3L}/${row.b3R}, i1 ${row.i1L}/${row.i1R}, iii3 ${row.iii3L}/${row.iii3R}`);
    console.log(`    agonist ${agL.toFixed(1)}/${agR.toFixed(1)}, antag ${antL.toFixed(1)}/${antR.toFixed(1)}, net ${row.netL}/${row.netR}, asymm ${row.asymmetry}`);
    console.log(`    DNg02 ${row.dng02L}/${row.dng02R}, DNa02 ${row.dna02L}/${row.dna02R}`);
  }
  await page.evaluate(() => window.__loop.reset());

  // ---- (B) Cruise comparison: phase vs DC proxy vs none ----
  console.log('\n==== (B) Cruise comparison ====');
  const conditions = [
    { label: 'no-haltere', haltere: false, haltereSign: 0, readout: 'dna02' },
    { label: 'DC-proxy-sign-1', haltere: true, haltereSign: -1, readout: 'dna02' },
    { label: 'phase-dna02', haltere: 'phase', haltereSign: -1, readout: 'dna02' },
    { label: 'phase-steering', haltere: 'phase', haltereSign: -1, readout: 'steering' },
  ];

  for (const cond of conditions) {
    for (let rep = 0; rep < REPS; rep++) {
      const opts = { readout: cond.readout, dnBias: DNBIAS, turnGain: TURNGAIN, haltere: cond.haltere, haltereGain: 2, haltereSign: cond.haltereSign, course: true, cpgAmp: CPGAMP, haltAmp: HALTAMP, phaseGain: PHASEGAIN };
      const boot = await openLoop(page, vite.url, opts);
      console.log(`\n-- ${cond.label} rep ${rep + 1}/${REPS}: ${boot.backend}, ${boot.config?.pairs} bridge cells`);
      const r = await cruise(page, { seconds: SECONDS, baseAmp: BASEAMP });
      r.condition = cond.label;
      r.rep = rep;
      report.cruise.push(r);
      console.log(`   ${fmt(r)}`);
      console.log(`   heading: ${r.headingPerSecond.join(' ')}`);
      await page.evaluate(() => window.__loop.reset());
    }
  }

  // Summarize
  console.log('\n==== Summary ====');
  for (const cond of conditions) {
    const runs = report.cruise.filter((r) => r.condition === cond.label);
    const col = mean(runs.map((r) => r.collisions));
    const drift = mean(runs.map((r) => Math.abs(r.driftDeg)));
    const wobble = mean(runs.map((r) => r.wobbleRadS));
    console.log(`  ${cond.label}: ${col.toFixed(1)} collisions (mean), ${drift.toFixed(1)}° drift (mean |abs|), ${wobble.toFixed(3)} rad/s wobble`);
  }
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
const out = 'bench/out/haltere-phase.json';
writeFileSync(join(ROOT, out), JSON.stringify(report, null, 1));
console.log('\nwrote ' + out);
