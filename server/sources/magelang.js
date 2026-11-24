// Magelang: CCTV Kota Magelang (cctv.magelangkota.go.id/map).
// The map page carries data-locations: one entry per camera position with
// coordinates and the monitor (HLS stream) shown there.
import { getText, titleCase } from '../net.js';

const PAGE = 'https://cctv.magelangkota.go.id/map';
export const meta = {
  city: 'magelang',
  label: 'Magelang',
  operator: 'Dishub Kota Magelang',
  page: 'https://cctv.magelangkota.go.id/',
  center: [110.2177, -7.4797],
};

// Parks, squares, car parks and the bus terminal yard are not road views.
const SKIP = /taman|kebun bibit|parkir|terminal|alun|aloon|panggung|kuliner|setda|tenis|lapangan|lap karang/i;
const WORDS = [
  [/\bmgl\b/gi, 'Magelang'],
  [/\bpusk\b/gi, 'Puskesmas'],
  [/\bkec\b/gi, 'Kec.'],
  [/^t\.\s*/i, 'Pertigaan '],
  [/\bpantiperry\b/gi, 'Panti Perry'],
  [/\brumdin\b/gi, 'Rumah Dinas'],
];
const words = (s) => WORDS.reduce((a, [re, to]) => a.replace(re, to), s);

export async function discover() {
  const html = await getText(PAGE, { timeoutMs: 40_000 });
  const raw = html.match(/data-locations='([^']+)'/);
  if (!raw) throw new Error('magelang: camera list not found in page');
  const list = JSON.parse(raw[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'));
  const cams = [];
  const seen = new Set();
  for (const l of list) {
    const mon = l.monitor;
    const stream = mon?.hls_link;
    if (!stream || !/^https:\/\//.test(stream) || mon.private || seen.has(stream)) continue;
    const label = (mon.name || l.name || '').replace(/\s+/g, ' ').trim();
    if (SKIP.test(label) || SKIP.test(l.name || '')) continue;
    const lat = +l.latitude;
    const lng = +l.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    seen.add(stream);
    // "Simpang Kupatan - Barat" -> name "Simpang Kupatan", view "Barat"
    const parts = label.split(/\s+-\s*|\s*-\s+/);
    const name = titleCase(words(parts[0].replace(/rooyong/i, 'Royong')));
    const view = parts.length > 1 ? titleCase(parts.slice(1).join(' ').replace(/^jl\.?\s+/i, '')) : 'View 1';
    cams.push({
      id: `mgl-${mon.id}`,
      city: meta.city,
      name,
      view: view.replace(/^Ptz$/i, 'PTZ'),
      area: 'Kota Magelang',
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
