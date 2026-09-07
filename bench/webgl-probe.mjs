#!/usr/bin/env node
// Does WebGL2 render and read back under a given flag set, and does WebGPU still see the
// GPU? Phase 3 needs both in one page. Run on the GPU box: node bench/webgl-probe.mjs
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { findBrowser, BROWSER_ARGS } from './lib/browser.mjs';

const exe = findBrowser();
const SANDBOX = ['--no-sandbox', '--disable-gpu-sandbox'];
const VARIANTS = {
  webgpuSet: BROWSER_ARGS,
  webgpuSetNoSurfaceFlag: BROWSER_ARGS.filter((a) => a !== '--disable-vulkan-surface'),
  webgpuSetNoSkiaVk: BROWSER_ARGS.filter((a) => a !== '--enable-features=Vulkan' && a !== '--disable-vulkan-surface'),
  angleVkOnly: [...SANDBOX, '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=vulkan'],
  webgpuSetAngleGl: [...BROWSER_ARGS.filter((a) => a !== '--use-angle=vulkan'), '--use-angle=gl'],
  webgpuSetAngleGlEgl: [...BROWSER_ARGS.filter((a) => a !== '--use-angle=vulkan' && a !== '--use-gl=angle'), '--use-gl=egl'],
};
const only = process.argv[2];
const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>probe</title><canvas id=c width=64 height=64></canvas>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
for (const [name, args] of Object.entries(VARIANTS)) {
  if (only && only !== name) continue;
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: exe, headless: true, args, protocolTimeout: 60000 });
    const page = await browser.newPage();
    await page.goto(url);
    const r = await page.evaluate(async () => {
      const out = {};
      const gl = document.getElementById('c').getContext('webgl2', { preserveDrawingBuffer: true });
      if (!gl) { out.webgl = 'no webgl2'; } else {
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        out.webgl = gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
        // clear the default framebuffer and read
        gl.clearColor(0.25, 0.5, 0.75, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        const px = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.defaultFb = Array.from(px);
        // render to a texture framebuffer (what three.js render targets do) and read
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        out.fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE ? 'complete' : 'incomplete';
        gl.viewport(0, 0, 16, 16); gl.clearColor(0.8, 0.2, 0.4, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        const px2 = new Uint8Array(4); gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px2);
        out.textureFb = Array.from(px2);
        out.glError = gl.getError();
      }
      if (!navigator.gpu) out.webgpu = 'missing';
      else { const a = await navigator.gpu.requestAdapter(); out.webgpu = a ? `${a.info?.vendor}/${a.info?.architecture}` : 'no adapter'; }
      return out;
    });
    console.log(`== ${name}\n   ${JSON.stringify(r)}`);
  } catch (e) {
    console.log(`== ${name}\n   failed: ${e.message.split('\n')[0]}`);
  } finally {
    await browser?.close().catch(() => {});
  }
}
server.close();
