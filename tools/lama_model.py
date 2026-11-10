# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The PhotoAI Authors
# The LaMa generator architecture is reimplemented from
# https://github.com/advimman/lama (Apache-2.0); see THIRD_PARTY_NOTICES.md.
"""Standalone LaMa (big-lama) generator used by the ModelScope checkpoint.

The ModelScope model `iic/cv_fft_inpainting_lama` stores a training module whose
generator is an FFC-ResNet (LaMa).  This file re-implements that generator with
the exact module/parameter names, so the checkpoint can be loaded strictly.

Two FourierUnit implementations are provided:

* ``fft_mode="torch"``  -- torch.fft, used as the numerical reference.
* ``fft_mode="dft"``    -- separable real DFT built from fixed cosine/sine
  matrices and matmuls.  MNN has no ONNX DFT operator, while it does support
  MatMul, so this is the version exported to ONNX/MNN.  A fixed spatial size is
  required (LaMa's FFC path is fully convolutional, but the exported DFT basis
  is baked for one bottleneck resolution).
"""
import math
import os

import torch
import torch.nn as nn

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".work")


def _dft_matrices(n, dtype=torch.float32):
    """Return cos/sin matrices for an orthonormal n-point DFT.

    X[k] = sum_t x[t] * exp(-2*pi*i*k*t/n) / sqrt(n)
    """
    k = torch.arange(n, dtype=dtype).view(n, 1)
    t = torch.arange(n, dtype=dtype).view(1, n)
    ang = (2.0 * math.pi / n) * (k * t)
    inv_sqrt = 1.0 / math.sqrt(float(n))
    return torch.cos(ang) * inv_sqrt, torch.sin(ang) * inv_sqrt


class FourierUnit(nn.Module):
    def __init__(self, in_channels, out_channels, groups=1, fft_hw=None,
                 fft_mode="torch"):
        super().__init__()
        self.groups = groups
        self.fft_mode = fft_mode
        self.fft_hw = fft_hw
        self.conv_layer = nn.Conv2d(
            in_channels=in_channels * 2,
            out_channels=out_channels * 2,
            kernel_size=1,
            stride=1,
            padding=0,
            groups=groups,
            bias=False,
        )
        self.bn = nn.BatchNorm2d(out_channels * 2)
        self.relu = nn.ReLU(inplace=True)
        if fft_mode == "dft":
            if fft_hw is None:
                raise ValueError("fft_hw is required for dft mode")
            h, w = fft_hw
            cos_h, sin_h = _dft_matrices(h)
            cos_w, sin_w = _dft_matrices(w)
            self.register_buffer("cos_h", cos_h, persistent=False)
            self.register_buffer("sin_h", sin_h, persistent=False)
            self.register_buffer("cos_w", cos_w, persistent=False)
            self.register_buffer("sin_w", sin_w, persistent=False)

    # ---- real 2-D DFT helpers (fixed H/W) --------------------------------
    def _rfft2(self, x):
        b, c, h, w = x.shape
        # DFT along width: [B*C*H, W] @ [W, F]
        xr = x.reshape(b * c * h, w)
        f = w // 2 + 1
        re_w = xr.matmul(self.cos_w[:f].t())      # [B*C*H, F]
        im_w = xr.matmul(-self.sin_w[:f].t())
        re_w = re_w.reshape(b, c, h, -1)
        im_w = im_w.reshape(b, c, h, -1)
        # DFT along height (on real/imag of the width transform)
        f = re_w.shape[-1]
        a = re_w.permute(0, 1, 3, 2).reshape(b * c * f, h)
        bb = im_w.permute(0, 1, 3, 2).reshape(b * c * f, h)
        re = a.matmul(self.cos_h.t()) + bb.matmul(self.sin_h.t())
        im = bb.matmul(self.cos_h.t()) - a.matmul(self.sin_h.t())
        re = re.reshape(b, c, f, h).permute(0, 1, 3, 2)
        im = im.reshape(b, c, f, h).permute(0, 1, 3, 2)
        return re, im

    def _irfft2(self, re, im, out_w):
        b, c, h, f = re.shape
        # Rebuild the full Hermitian spectrum.  rfft returns F = W//2+1 bins;
        # the Nyquist bin is self-conjugate, so mirror bins 1 .. W//2-1.
        nyq = out_w // 2
        # Negative frequency k' = -k mod H, i.e. flip followed by a cyclic
        # roll by one; l' = -l for l=1..W/2-1, hence flip the width order.
        rr = re[..., 1:nyq]
        ri = -im[..., 1:nyq]
        rr = torch.flip(torch.roll(torch.flip(rr, dims=(-2,)), shifts=1,
                                   dims=(-2,)), dims=(-1,))
        ri = torch.flip(torch.roll(torch.flip(ri, dims=(-2,)), shifts=1,
                                   dims=(-2,)), dims=(-1,))
        re = torch.cat((re, rr), dim=-1)
        im = torch.cat((im, ri), dim=-1)
        # inverse DFT along height: exp(+i*theta)
        w = re.shape[-1]
        a = re.permute(0, 1, 3, 2).reshape(b * c * w, h)
        bb = im.permute(0, 1, 3, 2).reshape(b * c * w, h)
        ur = a.matmul(self.cos_h.t()) - bb.matmul(self.sin_h.t())
        ui = a.matmul(self.sin_h.t()) + bb.matmul(self.cos_h.t())
        ur = ur.reshape(b, c, w, h).permute(0, 1, 3, 2)
        ui = ui.reshape(b, c, w, h).permute(0, 1, 3, 2)
        # inverse DFT along width, keep the real part
        ur = ur.reshape(b * c * h, out_w)
        ui = ui.reshape(b * c * h, out_w)
        out = ur.matmul(self.cos_w.t()) - ui.matmul(self.sin_w.t())
        return out.reshape(b, c, h, out_w)

    def forward(self, x):
        batch = x.shape[0]
        if self.fft_mode == "torch":
            ffted = torch.fft.rfftn(x, dim=(-2, -1), norm="ortho")
            ffted = torch.stack((ffted.real, ffted.imag), dim=-1)
            ffted = ffted.permute(0, 1, 4, 2, 3).contiguous()
            ffted = ffted.view((batch, -1) + ffted.size()[3:])
            ffted = self.conv_layer(ffted)
            ffted = self.relu(self.bn(ffted))
            ffted = ffted.view((batch, -1, 2) + ffted.size()[2:])
            ffted = ffted.permute(0, 1, 3, 4, 2).contiguous()
            ffted = torch.complex(ffted[..., 0], ffted[..., 1])
            return torch.fft.irfftn(ffted, s=x.shape[-2:], dim=(-2, -1),
                                    norm="ortho")
        # fixed-size real DFT path
        re, im = self._rfft2(x)
        ffted = torch.stack((re, im), dim=2).reshape(batch, -1,
                                                     x.shape[-2],
                                                     re.shape[-1])
        ffted = self.conv_layer(ffted)
        ffted = self.relu(self.bn(ffted))
        ffted = ffted.reshape(batch, -1, 2, x.shape[-2], re.shape[-1])
        re, im = ffted[:, :, 0], ffted[:, :, 1]
        return self._irfft2(re, im, x.shape[-1])


