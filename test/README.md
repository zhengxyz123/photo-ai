# test — parity and browser checks

The browser tests use a zero-dependency CDP client (`lib/cdp.mjs`) and drive an
installed Chromium/Chrome. Start the app first:

```bash
npm run dev          # http://127.0.0.1:8177/
```

Then each script takes an optional URL:

```bash
node test/preview.mjs       http://127.0.0.1:8177/
node test/drive.mjs         http://127.0.0.1:8177/
node test/interactions.mjs  http://127.0.0.1:8177/
node test/image.mjs         http://127.0.0.1:8177/
node test/view.mjs          http://127.0.0.1:8177/
node test/mask.mjs          http://127.0.0.1:8177/
node test/blur.mjs          http://127.0.0.1:8177/
node test/viewport.mjs 1366 768 http://127.0.0.1:8177/
```

Screenshots and failure shots land in `test/artifacts/` (gitignored).

## Numerical parity

`parity.mjs` loads the Node build of the wasm core and compares it with the
reference outputs captured from the native demos:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install numpy pillow

./scripts/build-wasm.sh test
python test/prep.py
node test/parity.mjs
python test/compare.py
```

`test/data/example.rgb` is the frozen input that matches the reference PNGs.
`test/data/example.jpg` is only the drag-and-drop fixture for the browser
tests; it is never copied into `public/` or the build. The JPEG was replaced
after the native references were captured, so do not regenerate `example.rgb`
from it if you want the historical parity numbers.
