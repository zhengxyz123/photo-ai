<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NSlider } from 'naive-ui'
import AppIcon from './AppIcon.vue'
import BlurDialog from './BlurDialog.vue'
import { useEditorContext } from '../editor/context'
import { SELECTION_MODES } from '../editor/useEditor'

const editor = useEditorContext()
const {
  tool,
  selMode,
  hasDoc,
  hasSelection,
  canEditSelection,
  canFill,
  busy,
  dilate,
  feather,
  fillHint,
  activeLayer,
} = editor

const isPointBox = computed(() => tool.value === 'point' || tool.value === 'box')
const title = computed(() =>
  tool.value === 'point' ? '点选' : tool.value === 'box' ? '框选' : '移动',
)
const toolHint = computed(() => {
  if (tool.value === 'point') return '点击照片选中物体。按住 Alt 点击可以排除误选的部分。'
  if (tool.value === 'box') return '在照片上拖出矩形，框住要处理的主体。'
  return '拖动照片移动当前图层。方向键微调 1 px，Shift + 方向键 10 px。'
})
const offsetZero = computed(
  () => !activeLayer.value || (!activeLayer.value.offset.x && !activeLayer.value.offset.y),
)
const blurOpen = ref(false)
const canBlur = computed(() => canEditSelection.value && !!activeLayer.value)

function onDilate(v: number): void {
  editor.setDilate(v)
}

function onFeather(v: number): void {
  editor.setFeather(v)
}
</script>

<template>
  <section class="tool-config" aria-labelledby="config-heading">
    <div class="config-head">
      <h2 id="config-heading" class="config-title">{{ title }}</h2>
      <span v-if="isPointBox && hasSelection" class="config-state">已选中</span>
    </div>

    <p class="hint">{{ toolHint }}</p>

    <template v-if="isPointBox">
      <div class="config-group">
        <h3 class="group-title">选区方式</h3>
        <div class="mode-group" role="radiogroup" aria-label="新选区如何并入当前选区">
          <button
            v-for="m in SELECTION_MODES"
            :key="m.value"
            class="mode-btn"
            type="button"
            role="radio"
            :aria-checked="selMode === m.value"
            :title="m.hint"
            @click="editor.setSelMode(m.value)"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <div class="config-group">
        <h3 class="group-title">选区</h3>
        <div class="action-grid">
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.invertSelection()"
          >
            反转选区
          </n-button>
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.eraseSelection()"
          >
            清除为透明
          </n-button>
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.cutToLayer()"
          >
            剪切为图层
          </n-button>
          <n-button
            secondary
            size="small"
            :disabled="!canEditSelection"
            @click="editor.clearSelection()"
          >
            取消选择
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
          模糊未选区域
        </n-button>
      </div>

      <div class="config-group">
        <div class="field">
          <label for="dilate-slider">外扩</label>
          <output class="field-value" for="dilate-slider">{{ dilate }} px</output>
        </div>
        <n-slider
          id="dilate-slider"
          :value="dilate"
          :min="0"
          :max="40"
          :step="1"
          :disabled="busy.active || !hasDoc"
          @update:value="onDilate"
        />

        <div class="field">
          <label for="feather-slider">羽化</label>
          <output class="field-value" for="feather-slider">{{ feather }} px</output>
        </div>
        <n-slider
          id="feather-slider"
          :value="feather"
          :min="0"
          :max="16"
          :step="1"
          :disabled="busy.active || !hasDoc"
          @update:value="onFeather"
        />

        <p class="hint slider-hint">外扩让补全覆盖范围多留一圈，羽化柔化边缘。</p>

        <n-button
          class="fill-btn"
          type="primary"
          size="large"
          block
          :disabled="!canFill"
          @click="editor.fillSelection()"
        >
          <template #icon><AppIcon name="spark" :size="17" /></template>
          填充区域
        </n-button>
        <p class="hint fill-hint">{{ fillHint }}</p>
      </div>
    </template>

    <template v-else>
      <div class="config-group">
        <h3 class="group-title">当前图层</h3>
        <div class="current-layer">
          <span class="current-name">{{ activeLayer ? activeLayer.name : '没有图层' }}</span>
        </div>
        <n-button
          secondary
          block
          :disabled="!activeLayer || busy.active || offsetZero"
          @click="editor.resetActiveOffset()"
        >
          <template #icon><AppIcon name="reset" :size="16" /></template>
          复位位置
        </n-button>
        <p class="hint">图层的顺序、合并与重命名在右侧图层面板里完成。</p>
      </div>
    </template>

    <BlurDialog v-model:show="blurOpen" />
  </section>
</template>
