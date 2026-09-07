// Copy of vendor/fruit-fly-simulation/src/main.js with imports pointed at vendor/ and a
// closed-loop-fly test hook; every change is marked. Diff against the vendor file to review.
import '../vendor/fruit-fly-simulation/src/style.css';
import { configureAssetBase } from '../vendor/fruit-fly-simulation/src/data-loader.js';
import { BrainView } from '../vendor/fruit-fly-simulation/src/brain-view.js';
import { FlyScene } from '../vendor/fruit-fly-simulation/src/scene.js';
import { FlyController } from '../vendor/fruit-fly-simulation/src/controller.js';
import { populations } from '../vendor/fruit-fly-simulation/src/stimulus.js';
const assetBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;
configureAssetBase(assetBase);
const $ = (id) => document.getElementById(id);
let scene,
  view,
  groups,
  worker,
  ready = false,
  paused = false,
  pending = false,
  resetting = false,
  epoch = 0,
  generation = 0,
  watchdog,
  timer,
  backend = 'cpu',
  lastResult = 0,
  simRate = 0,
  assetsReady = false,
  preparing = false,
  loading = false,
  disposed = false;
const controller = new FlyController();
// ---- closed-loop-fly additions ----------------------------------------------------------
// Stimulus path: 'inject' turns painted pulses into external current (src/brain/inject.js);
// 'poisson' is Xenova's original forced-spike path, kept for A/B: ?stimulus=poisson.
// ?gain= scales the injected current, ?steps= sets ticks per worker batch (default 100 = 10 ms).
const params = new URLSearchParams(location.search);
const stimulus = params.get('stimulus') === 'poisson' ? 'poisson' : 'inject';
const injectGain = Number(params.get('gain') ?? 1);
const stepTicks = Number(params.get('steps') ?? 100);
// Test hook for bench/browser.mjs: recent results, worker stage messages, and ways to stimulate.
const hook = (window.__closedLoop = {
  stimulus,
  injectGain,
  stepTicks,
  controller,
  results: [],
  stages: [],
  backend: null,
  ready: false,
  pulse: (indices, options) => sendPulse(indices, options),
  preset: (key) => document.querySelector(`[data-preset="${key}"]`)?.click(),
  post: (m) => worker?.postMessage(m),
  get groups() {
    return groups;
  },
});
// -----------------------------------------------------------------------------------------
function openSetup(title, detail, error = false) {
  $('workspace').inert = true;
  if (view) view.enabled = false;
  $('setup').dataset.state = error ? 'error' : 'loading';
  $('setup-status').textContent = title;
  $('setup-detail').textContent = detail;
  $('setup-button').disabled = !error;
  $('setup-button-label').textContent = error ? 'Try again' : 'Preparing…';
  $('setup-progress').hidden = error;
  $('setup-progress').removeAttribute('value');
  if (!$('setup').open) $('setup').showModal();
  if (error) $('setup-button').focus({ preventScroll: true });
}
function completeSetup() {
  $('setup').close();
  $('workspace').inert = false;
  view.enabled = true;
  $('compute-menu').open = false;
  $('brain').focus({ preventScroll: true });
}
async function setup() {
  if (preparing || loading || disposed) return;
  if (!assetsReady) {
    const loaded = await boot();
    if (!loaded) return;
  }
  void start();
}
function status(title, detail, error = false) {
  if (preparing || loading) {
    $('setup-status').textContent = title;
    $('setup-detail').textContent = detail;
  }
  $('status').textContent = title;
  $('status-detail').textContent = detail;
  $('compute-detail').textContent = title + ' · ' + detail;
  $('status-wrap').dataset.state = error
    ? 'error'
    : ready || (assetsReady && !loading)
      ? 'ready'
      : 'loading';
  $('status-wrap').setAttribute('aria-live', ready ? 'off' : 'polite');
  $('status-light').className =
    'status-light' + (error ? ' error' : ready && !paused ? ' live' : '');
  $('runtime-label').textContent = ready
    ? `${backend === 'gpu' ? 'WebGPU' : 'JavaScript'} · ${paused ? 'paused' : simRate.toFixed(2) + '×'}`
    : loading
      ? 'Loading…'
      : error
        ? 'Unavailable'
        : $('backend').value === 'cpu'
          ? 'JavaScript'
          : 'WebGPU · auto';
}
function selectAction(key) {
  for (const button of document.querySelectorAll('[data-preset]'))
    button.setAttribute('aria-pressed', button.dataset.preset === key ? 'true' : 'false');
}
function transport() {
  $('pause-label').textContent = paused ? 'Resume' : 'Pause';
  $('pause-icon').setAttribute('href', paused ? '#i-play' : '#i-pause');
}
function rangeTrack(input) {
  input.style.setProperty(
    '--range',
    ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100 +
      '%',
  );
}
function timeout(ms, message) {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => fail(message), ms);
}
function fail(message) {
  clearTimeout(timer);
  clearTimeout(watchdog);
  worker?.terminate();
  worker = null;
  ready = false;
  pending = false;
  loading = false;
  resetting = false;
  epoch++;
  $('pause').disabled = $('reset').disabled = true;
  $('start').hidden = false;
  $('start').disabled = !assetsReady;
  $('start').textContent = 'Retry simulation';
  $('backend').disabled = false;
  $('progress').hidden = true;
  status('Simulation stopped', message, true);
  openSetup('Setup interrupted', message, true);
}
function sendPulse(indices, options = {}) {
  if (!ready || !indices.length) return;
  $('paint-hint').textContent = `${indices.length.toLocaleString()} neurons selected`;
  worker.postMessage({
    type: 'pulse',
    indices,
    strength: Number($('strength').value),
    profile: options.profile ?? 'paint',
    replace: options.replace === true,
  });
  request();
}
function request() {
  clearTimeout(timer);
  if (!ready || paused || pending || resetting || document.hidden) return;
  pending = true;
  worker.postMessage({ type: 'step', generation, silenced: $('silence').checked });
  timeout(60000, 'The neural calculation stopped responding. Retry with the JavaScript reference.');
}
function resetUI() {
  controller.reset();
  view.reset();
  scene.reset();
  lastResult = 0;
  simRate = 0;
  $('behavior').textContent = 'At rest';
  $('body-description').textContent = '';
  $('walk-rate').textContent = $('escape-rate').textContent = '0 Hz';
  $('turn-rate').textContent = '0°/s';
  $('turn-rate').title = 'No turn';
  $('turn-rate').setAttribute('aria-label', 'No turn');
  $('walk-meter').style.width = $('escape-meter').style.width = $('turn-meter').style.width = '0';
  $('turn-cursor').style.left = '50%';
  document.querySelector('.body-state').dataset.rest = 'true';
  selectAction(null);
}
async function start(forceCPU = false) {
  if (!assetsReady || loading || disposed) return;
  openSetup('Loading neural weights', 'Completed downloads are reused');
  if (forceCPU) $('backend').value = 'cpu';
  backend = 'cpu';
  loading = true;
  ready = false;
  pending = false;
  paused = false;
  resetting = false;
  generation = 0;
  const token = ++epoch;
  clearTimeout(timer);
  clearTimeout(watchdog);
  worker?.terminate();
  controller.reset();
  scene.reset();
  view.fc.clearRect(0, 0, view.w, view.h);
  view.tick = 0;
  view.pulseTick = 0;
  lastResult = 0;
  simRate = 0;
  $('start').disabled = true;
  $('backend').disabled = true;
  $('pause').disabled = $('reset').disabled = true;
  $('progress').hidden = false;
  $('progress').value = 0;
  status('Loading connectome', 'Completed downloads are reused');
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    fail(error.message);
    return;
  }
  worker.onerror = (e) => {
    if (epoch === token) fail(e.message || 'Worker failed to start');
  };
  worker.onmessageerror = () => {
    if (epoch === token) fail('Could not decode a simulation response');
  };
  worker.onmessage = ({ data: m }) => {
    if (epoch !== token || disposed) return;
    if (m.type === 'stage') {
      hook.stages.push(m.message);
      status('Preparing simulation', m.message);
      timeout(180000, 'Simulation initialization timed out. Retry with JavaScript.');
    } else if (m.type === 'progress') {
      $('progress').value = m.value;
      $('setup-progress').value = m.value;
      status('Loading connectome', Math.round(m.value * 100) + '% · 76 MB, downloaded once');
      timeout(180000, 'The data download stalled. Retry to resume saved files.');
    } else if (m.type === 'fallback') {
      hook.stages.push('fallback: ' + m.message);
      status('Using JavaScript', m.message);
      $('backend').value = 'cpu';
    } else if (m.type === 'ready') {
      clearTimeout(watchdog);
      ready = true;
      loading = false;
      backend = m.backend;
      hook.ready = true;
      hook.backend = m.backend;
      $('progress').hidden = $('start').hidden = true;
      $('pause').disabled = $('reset').disabled = false;
      transport();
      $('backend').disabled = false;
      status(
        'Ready to paint',
        backend === 'gpu' ? 'WebGPU · @huggingface/kernels' : 'JavaScript reference',
      );
      completeSetup();
      if (view.selection.size) {
        view.pulseAt = performance.now();
        worker.postMessage({
          type: 'pulse',
          indices: Uint32Array.from(view.selection),
          strength: Number($('strength').value),
          profile: view.pulseProfile,
          replace: view.replacePulse,
        });
      }
      request();
    } else if (m.type === 'reset') {
      if (m.generation !== generation) return;
      clearTimeout(watchdog);
      pending = false;
      resetting = false;
      request();
    } else if (m.type === 'result') {
      if (m.generation !== generation || resetting) return;
      clearTimeout(watchdog);
      pending = false;
      const now = performance.now(),
        elapsed = lastResult ? now - lastResult : m.wallMs;
      lastResult = now;
      const rate = (m.steps * 0.1) / Math.max(elapsed, 0.001);
      simRate = simRate ? simRate * 0.85 + rate * 0.15 : rate;
      const pose = controller.advance(m.rates, m.steps * 0.0001);
      scene.update(pose);
      hook.results.push({
        tick: m.tick,
        steps: m.steps,
        total: m.total,
        wallMs: m.wallMs,
        at: now,
        rates: Array.from(m.rates),
        watched: m.watched ? Array.from(m.watched) : null,
        behavior: pose.behavior,
        y: pose.y,
      });
      if (hook.results.length > 4000) hook.results.shift();
      view.result(m.firing, m.counts, m.tick);
      const r = controller.rates;
      $('behavior').textContent = pose.behavior;
      document.querySelector('.body-state').dataset.rest = String(
        paused || pose.behavior === 'At rest',
      );
      $('body-description').textContent =
        pose.y > 0.05
          ? `${pose.y.toFixed(1)} mm high · ${controller.distance.toFixed(1)} mm travelled`
          : '';
      const walking = (r[0] + r[1]) / 2;
      $('walk-rate').textContent = Math.round(walking) + ' Hz';
      $('escape-rate').textContent = Math.round(r[5]) + ' Hz';
      const degrees = Math.round(Math.abs((pose.yawRate * 180) / Math.PI));
      $('turn-rate').textContent = degrees + '°/s';
      $('turn-rate').title = degrees ? `Turning ${pose.yawRate > 0 ? 'left' : 'right'}` : 'No turn';
      $('turn-rate').setAttribute(
        'aria-label',
        degrees
          ? `${degrees} degrees per second ${pose.yawRate > 0 ? 'left' : 'right'}`
          : 'No turn',
      );
      $('walk-meter').style.width = Math.min(100, (walking / 36) * 100) + '%';
      $('escape-meter').style.width = Math.min(100, (r[5] / 200) * 100) + '%';
      const turn = Math.max(-50, Math.min(50, (-pose.yawRate / 3.8) * 50));
      $('turn-meter').style.width = Math.abs(turn) + '%';
      $('turn-meter').style.left = (turn < 0 ? 50 + turn : 50) + '%';
      $('turn-cursor').style.left = 50 + turn + '%';
      status(
        paused ? 'Paused' : `${(m.tick * 0.0001).toFixed(2)} s neural time`,
        `${backend === 'gpu' ? 'WebGPU' : 'JavaScript'} · ${simRate.toFixed(2)}× realtime · ${m.total.toLocaleString()} spikes`,
      );
      timer = setTimeout(request, Math.max(0, 10 - m.wallMs));
    } else if (m.type === 'error') {
      hook.stages.push('error: ' + m.message);
      if (backend === 'gpu' && !forceCPU) {
        fail('WebGPU stopped. Restarting with JavaScript.');
        void start(true);
      } else fail(m.message);
    }
  };
  timeout(180000, 'Initialization timed out. Retry to reuse saved downloads.');
  worker.postMessage({
    type: 'init',
    backend: forceCPU ? 'cpu' : $('backend').value,
    assetBase,
    stimulus,
    injectGain,
    steps: stepTicks,
  });
}
async function boot() {
  preparing = true;
  openSetup('Preparing the scene', 'Loading brain anatomy and fly geometry');
  try {
    scene?.dispose();
    view?.dispose();
    scene = new FlyScene($('fly'));
    scene.onCameraChange = (mode) => {
      for (const camera of ['side', 'top', 'follow'])
        $('camera-' + camera).setAttribute('aria-pressed', mode === camera);
    };
    view = new BrainView($('brain'), sendPulse, (n) => {
      selectAction(null);
      $('replay').disabled = !n;
      $('paint-hint').textContent = n
        ? `${n.toLocaleString()} neurons selected`
        : 'Paint neurons. Release to stimulate.';
    });
    view.brush = Number($('size').value) / 2;
    scene.setDepthOfField($('depth-of-field').checked);
    const results = await Promise.allSettled([view.load(), scene.load()]);
    if (disposed) return false;
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    groups = populations(results[0].value);
    assetsReady = true;
    $('anatomy-status').hidden = true;
    $('start').disabled = false;
    return true;
  } catch (error) {
    fail(error.message);
    return false;
  } finally {
    preparing = false;
  }
}
$('setup-button').onclick = () => void setup();
$('setup').addEventListener('cancel', (event) => event.preventDefault());
$('start').onclick = () => void start();
$('replay').onclick = () => view?.pulse();
$('brush').onclick = () => {
  if (!view) return;
  view.mode = 'paint';
  $('brush').setAttribute('aria-pressed', 'true');
  $('erase').setAttribute('aria-pressed', 'false');
};
$('erase').onclick = () => {
  if (!view) return;
  view.mode = 'erase';
  $('brush').setAttribute('aria-pressed', 'false');
  $('erase').setAttribute('aria-pressed', 'true');
};
$('size').oninput = () => {
  if (view) view.brush = Number($('size').value) / 2;
  $('size-label').textContent = $('size').value + ' px';
  rangeTrack($('size'));
};
$('clear').onclick = () => {
  view?.clear();
  if (ready) worker.postMessage({ type: 'clear' });
};
$('projection').onchange = () => {
  if (view) {
    view.projection = $('projection').value;
    view.layout();
  }
};
for (const button of document.querySelectorAll('[data-preset]'))
  button.onclick = () => {
    if (!ready || !groups) return;
    const key = button.dataset.preset;
    view.preset(
      groups[key === 'escape' ? 'escapeInput' : key],
      key === 'left' || key === 'right' ? 'turn' : 'paint',
    );
    selectAction(key);
  };
