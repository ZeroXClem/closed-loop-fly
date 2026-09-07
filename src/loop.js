/**
 * Phase 3: two networks, one loop. The scene and the eye run here (WebGL); the worker runs
 * AbijahKaj's optic-v2 rate net [A] and Xenova's MaleCNS LIF [B] and injects [A]'s HS / LC4 /
 * LPLC2 rates into [B] at the same body IDs. Scene time advances in fixed frames of FRAME_DT
 * only when the worker has integrated the previous frame, so a run is deterministic and the
 * neural time equals the scene time whatever the wall clock does. The fly hovers (open loop);
 * Phase 4 reads the motor neurons, Phase 5 closes the loop.
 */
import * as THREE from 'three';
import { buildWorld, FLY_LAYER } from './world/scene.js';
import { FlyBody, HOVER } from './world/fly.js';
import { Loomer } from './world/loom.js';
import { createEye } from './eye/index.js';
import { EyeHud } from './eye/hud.js';
import columns from './eye/columns.json';
import { MotorReadout } from './motor/readout.js';
import { wingsToForces } from './motor/wings.js';
import haltereIds from './bridge/haltere-ids.json';
import opticJsonUrl from '../vendor/fruit-fly-brain/optic.json?url';
import opticBinUrl from '../vendor/fruit-fly-brain/optic.bin?url';
import paramsUrl from '../vendor/fruit-fly-brain/fitted-params.json?url';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BENCH = params.has('bench');
const FRAME_DT = Number(params.get('frame') ?? 1 / 60);
const assetBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;
const abs = (u) => new URL(u, document.baseURI).href;

// ---- scene + eye
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !BENCH });
renderer.setPixelRatio(BENCH ? 1 : Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
const world = buildWorld();
const body = new FlyBody();
body.applyTo(world.flyRoot, world.flyBody);
const loomer = new Loomer(world.scene);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 500);
camera.layers.enable(FLY_LAYER);
const eye = createEye({ renderer, scene: world.scene, head: world.flyRoot, columns });
const hud = new EyeHud($('hud'));
let drumOmega = Number(params.get('omega') ?? 0);
// Phase 4: ?motor=vnc closes the yaw loop from [B]'s DNg02 / wing MN rates; default hover (open loop)
const readout = new MotorReadout({ turnGain: Number(params.get('turngain') ?? 1), turnSign: Number(params.get('turnsign') ?? 1), source: params.get('readout') ?? 'dng02' });
let motorMode = params.get('motor') ?? 'hover';
let forces = { ...HOVER };
const PHYS_DT = 0.001;
// Phase 5: cruise (thrust), the 40-pillar course, collision counting, and the haltere proxy:
// current on [B]'s haltere afferents proportional to the body's yaw rate (left afferents for
// leftward rotation, right for rightward), through the inject API. Hand-set gain, no map.
world.course.visible = params.has('course');
let collisions = 0, inContact = false;
const haltere = { on: params.get('haltere') === 'on', gain: Number(params.get('halteregain') ?? 2), maxCurrent: 3 };
function countCollisions() {
  const p = body.state.position;
  let hit = false;
  const check = (m) => { if (Math.abs(p.x - m.position.x) < 0.75 + 0.15 && Math.abs(p.z - m.position.z) < 0.75 + 0.15) hit = true; };
  for (const m of world.obstacles) check(m);
  if (world.course.visible) for (const m of world.course.children) check(m);
  if (hit && !inContact) collisions++;
  inContact = hit;
}
function haltereCurrent() {
  if (!haltere.on) return null;
  const w = body.state.yawRate; // + = left
  const l = Math.min(haltere.maxCurrent, Math.max(0, w) * haltere.gain), r = Math.min(haltere.maxCurrent, Math.max(0, -w) * haltere.gain);
  return { bodyIds: [...haltereIds.left, ...haltereIds.right], values: [...haltereIds.left.map(() => l), ...haltereIds.right.map(() => r)] };
}
let time = 0, frame = 0;
const fwd = new THREE.Vector3(), camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();

function stepScene(dt) {
  time += dt;
  frame++;
  world.drum.rotation.y += drumOmega * dt;
  world.drum.position.x = body.state.position.x;
  world.drum.position.z = body.state.position.z;
  loomer.update(dt, body.state.position, body.state.yaw);
  for (let left = dt; left > 1e-9; left -= PHYS_DT) body.step(motorMode === 'vnc' ? forces : HOVER, Math.min(PHYS_DT, left));
  body.applyTo(world.flyRoot, world.flyBody);
  countCollisions();
  eye.frame(dt);
}
function render() {
  body.forward(fwd);
  camPos.copy(body.state.position).addScaledVector(fwd, -2.2);
  camPos.y += 1.0;
  camera.position.copy(camPos);
  camTarget.copy(body.state.position).addScaledVector(fwd, 2);
  camera.lookAt(camTarget);
  renderer.render(world.scene, camera);
}

