// Shared cruise scenario (Phase 5 acceptance, Phase 6 ablations): the fly flies forward through
// the pillar course under the VNC readout for `seconds`; returns collisions, heading drift,
// wobble, distance, and a per-second heading log.
import { waitFor } from './browser.mjs';
export const FRAME = 1 / 60;
export const frames = (s) => Math.round(s / FRAME);
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

/** Open the loop page in the given state and wait for the worker. */
export async function openLoop(page, url, { gain = 2, dnBias = 0.4, readout = 'dng02', turnGain = 2, backend = 'gpu', set = 'validated', haltere = false, haltereGain = 2, haltereSign = 1, course = true, bridge = true, gate = 0, recenter = 0, flight = 1, adapt = '', optic = 'cpu' } = {}) {
  const q = `bench=1&gain=${gain}&set=${set}&backend=${backend}&dnbias=${dnBias}&hold=frame&motor=hover&turngain=${turnGain}&readout=${readout}&gate=${gate}&recenter=${recenter}&flight=${flight}&optic=${optic}${adapt ? `&adapt=${adapt}` : ''}${haltere ? `&haltere=on&halteregain=${haltereGain}&halteresign=${haltereSign}` : ''}${course ? '&course=1' : ''}${bridge ? '' : '&bridge=off'}`;
  await page.goto(`${url}loop.html?${q}`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__loop?.ready || window.__loop?.error, { what: 'loop ready', timeoutMs: 600000 });
  const boot = await page.evaluate(() => ({ backend: window.__loop.backend, config: window.__loop.config, error: window.__loop.error }));
  if (boot.error) throw Error(boot.error);
  return boot;
}

/**
 * Warm up still (optic + bridge rest, then motor rest), then cruise at `baseAmp` for `seconds`.
 * `before` runs in the page after the warm-up (mutes etc.). `record` = path of a webm to write.
 */
export async function cruise(page, { warm = 3, seconds = 30, baseAmp = 0.7, before = null, record = null } = {}) {
  // hover through the warm-up and the rest-capture second; the motor comes on only after
  await page.evaluate((n) => { window.__loop.omega = 0; window.__loop.motor.mode = 'hover'; return window.__loop.run(n); }, frames(warm));
  const rest = await page.evaluate(async (n) => { await window.__loop.run(n); const r = window.__loop.motor.captureRest(); window.__loop.motor.mode = 'vnc'; return r; }, frames(1));
  if (before) await page.evaluate(before);
  let recorder = null;
  if (record) { await page.evaluate(() => { window.__loop.renderFrames = true; }); recorder = await page.screencast({ path: record }); }
  const rows = await page.evaluate(async (n, baseAmp) => { window.__loop.motor.setParams({ baseAmp }); window.__loop.resetCollisions(); window.__loop.frames.length = 0; await window.__loop.run(n); return window.__loop.frames; }, frames(seconds), baseAmp);
  if (recorder) { await recorder.stop(); await page.evaluate(() => { window.__loop.renderFrames = false; }); }
  await page.evaluate(() => window.__loop.motor.setParams({ baseAmp: 0.5 }));
  const yaw = rows.map((r) => r.yaw), yawRate = rows.map((r) => r.yawRate);
  const drift = ((yaw[yaw.length - 1] - yaw[0]) * 180) / Math.PI;
  let dist = 0; for (let i = 1; i < rows.length; i++) dist += Math.hypot(rows[i].x - rows[i - 1].x, rows[i].z - rows[i - 1].z);
  const perSecond = []; for (let i = 0; i < rows.length; i += frames(1)) perSecond.push(+((rows[i].yaw * 180) / Math.PI).toFixed(1));
  return { rest, frames: rows.length, collisions: rows[rows.length - 1].collisions, driftDeg: +drift.toFixed(1), maxExcursionDeg: +(Math.max(...yaw.map((y) => Math.abs(y - yaw[0]))) * 180 / Math.PI).toFixed(1), wobbleRadS: +std(yawRate).toFixed(3), meanYawRate: +mean(yawRate).toFixed(3), distance: +dist.toFixed(1), meanSpeed: +mean(rows.map((r) => r.speed)).toFixed(2), spikesPerFrame: +mean(rows.map((r) => r.spikes)).toFixed(0), dng02: [+mean(rows.map((r) => r.b_dng02L)).toFixed(1), +mean(rows.map((r) => r.b_dng02R)).toFixed(1)], dna02: [+mean(rows.map((r) => r.b_dna02L)).toFixed(1), +mean(rows.map((r) => r.b_dna02R)).toFixed(1)], wingMn: [+mean(rows.map((r) => r.b_wingMnL)).toFixed(1), +mean(rows.map((r) => r.b_wingMnR)).toFixed(1)], headingPerSecond: perSecond, end: { x: +rows[rows.length - 1].x.toFixed(1), z: +rows[rows.length - 1].z.toFixed(1) } };
}
export const fmt = (r) => `${r.collisions} collisions, drift ${r.driftDeg}° (max excursion ${r.maxExcursionDeg}°), wobble ${r.wobbleRadS} rad/s, ${r.distance} units at ${r.meanSpeed} u/s, DNg02 ${r.dng02.join('/')} Hz, DNa02 ${r.dna02.join('/')} Hz, wing MN ${r.wingMn.join('/')} Hz, ${r.spikesPerFrame} spikes/frame`;
