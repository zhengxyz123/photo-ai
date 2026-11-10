<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NInputNumber, NModal, NSwitch } from 'naive-ui'
import { useEditorContext } from '../editor/context'

const { t } = useI18n()
const props = withDefaults(
  defineProps<{
    show?: boolean
    mode?: 'canvas' | 'scale'
  }>(),
  { show: false, mode: 'canvas' },
)
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'apply', value: { w: number; h: number }): void
}>()

const editor = useEditorContext()
const { doc } = editor

const width = ref<number | null>(null)
const height = ref<number | null>(null)
const lock = ref(true)
const aspect = ref(1)

const isScale = computed(() => props.mode === 'scale')
const title = computed(() => t(isScale.value ? 'size.scaleTitle' : 'size.canvasTitle'))
const hint = computed(() => t(isScale.value ? 'size.scaleHint' : 'size.canvasHint'))
const valid = computed(() => {
  const w = Number(width.value)
  const h = Number(height.value)
  return Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1 && w <= 16384 && h <= 16384
})

function norm(v: unknown): number | null {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return null
  return Math.min(16384, Math.max(1, n))
}

function init(): void {
  const d = doc.value
  if (!d) {
    emit('update:show', false)
    return
  }
  width.value = d.w
  height.value = d.h
  aspect.value = d.w / d.h
  lock.value = isScale.value
}

watch(
  () => props.show,
  (v) => {
    if (v) init()
  },
)

function setWidth(v: number | null): void {
  const n = norm(v)
  width.value = n
  if (isScale.value && lock.value && n) {
    height.value = Math.max(1, Math.round(n / aspect.value))
  }
}

function setHeight(v: number | null): void {
  const n = norm(v)
  height.value = n
  if (isScale.value && lock.value && n) {
    width.value = Math.max(1, Math.round(n * aspect.value))
  }
}

function setLock(v: boolean): void {
  lock.value = !!v
  if (lock.value) {
    const w = norm(width.value) || doc.value?.w || 1
    const h = norm(height.value) || doc.value?.h || 1
    aspect.value = w / h
    height.value = Math.max(1, Math.round(w / aspect.value))
  }
}

function close(): void {
  emit('update:show', false)
}

function apply(): void {
  if (!valid.value) return
  const w = norm(width.value)
  const h = norm(height.value)
  if (w == null || h == null) return
  emit('apply', { w, h })
  close()
}
</script>

<template>
  <n-modal :show="show" :mask-closable="false" @update:show="(v) => emit('update:show', v)">
    <n-card class="size-dialog" :title="title" :bordered="false" size="small">
      <div class="size-fields">
        <label class="size-field">
          <span class="size-field-label">{{ t('common.width') }}</span>
          <n-input-number
            :value="width"
            :min="1"
            :max="16384"
            :precision="0"
            :show-button="false"
            @update:value="setWidth"
          />
        </label>
        <span class="size-x" aria-hidden="true">×</span>
        <label class="size-field">
          <span class="size-field-label">{{ t('common.height') }}</span>
          <n-input-number
            :value="height"
            :min="1"
            :max="16384"
            :precision="0"
            :show-button="false"
            @update:value="setHeight"
          />
        </label>
        <span class="size-unit">px</span>
      </div>

      <div v-if="isScale" class="size-lock">
        <n-switch :value="lock" size="small" @update:value="setLock" />
        <span>{{ t('size.keepRatio') }}</span>
      </div>

      <p class="size-hint">{{ hint }}</p>

      <template #footer>
        <div class="size-actions">
          <n-button quaternary size="small" @click="close">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" size="small" :disabled="!valid" @click="apply">
            {{ t('common.apply') }}
          </n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>
