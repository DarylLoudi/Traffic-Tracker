// Semarang: Pantau Semar (pantausemar.semarangkota.go.id).
// The page embeds `var cctvs = [...]` with coordinates and HLS links.
import { getText, titleCase, slug } from '../net.js';

const PAGE = 'https://pantausemar.semarangkota.go.id/';
export const meta = {
  city: 'semarang',
  label: 'Semarang',
  operator: 'Dishub Kota Semarang',
  page: PAGE,
  center: [110.4203, -6.9932],
};

// Counting cameras and tunnel/utility cameras are not road views we can read.
const SKIP = /^(counting|camera \d+|dpu[-_ ]kel)/i;

function extractArray(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error('semarang: camera list not found in page');
  let i = html.indexOf('[', at);
  const start = i;
  let depth = 0;
  let inStr = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  return JSON.parse(html.slice(start, i + 1));
}

export async function discover() {
  const html = await getText(PAGE, { timeoutMs: 40_000 });
  const arr = extractArray(html, 'var cctvs');
  const cams = [];
  for (const site of arr) {
    const lat = +site.lat;
    const lng = +site.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    (site.links || []).forEach((l, i) => {
      if (l.status !== 1 || !/^https:\/\//.test(l.url || '')) return;
      if (SKIP.test(l.name || site.owner_name)) return;
      const key = (l.url.match(/\/([0-9a-f-]{36})\//) || [])[1] || slug(l.name);
      const raw = (l.name || site.owner_name).replace(/\s*\b(360|ptz|wide)\b/gi, '').trim();
      cams.push({
        id: `smg-${l.id || key.slice(0, 8)}`,
        city: meta.city,
        name: titleCase(raw),
        view: /360/.test(l.name) ? '360°' : /wide/i.test(l.name) ? 'Wide' : /ptz/i.test(l.name) ? 'PTZ' : 'View 1',
        area: 'Kota Semarang',
        operator: titleCase(l.owner_name || meta.operator),
        stream: l.url,
        snapshot: l.url.replace(/\/index\.m3u8.*$/, '/preview.jpg'),
        cors: null, // checked at discover time
        lat: lat + i * 0.00008,
        lng,
        approx: false,
      });
    });
  }
  return cams;
}
