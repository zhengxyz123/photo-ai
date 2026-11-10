#!/usr/bin/env python3
"""Create a deterministic input + ONNX reference output for MNN parity check."""
import argparse
import os
import sys

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".work")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--onnx", default=os.path.join(WORK, "onnx", "lama.onnx"))
    ap.add_argument("--out", default=os.path.join(WORK, "ref"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    rng = np.random.default_rng(1234)
    x = rng.standard_normal((1, 4, args.size, args.size), dtype=np.float32)
    x[:, 3] = (rng.random((1, args.size, args.size)) > 0.85).astype(np.float32)
    # Make the first three channels look like a masked image: values in [0,1].
    x[:, :3] = np.clip(x[:, :3] * 0.2 + 0.5, 0, 1)
    x[:, :3] *= (1.0 - x[:, 3:4])
    np.save(os.path.join(args.out, "input.npy"), x)
    x.astype(np.float32).tofile(os.path.join(args.out, "input.bin"))

    sess = ort.InferenceSession(args.onnx, providers=["CPUExecutionProvider"])
    y = sess.run(None, {"image_mask": x})[0]
    y.astype(np.float32).tofile(os.path.join(args.out, "onnx.bin"))
    np.save(os.path.join(args.out, "onnx.npy"), y)
    print("input", x.shape, "output", y.shape, "min/max", y.min(), y.max())


if __name__ == "__main__":
    main()