class SpectralTransform(nn.Module):
    def __init__(self, in_channels, out_channels, stride=1, groups=1,
                 enable_lfu=True, **fu_kwargs):
        super().__init__()
        self.enable_lfu = enable_lfu
        self.downsample = (nn.AvgPool2d(kernel_size=(2, 2), stride=2)
                           if stride == 2 else nn.Identity())
        self.stride = stride
        self.conv1 = nn.Sequential(
            nn.Conv2d(in_channels, out_channels // 2, kernel_size=1,
                      groups=groups, bias=False),
            nn.BatchNorm2d(out_channels // 2),
            nn.ReLU(inplace=True),
        )
        self.fu = FourierUnit(out_channels // 2, out_channels // 2, groups,
                              **fu_kwargs)
        if enable_lfu:
            self.lfu = FourierUnit(out_channels // 2, out_channels // 2,
                                   groups, **fu_kwargs)
        self.conv2 = nn.Conv2d(out_channels // 2, out_channels, kernel_size=1,
                               groups=groups, bias=False)

    def forward(self, x):
        x = self.downsample(x)
        x = self.conv1(x)
        output = self.fu(x)
        if self.enable_lfu:
            n, c, h, w = x.shape
            split_no = 2
            split_s = h // split_no
            xs = torch.cat(torch.split(x[:, :c // 4], split_s, dim=-2),
                           dim=1).contiguous()
            xs = torch.cat(torch.split(xs, split_s, dim=-1), dim=1).contiguous()
            xs = self.lfu(xs)
            xs = xs.repeat(1, 1, split_no, split_no).contiguous()
        else:
            xs = 0
        return self.conv2(x + output + xs)


class FFC(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size, ratio_gin,
                 ratio_gout, stride=1, padding=0, dilation=1, groups=1,
                 bias=False, enable_lfu=True, padding_type="reflect",
                 gated=False, **spectral_kwargs):
        super().__init__()
        assert stride in (1, 2)
        self.stride = stride
        in_cg = int(in_channels * ratio_gin)
        in_cl = in_channels - in_cg
        out_cg = int(out_channels * ratio_gout)
        out_cl = out_channels - out_cg
        self.ratio_gin = ratio_gin
        self.ratio_gout = ratio_gout
        self.global_in_num = in_cg

        conv = lambda i, o: nn.Conv2d(
            i, o, kernel_size, stride, padding, dilation, groups, bias,
            padding_mode=padding_type)
        self.convl2l = nn.Identity() if in_cl == 0 or out_cl == 0 else conv(in_cl, out_cl)
        self.convl2g = nn.Identity() if in_cl == 0 or out_cg == 0 else conv(in_cl, out_cg)
        self.convg2l = nn.Identity() if in_cg == 0 or out_cl == 0 else conv(in_cg, out_cl)
        if in_cg == 0 or out_cg == 0:
            self.convg2g = nn.Identity()
        else:
            self.convg2g = SpectralTransform(
                in_cg, out_cg, stride, 1 if groups == 1 else groups // 2,
                enable_lfu, **spectral_kwargs)
        self.gated = gated
        self.gate = (nn.Identity() if in_cg == 0 or out_cl == 0 or not gated
                     else nn.Conv2d(in_channels, 2, 1))

    def forward(self, x):
        x_l, x_g = x if type(x) is tuple else (x, 0)
        out_xl, out_xg = 0, 0
        if self.gated:
            parts = [x_l] + ([x_g] if torch.is_tensor(x_g) else [])
            gates = torch.sigmoid(self.gate(torch.cat(parts, dim=1)))
            g2l_gate, l2g_gate = gates.chunk(2, dim=1)
        else:
            g2l_gate, l2g_gate = 1, 1
        if self.ratio_gout != 1:
            out_xl = self.convl2l(x_l) + self.convg2l(x_g) * g2l_gate
        if self.ratio_gout != 0:
            out_xg = self.convl2g(x_l) * l2g_gate + self.convg2g(x_g)
        return out_xl, out_xg


class FFC_BN_ACT(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size, ratio_gin,
                 ratio_gout, stride=1, padding=0, dilation=1, groups=1,
                 bias=False, norm_layer=nn.BatchNorm2d,
                 activation_layer=nn.ReLU, padding_type="reflect",
                 enable_lfu=True, **kwargs):
        super().__init__()
        self.ffc = FFC(in_channels, out_channels, kernel_size, ratio_gin,
                       ratio_gout, stride, padding, dilation, groups, bias,
                       enable_lfu, padding_type=padding_type, **kwargs)
        lnorm = nn.Identity if ratio_gout == 1 else norm_layer
        gnorm = nn.Identity if ratio_gout == 0 else norm_layer
        global_channels = int(out_channels * ratio_gout)
        self.bn_l = lnorm(out_channels - global_channels)
        self.bn_g = gnorm(global_channels)
        lact = nn.Identity if ratio_gout == 1 else activation_layer
        gact = nn.Identity if ratio_gout == 0 else activation_layer
        self.act_l = lact(inplace=True)
        self.act_g = gact(inplace=True)

    def forward(self, x):
        x_l, x_g = self.ffc(x)
        x_l = self.act_l(self.bn_l(x_l))
        x_g = self.act_g(self.bn_g(x_g))
        return x_l, x_g


class FFCResnetBlock(nn.Module):
    def __init__(self, dim, padding_type, norm_layer, activation_layer=nn.ReLU,
                 dilation=1, spatial_transform_kwargs=None, inline=False,
                 **conv_kwargs):
        super().__init__()
        self.conv1 = FFC_BN_ACT(
            dim, dim, kernel_size=3, padding=dilation, dilation=dilation,
            norm_layer=norm_layer, activation_layer=activation_layer,
            padding_type=padding_type, **conv_kwargs)
        self.conv2 = FFC_BN_ACT(
            dim, dim, kernel_size=3, padding=dilation, dilation=dilation,
            norm_layer=norm_layer, activation_layer=activation_layer,
            padding_type=padding_type, **conv_kwargs)
        self.inline = inline

    def forward(self, x):
        if self.inline:
            n = self.conv1.ffc.global_in_num
            x_l, x_g = x[:, :-n], x[:, -n:]
        else:
            x_l, x_g = x if type(x) is tuple else (x, 0)
        id_l, id_g = x_l, x_g
        x_l, x_g = self.conv1((x_l, x_g))
        x_l, x_g = self.conv2((x_l, x_g))
        x_l, x_g = id_l + x_l, id_g + x_g
        return torch.cat((x_l, x_g), dim=1) if self.inline else (x_l, x_g)


class ConcatTupleLayer(nn.Module):
    def forward(self, x):
        x_l, x_g = x
        if not torch.is_tensor(x_g):
            return x_l
        return torch.cat(x, dim=1)


class FFCResNetGenerator(nn.Module):
    def __init__(self, input_nc=4, output_nc=3, ngf=64, n_downsampling=3,
                 n_blocks=18, norm_layer=nn.BatchNorm2d,
                 padding_type="reflect", activation_layer=nn.ReLU,
                 up_norm_layer=nn.BatchNorm2d, up_activation=nn.ReLU(True),
                 add_out_act="sigmoid", max_features=1024, out_ffc=False,
                 fft_hw=None, fft_mode="torch"):
        super().__init__()
        init_conv_kwargs = dict(ratio_gin=0, ratio_gout=0, enable_lfu=False,
                                fft_hw=fft_hw, fft_mode=fft_mode)
        downsample_conv_kwargs = dict(ratio_gin=0, ratio_gout=0,
                                      enable_lfu=False, fft_hw=fft_hw,
                                      fft_mode=fft_mode)
        resnet_conv_kwargs = dict(ratio_gin=0.75, ratio_gout=0.75,
                                  enable_lfu=False, fft_hw=fft_hw,
                                  fft_mode=fft_mode)
        model = [
            nn.ReflectionPad2d(3),
            FFC_BN_ACT(input_nc, ngf, kernel_size=7, padding=0,
                       norm_layer=norm_layer, activation_layer=activation_layer,
                       **init_conv_kwargs),
        ]
        for i in range(n_downsampling):
            mult = 2 ** i
            if i == n_downsampling - 1:
                cur = dict(downsample_conv_kwargs)
                cur["ratio_gout"] = resnet_conv_kwargs.get("ratio_gin", 0)
            else:
                cur = downsample_conv_kwargs
            model += [FFC_BN_ACT(
                min(max_features, ngf * mult),
                min(max_features, ngf * mult * 2),
                kernel_size=3, stride=2, padding=1, norm_layer=norm_layer,
                activation_layer=activation_layer, **cur)]
        mult = 2 ** n_downsampling
        feats = min(max_features, ngf * mult)
        for _ in range(n_blocks):
            model += [FFCResnetBlock(
                feats, padding_type=padding_type,
                activation_layer=activation_layer, norm_layer=norm_layer,
                **resnet_conv_kwargs)]
        model += [ConcatTupleLayer()]
        for i in range(n_downsampling):
            mult = 2 ** (n_downsampling - i)
            model += [
                nn.ConvTranspose2d(min(max_features, ngf * mult),
                                   min(max_features, int(ngf * mult / 2)),
                                   kernel_size=3, stride=2, padding=1,
                                   output_padding=1),
                up_norm_layer(min(max_features, int(ngf * mult / 2))),
                up_activation,
            ]
        if out_ffc:
            model += [FFCResnetBlock(ngf, padding_type=padding_type,
                                     activation_layer=activation_layer,
                                     norm_layer=norm_layer, inline=True,
                                     **resnet_conv_kwargs)]
        model += [nn.ReflectionPad2d(3),
                  nn.Conv2d(ngf, output_nc, kernel_size=7, padding=0),
                  nn.Sigmoid()]
        self.model = nn.Sequential(*model)

    def forward(self, x):
        return self.model(x)


def load_generator(checkpoint, input_size=256, fft_mode="torch", device="cpu"):
    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=False)
    if isinstance(ckpt, dict) and "generator" in ckpt and not any(
            k.startswith("generator.") for k in ckpt):
        ckpt = ckpt["generator"]
    if any(k.startswith("generator.") for k in ckpt):
        state = {k[len("generator."):]: v for k, v in ckpt.items()
                 if k.startswith("generator.")}
    else:
        state = dict(ckpt)
    model = FFCResNetGenerator(fft_hw=(input_size // 8, input_size // 8),
                               fft_mode=fft_mode)
    model.load_state_dict(state, strict=True)
    model.eval().to(device)
    return model


if __name__ == "__main__":
    import argparse
    import time

    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint",
                    default=os.path.join(WORK, "pytorch_model.pt"))
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--mode", choices=["torch", "dft"], default="torch")
    args = ap.parse_args()
    m = load_generator(args.checkpoint, args.size, args.mode)
    n = sum(p.numel() for p in m.parameters())
    print(f"generator params: {n/1e6:.2f} M")
    x = torch.randn(1, 4, args.size, args.size)
    with torch.no_grad():
        t = time.time()
        y = m(x)
        print("out", tuple(y.shape), float(y.min()), float(y.max()),
              f"{(time.time()-t)*1000:.0f} ms")
