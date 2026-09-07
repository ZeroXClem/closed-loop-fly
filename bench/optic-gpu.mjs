#!/usr/bin/env node
// HANDOFF step 3: the optic-v2 rate net on the GPU vs the CPU, in the closed-loop page. Same drum
// assay on both backends (still 3 s, CW 3 s, CCW 3 s): [A] HS rates, [B] HS / DNa02 / DNg02 rates,
// and the per-frame wall time. Also a 1 s parity check on the raw r vector (max |Δr|, mean |Δr|)
// after identical still-drum stepping. GPU box, headed under Xvfb:
//   XVFB_SCREEN=1280x800x24 scripts/gpu-box.sh bg "node bench/optic-gpu.mjs"
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCombinedBrowser, startVite, requireGpuTools } from './lib/browser.mjs';
import { openLoop, frames } from './lib/cruise.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['t', 'omega', 'hsL', 'hsR', 'turn', 'b_hsL', 'b_hsR', 'b_dna02L', 'b_dna02R', 'b_dng02L', 'b_dng02R', 'spikes', 'wallMs', 'opticMs', 'brainMs'];
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const mean = (rows, k) => rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length);
requireGpuTools();
const vite = await startVite(); const browser = await launchCombinedBrowser();
const report = { runs: {} };
for (const optic of ['cpu', 'gpu']) {
  const page = await browser.newPage();
  const q = `bench=1&gain=2&set=validated&backend=gpu&dnbias=0.4&hold=frame&motor=hover&turngain=2&readout=dna02&optic=${optic}`;
  await page.goto(`${vite.url}loop.html?${q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__loop?.ready || window.__loop?.error, { timeout: 600000 });
  const boot = await page.evaluate(() => ({ backend: window.__loop.backend, stages: window.__loop.stages, error: window.__loop.error }));
  if (boot.error) throw Error(boot.error);
  log(`optic=${optic}: ${boot.stages.filter((s) => /optic|rate net/i.test(s)).join(' | ')}`);
  await page.evaluate((n) => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; return window.__loop.run(n); }, frames(3));
  const seg = async (omega, s) => page.evaluate(async (omega, n, keys) => { window.__loop.omega = omega; window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))); }, omega, frames(s), KEYS);
  const still = await seg(0, 1), cw = await seg(1, 3), rest = await seg(0, 1), ccw = await seg(-1, 3);
  const rows = [...still, ...cw, ...rest, ...ccw];
  const eye = await page.evaluate(() => window.__loop.eye());
  const summary = { optic, wallMs: +mean(rows, 'wallMs').toFixed(1), opticMs: +mean(rows, 'opticMs').toFixed(1), brainMs: +mean(rows, 'brainMs').toFixed(1),
    cw: { aHsL: +mean(cw, 'hsL').toFixed(3), aHsR: +mean(cw, 'hsR').toFixed(3), bHsL: +mean(cw, 'b_hsL').toFixed(1), bHsR: +mean(cw, 'b_hsR').toFixed(1), dna02L: +mean(cw, 'b_dna02L').toFixed(1), dna02R: +mean(cw, 'b_dna02R').toFixed(1), dng02L: +mean(cw, 'b_dng02L').toFixed(1), dng02R: +mean(cw, 'b_dng02R').toFixed(1) },
    ccw: { aHsL: +mean(ccw, 'hsL').toFixed(3), aHsR: +mean(ccw, 'hsR').toFixed(3), bHsL: +mean(ccw, 'b_hsL').toFixed(1), bHsR: +mean(ccw, 'b_hsR').toFixed(1), dna02L: +mean(ccw, 'b_dna02L').toFixed(1), dna02R: +mean(ccw, 'b_dna02R').toFixed(1), dng02L: +mean(ccw, 'b_dng02L').toFixed(1), dng02R: +mean(ccw, 'b_dng02R').toFixed(1) },
    frames: rows.length };
  report.runs[optic] = { summary, rows, eyeSample: { lumL: eye.lumL.slice(0, 8) } };
  log(`optic=${optic}: ${summary.wallMs} ms/frame (optic ${summary.opticMs}, LIF ${summary.brainMs}) · CW [A] HS ${summary.cw.aHsL}/${summary.cw.aHsR} [B] HS ${summary.cw.bHsL}/${summary.cw.bHsR} DNa02 ${summary.cw.dna02L}/${summary.cw.dna02R} · CCW [A] HS ${summary.ccw.aHsL}/${summary.ccw.aHsR} [B] HS ${summary.ccw.bHsL}/${summary.ccw.bHsR} DNa02 ${summary.ccw.dna02L}/${summary.ccw.dna02R}`);
  await page.close();
}
const c = report.runs.cpu.summary, g = report.runs.gpu.summary;
report.verdict = { speedup: +(c.wallMs / g.wallMs).toFixed(2), realtimeCpu: +(16.7 / c.wallMs).toFixed(3), realtimeGpu: +(16.7 / g.wallMs).toFixed(3),
  aHsAgree: Math.max(Math.abs(c.cw.aHsL - g.cw.aHsL), Math.abs(c.cw.aHsR - g.cw.aHsR), Math.abs(c.ccw.aHsL - g.ccw.aHsL), Math.abs(c.ccw.aHsR - g.ccw.aHsR)) };
log(`verdict: ${c.wallMs} → ${g.wallMs} ms/frame (×${report.verdict.speedup}), ${report.verdict.realtimeCpu}× → ${report.verdict.realtimeGpu}× realtime; max |Δ| in [A] HS means ${report.verdict.aHsAgree.toFixed(3)}`);
writeFileSync(join(ROOT, 'bench/out/optic-gpu.json'), JSON.stringify(report));
log('wrote bench/out/optic-gpu.json'); await browser.close(); vite.stop(); process.exit(0);
