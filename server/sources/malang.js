// Malang: Portal CCTV Publik Kota Malang (cctv.malangkota.go.id).
// A Next.js page whose flight data carries `initialCameras`, each with coordinates,
// a stream id and the HLS pattern of the media node that serves it.
import { getText, titleCase } from '../net.js';

const PAGE = 'https://cctv.malangkota.go.id/';
export const meta = {
  city: 'malang',
  label: 'Malang',
  operator: 'Diskominfo Kota Malang',
  page: PAGE,
  center: [112.6326, -7.9666],
  // The media nodes turn away bursts, so only a few streams are read at once.
  concurrency: 3,
};

/** Joins the `self.__next_f.push([1, "..."])` chunks back into one string. */
function flight(html) {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) out += JSON.parse(`"${m[1]}"`);
  return out;
}

function arrayAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('malang: camera list not found in page');
  let i = text.indexOf('[', at);
  const start = i;
  let depth = 0;
  let inStr = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  return JSON.parse(text.slice(start, i + 1));
}

/** "Jl. Ijen Arah Utara (Poltekes)" -> name "Jl. Ijen (Poltekes)", view "Arah Utara" */
function split(raw) {
  const s = raw.replace(/\s+/g, ' ').replace(/\s\./g, ' ').replace(/\.$/, '').trim();
  const m = s.match(/\s*\(?\b(arah [a-z]+(?: [a-z]+)?)\)?/i);
  if (!m) return { name: titleCase(s), view: 'View 1' };
  const name = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { name: titleCase(name), view: titleCase(m[1]) };
}

export async function discover() {
  const html = await getText(PAGE, { timeoutMs: 40_000 });
  const list = arrayAfter(flight(html), '"initialCameras":');
  const cams = [];
  for (const c of list) {
    if (String(c.status) !== '1' || !c.stream_id || !c.stream_server_base_url) continue;
    if (/^(cctv|taman)\b/i.test(c.name)) continue; // bare IP or loopback test entries, parks
    const lat = +c.latitude;
    const lng = +c.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng) continue;
    const stream = (c.stream_server_hls_pattern || '{base_url}/{stream_id}/index.m3u8')
      .replace('{base_url}', c.stream_server_base_url)
      .replace('{stream_id}', c.stream_id);
    const { name, view } = split(c.name);
    cams.push({
      id: `mlg-${String(c.id).slice(0, 8)}`,
      city: meta.city,
      name,
      view,
      area: c.nama_kecamatan ? `Kec. ${titleCase(c.nama_kecamatan)}` : 'Kota Malang',
      operator: meta.operator,
      stream,
      snapshot: null,
      cors: null,
      lat,
      lng,
      approx: false,
    });
  }
  return cams;
}
