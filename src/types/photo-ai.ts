// SPDX-License-Identifier: Apache-2.0
/// The C ABI exported by native/photo_ai.cpp through Emscripten.

export interface PhotoAIModule {
  HEAPU8: Uint8Array
  HEAP32: Int32Array
  HEAPF32: Float32Array
  _malloc(size: number): number
  _free(ptr: number): void

  _pa_load_sam(enc: number, encLen: number, dec: number, decLen: number): number
  _pa_load_lama(data: number, len: number): number
  _pa_unload_lama(): number
  _pa_sam_ready(): number
  _pa_lama_ready(): number
  _pa_encoded(): number

  _pa_set_image(rgb: number, w: number, h: number): number
  _pa_width(): number
  _pa_height(): number
  _pa_image_ptr(): number
  _pa_encode(): number
  _pa_segment(
    pts: number,
    npos: number,
    nneg: number,
    box: number,
    hasBox: number,
    force: number,
  ): number
  _pa_mask_area(): number
  _pa_iou(i: number): number
  _pa_best_token(): number
  _pa_mask_ptr(): number
  _pa_set_mask(mask: number): number
  _pa_clear_mask(): number
  _pa_fill(dilate: number, feather: number, fullImage: number): number
  _pa_result_ptr(): number
  _pa_used_alpha_ptr(): number
  _pa_fill_region(dilate: number, out: number): number
}

export interface PhotoAIInitOptions {
  locateFile?: (path: string, prefix: string) => string
}

export type CreatePhotoAI = (options?: PhotoAIInitOptions) => Promise<PhotoAIModule>
