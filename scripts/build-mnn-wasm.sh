#!/usr/bin/env bash
# Rebuild the Emscripten MNN static archive from external/MNN.
#
# The browser links native/lib/wasm_simd/libMNN.a. This script reproduces that
# archive with a single-threaded, SIMD-enabled configuration (no pthreads), so
# the produced wasm needs neither SharedArrayBuffer nor cross-origin isolation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EM="${EMSCRIPTEN:-/usr/lib/emscripten}"
BUILD="$ROOT/build/mnn-wasm"
export EM_CACHE="${EM_CACHE:-$ROOT/.cache/emscripten}"
mkdir -p "$BUILD" "$EM_CACHE"

"$EM/emcmake" cmake -S "$ROOT/external/MNN" -B "$BUILD" \
    -DCMAKE_BUILD_TYPE=Release \
    -DMNN_BUILD_SHARED_LIBS=OFF \
    -DMNN_FORBID_MULTI_THREAD=ON \
    -DMNN_USE_THREAD_POOL=OFF \
    -DMNN_USE_SSE=ON \
    -DMNN_OPENMP=OFF \
    -DMNN_BUILD_TEST=OFF \
    -DMNN_BUILD_BENCHMARK=OFF \
    -DMNN_BUILD_TOOLS=OFF \
    -DMNN_BUILD_CONVERTER=OFF \
    -DMNN_BUILD_QUANTOOLS=OFF \
    -DMNN_EVALUATION=OFF \
    -DCMAKE_C_FLAGS="-msimd128 -msse4.1" \
    -DCMAKE_CXX_FLAGS="-msimd128 -msse4.1"

cmake --build "$BUILD" --target MNN -j"$(nproc)"

ARCHIVE="$(find "$BUILD" -name libMNN.a -print -quit)"
if [ -z "$ARCHIVE" ]; then
    echo "libMNN.a was not produced under $BUILD" >&2
    exit 1
fi

mkdir -p "$ROOT/native/lib/wasm_simd"
cp "$ARCHIVE" "$ROOT/native/lib/wasm_simd/libMNN.a"
echo "updated native/lib/wasm_simd/libMNN.a from $ARCHIVE"
ls -lh "$ROOT/native/lib/wasm_simd/libMNN.a"
