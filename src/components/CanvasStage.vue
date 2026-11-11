<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorContext } from '../editor/context'
import { SELECTION_COLOR } from '../editor/useEditor'
import type { Point } from '../types/editor'

const { t } = useI18n()
const editor = useEditorContext()
const {
  doc,
  layers,
  maskCanvas,
  blurPreview,
  points,
  box,
  drag,
  move,
  tool,
  view,
  redraw,
  compositeRev,
  activeLayer,
  canInteract,
  menuOpen,
  pointerDown,
  pointerMove,
  pointerUp,
  pointerCancel,
  fitView,
  zoomAt,
  bumpRedraw,
} = editor

const stageCanvasRef = useTemplateRef('stage-canvas')
const pan = ref<{ x: number; y: number; ox: number; oy: number } | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let ro: ResizeObserver | null = null
let dpr = 1
let checker: CanvasPattern | null = null

function makeChecker(): void {
  if (!ctx) return
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const g = c.getContext('2d')
  if (!g) return
  g.fillStyle = '#0d0f12'
  g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#15181c'
  g.fillRect(0, 0, 8, 8)
  g.fillRect(8, 8, 8, 8)
  checker = ctx.createPattern(c, 'repeat')
}

function resize(): void {
  const c = stageCanvasRef.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (c.width !== pw || c.height !== ph) {
    c.width = pw
    c.height = ph
  }
  ctx = c.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  view.cw = w
  view.ch = h
  if (!checker) makeChecker()
  fitView()
}

function draw(): void {
  const el = stageCanvasRef.value
  if (!el) return
  if (!ctx) ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, view.cw, view.ch)
  if (!doc.value) return

  const { w, h } = doc.value
  const { scale, ox, oy } = view
  const dw = w * scale
  const dh = h * scale

  // Magnified pixels stay crisp; downscaled views keep smooth sampling.
  const smooth = scale < 1
  ctx.imageSmoothingEnabled = smooth
  if (smooth) ctx.imageSmoothingQuality = 'high'

  ctx.save()
  if (checker) ctx.fillStyle = checker
  ctx.fillRect(ox, oy, dw, dh)
  ctx.restore()

  const preview = blurPreview.value
  for (const l of layers.value) {
    const src = preview && preview.layerId === l.id ? preview.canvas : l.canvas
    const sw = src.width * scale
    const sh = src.height * scale
    ctx.drawImage(src, ox + l.offset.x * scale, oy + l.offset.y * scale, sw, sh)
  }

  // Selection overlays are anchored to the active layer, not to the document.
  const layer = activeLayer.value
  const lox = layer ? layer.offset.x : 0
  const loy = layer ? layer.offset.y : 0

  if (!preview && maskCanvas.value && layer) {
    const mw = maskCanvas.value.width
    const mh = maskCanvas.value.height
    ctx.drawImage(maskCanvas.value, ox + lox * scale, oy + loy * scale, mw * scale, mh * scale)
  }

  for (const p of points.value) {
    const x = ox + (lox + p.x) * scale
    const y = oy + (loy + p.y) * scale
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    if (p.label === 1) {
      ctx.fillStyle = SELECTION_COLOR
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#0c0d0f'
      ctx.stroke()
    } else {
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x - 3, y)
      ctx.lineTo(x + 3, y)
      ctx.stroke()
    }
  }

  const b = preview ? null : drag.value || box.value
  if (b) {
    const x0 = ox + (lox + Math.min(b.x0, b.x1)) * scale
    const y0 = oy + (loy + Math.min(b.y0, b.y1)) * scale
    const bw = Math.abs(b.x1 - b.x0) * scale
    const bh = Math.abs(b.y1 - b.y0) * scale
    ctx.lineWidth = 1.5
    ctx.strokeStyle = SELECTION_COLOR
    ctx.strokeRect(x0, y0, bw, bh)
    ctx.fillStyle = SELECTION_COLOR
    const corners: Array<[number, number]> = [
      [x0, y0],
      [x0 + bw, y0],
      [x0, y0 + bh],
      [x0 + bw, y0 + bh],
    ]
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - 3, cy - 3, 6, 6)
    }
  }

  if (move.value && activeLayer.value) {
    const l = activeLayer.value
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255, 255, 255, .55)'
    ctx.strokeRect(
      ox + l.offset.x * scale,
      oy + l.offset.y * scale,
      l.canvas.width * scale,
      l.canvas.height * scale,
    )
  }

  ctx.save()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(4, 10, 14, .55)'
  ctx.strokeRect(ox, oy, dw, dh)
  ctx.lineWidth = 2
  ctx.strokeStyle = SELECTION_COLOR
  ctx.strokeRect(ox, oy, dw, dh)
  ctx.restore()
}

function screenPoint(ev: PointerEvent): { x: number; y: number } | null {
  if (!doc.value) return null
  const el = stageCanvasRef.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return {
    x: (ev.clientX - rect.left - view.ox) / view.scale,
    y: (ev.clientY - rect.top - view.oy) / view.scale,
  }
}

