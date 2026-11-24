// Turns detections + two frames into a congestion reading.
//
//   pcu    passenger-car units on screen (motorcycle 0.4, car 1, bus/truck 1.3),
//          weights in the spirit of Indonesia's road-capacity manual (MKJI/PKJI)
//   stall  share of that pcu that did not move between the two frames
//   crowd  pcu against this camera's own busy level (90th percentile of its history)
//   index  100 * crowd * (0.35 + 0.65 * stall), median of the last three passes
//
// So a full road that keeps moving reads "busy" (~35), and only a full road
// that has stopped reads "jammed". Vehicles that stay put for 3+ scans are
// treated as parked and left out.
import sharp from 'sharp';
import { iou } from './detect.js';

export const PCU = { moto: 0.4, car: 1, bus: 1.3, truck: 1.3 };
export const LEVELS = [25, 50, 72]; // clear < 25 <= busy < 50 <= heavy < 72 <= jammed
export const DEFAULT_CAP = 16;
export const MIN_CAP = 8;
const GW = 256;
const GH = 144;

export const levelOf = (idx) => (idx == null ? null : idx < LEVELS[0] ? 0 : idx < LEVELS[1] ? 1 : idx < LEVELS[2] ? 2 : 3);

const gray = (jpeg) => sharp(jpeg).resize(GW, GH, { fit: 'fill' }).grayscale().raw().toBuffer();

function boxDiff(a, b, d) {
  // Shrink the box a little so edges and shadows matter less.
  const sx = d.w * 0.15;
  const sy = d.h * 0.15;
  const x0 = Math.max(0, Math.floor((d.x + sx) * GW));
  const y0 = Math.max(0, Math.floor((d.y + sy) * GH));
  const x1 = Math.min(GW, Math.ceil((d.x + d.w - sx) * GW));
  const y1 = Math.min(GH, Math.ceil((d.y + d.h - sy) * GH));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * GW + x;
      sum += Math.abs(a[i] - b[i]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * @param {Buffer[]} frames  [A, B] or [B]
 * @param {object[]} dets    detections on the last frame (normalised boxes)
 * @param {object}   prev    previous state for this camera (smoothing, parked tracking, frozen check)
 * @param {number}   cap     this camera's busy level in pcu
 */
export async function analyze(frames, dets, prev, cap) {
  const B = await gray(frames[frames.length - 1]);
  const A = frames.length > 1 ? await gray(frames[0]) : null;

  let luma = 0;
  for (let i = 0; i < B.length; i++) luma += B[i];
  luma /= B.length;

  // Sharpness: mean absolute Laplacian. Fogged, wet or dirty lenses sit around 4-12,
  // readable road views around 18-50. Below the line we say so instead of reading "clear".
  let lap = 0;
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x;
      lap += Math.abs(4 * B[i] - B[i - 1] - B[i + 1] - B[i - GW] - B[i + GW]);
    }
  }
  lap /= (GW - 2) * (GH - 2);
  const blind = lap < 13 && dets.length <= 2;

  let globalDiff = null;
  let noise = 0;
  if (A) {
    const hist = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < B.length; i++) {
      const v = Math.abs(A[i] - B[i]);
      hist[v]++;
      sum += v;
    }
    globalDiff = sum / B.length;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= B.length / 2) {
        noise = v;
        break;
      }
    }
  }

  // Cheap fingerprint of frame B to spot a stream stuck on one picture.
  let fp = 0;
  for (let i = 0; i < B.length; i += 97) fp = (fp * 31 + (B[i] >> 3)) >>> 0;
  const frozen = (globalDiff !== null && globalDiff < 0.15) || (prev?.fp === fp && prev?.status === 'ok');

  const cameraMoved = globalDiff !== null && globalDiff > 32; // PTZ swing or scene cut
  const motionKnown = A && !cameraMoved && !frozen;
  const moveThresh = Math.max(7, noise * 3 + 5);

  const prevStill = prev?.still || [];
  const still = [];
  const boxes = [];
  const counts = { car: 0, moto: 0, bus: 0, truck: 0 };
  let parked = 0;
  let pcu = 0;
  let stoppedPcu = 0;

  for (const d of dets) {
    let moving = null;
    let age = 0;
    if (motionKnown) {
      moving = boxDiff(A, B, d) > moveThresh;
      if (!moving) {
        const match = prevStill.find((p) => iou(p, d) > 0.6);
        age = match ? match.age + 1 : 1;
        still.push({ x: d.x, y: d.y, w: d.w, h: d.h, age });
      }
    }
    const isParked = age >= 3;
    // flags: 1 = stopped, 2 = parked
    boxes.push([+d.x.toFixed(4), +d.y.toFixed(4), +d.w.toFixed(4), +d.h.toFixed(4), d.cls, (moving === false ? 1 : 0) | (isParked ? 2 : 0)]);
    if (isParked) {
      parked++;
      continue;
    }
    counts[d.cls]++;
    pcu += PCU[d.cls];
    if (moving === false) stoppedPcu += PCU[d.cls];
  }

  const stall = motionKnown && pcu > 0 ? stoppedPcu / pcu : null;
  const crowd = Math.min(1, pcu / Math.max(MIN_CAP, cap || DEFAULT_CAP));
  const stallUsed = stall ?? (prev?.stall ?? 0.3);
  const raw = 100 * crowd * (0.35 + 0.65 * stallUsed);
  // Middle value of the last three passes (within 12 minutes). One red light
  // stops a queue for one pass; a real jam stays stopped pass after pass.
  const now = Date.now();
  const raws = [...(prev?.raws || []).filter((r) => now - r.t < 12 * 60_000), { t: now, v: raw }].slice(-3);
  const vals = raws.map((r) => r.v).sort((a, b) => a - b);
  const idx = vals.length === 3 ? vals[1] : vals.reduce((a, b) => a + b, 0) / vals.length;

  return {
    status: frozen ? 'frozen' : blind ? 'blind' : 'ok',
    idx: +idx.toFixed(1),
    raw: +raw.toFixed(1),
    level: levelOf(idx),
    pcu: +pcu.toFixed(2),
    stall: stall == null ? null : +stall.toFixed(3),
    crowd: +crowd.toFixed(3),
    counts,
    parked,
    luma: +luma.toFixed(1),
    sharp: +lap.toFixed(1),
    dark: luma < 38,
    motion: motionKnown ? 'ok' : cameraMoved ? 'camera-moved' : A ? 'frozen' : 'single-frame',
    boxes,
    still,
    fp,
    raws: raws.map((r) => ({ t: r.t, v: +r.v.toFixed(1) })),
  };
}
