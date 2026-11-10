/// The message protocol between the editor and the inference worker.

import type { PromptBox, PromptPoint } from './editor'

export type ModelName = 'sam' | 'lama'

export type WorkerRequest =
  | { type: 'init' }
  | {
      type: 'composite'
      width: number
      height: number
      rgb: Uint8Array
      reason: string
    }
  | { type: 'segment'; points: PromptPoint[]; box: PromptBox | null }
  | { type: 'region'; dilate: number; mask: ArrayBuffer }
  | { type: 'fill'; dilate: number; feather: number; mask: ArrayBuffer }

export type WorkerResponse =
  | { type: 'wasm-ready' }
  | { type: 'ready' }
  | { type: 'model-start'; which: ModelName }
  | { type: 'model-progress'; which: ModelName; loaded: number; total: number }
  | { type: 'sam-ready'; ms: number; bytes: number }
  | { type: 'lama-ready'; ms: number; bytes: number }
  | { type: 'encoded'; ms: number; width: number; height: number; reason: string }
  | {
      type: 'mask'
      mask: ArrayBuffer
      area: number
      iou: number[]
      best: number
      ms: number
    }
  | { type: 'region'; local: boolean | null; size: number | null; region: number | null }
  | {
      type: 'filled'
      rgb: ArrayBuffer
      alpha: ArrayBuffer
      width: number
      height: number
      ms: number
    }
  | { type: 'error'; message: string }
