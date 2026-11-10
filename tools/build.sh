#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Full production build: wasm core into public/, then the Vite bundle into dist/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

make -C "$ROOT"
npm --prefix "$ROOT" run build
