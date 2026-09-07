/**
 * The optic-v2 rate model on WebGPU (HANDOFF step 3), a port of AbijahKaj's gpu-net.ts on the
 * same GPUDevice that runs Xenova's LIF. Same equation as rate-net.js:
 *
 *   tau_i dx_i/dt = -x_i + wScale * sum_j W_ij r_j + ext_i + bias_i,   r_i = clamp(x_i, 0, rMax)
 *
 * Two compute passes per Euler step over the post-unit CSR: `drive` (one thread per chunk of
 * <= CHUNK in-edges, partial sums, so pooling cells with tens of thousands of inputs do not stall a
 * workgroup) and `integrate` (one thread per unit). `step()` uploads ext and bias and submits
 * without waiting; `flush()` copies r to a staging buffer; `sync()` maps it. In the loop worker
 * the LIF batch's own readback sits between flush() and sync(), so the rate net costs no extra
 * fence per frame: the price is that the bridge uses the previous frame's rates (one frame,
 * 16.7 ms, of extra visual latency). Settling and the homeostat stay on the CPU RateNet; use
 * fromCPU() once they are done.
 */
const CHUNK = 64, WG = 256;
const PARAMS = 'struct Params { n: u32, nChunks: u32, dt: f32, wScale: f32, rMax: f32, pad0: f32, pad1: f32, pad2: f32 }';
const WGSL_DRIVE = `
${PARAMS}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> chunkUnit: array<u32>;
@group(0) @binding(2) var<storage, read> unitChunkPtr: array<u32>;
@group(0) @binding(3) var<storage, read> indptr: array<u32>;
@group(0) @binding(4) var<storage, read> idx: array<u32>;
@group(0) @binding(5) var<storage, read> wt: array<f32>;
@group(0) @binding(6) var<storage, read> rIn: array<f32>;
@group(0) @binding(7) var<storage, read_write> partial: array<f32>;
@compute @workgroup_size(${WG})
fn drive(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= P.nChunks) { return; }
  let u = chunkUnit[c];
  let k = c - unitChunkPtr[u];
  let start = indptr[u] + k * ${CHUNK}u;
  let end = min(start + ${CHUNK}u, indptr[u + 1u]);
  var s = 0.0;
  for (var e = start; e < end; e++) { s += wt[e] * rIn[idx[e]]; }
  partial[c] = s;
}`;
const WGSL_INTEGRATE = `
${PARAMS}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> unitChunkPtr: array<u32>;
@group(0) @binding(2) var<storage, read> partial: array<f32>;
@group(0) @binding(3) var<storage, read_write> x: array<f32>;
@group(0) @binding(4) var<storage, read_write> r: array<f32>;
@group(0) @binding(5) var<storage, read> ext: array<f32>;
@group(0) @binding(6) var<storage, read> bias: array<f32>;
@group(0) @binding(7) var<storage, read> tau: array<f32>;
@compute @workgroup_size(${WG})
fn integrate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  var d = 0.0;
  for (var c = unitChunkPtr[i]; c < unitChunkPtr[i + 1u]; c++) { d += partial[c]; }
  let tgt = P.wScale * d + ext[i] + bias[i];
  let a = min(1.0, P.dt / tau[i]);
  let xi = x[i] + a * (tgt - x[i]);
  x[i] = xi;
  r[i] = clamp(xi, 0.0, P.rMax);
}`;

