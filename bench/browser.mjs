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
const READY_TIMEOUT_MS = Number(arg('ready-timeout', 300)) * 1000;
const SECONDS = Number(arg('seconds', 1.0)), MODES = arg('modes', 'poisson,inject').split(','), GAIN = Number(arg('gain', 1)), BACKEND = arg('backend', 'gpu'), STEPS = Number(arg('steps', 100));

const tools = requireGpuTools();
console.log(`browser ${tools.exe}; vulkan ${tools.vulkan}`);
const vite = await startVite();
const browser = await launchBrowser();
const report = { seconds: SECONDS, gain: GAIN, backend: BACKEND, steps: STEPS, runs: [] };
try {
  for (const mode of MODES) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300) + (m.location()?.url ? ' @ ' + m.location().url.slice(0, 120) : '')); });
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url().slice(0, 160) + ' ' + (r.failure()?.errorText ?? '')));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().slice(0, 160)}`); });
    const url = `${vite.url}?stimulus=${mode}&gain=${GAIN}&steps=${STEPS}`;
    console.log(`\n== ${mode}  ${url}`);
    // Trace failing fetches with their URL and stack (the app reports only "Failed to fetch").
    await page.evaluateOnNewDocument(() => {
      const f = window.fetch;
      window.fetch = async function (...a) {
        try { return await f.apply(this, a); } catch (e) { console.error(`fetch(${String(a[0]).slice(0, 120)}) failed: ${e.message}\n${e.stack}`); throw e; }
      };
      window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection: ' + (e.reason?.stack ?? e.reason)));
    });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) errors.push('navigated: ' + f.url().slice(0, 120)); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (BACKEND === 'cpu') await page.select('#backend', 'cpu').catch(() => {});
    await page.waitForSelector('#setup-button', { timeout: 30000 });
    await page.click('#setup-button');
    const t0 = Date.now();
    // stream the worker's stage messages while waiting, and dump everything on a timeout
    let shown = 0;
    const progress = async () => {
      const st = await page.evaluate(() => ({ stages: window.__closedLoop?.stages ?? [], status: document.getElementById('status')?.textContent + ' · ' + document.getElementById('status-detail')?.textContent, setup: document.getElementById('setup-status')?.textContent + ' · ' + document.getElementById('setup-detail')?.textContent })).catch(() => null);
      if (!st) return;
      for (; shown < st.stages.length; shown++) console.log(`   [${((Date.now() - t0) / 1000).toFixed(0)}s] stage: ${st.stages[shown]}`);
      return st;
    };
    try {
      for (let waited = 0; ; waited += 2000) {
        const ready = await page.evaluate(() => window.__closedLoop?.ready || window.__closedLoop?.stages.some((s) => s.startsWith('error')));
        await progress();
        if (ready) break;
        if (waited > READY_TIMEOUT_MS) throw Error('timeout waiting for worker ready');
        await sleep(2000);
      }
    } catch (e) {
      const st = await progress();
      console.log(`   ${e.message}; status: ${st?.status}; setup: ${st?.setup}`);
      if (errors.length) console.log('   errors: ' + errors.slice(0, 8).join('\n           '));
      await page.close();
      report.runs.push({ mode, error: e.message, errors, stages: st?.stages });
      continue;
    }
    const boot = await page.evaluate(() => ({ backend: window.__closedLoop.backend, stages: window.__closedLoop.stages }));
    console.log(`   backend ${boot.backend}, ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const s of boot.stages) if (/WebGPU matches|fallback|error/.test(s)) console.log('   ' + s);
    // baseline: let the pacing settle, then stimulate
    await waitFor(page, () => window.__closedLoop.results.length >= 30, { what: 'baseline results' });
    // baseline: compute cost with nothing painted
    const base = await page.evaluate(() => { const r = window.__closedLoop.results; return { n: r.length, wallMs: r.reduce((a, x) => a + x.wallMs, 0) / r.length, spikes: r.reduce((a, x) => a + x.total, 0) / r.length, steps: r[0].steps }; });
    console.log(`   baseline: ${base.wallMs.toFixed(2)} ms compute per ${base.steps}-tick batch (${((base.steps * 0.1) / base.wallMs).toFixed(2)}× realtime capacity), ${base.spikes.toFixed(0)} spikes/batch`);
    const start = await page.evaluate(() => { const r = window.__closedLoop.results; const last = r[r.length - 1]; window.__closedLoop.results.length = 0; window.__closedLoop.preset('escape'); return last.tick; });
    const endTick = start + Math.round(SECONDS * 10000);
    await waitFor(page, (endTick) => { const r = window.__closedLoop.results; return r.length && r[r.length - 1].tick >= endTick; }, { what: 'stimulus window', timeoutMs: 60000 + SECONDS * 30000, arg: endTick }).catch((e) => console.log('   ' + e.message));
    const rows = (await page.evaluate(() => window.__closedLoop.results)).filter((r) => r.tick <= endTick);
    if (!rows.length) throw Error('no results');
    let peak = 0, peakT = 0, trigger = null, spikes = 0, wallSum = 0, yMax = 0; const behaviors = new Set();
    for (const r of rows) { const t = (r.tick - start) * 0.1; if (r.rates[5] > peak) { peak = r.rates[5]; peakT = t; } if (trigger === null && r.rates[5] > 100) trigger = t; spikes += r.total; wallSum += r.wallMs; yMax = Math.max(yMax, r.y); behaviors.add(r.behavior); }
    const neuralMs = (rows[rows.length - 1].tick - rows[0].tick) * 0.1, elapsedMs = rows[rows.length - 1].at - rows[0].at;
    const half = rows.filter((r) => (r.tick - start) * 0.1 <= 500), late = rows.filter((r) => (r.tick - start) * 0.1 > 500);
    const per = (a) => (a.length ? +(a.reduce((s, r) => s + r.total, 0) / a.length).toFixed(0) : null);
    const run = { mode, backend: boot.backend, batches: rows.length, baseline: base, spikesPerBatchFirst500ms: per(half), spikesPerBatchAfter500ms: per(late), neuralMs: +neuralMs.toFixed(0), realtime: +(neuralMs / elapsedMs).toFixed(2), gpuMsPerBatch: +(wallSum / rows.length).toFixed(2), capacity: +((rows[0].steps * 0.1) / (wallSum / rows.length)).toFixed(2), peakEscapeHz: +peak.toFixed(1), peakAtMs: +peakT.toFixed(0), triggerMs: trigger, spikes, yMaxMm: +yMax.toFixed(2), behaviors: [...behaviors], errors, parity: boot.stages.find((s) => s.startsWith('WebGPU matches')) ?? null };
    report.runs.push(run);
    console.log(`   ${run.batches} batches, ${run.neuralMs} ms neural; paced ${run.realtime}× realtime; compute ${run.gpuMsPerBatch} ms per ${rows[0].steps}-tick batch => capacity ${run.capacity}× realtime`);
    console.log(`   escape peak ${run.peakEscapeHz} Hz at ${run.peakAtMs} ms; >100 Hz first at ${run.triggerMs ?? 'never'} ms; max height ${run.yMaxMm} mm; behaviours ${run.behaviors.join(' | ')}`);
    console.log(`   spikes/batch: first 500 ms ${run.spikesPerBatchFirst500ms}, after ${run.spikesPerBatchAfter500ms}; total ${run.spikes}`);
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
const out = `bench/out/browser${BACKEND === 'cpu' ? '-cpu' : ''}${STEPS !== 100 ? '-steps' + STEPS : ''}.json`;
writeFileSync(join(ROOT, out), JSON.stringify(report, null, 1));
console.log('wrote ' + out);
