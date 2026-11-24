// Palembang: CCTV Kota Palembang (cctv.palembang.go.id).
// The public map reads /api/cctv: GeoJSON points, an HLS link and a status per camera.
import { getJson, titleCase } from '../net.js';

const PAGE = 'https://cctv.palembang.go.id/';
export const meta = {
  city: 'palembang',
  label: 'Palembang',
  operator: 'Pemkot Palembang',
  page: PAGE,
  center: [104.7458, -2.9761],
};

// Car parks, offices and parks rather than roads.
const SKIP = /parkir|disdukcapil|punti kayu|benteng kuto besak/i;

function clean(title) {
  return titleCase(
    title
      .replace(/^cctv\s+/i, '')
      .replace(/^sp\b\.?/i, 'Simpang')
      .replace(/^jl\b\.?/i, 'Jl.'),
  );
}

export async function discover() {
  const d = await getJson(`${PAGE}api/cctv`, { headers: { referer: PAGE } });
  const cams = [];
  for (const c of d.data || []) {
    if (c.cctv_status !== 'active' || c.cctv_scope !== 'publik' || !/^https:\/\//.test(c.cctv_link || '')) continue;
    if (SKIP.test(c.cctv_title)) continue;
    const [lng, lat] = c.location?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // "Jl Veteran 1", "Jl Veteran 2": same road, numbered views.
    const raw = clean(c.cctv_title);
    const n = raw.match(/\s(\d)$/);
    cams.push({
      id: `plg-${c.cctv_id ? c.cctv_id.replace(/[^A-Za-z0-9]+/g, '').slice(-10).toLowerCase() : c._id.slice(-8)}`,
      city: meta.city,
      name: n ? raw.slice(0, n.index) : raw,
      view: n ? `View ${n[1]}` : 'View 1',
      area: c.kecamatan?.namaKecamatan ? `Kec. ${titleCase(c.kecamatan.namaKecamatan)}` : 'Kota Palembang',
      operator: titleCase(c.cctv_opd?.nama_opd || meta.operator),
      stream: c.cctv_link,
      snapshot: null,
      cors: null,
      lat,
      lng,
      approx: false,
    });
  }
  return cams;
}
