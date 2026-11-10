#!/usr/bin/env bash
# Convert the upstream PyTorch checkpoints to ONNX and then to MNN.
#
#   ./tools/convert.sh              # MobileSAM + LaMa 512
#   ./tools/convert.sh sam          # MobileSAM only
#   ./tools/convert.sh lama 1024   # LaMa 1024x1024
#
# Intermediate checkpoints and ONNX graphs stay in tools/.work; the runtime
# models are written to public/models so Vite serves them from the web root.
set -euo pipefail

cd "$(dirname "$0")"
TOOLS="$PWD"
ROOT="$(cd .. && pwd)"
WORK="$TOOLS/.work"
OUT="$ROOT/public/models"
MNN_SRC="$ROOT/external/MNN"
MNN_BUILD="$TOOLS/.build/mnn-converter"
PYTHON="${PYTHON:-python3}"

# MNN 3.6.2's converter does not compile with GCC 16 (libstdc++ 16 rejects its
# __int128/__float128 paths). Prefer GCC 15 when it is installed; CXX/CC win.
if [ -z "${CXX:-}" ] && command -v g++-15 >/dev/null 2>&1; then CXX=g++-15; fi
if [ -z "${CC:-}" ] && command -v gcc-15 >/dev/null 2>&1; then CC=gcc-15; fi

TARGET="${1:-all}"
SIZE="${2:-512}"
if ! [[ "$SIZE" =~ ^[0-9]+$ ]]; then SIZE=512; fi

mkdir -p "$WORK/onnx" "$OUT"

"$TOOLS/download_models.sh" "$TARGET"

# ---------------------------------------------------------------- MNNConvert
MNN_CONVERT="$MNN_BUILD/MNNConvert"
if [ ! -x "$MNN_CONVERT" ]; then
    echo "==> building MNNConvert from external/MNN"
    cmake -S "$MNN_SRC" -B "$MNN_BUILD" \
        -DCMAKE_BUILD_TYPE=Release \
        -DMNN_BUILD_CONVERTER=ON \
        -DMNN_BUILD_SHARED_LIBS=ON \
        -DMNN_BUILD_TEST=OFF \
        -DMNN_BUILD_BENCHMARK=OFF \
        -DMNN_BUILD_TOOLS=OFF \
        -DMNN_USE_SSE=ON \
        -DMNN_OPENMP=ON \
        -DMNN_BUILD_QUANTOOLS=OFF \
        -DMNN_EVALUATION=OFF \
        -DCMAKE_C_COMPILER="${CC:-c}" \
        -DCMAKE_CXX_COMPILER="${CXX:-c++}"
    cmake --build "$MNN_BUILD" --target MNNConvert -j"$(nproc)"
fi
export LD_LIBRARY_PATH="$MNN_BUILD:$MNN_BUILD/express:$MNN_BUILD/tools/converter:${LD_LIBRARY_PATH:-}"

convert() {
    local onnx="$1" mnn="$2" biz="$3"
    echo "==> $onnx -> $mnn"
    "$MNN_CONVERT" -f ONNX \
        --modelFile "$onnx" \
        --MNNModel "$mnn" \
        --bizCode "$biz"
}

# ------------------------------------------------------------------ MobileSAM
if [ "$TARGET" = "all" ] || [ "$TARGET" = "sam" ]; then
    if [ ! -f "$WORK/onnx/mobile_sam_encoder.onnx" ] || \
       [ ! -f "$WORK/onnx/mobile_sam_decoder.onnx" ]; then
        echo "==> exporting MobileSAM ONNX"
        "$PYTHON" "$TOOLS/export_onnx_mobile_sam.py" \
            --checkpoint "$WORK/mobile_sam.pt" \
            --out-dir "$WORK/onnx"
    fi
    convert "$WORK/onnx/mobile_sam_encoder.onnx" "$OUT/sam_encoder.mnn" MobileSAM
    convert "$WORK/onnx/mobile_sam_decoder.onnx" "$OUT/sam_decoder.mnn" MobileSAM
fi

# ---------------------------------------------------------------------- LaMa
if [ "$TARGET" = "all" ] || [ "$TARGET" = "lama" ]; then
    if [ "$SIZE" = "512" ]; then
        ONNX="$WORK/onnx/lama.onnx"
        MNN="$OUT/lama.mnn"
    else
        ONNX="$WORK/onnx/lama_${SIZE}.onnx"
        MNN="$OUT/lama_${SIZE}.mnn"
    fi
    if [ ! -f "$ONNX" ]; then
        echo "==> exporting LaMa ${SIZE}x${SIZE} ONNX"
        "$PYTHON" "$TOOLS/export_onnx_lama.py" \
            --checkpoint "$WORK/pytorch_model.pt" \
            --size "$SIZE" \
            --out "$ONNX"
    fi
    convert "$ONNX" "$MNN" LaMa
fi

echo
ls -lh "$OUT"/*.mnn
