/**
 * Xenova's connectome LIF reference (vendor/fruit-fly-simulation/src/brain.js) with one addition:
 * an additive external current per neuron (`kick`, mV per 0.1 ms tick), applied every tick the
 * neuron is not refractory. PARAMETERS, the RNG and the CSR transpose are re-exported unchanged.
 */
import { PARAMETERS, randomWord, outgoingGraph } from '../../vendor/fruit-fly-simulation/src/brain.js';
export { PARAMETERS, randomWord, outgoingGraph };

function injectedIndices(kick) {
  if (!kick) return null;
  const out = [];
  for (let i = 0; i < kick.length; i++) if (kick[i] !== 0) out.push(i);
  return out;
}
const EM = Math.exp(-PARAMETERS.dt / PARAMETERS.tauM);
const ES = Math.exp(-PARAMETERS.dt / PARAMETERS.tauS);
const COUPLING = (PARAMETERS.tauS / (PARAMETERS.tauM - PARAMETERS.tauS)) * (EM - ES);

/** Event-driven scheduling; exactly resting neurons need no state update. */
export class BrainCPU {
  constructor(graph, { seed = 1 } = {}) {
    this.graph = graph;
    this.n = graph.n;
    this.seed = seed;
    this.out = outgoingGraph(graph);
    this.reset();
  }
  reset() {
    const n = this.n;
    this.v = new Float32Array(n).fill(-52);
    this.g = new Float32Array(n);
    this.until = new Uint32Array(n);
    this.counts = new Uint32Array(n);
    this.history = Array.from({ length: 19 }, () => []);
    this.tick = 0;
    this.active = new Uint32Array(n);
    this.present = new Uint8Array(n);
    this.activeCount = 0;
  }
  activate(i) {
    if (!this.present[i]) {
      this.present[i] = 1;
      this.active[this.activeCount++] = i;
    }
  }
  step(rates, externalEvents = null, silenced = false, kick = null) {
    const driven = [];
    for (let i = 0; i < this.n; i++)
      if (externalEvents ? externalEvents[i] : rates[i] > 0) driven.push(i);
    return this.advance(rates, driven, externalEvents, silenced, kick, injectedIndices(kick));
  }
  advance(rates, driven, externalEvents, silenced, kick = null, injected = null) {
    const { v, g, until, counts, active, present } = this,
      t = this.tick,
      p = PARAMETERS;
    const fired = [];
    let kept = 0;
    for (let k = 0; k < this.activeCount; k++) {
      const i = active[k];
      // No epsilon cutoff: skip only the exact stationary state. Refractory
      // deadlines remain stored and incoming events still check them.
      if (v[i] === p.rest && g[i] === 0) {
        present[i] = 0;
        continue;
      }
      active[kept++] = i;
      if (t >= until[i]) {
        v[i] = p.rest + (v[i] - p.rest) * EM + g[i] * COUPLING;
        g[i] *= ES;
        if (v[i] > p.threshold) fired.push(i);
      }
    }
    this.activeCount = kept;
    // Preserve the dense reference's source order and Float32 accumulation.
    fired.sort((a, b) => a - b);
    const due = this.history[t % 19],
      out = this.out;
    if (!silenced)
      for (const i of due) {
        const sign = this.graph.sign[i] * p.synapse;
        if (!sign) continue;
        for (let e = out.offsets[i]; e < out.offsets[i + 1]; e++) {
          const j = out.targets[e];
          if (t >= until[j]) {
            g[j] += out.counts[e] * sign;
            this.activate(j);
          }
        }
      }
    for (const i of driven) {
      if (
        t >= until[i] &&
        (externalEvents || randomWord(i, t, this.seed) / 4294967296 < (rates[i] * p.dt) / 1000)
      ) {
        v[i] += p.poissonWeight;
        this.activate(i);
      }
    }
    // Injected current: kick[i] is mV per tick, already scaled by dt (src/brain/inject.js).
    // Same position and float32 order as the WGSL advance: after the Poisson kick, before reset.
    if (kick)
      for (const i of injected)
        if (t >= until[i]) {
          v[i] += kick[i];
          this.activate(i);
        }
    for (const i of fired) {
      v[i] = p.rest;
      g[i] = 0;
      until[i] = t + (rates[i] > 0 ? 0 : p.refractory);
      counts[i]++;
    }
    this.history[t % 19] = [];
    this.history[(t + p.delay) % 19] = fired;
    this.tick++;
    return fired;
  }
  batch(steps, rates, silenced = false, kick = null) {
    const driven = [];
    for (let i = 0; i < this.n; i++) if (rates[i] > 0) driven.push(i);
    if (kick && kick.length !== this.n) throw Error('Injected current size must match neuron count');
    const injected = injectedIndices(kick);
    this.counts.fill(0);
    let total = 0;
    for (let k = 0; k < steps; k++)
      total += this.advance(rates, driven, null, silenced, kick, injected).length;
    return { counts: this.counts.slice(), tick: this.tick, total };
  }
}
