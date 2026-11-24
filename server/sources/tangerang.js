// Kabupaten Tangerang: ATCS Dishub (cctv-dishub.tangerangkab.go.id).
// The /cctv-map page is a Livewire component whose snapshot lists every camera
// with coordinates and an HLS link. The streams send no CORS headers.
import { getText, titleCase } from '../net.js';

const PAGE = 'https://cctv-dishub.tangerangkab.go.id/cctv-map';
export const meta = {
  city: 'tangerang',
  label: 'Kab. Tangerang',
  operator: 'Dishub Kabupaten Tangerang',
  page: 'https://cctv-dishub.tangerangkab.go.id/',
  center: [106.4936, -6.1862],
};

const SKIP = /^(pemda|kecamatan|tugu)\b/i;

export async function discover() {
  const html = (await getText(PAGE, { timeoutMs: 40_000 })).replace(/&quot;/g, '"');
  const re = /\{"id":"([0-9a-z]+)","name":"([^"]*)","latitude":(-?[\d.]+),"longitude":(-?[\d.]+),"url":"([^"]+)"\}/g;
  const seen = new Set();
  const cams = [];
  for (const m of html.matchAll(re)) {
    const [, id, rawName, lat, lng, rawUrl] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    const stream = rawUrl.replace(/\\\//g, '/');
    if (!/^https:\/\//.test(stream)) continue;
    const s = rawName.replace(/\s+/g, ' ').trim();
    if (SKIP.test(s)) continue;
    // "Simpang Legok 1" -> name "Simpang Legok", view "View 1"; "Jayanti 1 Arah Serang" keeps its direction.
    const dir = s.match(/\barah\s+(.+)$/i);
    const base = dir ? s.slice(0, dir.index).trim() : s;
    const n = base.match(/\s(\d)$/);
    cams.push({
      id: `tgr-${id.slice(-8)}`,
      city: meta.city,
      name: titleCase((n ? base.slice(0, n.index) : base).replace(/^jl\.?\s*/i, 'Jl. ')),
      view: dir ? `Arah ${titleCase(dir[1])}` : n ? `View ${n[1]}` : 'View 1',
      area: 'Kabupaten Tangerang',
      operator: meta.operator,
      stream,
      snapshot: null,
      cors: null,
      lat: +lat,
      lng: +lng,
      approx: false,
    });
  }
  if (!cams.length) throw new Error('tangerang: camera list not found in page');
  return cams;
}
