/**
 * Simulation worker: Xenova's protocol (init / pulse / reset / clear / step) plus
 *
 *   { type: 'inject', bodyIds, values }   external current (mV/ms) on those neurons, held
 *   { type: 'inject', current }           ... or a full Float32Array(n)
 *   { type: 'inject', clear: true }       zero it
 *   { type: 'watch', bodyIds }            each 'result' then carries `watched`: their rates (Hz)
 *   { type: 'rates', bodyIds, id }        one-shot query -> { type: 'rates', id, values }
 *
 * init takes `stimulus: 'inject' | 'poisson'` (how painted pulses reach the network),
 * `injectGain` and `steps` (ticks per batch, 1..200).
 */
import { loadGraph, configureAssetBase } from '../vendor/fruit-fly-simulation/src/data-loader.js';
import { PulseBank, populations, decodeCounts } from '../vendor/fruit-fly-simulation/src/stimulus.js';
import { BrainCPU } from './brain/brain.js';
import { kickFromRates } from './brain/inject.js';
import { RateMonitor } from './brain/rates.js';

let graph,
  brain,
  groups,
  pulses,
  monitor,
  bodyIndex,
  backend = 'cpu',
  generation = 0,
  stimulus = 'inject',
  injectGain = 1,
  batchSteps = 100,
  external, // mV/ms per neuron, from the inject API
  kick, // mV per tick, uploaded to the kernels
  zeroRates,
  watched = new Uint32Array(0);
// Host quirk (gpu-box, Brave 151 + NVIDIA 610 under the flags in bench/lib/browser.mjs; see
// bench/webgpu-retry-probe.mjs): the first requestAdapter in a fresh GPU process returns null
// while Dawn initialises (~250 ms); a plain first request locks in SwiftShader. The kernel
// runtime asks once, for 'high-performance'. Retry the same options a few times, then relax.
if (typeof navigator !== 'undefined' && navigator.gpu?.requestAdapter) {
  const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  navigator.gpu.requestAdapter = async (options) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const adapter = await request(options);
      if (adapter) return adapter;
      await wait(100);
    }
    if (!options?.powerPreference) return null;
    const { powerPreference, ...rest } = options;
    return request(rest);
  };
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue
    .then(() => handle(data))
    .catch((error) => postMessage({ type: 'error', message: error.message, generation }));
};

function indicesOf(bodyIds) {
  const out = new Uint32Array(bodyIds.length);
  for (let k = 0; k < bodyIds.length; k++) {
    const i = bodyIndex.get(Number(bodyIds[k]));
    if (i === undefined) throw Error(`Unknown body ID ${bodyIds[k]}`);
    out[k] = i;
  }
  return out;
}

