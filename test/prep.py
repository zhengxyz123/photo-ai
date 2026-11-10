# SPDX-License-Identifier: Apache-2.0
"""Prepare raw RGB and native reference outputs for test/parity.mjs.

Run from the project root:  .venv/bin/python test/prep.py
"""
import os
import shutil
import numpy as np
from PIL import Image

out = 'build/test'
os.makedirs(out, exist_ok=True)

# The native references were produced from this exact RGB buffer. The JPEG is
# only kept for docs/screenshot.png and does not match those references, so
# parity must never be regenerated from it.
fixture = 'test/data/example.rgb'
if not os.path.exists(fixture):
    raise SystemExit('missing frozen parity fixture: test/data/example.rgb')

shutil.copyfile(fixture, f'{out}/example.rgb')
w, h = [int(v) for v in open('test/data/example.meta.txt').read().split()]
open(f'{out}/meta.txt', 'w').write(f'{w} {h}\n')
print('image', w, 'x', h, '(fixture)')

# Reference SAM mask captured from the original native MobileSAM demo (point 545,300)
m = np.array(Image.open('test/data/sam_mask_ref.png').convert('L'))
assert m.shape == (h, w), (m.shape, (h, w))
print('sam ref coverage', round(float((m > 127).mean()), 4))
(m > 127).astype(np.uint8).tofile(f'{out}/ref_sam_mask.u8')

# Reference LaMa result: built-in ellipse mask, 512 model, full-image path
r = np.array(Image.open('test/data/lama_full_ref.png').convert('RGB'))
assert r.shape == (h, w, 3)
r.tofile(f'{out}/ref_lama_full.rgb')

# The ellipse the native lama_demo builds (src/lama_demo.cpp)
cx, cy = 0.171 * w, 0.227 * h
rx, ry = max(2.0, 0.085 * w), max(2.0, 0.125 * h)
yy, xx = np.mgrid[0:h, 0:w]
ell = (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) <= 1.0
print('ellipse coverage', round(float(ell.mean()), 4))
ell.astype(np.uint8).tofile(f'{out}/ref_ellipse_mask.u8')
