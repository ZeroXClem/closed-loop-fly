#!/usr/bin/env node
// Is it the FIRST requestAdapter call in a fresh GPU process that returns null (rather than
// the power preference)? Ask several times with the same options and log each answer.
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { findBrowser, BROWSER_ARGS } from './lib/browser.mjs';
const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>probe</title>ok'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
for (const opts of [{ powerPreference: 'high-performance' }, {}, { powerPreference: 'low-power' }]) {
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: BROWSER_ARGS, protocolTimeout: 60000 });
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const r = await page.evaluate(async (opts) => {
      const out = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const a = await navigator.gpu.requestAdapter(opts);
        out.push(`${i}: ${a ? a.info?.vendor + '/' + a.info?.architecture : 'null'} (${(performance.now() - t0).toFixed(0)} ms)`);
        if (!a) await new Promise((r) => setTimeout(r, 200));
      }
      // and in a worker, fresh page context
      const w = new Worker(URL.createObjectURL(new Blob([`self.onmessage = async (e) => { const out = []; for (let i = 0; i < 3; i++) { const a = await navigator.gpu.requestAdapter(e.data); out.push(a ? a.info?.vendor + '/' + a.info?.architecture : 'null'); } postMessage(out); };`], { type: 'text/javascript' })));
      const worker = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage(opts); });
      return { page: out, worker };
    }, opts);
    console.log(`== fresh browser, options ${JSON.stringify(opts)}\n   page:   ${r.page.join(' | ')}\n   worker: ${r.worker.join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
  }
}
server.close();
