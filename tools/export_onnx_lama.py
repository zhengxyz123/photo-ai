#!/usr/bin/env python3
"""Export the ModelScope LaMa checkpoint to a single fixed-size ONNX graph.

  input  : image_mask [1, 4, SIZE, SIZE]  (RGB*(1-mask), mask)
  output : inpainted  [1, 3, SIZE, SIZE]  (sigmoid, [0,1])

The FFC FourierUnit is exported with an explicit separable real DFT (matmuls)
because MNN 3.6.2 has no ONNX DFT operator.  This fixes SIZE to 256 (LaMa's
training resolution); the C++ demo crops around the mask and pastes the result
back at native resolution.
"""
import argparse
import os
import sys

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".work")
sys.path.insert(0, HERE)

from lama_model import load_generator  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=os.path.join(WORK, "pytorch_model.pt"))
    ap.add_argument("--out", default=None,
                    help="output ONNX (default: tools/.work/onnx/lama.onnx or "
                         "tools/.work/onnx/lama_<size>.onnx)")
    ap.add_argument("--size", type=int, default=512)
    args = ap.parse_args()
    if args.out is None:
        name = "lama.onnx" if args.size == 512 else f"lama_{args.size}.onnx"
        args.out = os.path.join(WORK, "onnx", name)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    torch.manual_seed(0)

    print("loading generator ...")
    torch_model = load_generator(args.checkpoint, args.size, "torch")
    dft_model = load_generator(args.checkpoint, args.size, "dft")

    # Use an in-distribution probe: RGB in [0,1] with a random hole mask.
    # N(0,1) inputs saturate the generator and exaggerate tiny DFT differences.
    dummy = torch.rand(1, 4, args.size, args.size)
    dummy[:, 3] = (torch.rand(1, args.size, args.size) > 0.85).float()
    dummy[:, :3] *= (1.0 - dummy[:, 3:4])
    with torch.no_grad():
        ref = torch_model(dummy)
        got = dft_model(dummy)
    print("dft vs torch: max abs err", (ref - got).abs().max().item())

    print("exporting ONNX ...")
    torch.onnx.export(
        dft_model,
        (dummy,),
        args.out,
        export_params=True,
        verbose=False,
        opset_version=17,
        do_constant_folding=True,
        input_names=["image_mask"],
        output_names=["inpainted"],
        dynamic_axes=None,
        dynamo=False,
    )

    import onnxruntime as ort
    sess = ort.InferenceSession(args.out, providers=["CPUExecutionProvider"])
    out = sess.run(None, {"image_mask": dummy.numpy()})[0]
    err = np.abs(out - ref.numpy()).max()
    print("onnx vs torch: max abs err", err)
    print("saved:", args.out, os.path.getsize(args.out) / 1e6, "MB")


if __name__ == "__main__":
    main()
