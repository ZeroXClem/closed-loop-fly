/**
 * The sampling lattice: one ommatidium per optic-lobe column, at the direction AbijahKaj's
 * extractor calibrated from the wiring (port of vendor/fruit-fly-brain-research/app/src/eye/
 * ommatidia.ts). Fly-local frame: x = right, y = up, -z = forward. Azimuth 0 is straight
 * ahead and positive to the right for both eyes; elevation positive up.
 */
const DEG = Math.PI / 180;

/** @typedef {{ side: 'left'|'right', count: number, dirs: Float32Array, az: Float32Array, el: Float32Array, spacing: number, col: Int32Array }} Ommatidia */

/** Lattice for one eye from the column table (src/eye/columns.json or the graph's columns). */
export function ommatidiaFromColumns(side, columns, spacingDeg = columns.spacingDeg ?? 5) {
  const want = side === 'left' ? 0 : 1;
  const idx = [];
  for (let c = 0; c < columns.count; c++) if (columns.side[c] === want) idx.push(c);
  const az = Float32Array.from(idx, (c) => columns.az[c]);
  const el = Float32Array.from(idx, (c) => columns.el[c]);
  const count = az.length,
    dirs = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = az[i],
      e = el[i];
    dirs[i * 3] = Math.sin(a) * Math.cos(e);
    dirs[i * 3 + 1] = Math.sin(e);
    dirs[i * 3 + 2] = -Math.cos(a) * Math.cos(e);
  }
  return { side, count, dirs, az, el, spacing: spacingDeg * DEG, col: Int32Array.from(idx) };
}

/** Both eyes from a column table. */
export function eyesFromColumns(columns) {
  return { left: ommatidiaFromColumns('left', columns), right: ommatidiaFromColumns('right', columns) };
}