// ---- worker
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let generation = 0, ready = false, pending = false, last = null, lastReady = null;
const hook = (window.__loop = { ready: false, backend: null, stages: [], frames: [], last: null, config: null, error: null });
const status = (t) => ($('status').textContent = t);
worker.onerror = (e) => { hook.error = e.message; status('worker error: ' + e.message); };
worker.onmessage = ({ data: m }) => {
  if (m.type === 'stage') { hook.stages.push(m.message); status(m.message); }
  else if (m.type === 'progress') status(`loading ${Math.round(m.value * 100)}%`);
  else if (m.type === 'fallback') { hook.stages.push('fallback: ' + m.message); }
  else if (m.type === 'ready') { ready = true; hook.ready = true; hook.backend = m.backend; hook.config = m.bridge; lastReady = m; status(`ready: ${m.backend}; ${m.optic}; bridge ${JSON.stringify(m.bridge)}`); if (!BENCH) requestFrame(); }
  else if (m.type === 'bridge') { hook.config = m.config; }
  else if (m.type === 'mute') { hook.muted = m; }
  else if (m.type === 'reset') { pending = false; if (!BENCH) requestFrame(); }
  else if (m.type === 'frame') {
    if (m.generation !== generation) return;
    pending = false; last = m; hook.last = m;
    // Phase 4: rates -> wing command -> forces for the next frame's body step
    if (motorMode === 'vnc') {
      if (!readout.rest) readout.accumulateRest(m.rates);
      const cmd = readout.step(m.rates, FRAME_DT);
      forces = wingsToForces(cmd);
    }
    hook.frames.push(summarize(m)); if (hook.frames.length > 5000) hook.frames.shift(); afterFrame(m); if (!BENCH) requestFrame();
  }
  else if (m.type === 'error') { hook.error = m.message; hook.stages.push('error: ' + m.message); status('error: ' + m.message); }
};
function summarize(m) {
  const o = m.optic, r = m.rates;
  return { frame: m.frame, tick: m.tick, t: time, omega: drumOmega, yaw: body.state.yaw, yawRate: body.state.yawRate, roll: body.state.roll, speed: body.state.speed, x: body.state.position.x, z: body.state.position.z, collisions, cmdL: readout.cmd.left, cmdR: readout.cmd.right, turnCmd: readout.turn, spikes: m.spikes, wallMs: m.wallMs, opticMs: m.opticMs, brainMs: m.brainMs, hsL: o.hsL, hsR: o.hsR, dL: o.dL, dR: o.dR, turn: o.turn, loomL: o.loomL, loomR: o.loomR, aDng02L: o.dng02L, aDng02R: o.dng02R, calibrated: o.calibrated, ...Object.fromEntries(Object.entries(r).map(([k, v]) => ['b_' + k, v])), loom: loomer.active ? loomer.distance : null, watched: m.watched ? Array.from(m.watched) : null };
}
/** Advance the scene by one fixed frame and hand the eye's luminance to the worker. */
function requestFrame() {
  if (!ready || pending) return;
  pending = true;
  stepScene(FRAME_DT);
  if (!BENCH || hook.renderFrames) render();
  const lumL = eye.lum.left.slice(), lumR = eye.lum.right.slice();
  const h = haltereCurrent();
  if (h) worker.postMessage({ type: 'inject', bodyIds: h.bodyIds, values: h.values });
  worker.postMessage({ type: 'frame', generation, dt: FRAME_DT, lumL, lumR, silenced: hook.silenced }, [lumL.buffer, lumR.buffer]);
}
function afterFrame(m) {
  if (BENCH) return;
  hud.draw(eye.omm.left, eye.lum.left, eye.omm.right, eye.lum.right, { label: 'luminance' });
  stats(m);
}
const statCells = new Map();
function stats(m) {
  const o = m.optic, r = m.rates;
  const rows = [
    ['t', time.toFixed(2) + ' s'], ['frame', `${m.frame} (${m.substeps} × 4 ms)`], ['wall/frame', `${m.wallMs.toFixed(0)} ms (optic ${m.opticMs.toFixed(0)}, LIF ${m.brainMs.toFixed(0)})`],
    ['drum ω', drumOmega.toFixed(2)], ['bridge', hook.config ? `${hook.config.on ? 'on' : 'off'} gain ${hook.config.gain} (${hook.config.pairs} cells)` : '-'],
    ['[A] HS L/R', `${o.hsL.toFixed(3)} / ${o.hsR.toFixed(3)}${o.calibrated ? '' : ' (warming up)'}`], ['[A] turn (dL−dR)', o.turn.toFixed(3)], ['[A] loom L/R', `${o.loomL.toFixed(3)} / ${o.loomR.toFixed(3)}`],
    ['[B] HS L/R Hz', `${r.hsL.toFixed(1)} / ${r.hsR.toFixed(1)}`], ['[B] LC4 L/R Hz', `${r.lc4L.toFixed(1)} / ${r.lc4R.toFixed(1)}`], ['[B] DNg02 L/R Hz', `${r.dng02L.toFixed(1)} / ${r.dng02R.toFixed(1)}`],
    ['[B] DNp01 Hz', r.dnp01.toFixed(1)], ['[B] wing MN L/R Hz', `${r.wingMnL.toFixed(1)} / ${r.wingMnR.toFixed(1)}`], ['[B] spikes/frame', String(m.spikes)],
    ['loom', loomer.active ? `${loomer.distance.toFixed(1)} away` : 'off'],
  ];
  const el = $('stats');
  if (statCells.size !== rows.length) { el.replaceChildren(); statCells.clear(); for (const [k] of rows) { const a = document.createElement('span'), b = document.createElement('span'); a.className = 'k'; a.textContent = k; el.append(a, b); statCells.set(k, b); } }
  for (const [k, v] of rows) statCells.get(k).textContent = v;
}

