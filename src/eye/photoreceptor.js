/**
 * Photoreceptor front end, exactly as AbijahKaj's app drives its lamina (vendor/fruit-fly-
 * brain-research/app/src/brain/optic.ts, injectEye):
 *
 *   mean_k  <- slow running mean of luminance (Weber adaptation, tau adaptTau = 1 s)
 *   stim_k  =  min(stimMax, 0.5 * lum_k / (mean_k + 1e-3))     steady light -> 0.5 (flyvis grey)
 *   tau dV_k/dt = -V_k + restOffset + stimGain * gain * stim_k   (tau = photoreceptor.tau, 19.6 ms)
 *   r_k     =  max(0, V_k)
 *
 * GOAL.md calls this "log-luminance, high-pass in time"; what their fitted parameters were
 * trained with is this divisive adaptation plus a first-order low-pass, so that is what runs.
 * The lamina then receives ext[L1] = -1.657 r, ext[L2] = -1.617 r, ext[L3] = -0.314 r
 * (fitted-params.json photoreceptor.laminaInput), which is Phase 3's business.
 */
export const DEFAULT_PHOTORECEPTOR = Object.freeze({
  tau: 0.01963581144809723, // s, fitted-params.json photoreceptor.tau
  restOffset: 0.776,
  stimGain: 0.99,
  adaptTau: 1.0, // s, OpticParams.adaptTau
  stimMax: 1.5, // OpticParams.stimMax
  gain: 1, // OpticParams.stimGain
});

export class Photoreceptors {
  constructor(count, params = {}) {
    this.count = count;
    this.p = { ...DEFAULT_PHOTORECEPTOR, ...params };
    this.mean = new Float32Array(count);
    this.v = new Float32Array(count);
    this.r = new Float32Array(count);
    this.stim = new Float32Array(count);
    this.adapted = false;
  }
  reset() {
    this.mean.fill(0);
    this.v.fill(0);
    this.r.fill(0);
    this.stim.fill(0);
    this.adapted = false;
  }
  /** Advance by dt seconds with the eye's luminance sample; returns r (rectified membrane). */
  step(lum, dt) {
    const p = this.p,
      alpha = Math.min(1, dt / p.tau),
      aAdapt = Math.min(1, dt / p.adaptTau),
      { mean, v, r, stim } = this;
    for (let k = 0; k < this.count; k++) {
      if (!this.adapted) mean[k] = lum[k];
      else mean[k] += aAdapt * (lum[k] - mean[k]);
      const s = Math.min(p.stimMax, (0.5 * lum[k]) / (mean[k] + 1e-3));
      stim[k] = s;
      const target = p.restOffset + p.stimGain * p.gain * s;
      v[k] += alpha * (target - v[k]);
      r[k] = Math.max(0, v[k]);
    }
    this.adapted = true;
    return r;
  }
}
