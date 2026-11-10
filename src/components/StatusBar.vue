<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NTooltip } from 'naive-ui'
import AppIcon from './AppIcon.vue'
import { useEditorContext } from '../editor/context'

const { t } = useI18n()
const editor = useEditorContext()
const { hasDoc, view, canZoomIn, canZoomOut, zoomIn, zoomOut, fitView } = editor

const zoomText = computed(() => (hasDoc.value ? `${Math.round(view.scale * 100)}%` : '—'))
</script>

<template>
  <footer class="statusbar" :aria-label="t('status.viewAria')">
    <span class="status-hint">{{ t('status.panHint') }}</span>
    <span class="status-spacer" />

    <span class="status-zoom">
      <span class="status-zoom-label">{{ t('status.zoom') }}</span>
      <span class="status-zoom-value">{{ zoomText }}</span>
    </span>

    <n-tooltip placement="top" :show-arrow="false">
      <template #trigger>
        <n-button
          quaternary
          circle
          size="tiny"
          :aria-label="t('status.zoomOut')"
          :disabled="!canZoomOut"
          @click="zoomOut"
        >
          <template #icon><AppIcon name="minus" :size="15" /></template>
        </n-button>
      </template>
      {{ t('status.zoomOut') }}
    </n-tooltip>

    <n-tooltip placement="top" :show-arrow="false">
      <template #trigger>
        <n-button
          quaternary
          circle
          size="tiny"
          :aria-label="t('status.zoomIn')"
          :disabled="!canZoomIn"
          @click="zoomIn"
        >
          <template #icon><AppIcon name="plus" :size="15" /></template>
        </n-button>
      </template>
      {{ t('status.zoomIn') }}
    </n-tooltip>

    <n-tooltip placement="top" :show-arrow="false">
      <template #trigger>
        <n-button
          quaternary
          circle
          size="tiny"
          :aria-label="t('status.fit')"
          :disabled="!hasDoc"
          @click="fitView"
        >
          <template #icon><AppIcon name="fit" :size="15" /></template>
        </n-button>
      </template>
      {{ t('status.fit') }}
    </n-tooltip>
  </footer>
</template>
