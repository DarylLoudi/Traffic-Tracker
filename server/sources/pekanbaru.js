// Pekanbaru: Pekanbaru CCTV (cctv.pekanbaru.go.id/cam).
// A plain page of cards, each with data-name and data-manifest (HLS). There are no
// coordinates: junctions "A - B" are placed where the two named roads meet in
// OpenStreetMap, anything else from its name. All are marked approximate.
import { getText, titleCase } from '../net.js';

const PAGE = 'https://cctv.pekanbaru.go.id/cam';
export const meta = {
  city: 'pekanbaru',
  label: 'Pekanbaru',
  operator: 'Diskominfotiksan Kota Pekanbaru',
  page: PAGE,
  center: [101.4478, 0.5071],
};

const BOX = [101.3, 0.38, 101.6, 0.68];
// Parks, shelters, school yards, the river port and PA announcer feeds are not road views.
const SKIP = /taman labuai|rumah singgah|^rth\b|announcer|sembilang - sekolah|pelabuhan|stadion rumbai/i;

const ROAD = { DIPO: 'Diponegoro', HANGTUAH: 'Hang Tuah', RIAU: 'Riau', LOBAK: 'Lobak', 'KH AHMAD DAHLAN': 'Ahmad Dahlan' };
const road = (s) => ROAD[s.trim().toUpperCase()] || s.trim();

function place(raw) {
  // A note in brackets goes, then a trailing number or letter is the view; a PTZ prefix too.
  let s = raw.replace(/\s*\((.*?)\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  let view = 'View 1';
  const n = s.match(/\s(\d|[A-Z])$/);
  if (n) {
    view = `View ${n[1]}`;
    s = s.slice(0, n.index);
  }
  if (/^ptz\s+/i.test(s)) {
    view = 'PTZ';
    s = s.replace(/^ptz\s+/i, '');
  }
  return { s, view };
}

/** "DIPO - GAJAH MADA" -> "Diponegoro – Gajah Mada" */
const display = (s) =>
  s
    .split(/\s*-\s*/)
    .map((p) => road(p))
    .join(' – ');

function geoSteps(s) {
  const steps = [];
  const pair = s
    .replace(/^(simpang|jpo|flyover)\s+/i, '')
    .split(/\s*-\s*/)
    .map((p) => p.replace(/^(flyover|jpo)\s+/i, ''));
  if (pair.length === 2 && /^(depan|seberang)\b/i.test(pair[1])) {
    // "Sudirman - Depan Bank Mandiri": a landmark on one road.
    steps.push({ q: `${pair[1].replace(/^(depan|seberang)\s+/i, '')}, Jalan ${road(pair[0])}, Pekanbaru`, box: BOX });
    steps.push({ q: `Jalan ${road(pair[0])}, Pekanbaru`, box: BOX });
  } else if (pair.length === 2 && pair.every((p) => p.length > 2) && !/^jpo$/i.test(pair[0])) {
    steps.push({ junction: [road(pair[0]), road(pair[1])], box: BOX });
    steps.push({ q: `Jalan ${road(pair[0])}, Pekanbaru`, box: BOX });
  } else {
    const plain = s.replace(/\s*-\s*/g, ' ').trim();
    steps.push({ q: `${plain}, Pekanbaru`, box: BOX });
    const words = plain.replace(/^(simpang|depan|seberang|jpo|flyover)\s+/i, '');
    if (words !== plain) steps.push({ q: `${words}, Pekanbaru`, box: BOX });
  }
  return steps;
}

export async function discover() {
  const html = await getText(PAGE, { timeoutMs: 40_000 });
  const re = /data-cam-id="(\d+)"\s+data-name="([^"]+)"\s+data-manifest="([^"]+)"/g;
  const cams = [];
  const seen = new Set();
  const views = new Map();
  for (const m of html.matchAll(re)) {
    const [, id, rawName, stream] = m;
    if (seen.has(stream) || !/^https:\/\//.test(stream) || SKIP.test(rawName)) continue;
    seen.add(stream);
    const { s, view: v } = place(rawName.replace(/&amp;/g, '&'));
    const name = titleCase(/^jpo\s*-\s*mtq$/i.test(s) ? 'JPO MTQ' : display(s));
    // Two cards with the same name and number get distinct views.
    let view = v;
    for (let k = 2; views.has(`${name}|${view}`); k++) view = `View ${k}`;
    views.set(`${name}|${view}`, true);
    cams.push({
      id: `pku-${id}`,
      city: meta.city,
      name,
      view,
      area: 'Kota Pekanbaru',
      operator: meta.operator,
      stream,
      snapshot: null,
      cors: null,
      geo: geoSteps(s),
      approx: true,
    });
  }
  if (!cams.length) throw new Error('pekanbaru: camera list not found in page');
  return cams;
}
