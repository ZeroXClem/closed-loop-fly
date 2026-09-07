#!/usr/bin/env node
// Full-graph parity of the WebGPU LIF against Xenova's JavaScript reference, batch by batch,
// with the Fly stimulus. Needs the GPU box (headless Brave). Run:
//   node bench/parity.mjs [--batches 60] [--steps 100,40] [--stimulus poisson|inject]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchBrowser, startVite, waitFor, requireGpuTools } from './lib/browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BATCHES = Number(arg('batches', 60)), STEPS = arg('steps', '100,40').split(',').map(Number), STIM = arg('stimulus', 'poisson'), WARM = Number(arg('warm', 0));
requireGpuTools();
const vite = await startVite();
const browser = await launchBrowser();
const report = { stimulus: STIM, batches: BATCHES, warm: WARM, runs: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   pageerror: ' + e.message));
  await page.goto(`${vite.url}?stimulus=${STIM}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#setup-button', { timeout: 30000 });
  await page.click('#setup-button');
  await waitFor(page, () => window.__closedLoop?.ready, { what: 'worker ready', timeoutMs: 300000 });
  const backend = await page.evaluate(() => window.__closedLoop.backend);
  console.log(`backend ${backend}`);
  if (backend !== 'gpu') throw Error('no GPU backend');
  // stop the UI's stepping so the worker queue is ours
  await page.click('#pause');
  for (const steps of STEPS) {
    console.log(`\n== ${STIM}, ${steps}-tick batches × ${BATCHES}, after ${WARM} silent batches (stimulus at tick ${WARM * steps})`);
    const id = `parity-${steps}`;
    await page.evaluate((id, steps, batches, warm) => { window.__closedLoop.replies = []; window.__closedLoop.post({ type: 'parity', id, steps, batches, warm }); }, id, steps, BATCHES, WARM);
    const reply = await waitFor(page, (id) => (window.__closedLoop.replies ?? []).find((r) => r.type === 'parity' && r.id === id) ?? null, { what: 'parity reply', timeoutMs: 600000, arg: id });
    console.log('   batch    ms   cpu spikes   gpu spikes   neurons differing   gpu−cpu');
    for (const r of reply.rows) if (r.batch < 12 || r.batch % 10 === 9 || r.neuronsDiffering) console.log(`   ${String(r.batch).padStart(5)} ${String(r.ms).padStart(5)} ${String(r.cpu).padStart(12)} ${String(r.gpu).padStart(12)} ${String(r.neuronsDiffering).padStart(18)} ${String(r.gpuMinusCpu).padStart(9)}`);
    console.log(`   first mismatching batch: ${reply.firstMismatch ?? 'none'} (${reply.firstMismatch === null ? 'identical for ' + (BATCHES * steps * 0.1) + ' ms' : 'at ' + (reply.firstMismatch + 1) * steps * 0.1 + ' ms'})`);
    report.runs.push({ steps, firstMismatch: reply.firstMismatch, rows: reply.rows });
  }
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
const out = `bench/out/parity${WARM ? '-warm' + WARM : ''}.json`;
writeFileSync(join(ROOT, out), JSON.stringify(report, null, 1));
console.log('wrote ' + out);
