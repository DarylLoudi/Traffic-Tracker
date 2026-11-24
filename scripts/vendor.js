// Copies browser libraries from node_modules into public/vendor so the page
// loads nothing from third-party script CDNs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'public', 'vendor', ...p);

const files = [
  [nm('maplibre-gl', 'dist', 'maplibre-gl.mjs'), out('maplibre', 'maplibre-gl.mjs')],
  [nm('maplibre-gl', 'dist', 'maplibre-gl-worker.mjs'), out('maplibre', 'maplibre-gl-worker.mjs')],
  [nm('maplibre-gl', 'dist', 'maplibre-gl.css'), out('maplibre', 'maplibre-gl.css')],
  [nm('hls.js', 'dist', 'hls.min.mjs'), out('hls', 'hls.min.mjs')],
  [nm('@fontsource-variable', 'overpass', 'files', 'overpass-latin-wght-normal.woff2'), out('fonts', 'overpass-latin.woff2')],
  [nm('@fontsource-variable', 'overpass', 'files', 'overpass-latin-ext-wght-normal.woff2'), out('fonts', 'overpass-latin-ext.woff2')],
];
for (const [from, to] of files) {
  if (!fs.existsSync(from)) {
    console.warn('vendor: missing', path.relative(root, from));
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log('vendor: copied', files.length, 'files into public/vendor');
