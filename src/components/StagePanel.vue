<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton } from 'naive-ui'
import AppIcon from './AppIcon.vue'
import CanvasStage from './CanvasStage.vue'
import { useEditorContext } from '../editor/context'

const { t } = useI18n()
const editor = useEditorContext()
const { hasDoc, dragOver, busy, model } = editor

const lamaLoading = computed(
  () => busy.active && busy.key === 'status.loadingInpaintModel' && model.lama.state === 'loading',
)
const lamaPct = computed(() => {
  const m = model.lama
  return m.total ? Math.min(100, Math.round((m.loaded / m.total) * 100)) : 0
})

const dragDepth = ref(0)

function isFileDrag(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

function onDragEnter(ev: DragEvent): void {
  if (!isFileDrag(ev)) return
  ev.preventDefault()
  dragDepth.value += 1
  dragOver.value = true
}

function onDragOver(ev: DragEvent): void {
  if (!isFileDrag(ev)) return
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) dragOver.value = false
}

function onDrop(ev: DragEvent): void {
  ev.preventDefault()
  dragDepth.value = 0
  dragOver.value = false
  const file = ev.dataTransfer?.files?.[0]
  if (!file) return
  editor.loadImageFile(file, editor.hasDoc.value ? 'layer' : 'doc')
}

function pickDocument(): void {
  editor.pickImage('doc')
}

function pickInside(ev: MouseEvent): void {
  ev.stopPropagation()
  pickDocument()
}
</script>

<template>
  <section
    class="stage-panel"
    :data-empty="!hasDoc"
    :aria-label="t('stage.photoCanvas')"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <CanvasStage />

    <div v-if="!hasDoc" class="drop-wrap">
      <div class="drop-plate" @click="pickDocument">
        <AppIcon name="image" class="drop-icon" :size="34" />
        <h1 class="drop-title">{{ t('stage.dropTitle') }}</h1>
        <p class="drop-sub">{{ t('stage.dropSub') }}</p>
        <n-button type="primary" size="large" @click="pickInside">
          {{ t('stage.chooseImage') }}
        </n-button>
        <p class="drop-privacy">{{ t('stage.privacy') }}</p>
      </div>
    </div>

    <div v-if="dragOver" class="drop-veil" aria-hidden="true">
      <AppIcon name="image" :size="34" />
      <span>{{ hasDoc ? t('stage.releaseAsLayer') : t('stage.releaseAsPhoto') }}</span>
    </div>

    <div v-if="busy.active" class="busy-pill" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true" />
      <span>{{ t(busy.key) }}</span>
      <span v-if="lamaLoading && model.lama.total" class="busy-pill-pct">{{ lamaPct }}%</span>
    </div>
  </section>
</template>
