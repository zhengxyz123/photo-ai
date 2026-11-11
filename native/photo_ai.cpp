// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 zhengxyz123
// PhotoAI -- photo editing core for the browser.
//
// Two MNN models run in one wasm module:
//   MobileSAM  encoder  image 1024x1024            -> 1x256x64x64 embeddings
//              decoder  embeddings + prompt tokens -> 4 x 256x256 mask logits +
//                                                     IoU
//   LaMa (FFC-ResNet)   4 x S x S (RGB*(1-m), m) -> 3 x S x S inpainted RGB
//
// The module owns the image, the current binary mask and the last inpainted
// result.  JavaScript only shuffles bytes through its heap; every model call
// stays in C++ so a click costs one cross-boundary round trip.
//
// Geometry follows the upstream native demos so the numbers can be checked
// against them: SAM resizes the long side to 1024 and
// pads top-left with zeros; LaMa fits the image into S x S with symmetric
// padding (or, for a small mask, inpaints a square crop of the image at native
// resolution so the hole keeps its detail).
#include <emscripten/emscripten.h>

#include <MNN/Interpreter.hpp>
#include <MNN/Tensor.hpp>

#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "stb_image_resize2.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

const int kImageSize = 1024; // MobileSAM encoder input
const int kEmbedDim = 256;
const int kEmbedSize = 64;
const int kMaskSize = 256;   // decoder mask output
const int kNumMaskTokens = 4;
const float kPixelMean[3] = {123.675f, 116.28f, 103.53f};
const float kPixelStd[3] = {58.395f, 57.12f, 57.375f};

// Error codes shared with app.js.
enum {
    kOk = 0,
    kErrNoModel = -1,
    kErrNoImage = -2,
    kErrEmptyMask = -3,
    kErrInference = -4,
    kErrNoPrompt = -5,
    kErrBadArg = -6,
};

class Net {
  private:
    std::shared_ptr<MNN::Interpreter> net_;
    MNN::Session* session_ = nullptr;
    MNN::BackendConfig backend_;
    bool needResize_ = false;

  public:
    ~Net() {
        unload();
    }

    // createFromBuffer copies the bytes, so the caller may free its copy as
    // soon as this returns.
    bool load(const void* data, size_t len) {
        unload();
        net_.reset(MNN::Interpreter::createFromBuffer(data, len));
        if (!net_)
            return false;
        backend_.precision = MNN::BackendConfig::Precision_High;
        backend_.power = MNN::BackendConfig::Power_High;
        MNN::ScheduleConfig cfg;
        cfg.type = MNN_FORWARD_CPU;
        cfg.numThread = 1; // no pthreads in this build
        cfg.backendConfig = &backend_;
        session_ = net_->createSession(cfg);
        return session_ != nullptr;
    }

    void unload() {
        if (net_ && session_)
            net_->releaseSession(session_);
        session_ = nullptr;
        net_.reset();
    }

    bool ready() const {
        return net_ && session_;
    }

    bool run() {
        return net_->runSession(session_) == MNN::NO_ERROR;
    }

    MNN::Tensor* input(const char* name) {
        return net_ ? net_->getSessionInput(session_, name) : nullptr;
    }
    MNN::Tensor* output(const char* name) {
        return net_ ? net_->getSessionOutput(session_, name) : nullptr;
    }

    bool setInput(const char* name, const std::vector<int>& shape,
                  const float* data) {
        MNN::Tensor* dst = input(name);
        if (!dst)
            return false;
        MNN::Tensor* host =
            MNN::Tensor::create<float>(shape, (void*)data, MNN::Tensor::CAFFE);
        const bool ok = dst->copyFromHostTensor(host);
        MNN::Tensor::destroy(host);
        return ok;
    }

