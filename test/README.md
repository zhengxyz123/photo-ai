# test — numerical parity

`parity.mjs` loads the Node build of the wasm core and compares it with the
reference outputs captured from the native demos. There are no browser/CDP
tests; `npm test` runs this parity check.

## Numerical parity

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install numpy pillow

make test          # builds build/test/photo_ai.{js,wasm}
python test/prep.py
node test/parity.mjs
python test/compare.py
```

`test/data/example.rgb` is the frozen input that matches the reference PNGs, and
`test/data/example.meta.txt` records its dimensions. Do not regenerate
`example.rgb` from the JPEG: the JPEG is kept only as the source of
`docs/screenshot.png`, and its pixels do not match the historical references.

The source JPEG is
["Christmas table (Serbian cuisine)"](https://commons.wikimedia.org/wiki/File:Christmas_table_(Serbian_cuisine).jpg)
by Petar Milošević, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
