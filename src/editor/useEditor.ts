// SPDX-License-Identifier: Apache-2.0
// Document, selection and worker bridge for the editor.
//
// The worker owns the two models and the active layer image. This module owns
// the document: layers, the current layer-local mask, the pointer gestures, the
// undo stack and the one worker conversation. Canvas elements are markRaw so
// Vue never proxies a live bitmap.
import { computed, markRaw, reactive, ref, shallowRef, watch } from 'vue'
import type {
  BlurPreview,
  BlurSession,
  Doc,
  DragState,
  Layer,
  MaskPreviewCache,
  ModelState,
  MoveState,
  PromptBox,
  PromptPoint,
  Rect,
  Region,
  SelectionMode,
  Snapshot,
  Tool,
  View,
  Point,
} from '../types/editor'
import type { WorkerErrorCode, WorkerResponse } from '../types/worker'
import { i18n, translate as t } from '../i18n'

export const SELECTION_COLOR = '#b06cff'
const SELECTION_RGB: readonly [number, number, number] = [176, 108, 255]
const MASK_ALPHA = 0.3
const MAX_UNDO = 10
const MAX_DIM = 16384
const PAD = 24
const MIN_ZOOM = 0.02
const MAX_ZOOM = 16
const ZOOM_STEP = 1.25

export const SELECTION_MODES: ReadonlyArray<{
  value: SelectionMode
  labelKey: string
  hintKey: string
}> = [
  { value: 'new', labelKey: 'selectionModes.new.label', hintKey: 'selectionModes.new.hint' },
  { value: 'add', labelKey: 'selectionModes.add.label', hintKey: 'selectionModes.add.hint' },
  {
    value: 'subtract',
    labelKey: 'selectionModes.subtract.label',
    hintKey: 'selectionModes.subtract.hint',
  },
  {
    value: 'intersect',
    labelKey: 'selectionModes.intersect.label',
    hintKey: 'selectionModes.intersect.hint',
  },
]

export const TOOLS: ReadonlyArray<{
  value: Tool
  labelKey: string
  key: string
  icon: string
}> = [
  { value: 'point', labelKey: 'tools.point', key: 'P', icon: 'point' },
  { value: 'box', labelKey: 'tools.box', key: 'B', icon: 'box' },
  { value: 'move', labelKey: 'tools.move', key: 'V', icon: 'move' },
]

function ctx2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const g = canvas.getContext('2d', options)
  if (!g) throw new Error('2D canvas context unavailable')
  return g
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height)
  ctx2d(c).drawImage(src, 0, 0)
  return markRaw(c)
}

function rgbFromCanvas(c: HTMLCanvasElement): Uint8Array {
  const g = ctx2d(c, { willReadFrequently: true })
  const data = g.getImageData(0, 0, c.width, c.height).data
  const out = new Uint8Array(c.width * c.height * 3)
  for (let i = 0, p = 0; i < out.length; i += 3, p += 4) {
    out[i] = data[p] ?? 0
    out[i + 1] = data[p + 1] ?? 0
    out[i + 2] = data[p + 2] ?? 0
  }
  return out
}

function maskArea(mask: Uint8Array | null): number {
  if (!mask) return 0
  let n = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) n++
  }
  return n
}

function maskBBox(mask: Uint8Array | null, w: number, h: number, pad = 0): Rect | null {
  if (!mask) return null
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < x0) return null
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(w - 1, x1 + pad)
  y1 = Math.min(h - 1, y1 + pad)
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

function maskToCanvas(mask: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h)
  const g = ctx2d(c)
  const img = g.createImageData(w, h)
  const d = img.data
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue
    d[p] = 255
    d[p + 1] = 255
    d[p + 2] = 255
    d[p + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}

function maskFromCanvas(c: HTMLCanvasElement): Uint8Array {
  const g = ctx2d(c, { willReadFrequently: true })
  const data = g.getImageData(0, 0, c.width, c.height).data
  const out = new Uint8Array(c.width * c.height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p + 3] ?? 0) >= 128 ? 255 : 0
  }
  return out
}

function dim(v: unknown, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_DIM, Math.max(1, n))
}

function movedBBox(b: Rect, dx: number, dy: number, w: number, h: number): Rect {
  const x0 = Math.max(0, b.x + dx)
  const y0 = Math.max(0, b.y + dy)
  const x1 = Math.min(w, b.x + dx + b.w)
  const y1 = Math.min(h, b.y + dy + b.h)
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: 1, h: 1 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function scaledBBox(b: Rect, sx: number, sy: number, w: number, h: number): Rect {
  return movedBBox(
    {
      x: Math.round(b.x * sx),
      y: Math.round(b.y * sy),
      w: Math.max(1, Math.round(b.w * sx)),
      h: Math.max(1, Math.round(b.h * sy)),
    },
    0,
    0,
    w,
    h,
  )
}

function fileBase(name?: string): string {
  const fallback = t('doc.image')
  return (name || fallback).replace(/\.[^.]+$/, '').trim() || fallback
}

async function bitmapCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap | HTMLImageElement
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    // createImageBitmap is missing for some formats (notably a few SVGs); the
    // <img> path is the fallback and keeps the same canvas output.
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(t('errors.imageUnreadable')))
      }
      img.src = url
    })
  }
  const isBitmap = typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap
  const width = isBitmap ? bitmap.width : (bitmap as HTMLImageElement).naturalWidth
  const height = isBitmap ? bitmap.height : (bitmap as HTMLImageElement).naturalHeight
  const c = makeCanvas(width, height)
  ctx2d(c).drawImage(bitmap, 0, 0)
  if (isBitmap) (bitmap as ImageBitmap).close()
  return markRaw(c)
}

export type Editor = ReturnType<typeof createEditor>

