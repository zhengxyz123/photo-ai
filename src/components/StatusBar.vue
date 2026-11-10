<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTooltip } from 'naive-ui'
import AppIcon from './AppIcon.vue'
import { useEditorContext } from '../editor/context'

const editor = useEditorContext()
const { hasDoc, view, canZoomIn, canZoomOut, zoomIn, zoomOut, fitView } = editor

const zoomText = computed(() => (hasDoc.value ? `${Math.round(view.scale * 100)}%` : '—'))
</script>

<template>
  <footer class="statusbar" aria-label="视图状态">
    <span class="status-hint">中键拖动 · 滚轮缩放</span>
    <span class="status-spacer" />

    <span class="status-zoom">
      <span class="status-zoom-label">缩放</span>
      <span class="status-zoom-value">{{ zoomText }}</span>
    </span>

    <n-tooltip placement="top" :show-arrow="false">
      <template #trigger>
        <n-button
          quaternary
          circle
          size="tiny"
          aria-label="减小缩放"
          :disabled="!canZoomOut"
          @click="zoomOut"
        >
          <template #icon><AppIcon name="minus" :size="15" /></template>
        </n-button>
      </template>
      减小缩放
    </n-tooltip>

    <n-tooltip placement="top" :show-arrow="false">
      <template #trigger>
        <n-button
          quaternary
          circle
          size="tiny"
          aria-label="增加缩放"
          :disabled="!canZoomIn"
          @click="zoomIn"
        >
          <template #icon><AppIcon name="plus" :size="15" /></template>
        </n-button>
      </template>
      增加缩放
    </n-tooltip>

    <n-tooltip placement="top" :show-arrow="false">
      <template #trigger>
        <n-button
          quaternary
          circle
          size="tiny"
          aria-label="适应画面"
          :disabled="!hasDoc"
          @click="fitView"
        >
          <template #icon><AppIcon name="fit" :size="15" /></template>
        </n-button>
      </template>
      适应画面
    </n-tooltip>
  </footer>
</template>
