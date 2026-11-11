<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { onMounted, ref, useTemplateRef, watch } from 'vue'
import type { Layer } from '../types/editor'

const props = withDefaults(
  defineProps<{
    layer: Layer
    thumbRev?: number
  }>(),
  { thumbRev: 0 },
)

const layerThumbRef = useTemplateRef('layer-thumb')

function draw(): void {
  const c = layerThumbRef.value
  if (!c || !props.layer?.canvas) return
  const g = c.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = '#0d0f12'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#171a1e'
  for (let y = 0; y < c.height; y += 8) {
    for (let x = 0; x < c.width; x += 8) {
      if ((x / 8 + y / 8) % 2 === 0) g.fillRect(x, y, 8, 8)
    }
  }
  const doc = props.layer.canvas
  const b = props.layer.bbox || { x: 0, y: 0, w: doc.width, h: doc.height }
  const s = Math.min(c.width / b.w, c.height / b.h)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(
    doc,
    b.x,
    b.y,
    b.w,
    b.h,
    (c.width - b.w * s) / 2,
    (c.height - b.h * s) / 2,
    b.w * s,
    b.h * s,
  )
}

watch([() => props.layer.canvas, () => props.layer.bbox, () => props.thumbRev], draw, {
  deep: false,
})
onMounted(draw)
</script>

<template>
  <canvas ref="layer-thumb" class="layer-thumb" width="40" height="40" aria-hidden="true" />
</template>