async function handle(m) {
  if (m.type === 'init') {
    configureAssetBase(m.assetBase);
    stimulus = m.stimulus === 'poisson' ? 'poisson' : 'inject';
    injectGain = Number.isFinite(m.injectGain) ? m.injectGain : 1;
    batchSteps = Number.isInteger(m.steps) && m.steps >= 1 && m.steps <= 200 ? m.steps : 100;
    graph = await loadGraph(
      (value) => postMessage({ type: 'progress', value }),
      (message) => postMessage({ type: 'stage', message }),
    );
    // Shiu's monoamine convention; histamine/unknown remain omitted in this adaptation.
    graph.neurons.forEach((r, i) => {
      if (['dopamine', 'octopamine', 'serotonin'].includes(r[4])) graph.sign[i] = 1;
    });
    bodyIndex = new Map(graph.neurons.map((r, i) => [Number(r[0]), i]));
    groups = populations(graph.neurons);
    pulses = new PulseBank(graph.n);
    monitor = new RateMonitor(graph.n);
    external = new Float32Array(graph.n);
    kick = new Float32Array(graph.n);
    zeroRates = new Float32Array(graph.n);
    if (m.backend !== 'cpu')
      try {
        postMessage({ type: 'stage', message: 'Checking WebGPU against JavaScript…' });
        const { BrainGPU } = await import('./brain/brain-gpu.js');
        const { checkGPU } = await import('./brain/gpu-check.js');
        const check = await checkGPU((g) => BrainGPU.create(g));
        postMessage({
          type: 'stage',
          message: `WebGPU matches JavaScript: ${check.neurons} neurons × ${check.steps} ticks, ${check.totalSpikes} spikes, max |Δv| ${check.maxVoltageError.toExponential(2)} mV, max |Δg| ${check.maxSynapticError.toExponential(2)}`,
        });
        postMessage({ type: 'stage', message: 'Preparing resident connectome and motor readout…' });
        brain = await BrainGPU.create(graph);
        await brain.prepareReadout(groups);
        backend = 'gpu';
      } catch (error) {
        brain?.destroy?.();
        postMessage({ type: 'fallback', message: error.message });
        brain = new BrainCPU(graph);
        backend = 'cpu';
      }
    else brain = new BrainCPU(graph);
    postMessage({ type: 'ready', backend, stimulus, steps: batchSteps });
  } else if (m.type === 'pulse') {
    if (m.replace) pulses.reset();
    pulses.add(m.indices, brain.tick, m.strength, m.profile ?? 'paint');
  } else if (m.type === 'inject') {
    if (m.clear) external.fill(0);
    if (m.current) {
      if (m.current.length !== graph.n) throw Error('Injected current size must match neuron count');
      external.set(m.current);
    }
    if (m.bodyIds) {
      const idx = indicesOf(m.bodyIds);
      for (let k = 0; k < idx.length; k++) external[idx[k]] = m.values[k];
    }
  } else if (m.type === 'watch') {
    watched = m.bodyIds ? indicesOf(m.bodyIds) : new Uint32Array(0);
  } else if (m.type === 'rates') {
    const values = monitor.read(indicesOf(m.bodyIds));
    postMessage({ type: 'rates', id: m.id, values }, [values.buffer]);
  } else if (m.type === 'reset') {
    generation = m.generation;
    await brain.reset();
    pulses.reset();
    monitor.reset();
    external.fill(0);
    postMessage({ type: 'reset', generation });
  } else if (m.type === 'clear') {
    pulses.reset();
  } else if (m.type === 'parity') {
    // Full-graph parity: step a JavaScript reference and the live backend from reset with the
    // same stimulus, compare per-neuron spike counts batch by batch. Diagnostic only.
    if (backend !== 'gpu') throw Error('parity needs the WebGPU backend');
    const steps = m.steps ?? batchSteps,
      batches = m.batches ?? 30,
      cpu = new BrainCPU(graph),
      bank = new PulseBank(graph.n);
    await brain.reset();
    // `warm` silent batches first: the Poisson RNG is seeded by the absolute tick, so the same
    // stimulus at a different start tick is a different realisation.
    const warm = m.warm ?? 0;
    for (let b = 0; b < warm; b++) {
      cpu.batch(steps, zeroRates, false, null);
      await brain.batch(steps, zeroRates, false, null);
    }
    bank.add(m.indices ?? groups.escapeInput, cpu.tick, m.strength ?? 180, 'paint');
    const rows = [];
    let firstMismatch = null;
    for (let b = 0; b < batches; b++) {
      const r = bank.sample(cpu.tick);
      kickFromRates(stimulus === 'poisson' ? zeroRates : r, injectGain, null, kick);
      const pr = stimulus === 'poisson' ? r : zeroRates;
      const a = cpu.batch(steps, pr, false, kick),
        g = await brain.batch(steps, pr, false, kick);
      let diff = 0,
        extraG = 0;
      for (let i = 0; i < graph.n; i++)
        if (a.counts[i] !== g.counts[i]) {
          diff++;
          extraG += g.counts[i] - a.counts[i];
        }
      if (diff && firstMismatch === null) firstMismatch = b;
      rows.push({ batch: b, ms: (b + 1) * steps * 0.1, cpu: a.total, gpu: g.total, neuronsDiffering: diff, gpuMinusCpu: extraG });
    }
    await brain.reset();
    pulses.reset();
    monitor.reset();
    postMessage({ type: 'parity', id: m.id, steps, batches, warm, firstMismatch, rows });
  } else if (m.type === 'step') {
    if (m.generation !== generation) return;
    const started = performance.now(),
      steps = m.steps ?? batchSteps;
    const pulseRates = pulses.sample(brain.tick);
    let result;
    if (stimulus === 'poisson') {
      // Xenova's path: pulses are Poisson event rates; the inject API still adds current.
      kickFromRates(zeroRates, 0, external, kick);
      result = await brain.batch(steps, pulseRates, m.silenced, kick);
    } else {
      kickFromRates(pulseRates, injectGain, external, kick);
      result = await brain.batch(steps, zeroRates, m.silenced, kick);
    }
    monitor.update(result.counts, steps);
    const reference = decodeCounts(result.counts, groups, steps);
    let rates = reference;
    if (backend === 'gpu') {
      rates = result.rates;
      for (let c = 0; c < rates.length; c++)
        if (
          !Number.isFinite(rates[c]) ||
          Math.abs(rates[c] - reference[c]) > 1e-3 * Math.max(1, reference[c])
        )
          throw Error('GPU population readout disagrees with JavaScript');
    }
    const ids = [],
      values = [];
    for (let i = 0; i < result.counts.length; i++)
      if (result.counts[i]) {
        ids.push(i);
        values.push(result.counts[i]);
      }
    const firing = Uint32Array.from(ids),
      counts = Uint16Array.from(values),
      watchedRates = watched.length ? monitor.read(watched) : null;
    postMessage(
      {
        type: 'result',
        generation,
        tick: result.tick,
        steps,
        total: result.total,
        rates,
        firing,
        counts,
        watched: watchedRates,
        wallMs: performance.now() - started,
      },
      [rates.buffer, firing.buffer, counts.buffer, ...(watchedRates ? [watchedRates.buffer] : [])],
    );
  }
}
