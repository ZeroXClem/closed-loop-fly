/**
 * Fitted (or raw flyvis) parameters applied to the optic-v2 graph (port of vendor/fruit-fly-
 * brain-research/app/src/brain/flyvis.ts):
 *
 *   per type        tau, bias (resting drive), restV
 *   per type pair   synapse strength and sign  ->  w = count * sign * strength
 *   photoreceptor   tau, restOffset, stimGain, and the R -> L1/L2/L3 drive
 *
 * Types or pairs the file does not cover keep the graph's tau, the transmitter sign times a
 * default scale (0.001 onto pooling cells, 0.02 elsewhere), and get a homeostatic bias.
 */
import { typeName, roleName } from './graph.js';

const ALIAS = { TmY9a: 'TmY9', TmY9b: 'TmY9' };
export const fvName = (t) => ALIAS[t] ?? t;
const LPI = /^LPi/;

export const hasType = (fv, t) => fv.types[fvName(t)] !== undefined;
export const restV = (fv, t) => fv.types[fvName(t)]?.restV;
/** Units that pool thousands of optic-lobe synapses: lobula-plate cells, LPi, looming LCs (role "input"). */
export const isPooling = (g, i) => roleName(g, i) === 'input' || LPI.test(typeName(g, i));

export function applyParams(g, fv, defaultScale = 0.02, lptcScale = 0.001) {
  const n = g.n;
  const tau = new Float32Array(n);
  const bias = new Float32Array(n);
  const covered = new Uint8Array(n);
  const typeCovered = g.types.map((t) => fv.types[fvName(t.name)] !== undefined);
  for (let i = 0; i < n; i++) {
    const t = g.types[g.type[i]];
    const p = fv.types[fvName(t.name)];
    if (p) {
      tau[i] = p.tau;
      bias[i] = p.bias;
      covered[i] = 1;
    } else tau[i] = t.tau;
  }
  const pair = new Map();
  for (const p of fv.pairs) pair.set(`${p.pre} ${p.post}`, p);
  const w = new Float32Array(g.m);
  let nCoveredEdges = 0;
  for (let e = 0; e < g.m; e++) {
    const a = g.pre[e],
      b = g.post[e];
    const p = pair.get(`${fvName(typeName(g, a))} ${fvName(typeName(g, b))}`);
    if (p) {
      w[e] = g.weight[e] * p.sign * p.strength;
      nCoveredEdges++;
    } else {
      const scale = isPooling(g, b) ? lptcScale : defaultScale;
      w[e] = g.weight[e] * g.sign[a] * scale;
    }
  }
  return { tau, bias, w, covered, nCoveredTypes: typeCovered.filter(Boolean).length, nCoveredEdges };
}
