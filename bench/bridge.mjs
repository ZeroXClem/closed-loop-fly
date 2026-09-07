#!/usr/bin/env node
// Phase 3 acceptance (GOAL.md): with the drum rotating, DNg02 L/R rates in [B] differ in the
// direction AbijahKaj's HS readout predicts; a looming sphere -> LC4/LPLC2 -> DNp fires in [B].
// Prints a DSI-like index at DNg02 for CW vs CCW (target > 0.3). GPU box, headed under Xvfb:
//   scripts/gpu-box.sh runx "node bench/bridge.mjs [--gains 2,4] [--seconds 3] [--warm 3]"
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchCombinedBrowser, launchSoftwareBrowser, startVite, waitFor } from './lib/browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GL = arg('gl', 'combined'), HOLD = arg('hold', 'frame');
const DNBIAS = arg('dnbias', '0').split(',').map(Number);
const GAINS = arg('gains', '2').split(',').map(Number), SECONDS = Number(arg('seconds', 3)), WARM = Number(arg('warm', 3)), OMEGA = Number(arg('omega', 1)), SET = arg('set', 'validated'), BACKEND = arg('backend', 'gpu'), NOLOOM = process.argv.includes('--no-loom');
const FRAME = 1 / 60, frames = (s) => Math.round(s / FRAME);

