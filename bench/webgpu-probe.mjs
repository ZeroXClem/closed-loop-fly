#!/usr/bin/env node
// Does a headless Chromium-family browser on this machine expose WebGPU? Tries several flag
// sets, reports chrome://gpu's WebGPU/Vulkan status lines and the adapter + limits Xenova's
// kernel needs. Run on the GPU box:  node bench/webgpu-probe.mjs   (BROWSER=/path to override)
import puppeteer from 'puppeteer-core';
import { findBrowser, BROWSER_ARGS } from './lib/browser.mjs';
import { createServer } from 'node:http';

const exe = findBrowser();
const SANDBOX = ['--no-sandbox', '--disable-gpu-sandbox'];
const ANGLE = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan'];
// puppeteer's own --disable-features list; a second --disable-features would replace it, so extend it
const PUPPETEER_DISABLED = 'Translate,AcceptCHFrame,MediaRouter,OptimizationHints,WebUIReloadButton,ProcessPerSiteUpToMainFrameThreshold,IsolateSandboxedIframes';
const DAWN = ['--enable-dawn-features=allow_unsafe_apis,disable_adapter_blocklist', '--disable-dawn-features=disallow_unsafe_apis'];
const WORKING = [...SANDBOX, ...ANGLE, ...DAWN, '--enable-features=Vulkan', '--disable-vulkan-surface'];
const VARIANTS = {
  // With the working set, requestAdapter({powerPreference:'high-performance'}) returned null
  // while the plain request gave nvidia/ampere; the kernels runtime asks for high-performance.
  forceHigh: [...WORKING, '--use-webgpu-power-preference=force-high-performance'],
  defaultHigh: [...WORKING, '--use-webgpu-power-preference=default-high-performance'],
  working: WORKING,
};
const only = process.argv[2];
// a real http origin, so the secure-context rule is not the variable under test
const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>probe</title>ok'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(exe, process.env.HEADED ? '(headed, DISPLAY=' + process.env.DISPLAY + ')' : '(headless)');
for (const [name, args] of Object.entries(VARIANTS)) {
  if (only && only !== name) continue;
  console.log(`\n== ${name}: ${args.join(' ')}`);
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: exe, headless: !process.env.HEADED, args: process.env.HEADED ? args.filter((a) => a !== '--headless=new') : args, protocolTimeout: 60000 });
    if (name === Object.keys(VARIANTS)[0] || only) console.log('   argv: ' + browser.process().spawnargs.slice(1).join(' '));
    const page = await browser.newPage();
    await page.goto(url);
    const r = await page.evaluate(async () => {
      const out = { secure: isSecureContext, hasGpu: !!navigator.gpu, ua: navigator.userAgent };
      if (!navigator.gpu) return out;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      const plain = await navigator.gpu.requestAdapter();
      out.plainAdapter = plain ? `${plain.info?.vendor}/${plain.info?.architecture}` : null;
      const low = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      out.lowPowerAdapter = low ? `${low.info?.vendor}/${low.info?.architecture}` : null;
      if (!adapter) return { ...out, adapter: null };
      out.isFallbackAdapter = adapter.isFallbackAdapter;
      out.features = [...adapter.features].sort();
      out.subgroups = [adapter.info?.subgroupMinSize, adapter.info?.subgroupMaxSize];
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
      const text = (root.querySelector('#content') ?? root.querySelector('div') ?? document.body).innerText;
      const all = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const out = all.filter((l) => /^(WebGPU|Vulkan)( interop)?:/.test(l));
      const d = all.findIndex((l) => /^Dawn Info/.test(l));
      if (d >= 0) out.push(...all.slice(d, d + 30));
      return out;
    }).catch((e) => ['(no text: ' + e.message + ')']);
    for (const l of lines) console.log('   gpu: ' + l.trim());
  } catch (e) {
    console.log('   launch/evaluate failed: ' + e.message.split('\n')[0]);
  } finally {
    await browser?.close().catch(() => {});
  }
}
server.close();
