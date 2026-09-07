// Clean 1080p stills for the filmstrip (intact cruise, UI hidden, every 2.5 s) and Xenova's
// brain view with the Escape preset firing through the inject path. GPU box, headed under Xvfb:
//   XVFB_SCREEN=2560x1440x24 scripts/gpu-box.sh bg "node bench/filmstrip-capture.mjs"
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCombinedBrowser, startVite, sleep, requireGpuTools } from './lib/browser.mjs';
import { openLoop, frames } from './lib/cruise.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'docs/figures/shots'); mkdirSync(SHOTS, { recursive: true });
const W = 1920, H = 1080, STEP = 2.5, N = 8;
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
requireGpuTools();
const vite = await startVite();
const browser = await launchCombinedBrowser({ width: W, height: H });
async function newPage() { const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 }); page.on('pageerror', (e) => log('page error: ' + e.message)); return page; }
{
  const page = await newPage();
  const boot = await openLoop(page, vite.url, { readout: 'dna02', dnBias: 0.4, turnGain: 2, haltere: true, haltereSign: -1, course: true, bridge: true });
  log(`loop: ${boot.backend}, ${boot.config?.pairs} bridge cells`);
  await page.evaluate(() => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; window.__loop.ui(false); });
  await page.evaluate((n) => window.__loop.run(n), frames(3)); await page.evaluate((n) => window.__loop.run(n), frames(1));
  await page.evaluate(() => { window.__loop.motor.captureRest(); window.__loop.motor.mode = 'vnc'; window.__loop.motor.setParams({ baseAmp: 0.7 }); window.__loop.resetCollisions(); });
  for (let i = 0; i < N; i++) {
    if (i) await page.evaluate((n) => window.__loop.run(n), frames(STEP));
    await page.evaluate(() => window.__loop.screenshotFrame()); await sleep(120);
    await page.screenshot({ path: join(SHOTS, `strip-${String(i).padStart(2, '0')}.png`), type: 'png' });
    const b = await page.evaluate(() => window.__loop.body());
    log(`strip-${i}: t = ${(i * STEP).toFixed(1)} s, yaw ${(b.yaw * 180 / Math.PI).toFixed(1)}°, collisions ${await page.evaluate(() => window.__loop.collisions())}`);
  }
  await page.close();
}
{
  const page = await newPage();
  await page.goto(`${vite.url}?stimulus=inject`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#setup-button', { timeout: 30000 }); await page.click('#setup-button');
  for (let waited = 0; ; waited += 2000) {
    const ready = await page.evaluate(() => window.__closedLoop?.ready || window.__closedLoop?.stages.some((s) => s.startsWith('error')));
    if (ready) break; if (waited > 600000) throw Error('brain page never ready'); await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => window.__closedLoop.preset('escape'));
  for (const [name, ms] of [['brain-escape-1', 900], ['brain-escape-2', 1600], ['brain-escape-3', 2500]]) {
    await sleep(ms); await page.screenshot({ path: join(SHOTS, name + '.png'), type: 'png' });
    log(`${name}: ${await page.evaluate(() => document.querySelector('#status')?.textContent + ' · ' + [...document.querySelectorAll('.readout-value, [data-readout]')].map((e) => e.textContent).join(' / '))}`);
  }
  await page.close();
}
log('done'); await browser.close(); vite.stop(); process.exit(0);
