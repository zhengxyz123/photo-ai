// SPDX-License-Identifier: Apache-2.0
/// Shared document, selection and UI types for the editor.

export interface Point {
  x: number
  y: number
}

/** A prompt point in document coordinates. label 1 = positive, 0 = negative. */
export interface PromptPoint extends Point {
  label: 0 | 1
}

/** A drag rectangle in document coordinates. */
export interface PromptBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Doc {
  name: string
  w: number
  h: number
}

export interface Layer {
  id: string
  name: string
  canvas: HTMLCanvasElement
  offset: Point
  bbox: Rect
}

export type Tool = 'point' | 'box' | 'move'
export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect'
export type ModelStateName = 'idle' | 'loading' | 'ready' | 'error'

export interface ModelState {
  state: ModelStateName
  loaded: number
  total: number
}

export interface View {
  scale: number
  ox: number
  oy: number
  cw: number
  ch: number
}

export interface Region {
  local: boolean | null
  size: number | null
}

export interface DragState {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface MoveState {
  layerId: string
  startX: number
  startY: number
  orig: Point
  snap: Snapshot
  moved: boolean
}

export interface BlurPreview {
  layerId: string
  canvas: HTMLCanvasElement
}

export interface BlurSession {
  layerId: string
  source: HTMLCanvasElement
  sourceData: Uint8ClampedArray
  w: number
  h: number
  localAlpha: Float32Array
  strength: number
  canvas: HTMLCanvasElement | null
}

export interface Snapshot {
  doc: Doc | null
  layers: Layer[]
  activeId: string | null
  mask: Uint8Array | null
  area: number
  points: PromptPoint[]
  box: PromptBox | null
  region: Region | null
  lastFillLocal: boolean | null
}

export interface MaskPreviewCache {
  maskRef: Uint8Array | null
  w: number
  h: number
  dilate: number
  feather: number
  hard: HTMLCanvasElement | null
  dilated: Uint8Array | null
  alpha: Float32Array | null
}