export function createEditor() {
  const doc = ref<Doc | null>(null)
  const layers = ref<Layer[]>([])
  const activeId = ref<string | null>(null)
  const tool = ref<Tool>('point')
  const selMode = ref<SelectionMode>('new')

  const mask = shallowRef<Uint8Array | null>(null)
  const maskCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const maskHard = shallowRef<HTMLCanvasElement | null>(null)
  const maskStats = reactive({ area: 0 })
  const maskPreview: MaskPreviewCache = {
    maskRef: null,
    w: 0,
    h: 0,
    dilate: -1,
    feather: -1,
    hard: null,
    dilated: null,
    alpha: null,
  }
  const blurPreview = shallowRef<BlurPreview | null>(null)
  const points = ref<PromptPoint[]>([])
  const box = ref<PromptBox | null>(null)
  const drag = ref<DragState | null>(null)
  const move = ref<MoveState | null>(null)

  const compositeCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const compositeRev = ref(0)
  const redraw = ref(0)
  const thumbRev = ref(0)

  const busy = reactive<{ active: boolean; key: string }>({ active: false, key: '' })
  const encoded = ref(false)
  const error = ref<{ message: string; at: number } | null>(null)
  const dragOver = ref(false)
  const menuOpen = ref(false)
  const renamingId = ref<string | null>(null)
  const dilate = ref(10)
  const feather = ref(0)
  const region = ref<Region | null>(null)
  const lastFillLocal = ref<boolean | null>(null)

  const undo = shallowRef<Snapshot[]>([])
  const redo = shallowRef<Snapshot[]>([])

  const model = reactive<{ sam: ModelState; lama: ModelState }>({
    sam: { state: 'loading', loaded: 0, total: 0 },
    lama: { state: 'idle', loaded: 0, total: 0 },
  })

  const view = reactive<View>({ scale: 1, ox: 0, oy: 0, cw: 0, ch: 0 })

  let worker: Worker | null = null
  let syncTimer = 0
  let layerSeq = 1
  let cutSeq = 1
  let disposed = false
  let blurSession: BlurSession | null = null
  /** Layer that asked for the in-flight fill, so a late result cannot land on
      whichever layer happens to be active when the model finishes. */
  let fillLayerId: string | null = null
  /** Selection mode captured when the prompt is sent, so switching modes while
      SAM runs cannot change how that result is combined. */
  let segmentMode: SelectionMode = 'new'
  /** An Alt/right click refines the current prompt; its mask replaces the
      selection instead of being combined with it again. */
  let segmentRefines = false
  /** Layer that asked for the in-flight segment, so a stale reply cannot be
      applied to another layer. */
  let segmentLayerId: string | null = null

  const onErrorHook = ref<((e: Error) => void) | null>(null)

  const activeLayer = computed(() => layers.value.find((l) => l.id === activeId.value) || null)
  const activeIndex = computed(() => layers.value.findIndex((l) => l.id === activeId.value))
  const hasDoc = computed(() => !!doc.value)
  const hasSelection = computed(() => !!mask.value && maskStats.area > 0)
  const canInteract = computed(
    () => hasDoc.value && !!activeLayer.value && encoded.value && !busy.active,
  )
  const canEditSelection = computed(() => hasSelection.value && !busy.active)
  const canFill = computed(() => hasSelection.value && encoded.value && !busy.active)
  const canUndo = computed(() => undo.value.length > 0 && !busy.active)
  const canRedo = computed(() => redo.value.length > 0 && !busy.active)
  const canExport = computed(() => hasDoc.value)
  const canMergeDown = computed(() => activeIndex.value > 0 && !busy.active)
  const canDeleteLayer = computed(
    () => layers.value.length > 1 && activeIndex.value >= 0 && !busy.active,
  )
  const canZoomIn = computed(() => hasDoc.value && view.scale < MAX_ZOOM - 1e-6)
  const canZoomOut = computed(() => hasDoc.value && view.scale > MIN_ZOOM + 1e-6)

  const statusText = computed(() => {
    if (!doc.value) return t('status.waiting')
    if (busy.active) return t('status.processing')
    if (model.sam.state === 'error') return t('status.modelUnavailable')
    if (!encoded.value) return t('status.preparing')
    return t('status.ready')
  })
  const statusState = computed(() => {
    if (!doc.value) return 'idle'
    if (busy.active) return 'busy'
    if (model.sam.state === 'error') return 'error'
    if (!encoded.value) return 'busy'
    return 'ready'
  })

  const fillHint = computed(() => {
    if (!doc.value) return t('toolConfig.fillNoDoc')
    if (!hasSelection.value) return t('toolConfig.fillNoSelection')
    if (!region.value || region.value.local == null) return t('toolConfig.fillReady')
    return region.value.local ? t('toolConfig.fillLocal') : t('toolConfig.fillFull')
  })

  function bumpRedraw(): void {
    redraw.value++
  }

  // The view transform is independent of the document: fit, wheel zoom and
  // middle-button panning never touch layers or pixels.
  function clampZoom(scale: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
  }

  function fitView(): void {
    if (!doc.value) {
      view.scale = 1
      view.ox = 0
      view.oy = 0
      return
    }
    const { w, h } = doc.value
    const availW = Math.max(1, view.cw - PAD * 2)
    const availH = Math.max(1, view.ch - PAD * 2)
    view.scale = clampZoom(Math.min(availW / w, availH / h))
    view.ox = (view.cw - w * view.scale) / 2
    view.oy = (view.ch - h * view.scale) / 2
    bumpRedraw()
  }

  function zoomAt(factor: number, sx = view.cw / 2, sy = view.ch / 2): void {
    if (!doc.value || !view.cw || !view.ch) return
    const next = clampZoom(view.scale * factor)
    if (!Number.isFinite(next) || Math.abs(next - view.scale) < 1e-6) return
    const ix = (sx - view.ox) / view.scale
    const iy = (sy - view.oy) / view.scale
    view.scale = next
    view.ox = sx - ix * next
    view.oy = sy - iy * next
    bumpRedraw()
  }

  function zoomIn(): void {
    zoomAt(ZOOM_STEP)
  }

  function zoomOut(): void {
    zoomAt(1 / ZOOM_STEP)
  }

  function panViewBy(dx: number, dy: number): void {
    if (!doc.value) return
    view.ox += dx
    view.oy += dy
    bumpRedraw()
  }

  function setBusy(key: string): void {
    busy.active = true
    busy.key = key
  }

  function endBusy(): void {
    busy.active = false
    busy.key = ''
  }

  function setErrorHandler(fn: ((e: Error) => void) | null): void {
    onErrorHook.value = typeof fn === 'function' ? fn : null
  }

  function showError(err: unknown, source?: 'sam' | 'lama'): void {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error(e)
    error.value = { message: e.message, at: Date.now() }
    if (source === 'sam' || /MobileSAM|SAM|sam_/.test(e.message)) model.sam.state = 'error'
    if (source === 'lama' || /LaMa|lama/.test(e.message)) model.lama.state = 'error'
    endBusy()
    onErrorHook.value?.(e)
  }

  function updateTitle(): void {
    document.title = doc.value ? t('app.titleWithDoc', { name: doc.value.name }) : t('app.title')
  }

  // layers
  function newLayerId(): string {
    layerSeq += 1
    return `L${Date.now().toString(36)}${layerSeq}`
  }

  function uniqueName(base: string): string {
    const names = new Set(layers.value.map((l) => l.name))
    if (!names.has(base)) return base
    let n = 2
    while (names.has(`${base} (${n})`)) n++
    return `${base} (${n})`
  }

  function ensureComposite(): HTMLCanvasElement | null {
    if (!doc.value) return null
    const { w, h } = doc.value
    if (
      !compositeCanvas.value ||
      compositeCanvas.value.width !== w ||
      compositeCanvas.value.height !== h
    ) {
      compositeCanvas.value = markRaw(makeCanvas(w, h))
    }
    return compositeCanvas.value
  }

  function rebuildComposite(): void {
    if (!doc.value) return
    if (!ensureComposite()) return
    const g = ctx2d(compositeCanvas.value!)
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, doc.value.w, doc.value.h)
    for (const l of layers.value) {
      g.drawImage(l.canvas, l.offset.x, l.offset.y)
    }
    compositeRev.value++
  }

  function sendLayerImage(reason = 'edit'): void {
    const layer = activeLayer.value
    if (!doc.value || !worker || !layer) return
    clearTimeout(syncTimer)
    syncTimer = 0
    // Keep the flattened document current for export/content bounds, but send
    // only the active layer to the models: prompts and masks are layer-local.
    rebuildComposite()
    const rgb = rgbFromCanvas(layer.canvas)
    try {
      worker.postMessage(
        { type: 'layer', width: layer.canvas.width, height: layer.canvas.height, rgb, reason },
        [rgb.buffer],
      )
    } catch (e) {
      showError(e)
    }
  }

  function reencodeActiveLayer(reason = 'layer'): void {
    if (!activeLayer.value) return
    encoded.value = false
    setBusy('status.preparing')
    sendLayerImage(reason)
  }

  function flushSync(): void {
    if (!syncTimer) return
    clearTimeout(syncTimer)
    syncTimer = 0
    sendLayerImage('before-segment')
  }

  function scheduleSync(delay = 450): void {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = 0
      sendLayerImage('edit')
    }, delay)
  }

  function documentChanged({ sync = true }: { sync?: boolean } = {}): void {
    rebuildComposite()
    thumbRev.value++
    bumpRedraw()
    if (sync) scheduleSync()
  }

  // undo
  function snapshot(): Snapshot {
    return {
      doc: doc.value ? { ...doc.value } : null,
      layers: layers.value.map((l) => ({
        id: l.id,
        name: l.name,
        offset: { ...l.offset },
        bbox: { ...l.bbox },
        canvas: markRaw(cloneCanvas(l.canvas)),
      })),
      activeId: activeId.value,
      mask: mask.value ? mask.value.slice() : null,
      area: maskStats.area,
      points: points.value.map((p) => ({ ...p })),
      box: box.value ? { ...box.value } : null,
      region: region.value ? { ...region.value } : null,
      lastFillLocal: lastFillLocal.value,
    }
  }

  function pushUndo(): void {
    undo.value = [...undo.value, snapshot()].slice(-MAX_UNDO)
    redo.value = []
  }

  function applySnapshot(s: Snapshot): void {
    cancelBlurPreview()
    if (s.doc) doc.value = { ...s.doc }
    layers.value = s.layers
    activeId.value = s.activeId
    mask.value = s.mask
    maskStats.area = s.area || 0
    points.value = s.points
    box.value = s.box
    region.value = s.region
    lastFillLocal.value = s.lastFillLocal
    buildMaskCanvas()
    documentChanged({ sync: false })
    // The worker may hold another layer or older pixels; always re-encode the
    // restored active layer before selection/fill can run again.
    encoded.value = false
    setBusy('status.preparing')
    sendLayerImage('image')
  }

  function undoEdit(): void {
    if (!undo.value.length || busy.active) return
    redo.value = [...redo.value, snapshot()].slice(-MAX_UNDO)
    const s = undo.value[undo.value.length - 1]
    undo.value = undo.value.slice(0, -1)
    if (s) applySnapshot(s)
  }

  function redoEdit(): void {
    if (!redo.value.length || busy.active) return
    undo.value = [...undo.value, snapshot()].slice(-MAX_UNDO)
    const s = redo.value[redo.value.length - 1]
    redo.value = redo.value.slice(0, -1)
    if (s) applySnapshot(s)
  }

  // mask
  function resetMaskPreview(): void {
    maskPreview.maskRef = null
    maskPreview.w = 0
    maskPreview.h = 0
    maskPreview.dilate = -1
    maskPreview.feather = -1
    maskPreview.hard = null
    maskPreview.dilated = null
    maskPreview.alpha = null
  }

  function makeHardMask(m: Uint8Array, w: number, h: number): HTMLCanvasElement {
    const c = makeCanvas(w, h)
    const g = ctx2d(c)
    const img = g.createImageData(w, h)
    const d = img.data
    for (let i = 0, p = 0; i < m.length; i++, p += 4) {
      if (!m[i]) continue
      d[p] = 255
      d[p + 1] = 255
      d[p + 2] = 255
      d[p + 3] = 255
    }
    g.putImageData(img, 0, 0)
    return c
  }

  // Separable box max, matching the C++ dilation without touching the raw mask.
  function dilateMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
    if (r <= 0) return m
    const tmp = new Uint8Array(w * h)
    const out = new Uint8Array(w * h)
    const prefix = new Uint32Array(Math.max(w, h) + 1)
    for (let y = 0; y < h; y++) {
      const row = y * w
      prefix[0] = 0
      for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + (m[row + x] ? 1 : 0)
      for (let x = 0; x < w; x++) {
        const lo = x > r ? x - r : 0
        const hi = x + r < w ? x + r : w - 1
        tmp[row + x] = prefix[hi + 1] > prefix[lo] ? 255 : 0
      }
    }
    for (let x = 0; x < w; x++) {
      prefix[0] = 0
      for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + (tmp[y * w + x] ? 1 : 0)
      for (let y = 0; y < h; y++) {
        const lo = y > r ? y - r : 0
        const hi = y + r < h ? y + r : h - 1
        out[y * w + x] = prefix[hi + 1] > prefix[lo] ? 255 : 0
      }
    }
    return out
  }

  // Clamped box blur of the dilated mask, matching blurAlpha in the C++ core.
  // The returned values are 0..1 and include the soft halo outside the mask.
  function featherMask(m: Uint8Array, w: number, h: number, r: number): Float32Array {
    const src = new Float32Array(w * h)
    for (let i = 0; i < src.length; i++) src[i] = m[i] ? 1 : 0
    const tmp = new Float32Array(w * h)
    const out = new Float32Array(w * h)
    const prefix = new Float32Array(Math.max(w, h) + 1)
    const n = r * 2 + 1
    for (let y = 0; y < h; y++) {
      const row = y * w
      prefix[0] = 0
      for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + src[row + x]
      for (let x = 0; x < w; x++) {
        const lo = x - r
        const hi = x + r
        let sum = prefix[Math.min(w - 1, hi) + 1] - prefix[Math.max(0, lo)]
        if (lo < 0) sum += -lo * src[row]
        if (hi > w - 1) sum += (hi - (w - 1)) * src[row + w - 1]
        tmp[row + x] = sum / n
      }
    }
    for (let x = 0; x < w; x++) {
      prefix[0] = 0
      for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x]
      for (let y = 0; y < h; y++) {
        const lo = y - r
        const hi = y + r
        let sum = prefix[Math.min(h - 1, hi) + 1] - prefix[Math.max(0, lo)]
        if (lo < 0) sum += -lo * tmp[x]
        if (hi > h - 1) sum += (hi - (h - 1)) * tmp[(h - 1) * w + x]
        out[y * w + x] = sum / n
      }
    }
    return out
  }

  function buildMaskCanvas(): void {
    const m = mask.value
    const layer = activeLayer.value
    if (!m || !layer) {
      resetMaskPreview()
      maskCanvas.value = null
      maskHard.value = null
      return
    }
    // The mask lives in layer space, so its size must follow the active layer.
    const w = layer.canvas.width
    const h = layer.canvas.height
    if (m.length !== w * h) {
      mask.value = null
      maskStats.area = 0
      resetMaskPreview()
      maskCanvas.value = null
      maskHard.value = null
      return
    }
    if (maskPreview.maskRef !== m || maskPreview.w !== w || maskPreview.h !== h) {
      maskPreview.maskRef = m
      maskPreview.w = w
      maskPreview.h = h
      maskPreview.hard = null
      maskPreview.dilated = null
      maskPreview.alpha = null
      maskPreview.dilate = -1
      maskPreview.feather = -1
    }
    if (!maskPreview.hard) {
      maskPreview.hard = makeHardMask(m, w, h)
      maskHard.value = markRaw(maskPreview.hard)
    }
    const dr = Math.round(dilate.value)
    if (maskPreview.dilate !== dr) {
      maskPreview.dilated = dilateMask(m, w, h, dr)
      maskPreview.dilate = dr
      maskPreview.alpha = null
      maskPreview.feather = -1
    }
    const dilated = maskPreview.dilated
    if (!dilated) return
    const fr = Math.round(feather.value)
    if (maskPreview.feather !== fr) {
      maskPreview.alpha = fr > 0 ? featherMask(dilated, w, h, fr) : null
      maskPreview.feather = fr
    }

    const disp = makeCanvas(w, h)
    const dg = ctx2d(disp)
    const dImg = dg.createImageData(w, h)
    const d = dImg.data
    const base = Math.round(MASK_ALPHA * 255)
    const alpha = maskPreview.alpha
    for (let y = 0, i = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++, p += 4) {
        const raw = !!m[i]
        const inside = !!dilated[i]
        const a = alpha ? alpha[i] : inside ? 1 : 0
        if (!raw && a <= 0.002) continue
        // Amber covers the full area the fill will touch; the raw selection
        // keeps a solid inner outline so the original selection stays legible.
        const rawEdge =
          raw &&
          (x < 2 ||
            y < 2 ||
            x >= w - 2 ||
            y >= h - 2 ||
            !m[i - 1] ||
            !m[i + 1] ||
            !m[i - w] ||
            !m[i + w] ||
            !m[i - 2] ||
            !m[i + 2] ||
            !m[i - 2 * w] ||
            !m[i + 2 * w])
        d[p] = SELECTION_RGB[0]
        d[p + 1] = SELECTION_RGB[1]
        d[p + 2] = SELECTION_RGB[2]
        d[p + 3] = rawEdge ? 255 : Math.round(base * a)
      }
    }
    dg.putImageData(dImg, 0, 0)
    maskCanvas.value = markRaw(disp)
  }

  function applyMaskOp(incoming: Uint8Array, mode = selMode.value): Uint8Array {
    if (!mask.value || mode === 'new') return incoming
    const a = mask.value
    const out = new Uint8Array(incoming.length)
    for (let i = 0; i < out.length; i++) {
      const x = a[i] ? 1 : 0
      const y = incoming[i] ? 1 : 0
      if (mode === 'add') out[i] = x | y ? 255 : 0
      else if (mode === 'subtract') out[i] = x & (y ^ 1) ? 255 : 0
      else out[i] = x & y ? 255 : 0
    }
    return out
  }

  function setMask(incoming: Uint8Array | null): void {
    const layer = activeLayer.value
    if (incoming && (!layer || incoming.length !== layer.canvas.width * layer.canvas.height)) {
      // A late reply for another layer (or another size) must not leak into
      // the current layer's selection.
      return
    }
    const area = maskArea(incoming)
    region.value = null
    if (!incoming || area === 0) {
      mask.value = null
      maskStats.area = 0
      buildMaskCanvas()
    } else {
      mask.value = incoming
      maskStats.area = area
      buildMaskCanvas()
    }
    bumpRedraw()
  }

  function clearSelection(): void {
    points.value = []
    box.value = null
    drag.value = null
    move.value = null
    mask.value = null
    maskCanvas.value = null
    maskHard.value = null
    maskStats.area = 0
    region.value = null
    lastFillLocal.value = null
    resetMaskPreview()
    bumpRedraw()
  }

  function invertSelection(): void {
    if (!mask.value || busy.active) return
    const m = mask.value
    const out = new Uint8Array(m.length)
    for (let i = 0; i < m.length; i++) out[i] = m[i] ? 0 : 255
    setMask(out)
    if (hasSelection.value) requestRegion()
    bumpRedraw()
  }

  // blur
  function makeBlurAlpha(layer: Layer): Float32Array {
    // Selection and layer share the same pixel space, so the mask can be used
    // directly instead of being shifted by the layer offset.
    const lw = layer.canvas.width
    const lh = layer.canvas.height
    const localAlpha = new Float32Array(lw * lh)
    const alpha = maskPreview.alpha
    const dilated = maskPreview.dilated
    if ((alpha?.length ?? dilated?.length ?? 0) !== lw * lh) return localAlpha
    for (let i = 0; i < localAlpha.length; i++) {
      localAlpha[i] = alpha ? Math.min(1, Math.max(0, alpha[i] ?? 0)) : dilated?.[i] ? 1 : 0
    }
    return localAlpha
  }

  function beginBlurPreview(strength = 12): boolean {
    if (!doc.value || !hasSelection.value || busy.active) return false
    const layer = activeLayer.value
    if (!layer) return false
    buildMaskCanvas()
    if (!maskPreview.dilated) return false
    const w = layer.canvas.width
    const h = layer.canvas.height
    const g = ctx2d(layer.canvas, { willReadFrequently: true })
    blurSession = {
      layerId: layer.id,
      source: layer.canvas,
      sourceData: g.getImageData(0, 0, w, h).data,
      w,
      h,
      localAlpha: makeBlurAlpha(layer),
      strength: -1,
      canvas: null,
    }
    updateBlurPreview(strength)
    return !!blurPreview.value
  }

  function updateBlurPreview(strength: number): void {
    if (!blurSession) return
    const s = Math.max(0, Math.min(40, Math.round(Number(strength) || 0)))
    if (blurSession.canvas && blurSession.strength === s) return
    const { w, h, source, sourceData, localAlpha } = blurSession
    const out = makeCanvas(w, h)
    const og = ctx2d(out)
    if (s <= 0) {
      og.putImageData(new ImageData(new Uint8ClampedArray(sourceData), w, h), 0, 0)
    } else {
      const blurred = makeCanvas(w, h)
      const bg = ctx2d(blurred)
      bg.filter = `blur(${s}px)`
      bg.drawImage(source, 0, 0)
      bg.filter = 'none'
      const bd = bg.getImageData(0, 0, w, h).data
      const img = og.createImageData(w, h)
      const od = img.data
      for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        const a = localAlpha[i]
        const inv = 1 - a
        const sa = sourceData[p + 3] / 255
        const ba = bd[p + 3] / 255
        const oa = sa * a + ba * inv
        // Blur only the colour. Keeping the layer's own alpha prevents the
        // Gaussian kernel from eating a transparent rim into its border.
        od[p + 3] = sourceData[p + 3]
        if (oa <= 0) {
          od[p] = sourceData[p]
          od[p + 1] = sourceData[p + 1]
          od[p + 2] = sourceData[p + 2]
          continue
        }
        for (let c = 0; c < 3; c++) {
          // Blend premultiplied so transparent layer edges do not fringe.
          const sv = sourceData[p + c] * sa
          const bv = bd[p + c] * ba
          od[p + c] = (sv * a + bv * inv) / oa
        }
      }
      og.putImageData(img, 0, 0)
    }
    blurSession.canvas = markRaw(out)
    blurSession.strength = s
    blurPreview.value = { layerId: blurSession.layerId, canvas: blurSession.canvas }
    bumpRedraw()
  }

  function refreshBlurAlpha(): void {
    const session = blurSession
    if (!session || !doc.value) return
    const layer = layers.value.find((l) => l.id === session.layerId)
    if (!layer) return
    session.localAlpha = makeBlurAlpha(layer)
    session.canvas = null
    updateBlurPreview(session.strength)
  }

  function commitBlurPreview(): boolean {
    const session = blurSession
    if (!session || !blurPreview.value || session.strength <= 0) return false
    const layer = layers.value.find((l) => l.id === session.layerId)
    if (!layer) {
      cancelBlurPreview()
      return false
    }
    pushUndo()
    layer.canvas = markRaw(blurPreview.value.canvas)
    blurSession = null
    blurPreview.value = null
    documentChanged({ sync: false })
    sendLayerImage('edit')
    bumpRedraw()
    return true
  }

  function cancelBlurPreview(): void {
    blurSession = null
    blurPreview.value = null
    bumpRedraw()
  }

  // layer ops
  function selectLayer(id: string): void {
    if (busy.active || id === activeId.value) return
    if (!layers.value.some((l) => l.id === id)) return
    activeId.value = id
    cancelBlurPreview()
    // The selection and the worker image belong to the previous layer.
    clearSelection()
    bumpRedraw()
    reencodeActiveLayer('layer')
  }

  function startRename(id: string | null = activeId.value): void {
    if (!id) return
    renamingId.value = id
  }

  function renameLayer(id: string, name: string): void {
    const clean = String(name || '').trim()
    if (!clean) return
    const l = layers.value.find((x) => x.id === id)
    if (l) l.name = clean
    if (renamingId.value === id) renamingId.value = null
  }

  function moveLayerBy(dir: number): void {
    if (busy.active) return
    const i = activeIndex.value
    const j = i + dir
    if (i < 0 || j < 0 || j >= layers.value.length) return
    pushUndo()
    const next = [...layers.value]
    ;[next[i], next[j]] = [next[j], next[i]]
    layers.value = next
    // Stacking does not change the active layer's pixels, so the worker image
    // stays valid; only the flattened document preview needs rebuilding.
    documentChanged({ sync: false })
  }

  // SortableJS reports the index in the displayed (top-first) list.
  function reorderLayers(oldDisplayIndex: number, newDisplayIndex: number): void {
    if (busy.active || oldDisplayIndex === newDisplayIndex) return
    const display = [...layers.value].reverse()
    if (
      oldDisplayIndex < 0 ||
      newDisplayIndex < 0 ||
      oldDisplayIndex >= display.length ||
      newDisplayIndex >= display.length
    )
      return
    pushUndo()
    const [moved] = display.splice(oldDisplayIndex, 1)
    display.splice(newDisplayIndex, 0, moved)
    layers.value = display.reverse()
    documentChanged({ sync: false })
  }

  function canMergeLayer(layer: Layer): boolean {
    const i = layers.value.findIndex((l) => l.id === layer.id)
    return i > 0 && !busy.active
  }

  function mergeDown(id: string | null = activeId.value): void {
    const i = layers.value.findIndex((l) => l.id === id)
    if (i <= 0 || busy.active || !doc.value) return
    pushUndo()
    const lower = layers.value[i - 1]
    const upper = layers.value[i]
    const merged = makeCanvas(doc.value.w, doc.value.h)
    const g = ctx2d(merged)
    g.drawImage(lower.canvas, lower.offset.x, lower.offset.y)
    g.drawImage(upper.canvas, upper.offset.x, upper.offset.y)
    const layer = {
      ...lower,
      canvas: markRaw(merged),
      offset: { x: 0, y: 0 },
      bbox: { x: 0, y: 0, w: doc.value.w, h: doc.value.h },
    }
    const next = [...layers.value]
    next.splice(i - 1, 2, layer)
    layers.value = next
    activeId.value = layer.id
    // The merged canvas is a new layer: the old selection and worker image no
    // longer describe what is active.
    clearSelection()
    cancelBlurPreview()
    documentChanged()
    reencodeActiveLayer('layer')
  }

  function deleteLayer(id: string | null = activeId.value): void {
    if (layers.value.length <= 1 || busy.active) return
    const i = layers.value.findIndex((l) => l.id === id)
    if (i < 0) return
    pushUndo()
    const wasActive = activeId.value === id
    const next = [...layers.value]
    next.splice(i, 1)
    layers.value = next
    if (wasActive) {
      activeId.value = next[Math.max(0, i - 1)].id
      clearSelection()
      cancelBlurPreview()
      documentChanged()
      reencodeActiveLayer('layer')
      return
    }
    // Another layer disappeared; the active image is unchanged.
    documentChanged({ sync: false })
  }

  function resetActiveOffset(): void {
    const l = activeLayer.value
    if (!l || busy.active) return
    if (!l.offset.x && !l.offset.y) return
    pushUndo()
    l.offset.x = 0
    l.offset.y = 0
    documentChanged({ sync: false })
  }

  function nudgeActive(dx: number, dy: number): void {
    const l = activeLayer.value
    if (!l || busy.active) return
    l.offset.x += dx
    l.offset.y += dy
    rebuildComposite()
    bumpRedraw()
  }

  // image frame
  function transformMask(
    srcW: number,
    srcH: number,
    newW: number,
    newH: number,
    draw: (g: CanvasRenderingContext2D, src: HTMLCanvasElement) => void,
  ): Uint8Array | null {
    if (!mask.value || srcW <= 0 || srcH <= 0) return null
    const src = maskToCanvas(mask.value, srcW, srcH)
    const out = makeCanvas(newW, newH)
    const g = ctx2d(out)
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    draw(g, src)
    return maskFromCanvas(out)
  }

  function dropMask(): void {
    mask.value = null
    maskCanvas.value = null
    maskHard.value = null
    maskStats.area = 0
    region.value = null
    resetMaskPreview()
  }

  function finishImageEdit(nextMask: Uint8Array | null): void {
    points.value = []
    box.value = null
    drag.value = null
    move.value = null
    lastFillLocal.value = null
    region.value = null
    if (nextMask) {
      const area = maskArea(nextMask)
      if (area) {
        mask.value = nextMask
        maskStats.area = area
        buildMaskCanvas()
      } else {
        dropMask()
      }
    } else {
      dropMask()
    }
    encoded.value = false
    thumbRev.value++
    bumpRedraw()
    setBusy('status.preparing')
    sendLayerImage('image')
  }

  function resizeCanvas(nextW: number, nextH: number): void {
    if (!doc.value || busy.active) return
    const w = dim(nextW, doc.value.w)
    const h = dim(nextH, doc.value.h)
    if (w === doc.value.w && h === doc.value.h) return
    const oldW = doc.value.w
    const oldH = doc.value.h
    const dx = Math.floor((w - oldW) / 2)
    const dy = Math.floor((h - oldH) / 2)
    pushUndo()
    for (const l of layers.value) {
      // The canvas is not resampled: keep each layer's pixels and shift it by
      // the same amount as the document origin, so overflow stays in the layer.
      l.offset = { x: l.offset.x + dx, y: l.offset.y + dy }
    }
    doc.value = { ...doc.value, w, h }
    // The selection is layer-local and the layer canvases did not move
    // relative to their own pixels, so it is still valid as-is.
    finishImageEdit(mask.value)
  }

  function cropToRect(
    rect: Rect,
    { clearSelection = false }: { clearSelection?: boolean } = {},
  ): void {
    if (!doc.value || busy.active) return
    const { w: oldW, h: oldH } = doc.value
    const x = Math.min(oldW - 1, Math.max(0, Math.round(rect.x)))
    const y = Math.min(oldH - 1, Math.max(0, Math.round(rect.y)))
    const w = Math.min(oldW - x, Math.max(1, Math.round(rect.w)))
    const h = Math.min(oldH - y, Math.max(1, Math.round(rect.h)))
    if (x === 0 && y === 0 && w === oldW && h === oldH) return
    pushUndo()
    const maskLayer = activeLayer.value
    const maskW = maskLayer?.canvas.width ?? 0
    const maskH = maskLayer?.canvas.height ?? 0
    const maskOx = maskLayer?.offset.x ?? 0
    const maskOy = maskLayer?.offset.y ?? 0
    const nextMask = clearSelection
      ? null
      : transformMask(maskW, maskH, w, h, (g, src) => g.drawImage(src, maskOx - x, maskOy - y))
    for (const l of layers.value) {
      const old = l.canvas
      const ox = l.offset.x
      const oy = l.offset.y
      const b = l.bbox || { x: 0, y: 0, w: old.width, h: old.height }
      const c = makeCanvas(w, h)
      ctx2d(c).drawImage(old, ox - x, oy - y)
      l.canvas = markRaw(c)
      l.offset = { x: 0, y: 0 }
      l.bbox = movedBBox({ x: b.x + ox - x, y: b.y + oy - y, w: b.w, h: b.h }, 0, 0, w, h)
    }
    doc.value = { ...doc.value, w, h }
    finishImageEdit(nextMask)
  }

  function alphaBounds(canvas: HTMLCanvasElement): Rect | null {
    const w = canvas.width
    const h = canvas.height
    const g = ctx2d(canvas, { willReadFrequently: true })
    const data = g.getImageData(0, 0, w, h).data
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < h; y++) {
      let p = y * w * 4
      for (let x = 0; x < w; x++, p += 4) {
        if (!data[p + 3]) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (x1 < x0) return null
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }

  function fitCanvasToLayer(): void {
    const l = activeLayer.value
    if (!l || !doc.value || busy.active) return
    const b = alphaBounds(l.canvas)
    if (!b) return
    const x0 = Math.max(0, l.offset.x + b.x)
    const y0 = Math.max(0, l.offset.y + b.y)
    const x1 = Math.min(doc.value.w, l.offset.x + b.x + b.w)
    const y1 = Math.min(doc.value.h, l.offset.y + b.y + b.h)
    if (x1 <= x0 || y1 <= y0) return
    cropToRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }

  function contentBounds(): Rect | null {
    if (!doc.value) return null
    rebuildComposite()
    const composite = compositeCanvas.value
    return composite ? alphaBounds(composite) : null
  }

  function cropToSelection(): void {
    if (!doc.value || !hasSelection.value || busy.active) return
    const layer = activeLayer.value
    if (!layer) return
    const b = maskBBox(mask.value, layer.canvas.width, layer.canvas.height)
    if (!b) return
    const x0 = Math.max(0, layer.offset.x + b.x)
    const y0 = Math.max(0, layer.offset.y + b.y)
    const x1 = Math.min(doc.value.w, layer.offset.x + b.x + b.w)
    const y1 = Math.min(doc.value.h, layer.offset.y + b.y + b.h)
    if (x1 <= x0 || y1 <= y0) return
    cropToRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { clearSelection: true })
  }

  function cropToContent(): void {
    if (!doc.value || busy.active) return
    const b = contentBounds()
    if (!b) return
    cropToRect(b)
  }

  function scaleImage(nextW: number, nextH: number): void {
    if (!doc.value || busy.active) return
    const w = dim(nextW, doc.value.w)
    const h = dim(nextH, doc.value.h)
    if (w === doc.value.w && h === doc.value.h) return
    const oldW = doc.value.w
    const oldH = doc.value.h
    const sx = w / oldW
    const sy = h / oldH
    pushUndo()
    const maskLayer = activeLayer.value
    const maskW = maskLayer?.canvas.width ?? 0
    const maskH = maskLayer?.canvas.height ?? 0
    for (const l of layers.value) {
      const old = l.canvas
      const lw = Math.max(1, Math.round(old.width * sx))
      const lh = Math.max(1, Math.round(old.height * sy))
      const c = makeCanvas(lw, lh)
      const g = ctx2d(c)
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(old, 0, 0, lw, lh)
      l.canvas = markRaw(c)
      l.offset = {
        x: Math.round(l.offset.x * sx),
        y: Math.round(l.offset.y * sy),
      }
      l.bbox = scaledBBox(l.bbox || { x: 0, y: 0, w: old.width, h: old.height }, sx, sy, lw, lh)
    }
    const nextLayer = activeLayer.value
    const nextMaskW = nextLayer?.canvas.width ?? 0
    const nextMaskH = nextLayer?.canvas.height ?? 0
    const nextMask = transformMask(maskW, maskH, nextMaskW, nextMaskH, (g, src) =>
      g.drawImage(src, 0, 0, nextMaskW, nextMaskH),
    )
    doc.value = { ...doc.value, w, h }
    finishImageEdit(nextMask)
  }

  function scaleLayer(nextW: number | string, nextH: number | string): void {
    const layer = activeLayer.value
    if (!layer || busy.active) return
    const oldW = layer.canvas.width
    const oldH = layer.canvas.height
    const w = dim(nextW, oldW)
    const h = dim(nextH, oldH)
    if (w === oldW && h === oldH) return
    pushUndo()
    const sx = w / oldW
    const sy = h / oldH
    const oldOffsetX = layer.offset.x
    const oldOffsetY = layer.offset.y
    const oldBBox = layer.bbox
    const nextMask =
      mask.value && mask.value.length === oldW * oldH
        ? transformMask(oldW, oldH, w, h, (g, src) => g.drawImage(src, 0, 0, w, h))
        : null
    const c = makeCanvas(w, h)
    const g = ctx2d(c)
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(layer.canvas, 0, 0, w, h)
    layer.canvas = markRaw(c)
    // Resample around the layer centre so it stays where the user put it.
    layer.offset = {
      x: Math.round(oldOffsetX + (oldW - w) / 2),
      y: Math.round(oldOffsetY + (oldH - h) / 2),
    }
    layer.bbox = scaledBBox(oldBBox || { x: 0, y: 0, w: oldW, h: oldH }, sx, sy, w, h)
    finishImageEdit(nextMask)
  }

  // import
  function openDocument(src: HTMLCanvasElement, file?: File): void {
    if (busy.active) return
    cancelBlurPreview()
    const w = src.width
    const h = src.height
    layerSeq = 1
    cutSeq = 1
    doc.value = { name: file?.name || t('doc.image'), w, h }
    compositeCanvas.value = markRaw(makeCanvas(w, h))
    layers.value = [
      {
        id: newLayerId(),
        name: uniqueName(fileBase(file?.name)),
        canvas: src,
        offset: { x: 0, y: 0 },
        bbox: { x: 0, y: 0, w, h },
      },
    ]
    activeId.value = layers.value[0].id
    undo.value = []
    redo.value = []
    encoded.value = false
    clearSelection()
    updateTitle()
    rebuildComposite()
    thumbRev.value++
    compositeRev.value++
    bumpRedraw()
    setBusy('status.preparing')
    sendLayerImage('image')
  }

  function addLayer(src: HTMLCanvasElement, file?: File): void {
    if (busy.active) return
    if (!doc.value) {
      openDocument(src, file)
      return
    }
    pushUndo()
    const { w, h } = doc.value
    // Keep the imported pixels at their native resolution and only centre
    // them: resampling here would change the image resolution. The layer owns
    // the whole source canvas and is positioned with an offset, so pixels that
    // fall outside the document stay in the layer instead of being clipped.
    const dx = Math.round((w - src.width) / 2)
    const dy = Math.round((h - src.height) / 2)
    const layer = {
      id: newLayerId(),
      name: uniqueName(fileBase(file?.name)),
      canvas: src,
      offset: { x: dx, y: dy },
      bbox: { x: 0, y: 0, w: src.width, h: src.height },
    }
    const at = activeIndex.value >= 0 ? activeIndex.value + 1 : layers.value.length
    const next = [...layers.value]
    next.splice(at, 0, layer)
    layers.value = next
    activeId.value = layer.id
    clearSelection()
    cancelBlurPreview()
    documentChanged()
    reencodeActiveLayer('layer')
  }

  function addSolidLayer(color: string, width: number | string, height: number | string): boolean {
    if (busy.active) return false
    const raw = String(color || '').trim()
    const fill = /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#ffffff'
    if (!doc.value) {
      cancelBlurPreview()
      const w = dim(width, 1024)
      const h = dim(height, 1024)
      layerSeq = 1
      cutSeq = 1
      const canvas = makeCanvas(w, h)
      const g = ctx2d(canvas)
      g.fillStyle = fill
      g.fillRect(0, 0, w, h)
      doc.value = { name: t('doc.untitled'), w, h }
      compositeCanvas.value = markRaw(makeCanvas(w, h))
      layers.value = [
        {
          id: newLayerId(),
          name: color,
          canvas: markRaw(canvas),
          offset: { x: 0, y: 0 },
          bbox: { x: 0, y: 0, w, h },
        },
      ]
      activeId.value = layers.value[0].id
      undo.value = []
      redo.value = []
      encoded.value = false
      clearSelection()
      updateTitle()
      rebuildComposite()
      thumbRev.value++
      compositeRev.value++
      bumpRedraw()
      setBusy('status.preparing')
      sendLayerImage('image')
      return true
    }
    pushUndo()
    const { w: docW, h: docH } = doc.value
    const w = Math.min(docW, dim(width, docW))
    const h = Math.min(docH, dim(height, docH))
    const x = Math.floor((docW - w) / 2)
    const y = Math.floor((docH - h) / 2)
    const canvas = makeCanvas(docW, docH)
    const g = ctx2d(canvas)
    g.fillStyle = fill
    g.fillRect(x, y, w, h)
    const layer = {
      id: newLayerId(),
      name: uniqueName(t('doc.solid')),
      canvas: markRaw(canvas),
      offset: { x: 0, y: 0 },
      bbox: { x, y, w, h },
    }
    const at = activeIndex.value >= 0 ? activeIndex.value + 1 : layers.value.length
    const next = [...layers.value]
    next.splice(at, 0, layer)
    layers.value = next
    activeId.value = layer.id
    clearSelection()
    cancelBlurPreview()
    documentChanged()
    reencodeActiveLayer('layer')
    return true
  }

  async function loadImageFile(file: File, mode: 'auto' | 'doc' | 'layer' = 'auto'): Promise<void> {
    if (!file || busy.active) return
    if (file.type && !file.type.startsWith('image/')) {
      showError(new Error(t('errors.chooseImage')))
      return
    }
    try {
      const src = await bitmapCanvas(file)
      if (!doc.value || mode === 'doc') openDocument(src, file)
      else addLayer(src, file)
    } catch (e) {
      showError(e)
    }
  }

  function pickImage(mode: 'auto' | 'doc' | 'layer' = 'auto'): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) loadImageFile(file, mode)
    }
    input.click()
  }

  // PhotoEditor.vue replaces this with a confirm dialog when a document is open.
  function requestOpenDocument(): void {
    pickImage('doc')
  }

  // selection
  function requestRegion(): void {
    if (!mask.value || !worker || !doc.value) return
    const copy = mask.value.slice()
    try {
      worker.postMessage({ type: 'region', dilate: dilate.value, mask: copy.buffer }, [copy.buffer])
    } catch (e) {
      showError(e)
    }
  }

  function setDilate(v: number): void {
    dilate.value = Number(v)
    if (mask.value) {
      buildMaskCanvas()
      bumpRedraw()
      refreshBlurAlpha()
    }
    if (hasSelection.value && !busy.active) requestRegion()
  }

  function setFeather(v: number): void {
    feather.value = Number(v)
    if (mask.value) {
      buildMaskCanvas()
      bumpRedraw()
      refreshBlurAlpha()
    }
  }

  function setMenuOpen(open: boolean): void {
    menuOpen.value = !!open
  }

  // fill
  function eraseSelection(): void {
    if (!hasSelection.value || busy.active) return
    const l = activeLayer.value
    if (!l || !maskHard.value) return
    pushUndo()
    const g = ctx2d(l.canvas)
    g.save()
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(maskHard.value, 0, 0)
    g.restore()
    documentChanged({ sync: false })
    sendLayerImage('edit')
  }

  function cutToLayer(): void {
    if (!hasSelection.value || busy.active) return
    const src = activeLayer.value
    const hard = maskHard.value
    if (!src || !hard) return
    const bounds = maskBBox(mask.value, src.canvas.width, src.canvas.height)
    if (!bounds) return
    pushUndo()
    // Cut the selected pixels out of this layer, not out of the flattened
    // document: the selection is layer-local and may sit outside the canvas.
    const patch = makeCanvas(bounds.w, bounds.h)
    const pg = ctx2d(patch)
    pg.drawImage(src.canvas, -bounds.x, -bounds.y)
    pg.globalCompositeOperation = 'destination-in'
    pg.drawImage(hard, -bounds.x, -bounds.y)

    const g = ctx2d(src.canvas)
    g.save()
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(hard, 0, 0)
    g.restore()

    const layer = {
      id: newLayerId(),
      name: uniqueName(t('doc.cut', { n: cutSeq++ })),
      canvas: markRaw(patch),
      offset: { x: src.offset.x + bounds.x, y: src.offset.y + bounds.y },
      bbox: { x: 0, y: 0, w: bounds.w, h: bounds.h },
    }
    const at = layers.value.findIndex((l) => l.id === src.id)
    const next = [...layers.value]
    next.splice(at + 1, 0, layer)
    layers.value = next
    activeId.value = layer.id
    clearSelection()
    cancelBlurPreview()
    tool.value = 'move'
    documentChanged()
    reencodeActiveLayer('layer')
  }

  function paintFillIntoLayer(
    layer: Layer,
    rgb: Uint8Array,
    alpha: Uint8Array,
    width: number,
    height: number,
  ): boolean {
    const lw = layer.canvas.width
    const lh = layer.canvas.height
    if (width !== lw || height !== lh) return false
    if (rgb.length < lw * lh * 3 || alpha.length < lw * lh) return false
    const patch = makeCanvas(lw, lh)
    const g = ctx2d(patch)
    const img = g.createImageData(lw, lh)
    const d = img.data
    for (let i = 0, p = 0; i < lw * lh; i++, p += 4) {
      d[p] = rgb[i * 3]
      d[p + 1] = rgb[i * 3 + 1]
      d[p + 2] = rgb[i * 3 + 2]
      d[p + 3] = alpha[i]
    }
    g.putImageData(img, 0, 0)
    const lg = ctx2d(layer.canvas)
    lg.drawImage(patch, 0, 0)
    return true
  }

  function fillSelection(): void {
    const workerRef = worker
    const currentMask = mask.value
    const target = activeLayer.value
    if (!hasSelection.value || busy.active || !workerRef || !currentMask || !target) return
    // A pending layer update must reach the worker before this mask does.
    flushSync()
    pushUndo()
    fillLayerId = target.id
    setBusy(model.lama.state === 'ready' ? 'status.inpainting' : 'status.loadingInpaintModel')
    const copy = currentMask.slice()
    try {
      workerRef.postMessage(
        {
          type: 'fill',
          dilate: dilate.value,
          feather: feather.value,
          mask: copy.buffer,
        },
        [copy.buffer],
      )
    } catch (e) {
      fillLayerId = null
      showError(e)
    }
  }

  function exportPng(): void {
    const currentDoc = doc.value
    const composite = compositeCanvas.value
    if (!currentDoc || !composite) return
    rebuildComposite()
    const target = compositeCanvas.value
    if (!target) return
    target.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      const base = currentDoc.name.replace(/\.[^.]+$/, '')
      a.href = URL.createObjectURL(blob)
      a.download = `${base}-PhotoAI.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    }, 'image/png')
  }

  // tools
  function setTool(t: Tool): void {
    if (!TOOLS.some((x) => x.value === t)) return
    if (tool.value !== t) {
      points.value = []
      box.value = null
      drag.value = null
      move.value = null
    }
    tool.value = t
    bumpRedraw()
  }

  function setSelMode(m: SelectionMode): void {
    if (!SELECTION_MODES.some((x) => x.value === m)) return
    selMode.value = m
  }

  // pointer
  function pointerDown(
    pt: Point,
    { alt = false, button = 0 }: { alt?: boolean; button?: number } = {},
  ): void {
    if (!canInteract.value) return
    if (tool.value === 'move') {
      const l = activeLayer.value
      if (!l) return
      move.value = {
        layerId: l.id,
        startX: pt.x,
        startY: pt.y,
        orig: { ...l.offset },
        snap: snapshot(),
        moved: false,
      }
      bumpRedraw()
      return
    }
    if (tool.value === 'box') {
      points.value = []
      box.value = null
      drag.value = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }
      bumpRedraw()
      return
    }
    box.value = null
    const label = alt || button === 2 ? 0 : 1
    // A normal click starts a fresh prompt for the object under the cursor;
    // only a negative click refines the prompt that is already on screen.
    // Keeping stale positives here made "New" grow the previous selection
    // instead of replacing it, so it behaved exactly like "Add".
    const refine = label === 0 && points.value.length > 0
    if (!refine) points.value = []
    points.value = [...points.value, { x: pt.x, y: pt.y, label }]
    bumpRedraw()
    requestSegment(refine)
  }

  function pointerMove(pt: Point): void {
    const activeMove = move.value
    if (activeMove) {
      const l = layers.value.find((x) => x.id === activeMove.layerId)
      if (!l) return
      const nx = Math.round(activeMove.orig.x + (pt.x - activeMove.startX))
      const ny = Math.round(activeMove.orig.y + (pt.y - activeMove.startY))
      if (nx === l.offset.x && ny === l.offset.y) return
      l.offset.x = nx
      l.offset.y = ny
      activeMove.moved = true
      rebuildComposite()
      bumpRedraw()
      return
    }
    if (!drag.value) return
    drag.value.x1 = pt.x
    drag.value.y1 = pt.y
    bumpRedraw()
  }

  function pointerUp(pt?: Point | null): void {
    if (move.value) {
      const m = move.value
      move.value = null
      if (m.moved) {
        undo.value = [...undo.value, m.snap].slice(-MAX_UNDO)
        redo.value = []
        thumbRev.value++
        compositeRev.value++
      }
      bumpRedraw()
      return
    }
    if (!drag.value) return
    if (pt) {
      drag.value.x1 = pt.x
      drag.value.y1 = pt.y
    }
    const d = drag.value
    drag.value = null
    if (Math.abs(d.x1 - d.x0) < 4 || Math.abs(d.y1 - d.y0) < 4) {
      bumpRedraw()
      return
    }
    box.value = { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 }
    bumpRedraw()
    requestSegment()
  }

  function pointerCancel(): void {
    drag.value = null
    move.value = null
    bumpRedraw()
  }

  function requestSegment(refine = false): void {
    const layer = activeLayer.value
    if (!encoded.value || !doc.value || !layer || busy.active) return
    // The worker may still hold an older layer image or pixels.
    flushSync()
    const workerRef = worker
    if (!workerRef) return
    segmentMode = selMode.value
    segmentRefines = refine
    segmentLayerId = layer.id
    setBusy('status.selecting')
    const pointsPayload = points.value.map((p) => ({ x: p.x, y: p.y, label: p.label }))
    const b = box.value
    const boxPayload = b ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null
    try {
      workerRef.postMessage({ type: 'segment', points: pointsPayload, box: boxPayload })
    } catch (e) {
      showError(e)
    }
  }

  // worker
  const WORKER_ERROR_KEYS: Partial<Record<WorkerErrorCode, string>> = {
    'sam-incomplete': 'errors.samIncomplete',
    'sam-load-failed': 'errors.samLoadFailed',
    'lama-config-missing': 'errors.lamaMissing',
    'lama-load-failed': 'errors.lamaLoadFailed',
    'wasm-not-ready': 'errors.wasmNotReady',
    'composite-failed': 'errors.compositeFailed',
    'encode-failed': 'errors.encodeFailed',
    'segment-failed': 'errors.segmentFailed',
    'empty-selection': 'errors.emptySelection',
    'fill-failed': 'errors.fillFailed',
  }

  const WORKER_ERROR_MODELS: Partial<Record<WorkerErrorCode, 'sam' | 'lama'>> = {
    'sam-incomplete': 'sam',
    'sam-load-failed': 'sam',
    'lama-config-missing': 'lama',
    'lama-load-failed': 'lama',
  }

  function workerError(msg: Extract<WorkerResponse, { type: 'error' }>): Error {
    const key = WORKER_ERROR_KEYS[msg.code]
    if (!key) return new Error(msg.message || t('errors.processingFailed'))
    return new Error(t(key, msg.params))
  }

  function handleMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'wasm-ready':
        break

      case 'model-progress': {
        const m = model[msg.which]
        if (!m) break
        m.state = 'loading'
        m.loaded = msg.loaded || 0
        m.total = msg.total || 0
        break
      }

      case 'model-start':
        if (msg.which === 'lama') {
          model.lama.state = 'loading'
          model.lama.loaded = 0
          model.lama.total = 0
        }
        break

      case 'sam-ready':
        model.sam.state = 'ready'
        model.sam.loaded = msg.bytes || model.sam.total
        model.sam.total = model.sam.loaded
        break

      case 'lama-ready':
        model.lama.state = 'ready'
        model.lama.loaded = msg.bytes || model.lama.total
        model.lama.total = model.lama.loaded
        // The first fill waits for this download; its label should switch to
        // the actual fill as soon as loading finishes, not stay on the download.
        if (busy.active && busy.key === 'status.loadingInpaintModel') {
          busy.key = 'status.inpainting'
        }
        break

      case 'encoded':
        encoded.value = true
        // requestSegment flushes a pending layer update before posting the
        // segment. That update's `encoded` reply can arrive while the segment
        // still owns the busy state; clearing it here would let the user click
        // again before the selection result lands.
        if (busy.key !== 'status.selecting') endBusy()
        updateTitle()
        if (hasSelection.value && !region.value) requestRegion()
        break

      case 'mask': {
        const incoming = new Uint8Array(msg.mask)
        if (!segmentLayerId || activeId.value === segmentLayerId) {
          setMask(segmentRefines ? incoming : applyMaskOp(incoming, segmentMode))
          if (hasSelection.value) requestRegion()
        }
        segmentRefines = false
        segmentLayerId = null
        endBusy()
        break
      }

      case 'region':
        region.value = msg.local == null ? null : { local: msg.local, size: msg.size }
        break

      case 'filled': {
        const targetId = fillLayerId
        fillLayerId = null
        const target = targetId
          ? layers.value.find((l) => l.id === targetId)
          : (activeLayer.value ?? undefined)
        if (
          !target ||
          !paintFillIntoLayer(
            target,
            new Uint8Array(msg.rgb),
            new Uint8Array(msg.alpha),
            msg.width,
            msg.height,
          )
        ) {
          showError(new Error(t('errors.fillFailed', { code: -1 })))
          break
        }
        lastFillLocal.value = region.value ? region.value.local : true
        model.lama.state = 'ready'
        clearSelection()
        documentChanged({ sync: false })
        sendLayerImage('edit')
        endBusy()
        break
      }

      case 'error':
        fillLayerId = null
        segmentRefines = false
        segmentLayerId = null
        showError(workerError(msg), WORKER_ERROR_MODELS[msg.code])
        break

      default:
        break
    }
  }

  function connectWorker(): void {
    if (typeof Worker === 'undefined') return
    try {
      worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => handleMessage(ev.data)
      worker.onerror = (e: ErrorEvent) =>
        showError(new Error(e.message || t('errors.workerStartFailed')))
      worker.postMessage({ type: 'init' })
    } catch (e) {
      showError(e)
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearTimeout(syncTimer)
    worker?.terminate()
    worker = null
  }

  connectWorker()

  // Keep the document title in the active language; document names stay as-is.
  updateTitle()
  watch(() => i18n.global.locale.value, updateTitle)

  const debug = {
    get doc() {
      return doc.value ? { ...doc.value } : null
    },
    get layers() {
      return layers.value.map((l) => ({
        id: l.id,
        name: l.name,
        offset: { ...l.offset },
        bbox: { ...l.bbox },
      }))
    },
    get activeId() {
      return activeId.value
    },
    get mask() {
      return mask.value
    },
    get maskCanvas() {
      return maskCanvas.value
    },
    get maskHard() {
      return maskHard.value
    },
    get blurPreview() {
      return blurPreview.value
    },
    get activeCanvas() {
      return activeLayer.value?.canvas || null
    },
    get points() {
      return points.value.map((p) => ({ ...p }))
    },
    get box() {
      return box.value ? { ...box.value } : null
    },
    get busy() {
      return busy.active
    },
    get encoded() {
      return encoded.value
    },
    get tool() {
      return tool.value
    },
    get menuOpen() {
      return menuOpen.value
    },
    get region() {
      return region.value ? { ...region.value } : null
    },
    get model() {
      return JSON.parse(JSON.stringify(model))
    },
    get view() {
      return { ...view }
    },
    get canUndo() {
      return canUndo.value
    },
    get canRedo() {
      return canRedo.value
    },
    get status() {
      return statusText.value
    },
  }

  if (typeof window !== 'undefined') {
    Object.assign(debug, {
      loadImageFile,
      addSolidLayer,
      setTool,
      setSelMode,
      fillSelection,
      beginBlurPreview,
      updateBlurPreview,
      commitBlurPreview,
      cancelBlurPreview,
      eraseSelection,
      cutToLayer,
      invertSelection,
      clearSelection,
      undo: undoEdit,
      redo: redoEdit,
      mergeDown,
      reorderLayers,
      selectLayer,
      exportPng,
      resizeCanvas,
      fitCanvasToLayer,
      scaleImage,
      scaleLayer,
      cropToSelection,
      cropToContent,
      zoomIn,
      zoomOut,
      zoomAt,
      fitView,
      panViewBy,
      setDilate,
      setFeather,
    })
    window.__photoai = debug
  }

  return {
    // state
    doc,
    layers,
    activeId,
    activeLayer,
    activeIndex,
    tool,
    selMode,
    mask,
    maskCanvas,
    maskHard,
    maskStats,
    blurPreview,
    points,
    box,
    drag,
    move,
    compositeCanvas,
    compositeRev,
    redraw,
    thumbRev,
    busy,
    encoded,
    error,
    dragOver,
    menuOpen,
    renamingId,
    dilate,
    feather,
    region,
    lastFillLocal,
    undo,
    redo,
    model,
    view,
    // computed
    hasDoc,
    hasSelection,
    canInteract,
    canEditSelection,
    canFill,
    canUndo,
    canRedo,
    canExport,
    canMergeDown,
    canDeleteLayer,
    canZoomIn,
    canZoomOut,
    statusText,
    statusState,
    fillHint,
    // methods
    bumpRedraw,
    setBusy,
    endBusy,
    showError,
    clearSelection,
    invertSelection,
    selectLayer,
    startRename,
    renameLayer,
    moveLayerBy,
    reorderLayers,
    canMergeLayer,
    mergeDown,
    deleteLayer,
    resetActiveOffset,
    nudgeActive,
    loadImageFile,
    addSolidLayer,
    pickImage,
    requestOpenDocument,
    requestRegion,
    setDilate,
    setFeather,
    setMenuOpen,
    eraseSelection,
    cutToLayer,
    fillSelection,
    beginBlurPreview,
    updateBlurPreview,
    commitBlurPreview,
    cancelBlurPreview,
    exportPng,
    resizeCanvas,
    fitCanvasToLayer,
    scaleImage,
    scaleLayer,
    cropToSelection,
    cropToContent,
    zoomIn,
    zoomOut,
    zoomAt,
    fitView,
    panViewBy,
    setTool,
    setSelMode,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    undoEdit,
    redoEdit,
    dispose,
    setErrorHandler,
    PAD,
  }
}
