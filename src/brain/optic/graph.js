/**
 * AbijahKaj's optic-v2 graph format (port of vendor/fruit-fly-brain-research/app/src/brain/
 * graph.ts): a JSON header plus one .bin of typed arrays. Edge weights are raw synapse
 * counts; the sign comes from the presynaptic unit's predicted transmitter.
 */
export const ROLES = ['input', 'brain', 'dn', 'vnc', 'output', 'optic'];
export const SIDES = ['L', 'R', 'M'];
const CTOR = { int8: Int8Array, int16: Int16Array, int32: Int32Array, float32: Float32Array, float64: Float64Array };

function view(buf, d, dtype) {
  if (d.dtype !== dtype) throw Error(`array dtype ${d.dtype}, expected ${dtype}`);
  return new CTOR[dtype](buf, d.offset, d.length);
}

/** Header (parsed optic.json) + ArrayBuffer (optic.bin) -> Graph. */
export function fromV2(h, buf) {
  if (h.version !== 2) throw Error(`unsupported graph version ${h.version}`);
  const a = h.arrays;
  const A = (k) => {
    if (!a[k]) throw Error(`missing array ${k}`);
    return a[k];
  };
  const roleMap = h.roles.map((r) => ROLES.indexOf(r));
  const role = view(buf, A('units.role'), 'int8').slice();
  for (let i = 0; i < role.length; i++) role[i] = roleMap[role[i]];
  return {
    version: 2,
    source: h.source,
    n: h.units.count,
    m: h.edges.count,
    types: h.types,
    type: view(buf, A('units.type'), 'int32'),
    side: view(buf, A('units.side'), 'int8'),
    role,
    sign: view(buf, A('units.sign'), 'int8'),
    col: view(buf, A('units.col'), 'int32'),
    bodyId: view(buf, A('units.bodyId'), 'float64'),
    pre: view(buf, A('edges.pre'), 'int32'),
    post: view(buf, A('edges.post'), 'int32'),
    weight: view(buf, A('edges.weight'), 'float32'),
    columns: {
      count: h.columns.count,
      side: view(buf, A('columns.side'), 'int8'),
      h1: view(buf, A('columns.h1'), 'int16'),
      h2: view(buf, A('columns.h2'), 'int16'),
      az: view(buf, A('columns.az'), 'float32'),
      el: view(buf, A('columns.el'), 'float32'),
    },
    extract: h.extract,
  };
}

/** CSR by POST unit from per-edge weights that are already signed and scaled. */
export function buildCSRWeighted(n, m, epre, epost, ew) {
  const counts = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) counts[epost[e] + 1]++;
  for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
  const indptr = counts.slice();
  const fill = counts.slice(0, n);
  const pre = new Int32Array(m);
  const w = new Float32Array(m);
  for (let e = 0; e < m; e++) {
    const k = fill[epost[e]]++;
    pre[k] = epre[e];
    w[k] = ew[e];
  }
  return { n, indptr, pre, w };
}

export const typeName = (g, i) => g.types[g.type[i]].name;
export const sideName = (g, i) => SIDES[g.side[i]] ?? 'M';
export const roleName = (g, i) => ROLES[g.role[i]] ?? 'input';

/** Indices of units satisfying pred(typeName, side, role). */
export function unitsWhere(g, pred) {
  const out = [];
  for (let i = 0; i < g.n; i++) if (pred(typeName(g, i), sideName(g, i), roleName(g, i))) out.push(i);
  return Int32Array.from(out);
}

/** Fetch header + bin from URLs (browser or Node 18+). */
export async function loadGraph(jsonUrl, binUrl, onProgress) {
  const res = await fetch(jsonUrl);
  if (!res.ok) throw Error(`failed to load graph ${jsonUrl}: ${res.status}`);
  const h = await res.json();
  const bin = await fetch(binUrl);
  if (!bin.ok) throw Error(`failed to load graph ${binUrl}: ${bin.status}`);
  let buf;
  if (bin.body && onProgress) {
    const total = Number(bin.headers.get('content-length') ?? 0);
    const reader = bin.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    buf = out.buffer;
  } else buf = await bin.arrayBuffer();
  return fromV2(h, buf);
}