export class RateNetGPU {
  /** Build asynchronously so shader compilation errors surface with their message (WGSL line, reason). */
  static async create(device, csr, tau, params = {}) {
    device.pushErrorScope('validation');
    const net = new RateNetGPU(device, csr, tau, params, true);
    for (const [name, mod] of [['drive', net.driveModule], ['integrate', net.integModule]]) {
      const info = await mod.getCompilationInfo();
      const bad = info.messages.filter((m) => m.type === 'error');
      if (bad.length) throw Error(`optic-v2 ${name} kernel failed to compile: ` + bad.map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`).join(' | '));
    }
    net.finishPipelines();
    const err = await device.popErrorScope();
    if (err) throw Error('optic-v2 GPU rate net: ' + err.message);
    return net;
  }
  constructor(device, csr, tau, { wScale = 1, rMax = 5 } = {}, deferPipelines = false) {
    this.device = device;
    this.csr = csr;
    this.n = csr.n;
    this.tau = tau;
    this.params = { wScale, rMax };
    this.x = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.ext = new Float32Array(this.n);
    this.bias = new Float32Array(this.n);
    // chunk tables
    const { indptr } = csr;
    const unitChunkPtr = new Uint32Array(this.n + 1);
    for (let u = 0; u < this.n; u++) unitChunkPtr[u + 1] = unitChunkPtr[u] + Math.ceil((indptr[u + 1] - indptr[u]) / CHUNK);
    this.nChunks = unitChunkPtr[this.n];
    const chunkUnit = new Uint32Array(Math.max(1, this.nChunks));
    for (let u = 0; u < this.n; u++) for (let c = unitChunkPtr[u]; c < unitChunkPtr[u + 1]; c++) chunkUnit[c] = u;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mk = (data, usage = S) => {
      const b = device.createBuffer({ size: Math.max(4, data.byteLength), usage });
      device.queue.writeBuffer(b, 0, data);
      return b;
    };
    this.buf = {
      uniform: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      chunkUnit: mk(chunkUnit), unitChunkPtr: mk(unitChunkPtr), indptr: mk(indptr), idx: mk(csr.pre), wt: mk(csr.w),
      partial: device.createBuffer({ size: Math.max(4, this.nChunks * 4), usage: GPUBufferUsage.STORAGE }),
      x: mk(this.x), r: mk(this.r, S | GPUBufferUsage.COPY_SRC), ext: mk(this.ext), bias: mk(this.bias), tau: mk(tau),
      staging: device.createBuffer({ size: this.n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    };
    const entry = (i, type) => ({ binding: i, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    const driveLayout = device.createBindGroupLayout({ entries: [entry(0, 'uniform'), entry(1, 'read-only-storage'), entry(2, 'read-only-storage'), entry(3, 'read-only-storage'), entry(4, 'read-only-storage'), entry(5, 'read-only-storage'), entry(6, 'read-only-storage'), entry(7, 'storage')] });
    const integLayout = device.createBindGroupLayout({ entries: [entry(0, 'uniform'), entry(1, 'read-only-storage'), entry(2, 'read-only-storage'), entry(3, 'storage'), entry(4, 'storage'), entry(5, 'read-only-storage'), entry(6, 'read-only-storage'), entry(7, 'read-only-storage')] });
    this.driveModule = device.createShaderModule({ label: 'optic-v2 drive', code: WGSL_DRIVE });
    this.integModule = device.createShaderModule({ label: 'optic-v2 integrate', code: WGSL_INTEGRATE });
    this.layouts = { driveLayout, integLayout };
    const b = this.buf, bind = (layout, list) => device.createBindGroup({ layout, entries: list.map((buffer, i) => ({ binding: i, resource: { buffer } })) });
    this.driveBind = bind(driveLayout, [b.uniform, b.chunkUnit, b.unitChunkPtr, b.indptr, b.idx, b.wt, b.r, b.partial]);
    this.integBind = bind(integLayout, [b.uniform, b.unitChunkPtr, b.partial, b.x, b.r, b.ext, b.bias, b.tau]);
    if (!deferPipelines) this.finishPipelines();
    this.uniformData = new ArrayBuffer(32);
    this.pendingSteps = 0;
    this.kind = 'gpu';
  }
  finishPipelines() {
    const device = this.device, { driveLayout, integLayout } = this.layouts;
    this.drivePipe = device.createComputePipeline({ label: 'optic-v2 drive', layout: device.createPipelineLayout({ bindGroupLayouts: [driveLayout] }), compute: { module: this.driveModule, entryPoint: 'drive' } });
    this.integPipe = device.createComputePipeline({ label: 'optic-v2 integrate', layout: device.createPipelineLayout({ bindGroupLayouts: [integLayout] }), compute: { module: this.integModule, entryPoint: 'integrate' } });
  }
  /** Take over from a settled CPU RateNet: same CSR, tau and params, its x, r, ext and bias. */
  static async fromCPU(device, net) {
    const g = await RateNetGPU.create(device, net.csr, net.tau, net.params);
    g.x.set(net.x); g.r.set(net.r); g.ext.set(net.ext); g.bias.set(net.bias);
    g.uploadState();
    return g;
  }
  uploadState() {
    const q = this.device.queue, b = this.buf;
    q.writeBuffer(b.x, 0, this.x); q.writeBuffer(b.r, 0, this.r); q.writeBuffer(b.ext, 0, this.ext); q.writeBuffer(b.bias, 0, this.bias);
  }
  reset() {
    this.x.fill(0); this.r.fill(0); this.ext.fill(0);
    this.uploadState();
  }
  /** One Euler step of dt seconds: uploads ext and bias, submits both passes, does not wait. */
  step(dt) {
    const dev = this.device, b = this.buf, v = new DataView(this.uniformData);
    v.setUint32(0, this.n, true); v.setUint32(4, this.nChunks, true); v.setFloat32(8, dt, true); v.setFloat32(12, this.params.wScale, true); v.setFloat32(16, this.params.rMax, true);
    dev.queue.writeBuffer(b.uniform, 0, this.uniformData);
    dev.queue.writeBuffer(b.ext, 0, this.ext);
    dev.queue.writeBuffer(b.bias, 0, this.bias);
    const enc = dev.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(this.drivePipe); pass.setBindGroup(0, this.driveBind); pass.dispatchWorkgroups(Math.ceil(Math.max(1, this.nChunks) / WG));
    pass.setPipeline(this.integPipe); pass.setBindGroup(0, this.integBind); pass.dispatchWorkgroups(Math.ceil(this.n / WG));
    pass.end();
    dev.queue.submit([enc.finish()]);
    this.pendingSteps++;
  }
  /** Queue a copy of r into the staging buffer (after the frame's substeps). */
  flush() {
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.buf.r, 0, this.buf.staging, 0, this.n * 4);
    this.device.queue.submit([enc.finish()]);
    this.flushed = true;
  }
  /** Map the staging buffer into the host copy of r. Cheap when other GPU work has already been awaited. */
  async sync() {
    if (!this.flushed) this.flush();
    await this.buf.staging.mapAsync(GPUMapMode.READ);
    try { this.r.set(new Float32Array(this.buf.staging.getMappedRange())); } finally { this.buf.staging.unmap(); }
    this.flushed = false;
    this.pendingSteps = 0;
  }
  meanRate(idx) {
    if (!idx.length) return 0;
    let s = 0;
    for (let k = 0; k < idx.length; k++) s += this.r[idx[k]];
    return s / idx.length;
  }
  homeostat() { throw Error('homeostat runs on the CPU RateNet before fromCPU()'); }
  destroy() { for (const b of Object.values(this.buf)) b.destroy(); }
}
