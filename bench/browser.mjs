#!/usr/bin/env node
// Phase 1 acceptance on the GPU: boots the app headless (Vite + Brave/Chromium, WebGPU), runs
// the worker's CPU-vs-GPU parity check (now covering injected current), then fires the Fly
// preset through the Poisson path and the inject path and reports the escape channel,
// takeoff, and throughput of the 166.7k-neuron LIF on this GPU.
//
//   node bench/browser.mjs [--seconds 1.0] [--modes poisson,inject] [--gain 1] [--backend gpu|cpu]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchBrowser, startVite, waitFor, sleep, requireGpuTools } from './lib/browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', 1.0)), MODES = arg('modes', 'poisson,inject').split(','), GAIN = Number(arg('gain', 1)), BACKEND = arg('backend', 'gpu');

const tools = requireGpuTools();
console.log(`browser ${tools.exe}; vulkan ${tools.vulkan}`);
const vite = await startVite();
const browser = await launchBrowser();
const report = { seconds: SECONDS, gain: GAIN, runs: [] };
try {
  for (const mode of MODES) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const url = `${vite.url}?stimulus=${mode}&gain=${GAIN}`;
    console.log(`\n== ${mode}  ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (BACKEND === 'cpu') await page.select('#backend', 'cpu').catch(() => {});
    await page.waitForSelector('#setup-button', { timeout: 30000 });
    await page.click('#setup-button');
    const t0 = Date.now();
    await waitFor(page, () => window.__closedLoop?.ready || window.__closedLoop?.stages.some((s) => s.startsWith('error')), { what: 'worker ready' });
    const boot = await page.evaluate(() => ({ backend: window.__closedLoop.backend, stages: window.__closedLoop.stages }));
    console.log(`   backend ${boot.backend}, ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const s of boot.stages) if (/WebGPU matches|fallback|error/.test(s)) console.log('   ' + s);
    // baseline: let the pacing settle, then stimulate
    await waitFor(page, () => window.__closedLoop.results.length >= 30, { what: 'baseline results' });
    const start = await page.evaluate(() => { const r = window.__closedLoop.results; const last = r[r.length - 1]; window.__closedLoop.results.length = 0; window.__closedLoop.preset('escape'); return last.tick; });
    const endTick = start + Math.round(SECONDS * 10000);
    await waitFor(page, (endTick) => { const r = window.__closedLoop.results; return r.length && r[r.length - 1].tick >= endTick; }, { what: 'stimulus window' , timeoutMs: 60000 + SECONDS * 20000 }).catch((e) => console.log('   ' + e.message));
    const rows = await page.evaluate(() => window.__closedLoop.results);
    if (!rows.length) throw Error('no results');
    let peak = 0, peakT = 0, trigger = null, spikes = 0, wallSum = 0, yMax = 0; const behaviors = new Set();
    for (const r of rows) { const t = (r.tick - start) * 0.1; if (r.rates[5] > peak) { peak = r.rates[5]; peakT = t; } if (trigger === null && r.rates[5] > 100) trigger = t; spikes += r.total; wallSum += r.wallMs; yMax = Math.max(yMax, r.y); behaviors.add(r.behavior); }
    const neuralMs = (rows[rows.length - 1].tick - rows[0].tick) * 0.1, elapsedMs = rows[rows.length - 1].at - rows[0].at;
    const run = { mode, backend: boot.backend, batches: rows.length, neuralMs: +neuralMs.toFixed(0), realtime: +(neuralMs / elapsedMs).toFixed(2), gpuMsPerBatch: +(wallSum / rows.length).toFixed(2), capacity: +((rows[0].steps * 0.1) / (wallSum / rows.length)).toFixed(2), peakEscapeHz: +peak.toFixed(1), peakAtMs: +peakT.toFixed(0), triggerMs: trigger, spikes, yMaxMm: +yMax.toFixed(2), behaviors: [...behaviors], errors, parity: boot.stages.find((s) => s.startsWith('WebGPU matches')) ?? null };
    report.runs.push(run);
    console.log(`   ${run.batches} batches, ${run.neuralMs} ms neural; paced ${run.realtime}× realtime; compute ${run.gpuMsPerBatch} ms per ${rows[0].steps}-tick batch => capacity ${run.capacity}× realtime`);
    console.log(`   escape peak ${run.peakEscapeHz} Hz at ${run.peakAtMs} ms; >100 Hz first at ${run.triggerMs ?? 'never'} ms; max height ${run.yMaxMm} mm; behaviours ${run.behaviors.join(' | ')}; ${run.spikes} spikes`);
    if (errors.length) console.log('   errors: ' + errors.slice(0, 5).join('\n           '));
    await page.close();
  }
  const ref = report.runs.find((r) => r.mode === 'poisson'), inj = report.runs.find((r) => r.mode === 'inject');
  if (ref && inj) {
    const ratio = ref.peakEscapeHz ? inj.peakEscapeHz / ref.peakEscapeHz : NaN;
    const took = (r) => r.behaviors.some((b) => /Taking off|Escape flight|Landing/.test(b));
    report.verdict = { ratio: +ratio.toFixed(2), takeoffPoisson: took(ref), takeoffInject: took(inj), pass: took(ref) && took(inj) && ratio >= 0.5 && ratio <= 2 };
    console.log(`\nVERDICT  peak ratio inject/poisson ${report.verdict.ratio}; takeoff poisson ${report.verdict.takeoffPoisson} inject ${report.verdict.takeoffInject} -> ${report.verdict.pass ? 'PASS' : 'FAIL'}`);
  }
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
writeFileSync(join(ROOT, 'bench/out/browser.json'), JSON.stringify(report, null, 1));
console.log('wrote bench/out/browser.json');
