// SPDX-License-Identifier: Apache-2.0
// End-to-end check of the wasm core against the native demos' outputs.
//
//   1. MobileSAM point prompt (545,300) -> compared with test/data/sam_mask_ref.png
//   2. LaMa full-image path on the demo's ellipse mask -> compared with
//      test/data/lama_full_ref.png
//   3. LaMa crop path on the SAM mask -> saved for a visual check
//
// Run from the project root:  node test/parity.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createPhotoAI from '../build/test/photo_ai.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const T = path.join(ROOT, 'build', 'test');

const t0 = Date.now();
const Module = await createPhotoAI();
const ms = () => Date.now() - t0;

function loadModel(file) {
  const bytes = fs.readFileSync(file);
  const ptr = Module._malloc(bytes.length);
  Module.HEAPU8.set(bytes, ptr);
  return { ptr, len: bytes.length };
}
function bytesToHeap(bytes) {
  const ptr = Module._malloc(bytes.length);
  Module.HEAPU8.set(bytes, ptr);
  return ptr;
}
function readMask(file) {
  const b = fs.readFileSync(path.join(T, file));
  const ptr = Module._malloc(b.length);
  Module.HEAPU8.set(b, ptr);
  return { ptr, len: b.length };
}

// ---------------------------------------------------------------- image
const rgb = fs.readFileSync(path.join(T, 'example.rgb'));
const [IW, IH] = fs.readFileSync(path.join(T, 'meta.txt'), 'utf8').trim().split(/\s+/).map(Number);
console.log('[image]', IW, 'x', IH, '| rgb bytes', rgb.length, '| expected', IW * IH * 3);
let p = bytesToHeap(rgb);
if (Module._pa_set_image(p, IW, IH) !== 0) throw new Error('pa_set_image failed');
Module._free(p);

// ---------------------------------------------------------------- models
console.log('[load] SAM encoder + decoder');
let t = Date.now();
const enc = loadModel(path.join(ROOT, 'public/models/sam_encoder.mnn'));
const dec = loadModel(path.join(ROOT, 'public/models/sam_decoder.mnn'));
if (Module._pa_load_sam(enc.ptr, enc.len, dec.ptr, dec.len) !== 0) throw new Error('pa_load_sam');
Module._free(enc.ptr);
Module._free(dec.ptr);
console.log('[load] SAM ready in', Date.now() - t, 'ms');

// ---------------------------------------------------------------- encode
t = Date.now();
if (Module._pa_encode() !== 0) throw new Error('pa_encode failed');
console.log('[encode]', Date.now() - t, 'ms');

// ---------------------------------------------------------------- segment
const pts = new Float32Array([545, 300]);
p = bytesToHeap(new Uint8Array(pts.buffer));
t = Date.now();
if (Module._pa_segment(p, 1, 0, 0, 0, -1) !== 0) throw new Error('pa_segment failed');
const decodeMs = Date.now() - t;
Module._free(p);
const ious = [0, 1, 2, 3].map((i) => Module._pa_iou(i));
const area = Module._pa_mask_area();
console.log('[segment]', decodeMs, 'ms | token', Module._pa_best_token(),
  '| iou', ious.map((v) => v.toFixed(4)).join(' '),
  '| area', area, (100 * area / (IW * IH)).toFixed(2) + '%');

let mp = Module._pa_mask_ptr();
fs.writeFileSync(path.join(T, 'wasm_sam_mask.u8'),
  Buffer.from(Module.HEAPU8.subarray(mp, mp + IW * IH)));

// ---------------------------------------------------------------- lama
console.log('[load] LaMa 512');
t = Date.now();
const lama = loadModel(path.join(ROOT, 'public/models/lama.mnn'));
if (Module._pa_load_lama(lama.ptr, lama.len) !== 0) throw new Error('pa_load_lama failed');
Module._free(lama.ptr);
console.log('[load] LaMa ready in', Date.now() - t, 'ms');

// 2) full-image path on the native demo's ellipse mask
const ell = readMask('ref_ellipse_mask.u8');
if (Module._pa_set_mask(ell.ptr) !== 0) throw new Error('pa_set_mask failed');
Module._free(ell.ptr);
t = Date.now();
{ const _rc = Module._pa_fill(0, 0, 1); console.log("[fill full] rc", _rc); if (_rc !== 0) throw new Error("pa_fill (full) failed"); }
console.log('[fill full]', Date.now() - t, 'ms');
let rp = Module._pa_result_ptr();
fs.writeFileSync(path.join(T, 'wasm_fill_full.rgb'),
  Buffer.from(Module.HEAPU8.subarray(rp, rp + IW * IH * 3)));

// 3) crop path on the SAM mask
const sam = readMask('wasm_sam_mask.u8');
if (Module._pa_set_mask(sam.ptr) !== 0) throw new Error('pa_set_mask failed');
Module._free(sam.ptr);
t = Date.now();
if (Module._pa_fill(10, 0, 0) !== 0) throw new Error('pa_fill (crop) failed');
console.log('[fill crop]', Date.now() - t, 'ms');
rp = Module._pa_result_ptr();
fs.writeFileSync(path.join(T, 'wasm_fill_crop.rgb'),
  Buffer.from(Module.HEAPU8.subarray(rp, rp + IW * IH * 3)));

// 4) crop path with the ellipse too, for a second visual
const ell2 = readMask('ref_ellipse_mask.u8');
Module._pa_set_mask(ell2.ptr);
Module._free(ell2.ptr);
t = Date.now();
if (Module._pa_fill(4, 2, 0) !== 0) throw new Error('pa_fill (crop/feather) failed');
console.log('[fill crop+feather]', Date.now() - t, 'ms');
rp = Module._pa_result_ptr();
fs.writeFileSync(path.join(T, 'wasm_fill_crop_ellipse.rgb'),
  Buffer.from(Module.HEAPU8.subarray(rp, rp + IW * IH * 3)));

console.log('[done] total', ms(), 'ms');
