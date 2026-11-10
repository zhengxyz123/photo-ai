<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NModal, NSlider } from 'naive-ui'
import { useEditorContext } from '../editor/context'
import { useDialogDrag } from './useDialogDrag'

const { t } = useI18n()
const props = withDefaults(defineProps<{ show?: boolean }>(), { show: false })
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const editor = useEditorContext()
const { dilate, feather, canFill } = editor
const drag = useDialogDrag()
let finishing = false

function open(): void {
  finishing = false
  drag.reset()
  document.body.classList.add('fill-preview-open')
}

function cleanup(): void {
  drag.endDrag()
  document.body.classList.remove('fill-preview-open')
}

function close(): void {
  cleanup()
  emit('update:show', false)
}

function cancel(): void {
  if (finishing) return
  finishing = true
  // Keep the selection: cancelling only dismisses the dialog, so the user can
  // reopen it or run another selection action.
  close()
}

function confirm(): void {
  if (!canFill.value || finishing) return
  finishing = true
  editor.fillSelection()
  close()
}

function onUpdateShow(v: boolean): void {
  if (!v) cancel()
}

function onDilate(v: number): void {
  editor.setDilate(v)
}

function onFeather(v: number): void {
  editor.setFeather(v)
}

watch(
  () => props.show,
  (v) => {
    if (v) open()
    else cleanup()
  },
)

onBeforeUnmount(cleanup)
</script>

<template>
  <n-modal :show="show" :mask-closable="false" @update:show="onUpdateShow">
    <n-card
      class="fill-dialog"
      :style="{ left: `${drag.offset.x}px`, top: `${drag.offset.y}px` }"
      :title="t('fill.title')"
      header-class="dialog-drag-handle"
      :bordered="false"
      size="small"
      @pointerdown="drag.onPointerDown"
    >
      <div class="fill-field">
        <label for="fill-expand">{{ t('fill.expand') }}</label>
        <output class="field-value" for="fill-expand">{{ dilate }} px</output>
      </div>
      <n-slider
        id="fill-expand"
        :value="dilate"
        :min="0"
        :max="40"
        :step="1"
        :tooltip="false"
        @update:value="onDilate"
      />

      <div class="fill-field">
        <label for="fill-feather">{{ t('fill.feather') }}</label>
        <output class="field-value" for="fill-feather">{{ feather }} px</output>
      </div>
      <n-slider
        id="fill-feather"
        :value="feather"
        :min="0"
        :max="16"
        :step="1"
        :tooltip="false"
        @update:value="onFeather"
      />

      <p class="fill-dialog-hint">{{ t('fill.hint') }}</p>

      <template #footer>
        <div class="fill-actions">
          <n-button class="fill-cancel-btn" quaternary size="small" @click="cancel">
            {{ t('common.cancel') }}
          </n-button>
          <n-button
            class="fill-confirm-btn"
            type="primary"
            size="small"
            :disabled="!canFill"
            @click="confirm"
          >
            {{ t('fill.confirm') }}
          </n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>
