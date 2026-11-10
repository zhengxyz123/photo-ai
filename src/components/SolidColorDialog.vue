<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NColorPicker, NInputNumber, NModal } from 'naive-ui'
import { useEditorContext } from '../editor/context'

const { t } = useI18n()
const props = withDefaults(defineProps<{ show?: boolean }>(), { show: false })
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const editor = useEditorContext()
const color = ref('#ffffff')
const width = ref(1024)
const height = ref(1024)
const swatches = ['#ffffff', '#0c0d0f', '#8b8b8b', '#e5566f', '#4a90e2', '#3fc07a']
const maxW = computed(() => editor.doc.value?.w || 16384)
const maxH = computed(() => editor.doc.value?.h || 16384)
const valid = computed(() => {
  const w = Number(width.value)
  const h = Number(height.value)
  return Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1
})
const canAdd = computed(() => !editor.busy.active && valid.value)
watch(
  () => props.show,
  (v) => {
    if (!v) return
    color.value = '#ffffff'
    const d = editor.doc.value
    width.value = d?.w || 1024
    height.value = d?.h || 1024
  },
)

function close(): void {
  emit('update:show', false)
}

function add(): void {
  if (!canAdd.value) return
  if (editor.addSolidLayer(color.value, width.value, height.value)) close()
}
</script>

<template>
  <n-modal :show="show" :mask-closable="false" @update:show="(v) => emit('update:show', v)">
    <n-card class="solid-dialog" :title="t('solid.title')" :bordered="false" size="small">
      <n-color-picker
        class="solid-picker"
        v-model:value="color"
        :show-alpha="false"
        :modes="['hex']"
        :swatches="swatches"
      />
      <div class="size-fields solid-size">
        <label class="size-field">
          <span class="size-field-label">{{ t('common.width') }}</span>
          <n-input-number
            v-model:value="width"
            :min="1"
            :max="maxW"
            :precision="0"
            :show-button="false"
          />
        </label>
        <span class="size-x" aria-hidden="true">×</span>
        <label class="size-field">
          <span class="size-field-label">{{ t('common.height') }}</span>
          <n-input-number
            v-model:value="height"
            :min="1"
            :max="maxH"
            :precision="0"
            :show-button="false"
          />
        </label>
        <span class="size-unit">px</span>
      </div>

      <template #footer>
        <div class="solid-actions">
          <n-button quaternary size="small" @click="close">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" size="small" :disabled="!canAdd" @click="add">
            {{ t('common.add') }}
          </n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>
