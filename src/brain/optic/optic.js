/**
 * The per-column MaleCNS optic lobe (optic-v2) as a brain (port of vendor/fruit-fly-brain-
 * research/app/src/brain/optic.ts, minus the wing command, which is Phase 4's business):
 *
 *   luminance per column -> photoreceptor (src/eye/photoreceptor.js) -> ext on L1/L2/L3 of
 *   that column -> the graph (lamina -> medulla -> T4/T5 -> lobula plate, LC4/LPLC2, ...)
 *   -> readouts: HS L/R (optomotor), LC4/LPLC2 top-k per eye (looming), DNg02, ...
 *
 * Runs on the CPU RateNet here (their worker-fallback path); the GPU kernel is Phase 5.
 * Rates are dimensionless flyvis-style units, rMax 5.
 */
import { buildCSRWeighted, unitsWhere, typeName, sideName } from './graph.js';
import { applyParams, hasType, restV, isPooling } from './params.js';
import { RateNet } from './rate-net.js';
import { Photoreceptors } from '../../eye/photoreceptor.js';

const LAMINA = /^L[123]$/;
const LPTC = /^(HS[ENST]|VS|VST1|VST2|VSm|H2|DCH|VCH)$/;
const LOOMING = /^(LC4|LPLC2)$/;
const DNG02 = /^DNg02_/;

export const DEFAULT_OPTIC_PARAMS = Object.freeze({
  stimGain: 1,
  adaptTau: 1.0,
  stimMax: 1.5,
  defaultScale: 0.02,
  lptcScale: 0.001,
  lptcBias: 0.2,
  dnBias: 0.5,
  restTarget: 0.3,
  restRounds: 40,
  wScale: 1,
  netDt: 0.004,
  rMax: 5,
  loomTopK: 5,
  loomThreshold: 0.1,
  warmSeconds: 2.5,
  readoutFloor: 0.2,
});

