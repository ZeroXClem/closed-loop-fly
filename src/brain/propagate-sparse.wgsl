// Copy of vendor/fruit-fly-simulation/src/propagate-sparse.wgsl plus the `kick` binding.
// Outgoing CSR: four spiking sources per workgroup, 32 lanes per source.
// Integer atomics make accumulation independent of edge processing order.
struct Params {
  n: u32, tick: u32, edges: u32, silent: u32,
  seed: u32, em: f32, es: f32, coupling: f32,
  adaptInc: f32, adaptDecay: f32
}
struct State { v: f32, g: f32, until: u32, padding: u32 }
struct Queue { sizes: array<atomic<u32>, 19>, ids: array<u32> }

@group(0) @binding(0) var<storage, read> graph: array<u32>;
@group(0) @binding(1) var<storage, read> synapses: array<u32>;
@group(0) @binding(2) var<storage, read_write> states: array<State>;
@group(0) @binding(3) var<storage, read_write> history: Queue;
@group(0) @binding(4) var<storage, read> rates: array<f32>;
@group(0) @binding(5) var<storage, read_write> counts: array<f32>;
@group(0) @binding(6) var<storage, read_write> currents: array<atomic<i32>>;
@group(0) @binding(7) var<uniform> p: Params;
// closed-loop-fly: injected current, mV per tick, dt already applied (src/brain/inject.js).
@group(0) @binding(8) var<storage, read> kick: array<f32>;
// Only advance binds this buffer as storage. Propagate uses it as INDIRECT.
@group(1) @binding(0) var<storage, read_write> indirect: array<atomic<u32>>;

fn randomWord(i: u32, t: u32) -> u32 {
  var x = ((i + 1u) * 747796405u) ^ ((t + 1u) * 2891336453u) ^ p.seed;
  x = (x ^ (x >> 16u)) * 2246822519u;
  x = (x ^ (x >> 13u)) * 3266489917u;
  return x ^ (x >> 16u);
}

@compute @workgroup_size(128)
fn propagate(
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>
) {
  let due = (p.tick + 1u) % 19u;
  let source = group.x * 4u + local.x / 32u;
  if (source >= atomicLoad(&history.sizes[due])) { return; }

  let i = history.ids[due * p.n + source];
  let sign = bitcast<i32>(graph[p.n + 1u + i]);
  for (var e = graph[i] + local.x % 32u; e < graph[i + 1u]; e += 32u) {
    let destinationNeuron = graph[2u * p.n + 1u + e];
    if (p.tick >= states[destinationNeuron].until) {
      atomicAdd(&currents[destinationNeuron], i32(synapses[e]) * sign);
    }
  }
}

@compute @workgroup_size(128)
fn advance(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= p.n) { return; }

  // Clear the consumed slot before the next tick, without racing current appends.
  if (i == 0u) {
    let next = (p.tick + 1u) % 19u;
    atomicStore(&history.sizes[next], 0u);
    atomicStore(&indirect[next * 3u], 0u);
  }

  var s = states[i];
  let canIntegrate = p.tick >= s.until;
  // closed-loop-fly: activity-dependent threshold shift lives in the padding word (0 = off).
  var a = bitcast<f32>(s.padding);
  if (canIntegrate) {
    s.v = -52.0 + (s.v + 52.0) * p.em + s.g * p.coupling;
    s.g *= p.es;
    a *= p.adaptDecay;
  }

  // Sample the threshold before this tick’s synaptic and external events.
  let fired = canIntegrate && s.v > -45.0 + a;
  let current = atomicExchange(&currents[i], 0);
  if (canIntegrate) {
    s.g += f32(current) * .275;
    if (f32(randomWord(i, p.tick)) / 4294967296.0 < rates[i] * .0001) {
      s.v += 68.75;
    }
    // closed-loop-fly: same order as BrainCPU.advance (after the Poisson kick, before reset).
    s.v += kick[i];
  }

  if (fired) {
    s.v = -52.0;
    s.g = 0.0;
    s.until = p.tick + select(22u, 0u, rates[i] > 0.0);
    a += p.adaptInc;
    counts[i] += 1.0;

    // Silence suppresses delivery, not recording: later ticks may receive these
    // spikes. Cells with no outgoing transmission still retain visible counts.
    if (bitcast<i32>(graph[p.n + 1u + i]) != 0 && graph[i] < graph[i + 1u]) {
      let slot = p.tick % 19u;
      let position = atomicAdd(&history.sizes[slot], 1u);
      history.ids[slot * p.n + position] = i;
      atomicMax(&indirect[slot * 3u], (position + 4u) / 4u);
    }
  }
  s.padding = bitcast<u32>(a);
  states[i] = s;
}