window.addEventListener('keydown', (e) => {
  if (e.key === '[') drumOmega -= 0.25; else if (e.key === ']') drumOmega += 0.25; else if (e.key === ' ') drumOmega = 0;
  else if (e.key === 'b') worker.postMessage({ type: 'bridge', config: { on: !(hook.config?.on ?? true) } });
  else if (e.key === 'l') loomer.active ? loomer.stop() : loomer.launch(body.state.position, body.state.yaw, { retinal: true, loop: false, speed: 2, startDistance: 6 });
  else if (e.key === 'r') hook.reset();
});
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });

// ---- bench hook (Object.assign would copy the getter's value, not the accessor)
Object.defineProperty(hook, 'omega', { get: () => drumOmega, set: (v) => { drumOmega = v; }, enumerable: true });
Object.assign(hook, {
  frameDt: FRAME_DT,
  /** Run n frames (each FRAME_DT of scene and neural time); resolves when the worker has done them. */
  run(n) {
    return new Promise((resolve, reject) => {
      let left = n;
      const onFrame = () => { if (--left <= 0) { hook.onFrame = null; resolve(hook.last); } else requestFrame(); };
      hook.onFrame = onFrame;
      const check = setInterval(() => { if (hook.error) { clearInterval(check); reject(Error(hook.error)); } if (!hook.onFrame) clearInterval(check); }, 100);
      requestFrame();
    });
  },
  bridge: (config) => worker.postMessage({ type: 'bridge', config }),
  watch: (bodyIds) => worker.postMessage({ type: 'watch', bodyIds }),
  loom: (opts) => loomer.launch(body.state.position, body.state.yaw, opts),
  loomStop: () => loomer.stop(),
  loomState: () => ({ active: loomer.active, distance: loomer.distance, hits: loomer.hits }),
  reset() { generation++; time = 0; frame = 0; body.reset(); eye.reset(); loomer.stop(); readout.reset(); forces = { ...HOVER }; collisions = 0; inContact = false; hook.frames.length = 0; pending = true; worker.postMessage({ type: 'reset', generation }); },
  motor: { get mode() { return motorMode; }, set mode(v) { motorMode = v; }, readout, captureRest: () => readout.captureRest(), setParams: (p) => Object.assign(readout.p, p) },
  haltere,
  silenced: false, // recurrent transmission in [B] off (Xenova's flag)
  renderFrames: false,
  mute: (superclasses, current) => worker.postMessage({ type: 'mute', superclasses, current }),
  unmute: () => worker.postMessage({ type: 'mute', clear: true }),
  course: (on) => { world.course.visible = on; },
  collisions: () => collisions,
  resetCollisions: () => { collisions = 0; inContact = false; },
  screenshotFrame: () => { render(); },
  body: () => ({ ...body.state, position: body.state.position.toArray() }),
  time: () => time,
});
// frame acks feed run()
const origAfter = afterFrame;
afterFrame = (m) => { origAfter(m); hook.onFrame?.(m); };

worker.postMessage({
  type: 'init',
  backend: params.get('backend') ?? 'gpu',
  assetBase,
  stimulus: 'inject',
  injectGain: 1,
  steps: 40,
  optic: { graphJson: abs(opticJsonUrl), graphBin: abs(opticBinUrl), params: abs(paramsUrl) },
  columns,
});
worker.postMessage({ type: 'bridge', config: { gain: Number(params.get('gain') ?? 2), set: params.get('set') ?? 'validated', on: params.get('bridge') !== 'off', dnBias: Number(params.get('dnbias') ?? 0), holdPerFrame: params.get('hold') !== 'substep' } });
