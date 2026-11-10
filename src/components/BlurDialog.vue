<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NCard, NModal, NSlider } from 'naive-ui'
import { useEditorContext } from '../editor/context'

const props = withDefaults(defineProps<{ show?: boolean }>(), { show: false })
const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const editor = useEditorContext()
const { dilate, feather } = editor
const strength = ref(12)
const ready = ref(false)
let finishing = false

const canConfirm = computed(() => ready.value && strength.value > 0)

function cleanup(): void {
  document.body.classList.remove('blur-preview-open')
  ready.value = false
}

function open(): void {
  finishing = false
  strength.value = 12
  ready.value = editor.beginBlurPreview(strength.value)
  if (!ready.value) {
    emit('update:show', false)
    return
  }
  document.body.classList.add('blur-preview-open')
}

function cancel(): void {
  if (finishing) return
  finishing = true
  editor.cancelBlurPreview()
  editor.clearSelection()
  cleanup()
  emit('update:show', false)
}

function confirm(): void {
  if (!canConfirm.value || finishing) return
  finishing = true
  if (editor.commitBlurPreview()) editor.clearSelection()
  cleanup()
  emit('update:show', false)
}

function onUpdateShow(v: boolean): void {
  if (!v) cancel()
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      open()
    } else if (!finishing) {
      editor.cancelBlurPreview()
      editor.clearSelection()
      cleanup()
    }
  },
)

watch(strength, (v) => {
  if (props.show && ready.value) editor.updateBlurPreview(v)
})

function onDilate(v: number): void {
  if (ready.value) editor.setDilate(v)
}

function onFeather(v: number): void {
  if (ready.value) editor.setFeather(v)
}

onBeforeUnmount(() => {
  if (ready.value) editor.cancelBlurPreview()
  document.body.classList.remove('blur-preview-open')
})
</script>

<template>
  <n-modal :show="show" :mask-closable="false" draggable @update:show="onUpdateShow">
    <n-card
      class="blur-dialog"
      title="模糊未选区域"
      header-class="n-draggable"
      :bordered="false"
      size="small"
    >
      <div class="blur-field">
        <label for="blur-strength">模糊强度</label>
        <output class="field-value" for="blur-strength">{{ strength }} px</output>
      </div>
      <n-slider
        id="blur-strength"
        v-model:value="strength"
        :min="1"
        :max="40"
        :step="1"
        :tooltip="false"
      />

      <div class="blur-field">
        <label for="blur-dilate">外扩</label>
        <output class="field-value" for="blur-dilate">{{ dilate }} px</output>
      </div>
      <n-slider
        id="blur-dilate"
        :value="dilate"
        :min="0"
        :max="40"
        :step="1"
        :tooltip="false"
        @update:value="onDilate"
      />

      <div class="blur-field">
        <label for="blur-feather">羽化</label>
        <output class="field-value" for="blur-feather">{{ feather }} px</output>
      </div>
      <n-slider
        id="blur-feather"
        :value="feather"
        :min="0"
        :max="16"
        :step="1"
        :tooltip="false"
        @update:value="onFeather"
      />

      <p class="blur-hint">
        拖动标题栏移开对话框，查看整幅图像。外扩和羽化控制清晰到模糊的过渡范围。
      </p>

      <template #footer>
        <div class="blur-actions">
          <n-button quaternary size="small" @click="cancel">取消</n-button>
          <n-button type="primary" size="small" :disabled="!canConfirm" @click="confirm"
            >确认</n-button
          >
        </div>
      </template>
    </n-card>
  </n-modal>
</template>
