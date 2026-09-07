// Closed-loop companion to bench/haltere-inject.mjs: the intact cruise under haltere sign −1 and
// +1 with every frame logged (yaw rate, DNa02 L/R, turn command), so the feedback law the loop
// actually realises can be plotted against the steady-state injection map. GPU box:
//   XVFB_SCREEN=2560x1440x24 scripts/gpu-box.sh bg "node bench/haltere-loop.mjs [--seconds 20]"
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCombinedBrowser, startVite, requireGpuTools } from './lib/browser.mjs';
import { openLoop, frames } from './lib/cruise.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECONDS = Number(arg('seconds', 20)), KEYS = ['t', 'yaw', 'yawRate', 'speed', 'collisions', 'turnCmd', 'cmdL', 'cmdR', 'b_dna02L', 'b_dna02R', 'b_dng02L', 'b_dng02R', 'b_wingMnL', 'b_wingMnR', 'spikes'];
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
requireGpuTools();
const vite = await startVite(); const browser = await launchCombinedBrowser();
const report = { seconds: SECONDS, haltereGain: 2, maxCurrent: 3, runs: {} };
for (const sign of [-1, 1]) {
  const page = await browser.newPage();
  const boot = await openLoop(page, vite.url, { readout: 'dna02', dnBias: 0.4, turnGain: 2, haltere: true, haltereSign: sign, course: true, bridge: true });
  log(`sign ${sign}: ${boot.backend}, ${boot.config?.pairs} bridge cells`);
  await page.evaluate((n) => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; return window.__loop.run(n); }, frames(3));
  await page.evaluate(async (n) => { await window.__loop.run(n); window.__loop.motor.captureRest(); window.__loop.motor.mode = 'vnc'; window.__loop.motor.setParams({ baseAmp: 0.7 }); window.__loop.resetCollisions(); }, frames(1));
  const rows = await page.evaluate(async (n, keys) => { window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))); }, frames(SECONDS), KEYS);
  const rest = await page.evaluate(() => window.__loop.motor.readout.rest);
  report.runs[sign] = { sign, rest, rows };
  const last = rows[rows.length - 1];
  log(`sign ${sign}: ${rows.length} frames, drift ${((last.yaw - rows[0].yaw) * 180 / Math.PI).toFixed(1)}°, collisions ${last.collisions}`);
  writeFileSync(join(ROOT, 'bench/out/haltere-loop.json'), JSON.stringify(report));
  await page.close();
}
log('done'); await browser.close(); vite.stop(); process.exit(0);
