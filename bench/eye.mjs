#!/usr/bin/env node
// Phase 2 acceptance: the eye renders a rotating drum; per-column temporal contrast is
// printed; a drum rotating right produces a rightward phase progression across the columns
// (stripe edges reach columns at larger azimuth later), and the reverse for left.
//
//   node bench/eye.mjs [--omega 1] [--seconds 2] [--warm 1.5] [--hz 120] [--size 48]
//
// Runs on the host GPU when there is one, else on SwiftShader (the numbers are the same, the
// frame time is not). PASS: phase slope sign follows the drum in both directions, its
// magnitude is within 30% of 2pi / 30deg (24 stripes = 12 cycles per turn), and the median
// temporal contrast of equatorial columns exceeds 0.2.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchWebGLBrowser, launchSoftwareBrowser, launchCombinedBrowser, startVite, waitFor, requireGpuTools, BROWSER_ARGS, HARDWARE_GL_ARGS, COMBINED_ARGS } from './lib/browser.mjs';
import puppeteer from 'puppeteer-core';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GL = arg('gl', 'auto'), VERBOSE = process.argv.includes('--verbose');
const OMEGA = Number(arg('omega', 1)), SECONDS = Number(arg('seconds', 2)), WARM = Number(arg('warm', 1.5)), HZ = Number(arg('hz', 120)), SIZE = Number(arg('size', 48));
const DT = 1 / HZ, STRIPE_CYCLES = 12, EXPECTED_SLOPE = (2 * Math.PI) / (360 / STRIPE_CYCLES); // rad per deg of azimuth
const DEG = 180 / Math.PI;