export class OpticBrain {
  /**
   * @param graph   fromV2() graph
   * @param fv      fitted-params.json (or flyvis-params.json)
   * @param ommL/ommR  lattices from src/eye/ommatidia.js (their .col maps ommatidium -> column)
   */
  constructor(graph, fv, ommL, ommR, params = {}) {
    this.graph = graph;
    this.fv = fv;
    this.params = { ...DEFAULT_OPTIC_PARAMS, ...params };
    const p = this.params;
    const applied = applyParams(graph, fv, p.defaultScale, p.lptcScale);
    this.applied = applied;
    let nCov = 0;
    for (let i = 0; i < graph.n; i++) nCov += applied.covered[i];
    this.coverage = { types: applied.nCoveredTypes, edges: applied.nCoveredEdges, units: nCov };
    const csr = buildCSRWeighted(graph.n, graph.m, graph.pre, graph.post, applied.w);
    this.net = new RateNet(csr, applied.tau, { wScale: p.wScale, rMax: p.rMax });
    this.bias0 = applied.bias.slice();
    this.net.bias.set(this.bias0);
    this.ommL = ommL;
    this.ommR = ommR;
    this.pr = { L: new Photoreceptors(ommL.count, { adaptTau: p.adaptTau, stimMax: p.stimMax, gain: p.stimGain, tau: fv.photoreceptor.tau, restOffset: fv.photoreceptor.restOffset, stimGain: fv.photoreceptor.stimGain }), R: new Photoreceptors(ommR.count, { adaptTau: p.adaptTau, stimMax: p.stimMax, gain: p.stimGain, tau: fv.photoreceptor.tau, restOffset: fv.photoreceptor.restOffset, stimGain: fv.photoreceptor.stimGain }) };

    // per ommatidium: its column's lamina units and their R -> L weights
    const byCol = (pred) => {
      const m = new Map();
      for (let i = 0; i < graph.n; i++) {
        const c = graph.col[i];
        if (c < 0 || !pred(typeName(graph, i))) continue;
        if (!m.has(c)) m.set(c, []);
        m.get(c).push(i);
      }
      return m;
    };
    const lamW = fv.photoreceptor.laminaInput;
    const flatten = (omm, m) => {
      const ptr = new Int32Array(omm.count + 1), idx = [], wts = [];
      for (let k = 0; k < omm.count; k++) {
        for (const i of m.get(omm.col[k]) ?? []) {
          idx.push(i);
          wts.push(lamW[typeName(graph, i)] ?? 0);
        }
        ptr[k + 1] = idx.length;
      }
      return { ptr, idx: Int32Array.from(idx), w: Float32Array.from(wts) };
    };
    const lam = byCol((t) => LAMINA.test(t));
    this.lamL = flatten(ommL, lam);
    this.lamR = flatten(ommR, lam);
    const t4a = byCol((t) => t === 'T4a'), t4b = byCol((t) => t === 'T4b');
    const lists = (omm, m) => Array.from({ length: omm.count }, (_, k) => Int32Array.from(m.get(omm.col[k]) ?? []));
    this.t4aByOmm = { L: lists(ommL, t4a), R: lists(ommR, t4a) };
    this.t4bByOmm = { L: lists(ommL, t4b), R: lists(ommR, t4b) };

    const fitted = fv.source.startsWith('fitted');
    this.lptc = unitsWhere(graph, (t) => LPTC.test(t) && !(fitted && hasType(fv, t)));
    this.hsL = unitsWhere(graph, (t, s) => /^HS[ENS]$/.test(t) && s === 'L');
    this.hsR = unitsWhere(graph, (t, s) => /^HS[ENS]$/.test(t) && s === 'R');
    this.dnL = unitsWhere(graph, (t, s) => DNG02.test(t) && s === 'L');
    this.dnR = unitsWhere(graph, (t, s) => DNG02.test(t) && s === 'R');
    const g = (re, side) => unitsWhere(graph, (t, s) => re.test(t) && (side === undefined || s === side));
    this.lc = { L: g(LOOMING, 'L'), R: g(LOOMING, 'R'), az: new Float32Array(graph.n).fill(NaN), el: new Float32Array(graph.n).fill(NaN) };
    {
      // receptive-field centre = synapse-weighted mean direction of columnar presynaptic partners
      const isLC = new Uint8Array(graph.n);
      for (const i of this.lc.L) isLC[i] = 1;
      for (const i of this.lc.R) isLC[i] = 1;
      const sx = new Float32Array(graph.n), sy = new Float32Array(graph.n), sz = new Float32Array(graph.n);
      const cols = graph.columns;
      for (let e = 0; e < graph.m; e++) {
        const b = graph.post[e];
        if (!isLC[b]) continue;
        const c = graph.col[graph.pre[e]];
        if (c < 0) continue;
        const w = graph.weight[e], a = cols.az[c], el = cols.el[c];
        sx[b] += w * Math.sin(a) * Math.cos(el);
        sy[b] += w * Math.sin(el);
        sz[b] += w * Math.cos(a) * Math.cos(el);
      }
      for (let i = 0; i < graph.n; i++) {
        if (!isLC[i] || (sx[i] === 0 && sy[i] === 0 && sz[i] === 0)) continue;
        this.lc.az[i] = Math.atan2(sx[i], sz[i]);
        this.lc.el[i] = Math.atan2(sy[i], Math.hypot(sx[i], sz[i]));
      }
    }
    this.groups = {
      L1: g(/^L1$/), Mi1: g(/^Mi1$/), Mi4: g(/^Mi4$/), Mi9: g(/^Mi9$/),
      T4a: g(/^T4a$/), T4b: g(/^T4b$/), T4c: g(/^T4c$/), T4d: g(/^T4d$/), T5a: g(/^T5a$/), T5b: g(/^T5b$/),
      LPi: g(/^LPi/), HS: g(/^HS[ENS]$/), HSL: this.hsL, HSR: this.hsR, VS: g(/^VS/),
      T4aL: g(/^T4a$/, 'L'), T4aR: g(/^T4a$/, 'R'), T4bL: g(/^T4b$/, 'L'), T4bR: g(/^T4b$/, 'R'),
      T5aL: g(/^T5a$/, 'L'), T5aR: g(/^T5a$/, 'R'), T5bL: g(/^T5b$/, 'L'), T5bR: g(/^T5b$/, 'R'),
      LC4L: g(/^LC4$/, 'L'), LC4R: g(/^LC4$/, 'R'), LPLC2L: g(/^LPLC2$/, 'L'), LPLC2R: g(/^LPLC2$/, 'R'),
      DNp: g(/^DNp0[1-6]$/), DNg02: g(DNG02), DNg02L: this.dnL, DNg02R: this.dnR,
      MN: unitsWhere(graph, (_t, _s, r) => r === 'output'),
    };
    // homeostat: pooling cells whose type is not fitted (none with the fitted file)
    const homeo = [], targets = [];
    for (let i = 0; i < graph.n; i++) {
      const t = typeName(graph, i);
      const coveredType = fitted && hasType(fv, t);
      if ((isPooling(graph, i) && !coveredType) || (graph.role[i] === 5 && !fitted && restV(fv, t) !== undefined)) {
        homeo.push(i);
        targets.push(restV(fv, t) ?? p.restTarget);
      }
    }
    this.homeoUnits = Int32Array.from(homeo);
    this.homeoTargets = Float32Array.from(targets);
    this.homeostatDone = false;
    this.name = `optic-v2 [cpu]: ${graph.n} units, ${graph.m} edges, ${graph.columns.count} columns; ${fitted ? 'fitted' : 'flyvis'} params on ${this.coverage.types} types / ${this.coverage.edges} edges (${this.lamL.idx.length + this.lamR.idx.length} lamina inputs)`;
    this.topBuf = new Float64Array(0);
    this.reset();
  }

