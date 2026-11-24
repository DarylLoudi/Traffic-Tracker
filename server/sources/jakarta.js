// Jakarta: the provincial public CCTV page (jakcctv.jakarta.go.id/publik).
// It lists Flussonic embeds (mostly Bali Tower hardware run for DKI). Each embed
// base serves index.m3u8 (HLS) and preview.jpg. The list has no coordinates,
// so locations are geocoded from the road name and marked approximate.
import { getJson, titleCase, slug } from '../net.js';

const LIST = 'https://jakcctv.jakarta.go.id/publik/data';
export const meta = {
  city: 'jakarta',
  label: 'Jakarta',
  operator: 'Pemprov DKI Jakarta',
  page: 'https://jakcctv.jakarta.go.id/publik',
  center: [106.8227, -6.2088],
};

const AREA = { JKP: 'Jakarta Pusat', JKB: 'Jakarta Barat', JKS: 'Jakarta Selatan', JKT: 'Jakarta Timur', JKU: 'Jakarta Utara' };

function clean(raw) {
  let s = raw.trim();
  const m = s.match(/^(JK[PBSTU])\s+/);
  const area = m ? AREA[m[1]] : null;
  if (m) s = s.slice(m[0].length);
  s = s.replace(/^(POLDA|POLRI|SATPOL\s?PP|DISHUB|DBM)\s+/i, '');
  const code = (s.match(/[-\s]C(\d{2})$/) || [])[1] || null;
  s = s.replace(/[-\s]C\d{2}$/, '').trim();
  return { name: titleCase(s), area, code };
}

/** Text to send to the geocoder for a cleaned camera name. */
function geoQuery(name, area) {
  let q = name
    .replace(/^Simpang\s+/i, '')
    .replace(/^JPO\s+/i, '')
    .replace(/\bJl\.?\s*/i, 'Jalan ')
    .replace(/\bJend\.\s*/i, 'Jenderal ')
    .replace(/\bLetjen\.\s*/i, 'Letjen ')
    .replace(/\bMH\.?\s*/i, 'M.H. ')
    .replace(/\bKH\.?\s*/i, 'K.H. ')
    .replace(/\s+\d+$/, '');
  const fix = {
    'Jalan Letjen S. Parman': 'Jalan S. Parman, Jakarta Barat',
    'Flyover Ladokgi': 'Jalan Farmasi, Bendungan Hilir, Jakarta',
    'Jalan K.H. Mas Mansyur': 'Jalan Mas Mansyur, Jakarta',
    'Jalan Jati Baru Raya': 'Jalan Jatibaru Raya, Jakarta',
  };
  if (/^Flyover Ladokgi/i.test(name)) q = 'Flyover Ladokgi';
  if (fix[q]) return `${fix[q]}, Indonesia`;
  if (/^Senayan|^Bendungan Hilir|^Kebon Melati/i.test(name)) q = name.replace(/\s+\d+$/, '');
  return `${q}, ${area || 'Jakarta'}, Indonesia`;
}

export async function discover() {
  const cams = [];
  let page = 1;
  let pages = 1;
  do {
    const d = await getJson(`${LIST}?q=&page=${page}`, { headers: { referer: meta.page } });
    const re = /<iframe src="([^"]+)"[\s\S]*?<div class="title">([^<]+)<\/div>\s*<span class="badge">([^<]*)<\/span>/g;
    for (const m of d.cards.matchAll(re)) {
      const src = m[1].replace(/&amp;/g, '&');
      const base = src.replace(/\/embed\.html.*$/, '');
      const u = new URL(base);
      if (u.protocol !== 'https:') continue;
      const { name, area, code } = clean(m[2]);
      const view = m[3].trim().replace(/^CCTV-?0*/i, 'View ');
      cams.push({
        id: `jkt-${slug(u.pathname.split('/').pop())}`,
        city: meta.city,
        name: code ? `${name} (C${code})` : name,
        view,
        area: area || 'Jakarta',
        operator: meta.operator,
        stream: `${base}/index.m3u8`,
        snapshot: `${base}/preview.jpg`,
        cors: true,
        geocode: geoQuery(name, area),
        lat: null,
        lng: null,
        approx: true,
      });
    }
    pages = Number((String(d.count).match(/\/(\d+)/) || [])[1]) || 1;
    page++;
  } while (page <= pages && page <= 30);
  return cams;
}
