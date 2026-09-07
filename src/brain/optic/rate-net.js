/**
 * Rate-model runtime over flat typed arrays (port of vendor/fruit-fly-brain-research/app/src/
 * brain/rate-net.ts):
 *
 *   tau_i dx_i/dt = -x_i + wScale * sum_j W_ij r_j + ext_i + bias_i
 *   r_i = clamp(x_i, 0, rMax)
 *
 * Forward Euler, one loop over the post-unit CSR. Same equation as the WGSL kernel.
 */
export class RateNet {
  constructor(csr, tau, { wScale = 1, rMax = 5 } = {}) {
    this.csr = csr;
    this.n = csr.n;
    this.x = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.ext = new Float32Array(this.n);
    this.bias = new Float32Array(this.n);
    this.tau = tau;
    this.params = { wScale, rMax };
  }
  reset() {
    this.x.fill(0);
    this.r.fill(0);
    this.ext.fill(0);
  }
  /** One Euler step of dt seconds. */
  step(dt) {
    const { indptr, pre, w } = this.csr;
    const { x, r, ext, bias, tau } = this;
    const { wScale, rMax } = this.params;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      let drive = 0;
      const end = indptr[i + 1];
      for (let k = indptr[i]; k < end; k++) drive += w[k] * r[pre[k]];
      const target = wScale * drive + ext[i] + bias[i];
      const a = Math.min(1, dt / tau[i]);
      x[i] += a * (target - x[i]);
    }
    for (let i = 0; i < n; i++) {
      const v = x[i];
      r[i] = v <= 0 ? 0 : v >= rMax ? rMax : v;
    }
  }
  meanRate(idx) {
    if (!idx.length) return 0;
    let s = 0;
    for (let k = 0; k < idx.length; k++) s += this.r[idx[k]];
    return s / idx.length;
  }
  /**
   * Homeostatic bias (port of net.worker.ts): settle, then nudge the bias of `units` toward a
   * target membrane value; at steady state x = drive + ext + bias so the membrane error is the
   * bias correction; rounds absorb recurrent effects.
   */
  homeostat(units, targets, rounds, settleSeconds, eta, dt) {
    const steps = Math.round(settleSeconds / dt);
    let meanErr = 0;
    for (let round = 0; round < rounds; round++) {
      for (let k = 0; k < steps; k++) this.step(dt);
      meanErr = 0;
      for (let k = 0; k < units.length; k++) {
        const i = units[k];
        const err = targets[k] - this.x[i];
        this.bias[i] += eta * err;
        meanErr += Math.abs(err);
      }
      meanErr /= Math.max(1, units.length);
    }
    for (let k = 0; k < steps; k++) this.step(dt);
    let biasMean = 0;
    for (let k = 0; k < units.length; k++) biasMean += this.bias[units[k]];
    return { meanErr, biasMean: biasMean / Math.max(1, units.length) };
  }
}
