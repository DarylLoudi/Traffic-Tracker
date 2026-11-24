// Bandung: ATCS Dishub Kota Bandung (atcs-dishub.bandung.go.id).
// Locations (with coordinates) -> cameras per location -> HLS source per camera.
// The endpoints want a session cookie and an XHR header, like the site's own JS.
// Streams are Flussonic without CORS, so the browser plays them through our proxy.
import { get, titleCase, pool } from '../net.js';

const BASE = 'https://atcs-dishub.bandung.go.id';
export const meta = {
  city: 'bandung',
  label: 'Bandung',
  operator: 'ATCS Dishub Kota Bandung',
  page: BASE + '/',
  center: [107.6191, -6.9175],
};

async function session() {
  const res = await get(BASE + '/', { timeoutMs: 25_000 });
  const raw = res.headers.getSetCookie?.() || [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function post(pathname, data, cookie) {
  const res = await get(BASE + pathname, {
    method: 'POST',
    body: new URLSearchParams(data).toString(),
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      referer: BASE + '/',
      origin: BASE,
    },
  });
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? res.json() : res.text();
}

export async function discover() {
  const cookie = await session();
  const locations = await post('/ajax/lokasi', {}, cookie);
  const lists = await pool(locations, 3, async (loc) => {
    const html = await post('/ajax/cctv-list', { id: loc.id_lokasi }, cookie);
    const items = [...String(html).matchAll(/showStreamingModal\((\d+)\)[\s\S]*?<p class="col-sm-12 text-center">\s*([^<]+?)\s*<\/p>\s*<footer/g)];
    return items.map((m, i) => ({ loc, camId: m[1], label: m[2].trim(), i }));
  });
  const flat = lists.flat();
  const cams = await pool(flat, 3, async ({ loc, camId, label, i }) => {
    try {
      const info = await post('/ajax/cctv-info', { id: camId }, cookie);
      if (!info || !info.src || !/^https:\/\//.test(info.src)) return null;
      const base = info.src.replace(/\/index\.m3u8.*$/, '');
      // Spread cameras that share one junction a few metres apart so markers don't stack.
      const ang = (i * 2.4) % (Math.PI * 2);
      const r = i ? 0.00012 : 0;
      const dir = (label.match(/\(([^)]+)\)/) || [])[1];
      return {
        id: `bdg-${camId}`,
        city: meta.city,
        name: titleCase(loc.nama_lokasi),
        view: dir ? titleCase(dir) : titleCase(label.replace(/^VID\s+/i, '')),
        area: 'Kota Bandung',
        operator: meta.operator,
        stream: info.src,
        snapshot: `${base}/preview.jpg`,
        cors: false,
        lat: +loc.lat_lokasi + Math.sin(ang) * r,
        lng: +loc.lon_lokasi + Math.cos(ang) * r,
        approx: false,
      };
    } catch {
      return null;
    }
  });
  return cams.filter(Boolean);
}
