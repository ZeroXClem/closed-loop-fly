// Copy of vendor/fruit-fly-simulation/src/brain-gpu.js with the `kick` (injected current) buffer.
import propagationShader from './propagate-sparse.wgsl?raw';
import { assetURL } from '../../vendor/fruit-fly-simulation/src/data-loader.js';
import { outgoingGraph, PARAMETERS } from './brain.js';
import { getKernel, disposeSharedKernelRuntime } from '@huggingface/kernels';
import { compactReadout, CHANNELS } from '../../vendor/fruit-fly-simulation/src/stimulus.js';

const MAX_STEPS = 200;
const SUBMISSION_STEPS = 20;
const UNIFORM_STRIDE = 256;
const EM = Math.exp(-PARAMETERS.dt / PARAMETERS.tauM);
const ES = Math.exp(-PARAMETERS.dt / PARAMETERS.tauS);
const COUPLING = (PARAMETERS.tauS / (PARAMETERS.tauM - PARAMETERS.tauS)) * (EM - ES);

/** Resident, spike-driven WGSL backend on the kernel runtime's GPUDevice. */
export class BrainGPU {
  static async create(graph) {
    const brain = new BrainGPU();
    try {
      await brain.init(graph);
      return brain;
    } catch (error) {
      brain.destroy();
      throw error;
    }
  }

