import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { discover, loadCameras } from './discover.js';
import { loadModel } from './detect.js';
import { Scanner } from './scanner.js';
import { cameraHistory, cameraHourly, citySeriesSince, stats } from './db.js';
import { LEVELS, PCU } from './analyze.js';
import { get } from './net.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// cameras
let registry = loadCameras();
if (!registry || !registry.cameras?.length) {
  log('no camera list yet, discovering sources...');
  registry = await discover({ log });
}
const scanner = new Scanner(registry.cameras);
const camById = () => scanner.byId;
// Some operators turn away bursts, so their cameras are read a few at a time.
const applyLimits = () => (scanner.limits = Object.fromEntries(registry.cities.map((c) => [c.city, c.concurrency || Infinity])));
applyLimits();

// Refresh the camera list once a day; new cameras join the next pass.
setInterval(async () => {
  try {
    registry = await discover({ log: () => {} });
    scanner.cameras = registry.cameras;
    scanner.byId = new Map(registry.cameras.map((c) => [c.id, c]));
    applyLimits();
    buildSecurity();
    log(`camera list refreshed: ${registry.cameras.length}`);
  } catch (e) {
    log('camera refresh failed', e.message);
  }
}, 24 * 3600_000).unref();

// live updates (server-sent events)
const clients = new Set();
const MAX_SSE = 200;
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
scanner.on('camera', (d) => broadcast('camera', d));
scanner.on('cycle-start', (d) => broadcast('cycle-start', d));
scanner.on('cycle', (d) => broadcast('cycle', { ...d, nextAt: Date.now() + Math.max(5_000, config.scan.minCycleMs - d.ms) }));
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000).unref();

// view models
function citySummaries() {
  const cams = [...scanner.byId.values()].map((c) => scanner.publicView(c));
  return registry.cities.map((meta) => {
    const list = cams.filter((c) => c.city === meta.city);
    const live = list.filter((c) => c.status === 'ok');
    const levels = [0, 0, 0, 0];
    for (const c of live) levels[c.level]++;
    const vehicles = live.reduce((a, c) => a + (c.counts ? c.counts.car + c.counts.moto + c.counts.bus + c.counts.truck : 0), 0);
    // City index: mean of live cameras, nudged up by its worst quarter so one gridlocked junction shows.
    const sorted = live.map((c) => c.idx).sort((a, b) => b - a);
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
    const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
    const topMean = top.length ? top.reduce((a, b) => a + b, 0) / top.length : null;
    return {
      city: meta.city,
      label: meta.label,
      operator: meta.operator,
      page: meta.page,
      center: meta.center,
      cameras: list.length,
      live: live.length,
      offline: list.filter((c) => c.status === 'offline').length,
      unreadable: list.filter((c) => c.status === 'blind' || c.status === 'frozen').length,
      levels,
      vehicles,
      idx: mean == null ? null : +(0.6 * mean + 0.4 * topMean).toFixed(1),
    };
  });
}

function scanInfo() {
  return {
    cycle: scanner.cycle,
    running: scanner.running,
    progress: scanner.progress,
    last: scanner.lastCycle,
    nextAt: scanner.nextAt || null,
    minCycleMs: config.scan.minCycleMs,
  };
}

// Streams without CORS play through the relay, addressed relative to the camera's relay folder.
const relayBase = (cam) => cam.relayBase || cam.stream.slice(0, cam.stream.split('?')[0].lastIndexOf('/') + 1);
const streamUrl = (cam) => (cam.cors ? cam.stream : `/hls/${encodeURIComponent(cam.id)}/${cam.stream.split('?')[0].slice(relayBase(cam).length)}`);

function cameraDetail(cam) {
  const s = scanner.state.get(cam.id) || {};
  const since = Date.now() - 24 * 3600_000;
  return {
    ...scanner.publicView(cam),
    operator: cam.operator,
    source: registry.cities.find((c) => c.city === cam.city)?.page,
    live: streamUrl(cam),
    boxes: s.boxes || [],
    sharp: s.sharp ?? null,
    luma: s.luma ?? null,
    cap: s.cap ?? null,
    learned: !!s.learned,
    crowd: s.crowd ?? null,
    raw: s.raw ?? null,
    detectMs: s.detectMs ?? null,
    error: s.status === 'offline' ? s.error : null,
    history: cameraHistory(cam.id, since),
    hourly: cameraHourly(cam.id, Date.now() - 7 * 86_400_000),
  };
}

