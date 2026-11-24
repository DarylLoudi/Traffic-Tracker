// Pull two frames ~2 s apart from a live HLS stream with ffmpeg.
// Two frames let us tell a stopped queue from moving traffic.
import { spawn } from 'node:child_process';
import { config } from './config.js';

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** Split concatenated baseline JPEGs (ffmpeg mjpeg output never embeds thumbnails). */
function splitJpegs(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const s = buf.indexOf(SOI, i);
    if (s < 0) break;
    const e = buf.indexOf(EOI, s + 2);
    if (e < 0) break;
    out.push(buf.subarray(s, e + 2));
    i = e + 2;
  }
  return out;
}

export function grabFrames(cam, { gap = config.scan.frameGapSec, timeoutMs = config.scan.grabTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-user_agent', config.userAgent,
      '-rw_timeout', '12000000',
      '-live_start_index', '-1',
      '-i', cam.stream,
      '-an',
      '-vf', `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${gap})',scale='min(960,iw)':-2`,
      '-fps_mode', 'vfr',
      '-frames:v', '2',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4',
      'pipe:1',
    ];
    const ff = spawn(config.ffmpeg, args, { windowsHide: true });
    const chunks = [];
    let err = '';
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      ff.kill('SIGKILL');
      const frames = splitJpegs(Buffer.concat(chunks));
      finish(() => (frames.length ? resolve(frames) : reject(new Error('timeout'))));
    }, timeoutMs);
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => {
      if (err.length < 2000) err += d;
    });
    ff.on('error', (e) => finish(() => reject(e)));
    ff.on('close', () => {
      const frames = splitJpegs(Buffer.concat(chunks));
      finish(() =>
        frames.length ? resolve(frames) : reject(new Error((err.trim().split('\n').pop() || 'no frames').slice(0, 200))),
      );
    });
  });
}
