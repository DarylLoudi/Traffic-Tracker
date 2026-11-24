// Bekasi: Pantau CCTV, Pemkot Bekasi (bekasikota.go.id/cctv).
// The city site's public API lists each camera with a name and an HLS path on the
// same host. No coordinates: each title is "road + landmark", so the landmark is
// looked up first and the road second. All are marked approximate.
// Playlists point at /api/cctv/seg/..., outside the playlist's own folder, so the
// relay is allowed the whole /api/cctv/ folder for these cameras.
import { getJson, titleCase } from '../net.js';

const SITE = 'https://bekasikota.go.id';
export const meta = {
  city: 'bekasi',
  label: 'Bekasi',
  operator: 'Pemkot Bekasi',
  page: `${SITE}/cctv`,
  center: [106.9896, -6.2383],
  // The API allows 120 requests a minute; a stream read takes several.
  concurrency: 2,
};

const BOX = [106.9, -6.4, 107.06, -6.16];
const ROADS = [
  ['Chairil Anwar', 'Jalan Chairil Anwar'],
  ['Cut Mutia', 'Jalan Cut Mutia'],
  ['HM Joyo Martono', 'Jalan Joyo Martono'],
  ['Ir H Juanda', 'Jalan Juanda'],
  ['Jend A Yani', 'Jalan Ahmad Yani'],
  ['Jend Soedirman', 'Jalan Jenderal Sudirman'],
  ['KH Noer Ali', 'Jalan Noer Ali'],
  ['M Hasibuan', 'Jalan Hasibuan'],
  ['Mayor Oking', 'Jalan Mayor Oking'],
  ['RA Kartini', 'Jalan Kartini'],
  ['Rawa Tembaga', 'Jalan Rawa Tembaga'],
  ['Raya Kalimalang', 'Jalan Kalimalang'],
  ['Siliwangi', 'Jalan Siliwangi'],
];

function split(title) {
  const s = title.replace(/^jl\.?\s+/i, '').trim();
  for (const [short, full] of ROADS) {
    if (s.toLowerCase().startsWith(short.toLowerCase())) {
      const rest = s.slice(short.length).trim();
      return { road: `Jl. ${short}`, full, landmark: rest };
    }
  }
  return { road: `Jl. ${s}`, full: `Jalan ${s}`, landmark: '' };
}

export async function discover() {
  const d = await getJson(`${SITE}/api/cctv`, { headers: { referer: meta.page } });
  const cams = [];
  for (const c of d.data || []) {
    if (!c.name || !/^\/api\/cctv\/stream\/[A-Za-z0-9_.-]+\.m3u8$/.test(c.stream || '')) continue;
    const { road, full, landmark } = split(c.title || c.name.replace(/_/g, ' '));
    const where = landmark.replace(/^(depan|sebrang|seberang|perempatan|pertigaan|putaran depan|taman depan)\s+/i, '');
    const geo = [];
    if (where) geo.push({ q: `${where}, Bekasi`, box: BOX });
    if (/perempatan|pertigaan|simpang/i.test(landmark) && where) geo.push({ junction: [full.replace(/^Jalan\s+/, ''), where.split(' ').pop()], box: BOX });
    geo.push({ q: `${full}, Bekasi`, box: BOX });
    cams.push({
      id: `bks-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)}`,
      city: meta.city,
      name: titleCase(road),
      view: landmark ? titleCase(landmark) : 'View 1',
      area: 'Kota Bekasi',
      operator: meta.operator,
      stream: SITE + c.stream,
      relayBase: `${SITE}/api/cctv/`,
      snapshot: null,
      cors: null,
      geo,
      approx: true,
    });
  }
  if (!cams.length) throw new Error('bekasi: no cameras in API response');
  return cams;
}
