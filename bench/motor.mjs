#!/usr/bin/env node
// Phase 4 acceptance (GOAL.md): with the bridge on and no scripted actions, drum rotation makes
// the hovering fly yaw with the drum (optomotor); a looming sphere makes it bank away. Logs
// heading vs drum phase; correlation > 0.5. The wing command comes from [B]'s DNg02 population
// (Namiki 2022) and wing MNs only (src/motor/readout.js). GPU box, headed under Xvfb:
//   scripts/gpu-box.sh runx "node bench/motor.mjs [--gain 2] [--dnbias 0.4] [--turngain 1] [--seconds 6]"
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchCombinedBrowser, launchSoftwareBrowser, startVite, waitFor } from './lib/browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GL = arg('gl', 'combined'), READOUT = arg('readout', 'dng02'), BACKEND = arg('backend', 'gpu'), GAIN = Number(arg('gain', 2)), DNBIAS = Number(arg('dnbias', 0.4)), TURNGAIN = Number(arg('turngain', 1)), SECONDS = Number(arg('seconds', 6)), WARM = Number(arg('warm', 3)), OMEGA = Number(arg('omega', 1)), SET = arg('set', 'validated'), NOLOOM = process.argv.includes('--no-loom');
const FRAME = 1 / 60, frames = (s) => Math.round(s / FRAME);
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