// http helpers
const MAP_HOSTS = ['https://basemaps.cartocdn.com', 'https://tiles.basemaps.cartocdn.com', ...'abcd'.split('').map((x) => `https://tiles-${x}.basemaps.cartocdn.com`)];

/** The browser may reach the map tiles, and only those stream hosts that allow it directly. */
function cspFor(cameras) {
  const streams = new Set(cameras.filter((c) => c.cors).map((c) => new URL(c.stream).origin));
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    // Jakarta's playlists hand segments over to Bali Tower's media host.
    `connect-src 'self' ${[...MAP_HOSTS, 'https://dki-jkt.balitower.co.id:7028', ...streams].join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

const SECURITY = {
  'content-security-policy': '',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
function buildSecurity() {
  SECURITY['content-security-policy'] = cspFor(registry.cameras);
}
buildSecurity();

function send(res, code, body, headers = {}) {
  res.writeHead(code, { ...SECURITY, ...headers });
  res.end(body);
}
const json = (res, obj, code = 200) =>
  send(res, code, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveFile(res, file, cache = 'no-cache') {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    res.writeHead(200, {
      ...SECURITY,
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': cache,
      'last-modified': st.mtime.toUTCString(),
    });
    fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/live' || rel === '/live/') rel = '/live.html';
  const file = path.normalize(path.join(config.publicDir, rel));
  if (!file.startsWith(config.publicDir + path.sep)) return send(res, 400, 'Bad path');
  const cache = rel.startsWith('/vendor/') ? 'public, max-age=604800, immutable' : 'no-cache';
  serveFile(res, file, cache);
}

// HLS relay for streams without CORS
// Only for cameras in our list, only below that camera's own stream folder,
// only playlist and media file types. Not a general proxy.
const HLS_EXT = /\.(m3u8|ts|m4s|mp4|aac|m4a|vtt)$/i;
const HLS_MIME = { m3u8: 'application/vnd.apple.mpegurl', ts: 'video/mp2t', m4s: 'video/iso.segment', mp4: 'video/mp4', aac: 'audio/aac', m4a: 'audio/mp4', vtt: 'text/vtt' };
let relayInflight = 0;
async function hlsRelay(req, res, id, rest, search) {
  const cam = camById().get(id);
  if (!cam || cam.cors) return send(res, 404, 'Not found');
  if (!/^[A-Za-z0-9._\-/]{1,200}$/.test(rest) || rest.includes('..') || rest.startsWith('/') || !HLS_EXT.test(rest)) {
    return send(res, 400, 'Bad path');
  }
  if (search && !/^\?[A-Za-z0-9=&_.\-%]{0,300}$/.test(search)) return send(res, 400, 'Bad query');
  if (relayInflight > 40) return send(res, 503, 'Busy', { 'retry-after': '2' });
  const base = relayBase(cam);
  const prefix = `/hls/${encodeURIComponent(cam.id)}/`;
  const target = new URL(rest + (search || ''), base);
  if (!target.href.startsWith(base)) return send(res, 400, 'Bad path');
  relayInflight++;
  try {
    const up = await get(target.href, { timeoutMs: 15_000 });
    const ext = rest.split('.').pop().toLowerCase();
    res.writeHead(200, {
      ...SECURITY,
      'content-type': HLS_MIME[ext],
      'cache-control': ext === 'm3u8' ? 'no-store' : 'public, max-age=30',
    });
    if (ext === 'm3u8') {
      // Every URL in the playlist is resolved against the upstream playlist and pointed
      // back at the relay when it stays inside the camera's relay folder; anything else is dropped.
      const text = await up.text();
      const local = (u) => {
        try {
          const abs = new URL(u, target).href;
          return abs.startsWith(base) ? prefix + abs.slice(base.length) : null;
        } catch {
          return null;
        }
      };
      const out = text
        .split('\n')
        .map((line) => {
          const l = line.trim();
          if (!l) return line;
          if (l.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (m, u) => `URI="${local(u) || ''}"`);
          return local(l) || '#';
        })
        .join('\n');
      res.end(out);
    } else {
      Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
    }
  } catch (e) {
    if (!res.headersSent) send(res, 502, 'Upstream error');
    else res.destroy();
  } finally {
    relayInflight--;
  }
}

// router
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;

    if (p === '/api/state') {
      return json(res, {
        now: Date.now(),
        scan: scanInfo(),
        thresholds: LEVELS,
        pcu: PCU,
        cities: citySummaries(),
        cameras: [...scanner.byId.values()].map((c) => scanner.publicView(c)),
      });
    }
    if (p === '/api/history') {
      const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours')) || 24));
      const since = Date.now() - hours * 3600_000;
      // Bucket size follows the history that actually exists, so a young database still draws a line.
      const span = Date.now() - Math.max(since, stats().first || Date.now());
      const bucket = span > 48 * 3600_000 ? 3600_000 : span > 12 * 3600_000 ? 900_000 : span > 3 * 3600_000 ? 300_000 : 150_000;
      return json(res, { bucket, since, rows: citySeriesSince(since, bucket) });
    }
    let m = p.match(/^\/api\/camera\/([a-z0-9-]{1,80})$/);
    if (m) {
      const cam = camById().get(m[1]);
      return cam ? json(res, cameraDetail(cam)) : json(res, { error: 'Camera not found' }, 404);
    }
    if (p === '/api/summary') {
      // Small payload for the landing page: totals, cities with their worst camera, and a few cameras to show.
      const cams = [...scanner.byId.values()].map((c) => scanner.publicView(c));
      const ok = cams.filter((c) => c.status === 'ok');
      const veh = (c) => c.counts.car + c.counts.moto + c.counts.bus + c.counts.truck;
      const byIdx = [...ok].sort((a, b) => b.idx - a.idx);
      const slim = ({ boxes, ...c }) => c;
      const cities = citySummaries().map((c) => ({ ...c, worst: slim(byIdx.find((x) => x.city === c.city) || {}) }));
      return json(res, {
        now: Date.now(),
        scan: scanInfo(),
        totals: { cameras: cams.length, readable: ok.length, vehicles: ok.reduce((a, c) => a + veh(c), 0), jammed: ok.filter((c) => c.level === 3).length },
        cities,
        worst: byIdx.slice(0, 12).map(slim),
        wall: [...ok].filter((c) => !c.dark).sort((a, b) => veh(b) - veh(a)).slice(0, 28),
      });
    }
    if (p === '/api/cameras') {
      // Just enough to search by: names, places and the current reading.
      const cams = [...scanner.byId.values()].map((c) => {
        const v = scanner.publicView(c);
        return { id: v.id, city: v.city, name: v.name, view: v.view, area: v.area, status: v.status, level: v.level, idx: v.idx };
      });
      const cities = citySummaries().map(({ city, label, cameras }) => ({ city, label, cameras }));
      return json(res, { cities, cams });
    }
    if (p === '/api/health') return json(res, { ok: true, cameras: scanner.byId.size, scan: scanInfo(), db: stats() });
    if (p === '/api/events') {
      if (clients.size >= MAX_SSE) return send(res, 503, 'Too many listeners');
      res.writeHead(200, {
        ...SECURITY,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify(scanInfo())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    m = p.match(/^\/frames\/([a-z0-9-]{1,80})(\.t)?\.jpg$/);
    if (m) {
      if (!camById().has(m[1])) return send(res, 404, 'Not found');
      return serveFile(res, path.join(config.dataDir, 'frames', `${m[1]}${m[2] || ''}.jpg`), 'public, max-age=20');
    }
    m = p.match(/^\/hls\/([a-z0-9-]{1,80})\/(.+)$/);
    if (m) return hlsRelay(req, res, m[1], m[2], url.search);
    if (p.startsWith('/api/')) return json(res, { error: 'Not found' }, 404);
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Server error');
  }
});

server.listen(config.port, config.host, () => log(`Arus on http://${config.host}:${config.port}  (${scanner.byId.size} cameras)`));

if (config.scan.enabled) {
  loadModel()
    .then(() => {
      log('model loaded, starting scan loop');
      scanner.loop();
    })
    .catch((e) => log('scanner disabled:', e.message));
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    scanner.looping = false;
    try {
      scanner.save();
    } catch {}
    process.exit(0);
  });
}
