/**
 * Phase 4: motor readout from the VNC of [B]. This replaces the semantics of Xenova's
 * controller.js. The only hand-written map is the published DNg02 population code
 * (Namiki et al. 2022): DNg02 activity sets wingbeat amplitude, the left/right imbalance
 * steers. Everything upstream of the rates is the connectome.
 *
 *   ampMean = baseAmp + thrustGain · (wingMN − wingMNrest) / (wingMNrest + floor)
 *   diff    = turnSign · turnGain · (dng02L − dng02R) / (dng02L + dng02R + floor)
 *   left    = ampMean + diff/2,  right = ampMean − diff/2       (clamped to 0..1)
 *
 * Rates are Hz from the worker's EMA monitor. Rest levels are captured while the fly is
 * still and the drum does not move, exactly as [A]'s readout offsets are. `turnSign` is
 * fixed by the wiring: left-eye progressive motion silences the right DNg02 via PS080
 * (bench/paths.mjs), and the fly must yaw with the drum, so (L − R) > 0 must turn left.
 * A first-order lag on the amplitudes (`motorTau`) stands in for the wing hinge dynamics.
 */
/** Steering MN rate keys used by the 'steering' readout source (step 0b). */
const STEER_KEYS = ['b1L', 'b1R', 'b2L', 'b2R', 'b3L', 'b3R', 'i1L', 'i1R', 'iii3L', 'iii3R'];

export const DEFAULT_READOUT = Object.freeze({
  /**
   * 'dng02' (default): the published flight population code. 'dna02': DEVIATION for exploring
   * the closed loop only — DNa02 is a walking-turn descending neuron that HS drives directly
   * (36–47 synapses, bench/paths.mjs) and it lateralises strongly in [B], where DNg02 does not
   * (docs/phase3.md). Not a published flight map; every result taken with it says so.
   * 'steering': FITTED STAGE — reads wing steering MN rates (b1/b2/b3 as agonists, i1/iii3
   * as antagonists); the L/R asymmetry of the net drive maps to turn command. Requires the
   * wingbeat CPG to fire the steering MNs (?haltere=phase). See docs/followups.md §9.
   */
  source: 'dng02',
  baseAmp: 0.5,
  thrustGain: 0.0, // hover in Phase 4; Phase 5 cruise turns this on
  turnGain: 1.0,
  turnSign: 1, // +1: DNg02 L > R -> left = base - diff/2 (softer left wing) -> yaw left
  maxTurn: 0.5,
  floor: 5, // Hz, keeps a silent pair from being infinitely sensitive
  motorTau: 0.05, // s
  /**
   * Follow-up (docs/followups.md §3). gate: scale the turn by min(1, (L+R)/(restL+restR)) so a
   * pair that has gone silent commands nothing instead of −(restL−restR)/floor (the
   * "silent readout" artefact of docs/ablations.md). recenterTau (s): let the rest levels
   * follow the rates with this time constant while flying (0 = frozen at capture), so a
   * standing asymmetry that wanders after calibration does not become a permanent turn.
   */
  gate: 0,
  recenterTau: 0,
});

