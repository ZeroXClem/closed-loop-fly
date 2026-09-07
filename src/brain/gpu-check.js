// Copy of vendor/fruit-fly-simulation/src/gpu-check.js extended to exercise the injected current.
import { BrainCPU } from './brain.js';

// Injected current on the last workgroup: 0, 4, 8, 12, 16 mV steady state (dt-scaled kick).
export function parityKick(n) {
  const kick = new Float32Array(n);
  for (let i = 192; i < n; i++) kick[i] = 0.02 * (i % 5);
  return kick;
}

// 257-neuron fixture covers three workgroups, including a partial group.
export function parityGraph() {
  const n = 257,
    rows = Array.from({ length: n }, () => []),
    sign = new Int32Array(n).fill(1);
  for (let i = 0; i < 64; i++) {
    rows[64 + i].push([i, 80], [128 + i, 60]);
    rows[192 + i].push([64 + i, 100]);
    sign[128 + i] = -1;
  }
  rows[256].push([0, 80], [128, 60]);
  const offsets = [0],
    sources = [],
    counts = [];
  for (const row of rows) {
    for (const [i, c] of row) {
      sources.push(i);
      counts.push(c);
    }
    offsets.push(sources.length);
  }
  return {
    n,
    offsets: Uint32Array.from(offsets),
    sources: Uint32Array.from(sources),
    counts: Uint32Array.from(counts),
    sign,
  };
}

export async function checkGPU(create) {
  const graph = parityGraph(),
    cpu = new BrainCPU(graph),
    gpu = await create(graph);
  const rates = Float32Array.from({ length: graph.n }, (_, i) =>
    i < 64 || (i >= 128 && i < 192) ? 1000 : 0,
  );
  const zeroRates = new Float32Array(graph.n),
    kick = parityKick(graph.n);
  // Xenova's cases (no current), then current alone, then both together.
  const cases = [
    [rates, null],
    [zeroRates, kick],
    [rates, kick],
  ];
  let maxVoltageError = 0,
    maxSynapticError = 0,
    totalSpikes = 0;
  try {
    // Irregular batch boundaries exercise delay-ring wrap and count clearing.
    for (const [r, k] of cases)
    for (const silent of [false, true]) {
      cpu.reset();
      await gpu.reset();
      for (const steps of [1, 17, 19, 63, 100, 100, 100, 100, 100, 100, 100]) {
        const expected = cpu.batch(steps, r, silent, k),
          actual = await gpu.batch(steps, r, silent, k);
        if (actual.tick !== expected.tick || actual.counts.length !== graph.n)
          throw Error('GPU self-check: invalid clock or output size');
        for (let i = 0; i < graph.n; i++)
          if (actual.counts[i] !== expected.counts[i])
            throw Error(`GPU self-check: spike mismatch at neuron ${i}, tick ${expected.tick}`);
        totalSpikes += expected.total;
        const state = await gpu.snapshot();
        for (let i = 0; i < graph.n; i++) {
          const dv = Math.abs(state.v[i] - cpu.v[i]),
            dg = Math.abs(state.g[i] - cpu.g[i]);
          if (
            !Number.isFinite(dv) ||
            !Number.isFinite(dg) ||
            dv > 0.002 ||
            dg > 0.002 ||
            state.until[i] !== cpu.until[i]
          )
            throw Error(`GPU self-check: state mismatch at neuron ${i}, tick ${expected.tick}`);
          maxVoltageError = Math.max(maxVoltageError, dv);
          maxSynapticError = Math.max(maxSynapticError, dg);
        }
      }
    }
    return { neurons: graph.n, steps: 1600 * cases.length, totalSpikes, maxVoltageError, maxSynapticError };
  } finally {
    gpu.destroy();
  }
}