const vite = await startVite();
const browser = GL === 'software' ? await launchSoftwareBrowser() : await launchCombinedBrowser();
const report = { readout: READOUT, gain: GAIN, dnBias: DNBIAS, turnGain: TURNGAIN, seconds: SECONDS, omega: OMEGA, set: SET, backend: BACKEND, runs: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('   console: ' + m.text().slice(0, 200)); });
  await page.goto(`${vite.url}loop.html?bench=1&gain=${GAIN}&set=${SET}&backend=${BACKEND}&dnbias=${DNBIAS}&hold=frame&motor=hover&turngain=${TURNGAIN}&readout=${READOUT}`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__loop?.ready || window.__loop?.error, { what: 'loop ready', timeoutMs: 600000 });
  const boot = await page.evaluate(() => ({ backend: window.__loop.backend, config: window.__loop.config, error: window.__loop.error }));
  if (boot.error) throw Error(boot.error);
  console.log(`${boot.backend}, ${boot.config?.pairs} bridge cells, DNg02 tonic ${DNBIAS} mV/ms, bridge gain ${GAIN}, turn gain ${TURNGAIN}, readout ${READOUT}${READOUT === 'dna02' ? ' (DEVIATION: not the published flight map)' : ''}`);
  // warm-up still (optic calibrates, bridge rest captured), then 1 s of still frames to take the motor rest, then motor on
  await page.evaluate((n) => { window.__loop.omega = 0; window.__loop.motor.mode = 'vnc'; return window.__loop.run(n); }, frames(WARM));
  const rest = await page.evaluate(async (n) => { await window.__loop.run(n); return window.__loop.motor.captureRest(); }, frames(1));
  console.log(`rest: DNg02 ${rest.dng02L.toFixed(2)} / ${rest.dng02R.toFixed(2)} Hz, wing MN ${rest.wing.toFixed(2)} Hz`);
  for (const omega of [OMEGA, -OMEGA]) {
    const rows = await page.evaluate(async (omega, n) => { window.__loop.omega = omega; window.__loop.frames.length = 0; await window.__loop.run(n); window.__loop.omega = 0; return window.__loop.frames; }, omega, frames(SECONDS));
    const t = rows.map((r) => r.t), yaw = rows.map((r) => r.yaw), drum = rows.map((r, i) => omega * (i + 1) * FRAME);
    const yawRate = rows.map((r) => r.yawRate), turn = rows.map((r) => r.turnCmd);
    const c = corr(yaw, drum);
    const run = { omega, frames: rows.length, corrHeadingDrum: +c.toFixed(3), meanYawRate: +mean(yawRate).toFixed(3), finalYawDeg: +((yaw[yaw.length - 1] * 180) / Math.PI).toFixed(1), drumDeg: +((drum[drum.length - 1] * 180) / Math.PI).toFixed(1), meanTurnCmd: +mean(turn).toFixed(3), dng02: { L: +mean(rows.map((r) => r.b_dng02L)).toFixed(2), R: +mean(rows.map((r) => r.b_dng02R)).toFixed(2) }, aTurn: +mean(rows.map((r) => r.turn)).toFixed(3), follows: Math.sign(mean(yawRate)) === Math.sign(omega) };
    report.runs.push(run);
    run.dna02 = { L: +mean(rows.map((r) => r.b_dna02L)).toFixed(2), R: +mean(rows.map((r) => r.b_dna02R)).toFixed(2) };
    console.log(`\n== drum ω = ${omega} rad/s for ${SECONDS} s: fly yawed ${run.finalYawDeg}° (drum ${run.drumDeg}°), mean yaw rate ${run.meanYawRate} rad/s; corr(heading, drum phase) ${run.corrHeadingDrum}; DNg02 ${run.dng02.L}/${run.dng02.R} Hz, DNa02 ${run.dna02.L}/${run.dna02.R} Hz; [A] turn ${run.aTurn}; wing cmd turn ${run.meanTurnCmd} -> ${run.follows ? 'follows' : 'does not follow'}`);
    await page.evaluate((n) => window.__loop.run(n), frames(1));
  }
  if (!NOLOOM) {
    for (const az of [-45, 45]) {
      const rows = await page.evaluate(async (az, n) => { window.__loop.frames.length = 0; window.__loop.loom({ az: (az * Math.PI) / 180, el: 0, startDistance: 6, speed: 2, radius: 0.6, retinal: true, loop: false }); await window.__loop.run(n); window.__loop.loomStop(); return window.__loop.frames; }, az, frames(3.2));
      const roll = rows.map((r) => r.roll), yawRate = rows.map((r) => r.yawRate);
      const peakRoll = roll.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0), meanYawRate = mean(yawRate);
      const loom = { az, peakRollDeg: +((peakRoll * 180) / Math.PI).toFixed(1), meanYawRate: +meanYawRate.toFixed(3), aLoomPeak: { L: +Math.max(...rows.map((r) => r.loomL)).toFixed(3), R: +Math.max(...rows.map((r) => r.loomR)).toFixed(3) }, dnp01Peak: +Math.max(...rows.map((r) => r.b_dnp01)).toFixed(1), dng02: { L: +mean(rows.map((r) => r.b_dng02L)).toFixed(2), R: +mean(rows.map((r) => r.b_dng02R)).toFixed(2) }, banksAway: az < 0 ? peakRoll > 0.01 : peakRoll < -0.01, yawsAway: az < 0 ? meanYawRate < -0.02 : meanYawRate > 0.02 };
      report.runs.push({ loom });
      console.log(`\n== loom from ${az}°: [A] loom L/R peak ${loom.aLoomPeak.L}/${loom.aLoomPeak.R}; [B] DNp01 peak ${loom.dnp01Peak} Hz; DNg02 ${loom.dng02.L}/${loom.dng02.R} Hz; peak roll ${loom.peakRollDeg}° (+ = right wing down), mean yaw rate ${loom.meanYawRate} -> banks away ${loom.banksAway}, yaws away ${loom.yawsAway}`);
      await page.evaluate((n) => window.__loop.run(n), frames(1));
    }
  }
  const opt = report.runs.filter((r) => r.omega !== undefined);
  report.verdict = { optomotor: opt.every((r) => r.follows && r.corrHeadingDrum > 0.5), corr: opt.map((r) => r.corrHeadingDrum), loomAway: NOLOOM ? null : report.runs.filter((r) => r.loom).every((r) => r.loom.banksAway || r.loom.yawsAway) };
  report.verdict.pass = report.verdict.optomotor && (report.verdict.loomAway ?? true);
  console.log(`\nVERDICT ${report.verdict.pass ? 'PASS' : 'FAIL'}: optomotor ${report.verdict.optomotor} (corr ${report.verdict.corr.join(' / ')}), loom away ${report.verdict.loomAway}`);
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
const out = `bench/out/motor${READOUT === 'dna02' ? '-dna02' : ''}.json`;
writeFileSync(join(ROOT, out), JSON.stringify(report, null, 1));
console.log('wrote ' + out);
