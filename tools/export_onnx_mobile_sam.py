#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 zhengxyz123
# MobileSAM is Copyright the MobileSAM authors and licensed under Apache-2.0.
"""Export MobileSAM (TinyViT) to two ONNX graphs for MNN conversion.

  encoder.onnx : image  [1,3,1024,1024] -> image_embeddings [1,256,64,64]
  decoder.onnx : image_embeddings, point_coords [1,N,2], point_labels [1,N]
                 -> masks [1,4,256,256] (logits), iou_predictions [1,4]

The decoder accepts a variable number of prompt tokens (dynamic axis 1):

  * point prompt:      label 1 (positive) / 0 (negative)
  * box prompt:        two corners with label 2 (top-left) and 3 (bottom-right)
  * padding token:     label -1, appended by the caller when no box is given
                       (this mirrors PromptEncoder.forward's pad=(boxes is None))

Mask-input prompts are intentionally left out so the graph stays small.
Coordinates are normalized to the 1024x1024 padded input frame:
    x_norm = (x_resized + 0.5) / 1024
"""

import argparse
import os
import sys
import warnings

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".work")
sys.path.insert(0, os.path.join(HERE, "third_party", "MobileSAM"))

from mobile_sam import sam_model_registry  # noqa: E402


class EncoderWrapper(nn.Module):
    def __init__(self, sam):
        super().__init__()
        self.image_encoder = sam.image_encoder

    def forward(self, image):
        return self.image_encoder(image)


class DecoderWrapper(nn.Module):
    """Prompt encoder (points / box corners) + mask decoder, dynamic N tokens."""

    def __init__(self, sam):
        super().__init__()
        self.prompt_encoder = sam.prompt_encoder
        self.mask_decoder = sam.mask_decoder
        self.img_size = float(sam.image_encoder.img_size)

    def _embed_points(self, point_coords, point_labels):
        pe = self.prompt_encoder.pe_layer._pe_encoding(point_coords)
        labels = point_labels.unsqueeze(-1).expand_as(pe)

        # labels: -1 padding, 0 negative point, 1 positive point,
        #         2/3 top-left / bottom-right box corner
        out = pe * (labels != -1).float()
        out = (
            out + self.prompt_encoder.not_a_point_embed.weight * (labels == -1).float()
        )
        for i in range(self.prompt_encoder.num_point_embeddings):
            out = (
                out
                + self.prompt_encoder.point_embeddings[i].weight * (labels == i).float()
            )
        return out

    def forward(self, image_embeddings, point_coords, point_labels):
        sparse = self._embed_points(point_coords, point_labels)
        # no mask prompt: dense embedding is just the learned "no mask" token
        dense = self.prompt_encoder.no_mask_embed.weight.reshape(1, -1, 1, 1)
        dense = dense.expand(
            image_embeddings.shape[0],
            -1,
            image_embeddings.shape[2],
            image_embeddings.shape[3],
        )
        masks, iou = self.mask_decoder.predict_masks(
            image_embeddings=image_embeddings,
            image_pe=self.prompt_encoder.get_dense_pe(),
            sparse_prompt_embeddings=sparse,
            dense_prompt_embeddings=dense,
        )
        return masks, iou


def export_onnx(module, args, path, input_names, output_names, dynamic_axes=None):
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore")
        torch.onnx.export(
            module,
            args,
            path,
            export_params=True,
            verbose=False,
            opset_version=17,
            do_constant_folding=True,
            input_names=input_names,
            output_names=output_names,
            dynamic_axes=dynamic_axes,
            dynamo=False,
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=os.path.join(WORK, "mobile_sam.pt"))
    ap.add_argument("--out-dir", default=os.path.join(WORK, "onnx"))
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    torch.manual_seed(0)

    print("loading MobileSAM ...")
    sam = sam_model_registry["vit_t"](checkpoint=args.checkpoint)
    sam.eval()

    encoder = EncoderWrapper(sam).eval()
    decoder = DecoderWrapper(sam).eval()

    dummy_image = torch.randn(1, 3, 1024, 1024)
    dummy_emb = torch.randn(1, 256, 64, 64)
    # 3 tokens: positive point, box corner 2, box corner 3 (only a tracing shape)
    dummy_coords = torch.tensor(
        [[[0.5, 0.3], [0.2, 0.7], [0.8, 0.9]]], dtype=torch.float32
    )
    dummy_labels = torch.tensor([[1.0, 2.0, 3.0]], dtype=torch.float32)

    enc_path = os.path.join(args.out_dir, "mobile_sam_encoder.onnx")
    dec_path = os.path.join(args.out_dir, "mobile_sam_decoder.onnx")

    print("exporting encoder ...")
    with torch.no_grad():
        ref_emb = encoder(dummy_image)
        ref_masks, ref_iou = decoder(dummy_emb, dummy_coords, dummy_labels)
    export_onnx(encoder, (dummy_image,), enc_path, ["image"], ["image_embeddings"])
    print("exporting decoder (dynamic num_points) ...")
    export_onnx(
        decoder,
        (dummy_emb, dummy_coords, dummy_labels),
        dec_path,
        ["image_embeddings", "point_coords", "point_labels"],
        ["masks", "iou_predictions"],
        dynamic_axes={
            "point_coords": {1: "num_points"},
            "point_labels": {1: "num_points"},
        },
    )

    # sanity check with onnxruntime
    import onnxruntime as ort

    sess = ort.InferenceSession(enc_path, providers=["CPUExecutionProvider"])
    emb = sess.run(None, {"image": dummy_image.numpy()})[0]
    sess2 = ort.InferenceSession(dec_path, providers=["CPUExecutionProvider"])
    masks, iou = sess2.run(
        None,
        {
            "image_embeddings": dummy_emb.numpy(),
            "point_coords": dummy_coords.numpy(),
            "point_labels": dummy_labels.numpy(),
        },
    )
    print(
        "encoder out",
        emb.shape,
        "max err vs torch",
        np.abs(emb - ref_emb.numpy()).max(),
    )
    print(
        "decoder masks",
        masks.shape,
        "iou",
        iou.shape,
        "max err",
        np.abs(masks - ref_masks.numpy()).max(),
    )
    print("saved:", enc_path, dec_path)


if __name__ == "__main__":
    main()
