// Figure captures for docs/figures: per-frame traces (drum, loom on/off, three cruises) and
// 1080p screenshots from the closed loop, plus Xenova's brain view. GPU box, headed under Xvfb:
//   XVFB_SCREEN=2560x1440x24 scripts/gpu-box.sh bg "node bench/figures-capture.mjs"
// Writes bench/out/figures.json and docs/figures/shots/*.png.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCombinedBrowser, startVite, sleep, requireGpuTools } from './lib/browser.mjs';
import { openLoop, frames } from './lib/cruise.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'docs/figures/shots'); mkdirSync(SHOTS, { recursive: true });
const OUT = join(ROOT, 'bench/out/figures.json');
const SECONDS = 20, DNBIAS = 0.4, TURNGAIN = 2, BASEAMP = 0.7, W = 1920, H = 1080;
const DRUM_KEYS = ['t', 'omega', 'hsL', 'hsR', 'turn', 'b_hsL', 'b_hsR', 'b_dng02L', 'b_dng02R', 'b_dna02L', 'b_dna02R', 'b_wingMnL', 'b_wingMnR', 'b_ps080L', 'b_ps080R', 'b_vuma4', 'spikes'];
const LOOM_KEYS = ['t', 'loom', 'loomL', 'loomR', 'b_lc4L', 'b_lc4R', 'b_lplc2L', 'b_lplc2R', 'b_dnp01', 'b_dnp', 'b_dna02L', 'b_dna02R', 'spikes'];
const CRUISE_KEYS = ['t', 'x', 'z', 'yaw', 'yawRate', 'roll', 'speed', 'collisions', 'cmdL', 'cmdR', 'turnCmd', 'hsL', 'hsR', 'turn', 'b_hsL', 'b_hsR', 'b_dng02L', 'b_dng02R', 'b_dna02L', 'b_dna02R', 'b_wingMnL', 'b_wingMnR', 'spikes', 'wallMs', 'opticMs', 'brainMs'];
const LOOM = { az: -Math.PI / 4, el: 0, startDistance: 6, speed: 2, radius: 0.6, retinal: true, loop: false };

requireGpuTools();
const vite = await startVite();
const browser = await launchCombinedBrowser({ width: W, height: H });
const report = { seconds: SECONDS, dnBias: DNBIAS, turnGain: TURNGAIN, baseAmp: BASEAMP, width: W, height: H, drum: null, loom: {}, cruise: {}, eye: null, course: null, shots: [] };
const save = () => writeFileSync(OUT, JSON.stringify(report));
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function newPage() { const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 }); page.on('pageerror', (e) => log('page error: ' + e.message)); return page; }
const run = (page, n) => page.evaluate((n) => window.__loop.run(n), n);
const collect = (page, n, keys) => page.evaluate(async (n, keys) => { window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))); }, n, keys);
async function shot(page, name, ui = false) {
  await page.evaluate((ui) => { window.__loop.ui(ui); window.__loop.screenshotFrame(); if (ui) window.__loop.drawHud(); }, ui);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, name + '.png'), type: 'png' });
  await page.evaluate(() => window.__loop.ui(false));
  report.shots.push(name); log('shot ' + name);
}
const still = (page) => page.evaluate(() => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; });
async function loomTrace(page, label) {
  await still(page); await run(page, frames(1));
  const before = await collect(page, frames(1), LOOM_KEYS);
  await page.evaluate((p) => window.__loop.loom(p), LOOM);
  const a = await collect(page, frames(2.0), LOOM_KEYS);
  if (label === 'on') { await shot(page, 'loom-close'); await shot(page, 'loom-close-hud', true); }
  const b = await collect(page, frames(1.2), LOOM_KEYS);
  await page.evaluate(() => window.__loop.loomStop());
  report.loom[label] = [...before, ...a, ...b]; save();
  const peak = (k) => Math.max(...report.loom[label].map((r) => r[k] ?? 0));
  log(`loom ${label}: LC4 L peak ${peak('b_lc4L').toFixed(1)} Hz, LPLC2 L ${peak('b_lplc2L').toFixed(1)}, DNp01 ${peak('b_dnp01').toFixed(1)}`);
}
async function cruiseTrace(page, label, shots) {
  await still(page); await run(page, frames(3)); await run(page, frames(1));
  const rest = await page.evaluate((amp) => { const r = window.__loop.motor.captureRest(); window.__loop.motor.mode = 'vnc'; window.__loop.motor.setParams({ baseAmp: amp }); window.__loop.resetCollisions(); return r; }, BASEAMP);
  const rows = []; let t = 0;
  const marks = shots ? [3, 8, 14, SECONDS] : [SECONDS];
  for (const m of marks) {
    rows.push(...(await collect(page, frames(m - t), CRUISE_KEYS))); t = m;
    if (shots && m < SECONDS) {
      await shot(page, `cruise-${m}s`);
      if (m === 8) { await shot(page, 'cruise-8s-hud', true); report.eye = await page.evaluate(() => window.__loop.eye()); report.eyeBody = await page.evaluate(() => window.__loop.body()); }
    }
  }
  report.cruise[label] = { rest, rows }; save();
  const last = rows[rows.length - 1];
  log(`cruise ${label}: ${rows.length} frames, ${last.collisions} collisions, drift ${(((last.yaw - rows[0].yaw) * 180) / Math.PI).toFixed(1)}°, ${(rows.reduce((s, r) => s + r.wallMs, 0) / rows.length).toFixed(0)} ms/frame`);
}

