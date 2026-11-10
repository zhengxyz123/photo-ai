<script setup lang="ts">
import { computed } from 'vue'
import { useEditorContext } from '../editor/context'
import type { ModelState } from '../types/editor'

const editor = useEditorContext()
const { model } = editor

function pct(m: ModelState): number {
  if (!m.total) return 0
  return Math.min(100, Math.round((m.loaded / m.total) * 100))
}

function text(m: ModelState, idle: string): string {
  if (m.state === 'loading') return m.total ? `载入中 ${pct(m)}%` : '载入中'
  if (m.state === 'ready') return '已就绪'
  if (m.state === 'error') return '不可用'
  return idle
}

const samText = computed(() => text(model.sam, '准备中'))
const lamaText = computed(() => text(model.lama, '按需载入'))
const samBusy = computed(() => model.sam.state === 'loading')
const lamaBusy = computed(() => model.lama.state === 'loading')
const samPct = computed(() => pct(model.sam))
const lamaPct = computed(() => pct(model.lama))
</script>

<template>
  <section class="model-block" aria-labelledby="models-heading" aria-live="polite">
    <h2 id="models-heading" class="section-title">模型</h2>

    <div class="model-row">
      <span class="model-dot" :class="`is-${model.sam.state}`" aria-hidden="true" />
      <span class="model-name">选区模型</span>
      <span class="model-value">{{ samText }}</span>
    </div>
    <div v-if="samBusy && samPct > 0" class="model-bar" aria-hidden="true">
      <span :style="{ width: samPct + '%' }" />
    </div>

    <div class="model-row">
      <span class="model-dot" :class="`is-${model.lama.state}`" aria-hidden="true" />
      <span class="model-name">补全模型</span>
      <span class="model-value">{{ lamaText }}</span>
    </div>
    <div v-if="lamaBusy && lamaPct > 0" class="model-bar" aria-hidden="true">
      <span :style="{ width: lamaPct + '%' }" />
    </div>

    <p class="model-note">照片与模型都在浏览器本地处理，不会上传。</p>
  </section>
</template>
