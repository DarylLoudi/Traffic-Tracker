import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import { config } from './config.js';
import { pool, sleep } from './net.js';
import { grabFrames } from './grab.js';
import { detect } from './detect.js';
import { analyze, DEFAULT_CAP, MIN_CAP } from './analyze.js';
import { insertSample, busyLevel, prune } from './db.js';

const FRAMES = path.join(config.dataDir, 'frames');
const STATE_FILE = path.join(config.dataDir, 'state.json');
fs.mkdirSync(FRAMES, { recursive: true });

function writeAtomic(file, buf) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows refuses to replace a file another reader has open; write in place instead.
    fs.writeFileSync(file, buf);
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Like pool(), but a city never has more than limits[city] cameras in flight.
 * A free slot goes to the next camera whose city has room, so a slow city never holds up the rest.
 */
function schedule(items, n, limits, fn) {
  const queue = [...items];
  const busy = new Map();
  let active = 0;
  return new Promise((resolve) => {
    const next = () => {
      if (!queue.length && !active) return resolve();
      while (active < n && queue.length) {
        const k = queue.findIndex((c) => (busy.get(c.city) || 0) < (limits[c.city] ?? Infinity));
        if (k < 0) break;
        const [cam] = queue.splice(k, 1);
        active++;
        busy.set(cam.city, (busy.get(cam.city) || 0) + 1);
        Promise.resolve()
          .then(() => fn(cam))
          .catch((e) => console.error('[scan]', cam.id, e.message))
          .finally(() => {
            active--;
            busy.set(cam.city, busy.get(cam.city) - 1);
            next();
          });
      }
    };
    next();
  });
}

/** Interleave cameras city by city so every city fills in early in a pass. */
function interleave(cams) {
  const by = new Map();
  for (const c of cams) by.set(c.city, [...(by.get(c.city) || []), c]);
  const lists = [...by.values()];
  const out = [];
  for (let i = 0; out.length < cams.length; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

export class Scanner extends EventEmitter {
  constructor(cameras) {
    super();
    this.cameras = cameras;
    this.byId = new Map(cameras.map((c) => [c.id, c]));
    this.state = new Map();
    this.caps = new Map();
    this.cycle = 0;
    this.running = false;
    this.progress = { done: 0, total: 0 };
    this.lastCycle = null;
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      for (const [id, s] of Object.entries(saved.state || {})) if (this.byId.has(id)) this.state.set(id, s);
      this.cycle = saved.cycle || 0;
      this.lastCycle = saved.lastCycle || null;
    } catch {
      /* first run */
    }
  }

  save() {
    const obj = { cycle: this.cycle, lastCycle: this.lastCycle, state: Object.fromEntries(this.state) };
    writeAtomic(STATE_FILE, JSON.stringify(obj));
  }

  capFor(id) {
    const hit = this.caps.get(id);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.cap;
    const p90 = busyLevel(id);
    const cap = Math.max(MIN_CAP, p90 ?? DEFAULT_CAP);
    this.caps.set(id, { cap, learned: p90 != null, at: Date.now() });
    return cap;
  }

  publicView(cam, s = this.state.get(cam.id)) {
    return {
      id: cam.id,
      city: cam.city,
      name: cam.name,
      view: cam.view,
      area: cam.area,
      lat: +cam.lat.toFixed(6),
      lng: +cam.lng.toFixed(6),
      approx: cam.approx,
      status: s?.status || 'pending',
      ts: s?.ts || null,
      lastOk: s?.lastOk || null,
      idx: s?.status === 'ok' ? s.idx : null,
      level: s?.status === 'ok' ? s.level : null,
      pcu: s?.pcu ?? null,
      stall: s?.stall ?? null,
      counts: s?.counts || null,
      parked: s?.parked ?? 0,
      dark: !!s?.dark,
      motion: s?.motion || null,
      frameV: s?.frameV || null,
      boxes: s?.status === 'ok' || s?.status === 'blind' ? s.boxes || [] : null,
    };
  }

  async scanOne(cam) {
    const prev = this.state.get(cam.id);
    const t0 = Date.now();
    let s;
    try {
      const frames = await grabFrames(cam);
      const last = frames[frames.length - 1];
      const { dets, ms } = await detect(last);
      const cap = this.capFor(cam.id);
      const r = await analyze(frames, dets, prev, cap);
      const ts = Date.now();
      writeAtomic(path.join(FRAMES, `${cam.id}.jpg`), last);
      const thumb = await sharp(last).resize({ width: 400, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
      writeAtomic(path.join(FRAMES, `${cam.id}.t.jpg`), thumb);
      s = { ...r, ts, lastOk: ts, frameV: ts, fails: 0, cap, learned: this.caps.get(cam.id)?.learned, scanMs: ts - t0, detectMs: Math.round(ms) };
      if (r.status !== 'ok') Object.assign(s, { idx: null, level: null });
    } catch (e) {
      s = {
        status: 'offline',
        ts: Date.now(),
        lastOk: prev?.lastOk || null,
        frameV: prev?.frameV || null,
        fails: (prev?.fails || 0) + 1,
        error: String(e.message || e).slice(0, 160),
        still: prev?.still || [],
        raws: prev?.raws || [],
      };
    }
    this.state.set(cam.id, s);
    try {
      insertSample(cam, s);
    } catch (e) {
      console.error('db insert', e.message);
    }
    this.progress.done++;
    if (this.progress.done % 40 === 0) this.save();
    this.emit('camera', { cam: this.publicView(cam, s), scan: { ...this.progress, cycle: this.cycle } });
  }

  async runCycle() {
    this.cycle++;
    const startedAt = Date.now();
    const due = interleave(this.cameras).filter((c) => {
      const s = this.state.get(c.id);
      // Cameras that keep failing are retried every 4th pass instead of every pass.
      return !(s && s.fails >= config.scan.backoffAfterFailures && this.cycle % 4 !== 0);
    });
    this.progress = { done: 0, total: due.length };
    this.running = true;
    this.emit('cycle-start', { cycle: this.cycle, total: due.length, startedAt });
    await schedule(due, config.scan.grabConcurrency, this.limits || {}, (cam) => this.scanOne(cam));
    this.running = false;
    const endedAt = Date.now();
    const ok = due.filter((c) => this.state.get(c.id)?.status === 'ok').length;
    this.lastCycle = { cycle: this.cycle, startedAt, endedAt, ms: endedAt - startedAt, scanned: due.length, ok };
    this.save();
    if (this.cycle % 20 === 0) prune();
    this.emit('cycle', this.lastCycle);
    return this.lastCycle;
  }

  async loop() {
    if (this.looping) return;
    this.looping = true;
    while (this.looping) {
      const started = Date.now();
      try {
        const r = await this.runCycle();
        console.log(`[scan] pass ${r.cycle}: ${r.ok}/${r.scanned} cameras ok in ${(r.ms / 1000).toFixed(0)} s`);
      } catch (e) {
        console.error('[scan] pass failed', e);
      }
      const wait = Math.max(5_000, config.scan.minCycleMs - (Date.now() - started));
      this.nextAt = Date.now() + wait;
      await sleep(wait);
    }
  }
}
