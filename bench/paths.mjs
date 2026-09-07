#!/usr/bin/env node
// What can HS do to DNg02 inside Xenova's graph? Outgoing synapses of the six HS cells by target
// type, the strongest relays, and each relay's synapses onto DNg02 L/R; plus DNg02's input by
// presynaptic type (who provides the flight-state drive in the real wiring).
import { loadXenovaGraph } from './lib/graph.mjs';
const g = loadXenovaGraph();
const n = g.n, { offsets, sources, counts, neurons } = g;
// outgoing CSR
const outOff = new Uint32Array(n + 1); for (let e = 0; e < sources.length; e++) outOff[sources[e] + 1]++;
for (let i = 0; i < n; i++) outOff[i + 1] += outOff[i];
const cur = outOff.slice(0, n), outT = new Uint32Array(sources.length), outC = new Uint32Array(sources.length);
for (let j = 0; j < n; j++) for (let e = offsets[j]; e < offsets[j + 1]; e++) { const k = cur[sources[e]]++; outT[k] = j; outC[k] = counts[e]; }
const T = (i) => neurons[i][1], S = (i) => neurons[i][3], SG = (i) => g.sign[i];
const idx = (pred) => { const o = []; for (let i = 0; i < n; i++) if (pred(T(i), S(i))) o.push(i); return o; };
const hs = idx((t) => /^HS[ENS]$/.test(t)), dng = { L: idx((t, s) => /^DNg02/.test(t) && s === 'L'), R: idx((t, s) => /^DNg02/.test(t) && s === 'R') };
const dngSet = new Set([...dng.L, ...dng.R]);
const sum = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
console.log('== HS cells and their strongest outgoing targets (synapses, sign of HS = ' + SG(hs[0]) + ')');
for (const h of hs) {
  const byT = new Map(); let total = 0;
  for (let e = outOff[h]; e < outOff[h + 1]; e++) { sum(byT, `${T(outT[e])}_${S(outT[e])}`, outC[e]); total += outC[e]; }
  const top = [...byT].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`  ${T(h)}_${S(h)} (${neurons[h][0]}): ${total} syn to ${byT.size} targets; ${top}`);
}
console.log('\n== two-hop HS -> relay -> DNg02: relays ranked by min(HS->relay, relay->DNg02) synapses');
const relay = new Map();
for (const h of hs) for (let e = outOff[h]; e < outOff[h + 1]; e++) {
  const r = outT[e];
  for (let f = outOff[r]; f < outOff[r + 1]; f++) if (dngSet.has(outT[f])) {
    const key = `${T(h)}_${S(h)} -> ${T(r)}_${S(r)}(${SG(r) > 0 ? '+' : SG(r) < 0 ? '-' : '0'}) -> DNg02_${S(outT[f])}`;
    const cur = relay.get(key) || { a: 0, b: 0 }; cur.a += outC[e]; cur.b += outC[f]; relay.set(key, cur);
  }
}
for (const [k, v] of [...relay].sort((x, y) => Math.min(y[1].a, y[1].b) - Math.min(x[1].a, x[1].b)).slice(0, 16)) console.log(`  ${k}: ${v.a} / ${v.b}`);
console.log('\n== direct HS -> DNg02 synapses:', [...hs].reduce((s, h) => { let c = 0; for (let e = outOff[h]; e < outOff[h + 1]; e++) if (dngSet.has(outT[e])) c += outC[e]; return s + c; }, 0));
for (const side of ['L', 'R']) {
  const byT = new Map(); let total = 0;
  for (const d of dng[side]) for (let e = offsets[d]; e < offsets[d + 1]; e++) { const p = sources[e]; sum(byT, `${T(p) || 'untyped'}_${S(p)}${SG(p) > 0 ? '+' : SG(p) < 0 ? '-' : '0'}`, counts[e]); total += counts[e]; }
  console.log(`\n== DNg02_${side} (${dng[side].length} cells) input: ${total} synapses; top presynaptic types:`);
  console.log('  ' + [...byT].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k}:${v}`).join('  '));
}
