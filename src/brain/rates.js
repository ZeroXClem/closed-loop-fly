/**
 * Per-neuron firing-rate estimate from batch spike counts: an exponential moving average
 * with time constant `tauMs` (default 20 ms), updated once per worker batch.
 */
export class RateMonitor {
  constructor(n, tauMs = 20) {
    this.n = n;
    this.tauMs = tauMs;
    this.ema = new Float32Array(n);
    this.tick = 0;
  }
  reset() {
    this.ema.fill(0);
    this.tick = 0;
  }
  /** counts: spikes per neuron in a batch of `steps` ticks of 0.1 ms. */
  update(counts, steps) {
    const ms = steps * 0.1,
      alpha = 1 - Math.exp(-ms / this.tauMs),
      scale = 1000 / ms,
      ema = this.ema;
    for (let i = 0; i < this.n; i++) ema[i] += alpha * (counts[i] * scale - ema[i]);
    this.tick += steps;
  }
  /** Rates (Hz) for the given neuron indices. */
  read(indices, out = new Float32Array(indices.length)) {
    for (let k = 0; k < indices.length; k++) out[k] = this.ema[indices[k]];
    return out;
  }
  mean(indices) {
    if (!indices.length) return 0;
    let s = 0;
    for (let k = 0; k < indices.length; k++) s += this.ema[indices[k]];
    return s / indices.length;
  }
}
