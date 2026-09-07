/**
 * The fly's eye as one object: lattice, cube render, sampler, photoreceptors, per eye.
 *
 *   const eye = createEye({ renderer, scene, head, columns });
 *   eye.frame(dt)            render + sample + photoreceptor step
 *   eye.lum.left / .right    luminance per column (0..1)
 *   eye.r.left / .right      photoreceptor output per column
 *   eye.omm.left / .right    the lattices (az, el, col)
 */
import { CompoundEye } from './eye.js';
import { eyesFromColumns } from './ommatidia.js';
import { Photoreceptors } from './photoreceptor.js';

export function createEye({ renderer, scene, head, columns, size = 48, layer = 0, photoreceptor = {} }) {
  const omm = eyesFromColumns(columns);
  const cube = new CompoundEye(renderer, scene, head, size, layer);
  const unmapped = { left: cube.register(omm.left), right: cube.register(omm.right) };
  const lum = { left: new Float32Array(omm.left.count), right: new Float32Array(omm.right.count) };
  const pr = { left: new Photoreceptors(omm.left.count, photoreceptor), right: new Photoreceptors(omm.right.count, photoreceptor) };
  const r = { left: pr.left.r, right: pr.right.r };
  let sampleMs = 0;
  return {
    omm,
    cube,
    lum,
    r,
    photoreceptors: pr,
    unmapped,
    get renderMs() {
      return cube.renderMs;
    },
    get sampleMs() {
      return sampleMs;
    },
    /** Render from the head's current world pose, sample both eyes, advance the photoreceptors. */
    frame(dt) {
      head.updateMatrixWorld(true);
      cube.render();
      const t0 = performance.now();
      cube.sample(omm.left, lum.left);
      cube.sample(omm.right, lum.right);
      pr.left.step(lum.left, dt);
      pr.right.step(lum.right, dt);
      sampleMs = performance.now() - t0;
    },
    reset() {
      pr.left.reset();
      pr.right.reset();
    },
    dispose() {
      cube.dispose();
    },
  };
}
