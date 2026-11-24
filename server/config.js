import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);

export const config = {
  root,
  host: process.env.ARUS_HOST || '127.0.0.1',
  port: num(process.env.ARUS_PORT, 9985),
  dataDir: path.join(root, 'data'),
  publicDir: path.join(root, 'public'),
  modelPath: process.env.ARUS_MODEL || path.join(root, 'models', 'dfine_s_coco.onnx'),
  ffmpeg: process.env.FFMPEG || 'ffmpeg',

  // Sent to camera sites and to Nominatim. Set ARUS_USER_AGENT to name your own deployment.
  userAgent: process.env.ARUS_USER_AGENT || 'Mozilla/5.0 (compatible; Arus/0.1)',

  scan: {
    enabled: process.env.ARUS_SCAN !== '0',
    minCycleMs: num(process.env.ARUS_CYCLE_MS, 150_000), // a full pass never starts sooner than this
    grabConcurrency: num(process.env.ARUS_GRAB_CONCURRENCY, 8),
    grabTimeoutMs: 22_000,
    frameGapSec: 2, // seconds between the two frames used to tell moving from stopped
    detectThreads: num(process.env.ARUS_THREADS, 4),
    backoffAfterFailures: 3, // offline cameras are retried less often after this many misses
  },

  retentionDays: 14,
};
