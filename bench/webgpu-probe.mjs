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
  // Dawn owns its Vulkan instance; --use-angle=vulkan made chrome://gpu report WebGPU as
  // hardware accelerated on the RTX 3070 but the page still got SwiftShader. Probe why.
  angleVk: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan'],
  angleVkNoWorkarounds: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan', '--disable-gpu-driver-bug-workarounds'],
  angleVkSkia: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan'],
  angleVkUnsafeApis: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan', '--enable-dawn-features=allow_unsafe_apis'],
  angleVkNoSwiftshader: [...SANDBOX, '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan', '--disable-features=WebGPUFallbackAdapter'],
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
      const plain = await navigator.gpu.requestAdapter();
      out.plainAdapter = plain ? `${plain.info?.vendor}/${plain.info?.architecture} fallback=${plain.isFallbackAdapter}` : null;
      if (!adapter) return { ...out, adapter: null };
      out.isFallbackAdapter = adapter.isFallbackAdapter;
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
      const seen = new Set(), out = [];
      for (const e of root.querySelectorAll('*')) {
        if (e.children.length) continue;
        const t = (e.textContent || '').trim().replace(/\s+/g, ' ');
        if (t.length < 4 || t.length > 220 || seen.has(t)) continue;
        if (/WebGPU|Dawn|Adapter|NVIDIA|SwiftShader|blocklist|GL_RENDERER|Vulkan|Disable webgpu/i.test(t)) { seen.add(t); out.push(t); }
      }
      return out.slice(0, 40);
    }).catch((e) => ['(no text: ' + e.message + ')']);
    for (const l of lines) console.log('   gpu: ' + l.trim());
  } catch (e) {
    console.log('   launch/evaluate failed: ' + e.message.split('\n')[0]);
  } finally {
    await browser?.close().catch(() => {});
  }
}
server.close();
