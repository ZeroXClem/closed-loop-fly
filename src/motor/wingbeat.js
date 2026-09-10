/**
 * Phase-encoded haltere model with wingbeat CPG (step 0b).
 *
 * FITTED STAGE: every constant here is hand-set, not from the connectome. The CPG
 * frequency is physiological (200 Hz ≈ Drosophila wingbeat, Dickinson 1999); the
 * amplitudes and phase sensitivity are tuned to fire each neuron ~once per cycle and
 * produce a decodable steering-MN asymmetry under yaw perturbation. See DECISIONS.md.
 *
 * Architecture:
 *   1. A 200 Hz CPG injects brief current pulses on each wing steering MN at its
 *      preferred wingbeat phase (agonists b1/b2/b3 at phase 0, antagonists i1/iii3
 *      at phase 0.5). Over each 50-tick batch the charge is smeared uniformly
 *      because the GPU's kick buffer is constant within a batch.
 *   2. Haltere afferents fire once per cycle. Under straight flight, both sides
 *      receive the same average kick. Under rotation the L/R amplitudes are modulated
 *      by phaseGain × yawRate × sign, creating a rate asymmetry that the network's
 *      haltere → steering MN synapses can decode (295 syn onto b1, 369 onto b3,
 *      160 onto i1 — all ipsilateral, direct).
 *   3. The readout reads the agonist vs antagonist MN rates and maps the L/R
 *      asymmetry to wing amplitude (src/motor/readout.js source='steering').
 */

/** Default hand-set constants. Each is a fitted-stage number, not a wiring result. */
export const DEFAULT_WINGBEAT = Object.freeze({
  frequency: 200,          // Hz — wingbeat frequency
  cpgAmplitude: 0.8,       // mV/ms — CPG pulse strength on each steering MN
  cpgPulseWidth: 2,        // ticks — pulse duration per cycle (0.2 ms)
  haltereAmplitude: 1.5,   // mV/ms — pulse strength on each afferent
  halterePulseWidth: 1,    // ticks — afferent pulse duration (0.1 ms)
  phaseGain: 0.1,          // phase shift (fraction of cycle) per rad/s yaw rate
  sign: -1,                // +1: left afferents for leftward rotation; −1: mirror
});

export class WingbeatCPG {
  /**
   * @param {object} params — overrides for DEFAULT_WINGBEAT
   * @param {Uint32Array} affL — neuron indices for left haltere afferents
   * @param {Uint32Array} affR — neuron indices for right haltere afferents
   * @param {object} steer — { b1L, b1R, b2L, b2R, … } each a Uint32Array of indices
   */
  constructor(params, affL, affR, steer) {
    this.p = { ...DEFAULT_WINGBEAT, ...params };
    this.affL = affL;
    this.affR = affR;
    this.steer = steer;

    // Period in ticks: 50 at 200 Hz (1000 / (200 * 0.1))
    this.periodTicks = Math.round(1000 / (this.p.frequency * 0.1));

    // Preferred phases for CPG drive on each MN type (fraction of cycle).
    // Agonists (b1, b2, b3) fire at downstroke start (phase 0);
    // antagonists (i1, iii3) fire at upstroke start (phase 0.5).
    // Guard muscles get intermediate phases.
    this.mnPhases = {
      b1: 0.0, b2: 0.05, b3: 0.1,
      i1: 0.5, i2: 0.55, iii1: 0.45, iii3: 0.5,
      hg1: 0.25, hg2: 0.3, hg3: 0.7, hg4: 0.75,
    };
  }

  /**
   * Add CPG + phase-encoded haltere kick for one wingbeat cycle.
   *
   * The kick array is constant within a brain.batch() call, so each neuron gets
   * a time-averaged current: amplitude × pulseWidth / periodTicks mV per tick.
   * Phase information is encoded as L/R amplitude modulation:
   *   left afferents:  hKick × (1 + clamp(phaseGain × yawRate × sign))
   *   right afferents: hKick × (1 − clamp(phaseGain × yawRate × sign))
   *
   * @param {number} yawRate — body yaw rate in rad/s (positive = leftward)
   * @param {Float32Array} kick — mV per tick, indexed by neuron; VALUES ARE ADDED
   */
  fillCycleKick(yawRate, kick) {
    const p = this.p;
    const T = this.periodTicks;

    // ---- haltere afferents: amplitude-modulated by yaw rate ----
    const hBase = p.haltereAmplitude * p.halterePulseWidth / T;
    const shift = Math.max(-1, Math.min(1, p.phaseGain * yawRate * p.sign));
    const hL = hBase * (1 + shift);
    const hR = hBase * (1 - shift);
    for (let k = 0; k < this.affL.length; k++) kick[this.affL[k]] += hL;
    for (let k = 0; k < this.affR.length; k++) kick[this.affR[k]] += hR;

    // ---- CPG: brief pulses on each steering MN type ----
    const cpgKick = p.cpgAmplitude * p.cpgPulseWidth / T;
    for (const prefix of Object.keys(this.mnPhases)) {
      for (const side of ['L', 'R']) {
        const idx = this.steer[prefix + side];
        if (idx) for (let k = 0; k < idx.length; k++) kick[idx[k]] += cpgKick;
      }
    }
  }
}
