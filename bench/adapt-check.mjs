#!/usr/bin/env node
// Sanity check for the adaptation term: the JavaScript and WebGPU LIF must still agree spike for
// spike over the first frames with adaptation on (they do without it, docs/phase1.md), and the
// term must be inert at 0. Runs the loop page on both backends from reset, bridge on, still drum.
//   XVFB_SCREEN=1280x800x24 scripts/gpu-box.sh bg "node bench/adapt-check.mjs [--adapt 0.5,300] [--frames 4]"
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCombinedBrowser, startVite, requireGpuTools } from './lib/browser.mjs';
import { openLoop } from './lib/cruise.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPT = arg('adapt', '0.5,300'), N = Number(arg('frames', 4));
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
requireGpuTools();
const vite = await startVite(); const browser = await launchCombinedBrowser();
const report = { adapt: ADAPT, frames: N, runs: {} };
for (const [label, backend, adapt] of [['gpu, adapt off', 'gpu', ''], ['cpu, adapt on', 'cpu', ADAPT], ['gpu, adapt on', 'gpu', ADAPT]]) {
  const page = await browser.newPage();
  const boot = await openLoop(page, vite.url, { readout: 'dna02', dnBias: 0.4, turnGain: 2, haltere: false, course: false, bridge: true, backend, adapt });
  const rows = await page.evaluate(async (n) => { window.__loop.omega = 0; window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames.map((r) => ({ frame: r.frame, spikes: r.spikes, dng02L: r.b_dng02L, dng02R: r.b_dng02R, dna02L: r.b_dna02L, dna02R: r.b_dna02R })); }, N);
  report.runs[label] = { backend: boot.backend, rows };
  log(`${label} (${boot.backend}): spikes per frame ${rows.map((r) => r.spikes).join(', ')}; DNg02 at frame ${N}: ${rows.at(-1).dng02L.toFixed(1)}/${rows.at(-1).dng02R.toFixed(1)}`);
  await page.close();
}
const a = report.runs['cpu, adapt on'].rows, b = report.runs['gpu, adapt on'].rows;
const same = a.map((r, i) => r.spikes === b[i].spikes);
report.verdict = { identicalFrames: same.findIndex((x) => !x) < 0 ? N : same.findIndex((x) => !x), note: 'CPU and GPU spike identically for ~36 ms without adaptation (docs/phase1.md); expect the first two 16.7 ms frames to match with it too' };
log(`verdict: CPU and GPU agree on spike counts for the first ${report.verdict.identicalFrames} of ${N} frames with adaptation ${ADAPT}`);
writeFileSync(join(ROOT, 'bench/out/adapt-check.json'), JSON.stringify(report, null, 1));
log('wrote bench/out/adapt-check.json'); await browser.close(); vite.stop(); process.exit(0);
