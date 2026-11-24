// Vehicle detection with D-FINE-S (COCO, Apache-2.0) on onnxruntime CPU.
// D-FINE is DETR-style: 300 queries, sigmoid class scores, no anchor NMS needed.
import fs from 'node:fs';
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { config } from './config.js';

const SIZE = 640;
// COCO contiguous ids used by the model head -> our classes.
const COCO = { 2: 'car', 3: 'moto', 5: 'bus', 7: 'truck' };
const MIN_SCORE = { car: 0.4, moto: 0.35, bus: 0.5, truck: 0.5 };

let session = null;
let chain = Promise.resolve();

export async function loadModel() {
  if (session) return session;
  if (!fs.existsSync(config.modelPath)) {
    throw new Error(`Model not found at ${config.modelPath}. Run: npm run model`);
  }
  session = await ort.InferenceSession.create(config.modelPath, {
    intraOpNumThreads: config.scan.detectThreads,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
  });
  return session;
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};
export { iou };

async function run(jpeg) {
  const s = await loadModel();
  const raw = await sharp(jpeg).resize(SIZE, SIZE, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = raw[i * 3] / 255;
    input[i + plane] = raw[i * 3 + 1] / 255;
    input[i + 2 * plane] = raw[i * 3 + 2] / 255;
  }
  const t0 = performance.now();
  const out = await s.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const ms = performance.now() - t0;
  const logits = out.logits.data;
  const boxes = out.pred_boxes.data;
  const nq = out.logits.dims[1];
  const nc = out.logits.dims[2];
  let dets = [];
  for (let q = 0; q < nq; q++) {
    let best = -Infinity;
    let bc = -1;
    for (let c = 0; c < nc; c++) {
      const v = logits[q * nc + c];
      if (v > best) {
        best = v;
        bc = c;
      }
    }
    let cls = COCO[bc];
    if (!cls) continue;
    const score = 1 / (1 + Math.exp(-best));
    // Unsure bus/truck calls are usually vans and MPVs: keep them as cars.
    if ((cls === 'bus' || cls === 'truck') && score < MIN_SCORE[cls]) cls = 'car';
    if (score < MIN_SCORE[cls]) continue;
    const cx = boxes[q * 4];
    const cy = boxes[q * 4 + 1];
    const w = boxes[q * 4 + 2];
    const h = boxes[q * 4 + 3];
    if (w * h < 0.00012 || w * h > 0.6) continue; // specks and frame-filling glitches
    dets.push({ cls, score, x: cx - w / 2, y: cy - h / 2, w, h });
  }
  // Class-agnostic suppression of duplicate queries on one vehicle.
  dets.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const d of dets) if (!kept.some((k) => iou(k, d) > 0.7)) kept.push(d);
  dets = kept;
  return { dets, ms };
}

/** Detections are serialised: one inference at a time keeps the CPU predictable. */
export function detect(jpeg) {
  const p = chain.then(() => run(jpeg));
  chain = p.catch(() => {});
  return p;
}
