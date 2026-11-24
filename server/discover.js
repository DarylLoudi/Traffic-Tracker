// Builds data/cameras.json from every public source.
// Run: npm run discover   (the server also runs it on first start)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { get, getJson, sleep, pool } from './net.js';
import * as jakarta from './sources/jakarta.js';
import * as bandung from './sources/bandung.js';
import * as semarang from './sources/semarang.js';
import * as yogyakarta from './sources/yogyakarta.js';
import * as malang from './sources/malang.js';
import * as bekasi from './sources/bekasi.js';
import * as tangerang from './sources/tangerang.js';
import * as magelang from './sources/magelang.js';
import * as palembang from './sources/palembang.js';
import * as pekanbaru from './sources/pekanbaru.js';

// Order is the order cities are listed in: by region, west Java first, then central and east Java, then Sumatra.
export const SOURCES = [jakarta, bekasi, tangerang, bandung, semarang, yogyakarta, magelang, malang, palembang, pekanbaru];
const CAMERAS_FILE = path.join(config.dataDir, 'cameras.json');
const GEO_CACHE = path.join(config.dataDir, 'geocode-cache.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// A road name as a loose pattern: "HANGTUAH" still finds "Jalan Hang Tuah".
const nominatim = (q, box, extra = '') =>
  getJson(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=id${box ? `&viewbox=${box.join(',')}&bounded=1` : ''}${extra}&q=${encodeURIComponent(q)}`,
    { headers: { 'accept-language': 'id,en' } },
  );

/** Every vertex of the road segments Nominatim finds for a road name inside the box. */
async function roadPoints(name, box) {
  const r = await nominatim(`Jalan ${name}`, box, '&limit=12&polygon_geojson=1&layer=address');
  const pts = [];
  for (const hit of r) {
    const g = hit.geojson;
    if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) for (const [lng, lat] of line) pts.push([lng, lat]);
  }
  return pts;
}

/**
 * One geocoding attempt. A step is either
 *   "text query"                              Nominatim, anywhere in Indonesia
 *   { q, box: [w, s, e, n] }                  Nominatim, only inside the box
 *   { junction: [roadA, roadB], box }         where the two roads come closest (within ~60 m)
 */
async function lookup(step) {
  if (typeof step === 'string' || step.q) {
    const r = await nominatim(typeof step === 'string' ? step : step.q, step.box, '&limit=1');
    return r[0] ? { lat: +r[0].lat, lng: +r[0].lon } : null;
  }
  const a = await roadPoints(step.junction[0], step.box);
  await sleep(1100);
  const b = a.length ? await roadPoints(step.junction[1], step.box) : [];
  let best = null;
  const kx = Math.cos((((a[0]?.[1] ?? 0) * Math.PI) / 180));
  for (const p of a) {
    for (const q of b) {
      const d = Math.hypot((p[0] - q[0]) * kx, p[1] - q[1]);
      if (!best || d < best.d) best = { d, lng: (p[0] + q[0]) / 2, lat: (p[1] + q[1]) / 2 };
    }
  }
  // 0.0006 degrees is roughly 60 m: the two roads really meet there.
  return best && best.d < 0.0006 ? { lat: best.lat, lng: best.lng } : null;
}

// Nominatim, about one request a second; results cached for good.
async function geocode(cams, log) {
  const cache = readJson(GEO_CACHE, {});
  const keyOf = (step) => (typeof step === 'string' ? step : JSON.stringify(step));
  // A source gives either one query string or a list of steps.
  for (const c of cams) if (c.geocode && !c.geo) c.geo = [c.geocode];
  const hitFor = (c) => c.geo.map(keyOf).find((k) => cache[k] && !cache[k].miss);
  for (const c of cams) {
    if (!c.geo) continue;
    // Steps run in order and stop at the first that finds the place.
    for (const step of c.geo) {
      const key = keyOf(step);
      if (cache[key]) {
        if (cache[key].miss) continue;
        break;
      }
      let hit = null;
      try {
        hit = await lookup(step);
        cache[key] = hit || { miss: true };
        log(`  geocode ${hit ? 'ok  ' : 'miss'} ${key}`);
      } catch (e) {
        log(`  geocode fail ${key}: ${e.message}`);
      }
      await sleep(1100);
      if (hit) break;
    }
  }
  fs.writeFileSync(GEO_CACHE, JSON.stringify(cache, null, 1));
  // Cameras at the same spot get a small fixed offset so markers don't stack.
  const seen = new Map();
  for (const c of cams) {
    if (!c.geo) continue;
    c.geocode = hitFor(c) || null;
    delete c.geo;
    const hit = c.geocode && cache[c.geocode];
    if (hit) {
      const n = seen.get(c.geocode) || 0;
      seen.set(c.geocode, n + 1);
      const ang = n * 2.4;
      const r = n ? 0.00015 : 0;
      c.lat = hit.lat + Math.sin(ang) * r;
      c.lng = hit.lng + Math.cos(ang) * r;
    }
    delete c.geocode;
  }
}

// CORS is a property of the stream server, so a few cameras per host decide for all of them.
async function corsCheck(cams) {
  const byHost = new Map();
  for (const c of cams.filter((x) => x.cors === null)) {
    const host = new URL(c.stream).origin;
    byHost.set(host, [...(byHost.get(host) || []), c]);
  }
  await pool([...byHost.values()], 4, async (list) => {
    let open = false;
    for (const c of list.slice(0, 4)) {
      try {
        const res = await get(c.stream, { timeoutMs: 12_000, headers: { origin: 'http://localhost' } });
        const allow = res.headers.get('access-control-allow-origin');
        open = allow === '*' || allow === 'http://localhost'; // some servers echo the origin back
        await res.body?.cancel();
        break; // one answer is enough; an error just means that camera is down
      } catch {
        /* try the next camera on this host */
      }
    }
    for (const c of list) c.cors = open;
  });
}

export async function discover({ log = console.log } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const previous = readJson(CAMERAS_FILE, { cameras: [] }).cameras;
  const all = [];
  const cities = [];
  for (const src of SOURCES) {
    const started = Date.now();
    try {
      const cams = await src.discover();
      log(`${src.meta.label}: ${cams.length} cameras (${Date.now() - started} ms)`);
      all.push(...cams);
      cities.push({ ...src.meta, count: cams.length, ok: true });
    } catch (e) {
      // Keep the last known list for a source that is down right now.
      const kept = previous.filter((c) => c.city === src.meta.city);
      log(`${src.meta.label}: failed (${e.message}); keeping ${kept.length} from last run`);
      all.push(...kept);
      cities.push({ ...src.meta, count: kept.length, ok: false });
    }
  }
  await geocode(all, log);
  await corsCheck(all);
  const ids = new Set();
  const cameras = all.filter((c) => {
    if (ids.has(c.id) || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return false;
    ids.add(c.id);
    return true;
  });
  // Two cameras with the same name and view get numbered views, so each can be told apart.
  const groups = new Map();
  for (const c of cameras) {
    const k = `${c.city}|${c.name}|${c.view}`.toLowerCase();
    groups.set(k, [...(groups.get(k) || []), c]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.forEach((c, i) => (c.view = /^view \d+$/i.test(c.view) ? `View ${i + 1}` : `${c.view} ${i + 1}`));
  }
  const out = { generatedAt: new Date().toISOString(), cities, cameras };
  fs.writeFileSync(CAMERAS_FILE, JSON.stringify(out, null, 1));
  log(`saved ${cameras.length} cameras to ${path.relative(config.root, CAMERAS_FILE)}`);
  return out;
}

export function loadCameras() {
  return readJson(CAMERAS_FILE, null);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  discover().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
