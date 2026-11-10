# Third-Party Notices

PhotoAI is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE)
and [NOTICE](NOTICE).

This file lists the third-party software and assets used by PhotoAI. Each
component remains under its own license; nothing in this file changes those
terms. For Apache-2.0 components, the full license text is the one in
[LICENSE](LICENSE), and the upstream license copy is retained where available.

## 1. Inference and native code

| Component | License | Attribution and notes |
| --- | --- | --- |
| [MNN](https://github.com/alibaba/MNN) 3.6.2 | Apache-2.0 | Copyright 2018-present Alibaba Group. Linked into `public/photo_ai.wasm` via `native/lib/wasm_simd/libMNN.a`; source is the `external/MNN` submodule. |
| MNN bundled third-party code | Apache-2.0, BSD-3-Clause, MIT | flatbuffers (Apache-2.0), protobuf (BSD-3-Clause), RapidJSON (MIT), half (MIT), Skia (BSD-3-Clause), TensorFlow (Apache-2.0). See `external/MNN/3rd_party/` and `external/MNN/LICENSE.txt`. |
| [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) | Apache-2.0 | Copyright the MobileSAM authors. Source is the `tools/third_party/MobileSAM` submodule (Python package and license). |
| [LaMa](https://github.com/advimman/lama) | Apache-2.0 | Copyright the LaMa authors. The FFC-ResNet generator is reimplemented in `tools/lama_model.py`; conversion scripts are in `tools/`. |
| [stb_image_resize2](https://github.com/nothings/stb) | MIT or Public Domain (dual) | Copyright (c) 2017 Sean Barrett; v2 by Jeff Roberts and Jorge L. Rodriguez. Full dual-license text is in `native/third_party/stb_image_resize2.h`. |

The runtime model files in `public/models/` are conversions of the MobileSAM and
LaMa checkpoints. They are not relicensed by PhotoAI; the terms of the upstream
checkpoint releases apply. Checkpoint sources are recorded in
`tools/download_models.sh`.

## 2. Front-end runtime dependencies

| Component | License | Attribution |
| --- | --- | --- |
| [Vue](https://vuejs.org/) 3.5.x | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| [Vue I18n](https://vue-i18n.intlify.dev/) 11.x and `@intlify/*` | MIT | Copyright (c) 2020 kazuya kawaguchi |
| [Naive UI](https://www.naiveui.com/) 2.45.x | MIT | Copyright (c) 2021 TuSimple |
| [SortableJS](https://sortablejs.github.io/Sortable/) 1.15.x | MIT | Copyright (c) 2019 All contributors to Sortable |
| [highlight.js](https://highlightjs.org/) 11.x | BSD-3-Clause | Copyright (c) 2006, Ivan Sagalaev |
| [@juggle/resize-observer](https://github.com/juggle/resize-observer) 3.4.x | Apache-2.0 | Copyright 2019 JUGGLE |
| [date-fns](https://date-fns.org/) 4.x | MIT | Copyright (c) 2021 Sasha Koss and Lesha Koss |
| [date-fns-tz](https://github.com/marnusw/date-fns-tz) 3.x | MIT | Copyright (c) 2018 Marnus Weststrate |
| [lodash-es](https://lodash.com/) 4.x | MIT | Copyright OpenJS Foundation and other contributors; based on Underscore.js, copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors |
| [async-validator](https://github.com/yiminghe/async-validator) 4.x | MIT | Copyright (c) 2014-present yiminghe |
| [seemly](https://github.com/07akioni/seemly), [treemate](https://github.com/07akioni/treemate), [vooks](https://github.com/07akioni/vooks), [vueuc](https://github.com/07akioni/vueuc), [evtd](https://github.com/07akioni/evtd), [vdirs](https://github.com/07akioni/vdirs) | MIT | Copyright (c) 2020 07akioni |
| [css-render](https://github.com/07akioni/css-render) and `@css-render/*` | MIT | Copyright the css-render authors |

## 3. Build-time dependencies

The following packages are used to build or type-check the project and are not
part of the runtime bundle: Vite, `@vitejs/plugin-vue`,
`@vitejs/plugin-vue-jsx`, TypeScript, `vue-tsc`, ESLint, `eslint-plugin-vue`,
`eslint-config-prettier`, `eslint-plugin-oxlint`, oxlint, Prettier, `jiti`,
`npm-run-all2`, `vite-plugin-vue-devtools`, `@vue/tsconfig`, `@tsconfig/node24`,
and `@types/*`. They are distributed under MIT, Apache-2.0, or BSD-3-Clause
licenses; their license files are included in their npm packages. `source-map-js`
(BSD-3-Clause, Copyright (c) 2009-2011, Mozilla Foundation and contributors) may
be included in build output through the toolchain.

## 4. Fonts and documentation assets

| Asset | License | Attribution |
| --- | --- | --- |
| Inter variable font (`src/assets/fonts/inter-var.woff2`) | SIL Open Font License 1.1 | Copyright (c) 2016 The Inter Project Authors. Full text: `src/assets/fonts/OFL.txt`. |
| `docs/screenshot.png` and `test/data/example.jpg` | CC BY-SA 4.0 | "Christmas table (Serbian cuisine)" by Petar Milošević, via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Christmas_table_(Serbian_cuisine).jpg). The screenshot is a derivative work and is distributed under CC BY-SA 4.0, not Apache-2.0. |

## 5. License texts

### Apache License 2.0

The full text is in [LICENSE](LICENSE). It applies to PhotoAI and to the
Apache-2.0 components listed above (MNN, MobileSAM, LaMa,
`@juggle/resize-observer`, flatbuffers, TensorFlow, and others).

### MIT License

The following permission notice applies to each MIT-licensed component listed
above. The copyright notice for each component is given in its table entry.

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BSD 3-Clause License

The following terms apply to highlight.js, source-map-js, protobuf, Skia, and
other BSD-3-Clause components. The copyright notice for each component is
given in its table entry or in the upstream package.

```text
BSD 3-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### SIL Open Font License 1.1

See `src/assets/fonts/OFL.txt` for the full text and the Inter copyright notice.

### Creative Commons Attribution-ShareAlike 4.0 International

See <https://creativecommons.org/licenses/by-sa/4.0/legalcode> for the full
text. Attribution for the image is given in section 4 above and in the README.
