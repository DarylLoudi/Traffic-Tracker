// Yogyakarta: CCTV Kota Yogyakarta (cctv.jogjakota.go.id), Wowza HLS.
// Only road-facing categories are kept: junction ATCS cameras, Malioboro and
// street cameras. Rivers, parks, gates and office cameras are left out.
import { getJson, titleCase } from '../net.js';

const BASE = 'https://cctv.jogjakota.go.id';
export const meta = {
  city: 'yogyakarta',
  label: 'Yogyakarta',
  operator: 'Pemkot Yogyakarta',
  page: BASE + '/',
  center: [110.3695, -7.7956],
};

const ROAD_CATEGORIES = new Set(['1', '3', '33', '34']);

export async function discover() {
  const rows = await getJson(`${BASE}/home/getdata`, {
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: BASE + '/' },
  });
  return rows
    .filter((r) => r.cctv_status === '0' && ROAD_CATEGORIES.has(String(r.cctv_category)))
    .filter((r) => /^https:\/\//.test(r.cctv_link || ''))
    .map((r) => {
      const title = r.cctv_title.replace(/_/g, ' ');
      const ptz = /\(PTZ\)/i.test(title);
      return {
        id: `jog-${r.cctv_id}`,
        city: meta.city,
        name: titleCase(title.replace(/\s*\(PTZ\)\s*/i, '')),
        view: ptz ? 'PTZ' : 'Fixed',
        area: r.kecamatan_nama ? titleCase(r.kecamatan_nama) : 'Kota Yogyakarta',
        operator: meta.operator,
        stream: r.cctv_link,
        snapshot: null,
        cors: true,
        lat: +r.cctv_latitude,
        lng: +r.cctv_longitude,
        approx: false,
      };
    })
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.lat < -7 && c.lat > -8.2);
}
