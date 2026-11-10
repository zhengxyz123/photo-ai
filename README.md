# PhotoAI

PhotoAI 是一个完全在浏览器本地运行的照片对象编辑工具。点选或框选画面中的物体，
MobileSAM 生成蒙版；蒙版可以反转、擦除、剪切为图层，也可以用 LaMa 局部或整幅补全。
所有推理都在 Web Worker 内的 MNN/wasm 中完成，照片不会上传到服务器。

![PhotoAI 界面](docs/screenshot.png)

## 特性

- **点选 / 框选**：正点、负点与矩形提示，支持新建、加选、减选、交集。
- **图层编辑**：新增图片或纯色图层、拖动排序、向下合并、重命名、导出 PNG。
- **选区操作**：反转、清除为透明、剪切为图层、裁剪到选区。
- **局部补全**：按选区外接框裁出正方形送入 LaMa，小物体保留原生细节；选区过大时自动走全图路径。
- **模糊未选区域**：实时预览，可调外扩、羽化和模糊强度，确认后可撤销。
- **纯本地推理**：MobileSAM + LaMa 以 C++ 编译为 wasm，模型从静态目录按需加载。

## 技术栈

- 前端：Vue 3、TypeScript、Naive UI、SortableJS、Vite
- 推理：MNN 3.6.2、Emscripten、MobileSAM、LaMa
- 模型工具：PyTorch → ONNX → MNN（`tools/`）

## 快速开始

依赖：Node.js 22.18+ 或 24.12+、Git、Emscripten（默认 `/usr/lib/emscripten`）。

```bash
git clone --recurse-submodules <repo-url> PhotoAI
cd PhotoAI
npm install
npm run wasm     # 编译 native/photo_ai.cpp -> public/photo_ai.{js,wasm}
npm run dev      # http://127.0.0.1:8177/
```

已经克隆但未初始化子模块时：

```bash
git submodule update --init --depth 1 external/MNN
```

页面必须通过 HTTP 访问（`file://` 下 Worker 与 wasm 不可用）。

## 构建与部署

```bash
npm run build      # 类型检查 + Vite 构建
npm run preview    # 本地预览 dist/
npm run build:all  # 重新编译 wasm 后再构建前端
```

`npm run build` 只把前端代码、wasm、字体和图标写入 `dist/`（约 2.6 MB）。
MNN 模型（约 248 MB）保留在 `public/models/`，不会复制进 `dist/`。部署时把
`dist/` 与 `public/models/` 一起发布，并让 `/models/*` 指向该目录即可；
`npm run preview` 已内置这条映射。

模型与 wasm 构建产物不纳入 git，首次检出后按下面的模型章节生成，或从发布包获取。

## 目录

```
.
├── external/MNN/               # git submodule，固定 tag 3.6.2
├── native/
│   ├── photo_ai.cpp            # wasm 核心：模型、合成图、蒙版、填充
│   ├── third_party/            # stb_image_resize2.h
│   └── lib/                    # Emscripten / 本机 MNN 静态库
├── public/
│   ├── models/                 # 运行时 MNN 模型（不打进 dist）
│   ├── photo_ai.{js,wasm}      # wasm 构建产物
│   └── fonts/                  # 自托管 Inter
├── src/                        # Vue 3 + TypeScript 前端
│   ├── components/
│   ├── editor/
│   ├── types/
│   └── worker.ts               # 后台推理线程
├── tools/                      # PyTorch → ONNX → MNN
├── scripts/                    # wasm 与整体构建
├── test/                       # 数值 parity + Chromium 端到端测试
└── docs/
```

## 模型

| 文件 | 输入 → 输出 | 大小 |
| --- | --- | --- |
| `public/models/sam_encoder.mnn` | `image [1,3,1024,1024]` → `image_embeddings [1,256,64,64]` | ~27 MB |
| `public/models/sam_decoder.mnn` | embeddings、`point_coords [1,N,2]`、`point_labels [1,N]` → `masks [1,4,256,256]`、`iou_predictions [1,4]` | ~24 MB |
| `public/models/lama.mnn` | `image_mask [1,4,512,512]` → `inpainted [1,3,512,512]` | ~197 MB |

从上游权重重新生成：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r tools/requirements.txt
./tools/convert.sh            # 下载权重、导出 ONNX、构建 MNNConvert、写入 public/models
./tools/convert.sh sam        # 只转换 MobileSAM
./tools/convert.sh lama 1024  # 可选：1024x1024 LaMa
```

LaMa 的 FFC 频域路径在 MNN 3.6.2 中没有可用的 2D DFT 算子，导出脚本会把它改写成
可分离实数 DFT（cos/sin 矩阵 + MatMul），因此模型固定单个空间尺寸。更多细节见
[tools/README.md](tools/README.md)。

## 开发

```bash
npm run type-check   # vue-tsc
npm run wasm -- test # 构建 Node 版 wasm，用于数值测试
```

浏览器测试需要本机 Chromium；先启动开发服务器，然后运行：

```bash
node test/preview.mjs      http://127.0.0.1:8177/
node test/drive.mjs        http://127.0.0.1:8177/
node test/interactions.mjs http://127.0.0.1:8177/
node test/image.mjs        http://127.0.0.1:8177/
node test/view.mjs         http://127.0.0.1:8177/
node test/mask.mjs         http://127.0.0.1:8177/
node test/blur.mjs         http://127.0.0.1:8177/
node test/viewport.mjs 1366 768
```

数值 parity：

```bash
python test/prep.py
node test/parity.mjs
python test/compare.py
```

参考结果：SAM mask IoU 0.9999，LaMa 全图最大误差 3/255。

## 快捷键

| 键 | 操作 |
| --- | --- |
| `P` / `B` / `V` | 点选 / 框选 / 移动 |
| `Esc` | 取消选择 |
| `F2` | 重命名当前图层 |
| `Ctrl+O` / `Ctrl+Shift+O` | 打开图片 / 新增图层 |
| `Ctrl+E` | 导出 PNG |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |

## 说明

- 单线程 CPU 推理：1024² 编码约 3.5 s，512² 局部填充约 8 s。
- 每次图层变化都会触发一次重编码；撤销上限 10 步。
- 只支持点与框提示，没有画刷或自动全图分割。
- LaMa 固定 512²，极高分辨率图会被缩放；主要面向室外自然场景。

## 致谢

[MNN](https://github.com/alibaba/MNN)、[MobileSAM](https://github.com/ChaoningZhang/MobileSAM)、
[LaMa](https://github.com/advimman/lama)、[Vue](https://vuejs.org/)、
[Naive UI](https://www.naiveui.com/)、[Vite](https://vite.dev/)。

第三方组件遵循其各自许可证。