function toDoc(ev: PointerEvent, clampToDoc = false): Point | null {
  const p = screenPoint(ev)
  if (!p || !doc.value) return null
  const maxX = doc.value.w - 1
  const maxY = doc.value.h - 1
  if (clampToDoc) {
    return { x: Math.min(maxX, Math.max(0, p.x)), y: Math.min(maxY, Math.max(0, p.y)) }
  }
  if (p.x < 0 || p.y < 0 || p.x > doc.value.w || p.y > doc.value.h) return null
  return { x: Math.min(maxX, Math.max(0, p.x)), y: Math.min(maxY, Math.max(0, p.y)) }
}

function toLayer(ev: PointerEvent, clampToLayer = false): Point | null {
  const layer = activeLayer.value
  const p = screenPoint(ev)
  if (!p || !layer) return null
  const lw = layer.canvas.width
  const lh = layer.canvas.height
  const x = p.x - layer.offset.x
  const y = p.y - layer.offset.y
  const maxX = lw - 1
  const maxY = lh - 1
  if (clampToLayer) {
    return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) }
  }
  if (x < 0 || y < 0 || x > lw || y > lh) return null
  return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) }
}

function overlayOpen(): boolean {
  if (menuOpen.value) return true
  // The click that dismisses a menu must not also start a selection. Checking
  // the rendered dropdown (not only its show event) also survives the race
  // between one menu closing and another opening.
  return [...document.querySelectorAll('.n-dropdown-menu')].some((m) => {
    const r = m.getBoundingClientRect()
    const s = getComputedStyle(m)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  })
}

function capture(el: HTMLCanvasElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // Synthetic pointer events do not have a live pointer to capture.
  }
}

function onPointerDown(ev: PointerEvent): void {
  if (!doc.value || overlayOpen()) return
  const el = stageCanvasRef.value
  if (!el) return
  if (ev.button === 1) {
    if (drag.value || move.value) return
    ev.preventDefault()
    pan.value = {
      x: ev.clientX,
      y: ev.clientY,
      ox: view.ox,
      oy: view.oy,
    }
    capture(el, ev.pointerId)
    return
  }
  if (!canInteract.value) return
  // Move gestures use document coordinates; point/box prompts are layer-local
  // and may sit outside the document canvas.
  const pt = tool.value === 'move' ? toDoc(ev) : toLayer(ev)
  if (!pt) return
  capture(el, ev.pointerId)
  pointerDown(pt, { alt: ev.altKey, button: ev.button })
}

function onPointerMove(ev: PointerEvent): void {
  if (pan.value) {
    view.ox = pan.value.ox + (ev.clientX - pan.value.x)
    view.oy = pan.value.oy + (ev.clientY - pan.value.y)
    bumpRedraw()
    return
  }
  if (move.value) {
    const pt = toDoc(ev, true)
    if (pt) pointerMove(pt)
    return
  }
  if (!drag.value) return
  const pt = toLayer(ev, true)
  if (pt) pointerMove(pt)
}

function onPointerUp(ev: PointerEvent): void {
  if (pan.value) {
    pan.value = null
    bumpRedraw()
    return
  }
  if (move.value) {
    pointerUp(toDoc(ev, true))
    return
  }
  if (!drag.value) return
  pointerUp(toLayer(ev, true))
}

function onPointerCancel(): void {
  if (pan.value) {
    pan.value = null
    bumpRedraw()
    return
  }
  pointerCancel()
}

function onWheel(ev: WheelEvent): void {
  const el = stageCanvasRef.value
  if (!doc.value || !el || overlayOpen()) return
  ev.preventDefault()
  const rect = el.getBoundingClientRect()
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? rect.height : 1
  const delta = ev.deltaY * unit
  zoomAt(Math.exp(-delta * 0.0015), ev.clientX - rect.left, ev.clientY - rect.top)
}

function onMouseDown(ev: MouseEvent): void {
  if (ev.button === 1) ev.preventDefault()
}

function onAuxClick(ev: MouseEvent): void {
  if (ev.button === 1) ev.preventDefault()
}

function stopContextMenu(ev: MouseEvent): void {
  ev.preventDefault()
}

// Redraw on view/gesture changes and whenever the flattened document changes
// (for example after a fill result is painted into a layer).
watch([redraw, compositeRev], draw)
watch(doc, async () => {
  await nextTick()
  resize()
  draw()
})

onMounted(async () => {
  ctx = stageCanvasRef.value?.getContext('2d') ?? null
  if (ctx) makeChecker()
  ro = new ResizeObserver(() => {
    resize()
    draw()
  })
  if (stageCanvasRef.value) ro.observe(stageCanvasRef.value)
  await nextTick()
  resize()
  draw()
})

onBeforeUnmount(() => {
  ro?.disconnect()
})
</script>

<template>
  <canvas
    ref="stage-canvas"
    class="stage-canvas"
    :class="{ 'is-move': tool === 'move', 'is-panning': !!pan }"
    :aria-label="t('canvas.aria')"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @mousedown="onMouseDown"
    @auxclick="onAuxClick"
    @wheel="onWheel"
    @contextmenu="stopContextMenu"
  />
</template>