    bool getOutput(const char* name, std::vector<float>& data,
                   std::vector<int>& shape) {
        MNN::Tensor* src = output(name);
        if (!src)
            return false;
        MNN::Tensor* host = MNN::Tensor::createHostTensorFromDevice(src, true);
        if (!host)
            return false;
        shape.assign(host->dimensions(), 0);
        for (int i = 0; i < host->dimensions(); ++i)
            shape[i] = host->length(i);
        data.assign(host->host<float>(),
                    host->host<float>() + host->elementSize());
        MNN::Tensor::destroy(host);
        return true;
    }

    // The decoder's prompt token count is dynamic: resize, then re-plan once.
    bool resizeInput(const char* name, const std::vector<int>& shape) {
        MNN::Tensor* t = input(name);
        if (!t)
            return false;
        net_->resizeTensor(t, shape);
        needResize_ = true;
        return true;
    }

    void commitResize() {
        if (needResize_) {
            net_->resizeSession(session_);
            needResize_ = false;
        }
    }
};

Net g_enc, g_dec, g_lama;
bool g_encoded = false;

int g_w = 0, g_h = 0;
std::vector<unsigned char> g_img;    // RGB, original resolution
std::vector<unsigned char> g_mask;   // w*h, 0 or 255
std::vector<unsigned char> g_result; // RGB after the last fill
std::vector<unsigned char>
    g_usedAlpha;          // 0..255, the alpha the fill composited with

std::vector<float> g_emb; // 256 x 64 x 64
int g_rw = 0, g_rh = 0;   // image size after the SAM resize
float g_scale = 1.f;      // SAM resize scale

float g_iou[kNumMaskTokens] = {0.f, 0.f, 0.f, 0.f};
int g_best = -1;

void resizeBilinearF(const float* src, int sw, int sh, float* dst, int dw,
                     int dh) {
    const float sx = (float)sw / (float)dw;
    const float sy = (float)sh / (float)dh;
    for (int y = 0; y < dh; ++y) {
        float fy = ((float)y + 0.5f) * sy - 0.5f;
        int y0 = (int)std::floor(fy);
        float wy = fy - (float)y0;
        int y1 = y0 + 1;
        if (y0 < 0) {
            y0 = 0;
            wy = 0.f;
        }
        if (y1 >= sh)
            y1 = sh - 1;
        for (int x = 0; x < dw; ++x) {
            float fx = ((float)x + 0.5f) * sx - 0.5f;
            int x0 = (int)std::floor(fx);
            float wx = fx - (float)x0;
            int x1 = x0 + 1;
            if (x0 < 0) {
                x0 = 0;
                wx = 0.f;
            }
            if (x1 >= sw)
                x1 = sw - 1;
            const float v00 = src[(size_t)y0 * sw + x0];
            const float v01 = src[(size_t)y0 * sw + x1];
            const float v10 = src[(size_t)y1 * sw + x0];
            const float v11 = src[(size_t)y1 * sw + x1];
            const float top = v00 + (v01 - v00) * wx;
            const float bot = v10 + (v11 - v10) * wx;
            dst[(size_t)y * dw + x] = top + (bot - top) * wy;
        }
    }
}

bool resizeRgbU8(const unsigned char* src, int sw, int sh, unsigned char* dst,
                 int dw, int dh) {
    if (sw == dw && sh == dh) {
        std::memcpy(dst, src, (size_t)sw * sh * 3);
        return true;
    }
    return stbir_resize_uint8_linear(src, sw, sh, 0, dst, dw, dh, 0,
                                     STBIR_RGB) != nullptr;
}

// Nearest-neighbour, matching the pixel-exact mask resize of the native demo.
void resizeMaskNearest(const unsigned char* src, int sw, int sh,
                       unsigned char* dst, int dw, int dh) {
    for (int y = 0; y < dh; ++y) {
        int sy = (int)(((long long)y * sh) / dh);
        sy = std::max(0, std::min(sh - 1, sy));
        for (int x = 0; x < dw; ++x) {
            int sx = (int)(((long long)x * sw) / dw);
            sx = std::max(0, std::min(sw - 1, sx));
            dst[(size_t)y * dw + x] = src[(size_t)sy * sw + sx];
        }
    }
}

