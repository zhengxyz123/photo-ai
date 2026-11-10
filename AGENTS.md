# AGENTS.md

Browser-only Vue 3 + TypeScript photo editor. MobileSAM selection and LaMa inpainting run as MNN wasm in a Web Worker; there is no server or database.

## Setup and commands

- Requirements: Node `^22.18 || >=24.12`, Emscripten (default `/usr/lib/emscripten`, override with `EMSCRIPTEN`), and the `external/MNN` submodule (`git submodule update --init --depth 1 external/MNN`).
- `npm install`
- `npm run wasm` → `public/photo_ai.{js,wasm}`. Required on a fresh clone and after every `native/photo_ai.cpp` change; both outputs are gitignored.
- `npm run dev` → `http://127.0.0.1:8177/`. Workers/wasm do not work over `file://`.
- `npm run type-check` (`vue-tsc --build`); `npm run build` = type-check + Vite into `dist/`; `npm run build-only` skips type-check.
- `npm run build:all` = wasm rebuild, then frontend build. `npm run preview` serves `dist/`.
- `npm run format` formats only `src/` with Prettier. For tests/config use `npx prettier --write <path>`.
- ESLint and oxlint are configured, but there is no `lint` npm script.
- `npm test` / `npm run test:parity` runs `test/parity.mjs`. It does **not** start the dev server; prepare the Node wasm build and parity fixtures first (see Tests).

## Missing on a fresh clone

`public/models/*.mnn` are gitignored (only `.gitkeep` is tracked). Generate them with the Python pipeline in `tools/README.md` (`.venv` + `./tools/convert.sh`) or copy the three existing runtime models into `public/models/`. The pipeline imports MobileSAM from the `tools/third_party/MobileSAM` submodule, so initialize it first (`git submodule update --init tools/third_party/MobileSAM`). Without the models the app loads but SAM/LaMa operations fail.

## Tests

- There are no browser/CDP tests. The only test suite is numerical parity.
- Numerical parity needs `numpy` + `pillow`: `npm run wasm -- test` (outputs `build/test`), then `python test/prep.py`, `node test/parity.mjs`, `python test/compare.py`.
- `test/data/example.rgb` is frozen to match the reference PNGs, with dimensions in `test/data/example.meta.txt`. Never regenerate it from `test/data/example.jpg`. The JPEG is only the source of `docs/screenshot.png` and is not used by parity.

## Architecture

- `src/editor/useEditor.ts` (`createEditor()`) is the state/command hub: document, layers, masks, undo, view, and worker bridge. `PhotoEditor.vue` creates one instance and provides it through `EditorKey`; components consume it with `useEditorContext()`. Most features require editing this file, not just a component.
- Worker protocol lives in `src/types/worker.ts`; `src/worker.ts` owns the models and only the flattened composite. The editor owns document pixels/masks and must send a fresh `composite` message after pixel edits.
- C++ ABI: `EMSCRIPTEN_KEEPALIVE` `pa_*` functions in `native/photo_ai.cpp` are hand-mirrored as `_pa_*` in `src/types/photo-ai.ts`. Keep both in sync and rebuild wasm.
- The Emscripten glue in `public/photo_ai.js` is fetched and imported as a blob in `worker.ts`; do not import that public file as a normal module.
- Model URLs and approximate byte totals are hardcoded in `MODELS` in `src/worker.ts`; update the totals when regenerating models.
- i18n: `src/i18n/locales/en.ts` is the source of truth. `zh-Hans.ts` must mirror its key structure (`satisfies` enforces this). Use `t()` in components and `translate()` outside components; do not hardcode UI text.
- Styling is global in `src/styles.css`; components use no scoped styles.

## Conventions and gotchas

- Prettier: no semicolons, single quotes, print width 100, 2-space indent.
- `window.__photoai` is the debug facade exposed by `useEditor.ts`; keep its getters and methods working for console debugging.
- `dist/` and `public/models/` are large build/runtime artifacts (hundreds of MB); do not edit or commit them.
