#!/usr/bin/env node
// Neuromodulation as flight state: octopamine raises the gain of the lobula-plate tangential
// cells in flight (Suver 2012, Jung 2011, Maimon 2010, about 2x). Apply that gain to every synapse
// onto an LPTC in the optic net (`?flight=`), keep everything else as published, and ask two things
// under the artefact-free readout (gate on, re-centring 10 s):
//   1. does the loop hold heading better (20 s cruise: drift, collisions, wobble)?
//   2. does DNg02 lateralise once the visual drive is at flight strength (drum DSI)?
//   XVFB_SCREEN=1280x800x24 scripts/gpu-box.sh bg "node bench/flight-gain.mjs [--gains 1,2,3] [--seconds 20] [--adapt 0.5,300]"
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCombinedBrowser, startVite, requireGpuTools } from './lib/browser.mjs';
import { openLoop, cruise, frames, fmt } from './lib/cruise.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAINS = arg('gains', '1,2,3').split(',').map(Number), SECONDS = Number(arg('seconds', 20)), ADAPT = arg('adapt', ''), TAG = arg('tag', '');
const KEYS = ['t', 'omega', 'hsL', 'hsR', 'turn', 'b_hsL', 'b_hsR', 'b_dna02L', 'b_dna02R', 'b_dng02L', 'b_dng02R', 'spikes'];
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const mean = (rows, k) => rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length);
requireGpuTools();
const vite = await startVite(); const browser = await launchCombinedBrowser();
const common = { readout: 'dna02', dnBias: 0.4, turnGain: 2, haltere: true, haltereSign: -1, course: true, bridge: true, gate: 1, recenter: 10, adapt: ADAPT };
const report = { gains: GAINS, seconds: SECONDS, adapt: ADAPT, readout: 'dna02, gate on, recenter 10 s', runs: [] };
for (const flight of GAINS) {
  // drum assay
  let page = await browser.newPage();
  let boot = await openLoop(page, vite.url, { ...common, flight });
  if (boot.backend !== 'gpu') throw Error(`LIF fell back to ${boot.backend}: ` + (await page.evaluate(() => window.__loop.stages.filter((s) => /fallback|error/i.test(s)).join(' | '))));
  log(`flight ${flight}: ${boot.backend}; stages: ${(await page.evaluate(() => window.__loop.stages)).filter((s) => /flight|adapt/i.test(s)).join(' | ') || 'no flight stage (gain 1)'}`);
  await page.evaluate((n) => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; return window.__loop.run(n); }, frames(3));
  const seg = async (omega, s) => page.evaluate(async (omega, n, keys) => { window.__loop.omega = omega; window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))); }, omega, frames(s), KEYS);
  await seg(0, 1); const cw = await seg(1, 3); await seg(0, 1); const ccw = await seg(-1, 3);
  const d = (rows) => ({ aHsL: +mean(rows, 'hsL').toFixed(3), aHsR: +mean(rows, 'hsR').toFixed(3), bHsL: +mean(rows, 'b_hsL').toFixed(1), bHsR: +mean(rows, 'b_hsR').toFixed(1), dna02L: +mean(rows, 'b_dna02L').toFixed(1), dna02R: +mean(rows, 'b_dna02R').toFixed(1), dng02L: +mean(rows, 'b_dng02L').toFixed(1), dng02R: +mean(rows, 'b_dng02R').toFixed(1), spikes: +mean(rows, 'spikes').toFixed(0) });
  const drum = { cw: d(cw), ccw: d(ccw) };
  const dsi = (L, R) => (L.cw - L.ccw) / Math.max(1e-6, L.cw + L.ccw);
  drum.dng02Dsi = { L: +dsi({ cw: drum.cw.dng02L, ccw: drum.ccw.dng02L }).toFixed(3), R: +dsi({ cw: drum.cw.dng02R, ccw: drum.ccw.dng02R }).toFixed(3) };
  drum.dna02Dsi = { L: +dsi({ cw: drum.cw.dna02L, ccw: drum.ccw.dna02L }).toFixed(3), R: +dsi({ cw: drum.cw.dna02R, ccw: drum.ccw.dna02R }).toFixed(3) };
  log(`   drum CW: [A] HS ${drum.cw.aHsL}/${drum.cw.aHsR} [B] HS ${drum.cw.bHsL}/${drum.cw.bHsR} DNa02 ${drum.cw.dna02L}/${drum.cw.dna02R} DNg02 ${drum.cw.dng02L}/${drum.cw.dng02R} · CCW: [A] HS ${drum.ccw.aHsL}/${drum.ccw.aHsR} [B] HS ${drum.ccw.bHsL}/${drum.ccw.bHsR} DNa02 ${drum.ccw.dna02L}/${drum.ccw.dna02R} DNg02 ${drum.ccw.dng02L}/${drum.ccw.dng02R} · DSI DNg02 ${drum.dng02Dsi.L}/${drum.dng02Dsi.R}, DNa02 ${drum.dna02Dsi.L}/${drum.dna02Dsi.R}`);
  await page.close();
  // cruise
  page = await browser.newPage();
  await openLoop(page, vite.url, { ...common, flight });
  const c = await cruise(page, { seconds: SECONDS, baseAmp: 0.7 });
  log(`   cruise: ${fmt(c)}`);
  await page.close();
  report.runs.push({ flight, drum, cruise: c });
  writeFileSync(join(ROOT, `bench/out/flight-gain${TAG}.json`), JSON.stringify(report, null, 1));
}
console.log('\n| flight gain | drum: [A] HS L/R CW | [B] HS L/R CW | DNa02 DSI L/R | DNg02 DSI L/R | cruise drift | collisions | wobble |\n| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of report.runs) console.log(`| ${r.flight} | ${r.drum.cw.aHsL} / ${r.drum.cw.aHsR} | ${r.drum.cw.bHsL} / ${r.drum.cw.bHsR} | ${r.drum.dna02Dsi.L} / ${r.drum.dna02Dsi.R} | ${r.drum.dng02Dsi.L} / ${r.drum.dng02Dsi.R} | ${r.cruise.driftDeg}° | ${r.cruise.collisions} | ${r.cruise.wobbleRadS} rad/s |`);
log(`wrote bench/out/flight-gain${TAG}.json`); await browser.close(); vite.stop(); process.exit(0);
