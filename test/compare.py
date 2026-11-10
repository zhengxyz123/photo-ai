# SPDX-License-Identifier: Apache-2.0
"""Compare the wasm outputs with the native demo outputs.

Run from the project root:  .venv/bin/python test/compare.py
"""
import numpy as np
from PIL import Image

T = 'build/test'
w, h = [int(v) for v in open(f'{T}/meta.txt').read().split()]

ref_mask = np.fromfile(f'{T}/ref_sam_mask.u8', np.uint8).reshape(h, w) > 0
wasm_mask = np.fromfile(f'{T}/wasm_sam_mask.u8', np.uint8).reshape(h, w) > 0
inter = np.logical_and(ref_mask, wasm_mask).sum()
union = np.logical_or(ref_mask, wasm_mask).sum()
print(f'SAM mask   IoU {inter/union:.6f}  disagree {100*(1-inter/union):.4f}%  '
      f'coverage ref {100*ref_mask.mean():.3f}% wasm {100*wasm_mask.mean():.3f}%')

ref = np.fromfile(f'{T}/ref_lama_full.rgb', np.uint8).reshape(h, w, 3).astype(np.float32)
wasm = np.fromfile(f'{T}/wasm_fill_full.rgb', np.uint8).reshape(h, w, 3).astype(np.float32)
ell = np.fromfile(f'{T}/ref_ellipse_mask.u8', np.uint8).reshape(h, w) > 0
diff = np.abs(ref - wasm)
print(f'LaMa full  max abs {diff.max():.0f}/255  mean abs {diff.mean():.4f}  '
      f'max inside mask {diff[ell].max():.0f}  mean inside mask {diff[ell].mean():.4f}')
changed = (np.abs(ref - np.fromfile(f'{T}/example.rgb', np.uint8)
                  .reshape(h, w, 3).astype(np.float32)) > 0).any(axis=2)
print(f'           pixels touched by the native fill: {100*changed.mean():.2f}%')

for name in ('wasm_fill_crop', 'wasm_fill_crop_ellipse'):
    a = np.fromfile(f'{T}/{name}.rgb', np.uint8).reshape(h, w, 3)
    Image.fromarray(a).save(f'{T}/{name}.png')

Image.fromarray((wasm_mask * 255).astype(np.uint8)).save(f'{T}/wasm_sam_mask.png')
print('\nwrote', f'{T}/wasm_fill_crop.png', 'and', f'{T}/wasm_fill_crop_ellipse.png')