  /** Back to the settled state; the caller then warms up in the scene before readouts count. */
  reset() {
    this.net.reset();
    this.net.bias.set(this.bias0);
    this.pr.L.reset();
    this.pr.R.reset();
    this.calibrated = false;
    this.warm = 0;
    this.offsetL = this.offsetR = 0;
    this.loomRest = { L: 0, R: 0 };
    this.sideGain = { L: 1, R: 1 };
    this.simTime = 0;
    this.injectTonic();
  }

  /** Settle the network under uniform grey (once per load; the homeostat if any units need it). */
  settle(seconds = 0.5) {
    const dt = this.params.netDt;
    this.injectTonic();
    if (!this.homeostatDone && this.homeoUnits.length) {
      const info = this.net.homeostat(this.homeoUnits, this.homeoTargets, this.params.restRounds, 0.25, 0.25, dt);
      this.homeoErr = info.meanErr;
      this.homeoBias = info.biasMean;
      this.bias0 = this.net.bias.slice();
      this.homeostatDone = true;
    } else for (let k = 0, n = Math.round(seconds / dt); k < n; k++) this.net.step(dt);
  }

  injectTonic() {
    const p = this.params, ext = this.net.ext, pr = this.fv.photoreceptor;
    ext.fill(0);
    const rRest = Math.max(0, pr.restOffset + pr.stimGain * 0.5 * p.stimGain);
    const { lamL, lamR } = this;
    for (let k = 0; k < lamL.idx.length; k++) ext[lamL.idx[k]] = lamL.w[k] * rRest;
    for (let k = 0; k < lamR.idx.length; k++) ext[lamR.idx[k]] = lamR.w[k] * rRest;
    for (let k = 0; k < this.lptc.length; k++) ext[this.lptc[k]] = p.lptcBias;
    for (let k = 0; k < this.dnL.length; k++) ext[this.dnL[k]] = p.dnBias;
    for (let k = 0; k < this.dnR.length; k++) ext[this.dnR[k]] = p.dnBias;
  }

  injectEye(lum, pr, lam, dt) {
    const r = pr.step(lum, dt), ext = this.net.ext;
    for (let k = 0; k < pr.count; k++) for (let j = lam.ptr[k]; j < lam.ptr[k + 1]; j++) ext[lam.idx[j]] = lam.w[j] * r[k];
  }

