import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'arus.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS samples (
    cam    TEXT    NOT NULL,
    city   TEXT    NOT NULL,
    ts     INTEGER NOT NULL,
    status TEXT    NOT NULL,
    idx    REAL, raw REAL, level INTEGER, pcu REAL, stall REAL,
    car INTEGER, moto INTEGER, bus INTEGER, truck INTEGER, parked INTEGER,
    luma   REAL,
    PRIMARY KEY (cam, ts)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS samples_ts ON samples (ts);
  CREATE INDEX IF NOT EXISTS samples_city_ts ON samples (city, ts);
`);

const ins = db.prepare(`INSERT OR REPLACE INTO samples
  (cam, city, ts, status, idx, raw, level, pcu, stall, car, moto, bus, truck, parked, luma)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

export function insertSample(cam, s) {
  const c = s.counts || {};
  ins.run(
    cam.id, cam.city, s.ts, s.status,
    s.idx ?? null, s.raw ?? null, s.level ?? null, s.pcu ?? null, s.stall ?? null,
    c.car ?? null, c.moto ?? null, c.bus ?? null, c.truck ?? null, s.parked ?? null,
    s.luma ?? null,
  );
}

const pcuHist = db.prepare(`SELECT pcu FROM samples WHERE cam = ? AND ts >= ? AND status = 'ok' AND pcu IS NOT NULL ORDER BY pcu`);
/** 90th percentile of a camera's pcu over the last week; null until there is enough history. */
export function busyLevel(camId) {
  const rows = pcuHist.all(camId, Date.now() - 7 * 86_400_000);
  if (rows.length < 24) return null;
  return rows[Math.floor(rows.length * 0.9)].pcu;
}

const camHist = db.prepare(`SELECT ts, idx, level, pcu, stall, car, moto, bus, truck FROM samples
  WHERE cam = ? AND ts >= ? AND status = 'ok' ORDER BY ts`);
export const cameraHistory = (camId, since) => camHist.all(camId, since);

// WIB is UTC+7 for every city Arus reads.
const camHourly = db.prepare(`SELECT ((ts / 3600000) + 7) % 24 AS hour, AVG(idx) AS idx, COUNT(*) AS n
  FROM samples WHERE cam = ? AND ts >= ? AND status = 'ok' GROUP BY hour ORDER BY hour`);
export const cameraHourly = (camId, since) => camHourly.all(camId, since);

const citySeries = db.prepare(`SELECT city, (ts / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS t, AVG(idx) AS idx, SUM(level = 3) AS jammed, COUNT(*) AS n, SUM(car + moto + bus + truck) AS veh
  FROM samples WHERE ts >= ? AND status = 'ok' GROUP BY city, t ORDER BY t`);
export const citySeriesSince = (since, bucketMs = 600_000) => citySeries.all(Math.round(bucketMs), Math.round(bucketMs), Math.round(since));

const del = db.prepare('DELETE FROM samples WHERE ts < ?');
export const prune = () => del.run(Date.now() - config.retentionDays * 86_400_000);

const countAll = db.prepare('SELECT COUNT(*) AS n, MIN(ts) AS first FROM samples');
export const stats = () => countAll.get();
