#!/usr/bin/env bash
# Build the browser wasm core.
#
#   ./scripts/build-wasm.sh          -> public/photo_ai.{js,wasm}
#   ./scripts/build-wasm.sh test     -> build/test/photo_ai.{js,wasm}
#
# The MNN headers come from the external/MNN submodule; the Emscripten static
# archive is the SIMD build in native/lib/wasm_simd. Rebuild that archive with
# scripts/build-mnn-wasm.sh if the submodule moves.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EM="${EMSCRIPTEN:-/usr/lib/emscripten}"
export EM_CACHE="${EM_CACHE:-$ROOT/.cache/emscripten}"

MODE="${1:-browser}"
if [ "$MODE" = "test" ]; then
    OUT_DIR="$ROOT/build/test"
    ENV="web,worker,node"
else
    OUT_DIR="$ROOT/public"
    ENV="web,worker"
fi
mkdir -p "$OUT_DIR" "$EM_CACHE"

"$EM/em++" \
    -O3 -std=c++17 -msimd128 \
    -I"$ROOT/external/MNN/include" \
    -I"$ROOT/native/third_party" \
    "$ROOT/native/photo_ai.cpp" \
    "$ROOT/native/lib/wasm_simd/libMNN.a" \
    -o "$OUT_DIR/photo_ai.js" \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME=createPhotoAI \
    -sENVIRONMENT="$ENV" \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=256MB \
    -sMAXIMUM_MEMORY=4GB \
    -sSTACK_SIZE=5MB \
    -sEXPORTED_FUNCTIONS=_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPU8,HEAP32,HEAPF32 \
    "${@:2}"

ls -lh "$OUT_DIR/photo_ai.js" "$OUT_DIR/photo_ai.wasm"
