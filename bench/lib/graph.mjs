// Xenova's MaleCNS graph, loaded the way src/data-loader.js + src/worker.js build it in the
// browser (incoming CSR, per-neuron sign with the monoamine fix), for Node benches.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const XENOVA_DATA = join(ROOT, 'vendor/fruit-fly-simulation/public/data');

export function loadXenovaGraph({ monoamines = true } = {}) {
  const manifest = JSON.parse(readFileSync(join(XENOVA_DATA, 'manifest.json'), 'utf8'));
  const neurons = JSON.parse(gunzipSync(readFileSync(join(XENOVA_DATA, manifest.metadata))).toString());
  const graph = { n: manifest.neurons, neurons, manifest, sign: Int32Array.from(neurons, (r) => r[5]) };
  if (monoamines)
    neurons.forEach((r, i) => {
      if (['dopamine', 'octopamine', 'serotonin'].includes(r[4])) graph.sign[i] = 1;
    });
  for (const array of manifest.arrays) {
    const values = new Uint32Array(array.length);
    let offset = 0;
    for (const part of array.parts) {
      const chunk = new Uint32Array(gunzipSync(readFileSync(join(XENOVA_DATA, part.file))).buffer);
      values.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== values.length) throw Error('Invalid data length for ' + array.name);
    graph[array.name] = values;
  }
  if (graph.offsets.length !== graph.n + 1 || graph.offsets[graph.n] !== graph.sources.length)
    throw Error('Invalid CSR structure');
  graph.bodyIndex = new Map(neurons.map((r, i) => [Number(r[0]), i]));
  return graph;
}
