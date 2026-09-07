import { defineConfig } from 'vite';

// Xenova's demo, booted from this repo. Static assets (connectome data, meshes, kernels,
// fonts) are served straight out of the vendored Space; only src/ is ours.
export default defineConfig({
  base: './',
  publicDir: 'vendor/fruit-fly-simulation/public',
  worker: { format: 'es' },
  server: { host: true, port: 5173, strictPort: true },
});
