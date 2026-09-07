/**
 * External current for the LIF, and the bridge from Xenova's pulse rates to it.
 *
 * Units: a "current" I is in mV/ms (current × membrane resistance). Each 0.1 ms tick the
 * kernels add `kick[i] = I[i] · dt` to v when the neuron is not refractory, so a constant I
 * settles at Δv = I · τm above rest and reaches threshold when I > (θ/τm) = 0.35 mV/ms.
 *
 * `rateToCurrent(hz)` is the current at which an *isolated* LIF with these parameters fires
 * at `hz` Hz (regular spiking with the 2.2 ms refractory period). It lets the painted pulse
 * envelopes (Hz) drive the inject path with comparable strength; unlike the Poisson path it
 * sums with recurrent input and keeps the refractory period.
 */
import { PARAMETERS as P } from '../../vendor/fruit-fly-simulation/src/brain.js';

export const THETA_MV = P.threshold - P.rest; // 7 mV
export const TAU_MS = P.tauM; // 20 ms
export const REFRACTORY_MS = P.refractory * P.dt; // 2.2 ms
export const THRESHOLD_CURRENT = THETA_MV / TAU_MS; // 0.35 mV/ms
/** Above this the interspike interval would fall inside the refractory period. */
export const MAX_RATE_HZ = 400;

export function rateToCurrent(hz) {
  if (!(hz > 0)) return 0;
  const f = Math.min(hz, MAX_RATE_HZ);
  const E = Math.exp((1000 / f - REFRACTORY_MS) / TAU_MS);
  return (THETA_MV * E) / (TAU_MS * (E - 1));
}

/** Inverse of rateToCurrent for an isolated cell (0 below threshold). */
export function currentToRate(I) {
  if (!(I > THRESHOLD_CURRENT)) return 0;
  const T = REFRACTORY_MS + TAU_MS * Math.log((I * TAU_MS) / (I * TAU_MS - THETA_MV));
  return 1000 / T;
}

/**
 * kick[i] = (rateToCurrent(rates[i]) · gain + external[i]) · dt, mV per tick.
 * `external` (mV/ms) is the direct inject API; `rates` (Hz) are the painted pulses.
 */
export function kickFromRates(rates, gain, external, out) {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    let I = external ? external[i] : 0;
    const r = rates[i];
    if (r > 0) I += gain * rateToCurrent(r);
    out[i] = I * P.dt;
  }
  return out;
}
