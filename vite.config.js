import { defineConfig } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PUBLIC = 'vendor/fruit-fly-simulation/public';

// Xenova's README: "Serve the .bin.gz and .json.gz files as stored bytes, without adding a
// Content-Encoding: gzip header: the app decompresses them itself." Vite's static middleware
// (sirv) adds that header for .gz files, the browser inflates transparently, and the app's own
// DecompressionStream then fails with "Failed to fetch". Serve them raw in dev and preview.
function storedGzip() {
  const handler = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (!/^\/data\/[\w.-]+\.(bin|json)\.gz$/.test(path)) return next();
    const file = join(process.cwd(), PUBLIC, path);
    let size;
    try {
      size = statSync(file).size;
    } catch {
      return next();
    }
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Length': size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  };
  return {
    name: 'stored-gzip',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

// Xenova's demo, booted from this repo. Static assets (connectome data, meshes, kernels,
// fonts) are served straight out of the vendored Space; only src/ is ours.
export default defineConfig({
  base: './',
  publicDir: PUBLIC,
  plugins: [storedGzip()],
  build: { rolldownOptions: { input: { main: resolve('index.html'), eye: resolve('eye.html') } } },
  worker: { format: 'es' },
  server: { host: true, port: 5173, strictPort: true },
  // The worker is the only importer of @huggingface/kernels. Without this, the dev server
  // discovers it at runtime, re-bundles, and force-reloads the page mid-boot.
  optimizeDeps: { entries: ['index.html', 'src/worker.js'], include: ['@huggingface/kernels', 'three'] },
});
