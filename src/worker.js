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
import { loadGraph as loadOpticGraph, unitsWhere as opticUnitsWhere, typeName as opticTypeName, roleName as opticRoleName } from './brain/optic/graph.js';
import { OpticBrain } from './brain/optic/optic.js';
import { eyesFromColumns } from './eye/ommatidia.js';

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
  watched = new Uint32Array(0),
  // ---- Phase 3: the optic-v2 rate net [A] and the bridge into [B]
  optic = null, // OpticBrain
  omm = null,
  // dnBias: tonic "flight state" current (mV/ms) on [B]'s DNg02 cells, through the inject API. Their
  // app does the same (dnBias 0.5 in rate units): HS reaches DNg02 via a GABAergic relay, so it can
  // only modulate a DNg02 that is already active.
  // holdPerFrame: run all of a frame's [A] substeps first, then one [B] batch with the injected
  // current held (GOAL.md's "rate hold"): one GPU fence per frame instead of one per 4 ms.
  bridge = { on: true, gain: 2, typeGains: { HS: 1, LC4: 1, LPLC2: 1 }, subtractRest: true, set: 'validated', dnBias: 0, holdPerFrame: true },
  pairs = null, // { a: Int32Array, b: Int32Array, gain: Float32Array, rest: Float32Array, key: string[] }
  readoutSets = null, // [B] index sets by body ID: DNg02 L/R, DNp, wing MN L/R, haltere MN, bridge cells
  pendingDt = 0,
  frameCount = 0,
  loopStats = { opticMs: 0, brainMs: 0, substeps: 0 };
