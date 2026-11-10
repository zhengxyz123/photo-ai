# tools — PyTorch → ONNX → MNN

Everything needed to turn the two upstream PyTorch checkpoints into the MNN
models that the browser loads. The web frontend is TypeScript; this directory
stays Python/C++ because the model exporters depend on PyTorch, ONNX and MNN's
native converter.

## Layout

```
tools/
├── download_models.sh          # fetch + SHA-256 verify both checkpoints
├── convert.sh                  # ONNX export → MNNConvert → public/models
├── export_onnx_mobile_sam.py   # TinyViT encoder + prompt decoder
├── export_onnx_lama.py         # FFC-ResNet generator with a separable DFT
├── lama_model.py               # standalone LaMa generator (torch / dft modes)
├── make_ref.py                 # deterministic reference tensors
├── mnn_parity.cpp              # native MNN parity harness
├── requirements.txt
├── third_party/MobileSAM/      # upstream MobileSAM Python package
└── .work/                      # checkpoints + ONNX (generated, gitignored)
```

`public/models/` receives the three runtime files:

| File | Input → output | Size |
| --- | --- | --- |
| `sam_encoder.mnn` | `image [1,3,1024,1024]` → `image_embeddings [1,256,64,64]` | ~27 MB |
| `sam_decoder.mnn` | embeddings, `point_coords [1,N,2]`, `point_labels [1,N]` → `masks [1,4,256,256]`, `iou_predictions [1,4]` | ~24 MB |
| `lama.mnn` | `image_mask [1,4,512,512]` → `inpainted [1,3,512,512]` | ~197 MB |

The 1024×1024 LaMa variant is optional: `./tools/convert.sh lama 1024` writes
`public/models/lama_1024.mnn`; the browser currently ships the 512 one.

## Setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r tools/requirements.txt
```

`convert.sh` uses `$PYTHON` (default `python3`). Point it at a virtualenv when
the system Python does not have torch:

```bash
PYTHON="$PWD/.venv/bin/python" ./tools/convert.sh
```

MNNConvert is built from the `external/MNN` submodule into
`tools/.build/mnn-converter`, so no prebuilt converter binary is committed.
GCC 16 cannot compile MNN 3.6.2's converter (libstdc++ 16 rejects its
`__int128` / `__float128` paths); `convert.sh` automatically prefers `g++-15`
when present, and `CXX` / `CC` override the choice.
The submodule must be initialized:

```bash
git submodule update --init --depth 1 external/MNN
```

## Run the whole pipeline

```bash
./tools/download_models.sh       # tools/.work/*.pt
./tools/convert.sh               # ONNX + MNN, writes public/models/*.mnn
```

Or one family at a time:

```bash
./tools/convert.sh sam
./tools/convert.sh lama
./tools/convert.sh lama 1024
```

## Why LaMa is not a straight ONNX export

The FFC FourierUnit in LaMa uses `torch.fft.rfftn` / `irfftn`. MNN 3.6.2 has
only a 1-D `Stft` operator, and ONNX `DFT` is not on MNNConvert's supported-op
list. `export_onnx_lama.py` therefore swaps each FourierUnit for an equivalent
**separable real DFT** built from precomputed cosine/sine matrices and
`MatMul`. `Conv`, `BatchNorm`, `MatMul`, `Reshape`, `Transpose`, `Concat`,
`Slice` and `Gather` are all supported by MNN.

The basis is baked for one spatial size, which is why a model accepts exactly
one resolution (512×512 or 1024×1024). The browser uses the 512 model and feeds
it either a square crop around the mask ("local" fill) or the whole image
("full" fill).

## Parity check

`make_ref.py` writes deterministic input/reference tensors; `mnn_parity.cpp`
runs the converted MNN graphs and dumps their outputs:

```bash
python tools/make_ref.py                       # tools/.work/ref/*.bin
mkdir -p tools/.build
c++ -O2 -std=c++17 tools/mnn_parity.cpp \
    -Iexternal/MNN/include \
    native/lib/native/libMNN.a -lpthread -ldl -lz -lm \
    -o tools/.build/mnn_parity
./tools/.build/mnn_parity public/models tools/.work/ref
```

`native/lib/native/libMNN.a` is a host build kept only for this harness; the
browser uses the Emscripten archive in `native/lib/wasm_simd/`.

Measured against the upstream native demos: SAM mask IoU 0.9999 and LaMa
full-image max |Δ| = 3/255.

## Notes

- The MobileSAM decoder's prompt-token axis is dynamic (`dynamic_axes`), so one
  decoder handles positive points, negative points, box corners (labels 2/3)
  and the `-1` padding token.
- Coordinates are normalized to the 1024×1024 padded frame:
  `(x_resized + 0.5) / 1024`.
- `.work/` and `.build/` are disposable; only `public/models/*.mnn` is consumed
  by the app.
