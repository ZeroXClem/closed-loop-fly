// HD video of the intact cruise: one 1920 x 1080 still per simulated frame (60 per fly-second),
// eye HUD and live read-outs drawn, then assembled at 60 fps = simulation time. GPU box:
//   XVFB_SCREEN=2560x1440x24 scripts/gpu-box.sh bg "node bench/video-capture.mjs [--seconds 20] [--hud 1]"
// Frames land in bench/out/video/, the MP4 in docs/cruise-intact-1080p.mp4 (needs ffmpeg on PATH).
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCombinedBrowser, startVite, sleep, requireGpuTools } from './lib/browser.mjs';
import { openLoop, frames } from './lib/cruise.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FR = join(ROOT, 'bench/out/video'); rmSync(FR, { recursive: true, force: true }); mkdirSync(FR, { recursive: true });
const OUT = join(ROOT, 'docs/cruise-intact-1080p.mp4');
const SECONDS = Number(arg('seconds', 20)), HUD = arg('hud', '1') !== '0', W = 1920, H = 1080;
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
requireGpuTools();
const vite = await startVite();
const browser = await launchCombinedBrowser({ width: W, height: H });
const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on('pageerror', (e) => log('page error: ' + e.message));
const boot = await openLoop(page, vite.url, { readout: 'dna02', dnBias: 0.4, turnGain: 2, haltere: true, haltereSign: -1, course: true, bridge: true });
log(`loop: ${boot.backend}, ${boot.config?.pairs} bridge cells`);
await page.evaluate(() => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; window.__loop.ui(false); });
await page.evaluate((n) => window.__loop.run(n), frames(3)); await page.evaluate((n) => window.__loop.run(n), frames(1));
await page.evaluate((hud) => {
  window.__loop.motor.captureRest(); window.__loop.motor.mode = 'vnc'; window.__loop.motor.setParams({ baseAmp: 0.7 }); window.__loop.resetCollisions();
  window.__loop.renderFrames = true;
  if (hud) { window.__loop.ui(true); for (const id of ['status', 'help', 'net']) document.getElementById(id).style.display = 'none'; }
}, HUD);
const N = frames(SECONDS); const t0 = Date.now();
for (let i = 0; i < N; i++) {
  await page.evaluate(async (hud) => { await window.__loop.run(1); if (hud) window.__loop.drawHud(); }, HUD);
  await page.screenshot({ path: join(FR, `frame-${String(i).padStart(5, '0')}.png`), type: 'png', optimizeForSpeed: true });
  if (i % 120 === 0) log(`frame ${i}/${N}, ${((Date.now() - t0) / 1000).toFixed(0)} s wall, collisions ${await page.evaluate(() => window.__loop.collisions())}`);
}
const b = await page.evaluate(() => window.__loop.body()); log(`done: ${N} frames, yaw ${(b.yaw * 180 / Math.PI).toFixed(1)}°, collisions ${await page.evaluate(() => window.__loop.collisions())}`);
await browser.close(); vite.stop();
try {
  execSync(`ffmpeg -v error -y -framerate 60 -i "${FR}/frame-%05d.png" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -shortest -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.2 -crf 17 -c:a aac -b:a 64k -movflags +faststart "${OUT}"`, { stdio: 'inherit' });
  log(`encoded ${OUT}`);
} catch (e) { log('ffmpeg failed or missing; frames kept in bench/out/video for local encoding: ' + e.message); }
process.exit(0);
