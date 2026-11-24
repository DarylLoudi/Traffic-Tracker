// Builds the landing page's worked example from one real reading:
// public/assets/demo/a.jpg, b.jpg (two frames, 2 s apart) and demo.json.
// Run while the server is up:  node scripts/make-demo.js [camera-id]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../server/config.js';
import { loadCameras } from '../server/discover.js';
import { grabFrames } from '../server/grab.js';
import { detect } from '../server/detect.js';
import { analyze, levelOf } from '../server/analyze.js';

const out = path.join(config.publicDir, 'assets', 'demo');
fs.mkdirSync(out, { recursive: true });
const { cameras } = loadCameras();
const base = `http://${config.host}:${config.port}`;
let ids = process.argv.slice(2);
if (!ids.length) {
  const state = await (await fetch(`${base}/api/state`)).json();
  const veh = (c) => c.counts.car + c.counts.moto + c.counts.bus + c.counts.truck;
  ids = state.cameras
    .filter((c) => c.status === 'ok' && !c.dark && c.stall != null && c.stall > 0.35 && c.stall < 0.8 && veh(c) >= 20)
    .sort((a, b) => veh(b) - veh(a))
    .slice(0, 8)
    .map((c) => c.id);
}
for (const id of ids) {
  const cam = cameras.find((c) => c.id === id);
  if (!cam) continue;
  try {
    const frames = await grabFrames(cam);
    if (frames.length < 2) continue;
    const { dets, ms } = await detect(frames[1]);
    let cap = 16;
    try {
      cap = (await (await fetch(`${base}/api/camera/${id}`)).json()).cap || 16;
    } catch {}
    const r = await analyze(frames, dets, null, cap);
    const n = r.counts.car + r.counts.moto + r.counts.bus + r.counts.truck;
    console.log(id, cam.name, 'vehicles', n, 'stall', r.stall, 'raw', r.raw, 'sharp', r.sharp);
    if (r.status !== 'ok' || r.stall == null || n < 15 || r.stall < 0.25 || r.stall > 0.9) continue;
    const meta = await sharp(frames[1]).metadata();
    await sharp(frames[0]).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(out, 'a.jpg'));
    await sharp(frames[1]).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(out, 'b.jpg'));
    const demo = {
      id, name: cam.name, view: cam.view, city: cam.city, operator: cam.operator, ts: Date.now(),
      width: meta.width, height: meta.height, detectMs: Math.round(ms), cap: +cap.toFixed(1),
      counts: r.counts, pcu: r.pcu, stall: r.stall, crowd: r.crowd, idx: r.raw, level: levelOf(r.raw), boxes: r.boxes,
    };
    fs.writeFileSync(path.join(out, 'demo.json'), JSON.stringify(demo));
    console.log('saved demo from', id);
    process.exit(0);
  } catch (e) {
    console.log(id, 'failed:', e.message);
  }
}
console.error('no suitable camera found');
process.exit(1);