const common = { readout: 'dna02', dnBias: DNBIAS, turnGain: TURNGAIN, haltereSign: -1, course: true };
// 1. drum + loom (bridge on), hovering
{
  const page = await newPage();
  const boot = await openLoop(page, vite.url, { ...common, haltere: true, bridge: true });
  log(`page 1: ${boot.backend}, ${boot.config?.pairs} bridge cells`);
  await still(page); await run(page, frames(3));
  report.course = await page.evaluate(() => window.__loop.courseLayout());
  const drum = [];
  for (const [omega, s] of [[0, 1], [1, 3], [0, 1], [-1, 3], [0, 1]]) {
    await page.evaluate((o) => { window.__loop.omega = o; }, omega);
    drum.push(...(await collect(page, frames(s), DRUM_KEYS)));
    if (omega === 1) { await shot(page, 'drum-cw-hud', true); }
  }
  report.drum = drum; save(); log(`drum: ${drum.length} frames`);
  await loomTrace(page, 'on');
  await page.close();
}
// 2. intact cruise with screenshots and the eye snapshot
{ const page = await newPage(); await openLoop(page, vite.url, { ...common, haltere: true, bridge: true }); await cruiseTrace(page, 'intact', true); await page.close(); }
// 3. bridge off: loom control, then the null cruise
{ const page = await newPage(); await openLoop(page, vite.url, { ...common, haltere: true, bridge: false }); await still(page); await run(page, frames(3)); await loomTrace(page, 'off'); await cruiseTrace(page, 'bridge-off', false); await page.close(); }
// 4. haltere off
{ const page = await newPage(); await openLoop(page, vite.url, { ...common, haltere: false, bridge: true }); await cruiseTrace(page, 'haltere-off', false); await page.close(); }
// 5. Xenova's brain view: at rest, then the Fly preset through the inject path
{
  const page = await newPage();
  await page.goto(`${vite.url}?stimulus=inject`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#setup-button', { timeout: 30000 }); await page.click('#setup-button');
  for (let waited = 0; ; waited += 2000) {
    const ready = await page.evaluate(() => window.__closedLoop?.ready || window.__closedLoop?.stages.some((s) => s.startsWith('error')));
    if (ready) break; if (waited > 600000) throw Error('brain page never ready'); await sleep(2000);
  }
  await sleep(3000); await page.screenshot({ path: join(SHOTS, 'brain-rest.png'), type: 'png' }); report.shots.push('brain-rest'); log('shot brain-rest');
  await page.evaluate(() => window.__closedLoop.preset('fly')); await sleep(1200);
  await page.screenshot({ path: join(SHOTS, 'brain-fly.png'), type: 'png' }); report.shots.push('brain-fly'); log('shot brain-fly');
  await sleep(1500); await page.screenshot({ path: join(SHOTS, 'brain-fly-2.png'), type: 'png' }); report.shots.push('brain-fly-2');
  await page.close();
}
save(); log(`done: ${report.shots.length} shots, ${OUT}`);
await browser.close(); vite.stop(); process.exit(0);