// Host quirk (GPU box, Brave 151 + NVIDIA 610 under the flags in bench/lib/browser.mjs; see
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
    if (m.adapt && brain.setAdaptation) brain.setAdaptation(m.adapt.inc ?? 0, m.adapt.tau ?? 300);
    if (m.optic) await initOptic(m.optic, m.columns, m.opticBackend ?? 'cpu', m.opticParams ?? {});
    postMessage({ type: 'ready', backend, stimulus, steps: batchSteps, optic: optic ? optic.name : null, bridge: pairs ? { ...bridge, pairs: pairs.a.length } : null });
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
  } else if (m.type === 'mute') {
    // Ablation primitive: hold whole populations far below threshold through the current path
    // (v -= |current|·dt every tick). {superclasses:[...]} and/or {bodyIds:[...]}; {clear:true} lifts all.
    if (m.clear) { external.fill(0); if (readoutSets) applyDnBias(); }
    const I = -Math.abs(m.current ?? 50);
    let count = 0;
    if (m.superclasses) { const want = new Set(m.superclasses); for (let i = 0; i < graph.n; i++) if (want.has(graph.neurons[i][2])) { external[i] = I; count++; } }
    if (m.bodyIds) { const idx = indicesOf(m.bodyIds); for (const i of idx) { external[i] = I; count++; } }
    postMessage({ type: 'mute', count, superclasses: m.superclasses ?? null });
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
    pendingDt = 0;
    frameCount = 0;
    if (optic) { optic.reset(); optic.settle(0.5); if (pairs) { pairs.rested = false; pairs.rest.fill(0); } }
    if (readoutSets) applyDnBias();
    postMessage({ type: 'reset', generation });
  } else if (m.type === 'clear') {
    pulses.reset();
  } else if (m.type === 'bridge') {
    Object.assign(bridge, m.config ?? {});
    if (m.config?.typeGains) bridge.typeGains = { ...bridge.typeGains, ...m.config.typeGains };
    if (optic) buildPairs();
    if (readoutSets) applyDnBias();
    postMessage({ type: 'bridge', config: { ...bridge, pairs: pairs ? pairs.a.length : 0 } });
  } else if (m.type === 'frame') {
    // One rendered frame of the scene: dt seconds of neural time to integrate with this
    // luminance held constant. Fixed 4 ms substeps: [A] step -> bridge -> [B] 40 ticks.
    if (m.generation !== generation) return;
    if (!optic) throw Error('frame needs the optic net (init with optic:)');
    const started = performance.now();
    pendingDt += m.dt;
    const netDt = optic.params.netDt, ticks = Math.round(netDt / 0.0001);
    let substeps = 0, opticMs = 0, brainMs = 0, spikes = 0;
    const counts = new Float32Array(graph.n);
    const runB = async (nTicks) => {
      const pulseRates = pulses.sample(brain.tick);
      if (stimulus === 'poisson') kickFromRates(zeroRates, 0, external, kick);
      else kickFromRates(pulseRates, injectGain, external, kick);
      if (bridge.on && pairs.rested) addBridgeKick();
      const t1 = performance.now();
      const result = await brain.batch(nTicks, stimulus === 'poisson' ? pulseRates : zeroRates, m.silenced ?? false, kick);
      monitor.update(result.counts, nTicks);
      for (let i = 0; i < graph.n; i++) counts[i] += result.counts[i];
      spikes += result.total;
      brainMs += performance.now() - t1;
    };
    const n = Math.floor(pendingDt / netDt + 1e-9);
    pendingDt -= n * netDt;
    if (optic.gpu) {
      // GPU rate net: the bridge current is built from the previous frame's r (host copy), the
      // substeps are submitted without waiting, r is copied to staging, the LIF batch runs and
      // its readback is the only fence; then r is mapped for this frame's readouts.
      const t0 = performance.now();
      for (let k = 0; k < n; k++) optic.step(m.lumL, m.lumR, netDt);
      optic.flush();
      opticMs += performance.now() - t0;
      for (let done = 0; done < n * ticks; ) {
        const chunk = Math.min(200, n * ticks - done);
        await runB(chunk);
        done += chunk;
      }
      const t2 = performance.now();
      await optic.sync();
      if (!pairs.rested && optic.calibrated) captureRest();
      opticMs += performance.now() - t2;
      substeps = n;
    } else if (bridge.holdPerFrame) {
      const t0 = performance.now();
      for (let k = 0; k < n; k++) {
        optic.step(m.lumL, m.lumR, netDt);
        if (!pairs.rested && optic.calibrated) captureRest();
      }
      opticMs += performance.now() - t0;
      // one [B] batch for the whole frame (<= 200 ticks), current held at [A]'s end-of-frame rates
      for (let done = 0; done < n * ticks; ) {
        const chunk = Math.min(200, n * ticks - done);
        await runB(chunk);
        done += chunk;
      }
      substeps = n;
    } else
      for (let k = 0; k < n; k++) {
        const t0 = performance.now();
        optic.step(m.lumL, m.lumR, netDt);
        if (!pairs.rested && optic.calibrated) captureRest();
        opticMs += performance.now() - t0;
        await runB(ticks);
        substeps++;
      }
    frameCount++;
    loopStats = { opticMs, brainMs, substeps };
    const rates = readoutRates();
    const ids = [], values = [];
    for (let i = 0; i < graph.n; i++) if (counts[i]) { ids.push(i); values.push(counts[i]); }
    const firing = Uint32Array.from(ids), fcounts = Uint16Array.from(values);
    postMessage(
      { type: 'frame', generation, frame: frameCount, tick: brain.tick, substeps, spikes, optic: optic.readouts(), rates, watched: watched.length ? monitor.read(watched) : null, firing, counts: fcounts, opticMs, brainMs, wallMs: performance.now() - started },
      [firing.buffer, fcounts.buffer],
    );
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

// ---------------------------------------------------------------------------------------------
// Phase 3 helpers

async function initOptic(urls, columns, opticBackend = 'cpu', opticParams = {}) {
  postMessage({ type: 'stage', message: 'Loading the optic-v2 graph…' });
  const g = await loadOpticGraph(urls.graphJson, urls.graphBin, (loaded, total) => postMessage({ type: 'progress', value: total ? loaded / total : 0 }));
  const fv = await (await fetch(urls.params)).json();
  postMessage({ type: 'stage', message: 'Building the optic-v2 rate net…' });
  omm = eyesFromColumns(columns);
  optic = new OpticBrain(g, fv, omm.left, omm.right, opticParams);
  if (opticParams.flightGain && opticParams.flightGain !== 1) postMessage({ type: 'stage', message: `flight-state gain ${opticParams.flightGain} on ${optic.flightScaledEdges} synapses onto LPTCs` });
  postMessage({ type: 'stage', message: 'Settling the optic net under grey…' });
  optic.settle(0.5);
  if (opticBackend === 'gpu') {
    if (brain.device) { await optic.useGPU(brain.device); postMessage({ type: 'stage', message: 'optic-v2 rate net moved to the GPU (same device as the LIF)' }); }
    else postMessage({ type: 'fallback', message: 'optic=gpu asked but the LIF is on the CPU; the rate net stays on the CPU' });
  }
  buildPairs();
  buildReadoutSets();
  applyDnBias();
  postMessage({ type: 'stage', message: `Bridge: ${pairs.a.length} cells (${bridge.set}) from optic-v2 into MaleCNS by body ID` });
}

/** [A] unit -> [B] neuron pairs for the bridge set, with per-type gains. */
function buildPairs() {
  const g = optic.graph;
  const key = (t) => (/^HS[ENS]$/.test(t) ? 'HS' : t === 'LC4' ? 'LC4' : t === 'LPLC2' ? 'LPLC2' : /^VS/.test(t) ? 'VS' : t);
  const want = (i) => {
    const t = opticTypeName(g, i), r = opticRoleName(g, i);
    if (bridge.set === 'inputs') return r === 'input'; // every LPTC and looming LC (1,114)
    return /^HS[ENS]$/.test(t) || t === 'LC4' || t === 'LPLC2'; // validated: HS, LC4, LPLC2
  };
  const a = [], b = [], gain = [], keys = [];
  for (let i = 0; i < g.n; i++) {
    if (!want(i)) continue;
    const j = bodyIndex.get(g.bodyId[i]);
    if (j === undefined) continue;
    const k = key(opticTypeName(g, i));
    a.push(i); b.push(j); keys.push(k); gain.push(bridge.typeGains[k] ?? 1);
  }
  const rest = pairs?.rested && pairs.a.length === a.length ? pairs.rest : new Float32Array(a.length);
  pairs = { a: Int32Array.from(a), b: Int32Array.from(b), gain: Float32Array.from(gain), key: keys, rest, rested: pairs?.rested && pairs.a.length === a.length ? pairs.rested : false };
}

/** After the optic warm-up: each bridge cell's rest rate, subtracted before injection. */
function captureRest() {
  const r = optic.net.r;
  for (let k = 0; k < pairs.a.length; k++) pairs.rest[k] = r[pairs.a[k]];
  pairs.rested = true;
}

/** kick[b] += gain · typeGain · max(0, r_a − rest_a) · dt  (mV per tick), on top of the pulse/inject kick. */
function addBridgeKick() {
  const r = optic.net.r, dt = 0.1, G = bridge.gain, sub = bridge.subtractRest ? 1 : 0;
  for (let k = 0; k < pairs.a.length; k++) {
    const v = r[pairs.a[k]] - sub * pairs.rest[k];
    if (v > 0) kick[pairs.b[k]] += G * pairs.gain[k] * v * dt;
  }
}

/** [B] index sets by body ID for the loop's readouts. */
function buildReadoutSets() {
  const g = optic.graph;
  const fromOptic = (pred) => { const out = []; for (let i = 0; i < g.n; i++) if (pred(opticTypeName(g, i), g.side[i] === 0 ? 'L' : g.side[i] === 1 ? 'R' : 'M', opticRoleName(g, i))) { const j = bodyIndex.get(g.bodyId[i]); if (j !== undefined) out.push(j); } return Uint32Array.from(out); };
  const fromB = (pred) => { const out = []; for (let i = 0; i < graph.n; i++) if (pred(graph.neurons[i][1], graph.neurons[i][3], graph.neurons[i][2])) out.push(i); return Uint32Array.from(out); };
  const HALTERE = /^(hDVM|hi\d|hiii\d|MNhm)/;
  readoutSets = {
    dng02L: fromB((t, s) => /^DNg02/.test(t) && s === 'L'), dng02R: fromB((t, s) => /^DNg02/.test(t) && s === 'R'),
    dnp01: fromB((t) => t === 'DNp01'), dnp: fromB((t) => /^DNp0[1-6]$/.test(t)),
    hsL: fromB((t, s) => /^HS[ENS]$/.test(t) && s === 'L'), hsR: fromB((t, s) => /^HS[ENS]$/.test(t) && s === 'R'),
    lc4L: fromB((t, s) => t === 'LC4' && s === 'L'), lc4R: fromB((t, s) => t === 'LC4' && s === 'R'),
    lplc2L: fromB((t, s) => t === 'LPLC2' && s === 'L'), lplc2R: fromB((t, s) => t === 'LPLC2' && s === 'R'),
    wingMnL: fromOptic((t, s, r) => r === 'output' && !HALTERE.test(t) && s === 'L'), wingMnR: fromOptic((t, s, r) => r === 'output' && !HALTERE.test(t) && s === 'R'),
    haltereMn: fromOptic((t, _s, r) => r === 'output' && HALTERE.test(t)),
    // relays on the HS -> DNg02 routes (bench/paths.mjs), for diagnosis
    ps080L: fromB((t, s) => t === 'PS080' && s === 'L'), ps080R: fromB((t, s) => t === 'PS080' && s === 'R'),
    vuma4: fromB((t) => t === 'OA-VUMa4'), gng286L: fromB((t, s) => t === 'GNG286' && s === 'L'), gng286R: fromB((t, s) => t === 'GNG286' && s === 'R'),
    dna02L: fromB((t, s) => t === 'DNa02' && s === 'L'), dna02R: fromB((t, s) => t === 'DNa02' && s === 'R'),
    walkL: fromB((t, s) => ['DNp09', 'DNg100', 'DNg97'].includes(t) && s === 'L'), walkR: fromB((t, s) => ['DNp09', 'DNg100', 'DNg97'].includes(t) && s === 'R'),
    turnL: fromB((t, s) => ['DNa02', 'DNa11', 'DNg13'].includes(t) && s === 'L'), turnR: fromB((t, s) => ['DNa02', 'DNa11', 'DNg13'].includes(t) && s === 'R'),
  };
}

/** Tonic current on [B]'s DNg02 (both sides) = bridge.dnBias mV/ms, via the external-current array. */
function applyDnBias() {
  for (const k of ['dng02L', 'dng02R']) for (const i of readoutSets[k]) external[i] = bridge.dnBias;
}

/** Mean EMA rate (Hz) of each readout set in [B]. */
function readoutRates() {
  const out = {};
  for (const [k, idx] of Object.entries(readoutSets)) out[k] = monitor.mean(idx);
  return out;
}