export class MotorReadout {
  constructor(params = {}) {
    this.p = { ...DEFAULT_READOUT, ...params };
    this.reset();
  }
  reset() {
    this.rest = null;
    this.restAcc = { n: 0, dng02L: 0, dng02R: 0, wingL: 0, wingR: 0 };
    this.cmd = { left: this.p.baseAmp, right: this.p.baseAmp };
    this.turn = 0;
    this.diffRaw = 0;
  }
  /** Accumulate rest levels (call while still); `captureRest()` freezes them. */
  accumulateRest(rates) {
    const a = this.restAcc;
    a.n++;
    a.dng02L += rates.dng02L;
    a.dng02R += rates.dng02R;
    a.dna02L = (a.dna02L ?? 0) + rates.dna02L;
    a.dna02R = (a.dna02R ?? 0) + rates.dna02R;
    a.wingL += rates.wingMnL;
    a.wingR += rates.wingMnR;
    // steering MN rest levels (step 0b)
    for (const k of STEER_KEYS) a[k] = (a[k] ?? 0) + (rates[k] ?? 0);
  }
  captureRest() {
    const a = this.restAcc, n = Math.max(1, a.n);
    this.rest = { dng02L: a.dng02L / n, dng02R: a.dng02R / n, dna02L: (a.dna02L ?? 0) / n, dna02R: (a.dna02R ?? 0) / n, wing: (a.wingL + a.wingR) / (2 * n) };
    for (const k of STEER_KEYS) this.rest[k] = (a[k] ?? 0) / n;
    return this.rest;
  }
  /** rates: the worker's readout rates (Hz); dt: frame seconds. Returns { left, right }. */
  step(rates, dt) {
    const p = this.p;
    let diffRaw, gate = 1;
    if (p.source === 'steering') {
      // Step 0b: agonist (b1+b2+b3) vs antagonist (i1+iii3), rest-subtracted, per side
      const r = this.rest ?? {};
      const ag = (s) => ((rates['b1' + s] ?? 0) - (r['b1' + s] ?? 0)) + ((rates['b2' + s] ?? 0) - (r['b2' + s] ?? 0)) + ((rates['b3' + s] ?? 0) - (r['b3' + s] ?? 0));
      const ant = (s) => ((rates['i1' + s] ?? 0) - (r['i1' + s] ?? 0)) + ((rates['iii3' + s] ?? 0) - (r['iii3' + s] ?? 0));
      const netL = ag('L') / 3 - ant('L') / 2;
      const netR = ag('R') / 3 - ant('R') / 2;
      const rawL = (rates.b1L ?? 0) + (rates.b2L ?? 0) + (rates.b3L ?? 0) + (rates.i1L ?? 0) + (rates.iii3L ?? 0);
      const rawR = (rates.b1R ?? 0) + (rates.b2R ?? 0) + (rates.b3R ?? 0) + (rates.i1R ?? 0) + (rates.iii3R ?? 0);
      if (p.gate) gate = Math.min(1, (rawL + rawR) / ((r.b1L ?? 0) + (r.b2L ?? 0) + (r.b3L ?? 0) + (r.i1L ?? 0) + (r.iii3L ?? 0) + (r.b1R ?? 0) + (r.b2R ?? 0) + (r.b3R ?? 0) + (r.i1R ?? 0) + (r.iii3R ?? 0) + 1e-6));
      diffRaw = gate * (netL - netR) / (rawL + rawR + p.floor);
      if (p.recenterTau > 0 && this.rest) { const b = Math.min(1, dt / p.recenterTau); for (const k of STEER_KEYS) this.rest[k] = (this.rest[k] ?? 0) + b * ((rates[k] ?? 0) - (this.rest[k] ?? 0)); }
    } else {
    const src = p.source === 'dna02' ? 'dna02' : 'dng02';
    const L = rates[src + 'L'], R = rates[src + 'R'];
    // remove the standing asymmetry of the two populations (their rest), like [A]'s side offsets
    const restL = this.rest?.[src + 'L'] ?? 0, restR = this.rest?.[src + 'R'] ?? 0;
    const dL = L - restL, dR = R - restR;
    gate = p.gate ? Math.min(1, (L + R) / (restL + restR + 1e-6)) : 1;
    diffRaw = gate * (dL - dR) / (L + R + p.floor);
    if (p.recenterTau > 0 && this.rest) { const b = Math.min(1, dt / p.recenterTau); this.rest[src + 'L'] = restL + b * (L - restL); this.rest[src + 'R'] = restR + b * (R - restR); }
    }
    this.gate = gate;
    this.diffRaw = diffRaw;
    // turn > 0 = yaw right (their convention): left wing harder
    const turnTarget = Math.max(-p.maxTurn, Math.min(p.maxTurn, -p.turnSign * p.turnGain * diffRaw));
    const wing = (rates.wingMnL + rates.wingMnR) / 2, wingRest = this.rest?.wing ?? wing;
    const meanTarget = p.baseAmp + p.thrustGain * ((wing - wingRest) / (wingRest + p.floor));
    const a = Math.min(1, dt / p.motorTau);
    this.turn += a * (turnTarget - this.turn);
    const mean = Math.max(0, Math.min(1, meanTarget));
    this.cmd = { left: clamp01(mean + this.turn / 2), right: clamp01(mean - this.turn / 2) };
    return this.cmd;
  }
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
