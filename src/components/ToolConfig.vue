<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton } from 'naive-ui'
import AppIcon from './AppIcon.vue'
import BlurDialog from './BlurDialog.vue'
import FillDialog from './FillDialog.vue'
import { useEditorContext } from '../editor/context'
import { SELECTION_MODES } from '../editor/useEditor'

const { t } = useI18n()
const editor = useEditorContext()
const { tool, selMode, hasSelection, canEditSelection, canFill, busy, fillHint, activeLayer } =
  editor

const isPointBox = computed(() => tool.value === 'point' || tool.value === 'box')
const titleKey = computed(() =>
  tool.value === 'point' ? 'tools.point' : tool.value === 'box' ? 'tools.box' : 'tools.move',
)
const hintKey = computed(() =>
  tool.value === 'point'
    ? 'toolConfig.hintPoint'
    : tool.value === 'box'
      ? 'toolConfig.hintBox'
      : 'toolConfig.hintMove',
)
const offsetZero = computed(
  () => !activeLayer.value || (!activeLayer.value.offset.x && !activeLayer.value.offset.y),
)
const blurOpen = ref(false)
const fillOpen = ref(false)
const canBlur = computed(() => canEditSelection.value && !!activeLayer.value)
</script>

<template>
  <section class="tool-config" aria-labelledby="config-heading">
    <div class="config-head">
      <h2 id="config-heading" class="config-title">{{ t(titleKey) }}</h2>
      <span v-if="isPointBox && hasSelection" class="config-state">
        {{ t('toolConfig.selected') }}
      </span>
    </div>

    <p class="hint">{{ t(hintKey) }}</p>

    <template v-if="isPointBox">
      <div class="config-group">
        <h3 class="group-title">{{ t('toolConfig.modeHeading') }}</h3>
        <div class="mode-group" role="radiogroup" :aria-label="t('toolConfig.modeAria')">
          <button
            v-for="m in SELECTION_MODES"
            :key="m.value"
            class="mode-btn"
            type="button"
            role="radio"
            :aria-checked="selMode === m.value"
            :title="t(m.hintKey)"
            @click="editor.setSelMode(m.value)"
          >
            {{ t(m.labelKey) }}
          </button>
        </div>
      </div>

      <div class="config-group">
        <h3 class="group-title">{{ t('toolConfig.selectionHeading') }}</h3>
        <div class="action-grid">
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.invertSelection()"
          >
            {{ t('toolConfig.invert') }}
          </n-button>
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.eraseSelection()"
          >
            {{ t('toolConfig.erase') }}
          </n-button>
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.cutToLayer()"
          >
            {{ t('toolConfig.cut') }}
          </n-button>
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.clearSelection()"
          >
            {{ t('toolConfig.deselect') }}
          </n-button>
        </div>
        <n-button
          class="blur-open-btn"
          secondary
          block
          :disabled="!canBlur"
          @click="blurOpen = true"
        >
          <template #icon><AppIcon name="blur" :size="16" /></template>
          {{ t('toolConfig.blur') }}
        </n-button>
        <n-button
          class="fill-btn"
          secondary
          size="large"
          block
          :disabled="!canFill"
          @click="fillOpen = true"
        >
          <template #icon><AppIcon name="spark" :size="17" /></template>
          {{ t('toolConfig.fill') }}
        </n-button>
        <p class="hint fill-hint">{{ fillHint }}</p>
      </div>
    </template>

    <template v-else>
      <div class="config-group">
        <h3 class="group-title">{{ t('toolConfig.currentLayer') }}</h3>
        <div class="current-layer">
          <span class="current-name">
            {{ activeLayer ? activeLayer.name : t('toolConfig.noLayers') }}
          </span>
        </div>
        <n-button
          secondary
          block
          :disabled="!activeLayer || busy.active || offsetZero"
          @click="editor.resetActiveOffset()"
        >
          <template #icon><AppIcon name="reset" :size="16" /></template>
          {{ t('toolConfig.resetPosition') }}
        </n-button>
        <p class="hint">{{ t('toolConfig.layerHint') }}</p>
      </div>
    </template>

    <BlurDialog v-model:show="blurOpen" />
    <FillDialog v-model:show="fillOpen" />
  </section>
</template>
