/**
 * Phase 2 demo and bench page: the test arena, a hovering fly, its compound eye, and an eye
 * HUD. With ?bench=1 nothing runs on its own; bench/eye.mjs drives frames through
 * window.__eye.step(dt) so results do not depend on the animation clock.
 */
import * as THREE from 'three';
import { buildWorld, FLY_LAYER } from './world/scene.js';
import { FlyBody, HOVER } from './world/fly.js';
import { Loomer } from './world/loom.js';
import { createEye } from './eye/index.js';
import { EyeHud } from './eye/hud.js';
import columns from './eye/columns.json';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BENCH = params.has('bench');
const SIZE = Number(params.get('size') ?? 48);

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
const eye = createEye({ renderer, scene: world.scene, head: world.flyRoot, columns, size: SIZE });
const hud = new EyeHud($('hud'));

let drumOmega = Number(params.get('omega') ?? 0);
let view = 'luminance';
let time = 0,
  frames = 0,
  fps = 0,
  fpsAccum = 0,
  fpsFrames = 0;
const fwd = new THREE.Vector3(),
  camPos = new THREE.Vector3(),
  camTarget = new THREE.Vector3();

/** One frame of `dt` sim seconds: world, eye, main view, HUD. Deterministic given dt. */
function step(dt) {
  time += dt;
  frames++;
  world.drum.rotation.y += drumOmega * dt;
  world.drum.position.x = body.state.position.x;
  world.drum.position.z = body.state.position.z;
  loomer.update(dt, body.state.position, body.state.yaw);
  body.step(HOVER, dt);
  body.applyTo(world.flyRoot, world.flyBody);
  eye.frame(dt);
  if (!BENCH) {
    body.forward(fwd);
    camPos.copy(body.state.position).addScaledVector(fwd, -2.2);
    camPos.y += 1.0;
    camera.position.lerp(camPos, Math.min(1, 6 * dt));
    camTarget.copy(body.state.position).addScaledVector(fwd, 2);
    camera.lookAt(camTarget);
    renderer.render(world.scene, camera);
    const L = view === 'luminance' ? eye.lum.left : view === 'photoreceptor' ? eye.r.left : eye.photoreceptors.left.stim;
    const R = view === 'luminance' ? eye.lum.right : view === 'photoreceptor' ? eye.r.right : eye.photoreceptors.right.stim;
    hud.draw(eye.omm.left, L, eye.omm.right, R, { label: view });
    stats();
  }
}

const statCells = new Map();
function stats() {
  const rows = [
    ['fps', fps.toFixed(0)],
    ['t', time.toFixed(2)],
    ['drum ω', drumOmega.toFixed(2)],
    ['eye render', eye.renderMs.toFixed(2) + ' ms'],
    ['eye sample', eye.sampleMs.toFixed(3) + ' ms'],
    ['columns', `L ${eye.omm.left.count} R ${eye.omm.right.count} (unmapped ${eye.unmapped.left}/${eye.unmapped.right})`],
    ['loom', loomer.active ? `${loomer.distance.toFixed(1)} away, hits ${loomer.hits}` : 'off'],
    ['mean r L/R', `${mean(eye.r.left).toFixed(3)} / ${mean(eye.r.right).toFixed(3)}`],
  ];
  const el = $('stats');
  if (statCells.size !== rows.length) {
    el.replaceChildren();
    statCells.clear();
    for (const [k] of rows) {
      const a = document.createElement('span'), b = document.createElement('span');
      a.className = 'k';
      a.textContent = k;
      el.append(a, b);
      statCells.set(k, b);
    }
  }
  for (const [k, v] of rows) statCells.get(k).textContent = v;
}
function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

let last = performance.now();
function tick(now) {
  const real = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, Math.max(1e-4, real));
  step(dt);
  fpsAccum += real;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
window.addEventListener('keydown', (e) => {
  if (e.key === '[') drumOmega -= 0.25;
  else if (e.key === ']') drumOmega += 0.25;
  else if (e.key === ' ') drumOmega = 0;
  else if (e.key === 'v') view = view === 'luminance' ? 'photoreceptor' : view === 'photoreceptor' ? 'stimulus' : 'luminance';
  else if (e.key === 'l') loomer.active ? loomer.stop() : loomer.launch(body.state.position, body.state.yaw, { retinal: false, loop: false, speed: 2 });
  else if (e.key === 'r') { body.reset(); eye.reset(); time = 0; }
});

window.__eye = {
  ready: true,
  bench: BENCH,
  size: SIZE,
  get omega() { return drumOmega; },
  set omega(v) { drumOmega = v; },
  omm: { left: { az: Array.from(eye.omm.left.az), el: Array.from(eye.omm.left.el), col: Array.from(eye.omm.left.col) }, right: { az: Array.from(eye.omm.right.az), el: Array.from(eye.omm.right.el), col: Array.from(eye.omm.right.col) } },
  unmapped: eye.unmapped,
  step(dt) { step(dt); return { t: time, renderMs: eye.renderMs, sampleMs: eye.sampleMs }; },
  lum: () => ({ left: Array.from(eye.lum.left), right: Array.from(eye.lum.right) }),
  r: () => ({ left: Array.from(eye.r.left), right: Array.from(eye.r.right) }),
  stim: () => ({ left: Array.from(eye.photoreceptors.left.stim), right: Array.from(eye.photoreceptors.right.stim) }),
  reset() { body.reset(); eye.reset(); loomer.stop(); time = 0; frames = 0; },
  loom: (opts) => loomer.launch(body.state.position, body.state.yaw, opts),
  loomState: () => ({ active: loomer.active, distance: loomer.distance, hits: loomer.hits }),
  yaw: (v) => { if (v !== undefined) body.state.yaw = v; return body.state.yaw; },
  gl: (() => { const gl = renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER); })(),
  diag: () => ({ contextLost: renderer.getContext().isContextLost(), glError: renderer.getContext().getError(), render: { ...renderer.info.render }, memory: { ...renderer.info.memory }, programs: renderer.info.programs?.length, canvas: [canvas.width, canvas.height], faceRaw: Array.from(eye.cube.pixels[0].slice(0, 8)) }),
};
// WebGPU from the same page (Phase 3 needs both): same retry as src/worker.js's shim.
window.__eye.webgpu = async () => {
  if (!navigator.gpu) return 'missing';
  for (let attempt = 0; attempt < 6; attempt++) {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (a) return `${a.info?.vendor}/${a.info?.architecture} maxStorageBufferBindingSize=${(await a.requestDevice()).limits.maxStorageBufferBindingSize}`;
    await new Promise((r) => setTimeout(r, 150));
  }
  const a = await navigator.gpu.requestAdapter();
  return a ? `${a.info?.vendor}/${a.info?.architecture} (plain request)` : 'null';
};
canvas.addEventListener('webglcontextlost', (e) => { console.error('webglcontextlost: ' + (e.statusMessage || '')); window.__eye.lost = true; });
if (!BENCH) requestAnimationFrame(tick);
