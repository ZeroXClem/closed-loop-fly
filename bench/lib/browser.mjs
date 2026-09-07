// Headless Chromium-family browser with WebGPU on Vulkan, and a Vite dev server, for GPU benches.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { ROOT } from './graph.mjs';

const CANDIDATES = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];
import { execSync } from 'node:child_process';
/** The GPU path is deliberately impure (DECISIONS.md): host Brave + host Vulkan driver. */
export function requireGpuTools() {
  const problems = [];
  const exe = process.env.BROWSER || CANDIDATES.find(existsSync);
  if (!exe) problems.push('no Chromium-family browser on this host (looked for ' + CANDIDATES.join(', ') + '; or set BROWSER=/path). Install Brave from the host package manager.');
  let vk = '';
  try { vk = execSync('vulkaninfo --summary 2>/dev/null', { encoding: 'utf8' }); } catch { problems.push('vulkaninfo not on PATH or failed: install vulkan-tools and the host GPU Vulkan driver (NVIDIA proprietary on gpu-box).'); }
  if (vk && !/deviceName/.test(vk)) problems.push('vulkaninfo lists no Vulkan device.');
  if (problems.length) throw Error('GPU bench cannot run here:\n  - ' + problems.join('\n  - ') + '\nThe flake does not package a browser or Vulkan on purpose; run this on the GPU box (scripts/gpu-box.sh run ...).');
  return { exe, vulkan: (vk.match(/deviceName\s*=\s*(.*)/) || [])[1]?.trim() ?? 'unknown' };
}
export function findBrowser() {
  return requireGpuTools().exe;
}
// Found by bench/webgpu-probe.mjs on gpu-box (Brave 151 / Chromium 151, NVIDIA 610.57, headless):
//  - Dawn keeps its own adapter blocklist, separate from --ignore-gpu-blocklist, and rejects
//    NVIDIA Linux drivers >= 570: `disable_adapter_blocklist` turns it off.
//  - Hardware adapters only appear with Skia's Vulkan feature on AND --disable-vulkan-surface
//    (no display); without them Dawn returns SwiftShader while chrome://gpu still says
//    "hardware accelerated".
export const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--disable-vulkan-surface',
  '--enable-dawn-features=allow_unsafe_apis,disable_adapter_blocklist',
  '--disable-dawn-features=disallow_unsafe_apis',
  '--disable-brave-update',
  '--disable-brave-rewards-extension',
];
export function launchBrowser() {
  return puppeteer.launch({ executablePath: findBrowser(), headless: true, args: BROWSER_ARGS, protocolTimeout: 600000 });
}

/** Start `vite` on 127.0.0.1:port; resolves with the URL once it is listening. */
export function startVite(port = 5173) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('vite did not start:\n' + out)); }, 60000);
    const onData = (d) => {
      out += d.toString();
      const m = out.match(/https?:\/\/127\.0\.0\.1:\d+\/?/);
      if (m) { clearTimeout(timer); resolve({ url: m[0].replace(/\/?$/, '/'), stop: () => child.kill() }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(Error(`vite exited ${code}:\n${out}`)); });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(page, fn, { timeoutMs = 240000, every = 250, what = 'condition', arg } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw Error(`timeout waiting for ${what}`);
    await sleep(every);
  }
}
