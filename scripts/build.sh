#!/usr/bin/env bash
# Full production build: wasm core into public/, then the Vite bundle into dist/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/scripts/build-wasm.sh"
npm --prefix "$ROOT" run build
echo "dist/: $(du -sh "$ROOT/dist" | cut -f1)"
