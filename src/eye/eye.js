/**
 * Render what the fly sees and sample it at the ommatidia (port of vendor/fruit-fly-brain-
 * research/app/src/eye/eye.ts).
 *
 * Six 90-degree cameras are parented to the fly's head object and render into small
 * offscreen targets. Each ommatidium direction is mapped once to a (face, pixel) pair, so per
 * frame we read back six tiny buffers and gather. Luminance is Rec. 709 of the 8-bit readback.
 */
import * as THREE from 'three';

const FACES = [
  { dir: [0, 0, -1], up: [0, 1, 0] }, // front
  { dir: [0, 0, 1], up: [0, 1, 0] }, // back
  { dir: [-1, 0, 0], up: [0, 1, 0] }, // left
  { dir: [1, 0, 0], up: [0, 1, 0] }, // right
  { dir: [0, 1, 0], up: [0, 0, 1] }, // up
  { dir: [0, -1, 0], up: [0, 0, -1] }, // down
];

export class CompoundEye {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Object3D} parent  the head: position + yaw, kept level (no bank)
   * @param {number} size  face resolution in pixels (48, as upstream)
   * @param {number} layer  camera layer; the fly's own body lives elsewhere so it is invisible to itself
   */
  constructor(renderer, scene, parent, size = 48, layer = 0) {
    this.renderer = renderer;
    this.scene = scene;
    this.size = size;
    this.cams = [];
    this.targets = [];
    this.pixels = [];
    this.lookups = new Map();
    this.renderMs = 0;
    const zero = new THREE.Vector3();
    for (const f of FACES) {
      const cam = new THREE.PerspectiveCamera(90, 1, 0.05, 500);
      const m = new THREE.Matrix4().lookAt(zero, new THREE.Vector3(...f.dir), new THREE.Vector3(...f.up));
      cam.quaternion.setFromRotationMatrix(m);
      cam.layers.set(layer);
      parent.add(cam);
      this.cams.push(cam);
      this.targets.push(
        new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true }),
      );
      this.pixels.push(new Uint8Array(size * size * 4));
    }
  }

  /** Precompute the (face, pixel) for each ommatidium of a lattice. */
  register(omm) {
    const face = new Int32Array(omm.count).fill(-1);
    const offset = new Int32Array(omm.count);
    const d = new THREE.Vector3();
    const inv = this.cams.map((c) => c.quaternion.clone().invert());
    for (let i = 0; i < omm.count; i++) {
      d.set(omm.dirs[i * 3], omm.dirs[i * 3 + 1], omm.dirs[i * 3 + 2]);
      for (let k = 0; k < this.cams.length; k++) {
        const c = d.clone().applyQuaternion(inv[k]);
        if (c.z >= 0) continue;
        const x = c.x / -c.z,
          y = c.y / -c.z;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) continue;
        const px = Math.min(this.size - 1, Math.floor(((x + 1) / 2) * this.size));
        const py = Math.min(this.size - 1, Math.floor(((y + 1) / 2) * this.size));
        face[i] = k;
        offset[i] = (py * this.size + px) * 4;
        break;
      }
    }
    this.lookups.set(omm, { face, offset });
    let unmapped = 0;
    for (let i = 0; i < omm.count; i++) if (face[i] < 0) unmapped++;
    return unmapped;
  }

  /** Render all six faces from the parent's current pose and read them back. */
  render() {
    const r = this.renderer,
      t0 = performance.now();
    for (let k = 0; k < this.cams.length; k++) {
      r.setRenderTarget(this.targets[k]);
      r.render(this.scene, this.cams[k]);
      r.readRenderTargetPixels(this.targets[k], 0, 0, this.size, this.size, this.pixels[k]);
    }
    r.setRenderTarget(null);
    this.renderMs = performance.now() - t0;
  }

  /** Gather luminance (0..1) per ommatidium from the last render. */
  sample(omm, out) {
    const lk = this.lookups.get(omm);
    if (!lk) throw Error('ommatidia not registered with this eye');
    for (let i = 0; i < omm.count; i++) {
      const f = lk.face[i];
      if (f < 0) {
        out[i] = 0;
        continue;
      }
      const p = this.pixels[f],
        o = lk.offset[i];
      out[i] = (0.2126 * p[o] + 0.7152 * p[o + 1] + 0.0722 * p[o + 2]) / 255;
    }
    return out;
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    for (const c of this.cams) c.removeFromParent();
  }
}