// numpy.pad(mode='symmetric'): ... 2 1 0 | 0 1 2 | 2 1 0 ...
int reflectSymmetric(int p, int n) {
    if (n <= 1)
        return 0;
    const int period = 2 * n;
    p %= period;
    if (p < 0)
        p += period;
    if (p >= n)
        p = period - 1 - p;
    return p;
}

void dilateMask(std::vector<unsigned char>& mask, int w, int h, int r) {
    if (r <= 0)
        return;
    std::vector<unsigned char> tmp(mask.size(), 0);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            unsigned char v = 0;
            const int lo = std::max(0, x - r), hi = std::min(w - 1, x + r);
            for (int xx = lo; xx <= hi; ++xx) {
                v = std::max(v, mask[(size_t)y * w + xx]);
                if (v == 255)
                    break;
            }
            tmp[(size_t)y * w + x] = v;
        }
    }
    for (int y = 0; y < h; ++y) {
        const int lo = std::max(0, y - r), hi = std::min(h - 1, y + r);
        for (int x = 0; x < w; ++x) {
            unsigned char v = 0;
            for (int yy = lo; yy <= hi; ++yy) {
                v = std::max(v, tmp[(size_t)yy * w + x]);
                if (v == 255)
                    break;
            }
            mask[(size_t)y * w + x] = v;
        }
    }
}

void blurAlpha(std::vector<float>& a, int w, int h, int radius) {
    if (radius <= 0)
        return;
    std::vector<float> tmp(a.size());
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            float s = 0.f;
            int n = 0;
            for (int k = -radius; k <= radius; ++k) {
                const int xx = std::max(0, std::min(w - 1, x + k));
                s += a[(size_t)y * w + xx];
                ++n;
            }
            tmp[(size_t)y * w + x] = s / n;
        }
    }
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            float s = 0.f;
            int n = 0;
            for (int k = -radius; k <= radius; ++k) {
                const int yy = std::max(0, std::min(h - 1, y + k));
                s += tmp[(size_t)yy * w + x];
                ++n;
            }
            a[(size_t)y * w + x] = s / n;
        }
    }
}

bool computeBBox(const std::vector<unsigned char>& mask, int w, int h, int& x0,
                 int& y0, int& x1, int& y1) {
    x0 = w;
    y0 = h;
    x1 = -1;
    y1 = -1;
    for (int y = 0; y < h; ++y) {
        const unsigned char* row = &mask[(size_t)y * w];
        for (int x = 0; x < w; ++x) {
            if (!row[x])
                continue;
            if (x < x0)
                x0 = x;
            if (x > x1)
                x1 = x;
            if (y < y0)
                y0 = y;
            if (y > y1)
                y1 = y;
        }
    }
    return x1 >= x0 && y1 >= y0;
}

} // namespace

