#!/usr/bin/env node
// Does a headless Chromium-family browser on this machine expose WebGPU? Tries several flag
// sets, reports chrome://gpu's WebGPU/Vulkan status lines and the adapter + limits Xenova's
// kernel needs. Run on the GPU box:  node bench/webgpu-probe.mjs   (BROWSER=/path to override)
import puppeteer from 'puppeteer-core';
import { findBrowser, BROWSER_ARGS } from './lib/browser.mjs';
import { createServer } from 'node:http';

const exe = findBrowser();
const SANDBOX = ['--no-sandbox', '--disable-gpu-sandbox'];
const VARIANTS = {
  // Dawn talks to Vulkan itself; do NOT turn on Skia's Vulkan backend (that trips the
  // "webgpu on vk via gl interop" driver-bug workaround on NVIDIA and disables WebGPU).
  dawn: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  dawnAngleVk: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan'],
  dawnNoWorkarounds: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-gpu-driver-bug-workarounds'],
  skiaVkNoWorkarounds: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--disable-gpu-driver-bug-workarounds'],
  dawnEgl: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=egl'],
};
const only = process.argv[2];
// a real http origin, so the secure-context rule is not the variable under test
const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>probe</title>ok'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(exe);
for (const [name, args] of Object.entries(VARIANTS)) {
  if (only && only !== name) continue;
  console.log(`\n== ${name}: ${args.join(' ')}`);
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: exe, headless: true, args, protocolTimeout: 60000 });
    const page = await browser.newPage();
    await page.goto(url);
    const r = await page.evaluate(async () => {
      const out = { secure: isSecureContext, hasGpu: !!navigator.gpu, ua: navigator.userAgent };
      if (!navigator.gpu) return out;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return { ...out, adapter: null };
      const info = adapter.info ?? {};
      const device = await adapter.requestDevice();
      const L = device.limits;
      return { ...out, adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }, features: [...adapter.features].slice(0, 10), limits: { maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize } };
    });
    console.log(JSON.stringify(r, null, 1));
    const gpuPage = await browser.newPage();
    await gpuPage.goto('chrome://gpu', { waitUntil: 'domcontentloaded' }).catch((e) => console.log('chrome://gpu: ' + e.message));
    await new Promise((r) => setTimeout(r, 1500));
    const lines = await gpuPage.evaluate(() => {
      const iv = document.querySelector('info-view');
      const root = iv?.shadowRoot ?? document;
      const items = [...root.querySelectorAll('li, td')].map((e) => e.innerText.trim());
      return items.filter((t) => /^(WebGPU|Vulkan|GL_RENDERER|ANGLE|Driver Ver|Vulkan Ver|\*\s+Disable webgpu)/i.test(t) || /WebGPU:/.test(t)).slice(0, 10);
    }).catch((e) => ['(no text: ' + e.message + ')']);
    for (const l of lines) console.log('   gpu: ' + l.trim());
  } catch (e) {
    console.log('   launch/evaluate failed: ' + e.message.split('\n')[0]);
  } finally {
    await browser?.close().catch(() => {});
  }
}
server.close();