const vite = await startVite();
// --gl auto|webgpu|hardware|software: the WebGPU flag set, plain hardware WebGL (ANGLE on
// Vulkan), SwiftShader, or whichever of GPU/software the host allows.
const HEADED = process.argv.includes('--headed');
const SANDBOX = ['--no-sandbox', '--disable-gpu-sandbox'];
const VARIANTS = {
  hardware: HARDWARE_GL_ARGS,
  webgpu: BROWSER_ARGS,
  webgpuNoSurface: COMBINED_ARGS,
  webgpuSwGl: BROWSER_ARGS.map((a) => (a === '--use-angle=vulkan' ? '--use-angle=swiftshader' : a)),
  webgpuSwGlNoSurface: BROWSER_ARGS.filter((a) => a !== '--disable-vulkan-surface').map((a) => (a === '--use-angle=vulkan' ? '--use-angle=swiftshader' : a)),
};
const launch = async () => {
  if (GL === 'software') return { browser: await launchSoftwareBrowser(), gpu: false, note: 'software GL (SwiftShader)' };
  if (GL === 'auto') return launchWebGLBrowser();
  if (GL === 'combined') { const tools = requireGpuTools(); return { browser: await launchCombinedBrowser(), gpu: true, note: `host GPU (${tools.vulkan}), WebGL + WebGPU, headed` }; }
  if (!VARIANTS[GL]) throw Error('unknown --gl ' + GL + '; one of auto, software, ' + Object.keys(VARIANTS).join(', '));
  const tools = requireGpuTools();
  const args = HEADED ? VARIANTS[GL] : [...VARIANTS[GL]];
  return { browser: await puppeteer.launch({ executablePath: tools.exe, headless: !HEADED, args, protocolTimeout: 600000 }), gpu: true, note: `host GPU (${tools.vulkan}), --gl ${GL}${HEADED ? ', headed' : ''}` };
};
const { browser, gpu, note } = await launch();
console.log(`browser: ${note}`);
const report = { omega: OMEGA, seconds: SECONDS, warm: WARM, hz: HZ, size: SIZE, gpu, runs: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   pageerror: ' + e.message));
  page.on('console', (m) => { if (VERBOSE || m.type() === 'error') console.log(`   console.${m.type()}: ` + m.text().slice(0, 200)); });
  await page.goto(`${vite.url}eye.html?bench=1&size=${SIZE}`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__eye?.ready, { what: 'eye page' });
  const info = await page.evaluate(() => ({ gl: window.__eye.gl, unmapped: window.__eye.unmapped, omm: window.__eye.omm }));
  console.log(`GL renderer: ${info.gl}`);
  if (VERBOSE) { await page.evaluate(() => window.__eye.step(1 / 120)); console.log('   diag after one frame: ' + JSON.stringify(await page.evaluate(() => window.__eye.diag()))); console.log('   webgpu from this page: ' + (await page.evaluate(() => window.__eye.webgpu()))); }
  console.log(`columns: L ${info.omm.left.az.length} R ${info.omm.right.az.length}; unmapped ${info.unmapped.left}/${info.unmapped.right}`);
  const equator = (o) => o.az.map((a, i) => i).filter((i) => Math.abs(o.el[i]) * DEG < 6).sort((a, b) => o.az[a] - o.az[b]);
  const eqL = equator(info.omm.left), eqR = equator(info.omm.right);

  for (const omega of [OMEGA, -OMEGA]) {
    const dir = omega < 0 ? 'right (stripes move rightward in front, drum yaw < 0)' : 'left (stripes move leftward in front, drum yaw > 0)';
    console.log(`\n== drum ω = ${omega} rad/s: ${dir}`);
    // warm-up (photoreceptor adaptation), then record; all in-page, one evaluate
    const res = await page.evaluate(async (omega, dt, warmFrames, frames, eqL, eqR) => {
      const E = window.__eye;
      E.reset();
      E.omega = omega;
      for (let i = 0; i < warmFrames; i++) E.step(dt);
      const nL = E.omm.left.az.length, nR = E.omm.right.az.length;
      const sumL = new Float64Array(nL), sqL = new Float64Array(nL), sumR = new Float64Array(nR), sqR = new Float64Array(nR);
      const rSumL = new Float64Array(nL), rSumR = new Float64Array(nR);
      const seriesL = eqL.map(() => new Float32Array(frames)), seriesR = eqR.map(() => new Float32Array(frames));
      let renderMs = 0, sampleMs = 0;
      for (let f = 0; f < frames; f++) {
        const s = E.step(dt);
        renderMs += s.renderMs; sampleMs += s.sampleMs;
        const lum = E.lum(), r = E.r();
        for (let i = 0; i < nL; i++) { sumL[i] += lum.left[i]; sqL[i] += lum.left[i] ** 2; rSumL[i] += r.left[i]; }
        for (let i = 0; i < nR; i++) { sumR[i] += lum.right[i]; sqR[i] += lum.right[i] ** 2; rSumR[i] += r.right[i]; }
        eqL.forEach((i, k) => (seriesL[k][f] = lum.left[i]));
        eqR.forEach((i, k) => (seriesR[k][f] = lum.right[i]));
      }
      const contrast = (sum, sq, n) => Array.from(sum, (s, i) => { const m = s / n, v = sq[i] / n - m * m; return m > 1e-6 ? Math.sqrt(Math.max(0, v)) / m : 0; });
      return {
        contrastL: contrast(sumL, sqL, frames), contrastR: contrast(sumR, sqR, frames),
        meanRL: Array.from(rSumL, (s) => s / frames), meanRR: Array.from(rSumR, (s) => s / frames),
        seriesL: seriesL.map((a) => Array.from(a)), seriesR: seriesR.map((a) => Array.from(a)),
        renderMs: renderMs / frames, sampleMs: sampleMs / frames,
      };
    }, omega, DT, Math.round(WARM / DT), Math.round(SECONDS / DT), eqL, eqR);

    // phase at the stripe temporal frequency, per equatorial column, unwrapped along azimuth
    const f0 = (STRIPE_CYCLES * Math.abs(omega)) / (2 * Math.PI);
    const phase = (series) => series.map((s) => { let re = 0, im = 0; const m = s.reduce((a, b) => a + b, 0) / s.length; for (let t = 0; t < s.length; t++) { const w = 2 * Math.PI * f0 * t * DT; re += (s[t] - m) * Math.cos(w); im -= (s[t] - m) * Math.sin(w); } return { phi: Math.atan2(im, re), amp: Math.hypot(re, im) / s.length }; });
    const fit = (eq, o, ph) => {
      // Columns that look at pillars or the ground carry no stripe signal; keep those whose
      // amplitude at f0 is at least a third of the median, then estimate the slope from the
      // wrapped phase difference between kept neighbours less than 10 deg apart (no long
      // unwrap chains that a gap of occluded columns would break).
      const az = eq.map((i) => o.az[i] * DEG);
      const amps = ph.map((p) => p.amp), med = [...amps].sort((x, y) => x - y)[Math.floor(amps.length / 2)];
      const keep = ph.map((p, k) => (p.amp >= med / 3 ? k : -1)).filter((k) => k >= 0);
      const wrap = (d) => Math.atan2(Math.sin(d), Math.cos(d));
      const slopes = [];
      let later = 0;
      for (let j = 1; j < keep.length; j++) {
        const a = keep[j - 1], b = keep[j], daz = az[b] - az[a];
        if (daz <= 0 || daz > 10) continue;
        const d = wrap(ph[b].phi - ph[a].phi);
        slopes.push(d / daz);
        if (d < 0) later++;
      }
      const sorted = [...slopes].sort((x, y) => x - y);
      const slope = sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
      const mad = sorted.length ? [...sorted.map((v) => Math.abs(v - slope))].sort((x, y) => x - y)[Math.floor(sorted.length / 2)] : NaN;
      return { n: eq.length, kept: keep.length, pairs: slopes.length, azMin: +az[0].toFixed(1), azMax: +az[az.length - 1].toFixed(1), slope: +slope.toFixed(4), mad: +mad.toFixed(4), laterAtLargerAz: +(later / Math.max(1, slopes.length)).toFixed(2), meanAmp: +(amps.reduce((x, y) => x + y, 0) / amps.length).toFixed(4), medianAmp: +med.toFixed(4) };
    };
    const phL = phase(res.seriesL), phR = phase(res.seriesR);
    const fitL = fit(eqL, info.omm.left, phL), fitR = fit(eqR, info.omm.right, phR);
    const q = (a) => { const s = [...a].sort((x, y) => x - y); const p = (f) => +s[Math.floor(f * (s.length - 1))].toFixed(3); return { p10: p(0.1), median: p(0.5), p90: p(0.9) }; };
    const eqContrast = (c, eq) => q(eq.map((i) => c[i]));
    const run = {
      omega, f0: +f0.toFixed(3), direction: omega < 0 ? 'right' : 'left',
      contrast: { left: q(res.contrastL), right: q(res.contrastR), equatorLeft: eqContrast(res.contrastL, eqL), equatorRight: eqContrast(res.contrastR, eqR) },
      photoreceptorMeanR: { left: +(res.meanRL.reduce((a, b) => a + b, 0) / res.meanRL.length).toFixed(3), right: +(res.meanRR.reduce((a, b) => a + b, 0) / res.meanRR.length).toFixed(3) },
      phase: { left: fitL, right: fitR, expectedSlopeMagnitude: +EXPECTED_SLOPE.toFixed(4) },
      frameMs: { render: +res.renderMs.toFixed(2), sample: +res.sampleMs.toFixed(3), total: +(res.renderMs + res.sampleMs).toFixed(2), hzCapacity: +(1000 / (res.renderMs + res.sampleMs)).toFixed(0) },
    };
    // rightward motion: stripe edges arrive later at larger azimuth -> phase decreases with azimuth
    const expectSign = omega < 0 ? -1 : 1;
    run.pass = {
      signLeft: Math.sign(fitL.slope) === expectSign, signRight: Math.sign(fitR.slope) === expectSign,
      magnitudeLeft: Math.abs(Math.abs(fitL.slope) / EXPECTED_SLOPE - 1) < 0.3, magnitudeRight: Math.abs(Math.abs(fitR.slope) / EXPECTED_SLOPE - 1) < 0.3,
      contrast: run.contrast.equatorLeft.median > 0.2 && run.contrast.equatorRight.median > 0.2,
    };
    run.pass.all = Object.values(run.pass).every(Boolean);
    report.runs.push(run);
    console.log(`   stripe frequency ${run.f0} Hz; frame ${run.frameMs.total} ms (render ${run.frameMs.render}, sample ${run.frameMs.sample}) => ${run.frameMs.hzCapacity} Hz capacity`);
    console.log(`   temporal contrast, all columns   L p10/median/p90 ${res && Object.values(run.contrast.left).join('/')}   R ${Object.values(run.contrast.right).join('/')}`);
    console.log(`   temporal contrast, equator (|el|<6°) L ${Object.values(run.contrast.equatorLeft).join('/')}   R ${Object.values(run.contrast.equatorRight).join('/')}`);
    console.log(`   photoreceptor mean r  L ${run.photoreceptorMeanR.left}  R ${run.photoreceptorMeanR.right}   (rest 0.776 + 0.99 × 0.5 = 1.271 under steady light)`);
    console.log(`   phase vs azimuth  L: ${fitL.kept}/${fitL.n} cols with stripe signal (${fitL.azMin}..${fitL.azMax}°), median slope ${fitL.slope} ± ${fitL.mad} rad/° over ${fitL.pairs} neighbour pairs, later at larger az in ${Math.round(fitL.laterAtLargerAz * 100)}%`);
    console.log(`                     R: ${fitR.kept}/${fitR.n} cols (${fitR.azMin}..${fitR.azMax}°), median slope ${fitR.slope} ± ${fitR.mad} rad/° over ${fitR.pairs} pairs, later at larger az in ${Math.round(fitR.laterAtLargerAz * 100)}%`);
    console.log(`   expected |slope| ${EXPECTED_SLOPE.toFixed(4)} rad/° (30° stripe period), sign ${expectSign < 0 ? '−' : '+'} -> ${run.pass.all ? 'PASS' : 'FAIL ' + JSON.stringify(run.pass)}`);
  }
  report.pass = report.runs.every((r) => r.pass.all);
  console.log(`\nVERDICT ${report.pass ? 'PASS' : 'FAIL'}: phase progression follows the drum in both directions${report.pass ? '' : ' (see above)'}`);
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
const out = `bench/out/eye${gpu ? '' : '-software'}.json`;
writeFileSync(join(ROOT, out), JSON.stringify(report, null, 1));
console.log('wrote ' + out);