extern "C" {

// Both buffers are transient: MNN keeps its own copy, so the caller frees them
// right after this returns.  Returns kOk / kErrNoModel.
EMSCRIPTEN_KEEPALIVE int pa_load_sam(const unsigned char* enc, int encLen,
                                     const unsigned char* dec, int decLen) {
    g_encoded = false;
    if (!g_enc.load(enc, (size_t)encLen)) {
        g_enc.unload();
        return kErrNoModel;
    }
    if (!g_dec.load(dec, (size_t)decLen)) {
        g_dec.unload();
        return kErrNoModel;
    }
    return kOk;
}

EMSCRIPTEN_KEEPALIVE int pa_load_lama(const unsigned char* data, int len) {
    if (!g_lama.load(data, (size_t)len)) {
        g_lama.unload();
        return kErrNoModel;
    }
    return kOk;
}

EMSCRIPTEN_KEEPALIVE int pa_unload_lama() {
    g_lama.unload();
    return kOk;
}

EMSCRIPTEN_KEEPALIVE int pa_sam_ready() {
    return g_enc.ready() && g_dec.ready() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int pa_lama_ready() {
    return g_lama.ready() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int pa_set_image(const unsigned char* rgb, int w, int h) {
    if (!rgb || w <= 0 || h <= 0)
        return kErrBadArg;
    g_w = w;
    g_h = h;
    g_img.assign(rgb, rgb + (size_t)w * h * 3);
    g_mask.assign((size_t)w * h, 0);
    g_result.clear();
    g_emb.clear();
    g_encoded = false;
    g_best = -1;
    for (int i = 0; i < kNumMaskTokens; ++i)
        g_iou[i] = 0.f;
    return kOk;
}

EMSCRIPTEN_KEEPALIVE int pa_width() {
    return g_w;
}

EMSCRIPTEN_KEEPALIVE int pa_height() {
    return g_h;
}

// MobileSAM encoder: one embedding per image, reused by every prompt.
EMSCRIPTEN_KEEPALIVE int pa_encode() {
    if (!g_enc.ready())
        return kErrNoModel;
    if (g_w <= 0 || g_h <= 0)
        return kErrNoImage;

    g_scale = (float)kImageSize / (float)std::max(g_w, g_h);
    g_rw = (int)std::lround(g_w * g_scale);
    g_rh = (int)std::lround(g_h * g_scale);

    std::vector<unsigned char> resized((size_t)g_rw * g_rh * 3);
    if (!resizeRgbU8(g_img.data(), g_w, g_h, resized.data(), g_rw, g_rh))
        return kErrInference;

    std::vector<float> tensor((size_t)3 * kImageSize * kImageSize, 0.f);
    for (int y = 0; y < g_rh; ++y) {
        for (int x = 0; x < g_rw; ++x) {
            const unsigned char* px = &resized[((size_t)y * g_rw + x) * 3];
            for (int c = 0; c < 3; ++c) {
                tensor[(size_t)c * kImageSize * kImageSize +
                       (size_t)y * kImageSize + x] =
                    ((float)px[c] - kPixelMean[c]) / kPixelStd[c];
            }
        }
    }

    if (!g_enc.setInput("image", {1, 3, kImageSize, kImageSize}, tensor.data()))
        return kErrInference;
    if (!g_enc.run())
        return kErrInference;

    std::vector<int> shape;
    if (!g_enc.getOutput("image_embeddings", g_emb, shape))
        return kErrInference;
    if (shape.size() != 4 || shape[1] != kEmbedDim || shape[2] != kEmbedSize ||
        shape[3] != kEmbedSize) {
        g_emb.clear();
        return kErrInference;
    }
    g_encoded = true;
    return kOk;
}

EMSCRIPTEN_KEEPALIVE int pa_encoded() {
    return g_encoded ? 1 : 0;
}

// Prompt tokens: one positive point per (x,y) in pts[0..npos), then negative
// points, then the box corners (labels 2/3) or the -1 padding token.
EMSCRIPTEN_KEEPALIVE int pa_segment(const float* pts, int npos, int nneg,
                                    const float* box, int hasBox, int force) {
    if (!g_dec.ready())
        return kErrNoModel;
    if (!g_encoded)
        return kErrNoImage;
    if (npos < 0 || nneg < 0)
        return kErrBadArg;
    const int npts = npos + nneg;
    if (npts == 0 && !hasBox)
        return kErrNoPrompt;

    struct Token {
        float x, y, label;
    };
    std::vector<Token> tokens;
    tokens.reserve((size_t)npts + 2);
    for (int i = 0; i < npts; ++i) {
        const float x =
            std::max(0.f, std::min(pts[2 * i + 0], (float)g_w - 1.f));
        const float y =
            std::max(0.f, std::min(pts[2 * i + 1], (float)g_h - 1.f));
        tokens.push_back({x, y, i < npos ? 1.f : 0.f});
    }
    if (hasBox) {
        const float x0 =
            std::max(0.f, std::min(std::min(box[0], box[2]), (float)g_w - 1.f));
        const float y0 =
            std::max(0.f, std::min(std::min(box[1], box[3]), (float)g_h - 1.f));
        const float x1 =
            std::max(0.f, std::min(std::max(box[0], box[2]), (float)g_w - 1.f));
        const float y1 =
            std::max(0.f, std::min(std::max(box[1], box[3]), (float)g_h - 1.f));
        tokens.push_back({x0, y0, 2.f});
        tokens.push_back({x1, y1, 3.f});
    } else {
        tokens.push_back({0.f, 0.f, -1.f});
    }

    const int n = (int)tokens.size();
    if (n > 64)
        return kErrBadArg;

    std::vector<float> coords((size_t)n * 2), labels((size_t)n);
    for (int i = 0; i < n; ++i) {
        coords[(size_t)i * 2 + 0] =
            (tokens[i].x * g_scale + 0.5f) / (float)kImageSize;
        coords[(size_t)i * 2 + 1] =
            (tokens[i].y * g_scale + 0.5f) / (float)kImageSize;
        labels[(size_t)i] = tokens[i].label;
    }

    if (!g_dec.resizeInput("point_coords", {1, n, 2}))
        return kErrInference;
    if (!g_dec.resizeInput("point_labels", {1, n}))
        return kErrInference;
    g_dec.commitResize();

    if (!g_dec.setInput("image_embeddings",
                        {1, kEmbedDim, kEmbedSize, kEmbedSize}, g_emb.data()))
        return kErrInference;
    if (!g_dec.setInput("point_coords", {1, n, 2}, coords.data()))
        return kErrInference;
    if (!g_dec.setInput("point_labels", {1, n}, labels.data()))
        return kErrInference;
    if (!g_dec.run())
        return kErrInference;

    std::vector<float> masks, iou;
    std::vector<int> maskShape, iouShape;
    if (!g_dec.getOutput("masks", masks, maskShape))
        return kErrInference;
    if (!g_dec.getOutput("iou_predictions", iou, iouShape))
        return kErrInference;
    if (maskShape.size() != 4 || maskShape[1] != kNumMaskTokens ||
        maskShape[2] != kMaskSize || maskShape[3] != kMaskSize) {
        return kErrInference;
    }
    for (int i = 0; i < kNumMaskTokens; ++i)
        g_iou[i] = iou.empty() ? 0.f : iou[i];

    int best = 1;
    if (force >= 0 && force < kNumMaskTokens) {
        best = force;
    } else {
        for (int i = 2; i < kNumMaskTokens; ++i)
            if (g_iou[i] > g_iou[best])
                best = i;
    }
    g_best = best;

    // 256 -> 1024 -> crop the unpadded area -> original resolution.
    std::vector<float> up((size_t)kImageSize * kImageSize);
    resizeBilinearF(&masks[(size_t)best * kMaskSize * kMaskSize], kMaskSize,
                    kMaskSize, up.data(), kImageSize, kImageSize);
    std::vector<float> crop((size_t)g_rw * g_rh);
    for (int y = 0; y < g_rh; ++y) {
        std::memcpy(&crop[(size_t)y * g_rw], &up[(size_t)y * kImageSize],
                    (size_t)g_rw * sizeof(float));
    }
    std::vector<float> full((size_t)g_w * g_h);
    resizeBilinearF(crop.data(), g_rw, g_rh, full.data(), g_w, g_h);

    g_mask.assign((size_t)g_w * g_h, 0);
    int area = 0;
    for (size_t i = 0; i < full.size(); ++i) {
        if (full[i] > 0.f) {
            g_mask[i] = 255;
            ++area;
        }
    }
    g_result.clear();
    return kOk;
}

EMSCRIPTEN_KEEPALIVE int pa_mask_area() {
    int area = 0;
    for (size_t i = 0; i < g_mask.size(); ++i)
        if (g_mask[i])
            ++area;
    return area;
}

EMSCRIPTEN_KEEPALIVE float pa_iou(int i) {
    return (i >= 0 && i < kNumMaskTokens) ? g_iou[i] : 0.f;
}

EMSCRIPTEN_KEEPALIVE int pa_best_token() {
    return g_best;
}

EMSCRIPTEN_KEEPALIVE unsigned char* pa_mask_ptr() {
    return g_mask.empty() ? nullptr : g_mask.data();
}

// Replace the mask from JavaScript (a 0/255 buffer of w*h bytes).
EMSCRIPTEN_KEEPALIVE int pa_set_mask(const unsigned char* mask) {
    if (!mask)
        return kErrBadArg;
    if (g_w <= 0 || g_h <= 0)
        return kErrNoImage;
    g_mask.assign(mask, mask + (size_t)g_w * g_h);
    for (size_t i = 0; i < g_mask.size(); ++i)
        g_mask[i] = g_mask[i] ? 255 : 0;
    g_result.clear();
    return kOk;
}

EMSCRIPTEN_KEEPALIVE int pa_clear_mask() {
    std::fill(g_mask.begin(), g_mask.end(), (unsigned char)0);
    g_result.clear();
    return kOk;
}

EMSCRIPTEN_KEEPALIVE unsigned char* pa_image_ptr() {
    return g_img.empty() ? nullptr : g_img.data();
}

EMSCRIPTEN_KEEPALIVE unsigned char* pa_result_ptr() {
    return g_result.empty() ? nullptr : g_result.data();
}

// The alpha pa_fill used, so a layer can be updated with exactly the same edge.
EMSCRIPTEN_KEEPALIVE unsigned char* pa_used_alpha_ptr() {
    return g_usedAlpha.empty() ? nullptr : g_usedAlpha.data();
}

// fullImage != 0 reproduces the native demo exactly (whole image fitted into
// S x S with symmetric padding).  Otherwise the mask's bounding box selects a
// square region that is resampled to S x S, so a small hole is inpainted at
// (close to) native resolution instead of a downscaled whole frame.
EMSCRIPTEN_KEEPALIVE int pa_fill(int dilate, int feather, int fullImage) {
    if (!g_lama.ready())
        return kErrNoModel;
    if (g_w <= 0 || g_h <= 0)
        return kErrNoImage;

    MNN::Tensor* in = g_lama.input("image_mask");
    if (!in || in->dimensions() != 4 || in->length(0) != 1 ||
        in->length(1) != 4 || in->length(2) != in->length(3)) {
        return kErrInference;
    }
    const int S = in->length(2);

    std::vector<unsigned char> mask(g_mask);
    int area = 0;
    for (size_t i = 0; i < mask.size(); ++i)
        if (mask[i])
            ++area;
    if (area == 0)
        return kErrEmptyMask;

    dilate = std::max(0, std::min(dilate, 128));
    feather = std::max(0, std::min(feather, 32));
    dilateMask(mask, g_w, g_h, dilate);

    int bx0, by0, bx1, by1;
    if (!computeBBox(mask, g_w, g_h, bx0, by0, bx1, by1))
        return kErrEmptyMask;

    const int bw = bx1 - bx0 + 1;
    const int bh = by1 - by0 + 1;
    const int longest = std::max(g_w, g_h);

    // A square around the mask with breathing room for the model's context.
    int side = (int)std::lround((float)std::max(bw, bh) * 1.7f);
    side = std::max(side, 128);
    const bool useFull = fullImage != 0 || side >= longest;

    std::vector<unsigned char> srcRgb, srcMask;
    int srcW = 0, srcH = 0; // region size in the original image
    int offX = 0, offY = 0; // region offset in the original image
    int fitW = 0, fitH = 0; // region after the resize to the model

    if (useFull) {
        const float scale =
            std::min((float)S / (float)g_w, (float)S / (float)g_h);
        fitW = std::max(1, (int)std::lround(g_w * scale));
        fitH = std::max(1, (int)std::lround(g_h * scale));
        srcW = g_w;
        srcH = g_h;
        srcRgb = g_img;
        srcMask = mask;
        side = 0; // unused in the padded path
    } else {
        side = std::min(side, longest);
        int cx = (bx0 + bx1) / 2;
        int cy = (by0 + by1) / 2;
        int sx = cx - side / 2;
        int sy = cy - side / 2;
        sx = std::max(0, std::min(sx, g_w - side));
        sy = std::max(0, std::min(sy, g_h - side));
        offX = sx;
        offY = sy;
        srcW = side;
        srcH = side;
        fitW = S;
        fitH = S;
        srcRgb.resize((size_t)srcW * srcH * 3);
        srcMask.resize((size_t)srcW * srcH);
        for (int y = 0; y < srcH; ++y) {
            std::memcpy(&srcRgb[(size_t)y * srcW * 3],
                        &g_img[((size_t)(sy + y) * g_w + sx) * 3],
                        (size_t)srcW * 3);
            std::memcpy(&srcMask[(size_t)y * srcW],
                        &mask[(size_t)(sy + y) * g_w + sx], (size_t)srcW);
        }
    }

    std::vector<unsigned char> fitRgb((size_t)fitW * fitH * 3);
    if (!resizeRgbU8(srcRgb.data(), srcW, srcH, fitRgb.data(), fitW, fitH))
        return kErrInference;
    std::vector<unsigned char> fitMask((size_t)fitW * fitH);
    resizeMaskNearest(srcMask.data(), srcW, srcH, fitMask.data(), fitW, fitH);

    // 4 channels: RGB*(1-m), m.  The padded path mirrors the region with
    // symmetric padding and keeps the padding mask at 0.
    std::vector<float> tensor((size_t)4 * S * S, 0.f);
    const size_t plane = (size_t)S * S;
    for (int y = 0; y < S; ++y) {
        const int sy = useFull ? reflectSymmetric(y, fitH) : y;
        for (int x = 0; x < S; ++x) {
            const int sx = useFull ? reflectSymmetric(x, fitW) : x;
            const bool inside = useFull ? (x < fitW && y < fitH) : true;
            const float m =
                inside ? (fitMask[(size_t)sy * fitW + sx] ? 1.f : 0.f) : 0.f;
            const unsigned char* px = &fitRgb[((size_t)sy * fitW + sx) * 3];
            const float keep = 1.f - m;
            tensor[(size_t)0 * plane + (size_t)y * S + x] =
                (px[0] / 255.f) * keep;
            tensor[(size_t)1 * plane + (size_t)y * S + x] =
                (px[1] / 255.f) * keep;
            tensor[(size_t)2 * plane + (size_t)y * S + x] =
                (px[2] / 255.f) * keep;
            tensor[(size_t)3 * plane + (size_t)y * S + x] = m;
        }
    }

    if (!g_lama.setInput("image_mask", {1, 4, S, S}, tensor.data()))
        return kErrInference;
    if (!g_lama.run())
        return kErrInference;

    std::vector<float> pred;
    std::vector<int> predShape;
    if (!g_lama.getOutput("inpainted", pred, predShape))
        return kErrInference;
    if (predShape.size() != 4 || predShape[1] != 3 || predShape[2] != S ||
        predShape[3] != S) {
        return kErrInference;
    }

    // Prediction -> uint8 at the model's fit resolution.
    std::vector<unsigned char> fitPred((size_t)fitW * fitH * 3);
    for (int y = 0; y < fitH; ++y) {
        for (int x = 0; x < fitW; ++x) {
            for (int c = 0; c < 3; ++c) {
                float v = pred[(size_t)c * plane + (size_t)y * S + x];
                v = std::max(0.f, std::min(1.f, v));
                fitPred[((size_t)y * fitW + x) * 3 + c] =
                    (unsigned char)std::lround(v * 255.f);
            }
        }
    }

    g_result.assign(g_img.begin(), g_img.end());
    if (useFull) {
        // Resize the valid top-left crop back to the original resolution, then
        // composite through the mask over the whole image.
        std::vector<unsigned char> fullPred((size_t)g_w * g_h * 3);
        if (!resizeRgbU8(fitPred.data(), fitW, fitH, fullPred.data(), g_w, g_h))
            return kErrInference;
        std::vector<float> alpha((size_t)g_w * g_h);
        for (size_t i = 0; i < alpha.size(); ++i)
            alpha[i] = mask[i] ? 1.f : 0.f;
        blurAlpha(alpha, g_w, g_h, feather);
        g_usedAlpha.assign((size_t)g_w * g_h, 0);
        for (size_t i = 0; i < alpha.size(); ++i) {
            const float a = std::max(0.f, std::min(1.f, alpha[i]));
            g_usedAlpha[i] = (unsigned char)std::lround(a * 255.f);
            if (a <= 0.f)
                continue;
            for (int c = 0; c < 3; ++c) {
                const float v =
                    g_img[i * 3 + c] * (1.f - a) + fullPred[i * 3 + c] * a;
                g_result[i * 3 + c] = (unsigned char)std::lround(v);
            }
        }
    } else {
        // Composite only inside the crop, through the (dilated) mask.
        std::vector<unsigned char> regionPred((size_t)srcW * srcH * 3);
        if (!resizeRgbU8(fitPred.data(), fitW, fitH, regionPred.data(), srcW,
                         srcH))
            return kErrInference;
        std::vector<float> alpha((size_t)srcW * srcH);
        for (size_t i = 0; i < alpha.size(); ++i)
            alpha[i] = srcMask[i] ? 1.f : 0.f;
        blurAlpha(alpha, srcW, srcH, feather);
        g_usedAlpha.assign((size_t)g_w * g_h, 0);
        for (int y = 0; y < srcH; ++y) {
            for (int x = 0; x < srcW; ++x) {
                const size_t ri = (size_t)y * srcW + x;
                const float a = std::max(0.f, std::min(1.f, alpha[ri]));
                g_usedAlpha[(size_t)(offY + y) * g_w + (offX + x)] =
                    (unsigned char)std::lround(a * 255.f);
                if (a <= 0.f)
                    continue;
                const size_t gi = (size_t)(offY + y) * g_w + (offX + x);
                for (int c = 0; c < 3; ++c) {
                    const float v = g_img[gi * 3 + c] * (1.f - a) +
                                    regionPred[ri * 3 + c] * a;
                    g_result[gi * 3 + c] = (unsigned char)std::lround(v);
                }
            }
        }
    }
    // The document lives in the browser now: the caller paints the result into
    // a layer and sends the new composite back, which re-encodes the embedding.
    return kOk;
}

// The UI asks which path a fill would take so the panel can describe the run
// as a local patch or a full-image pass before it starts.
EMSCRIPTEN_KEEPALIVE int pa_fill_region(int dilate, int* out) {
    if (g_w <= 0 || g_h <= 0)
        return kErrNoImage;
    MNN::Tensor* in = g_lama.ready() ? g_lama.input("image_mask") : nullptr;
    const int S = (in && in->dimensions() == 4) ? in->length(2) : 512;

    std::vector<unsigned char> mask(g_mask);
    int area = 0;
    for (size_t i = 0; i < mask.size(); ++i)
        if (mask[i])
            ++area;
    if (area == 0)
        return kErrEmptyMask;
    dilateMask(mask, g_w, g_h, std::max(0, std::min(dilate, 128)));

    int bx0, by0, bx1, by1;
    if (!computeBBox(mask, g_w, g_h, bx0, by0, bx1, by1))
        return kErrEmptyMask;
    const int longest = std::max(g_w, g_h);
    int side =
        (int)std::lround((float)std::max(bx1 - bx0 + 1, by1 - by0 + 1) * 1.7f);
    side = std::max(side, 128);
    const bool useFull = side >= longest;
    if (useFull) {
        const float scale =
            std::min((float)S / (float)g_w, (float)S / (float)g_h);
        out[0] = 1;
        out[1] = S;
        out[2] = std::max(1, (int)std::lround(g_w * scale));
        out[3] = std::max(1, (int)std::lround(g_h * scale));
    } else {
        side = std::min(side, longest);
        out[0] = 0;
        out[1] = S;
        out[2] = side;
        out[3] = side;
    }
    return kOk;
}

} // extern "C"