  /** One substep of dt seconds with this frame's luminance (per ommatidium, both eyes). */
  step(lumL, lumR, dt) {
    const p = this.params;
    this.injectTonic();
    this.injectEye(lumL, this.pr.L, this.lamL, dt);
    this.injectEye(lumR, this.pr.R, this.lamR, dt);
    this.net.step(dt);
    this.simTime += dt;
    if (!this.calibrated) {
      this.warm += dt;
      if (this.warm >= p.warmSeconds) {
        const s = this.readoutSides();
        this.offsetL = s.L;
        this.offsetR = s.R;
        this.loomRest = { L: this.topkRate(this.lc.L), R: this.topkRate(this.lc.R) };
        this.calibrated = true;
      }
    }
  }

  topkRate(idx) {
    const k = Math.min(this.params.loomTopK, idx.length);
    if (!k) return 0;
    const top = this.topBuf.length === k ? this.topBuf : (this.topBuf = new Float64Array(k));
    top.fill(-Infinity);
    const r = this.net.r;
    for (let j = 0; j < idx.length; j++) {
      const v = r[idx[j]];
      if (v <= top[k - 1]) continue;
      let q = k - 1;
      while (q > 0 && top[q - 1] < v) { top[q] = top[q - 1]; q--; }
      top[q] = v;
    }
    let s = 0;
    for (let j = 0; j < k; j++) s += top[j];
    return s / k;
  }

  readoutSides() {
    return { L: this.net.meanRate(this.hsL), R: this.net.meanRate(this.hsR) };
  }

  /** The signals their motor stage consumed: relative HS deviation per side, looming per eye. */
  readouts() {
    const p = this.params, n = this.net, s = this.readoutSides();
    const dL = this.calibrated ? (this.sideGain.L * (s.L - this.offsetL)) / (this.offsetL + p.readoutFloor) : 0;
    const dR = this.calibrated ? (this.sideGain.R * (s.R - this.offsetR)) / (this.offsetR + p.readoutFloor) : 0;
    const loomL = Math.max(0, this.topkRate(this.lc.L) - this.loomRest.L - p.loomThreshold);
    const loomR = Math.max(0, this.topkRate(this.lc.R) - this.loomRest.R - p.loomThreshold);
    const g = this.groups;
    return {
      calibrated: this.calibrated, simTime: this.simTime,
      hsL: s.L, hsR: s.R, offsetL: this.offsetL, offsetR: this.offsetR, dL, dR, turn: dL - dR,
      loomL, loomR, lc4L: n.meanRate(g.LC4L), lc4R: n.meanRate(g.LC4R), lplc2L: n.meanRate(g.LPLC2L), lplc2R: n.meanRate(g.LPLC2R),
      dng02L: n.meanRate(this.dnL), dng02R: n.meanRate(this.dnR), dnp: n.meanRate(g.DNp),
      T4aL: n.meanRate(g.T4aL), T4bL: n.meanRate(g.T4bL), T4aR: n.meanRate(g.T4aR), T4bR: n.meanRate(g.T4bR),
      T5aL: n.meanRate(g.T5aL), T5bL: n.meanRate(g.T5bL), T5aR: n.meanRate(g.T5aR), T5bR: n.meanRate(g.T5bR),
      L1: n.meanRate(g.L1), Mi1: n.meanRate(g.Mi1), LPi: n.meanRate(g.LPi),
    };
  }

  /** Per-ommatidium T4a − T4b (front-to-back minus back-to-front). */
  directionMap(side, out) {
    const a = this.t4aByOmm[side], b = this.t4bByOmm[side];
    for (let k = 0; k < out.length; k++) out[k] = this.net.meanRate(a[k]) - this.net.meanRate(b[k]);
    return out;
  }

  label(i) {
    return `${typeName(this.graph, i)}_${sideName(this.graph, i)}`;
  }
}
