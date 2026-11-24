// Downloads the vehicle detector: D-FINE-S trained on COCO (Apache-2.0),
// ONNX export from the onnx-community on Hugging Face.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'models', 'dfine_s_coco.onnx');
const url = 'https://huggingface.co/onnx-community/dfine_s_coco-ONNX/resolve/main/onnx/model.onnx';

if (fs.existsSync(dest) && fs.statSync(dest).size > 1e7) {
  console.log('model already present:', path.relative(root, dest));
  process.exit(0);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
console.log('downloading', url);
const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
fs.writeFileSync(dest + '.part', Buffer.from(await res.arrayBuffer()));
fs.renameSync(dest + '.part', dest);
console.log('saved', path.relative(root, dest), (fs.statSync(dest).size / 1e6).toFixed(1), 'MB');