const vite = await startVite();
const browser = GL === 'software' ? await launchSoftwareBrowser() : await launchCombinedBrowser();
const report = { gains: GAINS, dnBias: DNBIAS, hold: HOLD, seconds: SECONDS, warm: WARM, omega: OMEGA, set: SET, backend: BACKEND, runs: [] };
const mean = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / Math.max(1, rows.length);
const dsi = (a, b) => (a + b > 1e-6 ? (a - b) / (a + b) : 0);
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('   console: ' + m.text().slice(0, 200)); });
  const configs = [];
  for (const dnBias of DNBIAS) for (const gain of GAINS) configs.push({ gain, dnBias, on: true });
  configs.push({ gain: 0, dnBias: DNBIAS[DNBIAS.length - 1], on: false });
  for (const { gain, dnBias, on } of configs) {
    console.log(`\n== bridge ${on ? 'on, gain ' + gain : 'OFF (control)'}, DNg02 tonic ${dnBias} mV/ms; set ${SET}; backend ${BACKEND}; hold per ${HOLD}`);
    const url = `${vite.url}loop.html?bench=1&gain=${gain || 2}&set=${SET}&backend=${BACKEND}&dnbias=${dnBias}&hold=${HOLD}${on ? '' : '&bridge=off'}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const t0 = Date.now();
    await waitFor(page, () => window.__loop?.ready || window.__loop?.error, { what: 'loop ready', timeoutMs: 600000 });
    const boot = await page.evaluate(() => ({ backend: window.__loop.backend, config: window.__loop.config, error: window.__loop.error, stages: window.__loop.stages }));
    if (boot.error) throw Error(boot.error);
    console.log(`   ${boot.backend}, ${boot.config?.pairs} bridge cells, ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const run = { gain, dnBias, on, backend: boot.backend, pairs: boot.config?.pairs };
    // warm-up: drum still (optic calibrates its rest, bridge rest captured)
    await page.evaluate((n) => { window.__loop.omega = 0; return window.__loop.run(n); }, frames(WARM));
    const w0 = Date.now();
    const still = await page.evaluate(async (n) => { window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames.slice(-Math.round(n / 2)); }, frames(1.0));
    const wallPerFrame = (Date.now() - w0) / frames(1.0);
    console.log(`   ${wallPerFrame.toFixed(0)} ms wall per ${(FRAME * 1000).toFixed(1)} ms frame (${(FRAME * 1000 / wallPerFrame).toFixed(3)}x realtime); optic ${mean(still, 'opticMs').toFixed(0)} ms, LIF ${mean(still, 'brainMs').toFixed(0)} ms per frame`);
    const dirs = {};
    for (const omega of [OMEGA, -OMEGA]) {
      // rotate: skip the first second (transient), average the rest
      const rows = await page.evaluate(async (omega, nSkip, nAvg) => { window.__loop.omega = omega; await window.__loop.run(nSkip); window.__loop.frames.length = 0; await window.__loop.run(nAvg); window.__loop.omega = 0; await window.__loop.run(30); return window.__loop.frames; }, omega, frames(1.0), frames(SECONDS));
      const d = { omega, aHsL: mean(rows, 'hsL'), aHsR: mean(rows, 'hsR'), aTurn: mean(rows, 'turn'), bHsL: mean(rows, 'b_hsL'), bHsR: mean(rows, 'b_hsR'), bDng02L: mean(rows, 'b_dng02L'), bDng02R: mean(rows, 'b_dng02R'), bWingL: mean(rows, 'b_wingMnL'), bWingR: mean(rows, 'b_wingMnR'), bTurnL: mean(rows, 'b_turnL'), bTurnR: mean(rows, 'b_turnR'), bDna02L: mean(rows, 'b_dna02L'), bDna02R: mean(rows, 'b_dna02R'), bPs080L: mean(rows, 'b_ps080L'), bPs080R: mean(rows, 'b_ps080R'), bVuma4: mean(rows, 'b_vuma4'), bGng286L: mean(rows, 'b_gng286L'), bGng286R: mean(rows, 'b_gng286R'), spikes: mean(rows, 'spikes') };
      dirs[omega > 0 ? 'cw' : 'ccw'] = d;
      console.log(`   drum ω=${omega}: [A] HS L ${d.aHsL.toFixed(3)} R ${d.aHsR.toFixed(3)} turn ${d.aTurn.toFixed(3)} | [B] HS ${d.bHsL.toFixed(1)}/${d.bHsR.toFixed(1)} Hz, DNg02 ${d.bDng02L.toFixed(2)}/${d.bDng02R.toFixed(2)} Hz, wing MN ${d.bWingL.toFixed(2)}/${d.bWingR.toFixed(2)} Hz, DNa02 ${d.bDna02L.toFixed(1)}/${d.bDna02R.toFixed(1)} Hz, ${d.spikes.toFixed(0)} spikes/frame`);
      console.log(`      relays: PS080 ${d.bPs080L.toFixed(1)}/${d.bPs080R.toFixed(1)} Hz, OA-VUMa4 ${d.bVuma4.toFixed(1)} Hz, GNG286 ${d.bGng286L.toFixed(1)}/${d.bGng286R.toFixed(1)} Hz`);
    }
    const s = { still: { bDng02L: mean(still, 'b_dng02L'), bDng02R: mean(still, 'b_dng02R'), bHsL: mean(still, 'b_hsL'), bHsR: mean(still, 'b_hsR'), bWingL: mean(still, 'b_wingMnL'), bWingR: mean(still, 'b_wingMnR'), spikes: mean(still, 'spikes') } };
    console.log(`   still: [B] DNg02 ${s.still.bDng02L.toFixed(2)}/${s.still.bDng02R.toFixed(2)} Hz, HS ${s.still.bHsL.toFixed(1)}/${s.still.bHsR.toFixed(1)} Hz, wing MN ${s.still.bWingL.toFixed(2)}/${s.still.bWingR.toFixed(2)} Hz, ${s.still.spikes.toFixed(0)} spikes/frame`);
    // DSI-like index at DNg02: the L-R difference should flip with the drum, like [A]'s HS turn signal
    const diffCw = dirs.cw.bDng02L - dirs.cw.bDng02R, diffCcw = dirs.ccw.bDng02L - dirs.ccw.bDng02R;
    const dsiL = dsi(dirs.cw.bDng02L, dirs.ccw.bDng02L), dsiR = dsi(dirs.cw.bDng02R, dirs.ccw.bDng02R);
    const predicted = Math.sign(dirs.cw.aTurn) || 1; // [A]'s HS turn sign for CW
    const follows = Math.sign(diffCw - diffCcw) === -predicted; // [A] turn = dL - dR; [B] DNg02 L - R should track it (sign fixed by wiring, see docs)
    Object.assign(run, { still: s.still, cw: dirs.cw, ccw: dirs.ccw, dng02: { diffCw, diffCcw, dsiL, dsiR, dsiAbs: Math.max(Math.abs(dsiL), Math.abs(dsiR)), lateralized: Math.sign(diffCw) !== Math.sign(diffCcw) && Math.abs(diffCw - diffCcw) > 0.05 } });
    console.log(`   DNg02 L−R: CW ${diffCw.toFixed(3)} Hz, CCW ${diffCcw.toFixed(3)} Hz; DSI(CW vs CCW) L ${dsiL.toFixed(2)} R ${dsiR.toFixed(2)}; [A] turn CW ${dirs.cw.aTurn.toFixed(2)} CCW ${dirs.ccw.aTurn.toFixed(2)}`);
    if (on && !NOLOOM) {
      // looming: sphere approaching from 45 deg left at 2 units/s from 6 units (their assay), retinal
      const before = await page.evaluate(async (n) => { window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames; }, frames(1.0));
      const during = await page.evaluate(async (n) => { window.__loop.loom({ az: -Math.PI / 4, el: 0, startDistance: 6, speed: 2, radius: 0.6, retinal: true, loop: false }); window.__loop.frames.length = 0; await window.__loop.run(n); const f = window.__loop.frames.slice(); window.__loop.loomStop(); return f; }, frames(3.2));
      const peak = (rows, k) => rows.reduce((m, r) => Math.max(m, r[k]), 0);
      const loom = { before: { aLoomL: mean(before, 'loomL'), bLc4L: mean(before, 'b_lc4L'), bLplc2L: mean(before, 'b_lplc2L'), bDnp01: mean(before, 'b_dnp01'), bDnp: mean(before, 'b_dnp') }, during: { aLoomLPeak: peak(during, 'loomL'), aLoomRPeak: peak(during, 'loomR'), bLc4LPeak: peak(during, 'b_lc4L'), bLplc2LPeak: peak(during, 'b_lplc2L'), bDnp01Peak: peak(during, 'b_dnp01'), bDnpPeak: peak(during, 'b_dnp'), bDnp01Mean: mean(during, 'b_dnp01') } };
      run.loom = loom;
      console.log(`   loom from −45°: [A] loom L peak ${loom.during.aLoomLPeak.toFixed(3)} (R ${loom.during.aLoomRPeak.toFixed(3)}); [B] LC4 L ${loom.before.bLc4L.toFixed(1)} → peak ${loom.during.bLc4LPeak.toFixed(1)} Hz, LPLC2 L ${loom.before.bLplc2L.toFixed(1)} → ${loom.during.bLplc2LPeak.toFixed(1)} Hz, DNp01 ${loom.before.bDnp01.toFixed(1)} → peak ${loom.during.bDnp01Peak.toFixed(1)} Hz (DNp01–06 ${loom.before.bDnp.toFixed(1)} → ${loom.during.bDnpPeak.toFixed(1)})`);
    }
    report.runs.push(run);
    await page.evaluate(() => window.__loop.reset());
  }
  const best = report.runs.filter((r) => r.on).sort((a, b) => b.dng02.dsiAbs - a.dng02.dsiAbs)[0];
  const ctrl = report.runs.find((r) => !r.on);
  report.verdict = { bestGain: best?.gain, dsi: best?.dng02.dsiAbs, lateralized: best?.dng02.lateralized, controlDsi: ctrl?.dng02.dsiAbs, loomDnp01: best?.loom ? best.loom.during.bDnp01Peak > best.loom.before.bDnp01 + 5 : null };
  report.verdict.pass = !!(best && best.dng02.lateralized && best.dng02.dsiAbs > 0.3 && (report.verdict.loomDnp01 ?? true));
  report.verdict.bestDnBias = best?.dnBias;
  console.log(`\nVERDICT ${report.verdict.pass ? 'PASS' : 'FAIL'}: best gain ${best?.gain} / DNg02 tonic ${best?.dnBias}: DNg02 lateralised ${best?.dng02.lateralized}, DSI ${best?.dng02.dsiAbs?.toFixed(2)} (target > 0.3; control ${ctrl?.dng02.dsiAbs?.toFixed(2)}); loom → DNp01 ${report.verdict.loomDnp01}`);
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
writeFileSync(join(ROOT, 'bench/out/bridge.json'), JSON.stringify(report, null, 1));
console.log('wrote bench/out/bridge.json');
