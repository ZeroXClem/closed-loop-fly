#!/usr/bin/env node
// Phase 5 acceptance (GOAL.md): 30 s autonomous cruise through the pillar course, zero
// collisions, heading drift < 20°; a video in docs/. Runs haltere proxy off, then on.
//   scripts/gpu-box.sh runx "node bench/cruise.mjs [--readout dng02|dna02] [--seconds 30] [--dnbias 0.4] [--turngain 2] [--record]"
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchCombinedBrowser, launchSoftwareBrowser, startVite } from './lib/browser.mjs';
import { openLoop, cruise, fmt } from './lib/cruise.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GL = arg('gl', 'combined'), READOUT = arg('readout', 'dng02'), BACKEND = arg('backend', 'gpu'), SECONDS = Number(arg('seconds', 30)), DNBIAS = Number(arg('dnbias', 0.4)), TURNGAIN = Number(arg('turngain', 2)), HGAIN = Number(arg('halteregain', 2)), HSIGNS = arg('halteresigns', '1').split(',').map(Number), BASEAMP = Number(arg('baseamp', 0.7)), RECORD = process.argv.includes('--record');
const vite = await startVite();
const browser = GL === 'software' ? await launchSoftwareBrowser() : await launchCombinedBrowser();
const report = { readout: READOUT, seconds: SECONDS, dnBias: DNBIAS, turnGain: TURNGAIN, haltereGain: HGAIN, baseAmp: BASEAMP, runs: [] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => console.log('   pageerror: ' + e.message));
  const variants = [{ haltere: false, sign: 0 }, ...HSIGNS.map((sign) => ({ haltere: true, sign }))];
  for (const { haltere, sign } of variants) {
    const boot = await openLoop(page, vite.url, { readout: READOUT, backend: BACKEND, dnBias: DNBIAS, turnGain: TURNGAIN, haltere, haltereGain: HGAIN, haltereSign: sign, course: true });
    console.log(`\n== cruise ${SECONDS} s, readout ${READOUT}${READOUT === 'dna02' ? ' (DEVIATION)' : ''}, haltere proxy ${haltere ? `on (gain ${HGAIN}, sign ${sign})` : 'off'}; ${boot.backend}, ${boot.config?.pairs} bridge cells`);
    mkdirSync(join(ROOT, 'docs'), { recursive: true });
    const record = RECORD && !haltere ? join(ROOT, `docs/cruise-${READOUT}.webm`) : null;
    const r = await cruise(page, { seconds: SECONDS, baseAmp: BASEAMP, record });
    r.haltere = haltere; r.haltereSign = sign;
    report.runs.push(r);
    console.log(`   ${fmt(r)}`);
    console.log(`   heading per second: ${r.headingPerSecond.join(' ')}`);
    if (record) console.log(`   recorded ${record}`);
    await page.evaluate(() => window.__loop.reset());
  }
  const best = report.runs.reduce((a, b) => (Math.abs(b.driftDeg) + 10 * b.collisions < Math.abs(a.driftDeg) + 10 * a.collisions ? b : a));
  report.verdict = { pass: report.runs.some((r) => r.collisions === 0 && Math.abs(r.driftDeg) < 20), best: { haltere: best.haltere, haltereSign: best.haltereSign, collisions: best.collisions, driftDeg: best.driftDeg } };
  console.log(`\nVERDICT ${report.verdict.pass ? 'PASS' : 'FAIL'}: best run haltere ${best.haltere}${best.haltere ? ' sign ' + best.haltereSign : ''}: ${best.collisions} collisions, drift ${best.driftDeg}° (targets 0 and < 20°)`);
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
const out = `bench/out/cruise-${READOUT}.json`;
writeFileSync(join(ROOT, out), JSON.stringify(report, null, 1));
console.log('wrote ' + out);