$('pause').onclick = () => {
  if (!ready) return;
  paused = !paused;
  transport();
  document.querySelector('.body-state').dataset.rest = String(
    paused || $('behavior').textContent === 'At rest',
  );
  if (paused) {
    clearTimeout(timer);
    status('Paused', 'Painting will pulse when you resume');
  } else {
    lastResult = 0;
    status('Resumed', backend === 'gpu' ? 'WebGPU · @huggingface/kernels' : 'JavaScript reference');
    request();
  }
};
$('reset').onclick = () => {
  if (!ready || resetting) return;
  resetting = true;
  generation++;
  clearTimeout(timer);
  resetUI();
  worker.postMessage({ type: 'reset', generation });
  timeout(60000, 'Reset did not complete');
};
$('backend').onchange = () => {
  if (ready) {
    ready = false;
    void start();
  } else if (!loading) status('Ready to paint', '166,700 neurons · 25.6 million connections');
};
$('depth-of-field').onchange = () => scene?.setDepthOfField($('depth-of-field').checked);
document.addEventListener('click', (event) => {
  if (!$('compute-menu').contains(event.target)) $('compute-menu').open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('compute-menu').open = false;
});
for (const camera of ['side', 'top', 'follow'])
  $('camera-' + camera).onclick = () => scene?.setCamera(camera);
$('settings-button').onclick = () => $('settings').showModal();
$('close-settings').onclick = () => $('settings').close();
$('settings').addEventListener('click', (e) => {
  if (e.target === $('settings')) {
    const r = $('settings').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      $('settings').close();
  }
});
$('strength').oninput = () => {
  $('strength-label').textContent = $('strength').value + ' Hz';
  rangeTrack($('strength'));
};
rangeTrack($('size'));
rangeTrack($('strength'));
document.querySelector('.body-state').dataset.rest = 'true';
document.addEventListener('visibilitychange', () => {
  lastResult = 0;
  if (document.hidden) {
    clearTimeout(timer);
    clearTimeout(watchdog);
  } else {
    if (loading) timeout(180000, 'Initialization did not resume. Retry loading.');
    else if (pending || resetting) timeout(60000, 'The simulation did not resume. Retry loading.');
    request();
  }
});
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    disposed = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    worker?.terminate();
    view?.dispose();
    scene?.dispose();
  }
});
// The HTML overlay is visible before modules load; upgrade it to a native modal.
$('setup').close();
$('setup').showModal();