  buffer(size, usage, data) {
    const buffer = this.device.createBuffer({ size: Math.max(4, size), usage });
    this.buffers.push(buffer);
    if (data) this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  async init(graph) {
    if (!navigator.gpu) throw Error('WebGPU is unavailable');
    const identity = await getKernel(assetURL('kernels/ai.onnx.Identity'), {
      revision: '88a09b2fc38107f00e33af195ca4507df772967e',
      expectedOpId: 'ai.onnx.Identity',
      trustRemoteCode: true,
    });
    const { y: seed } = await identity(
      { x: { data: new Float32Array(1), shape: [1] } },
      { output: 'gpu' },
    );
    this.runtime = seed.runtime;
    this.device = this.runtime?.host?.device;
    if (
      !this.device ||
      typeof this.runtime.empty !== 'function' ||
      typeof this.runtime.readTensor !== 'function'
    ) {
      seed.destroy();
      throw Error('Unsupported pinned kernel runtime interface');
    }
    seed.destroy();
    this.n = graph.n;
    this.edges = graph.sources.length;
    this.tick = 0;
    const bytes = (2 * this.n + 1 + this.edges) * 4;
    if (
      bytes > this.device.limits.maxStorageBufferBindingSize ||
      this.edges * 4 > this.device.limits.maxStorageBufferBindingSize
    )
      throw Error('The adapter cannot hold the complete graph');
    let sum = 0;
    for (const count of graph.counts) sum += count;
    if (sum > 2147483647) throw Error('Graph exceeds signed synapse accumulator capacity');
    const device = this.device;
    this.buffers = [];
    this.loss = { message: null };
    const loss = this.loss;
    this.onError = (event) => {
      loss.message = event.error.message;
    };
    device.addEventListener('uncapturederror', this.onError);
    device.lost.then((info) => {
      loss.message = info.message || 'GPU device lost';
    });
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const outgoing = outgoingGraph(graph);
    this.graph = this.buffer(bytes, storage);
    device.queue.writeBuffer(this.graph, 0, outgoing.offsets);
    device.queue.writeBuffer(this.graph, (this.n + 1) * 4, graph.sign);
    device.queue.writeBuffer(this.graph, (2 * this.n + 1) * 4, outgoing.targets);
    this.edgeCounts = this.buffer(this.edges * 4, storage, outgoing.counts);
    this.state = this.buffer(this.n * 16, storage | GPUBufferUsage.COPY_SRC);
    // N entries per slot covers even a simultaneous spike from every neuron.
    this.history = this.buffer((19 + this.n * 19) * 4, storage);
    this.indirect = this.buffer(19 * 12, storage | GPUBufferUsage.INDIRECT);
    this.rates = this.buffer(this.n * 4, storage);
    // closed-loop-fly: injected current (binding 8), rewritten every batch.
    this.kick = this.buffer(this.n * 4, storage);
    this.zeroKick = new Float32Array(this.n);
    this.countTensor = this.runtime.empty('float32', [this.n, 1]);
    this.counts = this.countTensor.buffer;
    this.currents = this.buffer(this.n * 4, storage);
    this.read = this.buffer(
      (this.n + CHANNELS.length) * 4,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    );
    this.uniform = this.buffer(
      UNIFORM_STRIDE * MAX_STEPS,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.uniformData = new ArrayBuffer(UNIFORM_STRIDE * MAX_STEPS);
    this.uniformView = new DataView(this.uniformData);
    const module = device.createShaderModule({ code: propagationShader });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((message) => message.type === 'error');
    if (errors.length) throw Error(errors.map((message) => message.message).join('\n'));
    const layout = device.createBindGroupLayout({
      entries: Array.from({ length: 9 }, (_, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer:
          binding === 7
            ? { type: 'uniform', hasDynamicOffset: true, minBindingSize: 40 }
            : { type: [0, 1, 4, 8].includes(binding) ? 'read-only-storage' : 'storage' },
      })),
    });
    const indirectLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }],
    });
    const pipelineLayouts = [
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      device.createPipelineLayout({ bindGroupLayouts: [layout, indirectLayout] }),
    ];
    this.pipelines = await Promise.all(
      ['propagate', 'advance'].map((entryPoint, i) =>
        device.createComputePipelineAsync({
          layout: pipelineLayouts[i],
          compute: { module, entryPoint },
        }),
      ),
    );
    const bindings = [
      this.graph,
      this.edgeCounts,
      this.state,
      this.history,
      this.rates,
      this.counts,
      this.currents,
      this.uniform,
      this.kick,
    ];
    this.bind = device.createBindGroup({
      layout,
      entries: bindings.map((buffer, binding) => ({
        binding,
        resource: { buffer, ...(binding === 7 ? { size: 40 } : {}) }, // Params is 40 bytes with the two adaptation floats
      })),
    });
    this.indirectBind = device.createBindGroup({
      layout: indirectLayout,
      entries: [{ binding: 0, resource: { buffer: this.indirect } }],
    });
    await this.reset();
  }

  async reset() {
    this.tick = 0;
    const state = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n; i++) state[i * 4] = PARAMETERS.rest;
    this.device.queue.writeBuffer(this.state, 0, state);
    this.device.queue.writeBuffer(
      this.indirect,
      0,
      Uint32Array.from({ length: 19 * 3 }, (_, i) => (i % 3 === 0 ? 0 : 1)),
    );
    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.history);
    encoder.clearBuffer(this.counts);
    encoder.clearBuffer(this.currents);
    this.device.queue.submit([encoder.finish()]);
  }

  /** Activity-dependent threshold shift (mV per spike, decay time constant in ms); 0 = off. Same meaning as BrainCPU.setAdaptation. */
  setAdaptation(inc, tauMs = 300) {
    this.adapt = { inc: +inc || 0, decay: tauMs > 0 ? Math.exp(-PARAMETERS.dt / tauMs) : 0 };
  }
  async batch(steps, rates, silenced = false, kick = null) {
    if (this.loss.message) throw Error(this.loss.message);
    if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS)
      throw Error('GPU batch requires 1–200 integer steps');
    if (rates.length !== this.n) throw Error('Stimulus size must match neuron count');
    const device = this.device,
      view = this.uniformView;
    device.queue.writeBuffer(this.rates, 0, rates);
    if (kick && kick.length !== this.n) throw Error('Injected current size must match neuron count');
    device.queue.writeBuffer(this.kick, 0, kick ?? this.zeroKick);
    for (let k = 0; k < steps; k++) {
      const offset = k * UNIFORM_STRIDE;
      [this.n, this.tick + k, this.edges, +silenced, 1].forEach((value, i) =>
        view.setUint32(offset + i * 4, value, true),
      );
      [EM, ES, COUPLING].forEach((value, i) => view.setFloat32(offset + 20 + i * 4, value, true));
      view.setFloat32(offset + 32, this.adapt?.inc ?? 0, true);
      view.setFloat32(offset + 36, this.adapt?.decay ?? 1, true);
    }
    device.queue.writeBuffer(this.uniform, 0, this.uniformData, 0, UNIFORM_STRIDE * steps);
    for (let start = 0; start < steps; start += SUBMISSION_STEPS) {
      if (this.loss.message) throw Error(this.loss.message);
      const encoder = device.createCommandEncoder();
      if (start === 0) encoder.clearBuffer(this.counts);
      const pass = encoder.beginComputePass();
      for (let k = start; k < Math.min(start + SUBMISSION_STEPS, steps); k++) {
        // Propagation reads prior state. Separate dispatches order all workgroups
        // before integration, thresholding and reset.
        for (let phase = 0; phase < this.pipelines.length; phase++) {
          if (phase === 0 && (silenced || this.tick + k < PARAMETERS.delay)) continue;
          pass.setPipeline(this.pipelines[phase]);
          pass.setBindGroup(0, this.bind, [k * UNIFORM_STRIDE]);
          if (phase === 0) {
            // The propagation layout excludes group 1: the indirect buffer
            // cannot also be writable storage in this dispatch's usage scope.
            pass.dispatchWorkgroupsIndirect(this.indirect, ((this.tick + k + 1) % 19) * 12);
          } else {
            pass.setBindGroup(1, this.indirectBind);
            pass.dispatchWorkgroups(Math.ceil(this.n / 128));
          }
        }
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    // Motor rates and spike counts share one readback fence.
    if (this.matmul) {
      const gather = device.createCommandEncoder();
      this.motorIndices.forEach((id, i) =>
        gather.copyBufferToBuffer(this.counts, id * 4, this.motorInput.buffer, i * 4, 4),
      );
      device.queue.submit([gather.finish()]);
      await this.matmul(
        { a: this.weightTensor, b: this.motorInput },
        { outputs: { y: this.motorTensor }, output: 'gpu' },
      );
    }
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.counts, 0, this.read, 0, this.n * 4);
    if (this.matmul)
      encoder.copyBufferToBuffer(
        this.motorTensor.buffer,
        0,
        this.read,
        this.n * 4,
        CHANNELS.length * 4,
      );
    device.queue.submit([encoder.finish()]);
    await this.read.mapAsync(GPUMapMode.READ);
    let counts, ratesOut;
    try {
      const values = new Float32Array(this.read.getMappedRange());
      counts = values.slice(0, this.n);
      if (this.matmul)
        ratesOut = Float32Array.from(values.subarray(this.n), (x) => (x * 10000) / steps);
    } finally {
      this.read.unmap();
    }
    this.tick += steps;
    let total = 0;
    for (let i = 0; i < counts.length; i++) total += counts[i];
    return { counts, rates: ratesOut, tick: this.tick, total };
  }

  async snapshot() {
    if (this.loss.message) throw Error(this.loss.message);
    const device = this.device;
    const read = device.createBuffer({
      size: this.n * 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(this.state, 0, read, 0, this.n * 16);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const view = new DataView(read.getMappedRange()),
        v = [],
        g = [],
        until = [];
      for (let i = 0; i < this.n; i++) {
        v.push(view.getFloat32(i * 16, true));
        g.push(view.getFloat32(i * 16 + 4, true));
        until.push(view.getUint32(i * 16 + 8, true));
      }
      read.unmap();
      return { v, g, until, tick: this.tick };
    } finally {
      read.destroy();
    }
  }

  async prepareReadout(groups) {
    this.matmul = await getKernel(assetURL('kernels/ai.onnx.MatMul'), {
      revision: '16a3da1933ef99f9daf823f87569cd12b6429d66',
      expectedOpId: 'ai.onnx.MatMul',
      trustRemoteCode: true,
    });
    const { indices, width, weights } = compactReadout(groups);
    this.motorIndices = indices;
    this.weightTensor = this.runtime.tensorFromTypedArray(
      'float32',
      [CHANNELS.length, width],
      weights,
    );
    this.motorInput = this.runtime.tensorFromTypedArray(
      'float32',
      [width, 1],
      new Float32Array(width),
    );
    this.motorTensor = this.runtime.empty('float32', [CHANNELS.length, 1]);
  }
  destroy() {
    if (this.onError) this.device.removeEventListener('uncapturederror', this.onError);
    for (const tensor of [this.countTensor, this.weightTensor, this.motorInput, this.motorTensor])
      tensor?.destroy();
    for (const buffer of this.buffers ?? []) buffer.destroy();
    // The package owns this shared device; each instance only releases its allocations.
  }
  static async disposeRuntime() {
    await disposeSharedKernelRuntime();
  }
}
